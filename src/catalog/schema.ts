/**
 * Compatibility shim for `test/search/**` integration tests that still
 * expect the calibration-era `createSchema(db)` symbol.
 *
 * Phase 1.2 deletes the calibration DDL module but `test/search/**` and
 * a few `test/augment/**` fixtures still need a source table to drive
 * `initializeSearchStorage(db)`. We recreate the production `catalog`
 * table on demand so those suites can still run.
 *
 * The shape mirrors the migration DDL in
 * `src/catalog/migrations/001_init.sql` (catalog.id TEXT, catalog.text
 * TEXT) and is the SAME schema the production on-disk DB uses, so
 * retrieval hydration against `catalog` works without a separate path.
 */

import type { Database } from 'better-sqlite3';

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      category TEXT,
      critical INTEGER,
      is_default INTEGER,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      catalog_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      model_version TEXT NOT NULL,
      embedded_at INTEGER NOT NULL
    );
  `);
}

export const EMBEDDING_DIMENSIONS = 384;
export const SEARCH_EMBEDDING_DIMENSIONS = 384;

export default createSchema;