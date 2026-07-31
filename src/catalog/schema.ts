/**
 * Compatibility shim for `test/search/**` integration tests that still
 * expect the legacy calibration-era `createSchema(db)` symbol.
 *
 * Phase 1.1 deletes the calibration DDL module but Phase 5 / search tests
 * (out of Phase 1.1 scope) still need the original `skills` table shape
 * for their in-memory seeds. We recreate the minimal DDL on demand so
 * those suites can still run while Phase 1.1 lands.
 */

import type { Database } from 'better-sqlite3';

export function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_yaml TEXT NOT NULL,
      embedding BLOB NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export const EMBEDDING_DIMENSIONS = 384;
export const SEARCH_EMBEDDING_DIMENSIONS = 384;

export default createSchema;