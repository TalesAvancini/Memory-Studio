/**
 * Retrieval composition for the `/augment` pipeline.
 *
 * Phase 5a.2 (T-05) — wires the calibration residue in `src/search/*`
 * (FTS5 + sqlite-vec + RRF) into the augment flow WITHOUT rewriting
 * those modules. Per `CALIBRATION-RESIDUE.md`, the existing
 * `queryFts`, `queryVector`, and `fuseRrf` exports are reused as-is.
 *
 * Composition:
 *   1. `queryFts(db, prompt, depth)`  — BM25 lexical channel
 *   2. `queryVector(db, queryVec, depth)` — cosine k-NN vector channel
 *   3. `fuseRrf(ftsList, vecList)` — Reciprocal Rank Fusion
 *   4. `hydrateRankedSkills(db, fused)` — join `skills` metadata in
 *      fused order, dropping any id whose row vanished (stale).
 *   5. `filterActiveCatalog(ranked, activeCatalog)` — keep only items
 *      whose slug is in the request's activeCatalog.
 *
 * The output shape (`RankedItem`) is the canonical internal DTO used by
 * downstream modules (thresholds → top-k → augmenter → byte-string). It
 * is intentionally NOT the public response DTO — that lives in
 * `response.ts` and the AugmentResponse schema.
 *
 * Errors:
 *   - `queryFts` / `queryVector` / `fuseRrf` raise `SearchError`. The
 *     pipeline orchestrator is responsible for the fail-open path that
 *     surfaces `emptyReason: 'timeout'` to the client.
 */

import type { Database } from 'better-sqlite3';

import { queryFts } from '../../search/fts.ts';
import type { FtsSearchResult } from '../../search/types.ts';
import { queryVector } from '../../search/vector.ts';
import { fuseRrf } from '../../search/rrf.ts';
import type {
  FtsCandidate,
  FusedCandidate,
  VectorCandidate,
} from '../../search/types.ts';

/** Candidate depth for the FTS / vector channels. Matches `createSearch`. */
const CANDIDATE_DEPTH = 20;

/** A hydrated retrieval result: post-RRF + post-hydration + post-active filter. */
export interface RankedItem {
  /** Numeric rowid from the `skills` table. Preserved for logging / tests. */
  readonly id: number;
  /** String slug. The DETERMINISTIC identifier used for tiebreak and the byte-string. */
  readonly slug: string;
  /** Catalog kind. */
  readonly kind: 'skill' | 'rule' | 'persona';
  /** Original YAML content (verbatim). Used as the text in the byte-string. */
  readonly text: string;
  /** RRF score after fusion. NOT included in the byte-string (D-006). */
  readonly rrfScore: number;
  /** Optional FTS rank (1-based in BM25 order). */
  readonly ftsRank?: number;
  /** Optional vector rank (1-based in k-NN order). */
  readonly vectorRank?: number;
  /** Optional raw BM25 score (lower = more relevant). */
  readonly bm25?: number;
  /** Optional raw cosine similarity (higher = more relevant). */
  readonly cosineSimilarity?: number;
}

/** Retrieval result with timing. */
export interface RetrievalOutput {
  readonly ranked: ReadonlyArray<RankedItem>;
  /** FTS5 distinct hit count, pre-limit. Reported in logs for observability. */
  readonly ftsTotalHits: number;
  /** Wall-clock retrieval time in milliseconds. */
  readonly retrievalMs: number;
}

interface SkillRow {
  id: number;
  slug: string;
  kind: 'skill' | 'rule' | 'persona';
  content_yaml: string;
  hash: string;
}

/**
 * Hydrate the top-N fused candidates with source metadata in one bounded
 * query, preserving fused order. Embedding bytes are intentionally NOT
 * returned. Stale ids (whose row vanished) are dropped while the rest of
 * the order is preserved.
 */
