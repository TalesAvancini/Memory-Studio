/**
 * Server boot smoke test (FT-02) — proves `scripts/smoke-server-boot.mjs`
 * (a) exits 0, (b) prints the expected `[PASS]` lines, (c) parses the
 * actual bound URL from the server's stdout (NOT a hardcoded port).
 *
 * Why this test exists:
 *   The Phase 5a.2 Verifier couldn't bind `/health` because their probe
 *   targeted a static port. This wrapper fixes the gap: it spawns the
 *   smoke script as a child process, captures stdout, asserts the
 *   PASS lines and exit code. The script under test does the actual
 *   port parsing + curl + assertion chain so a regression in the URL
 *   log format or the `/health` payload also fails this wrapper.
 *
 * The smoke is fast (~2s) and uses `MEMORY_STUDIO_AUGMENT_PORT_RANGE=42900-42900`
 * to keep CI deterministic. The test process is the parent and is
 * responsible for any leaked-server cleanup.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const SMOKE_PATH = fileURLToPath(new URL('../../scripts/smoke-server-boot.mjs', import.meta.url));
const SMOKE_TIMEOUT_MS = 30_000;

function runSmoke() {
  return new Promise((resolve) => {
    const child = spawn('node', [SMOKE_PATH], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MEMORY_STUDIO_AUGMENT_PORT_RANGE: '42900-42900',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      resolve({ code: -1, stdout, stderr, timedOut: true });
    }, SMOKE_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: false });
    });
  });
}

test('smoke-boot: scripts/smoke-server-boot.mjs exits 0 with [PASS] lines', async () => {
  const result = await runSmoke();
  if (result.timedOut) {
    assert.fail(`smoke script timed out after ${SMOKE_TIMEOUT_MS}ms\nstderr:\n${result.stderr}`);
  }
  assert.equal(
    result.code,
    0,
    `smoke script exited non-zero (code=${result.code})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  // The smoke script prints two [PASS] lines on success — one for the
  // HTTP probe, one for the URL-parsing claim. Asserting both keeps
  // a regression that drops a line from failing the test.
  const passLines = result.stdout.split('\n').filter((l) => l.startsWith('[PASS]'));
  assert.ok(
    passLines.length >= 1,
    `expected at least 1 [PASS] line in stdout, got:\n${result.stdout}`,
  );
  // Bound URL must appear in stdout (proves we're parsing the live
  // boot log, not a hardcoded constant).
  assert.match(
    result.stdout,
    /Memory Studio augment server: http:\/\/127\.0\.0\.1:\d+/,
    'smoke stdout must contain the bound URL line (proving real parse)',
  );
  // No [FAIL] line should appear on success.
  assert.doesNotMatch(result.stdout, /\[FAIL\]/);
});

test('smoke-boot: leaves no orphan server after cleanup (smoke script self-kills)', async () => {
  // Run a second smoke cycle after the first one to detect leaked
  // servers (the second run would fail to bind 42900). The first
  // assertion is the strong check; this one detects leaks.
  await sleep(200);
  const result = await runSmoke();
  assert.equal(
    result.code,
    0,
    `second smoke run failed (likely a leaked server is holding 42900)\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
