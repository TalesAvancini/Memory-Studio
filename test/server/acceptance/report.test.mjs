/**
 * Phase 7b T-05 — acceptance evaluator unit tests.
 * @date 2026-08-03
 * @version 1
 *
 * Exercises the typed evaluator's core scenarios from spec.md R-9, R-10,
 * R-11 + design.md §9. Each test sets up a hand-crafted snapshot set
 * and asserts the resulting `AcceptanceEvaluation`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAcceptance,
  parseAcceptanceSnapshot,
  AcceptanceSnapshotValidationError,
  MIN_QUALIFYING_SESSIONS,
  MIN_TURNS_PER_SESSION,
  SEVEN_DAYS_MS,
} from '../../../src/server/acceptance/acceptance-report.ts';

const STATE = {
  activeCatalog: ['skill-a'],
  thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
  stateVersion: 1,
  loadedAt: 0,
};

function buildSnapshots({
  count = 1,
  startTs = Date.parse('2026-08-01T00:00:00.000Z'),
  spanMs = SEVEN_DAYS_MS,
  source = 'real',
  providerMode = 'anthropic-real',
  fastAgentMode = 'real',
  runtimeMode = 'production',
  sessionCount = 5,
  turnsPerSession = 10,
  delta_attempted = 100,
  delta_matched = 75,
  delta_proxy = 100,
  delta_cache_hit = 65,
  processStartedAt = Date.parse('2026-08-01T00:00:00.000Z'),
  auditComplete = true,
  intervalsPerSnapshot = 1,
  thresholds = { minCosineSimilarity: 0.6, minFtsHits: 2 },
  p50 = 30,
  p99 = 150,
  workingSetMb = 800,
} = {}) {
  const raw = [];
  for (let i = 0; i < count; i += 1) {
    const ts = startTs + Math.floor(spanMs * (i / Math.max(1, count - 1)));
    const turnsBySession = {};
    for (let s = 0; s < sessionCount; s += 1) {
      const hash = `session_${s.toString().padStart(2, '0')}`;
      turnsBySession[hash] = turnsPerSession;
    }
    const factor = (i + 1) / count;
    raw.push({
      schema_version: 1,
      captured_at: new Date(ts).toISOString(),
      source,
      provider_mode: providerMode,
      fast_agent_mode: fastAgentMode,
      runtime_mode: runtimeMode,
      metrics_url: 'http://127.0.0.1:42900/metrics',
      thresholds,
      metrics: {
        p50_latency_ms: p50,
        p99_latency_ms: p99,
        working_set_mb: workingSetMb,
        evidence: {
          matched_requests: Math.round(delta_matched * factor),
          attempted_requests: Math.round(delta_attempted * factor),
          cache_hit_requests: Math.round(delta_cache_hit * factor),
          proxy_requests: Math.round(delta_proxy * factor),
          latency_sample_count: 100,
          process_started_at: processStartedAt,
        },
      },
      audit: {
        complete: auditComplete,
        first_event_ts: i === 0 ? startTs : startTs + i * 60_000,
        last_event_ts: ts,
        turns_by_session_hash: turnsBySession,
      },
    });
  }
  return raw.map((r) => parseAcceptanceSnapshot(r));
}

function evaluate(args) {
  return evaluateAcceptance({
    snapshots: buildSnapshots(args.snapshots || {}),
    state: STATE,
    allowSynthetic: args.allowSynthetic || false,
    evaluationDate: args.evaluationDate || Date.parse('2026-08-09T00:00:00.000Z'),
  });
}

test('parse_snapshot_rejects_missing_schema_version', () => {
  assert.throws(
    () => parseAcceptanceSnapshot({ captured_at: '2026-08-01T00:00:00Z' }),
    (e) => e instanceof AcceptanceSnapshotValidationError,
  );
});

test('parse_snapshot_rejects_invalid_source', () => {
  assert.throws(
    () => parseAcceptanceSnapshot({
      schema_version: 1,
      captured_at: '2026-08-01T00:00:00Z',
      source: 'unknown',
      provider_mode: 'anthropic-real',
      fast_agent_mode: 'real',
      runtime_mode: 'production',
      metrics_url: 'http://x',
      thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
      metrics: {
        p50_latency_ms: 30, p99_latency_ms: 150, working_set_mb: 800,
        evidence: {
          matched_requests: 0, attempted_requests: 0, cache_hit_requests: 0,
          proxy_requests: 0, latency_sample_count: 0, process_started_at: 0,
        },
      },
      audit: { complete: true, first_event_ts: 0, last_event_ts: 0, turns_by_session_hash: {} },
    }),
    (e) => e instanceof AcceptanceSnapshotValidationError && e.field === 'source',
  );
});

test('production_mode_rejects_synthetic_snapshots', () => {
  const eval_ = evaluate({ snapshots: { count: 2, source: 'synthetic' } });
  assert.equal(eval_.evidence_hashes.length, 0);
  assert.equal(eval_.ignored_synthetic_files.length, 2);
  assert.equal(eval_.eligible_for_phase_closure, false);
  assert.equal(eval_.verdict, 'INCOMPLETE');
});

test('production_mode_rejects_stub_provider', () => {
  const eval_ = evaluate({ snapshots: { count: 2, providerMode: 'anthropic-stub' } });
  assert.equal(eval_.evidence_hashes.length, 0);
  assert.equal(eval_.ignored_synthetic_files.length, 2);
  assert.equal(eval_.eligible_for_phase_closure, false);
});

test('production_mode_rejects_stub_runtime', () => {
  const eval_ = evaluate({ snapshots: { count: 2, runtimeMode: 'stub' } });
  assert.equal(eval_.evidence_hashes.length, 0);
  assert.equal(eval_.eligible_for_phase_closure, false);
});

test('production_mode_rejects_incomplete_audit', () => {
  const eval_ = evaluate({ snapshots: { count: 2, auditComplete: false } });
  assert.equal(eval_.evidence_hashes.length, 0);
  assert.equal(eval_.eligible_for_phase_closure, false);
});

test('allow_synthetic_mode_passes_synthetic_evidence_to_evaluator', () => {
  const eval_ = evaluate({ snapshots: { count: 7, source: 'synthetic' }, allowSynthetic: true });
  assert.equal(eval_.evidence_hashes.length, 7);
  // Even when synthetic mode passes everything, closure is still false.
  assert.equal(eval_.eligible_for_phase_closure, false);
});

test('passing_real_evidence_yields_verdict_pass_and_closure_eligible', () => {
  const eval_ = evaluate({ snapshots: { count: 7, startTs: Date.parse('2026-08-01T00:00:00Z'), spanMs: SEVEN_DAYS_MS } });
  // hit_rate = 75/100 = 0.75 > 0.70
  // cache_coverage = 65/100 = 0.65 > 0.60
  // p50 = 30 < 50, p99 = 150 < 200, working_set = 800 < 1500
  assert.equal(eval_.verdict, 'PASS');
  assert.equal(eval_.eligible_for_phase_closure, true);
  for (const c of eval_.criteria) assert.equal(c.passed, true, `criterion ${c.id} should pass`);
});

test('exactly_0.70_hit_rate_fails_strict_inequality', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      delta_attempted: 100,
      delta_matched: 70, // exactly 0.70
    },
  });
  const rhr = eval_.criteria.find((c) => c.id === 'r10_request_hit_rate');
  assert.ok(rhr);
  assert.equal(rhr.passed, false, 'exactly 0.70 must FAIL strict >');
  assert.equal(eval_.verdict, 'FAIL');
});

test('exactly_0.60_cache_coverage_fails_strict_inequality', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      delta_proxy: 100,
      delta_cache_hit: 60, // exactly 0.60
    },
  });
  const tcc = eval_.criteria.find((c) => c.id === 'r10_token_cache_coverage');
  assert.ok(tcc);
  assert.equal(tcc.passed, false, 'exactly 0.60 must FAIL strict >');
});

test('exactly_50ms_p50_fails_strict_inequality', () => {
  const eval_ = evaluate({
    snapshots: { count: 7, startTs: Date.parse('2026-08-01T00:00:00Z'), spanMs: SEVEN_DAYS_MS, p50: 50 },
  });
  const p50c = eval_.criteria.find((c) => c.id === 'r10_p50_latency_ms');
  assert.ok(p50c);
  assert.equal(p50c.passed, false);
});

test('exactly_1500MB_working_set_fails_strict_inequality', () => {
  const eval_ = evaluate({
    snapshots: { count: 7, startTs: Date.parse('2026-08-01T00:00:00Z'), spanMs: SEVEN_DAYS_MS, workingSetMb: 1500 },
  });
  const wsc = eval_.criteria.find((c) => c.id === 'r10_working_set_mb');
  assert.ok(wsc);
  assert.equal(wsc.passed, false);
});

test('span_one_ms_below_seven_days_fails', () => {
  const eval_ = evaluate({
    snapshots: { count: 2, startTs: 0, spanMs: SEVEN_DAYS_MS - 1 },
  });
  const sc = eval_.criteria.find((c) => c.id === 'r9_session_coverage');
  assert.ok(sc);
  assert.equal(sc.passed, false);
});

test('four_sessions_fail_minimum', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      sessionCount: 4,
      turnsPerSession: 10,
    },
  });
  const sc = eval_.criteria.find((c) => c.id === 'r9_session_coverage');
  assert.ok(sc);
  assert.equal(sc.passed, false, '4 sessions < 5 minimum');
});

test('nine_turns_per_session_fails_minimum', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      sessionCount: 5,
      turnsPerSession: 9,
    },
  });
  const sc = eval_.criteria.find((c) => c.id === 'r9_session_coverage');
  assert.ok(sc);
  assert.equal(sc.passed, false, '9 turns/session < 10 minimum');
});

test('process_restart_with_new_process_started_at_does_not_subtract_across', () => {
  // Two snapshots in the same threshold epoch, but with different
  // process_started_at — the evaluator should treat them as separate
  // process epochs and NOT compute a negative delta.
  const startTs = Date.parse('2026-08-01T00:00:00Z');
  const snapshots = [
    {
      schema_version: 1,
      captured_at: new Date(startTs).toISOString(),
      source: 'real',
      provider_mode: 'anthropic-real',
      fast_agent_mode: 'real',
      runtime_mode: 'production',
      metrics_url: 'http://x',
      thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
      metrics: {
        p50_latency_ms: 30, p99_latency_ms: 150, working_set_mb: 800,
        evidence: {
          matched_requests: 50, attempted_requests: 70, cache_hit_requests: 30,
          proxy_requests: 50, latency_sample_count: 100, process_started_at: 100,
        },
      },
      audit: {
        complete: true, first_event_ts: startTs, last_event_ts: startTs,
        turns_by_session_hash: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [`s${i}`, 10]),
        ),
      },
    },
    {
      schema_version: 1,
      captured_at: new Date(startTs + SEVEN_DAYS_MS).toISOString(),
      source: 'real',
      provider_mode: 'anthropic-real',
      fast_agent_mode: 'real',
      runtime_mode: 'production',
      metrics_url: 'http://x',
      thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
      metrics: {
        p50_latency_ms: 30, p99_latency_ms: 150, working_set_mb: 800,
        evidence: {
          // DIFFERENT process_started_at — server restart
          matched_requests: 40, attempted_requests: 60, cache_hit_requests: 25,
          proxy_requests: 40, latency_sample_count: 100, process_started_at: 200,
        },
      },
      audit: {
        complete: true, first_event_ts: startTs, last_event_ts: startTs + SEVEN_DAYS_MS,
        turns_by_session_hash: Object.fromEntries(
          Array.from({ length: 5 }, (_, i) => [`s${i}`, 10]),
        ),
      },
    },
  ];
  const eval_ = evaluateAcceptance({
    snapshots,
    state: STATE,
    allowSynthetic: false,
    evaluationDate: startTs + SEVEN_DAYS_MS + 1_000,
  });
  // The evaluator must NOT fail with counter_regression (process
  // epoch boundary means new counters start fresh).
  const regression = eval_.criteria.find((c) => c.id === 'r9_counter_regression');
  assert.equal(regression, undefined, 'no counter regression across process epochs');
});

test('tuning_recommendation_lower_cosine_when_hit_rate_low', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      delta_matched: 50, // hit rate = 50/100 = 0.50 < 0.70
      delta_attempted: 100,
      delta_cache_hit: 65, // cache coverage = 0.65 (passing)
      delta_proxy: 100,
    },
  });
  assert.equal(eval_.tuning_recommendation.action, 'lower_cosine');
  // Cosine floor is 0.50. From 0.60, lower by 0.05 → 0.55.
  // Use approx-equal to avoid float precision flake.
  assert.ok(Math.abs((eval_.tuning_recommendation.new_cosine ?? 0) - 0.55) < 1e-6);
});

test('tuning_recommendation_inspect_cache_when_cache_only_fails', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
      delta_matched: 80, // hit rate = 0.80 > 0.70
      delta_attempted: 100,
      delta_cache_hit: 50, // cache coverage = 0.50 < 0.60
      delta_proxy: 100,
    },
  });
  assert.equal(eval_.tuning_recommendation.action, 'inspect_cache');
});

test('tuning_recommendation_freeze_when_all_pass', () => {
  const eval_ = evaluate({
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
    },
  });
  assert.equal(eval_.tuning_recommendation.action, 'freeze');
});

test('evaluator_is_deterministic_for_same_input', () => {
  const opts = {
    snapshots: {
      count: 7,
      startTs: Date.parse('2026-08-01T00:00:00Z'),
      spanMs: SEVEN_DAYS_MS,
    },
  };
  const a = evaluate({ snapshots: opts.snapshots, evaluationDate: opts.snapshots.startTs + SEVEN_DAYS_MS + 1000 });
  const b = evaluate({ snapshots: opts.snapshots, evaluationDate: opts.snapshots.startTs + SEVEN_DAYS_MS + 1000 });
  assert.deepEqual(a, b);
});
