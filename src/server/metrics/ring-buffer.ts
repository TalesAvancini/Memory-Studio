/**
 * Metrics ring buffer (Phase 7a — Metrics Instrumentation; Phase 7b
 * T-04 — schema v2 + acceptance evidence).
 *
 * Mirrors `AuditRingBuffer` (`src/server/audit/buffer.ts`) but stores
 * the 5 metrics counters + a 100-element latency ring buffer (for
 * p50/p99 percentile calculation).
 *
 * Per `.specs/features/phase-7a-metrics/spec.md` R-1..R-8, the buffer
 * tracks:
 *
 *   - R-1 `request_hit_rate`     — matched/attempted counter pair.
 *                                  `attempted` excludes social /
 *                                  no_active_items / timeout per
 *                                  spec.md R-1 denominator table.
 *   - R-2 `token_cache_coverage` — cache_hit/proxy counter pair.
 *   - R-3 `p50_latency_ms`       — nearest-rank percentile of the
 *                                  latency ring (last 100 samples,
 *                                  ALL paths per spec.md R-3).
 *   - R-4 `p99_latency_ms`       — same ring, different percentile.
 *   - R-5 `working_set_mb`       — process.memoryUsage().rss sampled
 *                                  at recompute time (integer floor).
 *   - R-6 Refresh trigger        — count (every N=10 requests) OR
 *                                  time (setInterval 60_000ms),
 *                                  whichever fires first.
 *   - R-8 Transient persistence  — resets on server stop / restart.
 *                                  No SQLite persistence.
 *
 * Counters are cumulative since the last `resetForTests()`. The
 * `recomputeDashboard()` method produces a `MetricsSnapshot`; the
 * `/metrics` route reads the cached snapshot for O(1) responses.
 *
 * Phase 7b T-04 — schema v2 + acceptance evidence:
 *   - schema_version bumped from 1 to 2
 *   - `evidence` block exposes raw non-sensitive counters
 *     (`matched_requests`, `attempted_requests`, `cache_hit_requests`,
 *     `proxy_requests`, `latency_sample_count`, `process_started_at`)
 *     so the acceptance evaluator can compute exact non-negative
 *     counter deltas across threshold epochs + process restarts.
 *   - `process_started_at` is set in the constructor (process epoch
 *     anchor). A new process epoch (e.g. server restart) makes the
 *     counter reset visible in the metric.
 *   - `recordProxy()` ALWAYS increments `proxyRequests` on a
 *     completed 200 — even when the upstream response omits
 *     `usage.cache_read_input_tokens` (R-2 denominator fix from
 *     Phase 7a gap). A missing/zero usage counts as a zero-valued
 *     miss (NOT null and NOT a no-op).
 *   - Phase 7a spec §3 wording ("sliding N=10/T=60s") is RESOLVED:
 *     ratio counters are cumulative-per-process; N=10/T=60s is the
 *     recompute cadence only. Latency percentiles are over the
 *     last-100 ring buffer (still nearest-rank). Documented in
 *     spec.md §3 + design.md §7.
 *   - p50/p99 are finite non-negative fractional milliseconds.
 *     `Math.floor` was previously applied to latency values —
 *     that has been REMOVED. The implementation already retained
 *     fractional values; the only correction is in stale comments
 *     and the working_set_mb (which is intentionally integer-floor
 *     because it's MB granularity, not a measurement).
 *
 * Naming divergence from PRD §14.6 (intentional, documented in
 * spec.md §5):
 *   - Phase 7a `request_hit_rate` = MATCH-pipeline hit rate
 *     (matched.count > 0 / attempted_requests). PRD §14.6's "Request
 *     hit rate" is provider cache hit (a separate metric — see
 *     `token_cache_coverage`).
 *   - Phase 7a `token_cache_coverage` uses a REQUEST-WEIGHTED ratio
 *     (cache_hit_requests / proxy_requests). PRD §14.6's exact
 *     formula is token-weighted (Σ cache_read_input_tokens ÷
 *     Σ total_prompt_tokens), deferred to v3.1+.
 *
 * Fail-open (D-007 mirror):
 *   - All counter / ring mutations are best-effort. The collector
 *     (`collector.ts`) wraps every call in a try/catch — the buffer
 *     NEVER throws into the request hot path.
 *
 * Hot-path budget (AC-13):
 *   - `recordAugment()`: ~2μs total (one number increment + one
 *     ring-buffer write + one modulo check). Phase 6b measured
 *     ≤ 0.22ms total overhead; +0.10ms budget for metrics hook.
 */

