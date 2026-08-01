/**
 * GET /catalog endpoint (Phase 5b T-05).
 *
 * Returns the full catalog as a JSON array. Each item carries:
 *   id, type, title, text, critical?, is_default?, content_hash,
 *   created_at, updated_at, plus embeddings metadata (NOT raw vectors):
 *   embedding_model_version, embedding_dimensions, has_embedding.
 *
 * Joins `catalog` + `embeddings` via LEFT JOIN so items without
 * embeddings surface as `has_embedding: false` and the dimensions
 * fields are `null`. Items are sorted by `id ASC` for determinism.
 *
 * Per R-03 this endpoint is read-only and does NOT enqueue audit
 * events (the audit log records mutations, not reads).
 *
 * Returns 200 with `[]` when the catalog is empty (NOT 404 — an
 * empty catalog is a valid state, not an error).
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';

interface CatalogItemResponse {
  id: string;
  type: string;
  title: string | null;
  text: string;
  critical: boolean | null;
  is_default: boolean | null;
  content_hash: string;
  created_at: number;
  updated_at: number;
  embedding_model_version: string | null;
  embedding_dimensions: number | null;
  has_embedding: boolean;
}

export async function registerCatalogListRoute(
  app: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  app.get('/catalog', async (): Promise<ReadonlyArray<CatalogItemResponse>> => {
    const rows = opts.db
      .prepare(
        `SELECT
           c.id,
           c.type,
           c.title,
           c.text,
           c.critical,
           c.is_default,
           c.content_hash,
           c.created_at,
           c.updated_at,
           e.model_version AS embedding_model_version,
           e.embedded_at  AS embedding_embedded_at,
           CASE WHEN e.catalog_id IS NULL THEN 0 ELSE 1 END AS has_embedding
         FROM catalog c
         LEFT JOIN embeddings e ON e.catalog_id = c.id
         ORDER BY c.id ASC`,
      )
      .all() as Array<{
      id: string;
      type: string;
      title: string | null;
      text: string;
      critical: number | null;
      is_default: number | null;
      content_hash: string;
      created_at: number;
      updated_at: number;
      embedding_model_version: string | null;
      embedding_embedded_at: number | null;
      has_embedding: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      text: row.text,
      critical: row.critical === null ? null : row.critical === 1,
      is_default: row.is_default === null ? null : row.is_default === 1,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
      embedding_model_version: row.embedding_model_version,
      // The catalog embedding is multilingual-e5-small = 384d
      // (src/catalog/embedder/index.ts EMBEDDING_DIMENSIONS). When
      // an embedding row exists we surface the static dimension
      // count; when not, dimensions is null (matches has_embedding).
      embedding_dimensions: row.has_embedding === 1 ? 384 : null,
      has_embedding: row.has_embedding === 1,
    }));
  });
}