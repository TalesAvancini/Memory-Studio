/**
 * MetricsRingBuffer tests (Phase 7a T-07).
 *
 * Coverage:
 *   - recordAugment_increments_counters (AC-1, AC-3)
 *   - recordProxy_increments_counters (AC-3)
 *   - ring_buffer_overflow_drops_oldest (R-3 / R-4 100-element ring)
 *   - start_stop_clears_interval
 *
 * Mirrors the AuditRingBuffer test pattern from
 * `test/audit/buffer.test.mjs`. Uses `MetricsRingBuffer` directly
 * (no Fastify / HTTP) so tests are fast and isolated.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MetricsRingBuffer,
  METRICS_LATENCY_BUFFER_CAPACITY,
} from '../../../src/server/metrics/ring-buffer.ts';

test('recordAugment_increments_counters', () => {
  const buf = new MetricsRingBuffer();
  try {
    buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 10 });
    buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 20 });
    buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: 30 });
    const snap = buf.snapshot();
    // AC-1: 2 matched / 3 attempted = 0.6666...
    assert.equal(Math.abs(snap.request_hit_rate - 2 / 3) < 1e-9, true);
    assert.equal(snap.window.request_count, 3);
  } finally {
    buf.resetForTests();
  }
});

test('recordAugment_excludes_social_no_active_items_timeout_from_denominator', () => {
  const buf = new MetricsRingBuffer();
  try {
    // 1 measured matched + 1 measured no-match + 2 social + 2 no_active_items + 1 timeout
    buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 5 });
    buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: 6 });
    buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 7 });
    buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 8 });
    buf.recordAugment({ matched: false, outcome: 'no_active_items', latencyMs: 9 });
    buf.recordAugment({ matched: false, outcome: 'no_active_items', latencyMs: 10 });
    buf.recordAugment({ matched: false, outcome: 'timeout', latencyMs: 11 });
    const snap = buf.snapshot();
    // Denominator = measured only = 2. Numerator = 1. Ratio = 0.5.
    assert.equal(snap.request_hit_rate, 0.5);
    // window.request_count = ALL paths (7) per design.md.
    assert.equal(snap.window.request_count, 7);
  } finally {
    buf.resetForTests();
  }
});

test('recordProxy_increments_counters', () => {
  const buf = new MetricsRingBuffer();
  try {
    // Ensure proxy_enabled (set env to anything truthy)
    const prev = process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
    process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = 'http://127.0.0.1:65535';
    try {
      buf.recordProxy({ cacheReadTokens: 42 });
      buf.recordProxy({ cacheReadTokens: 0 });
      buf.recordProxy({ cacheReadTokens: 5 });
      const snap = buf.snapshot();
      // 2 cache hits out of 3 proxy requests.
      assert.equal(snap.token_cache_coverage, 2 / 3);
      assert.equal(snap.proxy_enabled, true);
      assert.equal(snap.window.proxy_request_count, 3);
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

test('ring_buffer_overflow_drops_oldest', () => {
  const buf = new MetricsRingBuffer();
  try {
    // Push capacity + 5 samples (105 total). The ring retains the
    // LAST 100 (samples 5..104 after overflow).
    for (let i = 0; i < METRICS_LATENCY_BUFFER_CAPACITY + 5; i++) {
      buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: i });
    }
    // Force recompute since count trigger may not have fired exactly
    // at sample #100.
    buf.recomputeDashboard();
    const snap = buf.snapshot();
    // After overflow, ring contains [5, 6, ..., 104] (100 samples).
    // p99 nearest-rank on 100 samples: idx = ceil(0.99 * 100) - 1 = 98
    // sorted[98] = 5 + 98 = 103.
    assert.equal(snap.p99_latency_ms, 103);
    // p50 nearest-rank: idx = ceil(0.5 * 100) - 1 = 49
    // sorted[49] = 5 + 49 = 54.
    assert.equal(snap.p50_latency_ms, 54);
  } finally {
    buf.resetForTests();
  }
});

test('start_stop_clears_interval', async () => {
  const buf = new MetricsRingBuffer();
  buf.start();
  // The internal flushTimer is set; we can't directly inspect it,
  // but stop() should clear without throwing. Re-start works.
  await buf.stop();
  buf.start();
  await buf.stop();
  // Reaching here without hanging = success.
  buf.resetForTests();
});
