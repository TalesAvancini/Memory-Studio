/**
 * E2E route integration test (Phase 5a.4 T-13).
 *
 * Boots the actual `src/server/boot.ts` entry point as a child process
 * (mirrors `scripts/smoke-server-boot.mjs` exactly), sends 7+
 * end-to-end `/augment` requests covering the AC-NN criteria from
 * spec.md, asserts the server stays up under 10× concurrent load,
 * and cleans up the child process on Windows / POSIX.
 *
 * What this test does NOT do (deliberately):
 *   - Does NOT exercise the byte-string SHA-256 equality / stability
 *     contract — that's `byte-string-equality.test.mjs` (T-09).
 *   - Does NOT measure latency — that's `perf.test.mjs` (T-12).
 *   - Does NOT verify the provider cache hit stub — that's
 *     `scripts/smoke-augment-server.mjs` (T-11).
 *
 * The test is end-to-end in the sense that it spawns the production
 * entry script (`src/server/boot.ts`) and POSTs to the bound URL — a
 * regression in the entry-point guard, the `Memory Studio augment
 * server: ...` log line, or the route handler would all fail here.
 *
 * Pinned port: `MEMORY_STUDIO_AUGMENT_PORT_RANGE=43900-43900` pins a
 * single port. This also exercises the env-var wiring from LOW 3a.
 *
 * Cleanup: Windows uses `taskkill /F /T /PID` (same pattern as
 * `scripts/smoke-server-boot.mjs:125-148` / FT-02). POSIX uses SIGKILL
 * on the direct child. Both paths bounded by a hard timeout so a
 * stuck child can't hang the suite.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';

// --- Constants -------------------------------------------------------------

const BOOT_TIMEOUT_MS = 8000;
const READY_POLL_INTERVAL_MS = 50;
const KILL_TIMEOUT_MS = 1500;
const HARD_TIMEOUT_MS = 3000;
// Pinned port range for the E2E test. Picked in the 44xxx block to
// avoid collision with the other augment tests:
//   - test/server/smoke.test.mjs       uses DEFAULT_AUGMENT_PORT_RANGE [42900, 43000]
//   - test/server/smoke-boot.test.mjs  pins [42900, 42900] for the child
//   - test/augment/byte-string-equality.test.mjs advances through 43700-43747
//   - test/augment/perf.test.mjs       pins [43900, 43999]
// The E2E test spawns boot.ts (the production entry point) as a
// child process, so the port range is forwarded via the
// MEMORY_STUDIO_AUGMENT_PORT_RANGE env var (LOW 3a follow-up).
const PINNED_PORT = 44900;
const PINNED_PORT_RANGE = `${PINNED_PORT}-${PINNED_PORT}`;

/** Concurrency for the load test (R-22). */
const CONCURRENT_LOAD = 10;

/** Per-request timeout. */
const REQUEST_TIMEOUT_MS = 5000;

// --- Fixture request (happy path) ------------------------------------------

const VALID_PROMPT =
  'design a fastify endpoint that validates authentication tokens securely';

function baseRequest(overrides = {}) {
  return {
    prompt: VALID_PROMPT,
    context: null,
    fingerprint: {
      projectPath: '/tmp/route-e2e',
      agentId: 'claude-code',
      sessionId: 'route-e2e-session-001',
      gitBranch: 'main',
    },
    activeCatalog: ['skill-auth', 'rule-no-secrets', 'persona-engineer'],
    tenantId: 'tenant-route-e2e',
    schemaVersion: 3,
    ...overrides,
  };
}

// --- Test scaffolding: spawn + cleanup -------------------------------------

/** Captured server handle for the duration of the suite. */
let serverChild = null;
let serverUrl = null;

/**
 * Spawn `node --experimental-strip-types src/server/boot.ts` with the
 * pinned port range. Polls stdout for the bound URL, then resolves.
 * The function throws if the child exits early or boot times out.
 */
async function bootServer() {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'src/server/boot.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_STUDIO_AUGMENT_PORT_RANGE: PINNED_PORT_RANGE,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  let url = null;
  const bootStart = Date.now();
  while (Date.now() - bootStart < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(
        `child exited early with code ${child.exitCode}; stderr=${stderr}; stdout=${stdout}`,
      );
    }
    const match = stdout.match(
      /Memory Studio augment server: (http:\/\/127\.0\.0\.1:\d+)/,
    );
    if (match) {
      url = match[1];
      break;
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }
  if (!url) {
    await killChild(child);
    throw new Error(
      `boot timeout after ${BOOT_TIMEOUT_MS}ms; stderr=${stderr}; stdout=${stdout}`,
    );
  }
  // The child bound the URL we asked for — sanity check that the
  // MEMORY_STUDIO_AUGMENT_PORT_RANGE env var wiring works.
  const actualPort = Number(new URL(url).port);
  if (actualPort !== PINNED_PORT) {
    await killChild(child);
    throw new Error(
      `expected pinned port ${PINNED_PORT} (env var honored), got ${actualPort}`,
    );
  }
  return { child, url, stdout, stderr };
}

