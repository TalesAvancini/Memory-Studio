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
 * Record a /v1/messages proxy sample. Only called when the upstream
 * returned 200 AND `cache_read_input_tokens` was captured (per
 * R-2 + EC-4). The collector enforces this gate at the call site
 * (see `messages-proxy.ts` T-06 hook).
 */
export function recordProxySample(opts: {
  cacheReadTokens: number | null;
  latencyMs: number;
}): void {
  try {
    const buf = getMetricsBuffer();
    if (buf === null) return;
    // Skip when cacheReadTokens is null (callers should pre-check,
    // but defensive guard for robustness).
    if (opts.cacheReadTokens === null) return;
    buf.recordProxy({
      cacheReadTokens: opts.cacheReadTokens,
      latencyMs: opts.latencyMs,
    });
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
