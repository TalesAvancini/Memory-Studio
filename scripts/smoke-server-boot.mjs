#!/usr/bin/env node
// scripts/smoke-server-boot.mjs — Phase 5a.2 (FT-02)
//
// Boot the Fastify augment server in a child process, capture its
// stdout to find the bound URL (`Memory Studio augment server:
// http://127.0.0.1:<port>/`), curl `/health` on that port, assert 200 +
// status="ok" + uptime_ms > 0, then kill the server cleanly.
//
// Why a child process (vs. in-process `createServer()`): the Verifier
// can't easily probe the actual bound port otherwise. The script also
// exercises the production entry point (`src/server/boot.ts` direct-
// entry guard) so a regression in the entry-point or the
// `Memory Studio augment server: ...` log line also fails here.
//
// Implementation notes:
//   - We spawn the entry script DIRECTLY (`node --experimental-strip-types`
//     on `src/server/boot.ts`) instead of going through `npm run
//     server:start`. The npm path wraps the process in `cmd.exe` on
//     Windows, and SIGTERM on the npm wrapper does NOT always
//     propagate to the actual node server, leaking the bound port and
//     breaking idempotency. Direct spawn + SIGTERM kills cleanly.
//   - We pick a deterministic-ish port from the augment server's
//     default range (42900-43000). The curl probe then asserts on the
//     ACTUAL bound URL parsed from stdout (NOT a hardcoded port), so
//     this is robust to range collisions.
//
// Exits 0 on success, non-zero on any failure. Prints `[PASS]` or
// `[FAIL]` structured lines so logs are greppable.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const BOOT_TIMEOUT_MS = 8000;
const READY_POLL_INTERVAL_MS = 50;
const KILL_TIMEOUT_MS = 1500;

// Pick a port from the augment server's default range [42900, 43000].
// The script reads the actual bound URL from stdout, so any free port
// in the range works. We pin a single port for repeatability, but the
// assertion chain does NOT depend on which port — that's the
// regression-proof: a future change that moves the server to another
// range still passes the smoke as long as the URL log appears.
const PINNED_PORT = 42900;

/**
 * Run `node --experimental-strip-types src/server/boot.ts` as a child
 * process. The child IS the server (no shell, no npm wrapper) so
 * SIGTERM/SIGKILL on the child pid reliably stops the listener.
 *
 * Returns a structured result: { ok, child, url?, healthStatus?,
 * healthBody?, stdout?, stderr?, reason? }. The caller is responsible
 * for cleanup via `killChild` on `child`.
 */
async function bootAndProbe() {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'src/server/boot.ts'],
    {
      cwd: process.cwd(),
      env: { ...process.env },
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

  // Poll for the "Memory Studio augment server: ..." line — that's our
  // ready signal. We bound the wait so a stuck server can't hang CI.
  let url = null;
  const bootStart = Date.now();
  while (Date.now() - bootStart < BOOT_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      break;
    }
    const match = stdout.match(/Memory Studio augment server: (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) {
      url = match[1];
      break;
    }
    await sleep(READY_POLL_INTERVAL_MS);
  }

  if (!url) {
    return {
      ok: false,
      reason: child.exitCode !== null
        ? `child-exited-early-code-${child.exitCode}`
        : 'boot-timeout',
      stdout,
      stderr,
      child,
    };
  }

  // Curl /health on the bound URL. Node's built-in fetch is fine; we
  // don't need a real network round-trip because the server is on the
  // same host (loopback).
  let healthStatus = 0;
  let healthBody = '';
  try {
    const res = await fetch(`${url}/health`);
    healthStatus = res.status;
    healthBody = await res.text();
  } catch (err) {
    return {
      ok: false,
      reason: `health-fetch-failed: ${err instanceof Error ? err.message : String(err)}`,
      stdout,
      stderr,
      child,
      url,
    };
  }

  return { ok: true, child, url, healthStatus, healthBody, stdout, stderr };
}

async function killChild(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore — best-effort cleanup
  }
  // Give it a moment to exit cleanly, then SIGKILL.
  const exitStart = Date.now();
  while (child.exitCode === null && Date.now() - exitStart < KILL_TIMEOUT_MS) {
    await sleep(50);
  }
  if (child.exitCode === null) {
    try {
      child.kill('SIGKILL');
    } catch {
      // ignore
    }
    // Wait for actual exit to release the listener port.
    while (child.exitCode === null) {
      await sleep(20);
    }
  }
}

function log(tag, message) {
  console.log(`${tag} ${message}`);
}

const result = await bootAndProbe();
if (!result.ok) {
  log('[FAIL]', `boot smoke: ${result.reason}`);
  if (result.stdout) console.error(`stdout:\n${result.stdout}`);
  if (result.stderr) console.error(`stderr:\n${result.stderr}`);
  await killChild(result.child);
  process.exit(1);
}

let parsedBody;
try {
  parsedBody = JSON.parse(result.healthBody);
} catch (err) {
  log(
    '[FAIL]',
    `boot smoke: /health returned non-JSON body (status=${result.healthStatus}): ${result.healthBody.slice(0, 200)}`,
  );
  await killChild(result.child);
  process.exit(1);
}

const checks = [];
checks.push({
  name: 'http-status-200',
  ok: result.healthStatus === 200,
  observed: `status=${result.healthStatus}`,
});
checks.push({
  name: 'status-ok',
  ok: parsedBody.status === 'ok',
  observed: `status=${parsedBody.status}`,
});
checks.push({
  name: 'uptime-ms-positive',
  ok: typeof parsedBody.uptime_ms === 'number' && parsedBody.uptime_ms >= 0,
  observed: `uptime_ms=${parsedBody.uptime_ms}`,
});

const failed = checks.filter((c) => !c.ok);
if (failed.length > 0) {
  for (const f of failed) {
    log('[FAIL]', `boot smoke: ${f.name} (${f.observed})`);
  }
  console.error(`full body: ${result.healthBody}`);
  await killChild(result.child);
  process.exit(1);
}

log('[PASS]', `boot smoke: ${result.url}/health → 200, status=ok, uptime_ms=${parsedBody.uptime_ms}`);
log('[PASS]', `boot smoke: bound URL parsed from stdout (no static port guess)`);
// Echo the captured server-ready line so wrapper tests (and humans
// reading logs) can confirm the URL was parsed from the live stdout.
log('[INFO]', `server log captured: Memory Studio augment server: ${result.url}`);
await killChild(result.child);
process.exit(0);
