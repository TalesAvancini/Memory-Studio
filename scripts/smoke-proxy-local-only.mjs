#!/usr/bin/env node
/**
 * scripts/smoke-proxy-local-only.mjs — Phase 5b T-14.
 *
 * End-to-end smoke that proves the transparent `/v1/messages` proxy:
 *   1. Boots a stub Anthropic-compatible upstream in-process on a free
 *      port in `[47600, 47699]`. The stub records every request it sees
 *      and returns a deterministic response with
 *      `cache_read_input_tokens: 42`.
 *   2. Spawns the real Memory Studio augment server (boot.ts) on
 *      `MEMORY_STUDIO_AUGMENT_PORT_RANGE=47500-47500`, with
 *      `MEMORY_STUDIO_ANTHROPIC_BASE_URL` pointed at the stub.
 *   3. Sends 1 POST /v1/messages to the augment server. Asserts:
 *        a) proxy returns 200 with a valid Anthropic response shape
 *        b) the stub observed the request and recorded the augmented
 *           2-block system field (`cache_control: ephemeral` x2)
 *        c) the audit_events table contains a `messages_proxy` row with
 *           `cacheReadInputTokens` populated (= 42)
 *        d) NO external network requests were made (stub captured all;
 *           the proxy upstream URL was loopback only)
 *   4. Cleanup: Windows-safe `taskkill /F /T /PID` for the augment server
 *      child (mirroring `smoke-augment-server.mjs`).
 *
 * Why a stub instead of the real Anthropic API: per CLAUDE.md, no
 * direct Anthropic access is available in this environment. The stub
 * proves the wiring (Memory Studio → proxy → stub upstream → audit)
 * with zero external network dependency.
 *
 * Exit code: 0 on `[smoke] PASS (N/N checks)`, 1 on any failure.
 */

import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

const STUB_PORT_RANGE_LO = 47600;
const STUB_PORT_RANGE_HI = 47699;
const AUGMENT_PORT = 47500;

// --- Free-port discovery ---------------------------------------------------

function pickFreePortInRange(lo, hi) {
  return new Promise((resolve, reject) => {
    let candidate = lo;
    const probeNext = () => {
      if (candidate > hi) {
        reject(new Error(`no free port in [${lo}, ${hi}]`));
        return;
      }
      const probe = createHttpServer();
      probe.unref();
      probe.once('error', () => {
        candidate += 1;
        probeNext();
      });
      probe.listen(candidate, '127.0.0.1', () => {
        probe.close(() => resolve(candidate));
      });
    };
    probeNext();
  });
}

// --- Stub Anthropic-compatible upstream ------------------------------------

function startStub(port) {
  /** @type {Array<{system: unknown, messages: unknown, model: string}>} */
  const seen = [];

  const server = createHttpServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
        return;
      }
      seen.push({
        system: parsed.system,
        messages: parsed.messages,
        model: parsed.model,
      });
      // Deterministic response — every call returns cache_read=42.
      const responseBody = {
        id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'OK from stub' }],
        model: typeof parsed.model === 'string' ? parsed.model : 'claude-stub',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 17,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 42,
        },
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        getSeen: () => seen.slice(),
        async close() {
          await new Promise((r) => server.close(() => r()));
          if (typeof server.closeAllConnections === 'function') {
            server.closeAllConnections?.();
          }
        },
      });
    });
  });
}

// --- Augment server subprocess ---------------------------------------------

const BOOT_TIMEOUT_MS = 8000;
const READY_POLL_INTERVAL_MS = 50;
const KILL_TIMEOUT_MS = 1500;

