/**
 * Metrics collector (Phase 7a T-03).
 *
 * Thin pass-through from the request hot path (`pipeline.ts`,
 * `messages-proxy.ts`) to the `MetricsRingBuffer` singleton. Keeps
 * callers ignorant of the buffer's internals — the collector is the
 * write seam per design.md §2.2.
 *
 * Fail-open (D-007 mirror):
 *   - Every call is wrapped in try/catch. A misbehaving buffer NEVER
 *     propagates an exception into the request path (PRD §8
 *     invariante 15). The buffer itself only throws on programmer
 *     errors (none currently).
 *
 * Hot-path budget (AC-13):
 *   - ~1μs function-call overhead + one `getMetricsBuffer()` lookup
 *     (returns the cached singleton — no allocation).
 *   - ~0.1μs for counter increments inside the buffer.
 *   - ~0.5μs for the ring-buffer write.
 *   - Total: ~2μs (well under the 0.10ms budget allocated in
 *     Phase 7a's design.md §8).
 */

import { getMetricsBuffer } from './lifecycle.ts';
import type { AugmentOutcome } from './ring-buffer.ts';

/**
 * Record a /augment sample. Translates the pipeline's
 * `emptyReason` to the buffer's `AugmentOutcome` so the buffer
 * correctly excludes social / no_active_items / timeout from the
 * R-1 denominator.
 *
 * Per spec.md R-1 denominator table:
 *   - `emptyReason: null` AND matched.count > 0  → measured + matched
 *   - `emptyReason: null` AND matched.count === 0 → measured + not matched
 *   - `emptyReason: 'social'`                    → excluded
 *   - `emptyReason: 'no_active_items'`           → excluded
 *   - `emptyReason: 'timeout'`                   → excluded
 *
 * Latency is always sampled (per R-3/R-4: "Includes ALL paths").
 */
export function recordAugmentSample(opts: {
  matched: boolean;
  emptyReason: string | null;
  latencyMs: number;
}): void {
  try {
    const buf = getMetricsBuffer();
    if (buf === null) return;
    const outcome = outcomeFromEmptyReason(opts.emptyReason);
    buf.recordAugment({
      matched: opts.matched,
      outcome,
      latencyMs: opts.latencyMs,
    });
  } catch {
    // Fail-open: metrics never block the request.
  }
}

/**
 * Record a /v1/messages proxy sample. Phase 7b T-04: a completed
 * 200 response is ALWAYS counted in the proxy_requests denominator,
 * even when the upstream response omits `usage.cache_read_input_tokens`
 * (R-2 denominator fix from Phase 7a gap). A null/missing/zero
 * `cacheReadTokens` value counts as a zero-valued miss — the
 * `cacheHitRequests` numerator only increments when
 * `cacheReadTokens > 0`.
 *
 * The proxy call site (`messages-proxy.ts`) is responsible for:
 *   - Only calling this on a completed HTTP 200 (non-200 is NOT
 *     in the denominator per spec.md R-2 + EC-4).
 *   - Passing `cacheReadTokens: 0` when the response omits `usage`
 *     or the value is null/missing — NOT skipping the call.
 */
export function recordProxySample(opts: {
  cacheReadTokens: number | null;
  latencyMs: number;
}): void {
  try {
    const buf = getMetricsBuffer();
    if (buf === null) return;
    // Phase 7b T-04: normalize null/missing cache usage to 0 (R-2
    // denominator fix). The call site is expected to pass 0 for a
    // missing usage block; this is a defensive guard for robustness.
    const cacheReadTokens = opts.cacheReadTokens === null
      || !Number.isFinite(opts.cacheReadTokens)
      || opts.cacheReadTokens < 0
        ? 0
        : opts.cacheReadTokens;
    buf.recordProxy({ cacheReadTokens });
  } catch {
    // Fail-open.
  }
}

/**
 * Translate `AugmentResponse.emptyReason` to the buffer's
 * `AugmentOutcome`. The mapping is enforced here (not in the
 * buffer) so the buffer's API stays clean and self-documenting.
 *
 * Per spec.md R-1 denominator table, the EXCLUDED outcomes are:
 *   - 'social'
 *   - 'no_active_items'
 *   - 'timeout'
 * Other emptyReason values ('low_confidence' is the only other
 * defined one — it indicates matched.count === 0 after thresholds,
 * not a pipeline failure) are counted as 'measured'.
 */
function outcomeFromEmptyReason(emptyReason: string | null): AugmentOutcome {
  if (emptyReason === null) return 'measured';
  if (emptyReason === 'social') return 'social';
  if (emptyReason === 'no_active_items') return 'no_active_items';
  if (emptyReason === 'timeout') return 'timeout';
  // 'low_confidence' (the only other defined value) and any
  // unknown future value default to 'measured' — the request DID
  // reach the retrieval stage; it just returned 0 matches.
  return 'measured';
}
