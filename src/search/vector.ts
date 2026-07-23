/**
 * Cosine k-NN retrieval over the sqlite-vec `skill_embeddings` table.
 *
 * Design constraints:
 *   - Validate the query embedding (length === SEARCH_EMBEDDING_DIMENSIONS,
 *     every element finite) BEFORE any native binding. A bad input becomes
 *     `SearchError(INVALID_EMBEDDING)` and never reaches sqlite-vec.
 *   - The KNN query uses `embedding MATCH ? AND k = ?` with the embedding
 *     bound as the raw Float32Array. sqlite-vec exposes the cosine distance;
 *     similarity is computed as `1 - distance`.
 *   - 1-based ranks are derived from the ASC ordering sqlite-vec returns.
 *   - Empty table returns `[]`; SQL failures become `SearchError(QUERY_ERROR)`
 *     without leaking the embedding bytes into the message.
 */

import type { Database } from 'better-sqlite3';
import { asSearchError, SearchError } from './errors.ts';
import type { VectorCandidate } from './types.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from './types.ts';
import { SEARCH_TABLES } from './schema.ts';

const VEC_TABLE = SEARCH_TABLES.vec;

interface VecRow {
  rowid: number;
  distance: number;
}

/**
 * Validate an embedding before binding. Throws `SearchError(INVALID_EMBEDDING)`
 * if the array has the wrong length or any non-finite element.
 */
export function validateEmbedding(embedding: unknown): asserts embedding is Float32Array {
  if (!(embedding instanceof Float32Array)) {
    throw new SearchError(
      `embedding must be a Float32Array, got ${typeof embedding}`,
      'INVALID_EMBEDDING',
    );
  }
  if (embedding.length !== SEARCH_EMBEDDING_DIMENSIONS) {
    throw new SearchError(
      `embedding must have ${SEARCH_EMBEDDING_DIMENSIONS} dims, got ${embedding.length}`,
      'INVALID_EMBEDDING',
    );
  }
  for (let i = 0; i < embedding.length; i += 1) {
    const v = embedding[i];
    if (!Number.isFinite(v)) {
      throw new SearchError(
        `embedding[${i}] is not finite`,
        'INVALID_EMBEDDING',
      );
    }
  }
}

/**
 * Run the vector channel: validate the embedding, then issue a k-NN query
 * against `skill_embeddings` capped at `limit` candidates.
 *
 * Empty table returns `{ candidates: [] }` (no error). SQL failure becomes
 * `SearchError(QUERY_ERROR)` with the original cause attached.
 */
export function queryVector(
  db: Database,
  embedding: Float32Array,
  limit: number,
): readonly VectorCandidate[] {
  validateEmbedding(embedding);

  try {
    const rows = db
      .prepare<[Float32Array, number], VecRow>(
        `SELECT rowid AS rowid, distance
         FROM ${VEC_TABLE}
         WHERE embedding MATCH ? AND k = ?
         ORDER BY distance ASC`,
      )
      .all(embedding, limit);

    return rows.map((row, idx) => ({
      id: row.rowid,
      distance: row.distance,
      cosineSimilarity: 1 - row.distance,
      rank: idx + 1,
    }));
  } catch (err) {
    throw asSearchError(err, 'QUERY_ERROR', 'sqlite-vec k-NN failed');
  }
}