/**
 * GET /metrics route tests (Phase 7a T-07).
 *
 * Tests the Fastify route registered by `registerMetricsRoute`. Uses
 * `app.inject()` (no HTTP) per the existing Phase 5b pattern from
 * `test/audit/endpoints.test.mjs`.
 *
 * Coverage:
 *   1. metrics_endpoint_shape (AC-8) — 200 + 9 keys present
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
    // 9 keys per spec.md R-7 + AC-8.
    assert.ok('request_hit_rate' in body, 'request_hit_rate present');
    assert.ok('token_cache_coverage' in body, 'token_cache_coverage present');
    assert.ok('p50_latency_ms' in body, 'p50_latency_ms present');
    assert.ok('p99_latency_ms' in body, 'p99_latency_ms present');
    assert.ok('working_set_mb' in body, 'working_set_mb present');
    assert.ok('window' in body, 'window present');
    assert.ok('proxy_enabled' in body, 'proxy_enabled present');
    assert.ok('schema_version' in body, 'schema_version present');
    assert.ok('timestamp' in body, 'timestamp present');
    assert.equal(body.schema_version, 1, 'AC-8: schema_version 1');
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
  } finally {
    buf.resetForTests();
    await app.close();
  }
});
