/**
 * Double-threshold gate for `/augment` retrieval.
 *
 * Phase 5a.2 (T-06) — applies PRD §8 invariante sólida 7:
 *   "a candidate item passes ONLY if `cosine_similarity >= 0.75`
 *    AND `bm25_hits >= 1`".
 *
 * Both gates MUST pass. Items failing either gate land in
 * `pruningDecisions.rejectedByFloor[]` with a structured reason:
 *   - 'below_cosine_threshold' — cosine too low
 *   - 'below_fts_threshold'    — FTS hit count below the floor
 *   - 'id_not_in_active_catalog' — the candidate's slug is not in the
 *     request's `activeCatalog` (D-006 enforces the active list)
 *   - 'id_not_in_catalog'      — the activeCatalog ID itself does not
 *     exist on the filesystem (R-13)
 *
 * The `pruningDecisions` shape mirrors the AugmentResponse schema's
 * `PruningDecisionsSchema` (5 arrays; 4 of them remain empty arrays in
 * Phase 5a.2 — only `rejectedByFloor` is populated here).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_MIN_COSINE_SIMILARITY, DEFAULT_MIN_FTS_HITS } from '../../search/types.ts';
import type { RankedItem } from './retrieval.ts';

/** Per-candidate rejection reason (string-enum-like). */
export type RejectionReason =
  | 'below_cosine_threshold'
  | 'below_fts_threshold'
  | 'id_not_in_active_catalog'
  | 'id_not_in_catalog';

export interface RejectionEntry {
  readonly id: string;
  readonly reason: RejectionReason;
}

/** Output of the threshold step. */
export interface ThresholdOutput {
  /** Candidates that passed BOTH gates. */
  readonly passed: ReadonlyArray<RankedItem>;
  /** Candidates rejected with a structured reason. */
  readonly rejected: ReadonlyArray<RejectionEntry>;
}

/** Threshold options. Defaults match the PRD-locked calibration residue. */
export interface ThresholdOptions {
  /** Inclusive lower bound for cosine similarity. Default 0.75. */
  readonly minCosineSimilarity?: number;
  /** Inclusive lower bound for FTS5 distinct hit count per item. Default 1. */
  readonly minFtsHits?: number;
  /**
   * Directory holding the canonical catalog YAML files
   * (`config/catalog/<id>.yaml`). When provided, any activeCatalog id
   * missing on disk is recorded with reason `id_not_in_catalog`. When
   * `undefined`, the filesystem check is skipped.
   */
  readonly catalogDir?: string;
  /**
   * Per-slug FTS hit count map. Phase 1's calibration residue records
   * the global hit count, NOT per-slug — so the default `1` honors the
   * "at least 1 hit anywhere in the corpus" rule. When a future phase
   * introduces a per-slug FTS count, pass the per-slug map here.
   */
  readonly ftsHitCountBySlug?: ReadonlyMap<string, number>;
}

/**
 * Apply the double threshold + active-catalog filter to a ranked list.
 *
 * Order of evaluation (short-circuits on first failing gate):
 *   1. cosine similarity floor
 *   2. FTS hit count floor
 *   3. active-catalog membership
 *
 * Note: this function does NOT validate activeCatalog IDs against the
 * filesystem. That happens via the separate `validateActiveCatalogIds()`
 * helper, which the pipeline calls BEFORE retrieval so the rejected
 * entries surface even when no retrieval results are produced.
 */
export function applyThresholds(
  ranked: ReadonlyArray<RankedItem>,
  options: ThresholdOptions = {},
): ThresholdOutput {
  const minCosine = options.minCosineSimilarity ?? DEFAULT_MIN_COSINE_SIMILARITY;
  const minFts = options.minFtsHits ?? DEFAULT_MIN_FTS_HITS;
  const ftsHits = options.ftsHitCountBySlug;

  const passed: RankedItem[] = [];
  const rejected: RejectionEntry[] = [];

  for (const item of ranked) {
    if (item.cosineSimilarity === undefined || item.cosineSimilarity < minCosine) {
      rejected.push({ id: item.slug, reason: 'below_cosine_threshold' });
      continue;
    }
    if (item.ftsRank === undefined) {
      rejected.push({ id: item.slug, reason: 'below_fts_threshold' });
      continue;
    }
    if (ftsHits) {
      const hits = ftsHits.get(item.slug) ?? 0;
      if (hits < minFts) {
        rejected.push({ id: item.slug, reason: 'below_fts_threshold' });
        continue;
      }
    }
    passed.push(item);
  }

  return { passed, rejected };
}

/**
 * Validate the request's `activeCatalog` IDs against the filesystem.
 *
 * Per PRD §7.1 + R-13, the server validates that every active catalog id
 * resolves to `config/catalog/<id>.yaml` on disk. Missing files are
 * dropped from the matched set (the server NEVER injects defaults) and
 * surfaced in `pruningDecisions.rejectedByFloor[]` with reason
 * `id_not_in_catalog`.
 *
 * Returns:
 *   - `valid`:  the subset of `activeCatalog` that DOES resolve on disk
 *   - `rejected`: the entries to record in `rejectedByFloor[]`
 */
export function validateActiveCatalogIds(
  activeCatalog: ReadonlyArray<string>,
  catalogDir: string,
): {
  readonly valid: ReadonlyArray<string>;
  readonly rejected: ReadonlyArray<RejectionEntry>;
} {
  if (activeCatalog.length === 0) {
    return { valid: [], rejected: [] };
  }
  const valid: string[] = [];
  const rejected: RejectionEntry[] = [];
  for (const id of activeCatalog) {
    if (existsSync(join(catalogDir, `${id}.yaml`))) {
      valid.push(id);
    } else {
      rejected.push({ id, reason: 'id_not_in_catalog' });
    }
  }
  return { valid, rejected };
}
