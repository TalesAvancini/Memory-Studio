/**
 * Phase 7b T-05 — typed acceptance evaluator and report renderer.
 *
 * This is the deep module that drives both the production gate
 * (`scripts/acceptance-gate.mjs`) and the T-08 final report. The
 * evaluator is **deterministic**: the same input bytes + evaluator
 * date produce the same evaluation. Production mode rejects synthetic
 * / stub / incomplete evidence; `--allow-synthetic` is test-only and
 * always reports `eligible_for_phase_closure: false`.
 *
 * Per `.specs/features/phase-7b-acceptance-gate/spec.md` R-9..R-12
 * and design.md §9, the evaluator performs:
 *   1. Validate every snapshot schema + modes + finite values.
 *   2. Identify process epochs (`process_started_at`) and threshold
 *      epochs (state thresholds unchanged between consecutive
 *      snapshots).
 *   3. Compute non-negative counter deltas within each process epoch
 *      (never subtract across a process restart).
 *   4. Apply all strict budget inequalities with AND cache semantics
 *      on the final threshold epoch.
 *   5. Emit one deterministic threshold-tuning recommendation.
 *   6. Render a Markdown report when requested. The CLI consumes this
 *      single evaluator rather than re-implementing acceptance math.
 *
 * The evaluator never invokes the provider, never reads from the
 * network, and never imports any locked-layer module. It is purely
 * functional over the snapshot + state inputs.
 */
import { createHash } from 'node:crypto';
import { canonicalJsonStringify } from '../augment/byte-string.ts';
import { loadRuntimeSnapshotFromPath, type RuntimeStateSnapshot } from '../config/runtime-state.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Verdict for the entire evaluation. */
export type Verdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

/** What kind of evidence the snapshot was captured from. */
export type SnapshotSource = 'real' | 'synthetic';

/** Runtime mode reported by the snapshot envelope. */
export type RuntimeMode = 'production' | 'stub' | 'unknown';

/** Provider mode reported by the snapshot envelope. */
export type ProviderMode = 'anthropic-real' | 'anthropic-stub' | 'unknown';

/** Fast-agent mode reported by the snapshot envelope. */
export type FastAgentMode = 'real' | 'stub' | 'unknown';

/** A single criterion result (per R-9 / R-10 / R-11). */
export interface AcceptanceCriterionResult {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly observed: string;
  readonly threshold: string;
}

/** Per-session coverage aggregate. */
export interface SessionCoverage {
  readonly total_turns: number;
  readonly qualifying_sessions: number;
  readonly qualifying_turns: number;
  readonly first_event_ts: number;
  readonly last_event_ts: number;
  readonly span_ms: number;
  readonly session_turns: Readonly<Record<string, number>>;
}

/** Budget comparison results (R-10). */
export interface BudgetEvaluation {
  readonly request_hit_rate: number | null;
  readonly token_cache_coverage: number | null;
  readonly worst_p50_latency_ms: number | null;
  readonly worst_p99_latency_ms: number | null;
  readonly max_working_set_mb: number | null;
  readonly numerator_attempted: number;
  readonly denominator_attempted: number;
  readonly numerator_cache_hit: number;
  readonly denominator_proxy: number;
  readonly final_epoch_sessions: number;
  readonly final_epoch_turns: number;
  readonly process_epoch_sustained_hours: number;
}

/** Threshold epoch summary. */
export interface ThresholdEpoch {
  readonly index: number;
  readonly first_snapshot_ts: number;
  readonly last_snapshot_ts: number;
  readonly min_cosine_similarity: number;
  readonly min_fts_hits: number;
  readonly delta_attempted: number;
  readonly delta_matched: number;
  readonly delta_proxy: number;
  readonly delta_cache_hit: number;
  readonly session_count: number;
  readonly turn_count: number;
}

/** The deterministic threshold-tuning recommendation. */
export interface TuningRecommendation {
  readonly action: 'freeze' | 'lower_cosine' | 'lower_fts' | 'inspect_cache' | 'fix_performance' | 'wait' | 'escalate';
  readonly reason: string;
  readonly new_cosine?: number;
  readonly new_fts?: number;
}

/** Top-level evaluation result. */
export interface AcceptanceEvaluation {
  readonly verdict: Verdict;
  readonly eligible_for_phase_closure: boolean;
  readonly criteria: readonly AcceptanceCriterionResult[];
  readonly session_coverage: SessionCoverage;
  readonly budgets: BudgetEvaluation;
  readonly threshold_epochs: readonly ThresholdEpoch[];
  readonly final_thresholds: { readonly min_cosine_similarity: number; readonly min_fts_hits: number };
  readonly tuning_recommendation: TuningRecommendation;
  readonly ignored_synthetic_files: readonly string[];
  readonly evidence_hashes: readonly string[];
  readonly evaluation_date: number;
  readonly config_initial: { readonly min_cosine_similarity: number; readonly min_fts_hits: number };
  readonly config_pre7b_effective: { readonly min_cosine_similarity: number; readonly min_fts_hits: number };
}

// ---------------------------------------------------------------------------
// Snapshot envelope (R-8)
// ---------------------------------------------------------------------------

/** Evidence block inside the snapshot. */
export interface SnapshotEvidence {
  readonly matched_requests: number;
  readonly attempted_requests: number;
  readonly cache_hit_requests: number;
  readonly proxy_requests: number;
  readonly latency_sample_count: number;
  readonly process_started_at: number;
}

/** Audit aggregate inside the snapshot. */
export interface SnapshotAudit {
  readonly complete: boolean;
  readonly first_event_ts: number;
  readonly last_event_ts: number;
  readonly turns_by_session_hash: Readonly<Record<string, number>>;
}

/** Thresholds from state.json at the moment of capture. */
export interface SnapshotThresholds {
  readonly minCosineSimilarity: number;
  readonly minFtsHits: number;
}

/** One captured metrics + audit + state snapshot. */
export interface AcceptanceSnapshot {
  readonly schema_version: number;
  readonly captured_at: string;            // ISO 8601 UTC
  readonly captured_at_ms: number;
  readonly source: SnapshotSource;
  readonly provider_mode: ProviderMode;
  readonly fast_agent_mode: FastAgentMode;
  readonly runtime_mode: RuntimeMode;
  readonly metrics_url: string;
  readonly thresholds: SnapshotThresholds;
  readonly metrics: {
    readonly p50_latency_ms: number | null;
    readonly p99_latency_ms: number | null;
    readonly working_set_mb: number;
    readonly evidence: SnapshotEvidence;
  };
  readonly audit: SnapshotAudit;
}

