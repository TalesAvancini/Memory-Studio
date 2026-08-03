/**
 * Phase 7b T-04 — provider-cache denominator fix tests.
 * @date 2026-08-03
 * @version 1
 *
 * Verifies that:
 *   - A completed HTTP 200 response WITHOUT `usage.cache_read_input_tokens`
 *     is counted in the proxy_requests denominator (R-2 denominator
 *     fix from Phase 7a).
 *   - A null cache read token is normalized to 0 (zero-valued miss).
 *   - The metric is recorded exactly ONCE per request, even when
 *     multiple SSE usage events are emitted (so the denominator
 *     counts the request, not the per-event usage updates).
 *   - Schema v2 evidence counters are non-negative and equal the
 *     ratio numerators/denominators.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify from 'fastify';
import { registerMessagesProxyRoute } from '../../../src/server/routes/messages-proxy.ts';
import { openAndMigrate } from '../../../src/catalog/db/open.ts';
import { resetMetricsBufferForTests, setMetricsBufferForTests } from '../../../src/server/metrics/lifecycle.ts';
import { MetricsRingBuffer } from '../../../src/server/metrics/ring-buffer.ts';

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
function encode(text) { return new TextEncoder().encode(text); }

function startStubUpstream(handler) {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function makePipeline(db) {
  return {
    db,
    embedder: { dimensions: 384, async encode() { return new Float32Array(384); } },
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
    retrieve() { return { ranked: [], ftsTotalHits: 0, retrievalMs: 0 }; },
  };
}

test('proxy_records_zero_valued_miss_on_completed_200_without_usage', async () => {
  const stub = await startStubUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_x', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
      // No `usage` field at all — common for stub mocks + some real
      // streaming paths.
    }));
  });
  const buf = new MetricsRingBuffer();
  setMetricsBufferForTests(buf);
  try {
    const db = await openAndMigrate(':memory:');
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makePipeline(db),
    });
    try {
      process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${stub.port}`;
      const res = await app.inject({
        method: 'POST', url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        payload: { model: 'claude-sonnet-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
      });
      assert.equal(res.statusCode, 200);
      buf.recomputeDashboard();
      const snap = buf.snapshot();
      // Phase 7b T-04: a 200 without usage counts as a zero-valued
      // miss — proxy_requests incremented, cache_hit_requests NOT.
      assert.equal(snap.window.proxy_request_count, 1, 'proxy_requests should count 1');
      assert.equal(snap.evidence.proxy_requests, 1);
      assert.equal(snap.evidence.cache_hit_requests, 0);
      assert.equal(snap.token_cache_coverage, 0, 'cache coverage is 0, not null');
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
    resetMetricsBufferForTests();
    delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  }
});

test('proxy_records_zero_valued_miss_on_completed_200_with_zero_usage', async () => {
  const stub = await startStubUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_x', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'claude-sonnet-4-5', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
    }));
  });
  const buf = new MetricsRingBuffer();
  setMetricsBufferForTests(buf);
  try {
    const db = await openAndMigrate(':memory:');
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makePipeline(db),
    });
    try {
      process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${stub.port}`;
      const res = await app.inject({
        method: 'POST', url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        payload: { model: 'claude-sonnet-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
      });
      assert.equal(res.statusCode, 200);
      buf.recomputeDashboard();
      const snap = buf.snapshot();
      assert.equal(snap.evidence.proxy_requests, 1);
      assert.equal(snap.evidence.cache_hit_requests, 0);
      assert.equal(snap.token_cache_coverage, 0);
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
    resetMetricsBufferForTests();
    delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  }
});

test('proxy_records_exactly_one_sample_per_streaming_request', async () => {
  // The SSE stream emits multiple usage events; the metric should be
  // recorded ONCE on completion (not per event), so the denominator
  // counts the request, not the per-event updates.
  const stub = await startStubUpstream((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    (async () => {
      res.write(sseEvent('message_start', {
        type: 'message_start',
        message: { type: 'message', content: [], usage: { input_tokens: 10 } },
      }));
      res.write(sseEvent('content_block_delta', {
        type: 'content_block_delta', index: 0,
        delta: { type: 'text_delta', text: 'hello' },
      }));
      res.write(sseEvent('message_delta', {
        type: 'message_delta', delta: {},
        usage: { cache_read_input_tokens: 5, output_tokens: 3 },
      }));
      res.write('data: [DONE]\n\n');
      res.end();
    })().catch(() => res.end());
  });
  const buf = new MetricsRingBuffer();
  setMetricsBufferForTests(buf);
  try {
    const db = await openAndMigrate(':memory:');
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makePipeline(db),
    });
    try {
      process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${stub.port}`;
      const res = await app.inject({
        method: 'POST', url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        payload: { model: 'claude-sonnet-4-5', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      });
      assert.equal(res.statusCode, 200);
      // Wait for tail to record the metric
      let deadline = Date.now() + 1000;
      while (buf.snapshot().evidence.proxy_requests === 0 && Date.now() < deadline) await sleep(20);
      buf.recomputeDashboard();
      const snap = buf.snapshot();
      // Exactly 1 proxy sample, NOT 2 (would be 2 if the metric
      // were recorded per SSE usage event).
      assert.equal(snap.evidence.proxy_requests, 1, 'proxy_requests should be 1, not per-event');
      assert.equal(snap.evidence.cache_hit_requests, 1, 'cache hit counted once (5 tokens)');
      assert.equal(snap.token_cache_coverage, 1.0);
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
    resetMetricsBufferForTests();
    delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  }
});

test('evidence_block_counters_equal_ratio_numerators_and_denominators', () => {
  const buf = new MetricsRingBuffer();
  try {
    const prev = process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
    process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = 'http://127.0.0.1:65535';
    try {
      // Drive a known mix.
      for (let i = 0; i < 4; i++) buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 10 });
      for (let i = 0; i < 3; i++) buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: 20 });
      buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 30 });
      for (let i = 0; i < 7; i++) buf.recordProxy({ cacheReadTokens: 0 });
      buf.recordProxy({ cacheReadTokens: 11 });
      const snap = buf.recomputeDashboard();
      // evidence matches the public ratios (AC-8).
      assert.equal(snap.evidence.matched_requests, 4);
      assert.equal(snap.evidence.attempted_requests, 7);
      assert.equal(snap.evidence.cache_hit_requests, 1);
      assert.equal(snap.evidence.proxy_requests, 8);
      assert.equal(snap.request_hit_rate, 4 / 7);
      assert.equal(snap.token_cache_coverage, 1 / 8);
      // process_started_at is monotonic and stable.
      assert.ok(snap.evidence.process_started_at > 0);
      assert.equal(snap.evidence.process_started_at, buf.processEpochStart);
    } finally {
      if (prev === undefined) {
        delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
      } else {
        process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = prev;
      }
    }
  } finally {
    buf.resetForTests();
  }
});

test('non_200_response_does_not_increment_proxy_denominator', async () => {
  const stub = await startStubUpstream((_req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream_unavailable' }));
  });
  const buf = new MetricsRingBuffer();
  setMetricsBufferForTests(buf);
  try {
    const db = await openAndMigrate(':memory:');
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makePipeline(db),
    });
    try {
      process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = `http://127.0.0.1:${stub.port}`;
      const res = await app.inject({
        method: 'POST', url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        payload: { model: 'claude-sonnet-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] },
      });
      assert.equal(res.statusCode, 503);
      const snap = buf.snapshot();
      assert.equal(snap.evidence.proxy_requests, 0, 'non-200 MUST NOT be in the denominator');
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
    resetMetricsBufferForTests();
    delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  }
});
