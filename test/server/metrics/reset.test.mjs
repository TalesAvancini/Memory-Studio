/**
 * Reset test for MetricsRingBuffer (Phase 7a T-07).
 *
 * Verifies AC-9 (transient on restart): when the buffer is
 * re-initialized after a reset, counters start at 0 and the
 * latency ring is empty.
 *
 * Also covers the lifecycle singleton reset semantics: after
 * `resetMetricsBufferForTests()`, `getMetricsBuffer()` returns
 * `null` and the buffer can be re-initialized cleanly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRingBuffer } from '../../../src/server/metrics/ring-buffer.ts';
import {
  initMetricsBuffer,
  getMetricsBuffer,
  resetMetricsBufferForTests,
} from '../../../src/server/metrics/lifecycle.ts';

test('metrics_reset_on_restart', () => {
  // First lifecycle: drive 5 records, verify snapshot reflects them.
  const buf1 = initMetricsBuffer();
  assert.ok(buf1 !== null);
  for (let i = 0; i < 5; i++) {
    buf1.recordAugment({ matched: true, outcome: 'measured', latencyMs: i + 1 });
  }
  const snap1 = buf1.snapshot();
  assert.equal(snap1.window.request_count, 5);
  assert.equal(snap1.request_hit_rate, 1.0); // all matched

  // Reset (simulating server restart).
  resetMetricsBufferForTests();
  assert.equal(getMetricsBuffer(), null, 'after reset, buffer is null');

  // Second lifecycle: fresh instance.
  const buf2 = initMetricsBuffer();
  assert.notEqual(buf2, buf1, 'new instance created after reset');
  const snap2 = buf2.snapshot();
  assert.equal(snap2.window.request_count, 0, 'request_count reset to 0');
  assert.equal(snap2.request_hit_rate, null, 'ratio is null when empty');
  assert.equal(snap2.p50_latency_ms, null, 'p50 null when no samples');
  assert.equal(snap2.p99_latency_ms, null, 'p99 null when no samples');
  // working_set_mb is always present (re-sampled at first recompute).
  assert.ok(typeof snap2.working_set_mb === 'number');
  assert.ok(snap2.working_set_mb > 0);

  // Cleanup.
  resetMetricsBufferForTests();
});

test('MetricsRingBuffer.resetForTests_clears_state', () => {
  const buf = new MetricsRingBuffer();
  buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 5 });
  buf.recordProxy({ cacheReadTokens: 10, latencyMs: 100 });
  const snapBefore = buf.snapshot();
  assert.equal(snapBefore.window.request_count, 1);
  assert.equal(snapBefore.window.proxy_request_count, 1);

  buf.resetForTests();
  const snapAfter = buf.snapshot();
  assert.equal(snapAfter.window.request_count, 0);
  assert.equal(snapAfter.window.proxy_request_count, 0);
  assert.equal(snapAfter.request_hit_rate, null);
  assert.equal(snapAfter.token_cache_coverage, null);
});