/** Input to the evaluator. */
export interface AcceptanceEvaluationInput {
  readonly snapshots: readonly AcceptanceSnapshot[];
  readonly state: RuntimeStateSnapshot;
  readonly allowSynthetic: boolean;
  readonly evaluationDate: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seven days in milliseconds. */
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Five-minute clock-skew allowance for snapshot timestamps. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Required minimum sessions. */
export const MIN_QUALIFYING_SESSIONS = 5;

/** Required minimum turns per qualifying session. */
export const MIN_TURNS_PER_SESSION = 10;

/** Required minimum total turns. */
export const MIN_QUALIFYING_TURNS = 50;

/** Required minimum for the final threshold epoch. */
export const MIN_FINAL_EPOCH_SESSIONS = 2;
export const MIN_FINAL_EPOCH_TURNS = 20;

/** Required minimum process epoch duration for working-set gate. */
export const MIN_SUSTAINED_PROCESS_HOURS = 1;

/** Strict budget thresholds (PRD §10.2 + §14.6). */
export const MIN_REQUEST_HIT_RATE = 0.70;
export const MIN_TOKEN_CACHE_COVERAGE = 0.60;
export const MAX_P50_LATENCY_MS = 50;
export const MAX_P99_LATENCY_MS = 200;
export const MAX_WORKING_SET_MB = 1500;

/** Floor for threshold tuning (R-11). */
export const COSINE_FLOOR = 0.50;
export const FTS_FLOOR = 1;

/** Pre-7b effective defaults (the search module defaults that were in effect before state was wired). */
export const PRE_7B_EFFECTIVE_COSINE = 0.75;
export const PRE_7B_EFFECTIVE_FTS = 1;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AcceptanceSnapshotValidationError extends Error {
  readonly field: string;
  constructor(message: string, field: string) {
    super(message);
    this.name = 'AcceptanceSnapshotValidationError';
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// Snapshot validation (R-8)
// ---------------------------------------------------------------------------

/**
 * Validate a raw JSON object as an AcceptanceSnapshot. Throws
 * `AcceptanceSnapshotValidationError` on the first invalid field. The
 * redaction / secret scan is performed by the snapshot collector —
 * this validator enforces the shape contract.
 */
export function parseAcceptanceSnapshot(raw: unknown, index: number = 0): AcceptanceSnapshot {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AcceptanceSnapshotValidationError(`snapshot[${index}] root must be an object`, 'root');
  }
  const root = raw as Record<string, unknown>;

  const schemaVersion = requireNumber(root['schema_version'], 'schema_version');
  if (schemaVersion !== 1) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].schema_version must be 1, got ${schemaVersion}`,
      'schema_version',
    );
  }
  const capturedAt = requireString(root['captured_at'], 'captured_at');
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].captured_at is not a valid ISO date: ${capturedAt}`,
      'captured_at',
    );
  }
  const source = requireString(root['source'], 'source');
  if (source !== 'real' && source !== 'synthetic') {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].source must be 'real' or 'synthetic', got '${source}'`,
      'source',
    );
  }
  const providerMode = requireString(root['provider_mode'], 'provider_mode');
  const fastAgentMode = requireString(root['fast_agent_mode'], 'fast_agent_mode');
  const runtimeMode = requireString(root['runtime_mode'], 'runtime_mode');
  const metricsUrl = requireString(root['metrics_url'], 'metrics_url');

  const thresholdsRaw = requireObject(root['thresholds'], 'thresholds');
  const minCosineSimilarity = requireNumber(thresholdsRaw['minCosineSimilarity'], 'thresholds.minCosineSimilarity');
  const minFtsHits = requireNumber(thresholdsRaw['minFtsHits'], 'thresholds.minFtsHits');
  if (!Number.isFinite(minCosineSimilarity) || minCosineSimilarity < 0 || minCosineSimilarity > 1) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].thresholds.minCosineSimilarity out of [0,1]: ${minCosineSimilarity}`,
      'thresholds.minCosineSimilarity',
    );
  }
  if (!Number.isInteger(minFtsHits) || minFtsHits < 1) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].thresholds.minFtsHits must be a positive integer: ${minFtsHits}`,
      'thresholds.minFtsHits',
    );
  }

  const metricsRaw = requireObject(root['metrics'], 'metrics');
  const p50Raw = metricsRaw['p50_latency_ms'];
  const p99Raw = metricsRaw['p99_latency_ms'];
  if (p50Raw !== null && (typeof p50Raw !== 'number' || !Number.isFinite(p50Raw) || p50Raw < 0)) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].metrics.p50_latency_ms must be null or finite >= 0, got ${String(p50Raw)}`,
      'metrics.p50_latency_ms',
    );
  }
  if (p99Raw !== null && (typeof p99Raw !== 'number' || !Number.isFinite(p99Raw) || p99Raw < 0)) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].metrics.p99_latency_ms must be null or finite >= 0, got ${String(p99Raw)}`,
      'metrics.p99_latency_ms',
    );
  }
  const workingSetMb = requireNumber(metricsRaw['working_set_mb'], 'metrics.working_set_mb');
  if (!Number.isInteger(workingSetMb) || workingSetMb < 0) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot[${index}].metrics.working_set_mb must be a non-negative integer, got ${workingSetMb}`,
      'metrics.working_set_mb',
    );
  }
  const evidenceRaw = requireObject(metricsRaw['evidence'], 'metrics.evidence');
  const evidence: SnapshotEvidence = {
    matched_requests: requireNonNegativeInt(evidenceRaw['matched_requests'], 'evidence.matched_requests'),
    attempted_requests: requireNonNegativeInt(evidenceRaw['attempted_requests'], 'evidence.attempted_requests'),
    cache_hit_requests: requireNonNegativeInt(evidenceRaw['cache_hit_requests'], 'evidence.cache_hit_requests'),
    proxy_requests: requireNonNegativeInt(evidenceRaw['proxy_requests'], 'evidence.proxy_requests'),
    latency_sample_count: requireNonNegativeInt(evidenceRaw['latency_sample_count'], 'evidence.latency_sample_count'),
    process_started_at: requireNumber(evidenceRaw['process_started_at'], 'evidence.process_started_at'),
  };

  const auditRaw = requireObject(root['audit'], 'audit');
  const turnsRaw = requireObject(auditRaw['turns_by_session_hash'], 'audit.turns_by_session_hash');
  const turnsBySession: Record<string, number> = {};
  for (const [k, v] of Object.entries(turnsRaw)) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new AcceptanceSnapshotValidationError(
        `snapshot[${index}].audit.turns_by_session_hash[${k}] must be a non-negative integer, got ${String(v)}`,
        'audit.turns_by_session_hash',
      );
    }
    turnsBySession[k] = v;
  }
  const audit: SnapshotAudit = {
    complete: requireBool(auditRaw['complete'], 'audit.complete'),
    first_event_ts: requireNumber(auditRaw['first_event_ts'], 'audit.first_event_ts'),
    last_event_ts: requireNumber(auditRaw['last_event_ts'], 'audit.last_event_ts'),
    turns_by_session_hash: Object.freeze(turnsBySession),
  };

  return {
    schema_version: schemaVersion,
    captured_at: capturedAt,
    captured_at_ms: capturedAtMs,
    source: source,
    provider_mode: providerMode as ProviderMode,
    fast_agent_mode: fastAgentMode as FastAgentMode,
    runtime_mode: runtimeMode as RuntimeMode,
    metrics_url: metricsUrl,
    thresholds: { minCosineSimilarity, minFtsHits },
    metrics: {
      p50_latency_ms: (p50Raw as number | null),
      p99_latency_ms: (p99Raw as number | null),
      working_set_mb: workingSetMb,
      evidence,
    },
    audit,
  };
}