export const METRICS_LATENCY_BUFFER_CAPACITY = 100;
export const METRICS_RECOMPUTE_COUNT_TRIGGER = 10;
export const METRICS_RECOMPUTE_TIME_MS = 60_000;

/** Why a recompute was triggered. */
export type RecomputeReason = 'count-trigger' | 'time-trigger' | 'manual';

/**
 * Schema v2 evidence block (Phase 7b T-04). Raw non-sensitive
 * counters + process epoch anchor so the acceptance evaluator can
 * compute exact non-negative deltas across process restarts and
 * threshold changes. These values are NOT sent to clients; they
 * are exposed on the `/metrics` response for snapshot capture.
 */
export interface MetricsEvidenceV2 {
  readonly matched_requests: number;
  readonly attempted_requests: number;
  readonly cache_hit_requests: number;
  readonly proxy_requests: number;
  readonly latency_sample_count: number;
  readonly process_started_at: number;
}

/**
 * Snapshot returned by `MetricsRingBuffer.snapshot()` and surfaced by
 * `GET /metrics`. All rates are 0..1 floats (or `null` when the
 * denominator is zero — NOT 0, which would falsely signal 100% miss).
 * Percentiles are finite non-negative fractional milliseconds (or
 * `null` when no samples in window). `working_set_mb` is an integer
 * floor at MB granularity.
 */
export interface MetricsSnapshot {
  readonly request_hit_rate: number | null;
  readonly token_cache_coverage: number | null;
  readonly p50_latency_ms: number | null;
  readonly p99_latency_ms: number | null;
  readonly working_set_mb: number;
  readonly window: {
    readonly request_count: number;
    readonly proxy_request_count: number;
    readonly window_age_ms: number;
  };
  readonly proxy_enabled: boolean;
  readonly evidence: MetricsEvidenceV2;
  readonly schema_version: 2;
  readonly timestamp: number;
}

/**
 * Reasons a /augment request may be excluded from the R-1
 * denominator (per spec.md R-1 + EC-2/3):
 *
 *   - 'social'           — social bypass (Stage 1)
 *   - 'no_active_items'  — empty / invalid active catalog (Stages 2/3)
 *   - 'timeout'          — fail-open (Stages 4/5 retrieval error)
 *   - 'measured'         — reached Stage 6 (after retrieval attempt).
 *                          `matched` indicates whether matched.count > 0.
 *
 * The collector (`collector.ts`) converts the `emptyReason` from the
 * AugmentResponse into one of these strings.
 */
export type AugmentOutcome =
  | 'social'
  | 'no_active_items'
  | 'timeout'
  | 'measured';

export class MetricsRingBuffer {
  // --- Counters (cumulative since last reset) -----------------------------
  private matchedRequests = 0;             // numerator of R-1
  private attemptedRequests = 0;           // denominator of R-1
  private totalAugmentRequests = 0;        // window.request_count (ALL paths)
  private cacheHitRequests = 0;            // numerator of R-2
  private proxyRequests = 0;               // denominator of R-2

