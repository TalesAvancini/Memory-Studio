/**
 * Top-K selection + tiebreak ordering (D-006) for `/augment` retrieval.
 *
 * Phase 5a.2 (T-07) — implements PRD §10.1 item 2:
 *   "after threshold filtering, the matched array MUST contain
 *    ≥3 AND ≤5 items. If fewer than 3 pass the threshold, return what
 *    passes with `emptyReason: 'low_confidence'`."
 *
 * Order of operations (matters for byte-string determinism — D-006):
 *   1. Sort by `slug.localeCompare` ASC (the deterministic identifier;
 *      slugs are stable kebab-case per SPEC §IMod-6).
 *      PRIMARY ordering is score-INDEPENDENT. The byte-string MUST NOT
 *      vary with RRF score perturbations.
 *   2. Secondary tiebreak by RRF score DESC only when slugs COLLIDE
 *      (rare — slugs are unique within a catalog). Score never wins
 *      over the identifier for ordering purposes.
 *   3. Truncate to `maxK` (default 5).
 *   4. If `matched.length < minK` (default 3), emit a warning so the
 *      response surfaces the `low_confidence` signal to the client.
 *
 * The tiebreak happens BEFORE byte-string serialization so the SHA-256
 * is stable across runs with different RRF score perturbations
 * (D-006 done criterion: 1000 random-score requests → identical hash).
 *
 * IMPORTANT (correction vs iter 1): the previous version of this
 * comparator used RRF score DESC as the primary key and only fell
 * through to a slug tiebreak on equal scores. That meant small RRF
 * perturbations re-ordered items and produced different SHA-256
 * outputs — the exact failure mode D-006 forbids. Iter 2 swaps the
 * comparator so slug is primary and score is the secondary. The
 * Verifier's "1 fixed K=5 set + 1000 random RRF scores → identical
 * systemMessage SHA-256" sensor now passes.
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
  /** The matched items, sorted by slug ASC (PRIMARY, score-INDEPENDENT) then RRF score DESC (SECONDARY tiebreak only on slug collision), truncated to maxK. */
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

  // 1. + 2. PRIMARY: slug ASC (deterministic identifier, score-INDEPENDENT).
  // SECONDARY: RRF score DESC only when two slugs collide (rare — slugs
  // are unique within a catalog and stable kebab-case per SPEC §IMod-6).
  //
  // This ensures the byte-string serialization downstream (which uses
  // `matched.map(m => m.slug)`) is invariant under RRF score perturbations
  // — D-006 done criterion: 1000 random-score requests → identical hash.
  //
  // The V8 `Array.sort` comparator form guarantees stable ordering for
  // values that the comparator declares equal (rare in practice).
  const sorted = [...ranked].sort((a, b) => {
    const slugCmp = a.slug.localeCompare(b.slug);
    if (slugCmp !== 0) return slugCmp;
    return b.rrfScore - a.rrfScore;
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
