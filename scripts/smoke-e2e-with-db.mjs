#!/usr/bin/env node
// scripts/smoke-e2e-with-db.mjs — Phase 7b.4 (E2E gate)
//
// End-to-end smoke: boots a REAL server with a REAL on-disk SQLite
// catalog DB (not an in-memory stub) and verifies retrieval actually
// returns matches.
//
// This catches schema-drift and catalog-wiring regressions that unit
// tests miss. The Phase 7b.1 Verifier passed because unit tests run
// against in-memory SQLite. The real DB schema and the production
// runtime are separate test surfaces — this E2E smoke is the bridge
// that links them. Concretely: if the migration DDL renames
// `catalog_fts` to something else but the search code still queries
// the old name, in-memory tests pass (they re-run the migration on a
// fresh DB) and production crashes (`no such table: catalog_fts`).
// This smoke catches that class of bug because it boots the real
// runtime against the real on-disk DB.
//
// Pre-flight: `npm run build-index` must have run (DB has 17+
// entries from prior build-index).
//
// Why a subprocess (vs. in-process createServer()): the in-memory
// boot path runs a fresh migration on a `:memory:` DB, which means
// the schema mismatch above is masked. The subprocess boot path
// opens the on-disk DB AS-IS — exactly what production does.
//
// Flow:
//   1. Spawn the entry script DIRECTLY (not via npm; the npm wrapper
//      wraps the process in cmd.exe on Windows and SIGTERM does NOT
//      propagate). Use `node --env-file=.env --experimental-strip-types
//      --no-warnings src/server/boot.ts` so the .env production
//      catalog/state paths are loaded.
//   2. Wait for the `[boot] runtime MODE=production` log line (10s
//      timeout).
//   3. GET /health → assert catalog.count >= 1.
//   4. POST /augment with a real prompt + activeCatalog containing
//      `skill-typescript-strict`. Assert response.matchedSkills has
//      >= 1 entry.
//   5. Cleanup with taskkill /F /T (Windows) or SIGTERM (POSIX).
//
// Exit code: 0 on `[PASS]` lines, 1 (or higher) on any failure.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

// ONNX embedder init + sqlite-vec + FTS5 warmup take ~5–7s on a
// cold boot. 20s is enough headroom for CI without making the
// smoke sluggish on warm reruns.
const BOOT_TIMEOUT_MS = 20_000;
const READY_POLL_INTERVAL_MS = 50;
const SIGTERM_GRACE_MS = 1500;
const HARD_KILL_WAIT_MS = 3000;

function log(tag, message) {
  console.log(`${tag} ${message}`);
}

/**
 * Spawn `node --env-file=.env --experimental-strip-types src/server/boot.ts`
 * so the production runtime path is taken (MEMORY_STUDIO_CATALOG_DB_PATH
 * is set in .env → boot.ts opens the on-disk DB and enters MODE=production).
 *
 * Returns the child + the captured stdout/stderr buffers. The caller
 * is responsible for cleanup via killChild().
 */
function spawnServer() {
  const child = spawn(
    process.execPath,
    [
      '--env-file=.env',
      '--experimental-strip-types',
      '--no-warnings',
      'src/server/boot.ts',
    ],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const buffers = { stdout: '', stderr: '' };
  child.stdout.on('data', (chunk) => {
    buffers.stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    buffers.stderr += chunk.toString('utf8');
  });

  return { child, buffers };
}

/**
 * Poll stdout for the `[boot] runtime MODE=production` line. This is
 * the deterministic signal that the on-disk DB was opened AND the
 * production preflight (state + catalog dir + model) cleared.
 *
 * Returns { ok, url, reason }.
 */
async function waitForProductionBoot(child, buffers) {
  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      return {
        ok: false,
        reason: `child-exited-early-code-${child.exitCode}`,
      };
    }
    const urlMatch = buffers.stdout.match(/Memory Studio augment server: (http:\/\/127\.0\.0\.1:\d+)/);
    const modeMatch = buffers.stdout.match(/\[boot\] runtime MODE=(\w+)/);
    if (urlMatch && modeMatch && modeMatch[1] === 'production') {
      return { ok: true, url: urlMatch[1] };
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  return { ok: false, reason: 'boot-timeout' };
}

/**
 * Windows-safe cleanup. Mirrors scripts/smoke-server-boot.mjs so the
 * failure modes (cmd.exe wrapper not forwarding SIGTERM, zombie
 * listeners) are identical across smokes.
 */
async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // best-effort
  }
  const sigtermStart = Date.now();
  while (child.exitCode === null && Date.now() - sigtermStart < SIGTERM_GRACE_MS) {
    await sleep(50);
  }
  if (child.exitCode !== null) return;

  if (process.platform === 'win32') {
    try {
      const { spawn: spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      // best-effort
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      // best-effort
    }
  }

  const hardStart = Date.now();
  while (child.exitCode === null && Date.now() - hardStart < HARD_KILL_WAIT_MS) {
    await sleep(20);
  }
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`${url} returned non-JSON body: ${body.slice(0, 200)}`);
  }
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${url} returned HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`POST ${url} returned non-JSON body: ${text.slice(0, 200)}`);
  }
}

