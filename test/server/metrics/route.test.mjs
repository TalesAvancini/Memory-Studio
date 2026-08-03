/**
 * GET /metrics route tests (Phase 7a T-07; Phase 7b T-04 — schema v2).
 *
 * Tests the Fastify route registered by `registerMetricsRoute`. Uses
 * `app.inject()` (no HTTP) per the existing Phase 5b pattern from
 * `test/audit/endpoints.test.mjs`.
 *
 * Coverage:
 *   1. metrics_endpoint_shape (AC-8) — 200 + v2 keys + evidence block
 *   2. metrics_endpoint_always_200 (AC-8) — empty buffer still 200
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  MetricsRingBuffer,
} from '../../../src/server/metrics/ring-buffer.ts';
import { registerMetricsRoute } from '../../../src/server/routes/metrics.ts';

test('metrics_endpoint_shape', async () => {
  const buf = new MetricsRingBuffer();
  const app = Fastify();
  try {
    await registerMetricsRoute(app, { buffer: buf });
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    // v1 + v2 keys (Phase 7b T-04: evidence block + schema_version 2).
    assert.ok('request_hit_rate' in body, 'request_hit_rate present');
    assert.ok('token_cache_coverage' in body, 'token_cache_coverage present');
    assert.ok('p50_latency_ms' in body, 'p50_latency_ms present');
    assert.ok('p99_latency_ms' in body, 'p99_latency_ms present');
    assert.ok('working_set_mb' in body, 'working_set_mb present');
    assert.ok('window' in body, 'window present');
    assert.ok('proxy_enabled' in body, 'proxy_enabled present');
    assert.ok('schema_version' in body, 'schema_version present');
    assert.ok('timestamp' in body, 'timestamp present');
    assert.ok('evidence' in body, 'evidence block present (Phase 7b T-04)');
    assert.equal(body.schema_version, 2, 'AC-8: schema_version 2 (Phase 7b T-04)');
    // evidence block has all 6 fields
    assert.equal(typeof body.evidence.matched_requests, 'number');
    assert.equal(typeof body.evidence.attempted_requests, 'number');
    assert.equal(typeof body.evidence.cache_hit_requests, 'number');
    assert.equal(typeof body.evidence.proxy_requests, 'number');
    assert.equal(typeof body.evidence.latency_sample_count, 'number');
    assert.equal(typeof body.evidence.process_started_at, 'number');
  } finally {
    buf.resetForTests();
    await app.close();
  }
});

test('metrics_endpoint_always_200', async () => {
  const buf = new MetricsRingBuffer();
  const app = Fastify();
  try {
    await registerMetricsRoute(app, { buffer: buf });
    // Even with empty buffer, status is 200.
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    // All rates are null when window is empty.
    assert.equal(body.request_hit_rate, null);
    assert.equal(body.token_cache_coverage, null);
    assert.equal(body.p50_latency_ms, null);
    assert.equal(body.p99_latency_ms, null);
    // working_set_mb is always present.
    assert.ok(typeof body.working_set_mb === 'number');
    assert.ok(body.working_set_mb > 0);
    // evidence block is present with zero counters + a process_started_at
    assert.equal(body.evidence.matched_requests, 0);
    assert.equal(body.evidence.attempted_requests, 0);
    assert.equal(body.evidence.cache_hit_requests, 0);
    assert.equal(body.evidence.proxy_requests, 0);
    assert.equal(body.evidence.latency_sample_count, 0);
    assert.ok(body.evidence.process_started_at > 0);
  } finally {
    buf.resetForTests();
    await app.close();
  }
});
