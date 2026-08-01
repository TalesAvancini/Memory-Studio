/**
 * Phase 6a — Stub Fast-Agent Server (Anthropic-compatible) (T-05)
 *
 * Source spec: `.specs/features/phase-6a-poc-validation/spec.md`
 * Source tasks: `.specs/features/phase-6a-poc-validation/tasks.md`
 *
 * A deterministic Anthropic-compatible `/v1/messages` endpoint for the
 * Phase 6a POC. Runs ONLY when `MINIMAX_API_KEY` is unset (per spec
 * R-06 / A-2) — the real API path of `scripts/poc-6a-fast-agent.mjs`
 * uses `MiniMax-M2.7-highspeed` at `https://api.minimax.io/anthropic`
 * via `@anthropic-ai/sdk` when the key is provisioned.
 *
 * Wire shape (matches Anthropic Messages API):
 *
 *   POST /v1/messages
 *     { model, max_tokens, system, messages: [{role, content}] }
 *
 *   200 OK
 *     {
 *       id: 'msg_stub_001',
 *       type: 'message',
 *       role: 'assistant',
 *       content: [{ type: 'text', text: '{JSON intel literal matching SPEC §IMod-5}' }],
 *       model: 'MiniMax-M2.7-highspeed-stub',
 *       stop_reason: 'end_turn',
 *       usage: { input_tokens: 64, output_tokens: 32 }
 *     }
 *
 * Deterministic Intel literal (matches SPEC §IMod-5):
 *   { agentState: 'stub-agent-doing-things',
 *     nextNeeds: ['stub-need-1'] ,
 *     recentTopic: 'stub-topic' }
 *
 * Every log line is prefixed with `[STUB]` so the Implementer cannot
 * confuse stub output with real API output (per spec R-06).
 *
 * Configurable:
 *   - `STUB_PORT`               (default 47200)
 *   - `SIMULATED_LATENCY_MS`    (default 200ms — within highspeed <1s range)
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/stub-fast-agent.mjs
 *
 * Exit code: 0 on SIGINT/SIGTERM (clean shutdown).
 */

import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const STUB_PORT = Number(process.env['STUB_PORT'] ?? 47200);
const SIMULATED_LATENCY_MS = Number(process.env['SIMULATED_LATENCY_MS'] ?? 200);
const STUB_HOST = '127.0.0.1';

// Deterministic Intel literal (SPEC §IMod-5 shape literal).
const STUB_INTEL_TEXT = JSON.stringify({
  agentState: 'stub-agent-doing-things',
  nextNeeds: ['stub-need-1'],
  recentTopic: 'stub-topic',
});

console.log(`[STUB] stub fast-agent starting (port=${STUB_PORT}, simulated_latency_ms=${SIMULATED_LATENCY_MS})`);

const server = createHttpServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/_stub/health') {
    // Test introspection endpoint — the POC harness uses this to wait
    // for the stub to be ready. Not part of the Anthropic surface.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, latency_ms: SIMULATED_LATENCY_MS }));
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', async () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid_json' }));
      return;
    }

    // Simulate Anthropic API latency (within highspeed <1s range).
    await sleep(SIMULATED_LATENCY_MS);

    const responseBody = {
      id: `msg_stub_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: STUB_INTEL_TEXT }],
      model: 'MiniMax-M2.7-highspeed-stub',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 64,
        output_tokens: 32,
      },
    };

    console.log(`[STUB] /v1/messages OK (model=${parsed.model ?? 'unset'}, latency=${SIMULATED_LATENCY_MS}ms)`);

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(responseBody));
  });
});

server.listen(STUB_PORT, STUB_HOST, () => {
  console.log(`[STUB] listening on http://${STUB_HOST}:${STUB_PORT}`);
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log('[STUB] shutdown requested');
  await new Promise((resolve) => {
    server.close(() => resolve());
    // Force-destroy any keep-alive sockets so the port is released.
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    setTimeout(resolve, 100);
  });
  console.log('[STUB] shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
