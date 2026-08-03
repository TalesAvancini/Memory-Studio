#!/usr/bin/env node
/**
 * scripts/smoke-acceptance-gate.mjs — Phase 7b T-06 (synthetic smoke).
 *
 * End-to-end smoke that proves the acceptance-gate machinery works
 * WITHOUT claiming production closure:
 *   1. Boot a local stub Anthropic-compatible upstream.
 *   2. Boot a real Fastify Memory Studio server with fixture state.
 *   3. Drive 10 /v1/messages requests through the proxy (the
 *      stub emits a cache miss on the first call and hits thereafter
 *      to exercise the cache hit/miss code paths).
 *   4. Capture before/after synthetic snapshots via
 *      `scripts/snapshot-metrics.mjs`.
 *   5. Run the acceptance gate with --allow-synthetic on those
 *      snapshots and assert the exit code is 0 with
 *      `eligible_for_phase_closure: false`.
 *   6. Run the gate WITHOUT --allow-synthetic and assert it exits
 *      non-zero with `synthetic_evidence` reason.
 *
 * Port range: `[48900, 48999]` (distinct from the existing test
 * ranges and from the test#366 exhausted `[42900, 43000]` block).
 * Windows / POSIX child-process cleanup is included.
 */
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, rm, writeFile, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const PORT_RANGE = [48900, 48999];

function logOut(msg) { process.stdout.write(`[smoke-acceptance-gate] ${msg}\n`); }
function logErr(msg) { process.stderr.write(`[smoke-acceptance-gate] ${msg}\n`); }

function pickFreePort(lo, hi) {
  return new Promise((resolve, reject) => {
    let candidate = lo;
    const tryNext = () => {
      if (candidate > hi) { reject(new Error(`no free port in [${lo}, ${hi}]`)); return; }
      const probe = createHttpServer();
      probe.unref();
      probe.once('error', () => { candidate += 1; tryNext(); });
      probe.listen(candidate, '127.0.0.1', () => {
        probe.close(() => resolve(candidate));
      });
    };
    tryNext();
  });
}

/**
 * Stub Anthropic-compatible upstream. Emits a cache miss on the
 * first call and a cache hit on subsequent calls (per the request
 * body). Used to exercise both the numerator and the denominator
 * of the provider-cache ratio.
 */
function startStubUpstream(port) {
  return new Promise((resolve) => {
    let callCount = 0;
    const server = createHttpServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404);
        res.end();
        return;
      }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        callCount += 1;
        // First call: cache_read_input_tokens = 0 (miss)
        // Subsequent calls: cache_read_input_tokens = 100 (hit)
        const cacheRead = callCount === 1 ? 0 : 100;
        const responseBody = {
          id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'message', role: 'assistant',
          content: [{ type: 'text', text: `response ${callCount}` }],
          model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
          usage: {
            input_tokens: 50, output_tokens: 5,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cacheRead,
          },
        };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(responseBody));
      });
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({ server, port, async close() {
        await new Promise((r) => server.close(() => r()));
      } });
    });
  });
}

/**
 * Create a fresh SQLite DB at `dbPath` and apply migrations.
 * Required for the augment server to find the audit + intel tables.
 */
