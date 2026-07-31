/**
 * Top-K selection + tiebreak ordering (D-006) for `/augment` retrieval.
 *
 * Phase 5a.2 (T-07) — implements PRD §10.1 item 2:
 *   "after threshold filtering, the matched array MUST contain
 *    ≥3 AND ≤5 items. If fewer than 3 pass the threshold, return what
 *    passes with `emptyReason: 'low_confidence'`."
 *
 * Order of operations (matters for byte-string determinism — D-006):
 *   1. Sort by RRF score DESC (highest score first).
 *   2. Tiebreak by `slug.localeCompare(b.slug)` ASC when scores are
 *      equal (D-006 mandates `a.id.localeCompare(b.id)`; here `id` is
 *      the slug, the deterministic identifier used downstream).
 *   3. Truncate to `maxK` (default 5).
 *   4. If `matched.length < minK` (default 3), emit a warning so the
 *      response surfaces the `low_confidence` signal to the client.
 *
 * The tiebreak happens BEFORE byte-string serialization so the SHA-256
 * is stable across runs with different RRF score perturbations
 * (D-006 done criterion: 1000 random-score requests → identical hash).
 */

import type { RankedItem } from './retrieval.ts';

/** Top-K options. Defaults match PRD §10.1 item 2 (3-5). */
export interface TopKOptions {
  /** Inclusive minimum matched count. Below this, emit a warning. */
  readonly minK?: number;
  /** Inclusive upper bound — items beyond are truncated. */
  readonly maxK?: number;
}

export const DEFAULT_MIN_K = 3;
export const DEFAULT_MAX_K = 5;

export interface TopKOutput {
  /** The matched items, sorted by RRF score DESC then slug ASC, truncated to maxK. */
  readonly matched: ReadonlyArray<RankedItem>;
  /** Human-readable warnings (e.g. "only 2 items above threshold (< 3)"). */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Apply top-K selection + tiebreak ordering. Pure function over the
 * caller-supplied ranked list — no I/O, no global state.
 *
 * The function does NOT mutate the input array. It builds a fresh copy
 * so call sites can safely keep their own references.
 */
export function topKAndTiebreak(
  ranked: ReadonlyArray<RankedItem>,
  options: TopKOptions = {},
): TopKOutput {
  const minK = options.minK ?? DEFAULT_MIN_K;
  const maxK = options.maxK ?? DEFAULT_MAX_K;

  // 1. + 2. Sort by RRF score DESC, then slug ASC (D-006 tiebreak).
  // The sort is stable in V8 (Node 22) for the .sort() comparator form,
  // so two items with equal score and equal slug preserve insertion order.
  const sorted = [...ranked].sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.slug.localeCompare(b.slug);
  });

  // 3. Truncate to maxK.
  const matched = sorted.slice(0, maxK);

  // 4. Warn if below the minimum. The warning string matches the
  //    spec/AC conventions so downstream log greps stay stable.
  const warnings: string[] = [];
  if (matched.length < minK) {
    warnings.push(`only ${matched.length} items above threshold (< ${minK})`);
  }

  return { matched, warnings };
}
