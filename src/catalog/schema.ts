/**
 * SQLite DDL for the catalog domain.
 *
 * Two tables:
 * - `skills` — the catalog itself (one row per skill/rule/persona).
 * - `audit_events` — append-only audit trail. Phase 2 only creates the table;
 *   writers for it land in Phase 5/6 when the augment path is real.
 *
 * createSchema(db) is idempotent (CREATE TABLE IF NOT EXISTS) so it can be
 * called multiple times in test runs against `:memory:` databases without
 * throwing. The writer is what actually opens / closes the connection —
 * schema.ts only owns the DDL.
 */

import type { Database } from 'better-sqlite3';
import { SchemaError } from './errors.ts';

export function createSchema(db: Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('skill','rule','persona')),
        content_yaml TEXT NOT NULL,
        embedding BLOB NOT NULL,
        hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        tenant_hash TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
  } catch (err) {
    throw new SchemaError(
      `createSchema failed: ${err instanceof Error ? err.message : String(err)}`,
      'DB_ERROR',
    );
  }
}