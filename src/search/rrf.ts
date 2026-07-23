/**
 * Reciprocal Rank Fusion (RRF) for the two approved channel lists.
 *
 * Design constraints (per design.md §"RRF fusion"):
 *   - Pure function. No DB access, no embedder, no async.
 *   - For each candidate present in either approved list, sum
 *     `1 / (RRF_DENOMINATOR + rank)` over the channels where it appears.
 *   - Preserves the original channel rank + metric (bm25 / cosine) by id.
 *   - Filters NEVER mutate the channel ranks: if a raw vec rank 5 fails the
 *     cosine gate, the surviving ranks are 1..4 not re-numbered 1..3.
 *   - Sorts by `rrfScore DESC`, tie-break by best available rank ASC, then
 *     by `id ASC` for deterministic output.
 *
 * Inputs are read-only. The returned array is a fresh structure.
 */

import {
  RRF_DENOMINATOR,
  type FtsCandidate,
  type FusedCandidate,
  type VectorCandidate,
} from './types.ts';

/** Best available rank from the FTS / vector channel (lower = better). */
function bestRank(fts?: FtsCandidate, vec?: VectorCandidate): number | undefined {
  const ftsR = fts?.rank;
  const vecR = vec?.rank;
  if (ftsR !== undefined && vecR !== undefined) return Math.min(ftsR, vecR);
  return ftsR ?? vecR;
}

/**
 * Fuse two approved rank lists into one `FusedCandidate[]`. Returns an
 * empty array when both lists are empty.
 *
 * Order: score DESC → bestRank ASC → id ASC.
 */
export function fuseRrf(
  ftsList: readonly FtsCandidate[],
  vecList: readonly VectorCandidate[],
): readonly FusedCandidate[] {
  if (ftsList.length === 0 && vecList.length === 0) return [];

  // Map id -> { fts, vec } for O(n+m) accumulation.
  const acc = new Map<
    number,
    { fts?: FtsCandidate; vec?: VectorCandidate; score: number }
  >();

  for (const fts of ftsList) {
    const existing = acc.get(fts.id);
    const term = 1 / (RRF_DENOMINATOR + fts.rank);
    if (existing) {
      existing.fts = fts;
      existing.score += term;
    } else {
      acc.set(fts.id, { fts, vec: undefined, score: term });
    }
  }

  for (const vec of vecList) {
    const existing = acc.get(vec.id);
    const term = 1 / (RRF_DENOMINATOR + vec.rank);
    if (existing) {
      existing.vec = vec;
      existing.score += term;
    } else {
      acc.set(vec.id, { fts: undefined, vec, score: term });
    }
  }

  const fused: FusedCandidate[] = [];
  for (const [id, entry] of acc) {
    fused.push({
      id,
      rrfScore: entry.score,
      ftsRank: entry.fts?.rank,
      vectorRank: entry.vec?.rank,
      bm25: entry.fts?.bm25,
      cosineSimilarity: entry.vec?.cosineSimilarity,
    });
  }

  fused.sort((a, b) => {
    if (a.rrfScore !== b.rrfScore) return b.rrfScore - a.rrfScore;
    const ra = bestRank(
      a.ftsRank !== undefined ? { id: a.id, rank: a.ftsRank, bm25: a.bm25 ?? 0 } : undefined,
      a.vectorRank !== undefined
        ? {
            id: a.id,
            rank: a.vectorRank,
            cosineSimilarity: a.cosineSimilarity ?? 0,
            distance: 0,
          }
        : undefined,
    );
    const rb = bestRank(
      b.ftsRank !== undefined ? { id: b.id, rank: b.ftsRank, bm25: b.bm25 ?? 0 } : undefined,
      b.vectorRank !== undefined
        ? {
            id: b.id,
            rank: b.vectorRank,
            cosineSimilarity: b.cosineSimilarity ?? 0,
            distance: 0,
          }
        : undefined,
    );
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    return a.id - b.id;
  });

  return fused;
}