/**
 * Build a /augment request that matches the Phase 7b schema and
 * targets `skill-typescript-strict` — a real catalog entry whose
 * title and text are about TypeScript strict mode. The prompt
 * vocabulary aligns with the skill's body ("strict null checks",
 * "noImplicitAny") so the cosine similarity clears the runtime
 * threshold AND the FTS5 channel returns a hit. The smoke
 * asserts the skill shows up in `matchedSkills` — a regression
 * in the schema (e.g. FTS table renamed) or the pipeline (e.g.
 * threshold misread) makes that assertion fail.
 *
 * Why not a longer prompt: with too many overlapping concepts
 * (procedural steps + every keyword jammed in), the multilingual-
 * e5-small embedder drifts and `skill-typescript-strict` may drop
 * below threshold. The current prompt is intentionally short and
 * keyword-dense — the same vocabulary that triggers FTS.
 */
function buildAugmentRequest() {
  return {
    prompt:
      'TypeScript strict null checks noImplicitAny refactoring procedure',
    context: null,
    fingerprint: {
      projectPath: '/tmp/memory-studio-e2e-smoke',
      agentId: 'claude-code',
      sessionId: `smoke-e2e-${Date.now()}`,
      gitBranch: 'main',
    },
    activeCatalog: ['skill-typescript-strict'],
    tenantId: 'tenant-smoke-e2e',
    schemaVersion: 3,
  };
}

const failures = [];
const checks = [];

function recordCheck(name, ok, observed) {
  checks.push({ name, ok, observed });
  if (ok) {
    log('[PASS]', `${name} (${observed})`);
  } else {
    log('[FAIL]', `${name} (${observed})`);
    failures.push(name);
  }
}

const { child, buffers } = spawnServer();

try {
  // 1. Wait for production-mode boot line.
  const boot = await waitForProductionBoot(child, buffers);
  if (!boot.ok) {
    recordCheck('production-boot', false, boot.reason ?? 'unknown');
    console.error('--- server stdout ---');
    console.error(buffers.stdout);
    console.error('--- server stderr ---');
    console.error(buffers.stderr);
    await killChild(child);
    process.exit(1);
  }
  recordCheck('production-boot', true, `${boot.url} MODE=production`);

  // 2. GET /health → assert catalog.count >= 1.
  let healthBody;
  try {
    healthBody = await getJson(`${boot.url}/health`);
  } catch (err) {
    recordCheck('health-fetch', false, err instanceof Error ? err.message : String(err));
    console.error('--- server stdout ---');
    console.error(buffers.stdout);
    console.error('--- server stderr ---');
    console.error(buffers.stderr);
    await killChild(child);
    process.exit(1);
  }
  recordCheck('health-status-ok', healthBody.status === 'ok', `status=${healthBody.status}`);
  recordCheck(
    'health-catalog-count>=1',
    typeof healthBody.catalog?.count === 'number' && healthBody.catalog.count >= 1,
    `count=${healthBody.catalog?.count}`,
  );

  // 3. POST /augment → assert matchedSkills has >= 1 entry.
  let augmentBody;
  try {
    augmentBody = await postJson(`${boot.url}/augment`, buildAugmentRequest());
  } catch (err) {
    recordCheck('augment-fetch', false, err instanceof Error ? err.message : String(err));
    console.error('--- server stdout ---');
    console.error(buffers.stdout);
    console.error('--- server stderr ---');
    console.error(buffers.stderr);
    await killChild(child);
    process.exit(1);
  }
  recordCheck(
    'augment-matched-skills-non-empty',
    Array.isArray(augmentBody.matchedSkills) && augmentBody.matchedSkills.length >= 1,
    `matchedSkills.length=${augmentBody.matchedSkills?.length ?? 'n/a'}`,
  );
  if (
    Array.isArray(augmentBody.matchedSkills) && augmentBody.matchedSkills.length >= 1
  ) {
    const ids = augmentBody.matchedSkills.map((m) => m.id).join(',');
    recordCheck(
      'augment-includes-typescript-strict',
      augmentBody.matchedSkills.some((m) => m.id === 'skill-typescript-strict'),
      `ids=${ids}`,
    );
  }
  recordCheck(
    'augment-schema-version-3',
    augmentBody.schemaVersion === 3,
    `schemaVersion=${augmentBody.schemaVersion}`,
  );

  if (failures.length > 0) {
    log('[FAIL]', `smoke FAILED: ${failures.length} check(s) out of ${checks.length}`);
    console.error('--- server stdout (last 80 lines) ---');
    const tail = buffers.stdout.split('\n').slice(-80).join('\n');
    console.error(tail);
    console.error('--- server stderr (last 80 lines) ---');
    const errTail = buffers.stderr.split('\n').slice(-80).join('\n');
    console.error(errTail);
    await killChild(child);
    process.exit(1);
  }

  log('[PASS]', `smoke: ${checks.length}/${checks.length} checks green`);
  log('[INFO]', `e2e smoke complete — DB schema + retrieval pipeline aligned`);
  await killChild(child);
  process.exit(0);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  log('[FAIL]', `smoke crashed: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  console.error('--- server stdout ---');
  console.error(buffers.stdout);
  console.error('--- server stderr ---');
  console.error(buffers.stderr);
  await killChild(child);
  process.exit(2);
}