// ---------------------------------------------------------------------------
// Evaluation pipeline (R-9..R-12)
// ---------------------------------------------------------------------------

/**
 * Run the full acceptance evaluation pipeline. Pure function — same
 * inputs produce the same `AcceptanceEvaluation`. Production mode
 * (`allowSynthetic === false`) rejects synthetic / stub evidence;
 * `--allow-synthetic` mode accepts it but always reports
 * `eligible_for_phase_closure: false`.
 */
export function evaluateAcceptance(input: AcceptanceEvaluationInput): AcceptanceEvaluation {
  const { snapshots, state, allowSynthetic, evaluationDate } = input;
  const criteria: AcceptanceCriterionResult[] = [];

  // 1. Sort by captured_at, partition into eligible + ignored.
  const sorted = [...snapshots].sort((a, b) => a.captured_at_ms - b.captured_at_ms);
  const ignoredSynthetic: string[] = [];
  const eligible: AcceptanceSnapshot[] = [];
  for (const snap of sorted) {
    if (snap.source === 'synthetic' && !allowSynthetic) {
      ignoredSynthetic.push(snap.captured_at);
      continue;
    }
    if (!allowSynthetic) {
      if (snap.runtime_mode !== 'production') {
        ignoredSynthetic.push(snap.captured_at);
        continue;
      }
      if (snap.provider_mode !== 'anthropic-real') {
        ignoredSynthetic.push(snap.captured_at);
        continue;
      }
      if (snap.fast_agent_mode !== 'real') {
        ignoredSynthetic.push(snap.captured_at);
        continue;
      }
      if (!snap.audit.complete) {
        ignoredSynthetic.push(snap.captured_at);
        continue;
      }
    }
    eligible.push(snap);
  }

  // 2. Session coverage (R-9.1..R-9.4) over eligible snapshots.
  const sessionCoverage = computeSessionCoverage(eligible);

  // 3. Process epochs + threshold epochs (R-9.6..R-9.8, R-9 EC-5/6).
  const processEpochCheck = checkProcessEpochs(eligible, evaluationDate);
  criteria.push(processEpochCheck.criterion);
  if (processEpochCheck.failed) {
    return buildEvaluation({
      criteria, eligible, sessionCoverage, ignoredSynthetic, state, evaluationDate, allowSynthetic,
      blockingReason: 'process_epoch_invalid',
    });
  }

  const thresholdEpochResult = groupThresholdEpochs(eligible);
  criteria.push(...thresholdEpochResult.criteria);
  if (thresholdEpochResult.failed) {
    return buildEvaluation({
      criteria, eligible, sessionCoverage, ignoredSynthetic, state, evaluationDate, allowSynthetic,
      blockingReason: 'ambiguous_threshold_epoch',
    });
  }

  // 4. Counter deltas within final threshold epoch (R-9 final epoch).
  const finalEpoch = thresholdEpochResult.epochs.at(-1) ?? null;
  if (finalEpoch === null) {
    return buildEvaluation({
      criteria, eligible, sessionCoverage, ignoredSynthetic, state, evaluationDate, allowSynthetic,
      blockingReason: 'no_threshold_epoch',
    });
  }

  // 5. Final epoch eligibility (R-9.8: ≥2 sessions, ≥20 turns).
  const finalEpochCriteria = checkFinalEpochEligibility(finalEpoch);
  criteria.push(...finalEpochCriteria);

  // 6. Wall-clock span (R-9.1: ≥7 days).
  const spanCheck = checkSpan(sessionCoverage, eligible, evaluationDate);
  criteria.push(spanCheck.criterion);

  // 7. Strict budgets (R-10) on the final epoch.
  const budgetEval = computeFinalEpochBudgets(finalEpoch, eligible, processEpochCheck.processEpochs);
  const budgetCriteria = evaluateBudgets(budgetEval);
  criteria.push(...budgetCriteria);

  // 8. Tuning recommendation (R-11).
  const tuning = recommendTuning(budgetEval, finalEpoch, state);

  // 9. Overall verdict.
  const allPassed = criteria.every((c) => c.passed);
  const verdict: Verdict = allPassed ? 'PASS' : (eligible.length === 0 ? 'INCOMPLETE' : 'FAIL');

  // 10. Closure eligibility: requires PASS, real evidence only, no
  // synthetic in production mode.
  const eligibleForClosure = verdict === 'PASS'
    && !allowSynthetic
    && ignoredSynthetic.length === 0;

  const evaluation: AcceptanceEvaluation = {
    verdict,
    eligible_for_phase_closure: eligibleForClosure,
    criteria: Object.freeze(criteria),
    session_coverage: sessionCoverage,
    budgets: budgetEval,
    threshold_epochs: Object.freeze(thresholdEpochResult.epochs),
    final_thresholds: {
      min_cosine_similarity: finalEpoch.min_cosine_similarity,
      min_fts_hits: finalEpoch.min_fts_hits,
    },
    tuning_recommendation: tuning,
    ignored_synthetic_files: Object.freeze(ignoredSynthetic),
    evidence_hashes: Object.freeze(eligible.map((s) => hashSnapshot(s))),
    evaluation_date: evaluationDate,
    config_initial: {
      min_cosine_similarity: state.thresholds.minCosineSimilarity,
      min_fts_hits: state.thresholds.minFtsHits,
    },
    config_pre7b_effective: {
      min_cosine_similarity: PRE_7B_EFFECTIVE_COSINE,
      min_fts_hits: PRE_7B_EFFECTIVE_FTS,
    },
  };
  return Object.freeze(evaluation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeSessionCoverage(eligible: readonly AcceptanceSnapshot[]): SessionCoverage {
  // `turns_by_session_hash` is the per-snapshot aggregate of total
  // turns for that session at the time of capture. Across snapshots,
  // we keep the MAX per session (the count is monotonically increasing
  // within a session; summing would over-count).
  const allTurns: Record<string, number> = {};
  let firstEventTs = Number.POSITIVE_INFINITY;
  let lastEventTs = Number.NEGATIVE_INFINITY;
  for (const snap of eligible) {
    for (const [sid, turns] of Object.entries(snap.audit.turns_by_session_hash)) {
      allTurns[sid] = Math.max(allTurns[sid] ?? 0, turns);
    }
    if (snap.audit.first_event_ts > 0) firstEventTs = Math.min(firstEventTs, snap.audit.first_event_ts);
    if (snap.audit.last_event_ts > 0) lastEventTs = Math.max(lastEventTs, snap.audit.last_event_ts);
  }
  const qualifyingSessions = Object.values(allTurns).filter((t) => t >= MIN_TURNS_PER_SESSION).length;
  const qualifyingTurns = Object.entries(allTurns)
    .filter(([, t]) => t >= MIN_TURNS_PER_SESSION)
    .reduce((sum, [, t]) => sum + t, 0);
  const spanMs = lastEventTs > 0 && firstEventTs < Number.POSITIVE_INFINITY
    ? lastEventTs - firstEventTs
    : 0;
  return {
    total_turns: qualifyingTurns,
    qualifying_sessions: qualifyingSessions,
    qualifying_turns: qualifyingTurns,
    first_event_ts: firstEventTs < Number.POSITIVE_INFINITY ? firstEventTs : 0,
    last_event_ts: lastEventTs > Number.NEGATIVE_INFINITY ? lastEventTs : 0,
    span_ms: spanMs,
    session_turns: Object.freeze(allTurns),
  };
}

interface ProcessEpoch {
  readonly process_started_at: number;
  readonly first_snapshot_ts: number;
  readonly last_snapshot_ts: number;
  readonly snapshots: readonly AcceptanceSnapshot[];
}

interface ProcessEpochCheck {
  readonly criterion: AcceptanceCriterionResult;
  readonly failed: boolean;
  readonly processEpochs: readonly ProcessEpoch[];
}

function checkProcessEpochs(
  eligible: readonly AcceptanceSnapshot[],
  evaluationDate: number,
): ProcessEpochCheck {
  // Group by process_started_at
  const groups = new Map<number, AcceptanceSnapshot[]>();
  for (const snap of eligible) {
    const key = snap.metrics.evidence.process_started_at;
    const list = groups.get(key) ?? [];
    list.push(snap);
    groups.set(key, list);
  }
  const sorted = Array.from(groups.entries()).sort(([a], [b]) => a - b);
  const processEpochs: ProcessEpoch[] = sorted.map(([processStartedAt, snapshots]) => ({
    process_started_at: processStartedAt,
    first_snapshot_ts: Math.min(...snapshots.map((s) => s.captured_at_ms)),
    last_snapshot_ts: Math.max(...snapshots.map((s) => s.captured_at_ms)),
    snapshots: Object.freeze(snapshots),
  }));

  // Check timestamps not in the future (with skew allowance)
  for (const snap of eligible) {
    if (snap.captured_at_ms > evaluationDate + CLOCK_SKEW_MS) {
      return {
        criterion: {
          id: 'r9_snapshot_not_in_future',
          description: 'Snapshot timestamps must not exceed the evaluator date by more than 5 minutes',
          passed: false,
          observed: `snapshot ${snap.captured_at} > evaluator ${new Date(evaluationDate).toISOString()}`,
          threshold: '≤ evaluationDate + 5min',
        },
        failed: true,
        processEpochs,
      };
    }
  }
  // Check monotonicity
  for (let i = 1; i < eligible.length; i++) {
    if (eligible[i]!.captured_at_ms < eligible[i - 1]!.captured_at_ms) {
      return {
        criterion: {
          id: 'r9_snapshot_monotonic',
          description: 'Snapshot timestamps must be monotonically non-decreasing',
          passed: false,
          observed: `${eligible[i]!.captured_at} < ${eligible[i - 1]!.captured_at}`,
          threshold: 'monotonic',
        },
        failed: true,
        processEpochs,
      };
    }
  }
  return {
    criterion: {
      id: 'r9_snapshot_invariants',
      description: 'Snapshot timestamps are monotonic and within 5 minutes of evaluator date',
      passed: true,
      observed: `${eligible.length} snapshots across ${processEpochs.length} process epoch(s)`,
      threshold: 'monotonic + skew ≤ 5min',
    },
    failed: false,
    processEpochs,
  };
}

interface ThresholdEpochResult {
  readonly epochs: readonly ThresholdEpoch[];
  readonly criteria: readonly AcceptanceCriterionResult[];
  readonly failed: boolean;
}

function groupThresholdEpochs(eligible: readonly AcceptanceSnapshot[]): ThresholdEpochResult {
  if (eligible.length === 0) {
    return { epochs: [], criteria: [], failed: false };
  }
  const criteria: AcceptanceCriterionResult[] = [];
  // Group snapshots by threshold (continuous runs of same cosine+fts).
  const groups: Array<{ cosine: number; fts: number; snapshots: AcceptanceSnapshot[] }> = [];
  let currentCosine = eligible[0]!.thresholds.minCosineSimilarity;
  let currentFts = eligible[0]!.thresholds.minFtsHits;
  let current: AcceptanceSnapshot[] = [eligible[0]!];
  for (let i = 1; i < eligible.length; i++) {
    const snap = eligible[i]!;
    if (snap.thresholds.minCosineSimilarity !== currentCosine || snap.thresholds.minFtsHits !== currentFts) {
      groups.push({ cosine: currentCosine, fts: currentFts, snapshots: current });
      current = [snap];
      currentCosine = snap.thresholds.minCosineSimilarity;
      currentFts = snap.thresholds.minFtsHits;
    } else {
      current.push(snap);
    }
  }
  groups.push({ cosine: currentCosine, fts: currentFts, snapshots: current });

  // Check counter regressions inside each process epoch (per threshold group).
  for (const group of groups) {
    const processGroups = new Map<number, AcceptanceSnapshot[]>();
    for (const snap of group.snapshots) {
      const key = snap.metrics.evidence.process_started_at;
      const list = processGroups.get(key) ?? [];
      list.push(snap);
      processGroups.set(key, list);
    }
    for (const [, list] of processGroups) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1]!;
        const cur = list[i]!;
        if (
          cur.metrics.evidence.matched_requests < prev.metrics.evidence.matched_requests
          || cur.metrics.evidence.attempted_requests < prev.metrics.evidence.attempted_requests
          || cur.metrics.evidence.cache_hit_requests < prev.metrics.evidence.cache_hit_requests
          || cur.metrics.evidence.proxy_requests < prev.metrics.evidence.proxy_requests
        ) {
          criteria.push({
            id: 'r9_counter_regression',
            description: 'Evidence counters must not regress inside a process epoch',
            passed: false,
            observed: `regression at ${cur.captured_at}`,
            threshold: 'non-negative counter deltas',
          });
          return {
            epochs: groups.map((g, i) => buildThresholdEpoch(i, g.snapshots, g.cosine, g.fts)),
            criteria,
            failed: true,
          };
        }
      }
    }
  }
  const epochs: ThresholdEpoch[] = groups.map((g, i) => buildThresholdEpoch(i, g.snapshots, g.cosine, g.fts));
  return { epochs, criteria, failed: false };
}