  // --- Latency ring buffer (last N samples, O(1) push) --------------------
  // Plain number[] for ergonomic sort + index access. 100 capacity
  // gives p99 nearest-rank headroom when bursts hit (10 samples is
  // degenerate — index 9 is always the last sample). Values are
  // finite non-negative fractional milliseconds (Phase 7b T-04
  // fractional precision contract — AC-8).
  private readonly latencySamples: number[] = new Array(METRICS_LATENCY_BUFFER_CAPACITY).fill(0);
  private latencyWriteIdx = 0;
  private latencyCount = 0;

  // --- Refresh trigger state ----------------------------------------------
  private recomputeTimer: ReturnType<typeof setInterval> | null = null;
  private totalRequestCountSinceReset = 0; // for count trigger (resets on time trigger)

  // --- Window state -------------------------------------------------------
  private windowStartTs = 0;
  private lastRecomputeTs = 0;
  private lastSnapshot: MetricsSnapshot | null = null;
  /**
   * Phase 7b T-04 — process epoch anchor. A new MetricsRingBuffer
   * instance starts a new process epoch. The acceptance evaluator
   * uses this to detect counter regressions and to never subtract
   * across process restarts.
   */
  private readonly processStartedAt: number;

  constructor(now: number = Date.now()) {
    this.windowStartTs = now;
    this.processStartedAt = now;
  }

  /**
   * Start the 60s time trigger. The count trigger is implicit in
   * `recordAugment()` / `recordProxy()` — it does NOT need a separate
   * start call.
   */
  start(): void {
    if (this.recomputeTimer !== null) return;
    this.recomputeTimer = setInterval(() => {
      this.recomputeDashboard();
      this.totalRequestCountSinceReset = 0; // reset count-trigger window
    }, METRICS_RECOMPUTE_TIME_MS);
    // unref so a pending interval does not keep the event loop alive
    // in tests that explicitly stop the server.
    this.recomputeTimer.unref?.();
  }

  /**
   * Clear the time interval. Does NOT clear counters / ring buffer
   * (transient persistence: those reset on server restart, not on
   * `stop()`). Mirror `AuditRingBuffer.stop()` semantics.
   */
  async stop(): Promise<void> {
    if (this.recomputeTimer !== null) {
      clearInterval(this.recomputeTimer);
      this.recomputeTimer = null;
    }
  }

  /**
   * Record a /augment sample. Per spec.md R-1 + R-3 + EC-2/EC-3:
   *
   *   - `outcome: 'measured'` → increment `attemptedRequests` (and
   *     `matchedRequests` if `matched === true`). Latency pushed.
   *   - `outcome: 'social' | 'no_active_items' | 'timeout'` →
   *     DO NOT touch the R-1 counters (excluded from denominator per
   *     spec.md R-1 table). Latency STILL pushed (per R-3 / R-4:
   *     "Includes ALL paths").
   *   - `totalAugmentRequests` increments regardless — this is the
   *     window.request_count raw volume.
   *
   * Counters are cumulative within one process epoch (Phase 7b
   * T-04 resolution of Phase 7a's "sliding N=10/T=60s" wording —
   * see spec.md R-7 / AC-8). The N=10/T=60s is a recompute cadence
   * for the snapshot, NOT counter eviction.
   *
   * Fires the count trigger when
   * `totalRequestCountSinceReset % METRICS_RECOMPUTE_COUNT_TRIGGER === 0`.
   */
  recordAugment(opts: {
    matched: boolean;
    outcome: AugmentOutcome;
    latencyMs: number;
  }): void {
    this.totalAugmentRequests++;
    if (opts.outcome === 'measured') {
      if (opts.matched) this.matchedRequests++;
      this.attemptedRequests++;
    }
    this.pushLatencySample(opts.latencyMs);
    this.totalRequestCountSinceReset++;
    if (this.totalRequestCountSinceReset % METRICS_RECOMPUTE_COUNT_TRIGGER === 0) {
      this.recomputeDashboard();
    }
  }

