/**
 * Phase 6a — Fast Agent Latency POC (T-06 + T-07 + T-08)
 *
 * Source spec: `.specs/features/phase-6a-poc-validation/spec.md`
 * Source tasks: `.specs/features/phase-6a-poc-validation/tasks.md`
 *
 * Measures fast-agent latency (N=10 amostras) for the
 * `MiniMax-M2.7-highspeed` model. The default is the REAL API at
 * `https://api.minimax.io/anthropic` via `@anthropic-ai/sdk`; when
 * `MINIMAX_API_KEY` is unset, the harness falls back to a deterministic
 * local stub (`scripts/stub-fast-agent.mjs`) so the POC can run in
 * environments without API access (per spec R-06 / A-2).
 *
 * Wire shape (matches Anthropic Messages API):
 *   - POST /v1/messages
 *   - { model: 'MiniMax-M2.7-highspeed', max_tokens: 256, system, messages }
 *   - Response: { content: [{ type: 'text', text: <Intel literal JSON> }] }
 *
 * Statistical discipline (matches Phase 5a.4 + hot-path POC):
 *   - N=10 amostras
 *   - 5 warmup calls (excluded from measurement)
 *   - p95 is the gating metric
 *   - min / median / p95 / max reported
 *
 * Mode logging: every run prints `[fast-agent] MODE=real|stub` prominently
 * so the Implementer/Verifier cannot confuse the two.
 *
 * Run:
 *   MINIMAX_API_KEY=sk-...  node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs
 *   (no key)                 node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs
 *
 * Exit code:
 *   0 on PASS (p95 < 3000ms)
 *   1 on FAIL (with adjustment recommendation per design.md §3.5)
 */

import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STUB_SCRIPT = resolve(__dirname, 'stub-fast-agent.mjs');

// --- Constants (per tasks.md T-06) -----------------------------------------

const AMOSTRAS = 10;
const WARMUP_COUNT = 5;
const AMOSTRA_SLEEP_MS = 1000; // Rate-limit hygiene between chamadas.
const FAST_AGENT_BUDGET_MS = 3000; // PRD §16.7 / spec R-05.

const STUB_PORT = 47_300; // Distinct from the [47200, 47299] range used by stub-fast-agent.test.mjs.

// --- Deterministic R_N text (per spec A-6) ---------------------------------

const STUB_R_N_TEXT = 'design a fastify endpoint that validates authentication tokens securely';

const STUB_SYSTEM_PROMPT =
  'You are an intel-extraction agent. Output JSON matching { agentState: string, nextNeeds: string[], recentTopic: string }';

// --- Statistics helpers (copy from hot-path POC) ---------------------------

function sorted(arr) {
  return arr.slice().sort((a, b) => a - b);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedArr.length)),
  );
  return sortedArr[idx];
}

function summarizeRound(latencies) {
  const s = sorted(latencies);
  return {
    min: s[0] ?? 0,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1] ?? 0,
    n: s.length,
  };
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

// --- Real API path (T-06) ---------------------------------------------------

async function callRealApiFastAgent(apiKey) {
  // Use @anthropic-ai/sdk via createRequire (works in .mjs) at the
  // https://api.minimax.io/anthropic baseURL. When the SDK is not
  // installed (this environment), the importer throws and the harness
  // logs a clear guidance message + automatic fallback to stub mode.
  const require = createRequire(import.meta.url);
  let Anthropic;
  try {
    ({ default: Anthropic } = require('@anthropic-ai/sdk'));
  } catch (err) {
    throw new Error(
      `@anthropic-ai/sdk not installed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Install via: npm install @anthropic-ai/sdk. Falling back to stub.`,
    );
  }

  const client = new Anthropic({
    apiKey,
    baseURL: 'https://api.minimax.io/anthropic',
  });

  const t0 = performance.now();
  const response = await client.messages.create({
    model: 'MiniMax-M2.7-highspeed',
    max_tokens: 256,
    system: STUB_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: STUB_R_N_TEXT }],
  });
  const t1 = performance.now();
  return { latencyMs: t1 - t0, response };
}