function hydrateRankedSkills(
  db: Database,
  fused: ReadonlyArray<FusedCandidate>,
): ReadonlyArray<RankedItem> {
  if (fused.length === 0) return [];
  const placeholders = fused.map(() => '?').join(',');
  const ids = fused.map((c) => c.id);
  const rows = db
    .prepare<[...number[]], SkillRow>(
      `SELECT id, slug, kind, content_yaml, hash
       FROM skills
       WHERE id IN (${placeholders})`,
    )
    .all(...ids);
  const byId = new Map(rows.map((r) => [r.id, r] as const));

  const out: RankedItem[] = [];
  for (const f of fused) {
    const meta = byId.get(f.id);
    if (!meta) continue; // stale id — skip, preserve remaining order
    out.push({
      id: meta.id,
      slug: meta.slug,
      kind: meta.kind,
      text: meta.content_yaml,
      rrfScore: f.rrfScore,
      ftsRank: f.ftsRank,
      vectorRank: f.vectorRank,
      bm25: f.bm25,
      cosineSimilarity: f.cosineSimilarity,
    });
  }
  return out;
}

/**
 * Drop ranked items whose slug is not in the request's activeCatalog.
 * The activeCatalog is the canonical client-side "which items am I
 * currently using" signal — anything outside it is invisible to the
 * augmenter regardless of retrieval score.
 */
function filterActiveCatalog(
  ranked: ReadonlyArray<RankedItem>,
  activeCatalog: ReadonlyArray<string>,
): ReadonlyArray<RankedItem> {
  if (activeCatalog.length === 0) return ranked; // D-008 handles the empty case upstream
  const allowed = new Set(activeCatalog);
  return ranked.filter((r) => allowed.has(r.slug));
}

/**
 * Run the full retrieval pipeline: FTS5 + sqlite-vec + RRF + hydration +
 * activeCatalog filter. Pure (modulo DB reads) — no I/O outside the
 * caller-owned db, no global state.
 *
 * @param db        caller-owned better-sqlite3 connection (must already
 *                  have `skills` table + search storage initialized).
 * @param prompt    raw user prompt (raw, NOT pre-normalized — the search
 *                  adapter normalizes internally).
 * @param queryVec  Float32Array of SEARCH_EMBEDDING_DIMENSIONS (384) from
 *                  the embedder.
 * @param activeCatalog  the request's `activeCatalog` (slug list).
 */
export function runRetrieval(
  db: Database,
  prompt: string,
  queryVec: Float32Array,
  activeCatalog: ReadonlyArray<string>,
): RetrievalOutput {
  const t0 = performance.now();

  // 1. FTS5 channel. Errors propagate as SearchError(QUERY_ERROR) —
  //    the pipeline orchestrator decides whether to fail-open.
  const ftsResult: FtsSearchResult = queryFts(db, prompt, CANDIDATE_DEPTH);

  // 2. Vector channel. `queryVector` validates the embedding before any
  //    native binding, so an invalid vec surfaces as
  //    SearchError(INVALID_EMBEDDING) without reaching sqlite-vec.
  const vecList: ReadonlyArray<VectorCandidate> = queryVector(
    db,
    queryVec,
    CANDIDATE_DEPTH,
  );

  // 3. RRF fusion. Pure function over the two approved channel lists.
  const fused: ReadonlyArray<FusedCandidate> = fuseRrf(
    ftsResult.candidates,
    vecList,
  );

  // 4. Hydrate in fused order, preserving order, dropping stale ids.
  const hydrated: ReadonlyArray<RankedItem> = hydrateRankedSkills(db, fused);

  // 5. Filter to the request's activeCatalog. Non-active items are
  //    invisible to the augmenter, regardless of retrieval score.
  const ranked: ReadonlyArray<RankedItem> = filterActiveCatalog(
    hydrated,
    activeCatalog,
  );

  return {
    ranked,
    ftsTotalHits: ftsResult.totalHits,
    retrievalMs: performance.now() - t0,
  };
}