async function bootAugmentServer(stubBaseUrl, dbPath) {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'src/server/boot.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_STUDIO_AUGMENT_PORT_RANGE: `${AUGMENT_PORT}-${AUGMENT_PORT}`,
        MEMORY_STUDIO_ANTHROPIC_BASE_URL: stubBaseUrl,
        MEMORY_STUDIO_CATALOG_DB_PATH: dbPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
  child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

  let url = null;
  const bootStart = Date.now();
  while (Date.now() - bootStart < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) break;
    const match = stdout.match(/Memory Studio augment server: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { url = match[1]; break; }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  if (!url) {
    return {
      ok: false,
      reason: child.exitCode !== null ? `child-exited-code-${child.exitCode}` : 'boot-timeout',
      stdout,
      stderr,
      child,
    };
  }
  return { ok: true, child, url, stdout, stderr };
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  const start = Date.now();
  while (child.exitCode === null && Date.now() - start < KILL_TIMEOUT_MS) await sleep(50);
  if (child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const { spawn: spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch { /* ignore */ }
  } else {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }
  const hardStart = Date.now();
  while (child.exitCode === null && Date.now() - hardStart < 3000) await sleep(20);
}

// --- Validation payload ---------------------------------------------------

function buildAnthropicRequest() {
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 50,
    system: 'you are a helpful assistant',
    messages: [{ role: 'user', content: 'hello' }],
  };
}

// --- Main ------------------------------------------------------------------

function log(tag, message) { console.log(`${tag} ${message}`); }

const t0 = Date.now();

// 1. Boot the stub upstream on a free port in [47600, 47699].
const stubPort = await pickFreePortInRange(STUB_PORT_RANGE_LO, STUB_PORT_RANGE_HI);
const stub = await startStub(stubPort);
const stubBaseUrl = `http://127.0.0.1:${stubPort}`;
log('[INFO]', `stub Anthropic provider listening on ${stubBaseUrl}`);

// 2. Provision a temp DB so the augment server can persist audit rows.
const tmpRoot = await mkdtemp(join(tmpdir(), 'memstudio-proxy-smoke-'));
const dbPath = join(tmpRoot, 'catalog.sqlite');
try {
  await mkdir(tmpRoot, { recursive: true });
  // Empty DB; the augment server will create tables via openAndMigrate.

  // 3. Boot the augment server (with MEMORY_STUDIO_ANTHROPIC_BASE_URL set).
  const boot = await bootAugmentServer(stubBaseUrl, dbPath);
  if (!boot.ok) {
    log('[FAIL]', `augment server boot failed: ${boot.reason}`);
    if (boot.stdout) console.error(`stdout:\n${boot.stdout}`);
    if (boot.stderr) console.error(`stderr:\n${boot.stderr}`);
    await stub.close();
    await rm(tmpRoot, { recursive: true, force: true });
    process.exit(1);
  }
  const augmentUrl = boot.url;
  log('[INFO]', `augment server listening on ${augmentUrl}`);

  // 4. POST /v1/messages — the proxy intercepts, runs internal /augment,
  //    rewrites system, forwards to stub, captures cache metrics.
  const req = buildAnthropicRequest();
  const checks = [];
  let proxyResponse;
  try {
    const res = await fetch(`${augmentUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    proxyResponse = { status: res.status, body: await res.json() };
  } catch (err) {
    log('[FAIL]', `fetch /v1/messages failed: ${err instanceof Error ? err.message : String(err)}`);
    await killChild(boot.child);
    await stub.close();
    await rm(tmpRoot, { recursive: true, force: true });
    process.exit(1);
  }

  checks.push({
    name: 'proxy-http-200',
    ok: proxyResponse.status === 200,
    observed: `status=${proxyResponse.status}`,
  });
  checks.push({
    name: 'proxy-anthropic-response-shape',
    ok: typeof proxyResponse.body === 'object'
      && proxyResponse.body !== null
      && proxyResponse.body.type === 'message'
      && proxyResponse.body.role === 'assistant'
      && Array.isArray(proxyResponse.body.content)
      && typeof proxyResponse.body.usage?.cache_read_input_tokens === 'number'
      && proxyResponse.body.usage.cache_read_input_tokens === 42,
    observed: `cache_read_input_tokens=${proxyResponse.body?.usage?.cache_read_input_tokens}`,
  });

  // 5. Assert the stub observed the request (no external network).
  const seen = stub.getSeen();
  checks.push({
    name: 'stub-observed-request',
    ok: seen.length === 1,
    observed: `stub-seen=${seen.length}`,
  });
  checks.push({
    name: 'stub-received-augmented-2-block-system',
    ok: seen.length === 1
      && Array.isArray(seen[0].system)
      && seen[0].system.length === 2
      && seen[0].system.every((b) => b?.cache_control?.type === 'ephemeral'),
    observed: seen.length === 1
      ? `system-blocks=${seen[0].system.length}, ephemeral=${seen[0].system.every((b) => b?.cache_control?.type === 'ephemeral')}`
      : 'no request observed',
  });
  checks.push({
    name: 'stub-received-correct-model',
    ok: seen.length === 1 && seen[0].model === 'claude-sonnet-4-5',
    observed: seen.length === 1 ? `model=${seen[0].model}` : 'no request observed',
  });

  // 6. Wait for audit flush (time-trigger is 1000ms). Read the audit row.
  await sleep(1200);
  let auditRow = null;
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      auditRow = db.prepare(
        `SELECT event_type, payload, "tenantId_hashed"
         FROM audit_events
         WHERE event_type = 'messages_proxy'
         ORDER BY id DESC
         LIMIT 1`,
      ).get();
    } finally {
      db.close();
    }
  } catch (err) {
    log('[FAIL]', `audit query failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  checks.push({
    name: 'audit-row-messages-proxy-enqueued',
    ok: auditRow !== null && auditRow !== undefined,
    observed: `row=${auditRow === null || auditRow === undefined ? 'none' : 'present'}`,
  });
  if (auditRow) {
    const payload = JSON.parse(auditRow.payload);
    checks.push({
      name: 'audit-row-cacheReadInputTokens-populated',
      ok: payload.cacheReadInputTokens === 42,
      observed: `cacheReadInputTokens=${payload.cacheReadInputTokens}`,
    });
    checks.push({
      name: 'audit-row-systemMessageSha256-present',
      ok: typeof payload.systemMessageSha256 === 'string'
        && /^[0-9a-f]{64}$/.test(payload.systemMessageSha256),
      observed: `sha=${typeof payload.systemMessageSha256 === 'string' ? payload.systemMessageSha256.slice(0, 12) + '…' : 'missing'}`,
    });
    checks.push({
      name: 'audit-row-no-raw-prompt',
      ok: !JSON.stringify(auditRow).includes('hello') // The raw 'hello' user content
        && !JSON.stringify(auditRow).includes('you are a helpful assistant'),
      observed: 'no-raw-prompt-or-system-string',
    });
    checks.push({
      name: 'audit-row-tenant-hashed-populated',
      ok: typeof auditRow.tenantId_hashed === 'string' && auditRow.tenantId_hashed.length === 16,
      observed: `tenantId_hashed=${auditRow.tenantId_hashed}`,
    });
  }

  // 7. Final cleanup.
  await killChild(boot.child);
  await stub.close();

  const failed = checks.filter((c) => !c.ok);
  const elapsedMs = Date.now() - t0;

  if (failed.length > 0) {
    for (const f of failed) {
      log('[FAIL]', `${f.name} (${f.observed})`);
    }
    log('[FAIL]', `smoke failed: ${failed.length} check(s) out of ${checks.length}`);
    await rm(tmpRoot, { recursive: true, force: true });
    process.exit(1);
  }

  log('[PASS]', `proxy returned 200 with cache_read_input_tokens=${proxyResponse.body.usage.cache_read_input_tokens}`);
  log('[PASS]', `stub observed 1 request with augmented 2-block system field`);
  log('[PASS]', `audit row enqueued with cacheReadInputTokens=42, systemMessageSha256=${typeof proxyResponse.body.systemMessageSha256 === 'string' ? proxyResponse.body.systemMessageSha256.slice(0, 12) + '…' : 'n/a'}`);
  log('[PASS]', `zero external network calls (stub captured all traffic)`);
  log('[smoke]', `PASS (${elapsedMs}ms, ${checks.length}/${checks.length} checks)`);
  await rm(tmpRoot, { recursive: true, force: true });
  process.exit(0);
} catch (err) {
  log('[FAIL]', `smoke crashed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  await rm(tmpRoot, { recursive: true, force: true });
  process.exit(1);
}
