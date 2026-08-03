/**
 * Dashboard tests for MetricsRingBuffer (Phase 7a T-07).
 *
 * Tests the recompute logic + percentile math + window semantics per
 * spec.md R-1..R-6 + AC-1..AC-7. The dashboard helper
 * (`src/server/metrics/dashboard.ts`) is a thin wrapper around
 * `MetricsRingBuffer.recomputeDashboard()` / `.snapshot()` — we
 * exercise the same code paths through direct calls.
 *
 * Coverage:
 *   1.  request_hit_rate_with_mixed_paths (AC-1)
 *   2.  request_hit_rate_zero_attempted_returns_null (EC-1)
 *   3.  token_cache_coverage_proxy_disabled (AC-2)
 *   4.  token_cache_coverage_proxy_enabled (AC-3)
 *   5.  p50_latency_ms_with_known_samples (AC-4)
 *   6.  p99_latency_ms_nearest_rank_with_100_samples (AC-5)
 *   7.  p99_latency_ms_nearest_rank_with_10_samples (AC-5 small-sample)
 *   8.  working_set_mb_positive_integer (AC-6)
 *   9.  refresh_trigger_count_and_time (AC-7)
 *   10. request_hit_rate_excludes_social_and_failopen (AC-1 edge)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRingBuffer } from '../../../src/server/metrics/ring-buffer.ts';

test('request_hit_rate_with_mixed_paths', () => {
  const buf = new MetricsRingBuffer();
  try {
    // 4 matched + 3 no-match (measured) + 2 social + 1 timeout.
    for (let i = 0; i < 4; i++) {
      buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 1 });
    }
    for (let i = 0; i < 3; i++) {
      buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: 2 });
    }
    for (let i = 0; i < 2; i++) {
      buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 3 });
    }
    buf.recordAugment({ matched: false, outcome: 'timeout', latencyMs: 4 });
    const snap = buf.recomputeDashboard();
    // Denominator excludes social + timeout = 7. Numerator = 4.
    // Ratio = 4/7.
    assert.equal(snap.request_hit_rate, 4 / 7);
    // window.request_count = ALL 10 paths.
    assert.equal(snap.window.request_count, 10);
  } finally {
    buf.resetForTests();
  }
});

test('request_hit_rate_zero_attempted_returns_null', () => {
  const buf = new MetricsRingBuffer();
  try {
    // Only excluded paths → attempted=0 → ratio is null (NOT 0).
    buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 1 });
    buf.recordAugment({ matched: false, outcome: 'no_active_items', latencyMs: 2 });
    const snap = buf.recomputeDashboard();
    assert.equal(snap.request_hit_rate, null);
  } finally {
    buf.resetForTests();
  }
});

test('token_cache_coverage_proxy_disabled', () => {
  const buf = new MetricsRingBuffer();
  try {
    // Save + clear the env var so proxy is "disabled".
    const prev = process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
    delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
    try {
      const snap = buf.recomputeDashboard();
      assert.equal(snap.token_cache_coverage, null);
      assert.equal(snap.proxy_enabled, false);
      assert.equal(snap.window.proxy_request_count, 0);
    } finally {
      if (prev !== undefined) {
        process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = prev;
      }
    }
  } finally {
    buf.resetForTests();
  }
});

test('token_cache_coverage_proxy_enabled', () => {
  const buf = new MetricsRingBuffer();
  try {
    const prev = process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
    process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'] = 'http://127.0.0.1:65535';
    try {
      // 1 cache hit out of 10 proxy requests.
      for (let i = 0; i < 9; i++) {
        buf.recordProxy({ cacheReadTokens: 0 });
      }
      buf.recordProxy({ cacheReadTokens: 42 });
      const snap = buf.recomputeDashboard();
      assert.equal(snap.token_cache_coverage, 0.1);
      assert.equal(snap.proxy_enabled, true);
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

test('p50_latency_ms_with_known_samples', () => {
  const buf = new MetricsRingBuffer();
  try {
    // Inject 10 latency samples: [10, 20, 30, ..., 100].
    for (let i = 1; i <= 10; i++) {
      buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: i * 10 });
    }
    const snap = buf.recomputeDashboard();
    // p50 nearest-rank: idx = ceil(0.5 * 10) - 1 = 4. sorted[4] = 50.
    assert.equal(snap.p50_latency_ms, 50);
  } finally {
    buf.resetForTests();
  }
});

test('p99_latency_ms_nearest_rank_with_100_samples', () => {
  const buf = new MetricsRingBuffer();
  try {
    for (let i = 1; i <= 100; i++) {
      buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: i });
    }
    const snap = buf.recomputeDashboard();
    // p99 nearest-rank on 100 samples: idx = ceil(0.99 * 100) - 1 = 98.
    // sorted[98] = 99.
    assert.equal(snap.p99_latency_ms, 99);
  } finally {
    buf.resetForTests();
  }
});

test('p99_latency_ms_nearest_rank_with_10_samples', () => {
  const buf = new MetricsRingBuffer();
  try {
    for (let i = 1; i <= 10; i++) {
      buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: i });
    }
    const snap = buf.recomputeDashboard();
    // p99 nearest-rank on 10 samples: idx = ceil(0.99 * 10) - 1 = 9.
    // sorted[9] = 10 (small-sample edge case per spec.md R-4).
    assert.equal(snap.p99_latency_ms, 10);
  } finally {
    buf.resetForTests();
  }
});

test('working_set_mb_positive_integer', () => {
  const buf = new MetricsRingBuffer();
  try {
    const snap = buf.recomputeDashboard();
    assert.equal(typeof snap.working_set_mb, 'number');
    assert.ok(snap.working_set_mb > 0, 'working_set_mb must be > 0');
    assert.equal(
      snap.working_set_mb,
      Math.floor(process.memoryUsage().rss / 1024 / 1024),
    );
  } finally {
    buf.resetForTests();
  }
});

test('refresh_trigger_count_and_time', () => {
  const buf = new MetricsRingBuffer();
  try {
    const t0 = buf.recomputeDashboard().timestamp;
    // Drive 10 records (count trigger threshold = 10).
    for (let i = 0; i < 10; i++) {
      buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 1 });
    }
    // The count trigger should have fired on record #10.
    const t1 = buf.snapshot().timestamp;
    assert.ok(t1 >= t0, 'timestamp should advance on count trigger');
    // window.request_count should reflect 10.
    assert.equal(buf.snapshot().window.request_count, 10);
  } finally {
    buf.resetForTests();
  }
});

test('request_hit_rate_excludes_social_and_failopen', () => {
  const buf = new MetricsRingBuffer();
  try {
    // 1 measured matched + 1 measured no-match + 1 social + 1 fail-open.
    buf.recordAugment({ matched: true, outcome: 'measured', latencyMs: 1 });
    buf.recordAugment({ matched: false, outcome: 'measured', latencyMs: 2 });
    buf.recordAugment({ matched: false, outcome: 'social', latencyMs: 3 });
    buf.recordAugment({ matched: false, outcome: 'timeout', latencyMs: 4 });
    const snap = buf.recomputeDashboard();
    // Numerator = 1, denominator = 2 (measured only). Ratio = 0.5.
    assert.equal(snap.request_hit_rate, 0.5);
  } finally {
    buf.resetForTests();
  }
});