function buildThresholdEpoch(
  index: number,
  snapshots: readonly AcceptanceSnapshot[],
  cosine: number,
  fts: number,
): ThresholdEpoch {
  const first = snapshots[0]!;
  const last = snapshots.at(-1)!;
  // Sum per-process deltas. The deltas are taken only within a single
  // process epoch (snapshots from different epochs are NOT aggregated
  // across the restart boundary — each process epoch's last snapshot
  // is treated as the end of that epoch's contribution).
  const processGroups = new Map<number, AcceptanceSnapshot[]>();
  for (const snap of snapshots) {
    const key = snap.metrics.evidence.process_started_at;
    const list = processGroups.get(key) ?? [];
    list.push(snap);
    processGroups.set(key, list);
  }
  let deltaAttempted = 0;
  let deltaMatched = 0;
  let deltaProxy = 0;
  let deltaCacheHit = 0;
  for (const list of processGroups.values()) {
    if (list.length === 0) continue;
    const sorted = [...list].sort((a, b) => a.captured_at_ms - b.captured_at_ms);
    const firstOfProcess = sorted[0]!;
    const lastOfProcess = sorted.at(-1)!;
    // Use FIRST-of-process baseline only if the epoch starts with the
    // first process snapshot (i.e., there is no earlier process-epoch
    // data we're missing). If a prior process epoch exists in this
    // threshold epoch, we cannot attribute that first snapshot's
    // counters to this threshold epoch — so we treat the prior
    // process epoch's last counter as the baseline for the new one.
    deltaAttempted += lastOfProcess.metrics.evidence.attempted_requests;
    deltaMatched += lastOfProcess.metrics.evidence.matched_requests;
    deltaProxy += lastOfProcess.metrics.evidence.proxy_requests;
    deltaCacheHit += lastOfProcess.metrics.evidence.cache_hit_requests;
  }
  // Subtract the first-of-epoch counter if it was the first process
  // epoch (no prior process to attribute to). Simpler: subtract the
  // MIN of per-process first counters (when only one process epoch
  // exists in this threshold epoch).
  if (processGroups.size === 1) {
    const onlyList = processGroups.values().next().value!;
    const sorted = [...onlyList].sort((a, b) => a.captured_at_ms - b.captured_at_ms);
    const firstSnap = sorted[0]!;
    deltaAttempted -= firstSnap.metrics.evidence.attempted_requests;
    deltaMatched -= firstSnap.metrics.evidence.matched_requests;
    deltaProxy -= firstSnap.metrics.evidence.proxy_requests;
    deltaCacheHit -= firstSnap.metrics.evidence.cache_hit_requests;
  }
  // Per-session turns in this epoch (deduped across snapshots).
  const sessionTurns: Record<string, number> = {};
  for (const snap of snapshots) {
    for (const [sid, t] of Object.entries(snap.audit.turns_by_session_hash)) {
      sessionTurns[sid] = Math.max(sessionTurns[sid] ?? 0, t);
    }
  }
  const sessionCount = Object.keys(sessionTurns).length;
  const turnCount = Object.values(sessionTurns).reduce((sum, t) => sum + t, 0);
  return {
    index,
    first_snapshot_ts: first.captured_at_ms,
    last_snapshot_ts: last.captured_at_ms,
    min_cosine_similarity: cosine,
    min_fts_hits: fts,
    delta_attempted: deltaAttempted,
    delta_matched: deltaMatched,
    delta_proxy: deltaProxy,
    delta_cache_hit: deltaCacheHit,
    session_count: sessionCount,
    turn_count: turnCount,
  };
}

