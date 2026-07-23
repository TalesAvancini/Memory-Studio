/**
 * Public contracts for the search domain.
 *
 * Per design.md §"Public contracts and errors":
 *   - SearchOptions: factory input (db, embedder, optional thresholds).
 *   - SearchFunction: async (query, k) -> top-k RankedSkill[], library-only.
 *   - RankedSkill: hybrid result DTO carrying source metadata + channel
 *     metrics + RRF score. Embedding BLOB is intentionally NOT exposed.
 *   - Channel candidate types are intermediate, used by FTS/vector adapters
 *     and the RRF fuser; they are exported so tests can assert on raw
 *     pre-fusion shape without going through the orchestrator.
 *
 * All interface fields are `readonly`. The contract does not import
 * `any`; raw YAML/dynamic JSON never crosses this boundary.
 */

import type { Database } from 'better-sqlite3';
import type { Embedder } from '../catalog/embedder.ts';
import type { SkillKind } from '../catalog/types.ts';

/** Default cosine similarity threshold for the vector channel. */
export const DEFAULT_MIN_COSINE_SIMILARITY = 0.75;

/** Default minimum distinct FTS5 hits for the lexical channel. */
export const DEFAULT_MIN_FTS_HITS = 1;

/** Per-channel candidate depth: min(max(4*k, 20), 100). */
export const MIN_CANDIDATE_DEPTH = 20;
export const MAX_CANDIDATE_DEPTH = 100;
export const K_FLOOR_MULTIPLIER = 4;

/** Inclusive bounds for `k`. */
export const MIN_K = 1;
export const MAX_K = 100;

/** Inclusive bounds for trimmed query length in UTF-16 code units. */
export const MIN_QUERY_LENGTH = 1;
export const MAX_QUERY_LENGTH = 10_000;

/** Inclusive bounds for the FTS hit-count threshold. */
export const MIN_FTS_HITS_BOUND = 1;
export const MAX_FTS_HITS_BOUND = 1000;

/** RRF denominator constant. */
export const RRF_DENOMINATOR = 60;

/** Embedding dimensionality locked by Phase 2 (multilingual-e5-small). */
export const SEARCH_EMBEDDING_DIMENSIONS = 384;

/** Factory configuration. Caller owns `db` lifetime. */
export interface SearchOptions {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly minCosineSimilarity?: number;
  readonly minFtsHits?: number;
}

/** Resolved/normalized config the orchestrator actually consumes. */
export interface ResolvedSearchConfig {
  readonly minCosineSimilarity: number;
  readonly minFtsHits: number;
}

/**
 * The two-argument search closure returned by `createSearch`. Async because
 * `Embedder.encode(text)` is async; the ROADMAP shorthand `search(q,k)`
 * describes the capability, not a synchronous signature.
 */
export type SearchFunction = (
  query: string,
  k: number,
) => Promise<readonly RankedSkill[]>;

/** Hydrated result row emitted to the consumer. */
export interface RankedSkill {
  readonly id: number;
  readonly slug: string;
  readonly kind: SkillKind;
  readonly contentYaml: string;
  readonly hash: string;
  readonly rrfScore: number;
  readonly ftsRank?: number;
  readonly vectorRank?: number;
  readonly bm25?: number;
  readonly cosineSimilarity?: number;
}

/**
 * Raw FTS channel candidate (pre-fusion). BM25 is ASC; lower = better.
 * `rank` is the 1-based position in the BM25 ordering.
 */
export interface FtsCandidate {
  readonly id: number;
  readonly bm25: number;
  readonly rank: number;
}

/** FTS adapter result: pre-limit distinct hit count + BM25-ranked candidates. */
export interface FtsSearchResult {
  readonly totalHits: number;
  readonly candidates: readonly FtsCandidate[];
}

/**
 * Raw vector channel candidate (pre-fusion). Cosine distance is ASC.
 * `cosineSimilarity = 1 - distance`. `rank` is 1-based in the k-NN order.
 */
export interface VectorCandidate {
  readonly id: number;
  readonly distance: number;
  readonly cosineSimilarity: number;
  readonly rank: number;
}

/** Internal pre-fusion shape used by the RRF fuser. */
export interface FusedCandidate {
  readonly id: number;
  readonly rrfScore: number;
  readonly ftsRank?: number;
  readonly vectorRank?: number;
  readonly bm25?: number;
  readonly cosineSimilarity?: number;
}