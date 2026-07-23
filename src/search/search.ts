/**
 * Public hybrid search factory + closure.
 *
 * `createSearch(options)` returns an async `(query, k) -> RankedSkill[]`
 * closure backed by the FTS5 + sqlite-vec indexes created in `schema.ts`.
 *
 * Per design.md §"Search factory/orchestrator":
 *   1. Factory validates config and initializes storage.
 *   2. Closure validates/normalizes query and `k`; computes candidate depth.
 *   3. Await exactly one `embedder.embed(normalizedQuery)` call; wrap
 *      failure without query content.
 *   4. Query FTS and vec adapters in parallel.
 *   5. Keep vector rows with `cosineSimilarity >= minCosineSimilarity`
 *      without re-numbering their original k-NN ranks.
 *   6. Keep the FTS list only when `totalHits >= minFtsHits`.
 *   7. Return `[]` if both approved lists are empty.
 *   8. Fuse, take top `k`, hydrate source metadata in one bounded query,
 *      and emit in fused order without embeddings.
 *
 * No HTTP, no Fastify, no logging of query content. Errors are typed via
 * `SearchError`.
 */

import type { Database } from 'better-sqlite3';
import {
  asSearchError,
  SearchError,
} from './errors.ts';
import { fuseRrf } from './rrf.ts';
import { queryFts } from './fts.ts';
import { queryVector, validateEmbedding } from './vector.ts';
import { initializeSearchStorage } from './schema.ts';
import {
  DEFAULT_MIN_COSINE_SIMILARITY,
  DEFAULT_MIN_FTS_HITS,
  K_FLOOR_MULTIPLIER,
  MAX_CANDIDATE_DEPTH,
  MAX_K,
  MAX_QUERY_LENGTH,
  MAX_FTS_HITS_BOUND,
  MIN_CANDIDATE_DEPTH,
  MIN_K,
  MIN_QUERY_LENGTH,
  MIN_FTS_HITS_BOUND,
  type RankedSkill,
  type ResolvedSearchConfig,
  type SearchFunction,
  type SearchOptions,
  type VectorCandidate,
} from './types.ts';

/**
 * Validate the factory options before touching the database. Throws
 * `SearchError(INVALID_CONFIG)` on any bad field. Caller-owned DB is
 * accepted but not opened here.
 */
function validateOptions(options: SearchOptions): ResolvedSearchConfig {
  if (!options || typeof options !== 'object') {
    throw new SearchError('createSearch requires an options object', 'INVALID_CONFIG');
  }
  const { db, embedder, minCosineSimilarity, minFtsHits } = options;
  if (!db) {
    throw new SearchError('createSearch requires a better-sqlite3 Database', 'INVALID_CONFIG');
  }
  if (!embedder || typeof embedder.embed !== 'function') {
    throw new SearchError(
      'createSearch requires an Embedder with an embed() method',
      'INVALID_CONFIG',
    );
  }
  const cosine =
    minCosineSimilarity === undefined ? DEFAULT_MIN_COSINE_SIMILARITY : minCosineSimilarity;
  if (typeof cosine !== 'number' || !Number.isFinite(cosine)) {
    throw new SearchError(
      `minCosineSimilarity must be a finite number, got ${typeof cosine}`,
      'INVALID_CONFIG',
    );
  }
  if (cosine < -1 || cosine > 1) {
    throw new SearchError(
      `minCosineSimilarity must be in [-1, 1], got ${cosine}`,
      'INVALID_CONFIG',
    );
  }
  const fts = minFtsHits === undefined ? DEFAULT_MIN_FTS_HITS : minFtsHits;
  if (
    typeof fts !== 'number' ||
    !Number.isInteger(fts) ||
    fts < MIN_FTS_HITS_BOUND ||
    fts > MAX_FTS_HITS_BOUND
  ) {
    throw new SearchError(
      `minFtsHits must be an integer in [${MIN_FTS_HITS_BOUND}, ${MAX_FTS_HITS_BOUND}], got ${fts}`,
      'INVALID_CONFIG',
    );
  }
  return { minCosineSimilarity: cosine, minFtsHits: fts };
}

/**
 * Compute the candidate depth for one channel:
 *   depth = clamp(4*k, 20, 100)
 * Bounded so the SQL plan never exceeds 100 rows per channel at the locked
 * 384-dim model.
 */
export function computeCandidateDepth(k: number): number {
  return Math.min(Math.max(K_FLOOR_MULTIPLIER * k, MIN_CANDIDATE_DEPTH), MAX_CANDIDATE_DEPTH);
}

/** Validate and normalize the query string. */
function validateAndNormalizeQuery(rawQuery: unknown): string {
  if (typeof rawQuery !== 'string') {
    throw new SearchError('query must be a string', 'INVALID_QUERY');
  }
  const normalized = rawQuery.normalize('NFC').trim();
  const len = normalized.length;
  if (len < MIN_QUERY_LENGTH) {
    throw new SearchError(
      `query must have at least ${MIN_QUERY_LENGTH} code unit after trim`,
      'INVALID_QUERY',
    );
  }
  if (len > MAX_QUERY_LENGTH) {
    throw new SearchError(
      `query must have at most ${MAX_QUERY_LENGTH} code units, got ${len}`,
      'INVALID_QUERY',
    );
  }
  return normalized;
}