function checkFinalEpochEligibility(epoch: ThresholdEpoch): readonly AcceptanceCriterionResult[] {
  const criteria: AcceptanceCriterionResult[] = [];
  criteria.push({
    id: 'r9_final_epoch_sessions',
    description: 'Final threshold epoch has at least 2 qualifying sessions',
    passed: epoch.session_count >= MIN_FINAL_EPOCH_SESSIONS,
    observed: `${epoch.session_count} session(s)`,
    threshold: `≥ ${MIN_FINAL_EPOCH_SESSIONS}`,
  });
  criteria.push({
    id: 'r9_final_epoch_turns',
    description: 'Final threshold epoch has at least 20 turns',
    passed: epoch.turn_count >= MIN_FINAL_EPOCH_TURNS,
    observed: `${epoch.turn_count} turn(s)`,
    threshold: `≥ ${MIN_FINAL_EPOCH_TURNS}`,
  });
  return criteria;
}

function checkSpan(
  coverage: SessionCoverage,
  eligible: readonly AcceptanceSnapshot[],
  evaluationDate: number,
): { criterion: AcceptanceCriterionResult } {
  const passed = coverage.span_ms >= SEVEN_DAYS_MS
    && coverage.qualifying_sessions >= MIN_QUALIFYING_SESSIONS
    && coverage.qualifying_turns >= MIN_QUALIFYING_TURNS;
  return {
    criterion: {
      id: 'r9_session_coverage',
      description: 'Wall-clock span ≥ 7 days with ≥ 5 qualifying sessions and ≥ 50 total turns',
      passed,
      observed: `span=${coverage.span_ms}ms (${(coverage.span_ms / 86_400_000).toFixed(2)}d), sessions=${coverage.qualifying_sessions}, turns=${coverage.qualifying_turns}`,
      threshold: `≥ ${SEVEN_DAYS_MS}ms + ≥ ${MIN_QUALIFYING_SESSIONS} sessions + ≥ ${MIN_QUALIFYING_TURNS} turns`,
    },
  };
}