/** Best-effort Windows-safe child termination. */
async function killChild(child) {
  if (!child || child.exitCode !== null) return;

  // 1) Polite SIGTERM first.
  try {
    child.kill('SIGTERM');
  } catch {
    /* best-effort */
  }
  const sigtermStart = Date.now();
  while (child.exitCode === null && Date.now() - sigtermStart < KILL_TIMEOUT_MS) {
    await sleep(50);
  }
  if (child.exitCode !== null) return;

  // 2) Hard kill. Windows needs `taskkill /F /T` to release the
  //    bound listener (FT-02). POSIX can SIGKILL the direct child.
  if (process.platform === 'win32') {
    try {
      const { spawn: spawnSync } = await import('node:child_process');
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      /* best-effort */
    }
  } else {
    try {
      child.kill('SIGKILL');
    } catch {
      /* best-effort */
    }
  }

  // 3) Bounded post-kill wait.
  const hardStart = Date.now();
  while (child.exitCode === null && Date.now() - hardStart < HARD_TIMEOUT_MS) {
    await sleep(20);
  }
}

/** POST a JSON body to `/augment`. Aborts on slow responses. */
async function postAugment(payload) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${serverUrl}/augment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _parseError: true, _raw: text };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// --- Suite lifecycle -------------------------------------------------------

before(async () => {
  const handle = await bootServer();
  serverChild = handle.child;
  serverUrl = handle.url;
});

after(async () => {
  if (serverChild) await killChild(serverChild);
});

// --- Tests -----------------------------------------------------------------

/**
 * Sanity check that the server is actually reachable on the pinned
 * port and serves a valid `/health` response. (T-11 smoke covers
 * this in detail; here we just confirm boot succeeded end-to-end.)
 */