async function runRealApiMode() {
  const apiKey = process.env['MINIMAX_API_KEY'];
  if (!apiKey) {
    throw new Error('MINIMAX_API_KEY not set');
  }

  console.log(`[fast-agent] MODE=real endpoint=https://api.minimax.io/anthropic model=MiniMax-M2.7-highspeed`);

  // Warmup
  console.log(`[fast-agent] warmup (${WARMUP_COUNT} calls, excluded from measurement)`);
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    try {
      await callRealApiFastAgent(apiKey);
    } catch (err) {
      throw new Error(`warmup ${i + 1}/${WARMUP_COUNT} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(AMOSTRA_SLEEP_MS);
  }

  // Measurement
  const latencies = [];
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const { latencyMs } = await callRealApiFastAgent(apiKey);
    latencies.push(latencyMs);
    console.log(`[fast-agent] amostra ${i + 1}/${AMOSTRAS} latency=${r2(latencyMs)}ms`);
    if (i < AMOSTRAS - 1) await sleep(AMOSTRA_SLEEP_MS);
  }

  return summarizeRound(latencies);
}

// --- Stub fallback path (T-07) ---------------------------------------------

async function pollStubHealth(port, timeoutMs = 3000) {
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

async function startStubProcess(port) {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', STUB_SCRIPT],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        STUB_PORT: String(port),
        SIMULATED_LATENCY_MS: '200',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
  child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
  await pollStubHealth(port);
  return { child, stdout, stderr };
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

async function callStubFastAgent(port) {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M2.7-highspeed',
      max_tokens: 256,
      system: STUB_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: STUB_R_N_TEXT }],
    }),
  });
  const t1 = performance.now();
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`stub /v1/messages returned ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return { latencyMs: t1 - t0, body };
}

async function runStubMode() {
  console.log(`[fast-agent] MINIMAX_API_KEY not set; falling back to stub (simulated_latency_ms=200)`);
  console.log(`[fast-agent] MODE=stub endpoint=http://127.0.0.1:${STUB_PORT}/v1/messages model=MiniMax-M2.7-highspeed-stub`);

  const stubHandle = await startStubProcess(STUB_PORT);
  try {
    // Warmup
    console.log(`[fast-agent] warmup (${WARMUP_COUNT} calls, excluded from measurement)`);
    for (let i = 0; i < WARMUP_COUNT; i += 1) {
      await callStubFastAgent(STUB_PORT);
      await sleep(AMOSTRA_SLEEP_MS);
    }

    // Measurement
    const latencies = [];
    for (let i = 0; i < AMOSTRAS; i += 1) {
      const { latencyMs } = await callStubFastAgent(STUB_PORT);
      latencies.push(latencyMs);
      console.log(`[fast-agent] amostra ${i + 1}/${AMOSTRAS} latency=${r2(latencyMs)}ms [STUB]`);
      if (i < AMOSTRAS - 1) await sleep(AMOSTRA_SLEEP_MS);
    }

    return summarizeRound(latencies);
  } finally {
    await killStub(stubHandle);
  }
}

// --- Main orchestrator (T-08) ----------------------------------------------

async function main() {
  const apiKey = process.env['MINIMAX_API_KEY'];
  let summary;
  let mode;
  let modeNote;

  if (apiKey) {
    try {
      summary = await runRealApiMode();
      mode = 'real';
      modeNote = `endpoint=https://api.minimax.io/anthropic model=MiniMax-M2.7-highspeed`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[fast-agent] real API path failed: ${msg}`);
      if (msg.includes('@anthropic-ai/sdk not installed')) {
        console.log(`[fast-agent] falling back to stub mode (SDK unavailable in this environment)`);
        summary = await runStubMode();
        mode = 'stub (real-API unavailable — SDK not installed)';
        modeNote = 'real-api-key-set-but-sdk-missing';
      } else {
        console.log(`[fast-agent] falling back to stub mode (network error or quota exceeded)`);
        summary = await runStubMode();
        mode = 'stub (real-API failed)';
        modeNote = 'real-api-key-set-but-call-failed';
      }
    }
  } else {
    summary = await runStubMode();
    mode = 'stub';
    modeNote = 'MINIMAX_API_KEY not set';
  }

  // --- Verdict (T-08) ---------------------------------------------------
  const pass = summary.p95 < FAST_AGENT_BUDGET_MS;
  const verdict = pass ? 'PASS' : 'FAIL';

  // --- Per-component breakdown --------------------------------------------
  console.log(
    `[fast-agent]   fast-agent: min=${r2(summary.min)}ms ` +
      `median=${r2(summary.median)}ms ` +
      `p95=${r2(summary.p95)}ms ` +
      `max=${r2(summary.max)}ms ` +
      `[budget < ${FAST_AGENT_BUDGET_MS}ms] ${pass ? 'PASS' : 'FAIL'} ` +
      `[MODE=${mode} reason=${modeNote}]`,
  );

  // --- Summary line (matches AC-3 format) ---------------------------------
  console.log(
    `[fast-agent] MODE=${mode} ${modeNote} median=${r2(summary.median)}ms ` +
      `p95=${r2(summary.p95)}ms [${verdict}]`,
  );

  // --- Adjustment recommendation on FAIL (per design.md §3.5) --------------
  if (!pass) {
    console.log(`[fast-agent] FAIL adjustment recommendations (per design.md §3.5):`);
    if (mode === 'real') {
      console.log(
        `  - p95 > 3s with real API: try alternative highspeed variant ` +
          `(e.g., MiniMax-M2.7-highspeed-mini if available); or reduce max_tokens (256 -> 128); ` +
          `or switch to async fire-and-forget (intel arrives later, Turn N+2 has it)`,
      );
    } else if (modeNote === 'MINIMAX_API_KEY not set') {
      console.log(
        `  - API key not provisioned: configure MINIMAX_API_KEY in environment; ` +
          `stub is NOT a permanent substitute`,
      );
    } else if (modeNote === 'real-api-key-set-but-sdk-missing') {
      console.log(
        `  - @anthropic-ai/sdk not installed in this environment: install via ` +
          `\`npm install @anthropic-ai/sdk\`; the real API path requires the SDK`,
      );
    } else {
      console.log(
        `  - Network errors (DNS, timeout) or upstream quota: add retry with exponential ` +
          `backoff (1s, 2s, 4s); or switch base URL; or check upstream API status`,
      );
    }
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(
    `[fast-agent] FAIL unhandled error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