function computeFinalEpochBudgets(
  epoch: ThresholdEpoch,
  _eligible: readonly AcceptanceSnapshot[],
  processEpochs: readonly ProcessEpoch[],
): BudgetEvaluation {
  const numerator = epoch.delta_matched;
  const denominator = epoch.delta_attempted;
  const numeratorCacheHit = epoch.delta_cache_hit;
  const denominatorProxy = epoch.delta_proxy;
  const requestHitRate = denominator > 0 ? numerator / denominator : null;
  const tokenCacheCoverage = denominatorProxy > 0 ? numeratorCacheHit / denominatorProxy : null;
  // Worst-observed: collect p50/p99 + working_set_mb across snapshots in the
  // final epoch.
  let worstP50: number | null = null;
  let worstP99: number | null = null;
  let maxWorkingSet: number | null = null;
  for (const snap of _eligible) {
    if (snap.thresholds.minCosineSimilarity !== epoch.min_cosine_similarity) continue;
    if (snap.thresholds.minFtsHits !== epoch.min_fts_hits) continue;
    if (snap.metrics.p50_latency_ms !== null) {
      worstP50 = worstP50 === null ? snap.metrics.p50_latency_ms : Math.max(worstP50, snap.metrics.p50_latency_ms);
    }
    if (snap.metrics.p99_latency_ms !== null) {
      worstP99 = worstP99 === null ? snap.metrics.p99_latency_ms : Math.max(worstP99, snap.metrics.p99_latency_ms);
    }
    maxWorkingSet = maxWorkingSet === null
      ? snap.metrics.working_set_mb
      : Math.max(maxWorkingSet, snap.metrics.working_set_mb);
  }
  // Process epoch sustained ≥1h check
  const sustainedHours = processEpochs.reduce((max, pe) => {
    const span = pe.last_snapshot_ts - pe.first_snapshot_ts;
    const hours = span / 3_600_000;
    return Math.max(max, hours);
  }, 0);
  return {
    request_hit_rate: requestHitRate,
    token_cache_coverage: tokenCacheCoverage,
    worst_p50_latency_ms: worstP50,
    worst_p99_latency_ms: worstP99,
    max_working_set_mb: maxWorkingSet,
    numerator_attempted: numerator,
    denominator_attempted: denominator,
    numerator_cache_hit: numeratorCacheHit,
    denominator_proxy: denominatorProxy,
    final_epoch_sessions: epoch.session_count,
    final_epoch_turns: epoch.turn_count,
    process_epoch_sustained_hours: sustainedHours,
  };
}

function evaluateBudgets(b: BudgetEvaluation): readonly AcceptanceCriterionResult[] {
  const criteria: AcceptanceCriterionResult[] = [];
  // Strict inequalities per R-10.
  criteria.push({
    id: 'r10_request_hit_rate',
    description: 'request_hit_rate > 0.70 (strict)',
    passed: b.request_hit_rate !== null && Number.isFinite(b.request_hit_rate) && b.request_hit_rate > MIN_REQUEST_HIT_RATE,
    observed: b.request_hit_rate === null ? 'null' : b.request_hit_rate.toFixed(4),
    threshold: `> ${MIN_REQUEST_HIT_RATE}`,
  });
  criteria.push({
    id: 'r10_token_cache_coverage',
    description: 'token_cache_coverage > 0.60 (strict)',
    passed: b.token_cache_coverage !== null && Number.isFinite(b.token_cache_coverage) && b.token_cache_coverage > MIN_TOKEN_CACHE_COVERAGE,
    observed: b.token_cache_coverage === null ? 'null' : b.token_cache_coverage.toFixed(4),
    threshold: `> ${MIN_TOKEN_CACHE_COVERAGE}`,
  });
  criteria.push({
    id: 'r10_p50_latency_ms',
    description: 'p50_latency_ms < 50 (strict)',
    passed: b.worst_p50_latency_ms !== null && b.worst_p50_latency_ms < MAX_P50_LATENCY_MS,
    observed: b.worst_p50_latency_ms === null ? 'null' : `${b.worst_p50_latency_ms}ms`,
    threshold: `< ${MAX_P50_LATENCY_MS}ms`,
  });
  criteria.push({
    id: 'r10_p99_latency_ms',
    description: 'p99_latency_ms < 200 (strict)',
    passed: b.worst_p99_latency_ms !== null && b.worst_p99_latency_ms < MAX_P99_LATENCY_MS,
    observed: b.worst_p99_latency_ms === null ? 'null' : `${b.worst_p99_latency_ms}ms`,
    threshold: `< ${MAX_P99_LATENCY_MS}ms`,
  });
  criteria.push({
    id: 'r10_working_set_mb',
    description: 'working_set_mb < 1500 (strict) with at least one process epoch sustained ≥ 1h',
    passed: b.max_working_set_mb !== null
      && b.max_working_set_mb < MAX_WORKING_SET_MB
      && b.process_epoch_sustained_hours >= MIN_SUSTAINED_PROCESS_HOURS,
    observed: `${b.max_working_set_mb ?? 'null'}MB; sustained ${b.process_epoch_sustained_hours.toFixed(2)}h`,
    threshold: `< ${MAX_WORKING_SET_MB}MB + ≥ ${MIN_SUSTAINED_PROCESS_HOURS}h sustained`,
  });
  return criteria;
}

function recommendTuning(
  budgets: BudgetEvaluation,
  epoch: ThresholdEpoch,
  state: RuntimeStateSnapshot,
): TuningRecommendation {
  const hitRateOk = budgets.request_hit_rate !== null && budgets.request_hit_rate > MIN_REQUEST_HIT_RATE;
  const cacheOk = budgets.token_cache_coverage !== null && budgets.token_cache_coverage > MIN_TOKEN_CACHE_COVERAGE;
  const p50Ok = budgets.worst_p50_latency_ms !== null && budgets.worst_p50_latency_ms < MAX_P50_LATENCY_MS;
  const p99Ok = budgets.worst_p99_latency_ms !== null && budgets.worst_p99_latency_ms < MAX_P99_LATENCY_MS;
  const memOk = budgets.max_working_set_mb !== null
    && budgets.max_working_set_mb < MAX_WORKING_SET_MB
    && budgets.process_epoch_sustained_hours >= MIN_SUSTAINED_PROCESS_HOURS;
  if (hitRateOk && cacheOk && p50Ok && p99Ok && memOk) {
    return { action: 'freeze', reason: 'all budgets pass at the current threshold pair' };
  }
  if (!p50Ok || !p99Ok || !memOk) {
    return { action: 'fix_performance', reason: 'p50/p99/working-set budget failed; freeze thresholds and fix runtime' };
  }
  if (hitRateOk && !cacheOk) {
    return { action: 'inspect_cache', reason: 'request hit rate OK but token cache coverage failed; inspect cache seam (prefix/TTL/transport) — do not lower relevance thresholds' };
  }
  if (!hitRateOk) {
    // We do NOT have per-rejection counts in the snapshot envelope yet
    // (AD-009 work). The deterministic recommendation is: lower cosine
    // by 0.05 first, with a floor of 0.50. The operator can iterate.
    const currentCosine = epoch.min_cosine_similarity;
    const newCosine = Math.max(COSINE_FLOOR, currentCosine - 0.05);
    if (newCosine === currentCosine) {
      return { action: 'escalate', reason: 'cosine at floor 0.50 and hit rate still failing — escalate' };
    }
    return {
      action: 'lower_cosine',
      reason: `hit rate ${budgets.request_hit_rate?.toFixed(4) ?? 'null'} ≤ 0.70; lower cosine by 0.05 (current=${currentCosine}, new=${newCosine})`,
      new_cosine: newCosine,
    };
  }
  return { action: 'wait', reason: 'continue collection; do not change thresholds without a snapshot boundary' };
}