  /**
   * Record a /v1/messages proxy sample. Phase 7b T-04: the
   * `proxyRequests` denominator ALWAYS increments on a completed
   * 200, even when the upstream response omits
   * `usage.cache_read_input_tokens` (R-2 denominator fix). The
   * `cacheHitRequests` numerator only increments when
   * `cacheReadTokens > 0`. A null/missing/zero usage block
   * therefore counts as a miss (not as a no-op), which is the
   * Phase 7a gap resolution documented in spec.md R-7.
   *
   * The collector (`collector.ts`) is responsible for normalizing a
   * missing `usage` field to `cacheReadTokens: 0` BEFORE calling
   * this method. The collector's fail-open contract is preserved
   * here — this method only increments counters.
   */
  recordProxy(opts: { cacheReadTokens: number }): void {
    this.proxyRequests++;
    if (opts.cacheReadTokens > 0) {
      this.cacheHitRequests++;
    }
  }

  /**
   * Force-recompute the dashboard. Called by both triggers AND by
   * the `/metrics` route on first read. Synchronous; O(N) where N ≤
   * 100 (the latency ring capacity). < 0.10ms typical.
   */
  recomputeDashboard(): MetricsSnapshot {
    const snapshot = this.computeDashboard();
    this.lastSnapshot = snapshot;
    this.lastRecomputeTs = snapshot.timestamp;
    return snapshot;
  }

  /**
   * Read the cached snapshot (constant-time). Returns the last
   * recomputed snapshot; on first call, recomputes if none exists.
   */
  snapshot(): MetricsSnapshot {
    if (this.lastSnapshot === null) {
      return this.recomputeDashboard();
    }
    return this.lastSnapshot;
  }

  /**
   * Test-only — reset module-scoped state between runs. Mirrors
   * `AuditRingBuffer.resetForTests()`. A new `process_started_at`
   * is stamped by the constructor.
   */
  resetForTests(): void {
    if (this.recomputeTimer !== null) {
      clearInterval(this.recomputeTimer);
      this.recomputeTimer = null;
    }
    this.matchedRequests = 0;
    this.attemptedRequests = 0;
    this.totalAugmentRequests = 0;
    this.cacheHitRequests = 0;
    this.proxyRequests = 0;
    this.totalRequestCountSinceReset = 0;
    this.latencySamples.fill(0);
    this.latencyWriteIdx = 0;
    this.latencyCount = 0;
    this.windowStartTs = Date.now();
    this.lastRecomputeTs = 0;
    this.lastSnapshot = null;
  }

  /**
   * The anchor for the current process epoch. A server restart
   * instantiates a new buffer with a new `process_started_at`;
   * the acceptance evaluator uses this to detect counter resets
   * and never subtracts across process restarts.
   */
  get processEpochStart(): number {
    return this.processStartedAt;
  }

  // --- Private helpers ----------------------------------------------------

  private pushLatencySample(ms: number): void {
    this.latencySamples[this.latencyWriteIdx] = ms;
    this.latencyWriteIdx = (this.latencyWriteIdx + 1) % METRICS_LATENCY_BUFFER_CAPACITY;
    if (this.latencyCount < METRICS_LATENCY_BUFFER_CAPACITY) {
      this.latencyCount++;
    }
  }