test('route-e2e: server bound on pinned port 44900 (env var honored)', async () => {
  assert.equal(serverUrl, `http://127.0.0.1:${PINNED_PORT}`);
  const res = await fetch(`${serverUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('route-e2e: validation 400 when prompt is missing', async () => {
  const req = baseRequest();
  delete req.prompt;
  const { status, body } = await postAugment(req);
  assert.equal(status, 400, `expected 400, got ${status}`);
  assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
  assert.equal(body.error.field, 'prompt');
});

test('route-e2e: validation 400 when schemaVersion is not 3', async () => {
  const req = baseRequest({ schemaVersion: 4 });
  const { status, body } = await postAugment(req);
  assert.equal(status, 400, `expected 400, got ${status}`);
  assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
  assert.equal(body.error.field, 'schemaVersion');
});

test('route-e2e: validation 400 when fingerprint.agentId is non-canonical (cursor)', async () => {
  // R-06 (Phase 5b T-11): the schema now restricts agentId to the literal
  // "claude-code" via z.literal. Any other value returns 400 with the
  // custom errorMap message. This test REPLACES the Phase 5a.4 substitute
  // (which asserted on a missing fingerprint) with the spec-correct case.
  const req = baseRequest({ fingerprint: {
    projectPath: '.',
    agentId: 'cursor',
    sessionId: 'r06-cursor',
    gitBranch: 'main',
  }});
  const { status, body } = await postAugment(req);
  assert.equal(status, 400, `expected 400, got ${status}`);
  assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
  assert.equal(body.error.field, 'fingerprint.agentId');
  assert.match(body.error.message, /agentId must be one of: claude-code/);
});

test('route-e2e: validation 400 when fingerprint.agentId is missing', async () => {
  const req = baseRequest();
  const { agentId: _ignored, ...fpWithoutAgentId } = req.fingerprint;
  req.fingerprint = fpWithoutAgentId;
  const { status, body } = await postAugment(req);
  assert.equal(status, 400, `expected 400, got ${status}`);
  assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
  assert.equal(body.error.field, 'fingerprint.agentId');
  assert.match(body.error.message, /agentId must be one of: claude-code/);
});

test('route-e2e: validation 400 when activeCatalog is missing', async () => {
  const req = baseRequest();
  delete req.activeCatalog;
  const { status, body } = await postAugment(req);
  assert.equal(status, 400, `expected 400, got ${status}`);
  assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
  assert.equal(body.error.field, 'activeCatalog');
});

test('route-e2e: happy path 200 returns valid systemMessage SHA-256 + decisionTraceId', async () => {
  const req = baseRequest();
  const { status, body } = await postAugment(req);
  assert.equal(status, 200, `expected 200, got ${status}; body=${JSON.stringify(body)}`);
  // systemMessage is a 64-char lowercase hex SHA-256 (D-006 / R-12).
  assert.equal(typeof body.systemMessage, 'string');
  assert.match(
    body.systemMessage,
    /^[0-9a-f]{64}$/,
    `systemMessage must be a SHA-256 hex digest; got ${body.systemMessage}`,
  );
  // decisionTraceId is a UUID v4 (PRD §7.1).
  assert.match(
    body.decisionTraceId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    `decisionTraceId must be UUID v4; got ${body.decisionTraceId}`,
  );
  // latencyMs.total is a non-negative number.
  assert.ok(
    typeof body.latencyMs.total === 'number' && body.latencyMs.total >= 0,
    `latencyMs.total must be a non-negative number; got ${body.latencyMs.total}`,
  );
  assert.equal(body.schemaVersion, 3);
  // Cross-check: the SHA must differ from a fresh hash of an empty
  // string. A regression that returns a constant would slip past the
  // SHA format assertion above.
  assert.notEqual(
    body.systemMessage,
    createHash('sha256').update('', 'utf8').digest('hex'),
    'systemMessage must not be the SHA-256 of an empty string',
  );
});

test('route-e2e: activeCatalog: [] returns 200 with emptyReason "no_active_items"', async () => {
  const req = baseRequest({ activeCatalog: [] });
  const { status, body } = await postAugment(req);
  assert.equal(status, 200, `expected 200, got ${status}`);
  assert.equal(body.emptyReason, 'no_active_items');
  assert.deepEqual(body.matchedSkills, []);
  assert.deepEqual(body.matchedRules, []);
  assert.deepEqual(body.matchedPersonas, []);
  assert.ok(
    Array.isArray(body.warnings) &&
      body.warnings.some((w) => w.includes('activeCatalog is empty')),
    `expected the activeCatalog warning; got ${JSON.stringify(body.warnings)}`,
  );
  // systemMessage is still a SHA-256 (D-006 invariant).
  assert.match(body.systemMessage, /^[0-9a-f]{64}$/);
});

test('route-e2e: context: null returns 200 (prompt-only mode, R-03 / R-17)', async () => {
  const req = baseRequest({ context: null });
  const { status, body } = await postAugment(req);
  assert.equal(status, 200, `expected 200, got ${status}`);
  // No mandatory `emptyReason` — prompt-only is a valid mode.
  assert.ok(
    body.emptyReason === null ||
      body.emptyReason === 'low_confidence' ||
      body.emptyReason === undefined,
    `prompt-only mode permits emptyReason in {null, undefined, low_confidence}; got ${body.emptyReason}`,
  );
  // systemMessage is a SHA-256 hex (D-006 invariant).
  assert.match(body.systemMessage, /^[0-9a-f]{64}$/);
});

test('route-e2e: 10 concurrent /augment requests — server stays up, all return 200', async () => {
  const req = baseRequest({
    sessionId: `route-e2e-concurrent-${Date.now()}`,
  });
  const responses = await Promise.all(
    Array.from({ length: CONCURRENT_LOAD }, () => postAugment(req)),
  );
  // All requests must complete with 200.
  for (let i = 0; i < responses.length; i += 1) {
    const { status, body } = responses[i];
    assert.equal(
      status,
      200,
      `concurrent request ${i} returned ${status}; body=${JSON.stringify(body)}`,
    );
    assert.match(
      body.systemMessage,
      /^[0-9a-f]{64}$/,
      `concurrent request ${i} systemMessage not a SHA-256 hex; got ${body.systemMessage}`,
    );
  }
  // Server is still up after the burst — sanity-check /health.
  const health = await fetch(`${serverUrl}/health`);
  assert.equal(health.status, 200, 'server must still serve /health after concurrent burst');
});

test('route-e2e: identical request → identical systemMessage SHA-256 (sanity echo of T-09)', async () => {
  // Sanity echo of the T-09 byte-string equality contract, but
  // against the boot.ts-spawned child process (so we cover the full
  // entry-point + module-graph path). 2 calls is enough — T-09 already
  // proves 1000-call stability.
  const req = baseRequest({
    sessionId: 'route-e2e-echo',
  });
  const r1 = await postAugment(req);
  const r2 = await postAugment(req);
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(
    r1.body.systemMessage,
    r2.body.systemMessage,
    'identical request must produce identical systemMessage SHA-256',
  );
});