/** Validate `k`. */
function validateK(rawK: unknown): number {
  if (typeof rawK !== 'number' || !Number.isInteger(rawK)) {
    throw new SearchError(`k must be an integer, got ${typeof rawK}`, 'INVALID_K');
  }
  if (rawK < MIN_K || rawK > MAX_K) {
    throw new SearchError(`k must be in [${MIN_K}, ${MAX_K}], got ${rawK}`, 'INVALID_K');
  }
  return rawK;
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
 * query. Embedding bytes are intentionally NOT returned.
 *
 * If a candidate's id is missing from `skills` (stale), it is excluded and
 * the remaining order is preserved.
 */
function hydrateTopSkills(
  db: Database,
  fused: ReadonlyArray<{ readonly id: number }>,
): readonly SkillRow[] {
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preserve fused order, drop any IDs whose row vanished.
  return fused.map((c) => byId.get(c.id)).filter(
    (r): r is SkillRow => r !== undefined,
  );
}

/** Include the vector candidate only when cosine >= minCosineSimilarity. */
function applyVectorThreshold(
  candidates: readonly VectorCandidate[],
  threshold: number,
): VectorCandidate[] {
  return candidates.filter((c) => c.cosineSimilarity >= threshold);
}

/**
 * Build the public `search(query, k)` closure. The factory initializes
 * storage once; the closure is what consumers hold onto.
 *
 * Caller owns `db` lifetime — do NOT close it from inside the closure.
 */
export function createSearch(options: SearchOptions): SearchFunction {
  const config = validateOptions(options);
  const { db, embedder } = options;

  // Storage is initialized eagerly so a half-configured service can never
  // be exposed to callers. Any underlying driver failure becomes a typed
  // SearchError(SCHEMA_ERROR) — including the case where the DB is closed
  // before createSearch is called.
  try {
    initializeSearchStorage(db);
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw asSearchError(
      err,
      'SCHEMA_ERROR',
      'storage initialization failed before service was exposed',
    );
  }

  return async function search(rawQuery: string, rawK: number): Promise<readonly RankedSkill[]> {
    const query = validateAndNormalizeQuery(rawQuery);
    const k = validateK(rawK);
    const depth = computeCandidateDepth(k);

    // Embed the query exactly once. Errors are wrapped as EMBEDDING_FAILED
    // with query-independent text — we NEVER copy the inner error's message
    // (it can carry caller-supplied strings that may include the prompt).
    // The original error is preserved on `cause` so operators can debug
    // without leaking the prompt.
    let embedding: Float32Array;
    try {
      embedding = await embedder.embed(query);
    } catch (err) {
      throw new SearchError('embedding failed', 'EMBEDDING_FAILED', err);
    }
    // Defensive: re-validate in case the embedder lies about its contract.
    try {
      validateEmbedding(embedding);
    } catch (err) {
      if (err instanceof SearchError) throw err;
      throw asSearchError(err, 'INVALID_EMBEDDING', 'embedder returned a bad vector');
    }

    // Channel queries.
    let ftsResult;
    try {
      ftsResult = queryFts(db, query, depth);
    } catch (err) {
      throw asSearchError(err, 'QUERY_ERROR', 'FTS channel failed');
    }
    let vecCandidates;
    try {
      vecCandidates = queryVector(db, embedding, depth);
    } catch (err) {
      throw asSearchError(err, 'QUERY_ERROR', 'vector channel failed');
    }

    // Threshold logic — independent per channel, OR semantics.
    const approvedVec = applyVectorThreshold(vecCandidates, config.minCosineSimilarity);
    const approvedFts = ftsResult.totalHits >= config.minFtsHits ? ftsResult.candidates : [];

    if (approvedFts.length === 0 && approvedVec.length === 0) {
      return [];
    }

    const fused = fuseRrf(approvedFts, approvedVec);

    // Slice to top-k AFTER fusion so RRF can promote cross-channel hits.
    const top = fused.slice(0, k);
    const hydrated = hydrateTopSkills(db, top);

    const out: RankedSkill[] = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i]!;
      const meta = hydrated.find((r) => r.id === f.id);
      if (!meta) continue; // stale id — skip, preserve remaining order
      out.push({
        id: meta.id,
        slug: meta.slug,
        kind: meta.kind,
        contentYaml: meta.content_yaml,
        hash: meta.hash,
        rrfScore: f.rrfScore,
        ftsRank: f.ftsRank,
        vectorRank: f.vectorRank,
        bm25: f.bm25,
        cosineSimilarity: f.cosineSimilarity,
      });
    }
    return out;
  };
}