  /**
   * Compute the dashboard snapshot from current state. Nearest-rank
   * percentile formula: `idx = Math.ceil(p / 100 * sorted.length) - 1`.
   * On an empty buffer returns 0 (caller null-checks via window).
   *
   * Phase 7b T-04: latency values are returned as-is (fractional
   * milliseconds). Working-set memory is intentionally integer-floor
   * because it's reported in MB granularity, not as a measurement.
   */
  private computeDashboard(): MetricsSnapshot {
    const now = Date.now();

    // R-1: request_hit_rate — null when denominator is zero.
    const request_hit_rate = this.attemptedRequests > 0
      ? this.matchedRequests / this.attemptedRequests
      : null;

    // R-2: token_cache_coverage — null when proxy disabled OR
    // proxy_requests is zero. `proxy_enabled` is computed at recompute
    // time from the env var so runtime changes are reflected.
    const proxyEnabled = readProxyEnabled();
    const token_cache_coverage = (proxyEnabled && this.proxyRequests > 0)
      ? this.cacheHitRequests / this.proxyRequests
      : null;

    // R-3 / R-4: nearest-rank percentile of the latency ring.
    // Phase 7b T-04: returns fractional values; the cache hit / miss
    // contract is "finite non-negative". The `null when no samples`
    // behavior is preserved (caller-facing via the MetricsSnapshot).
    const { p50, p99 } = this.computePercentiles();

    // R-5: working_set_mb — integer floor at MB granularity.
    const working_set_mb = Math.floor(process.memoryUsage().rss / 1024 / 1024);

    // Phase 7b T-04 — evidence block (schema v2). Raw counters
    // permit exact snapshot deltas across threshold epochs and
    // process restarts. `latency_sample_count` is the active count
    // in the ring (capped at 100).
    const evidence: MetricsEvidenceV2 = {
      matched_requests: this.matchedRequests,
      attempted_requests: this.attemptedRequests,
      cache_hit_requests: this.cacheHitRequests,
      proxy_requests: this.proxyRequests,
      latency_sample_count: this.latencyCount,
      process_started_at: this.processStartedAt,
    };

    return {
      request_hit_rate,
      token_cache_coverage,
      p50_latency_ms: this.latencyCount > 0 ? p50 : null,
      p99_latency_ms: this.latencyCount > 0 ? p99 : null,
      working_set_mb,
      window: {
        request_count: this.totalAugmentRequests,
        proxy_request_count: this.proxyRequests,
        window_age_ms: now - this.windowStartTs,
      },
      proxy_enabled: proxyEnabled,
      evidence,
      schema_version: 2,
      timestamp: now,
    };
  }

  /**
   * Extract the active latency samples (in insertion order) and
   * compute the nearest-rank p50/p99 percentiles. The samples form
   * a ring buffer of capacity 100; we only sort the first
   * `latencyCount` entries. Values are finite non-negative
   * fractional milliseconds (Phase 7b T-04).
   */
  private computePercentiles(): { p50: number; p99: number } {
    if (this.latencyCount === 0) {
      return { p50: 0, p99: 0 };
    }
    // Take the active prefix + sort. Sort mutates in place — we
    // work on a copy so the ring buffer state stays stable across
    // recompute calls.
    const active: number[] = [];
    for (let i = 0; i < this.latencyCount; i++) {
      // `latencySamples[i]` is `number | undefined` under
      // noUncheckedIndexedAccess; we initialize the buffer with
      // zeros and only overwrite the slots we touch, so the value
      // is always defined for `i < latencyCount`.
      const sample = this.latencySamples[i] ?? 0;
      active.push(sample);
    }
    active.sort((a, b) => a - b);

    return {
      p50: nearestRank(active, 50),
      p99: nearestRank(active, 99),
    };
  }
}

/**
 * Nearest-rank percentile: `idx = Math.ceil(p / 100 * n) - 1`,
 * clamped to `[0, n - 1]`. Matches Phase 5a's mental model — the
 * value at the boundary, not interpolated. Returns finite
 * non-negative fractional milliseconds (Phase 7b T-04).
 */
function nearestRank(sortedSamples: ReadonlyArray<number>, p: number): number {
  if (sortedSamples.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sortedSamples.length) - 1);
  // sortedSamples[idx] is `number | undefined` under
  // noUncheckedIndexedAccess; the clamp above guarantees idx is in
  // range, so the fallback to 0 is dead code but satisfies strict TS.
  return sortedSamples[idx] ?? 0;
}

/**
 * Whether the proxy is enabled. Read from the env var at compute
 * time (NOT cached) so runtime changes are reflected.
 */
function readProxyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  if (raw === undefined || raw === null) return false;
  return String(raw).trim().length > 0;
}