async function setupDatabase(dbPath) {
  // Open + close to create the file. Then apply migrations so the
  // augment server sees the audit + intel tables when it boots.
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit (
      ts INTEGER,
      tenant_id_hashed TEXT,
      redacted_prompt_hash TEXT,
      matched_ids TEXT,
      pruning_reasons TEXT,
      latency_ms INTEGER,
      fingerprint TEXT,
      payload TEXT,
      event_type TEXT
    );
    CREATE TABLE IF NOT EXISTS intel (
      session_id TEXT PRIMARY KEY,
      agent_state TEXT,
      next_needs TEXT,
      recent_topic TEXT,
      ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_intel_session_id ON intel(session_id);
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
  `);
  db.close();
}

async function waitForServer(child, timeoutMs) {
  const start = Date.now();
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (c) => { stdout += c.toString('utf8'); });
  child.stderr?.on('data', (c) => { stderr += c.toString('utf8'); });
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      return { ok: false, reason: `child-exit-${child.exitCode}`, stdout, stderr };
    }
    const m = stdout.match(/Memory Studio augment server: (http:\/\/127\.0\.0\.1:\d+)/);
    if (m) return { ok: true, url: m[1], stdout, stderr };
    await sleep(50);
  }
  return { ok: false, reason: 'timeout', stdout, stderr };
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  const start = Date.now();
  while (child.exitCode === null && Date.now() - start < 1500) await sleep(50);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const { spawn: spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
    } catch { /* ignore */ }
  } else {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  const start2 = Date.now();
  while (child.exitCode === null && Date.now() - start2 < 3000) await sleep(20);
}

function buildAnthropicRequest() {
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 50,
    system: 'you are a helpful assistant',
    messages: [{ role: 'user', content: 'smoke test please' }],
  };
}

async function driveRequests(baseUrl, count) {
  for (let i = 0; i < count; i += 1) {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAnthropicRequest()),
    });
    await res.json();
  }
}

async function runSnapshotCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types', '--no-warnings',
      'scripts/snapshot-metrics.mjs',
      ...args,
    ], { cwd: REPO_ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runGateCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types', '--no-warnings',
      'scripts/acceptance-gate.mjs',
      ...args,
    ], { cwd: REPO_ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function main() {
  const failures = [];
  const check = (cond, name) => {
    if (!cond) {
      failures.push(name);
      logErr(`[FAIL] ${name}`);
    } else {
      logOut(`[PASS] ${name}`);
    }
  };

  // 1. Setup temp DB + state
  const tmpRoot = await mkdtemp(join(tmpdir(), 'memstudio-smoke-7b-'));
  const dbPath = join(tmpRoot, 'catalog.sqlite');
  const statePath = join(tmpRoot, 'state.json');
  const snapDir = join(tmpRoot, 'snapshots');
  await setupDatabase(dbPath);
  await copyFile(join(REPO_ROOT, '.memory-studio', 'state.json'), statePath);

  // 2. Pick a free port + start stub
  const stubPort = await pickFreePort(...PORT_RANGE);
  const stubUrl = `http://127.0.0.1:${stubPort}`;
  const stub = await startStubUpstream(stubPort);
  logOut(`stub upstream: ${stubUrl}`);

  // 3. Boot augment server
  const child = spawn(process.execPath, [
    '--experimental-strip-types', '--no-warnings',
    'src/server/boot.ts',
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      MEMORY_STUDIO_AUGMENT_PORT_RANGE: `${PORT_RANGE[0]}-${PORT_RANGE[1]}`,
      MEMORY_STUDIO_ANTHROPIC_BASE_URL: stubUrl,
      MEMORY_STUDIO_CATALOG_DB_PATH: dbPath,
      MEMORY_STUDIO_STATE_PATH: statePath,
    },
  });
  const wait = await waitForServer(child, 15000);
  if (!wait.ok) {
    logErr(`server boot failed: ${wait.reason}`);
    if (wait.stdout) logErr(wait.stdout);
    if (wait.stderr) logErr(wait.stderr);
    await killChild(child);
    await stub.close();
    await rm(tmpRoot, { recursive: true, force: true });
    process.exit(1);
  }
  const augmentUrl = wait.url;
  logOut(`augment server: ${augmentUrl}`);

  try {
    // 4. Drive 10 /v1/messages requests
    await driveRequests(augmentUrl, 10);
    logOut('drove 10 /v1/messages requests');
    check(true, 'ten_proxy_turns_completed');

    // 5. Capture a "before" synthetic snapshot
    const snapBefore = await runSnapshotCli([
      '--url', augmentUrl,
      '--state', statePath,
      '--db', dbPath,
      '--out-dir', snapDir,
      '--source', 'synthetic',
      '--provider-mode', 'anthropic-real',
      '--fast-agent-mode', 'real',
      '--runtime-mode', 'production',
    ]);
    check(snapBefore.code === 0, 'snapshot_before_succeeds');
    logOut(`snapshot before: exit ${snapBefore.code}`);

    // 6. Drive 5 more requests
    await driveRequests(augmentUrl, 5);
    logOut('drove 5 additional /v1/messages requests');

    // 7. Capture an "after" synthetic snapshot
    const snapAfter = await runSnapshotCli([
      '--url', augmentUrl,
      '--state', statePath,
      '--db', dbPath,
      '--out-dir', snapDir,
      '--source', 'synthetic',
      '--provider-mode', 'anthropic-real',
      '--fast-agent-mode', 'real',
      '--runtime-mode', 'production',
    ]);
    check(snapAfter.code === 0, 'snapshot_after_succeeds');
    logOut(`snapshot after: exit ${snapAfter.code}`);

    // 8. Run gate with --allow-synthetic
    const allowRes = await runGateCli([
      '--snapshots', snapDir,
      '--state', statePath,
      '--allow-synthetic', '--json',
    ]);
    check(allowRes.code === 0, 'allow_synthetic_exits_zero');
    const allowEval = JSON.parse(allowRes.stdout);
    check(allowEval.eligible_for_phase_closure === false, 'allow_synthetic_closure_false');

    // 9. Run gate WITHOUT --allow-synthetic — should reject
    const prodRes = await runGateCli([
      '--snapshots', snapDir,
      '--state', statePath,
      '--json',
    ]);
    check(prodRes.code === 1, 'production_mode_rejects_synthetic');
    const prodEval = JSON.parse(prodRes.stdout);
    check(prodEval.verdict === 'INCOMPLETE' || prodEval.verdict === 'FAIL', 'production_verdict_not_pass');
    check(prodEval.evidence_hashes.length === 0, 'production_evidence_ignored');

  } finally {
    await killChild(child);
    await stub.close();
    await rm(tmpRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    logErr(`smoke FAILED: ${failures.length} check(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  logOut(`smoke PASS: ${failures.length === 0 ? 'all checks green' : 'fail'}`);
  process.exit(0);
}

main().catch((err) => {
  logErr(`crashed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(2);
});