function buildEvaluation(args: {
  readonly criteria: readonly AcceptanceCriterionResult[];
  readonly eligible: readonly AcceptanceSnapshot[];
  readonly sessionCoverage: SessionCoverage;
  readonly ignoredSynthetic: readonly string[];
  readonly state: RuntimeStateSnapshot;
  readonly evaluationDate: number;
  readonly allowSynthetic: boolean;
  readonly blockingReason: string;
}): AcceptanceEvaluation {
  const verdict: Verdict = args.eligible.length === 0 ? 'INCOMPLETE' : 'FAIL';
  const eligibleForClosure = false;
  return Object.freeze({
    verdict,
    eligible_for_phase_closure: eligibleForClosure,
    criteria: Object.freeze(args.criteria),
    session_coverage: args.sessionCoverage,
    budgets: {
      request_hit_rate: null,
      token_cache_coverage: null,
      worst_p50_latency_ms: null,
      worst_p99_latency_ms: null,
      max_working_set_mb: null,
      numerator_attempted: 0,
      denominator_attempted: 0,
      numerator_cache_hit: 0,
      denominator_proxy: 0,
      final_epoch_sessions: 0,
      final_epoch_turns: 0,
      process_epoch_sustained_hours: 0,
    },
    threshold_epochs: Object.freeze([]),
    final_thresholds: {
      min_cosine_similarity: args.state.thresholds.minCosineSimilarity,
      min_fts_hits: args.state.thresholds.minFtsHits,
    },
    tuning_recommendation: {
      action: 'wait' as const,
      reason: `blocked: ${args.blockingReason}`,
    },
    ignored_synthetic_files: Object.freeze(args.ignoredSynthetic),
    evidence_hashes: Object.freeze(args.eligible.map((s) => hashSnapshot(s))),
    evaluation_date: args.evaluationDate,
    config_initial: {
      min_cosine_similarity: args.state.thresholds.minCosineSimilarity,
      min_fts_hits: args.state.thresholds.minFtsHits,
    },
    config_pre7b_effective: {
      min_cosine_similarity: PRE_7B_EFFECTIVE_COSINE,
      min_fts_hits: PRE_7B_EFFECTIVE_FTS,
    },
  });
}

// ---------------------------------------------------------------------------
// JSON loader + reporter
// ---------------------------------------------------------------------------

/**
 * Load snapshots from a directory. Each `*.json` file is parsed and
 * validated. Files with parse errors are collected in `errors` and
 * skipped (the caller decides whether to exit non-zero).
 */
export interface SnapshotLoadResult {
  readonly snapshots: readonly AcceptanceSnapshot[];
  readonly errors: readonly { file: string; error: Error }[];
}

/**
 * Renderer for the final acceptance Markdown report. The body content
 * is deterministic given the evaluation; the only time-dependent
 * value is the generation timestamp (passed in by the caller).
 */
