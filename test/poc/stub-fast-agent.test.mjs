/**
 * Phase 6a — Stub Fast-Agent Server tests (T-05)
 *
 * Source spec: `.specs/features/phase-6a-poc-validation/spec.md`
 * Source tasks: `.specs/features/phase-6a-poc-validation/tasks.md`
 *
 * Tests the deterministic Anthropic-compatible stub at
 * `scripts/stub-fast-agent.mjs`. The stub is the fallback path when
 * `MINIMAX_API_KEY` is unset (per spec R-06).
 *
 * Boots the stub in-process via Node's `node:child_process.spawn` (no
 * network), waits for the [_]stab health check, then exhaustively
 * exercises the wire shape.
 *
 * Cleanup: every test kills the stub child process in `after` (with
 * Windows-safe `taskkill /F /T /PID` fallback) to avoid orphan
 * listeners on the [47100, 47199] range.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STUB_SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'stub-fast-agent.mjs');

// Distinct port range from any other test (no collision with
// [42900-43000] default augment, [43100-43199] smoke-augment, [43900-43999]
// perf.test.mjs, [44000-44099] hot-path POC).
let nextPort = 47_200;
function reservePort() {
  const port = nextPort;
  nextPort += 1;
  return port;
}

// --- Helpers ---------------------------------------------------------------

async function pollHealth(port, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/_stub/health`);
      if (res.ok) {
        const body = await res.json();
        return body;
      }
    } catch {
      // not ready yet
    }
    await sleep(50);
  }
  throw new Error(`stub did not become healthy on port ${port} within ${timeoutMs}ms`);
}

async function startStub(env = {}) {
  const port = reservePort();
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', STUB_SCRIPT],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUB_PORT: String(port),
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
  child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });

  try {
    await pollHealth(port);
  } catch (err) {
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
      } catch { /* ignore */ }
    }
    throw new Error(`stub start failed: ${err.message}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return { child, port, stdout, stderr };
}

async function killStub(handle) {
  if (!handle || !handle.child || handle.child.exitCode !== null) return;
  try { handle.child.kill('SIGTERM'); } catch { /* ignore */ }
  const start = Date.now();
  while (handle.child.exitCode === null && Date.now() - start < 1500) {
    await sleep(50);
  }
  if (handle.child.exitCode === null && process.platform === 'win32') {
    try {
      spawn('taskkill', ['/F', '/T', '/PID', String(handle.child.pid)], { stdio: 'ignore', windowsHide: true });
    } catch { /* ignore */ }
  }
  const hardStart = Date.now();
  while (handle.child.exitCode === null && Date.now() - hardStart < 3000) {
    await sleep(20);
  }
}

async function postMessage(port, payload) {
  const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json() };
}

// --- Tests -----------------------------------------------------------------

test('stub-fast-agent: boots on free port and serves /_stub/health', async () => {
  const handle = await startStub();
  try {
    assert.equal(typeof handle.port, 'number');
    assert.ok(handle.port >= 47_200);
    assert.match(handle.stdout, /\[STUB\] listening on http:\/\/127\.0\.0\.1:\d+/);
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: POST /v1/messages returns 200 + Anthropic Messages API shape', async () => {
  const handle = await startStub();
  try {
    const { status, body } = await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      system: 'You are an intel-extraction agent.',
      messages: [{ role: 'user', content: 'design a fastify endpoint' }],
    });
    assert.equal(status, 200);
    assert.equal(body.type, 'message');
    assert.equal(body.role, 'assistant');
    assert.equal(body.stop_reason, 'end_turn');
    assert.equal(body.model, 'MiniMax-M2.7-highspeed-stub');
    assert.ok(Array.isArray(body.content));
    assert.equal(body.content.length, 1);
    assert.equal(body.content[0].type, 'text');
    assert.equal(typeof body.usage.input_tokens, 'number');
    assert.equal(typeof body.usage.output_tokens, 'number');
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: response content[0].text parses as Intel literal matching SPEC §IMod-5', async () => {
  const handle = await startStub();
  try {
    const { body } = await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      system: 'test',
      messages: [{ role: 'user', content: 'x' }],
    });
    const intel = JSON.parse(body.content[0].text);
    assert.equal(typeof intel.agentState, 'string');
    assert.ok(Array.isArray(intel.nextNeeds));
    assert.equal(typeof intel.recentTopic, 'string');
    assert.equal(intel.agentState, 'stub-agent-doing-things');
    assert.deepEqual(intel.nextNeeds, ['stub-need-1']);
    assert.equal(intel.recentTopic, 'stub-topic');
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: 2 consecutive POSTs return identical Intel literal (deterministic)', async () => {
  const handle = await startStub();
  try {
    const r1 = await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      system: 'test',
      messages: [{ role: 'user', content: 'first' }],
    });
    const r2 = await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      system: 'test',
      messages: [{ role: 'user', content: 'second' }],
    });
    assert.equal(r1.body.content[0].text, r2.body.content[0].text);
    assert.equal(r1.body.content[0].text, JSON.stringify({
      agentState: 'stub-agent-doing-things',
      nextNeeds: ['stub-need-1'],
      recentTopic: 'stub-topic',
    }));
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: [STUB] prefix appears in stdout', async () => {
  const handle = await startStub();
  try {
    await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'x' }],
    });
    // The stub logs at least [STUB] listening + [STUB] /v1/messages lines.
    const stubLines = handle.stdout.split('\n').filter((l) => l.includes('[STUB]'));
    assert.ok(stubLines.length >= 2, `expected >= 2 [STUB] lines, got ${stubLines.length}:\n${handle.stdout}`);
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: respects SIMULATED_LATENCY_MS env var', async () => {
  const handle = await startStub({ SIMULATED_LATENCY_MS: '100' });
  try {
    const t0 = Date.now();
    await postMessage(handle.port, {
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      messages: [{ role: 'user', content: 'x' }],
    });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 100, `expected elapsed >= 100ms, got ${elapsed}ms`);
    assert.ok(elapsed < 2000, `expected elapsed < 2000ms (stub should not hang), got ${elapsed}ms`);
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: rejects non-/v1/messages POST with 404', async () => {
  const handle = await startStub();
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/something-else`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not_found');
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: rejects malformed JSON with 400', async () => {
  const handle = await startStub();
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_json');
  } finally {
    await killStub(handle);
  }
});

test('stub-fast-agent: responds to GET /_stub/health with latency_ms', async () => {
  const handle = await startStub({ SIMULATED_LATENCY_MS: '150' });
  try {
    const res = await fetch(`http://127.0.0.1:${handle.port}/_stub/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.latency_ms, 150);
  } finally {
    await killStub(handle);
  }
});