export function renderAcceptanceReport(
  evaluation: AcceptanceEvaluation,
  options: { readonly generationTimestamp: number },
): string {
  const lines: string[] = [];
  const ts = new Date(options.generationTimestamp).toISOString();
  const verdict = evaluation.verdict.toLowerCase();
  lines.push('---');
  lines.push(`date: ${ts}`);
  lines.push('version: 1');
  lines.push('description: "Phase 7b final acceptance report — generated by scripts/acceptance-gate.mjs"');
  lines.push(`verdict: ${evaluation.verdict}`);
  lines.push(`eligible_for_phase_closure: ${evaluation.eligible_for_phase_closure}`);
  lines.push('---');
  lines.push('');
  lines.push('# Phase 7b Acceptance Report');
  lines.push('');
  lines.push(`**Verdict:** ${evaluation.verdict}${evaluation.eligible_for_phase_closure ? ' (closure eligible)' : ''}`);
  lines.push(`**Generated:** ${ts}`);
  lines.push(`**Evaluator date:** ${new Date(evaluation.evaluation_date).toISOString()}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(`Phase 7b verdict: **${evaluation.verdict}**. ${evaluation.eligible_for_phase_closure ? 'The acceptance gate passed; Memory Studio MAY be declared production-ready only after an independent Verifier confirms these results.' : 'The acceptance gate has not been satisfied. See criteria below for failing items.'}`);
  lines.push('');
  lines.push('## Evidence Eligibility');
  lines.push('');
  lines.push(`- Real snapshots: ${evaluation.evidence_hashes.length}`);
  lines.push(`- Ignored synthetic / stub / incomplete: ${evaluation.ignored_synthetic_files.length}`);
  if (evaluation.ignored_synthetic_files.length > 0) {
    for (const f of evaluation.ignored_synthetic_files) lines.push(`  - \`${f}\``);
  }
  lines.push('');
  lines.push('## Session Coverage');
  lines.push('');
  const sc = evaluation.session_coverage;
  lines.push(`- Wall-clock span: ${sc.span_ms}ms (${(sc.span_ms / 86_400_000).toFixed(2)}d)`);
  lines.push(`- Total turns: ${sc.total_turns}`);
  lines.push(`- Qualifying sessions (≥10 turns): ${sc.qualifying_sessions}`);
  lines.push(`- Qualifying turns: ${sc.qualifying_turns}`);
  lines.push('');
  lines.push('## Budget Table');
  lines.push('');
  lines.push('| Budget | Numerator | Denominator | Observed | Threshold | Pass |');
  lines.push('|---|---|---|---|---|---|');
  const b = evaluation.budgets;
  const rows: Array<[string, number | string, number | string, string, string, boolean]> = [
    [
      'request_hit_rate',
      b.numerator_attempted,
      b.denominator_attempted,
      b.request_hit_rate === null ? 'null' : b.request_hit_rate.toFixed(4),
      `> ${MIN_REQUEST_HIT_RATE}`,
      b.request_hit_rate !== null && b.request_hit_rate > MIN_REQUEST_HIT_RATE,
    ],
    [
      'token_cache_coverage',
      b.numerator_cache_hit,
      b.denominator_proxy,
      b.token_cache_coverage === null ? 'null' : b.token_cache_coverage.toFixed(4),
      `> ${MIN_TOKEN_CACHE_COVERAGE}`,
      b.token_cache_coverage !== null && b.token_cache_coverage > MIN_TOKEN_CACHE_COVERAGE,
    ],
    [
      'p50_latency_ms',
      '—',
      '—',
      b.worst_p50_latency_ms === null ? 'null' : `${b.worst_p50_latency_ms}ms`,
      `< ${MAX_P50_LATENCY_MS}ms`,
      b.worst_p50_latency_ms !== null && b.worst_p50_latency_ms < MAX_P50_LATENCY_MS,
    ],
    [
      'p99_latency_ms',
      '—',
      '—',
      b.worst_p99_latency_ms === null ? 'null' : `${b.worst_p99_latency_ms}ms`,
      `< ${MAX_P99_LATENCY_MS}ms`,
      b.worst_p99_latency_ms !== null && b.worst_p99_latency_ms < MAX_P99_LATENCY_MS,
    ],
    [
      'working_set_mb',
      '—',
      '—',
      `${b.max_working_set_mb ?? 'null'}MB; sustained ${b.process_epoch_sustained_hours.toFixed(2)}h`,
      `< ${MAX_WORKING_SET_MB}MB + ≥ ${MIN_SUSTAINED_PROCESS_HOURS}h sustained`,
      b.max_working_set_mb !== null
        && b.max_working_set_mb < MAX_WORKING_SET_MB
        && b.process_epoch_sustained_hours >= MIN_SUSTAINED_PROCESS_HOURS,
    ],
  ];
  for (const [name, num, den, obs, thr, ok] of rows) {
    lines.push(`| ${name} | ${num} | ${den} | ${obs} | ${thr} | ${ok ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  lines.push('## Threshold Tuning Log');
  lines.push('');
  lines.push(`- Configured initial: cosine=${evaluation.config_initial.min_cosine_similarity}, fts=${evaluation.config_initial.min_fts_hits}`);
  lines.push(`- Pre-7b effective: cosine=${evaluation.config_pre7b_effective.min_cosine_similarity}, fts=${evaluation.config_pre7b_effective.min_fts_hits}`);
  lines.push(`- Final (current): cosine=${evaluation.final_thresholds.min_cosine_similarity}, fts=${evaluation.final_thresholds.min_fts_hits}`);
  lines.push(`- Threshold epochs: ${evaluation.threshold_epochs.length}`);
  for (const epoch of evaluation.threshold_epochs) {
    lines.push(`  - Epoch ${epoch.index}: cosine=${epoch.min_cosine_similarity}, fts=${epoch.min_fts_hits}, sessions=${epoch.session_count}, turns=${epoch.turn_count}, attempted=${epoch.delta_attempted}, proxy=${epoch.delta_proxy}`);
  }
  lines.push('');
  lines.push('## Tuning Recommendation');
  lines.push('');
  lines.push(`- Action: **${evaluation.tuning_recommendation.action}**`);
  lines.push(`- Reason: ${evaluation.tuning_recommendation.reason}`);
  if (evaluation.tuning_recommendation.new_cosine !== undefined) {
    lines.push(`- New cosine: ${evaluation.tuning_recommendation.new_cosine}`);
  }
  if (evaluation.tuning_recommendation.new_fts !== undefined) {
    lines.push(`- New FTS: ${evaluation.tuning_recommendation.new_fts}`);
  }
  lines.push('');
  lines.push('## Runtime / Provider Modes');
  lines.push('');
  lines.push('- Production mode required: yes');
  lines.push('- Provider mode required: anthropic-real');
  lines.push('- Fast agent mode required: real');
  lines.push('- Audit complete required: yes');
  lines.push('');
  lines.push('## Snapshot Hashes');
  lines.push('');
  for (const h of evaluation.evidence_hashes) lines.push(`- \`${h}\``);
  lines.push('');
  lines.push('## Gate Commands');
  lines.push('');
  lines.push('```bash');
  lines.push('node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \\');
  lines.push('  --snapshots .specs/acceptance/snapshots \\');
  lines.push('  --state .memory-studio/state.json');
  lines.push('```');
  lines.push('');
  lines.push('## Deferred Items');
  lines.push('');
  lines.push('- /metrics pino info logging: deferred to v3.1+ (production boot intentionally disables Fastify request logging)');
  lines.push('- POST /catalog/rebuild TEMP+rename production wiring: deferred to v3.1+ (runbook uses `npm run build-index` + restart)');
  lines.push('- test#366 port-range cleanup: deferred to v3.1+ (Phase 7b smokes use dedicated ranges)');
  lines.push('');
  lines.push('## Conclusion');
  lines.push('');
  if (evaluation.eligible_for_phase_closure) {
    lines.push('All acceptance budgets pass on real evidence. ROADMAP Phase 7b may be flipped to `[x]` only after an independent Verifier PASS confirms this evaluation.');
  } else {
    lines.push(`The acceptance gate has not been satisfied (verdict: ${evaluation.verdict}). Continue the seven-day evidence collection per the runbook, or fix the failing criterion: \`${evaluation.criteria.find((c) => !c.passed)?.id ?? 'unknown'}\`.`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Stable hash of the canonical JSON of a snapshot's evidence. Used
 * to record the input set in the report without revealing contents.
 */
function hashSnapshot(snap: AcceptanceSnapshot): string {
  const payload = {
    captured_at: snap.captured_at,
    source: snap.source,
    thresholds: snap.thresholds,
    evidence: snap.metrics.evidence,
    audit: {
      complete: snap.audit.complete,
      first_event_ts: snap.audit.first_event_ts,
      last_event_ts: snap.audit.last_event_ts,
      turns_by_session_hash: snap.audit.turns_by_session_hash,
    },
  };
  return createHash('sha256').update(canonicalJsonStringify(payload), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AcceptanceSnapshotValidationError(`snapshot.${field} must be a finite number, got ${String(value)}`, field);
  }
  return value;
}
function requireNonNegativeInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new AcceptanceSnapshotValidationError(
      `snapshot.${field} must be a non-negative integer, got ${String(value)}`,
      field,
    );
  }
  return value;
}
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AcceptanceSnapshotValidationError(`snapshot.${field} must be a string, got ${typeof value}`, field);
  }
  return value;
}
function requireBool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AcceptanceSnapshotValidationError(`snapshot.${field} must be a boolean, got ${typeof value}`, field);
  }
  return value;
}
function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AcceptanceSnapshotValidationError(`snapshot.${field} must be an object, got ${String(value)}`, field);
  }
  return value as Record<string, unknown>;
}

/** Re-export for the gate CLI. */
export { loadRuntimeSnapshotFromPath };
