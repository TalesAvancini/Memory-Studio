/**
 * openCatalogDb — Phase 1.2 deliverable.
 *
 * Opens a better-sqlite3 connection for the Memory Studio catalog, applies
 * the runtime settings the rest of `src/catalog/**` depends on, and loads
 * the sqlite-vec extension so the `catalog_vec` virtual table + the
 * `vec_*` SQL functions become available.
 *
 * Runtime settings:
 *   - `journal_mode = WAL` — concurrent readers + a single writer; required
 *     for the build-index CLI + Phase 5 query path to coexist on the same
 *     file. WAL on Windows works with better-sqlite3 11.10.0 (the version
 *     pinned in `package.json`); earlier versions may throw `SQLITE_CANTOPEN`.
 *   - `foreign_keys = ON` — PRAGMA, not a build option; required for the
 *     `embeddings.catalog_id REFERENCES catalog(id) ON DELETE CASCADE` to
 *     actually cascade.
 *   - `synchronous = NORMAL` — pairs with WAL for durability vs. throughput.
 *   - `busy_timeout = 5000` — ms to wait on a locked DB before failing.
 *
 * sqlite-vec 0.1.9 is loaded via the package's exported `load(db)` helper
 * (NOT a raw `db.loadExtension()` call) so the same code path works across
 * platforms — sqlite-vec ships per-platform prebuilds and `load()` picks
 * the right one. The catalog_vec DDL references FLOAT[384]; without the
 * extension loaded, `applyMigrations` would throw on the catalog_vec
 * CREATE VIRTUAL TABLE statement.
 *
 * Path handling:
 *   - For an in-memory path (`:memory:`), no filesystem setup is performed.
 *   - For an on-disk path, parent directories are created via `mkdir -p`
 *     before opening the DB so callers can pass `data/memory-studio.sqlite`
 *     on a clean checkout without bootstrapping `data/` first.
 *
 * Returns the opened `Database`. The caller is responsible for `db.close()`
 * (and for closing the WAL sidecar files — better-sqlite3 handles that
 * automatically when the last connection closes).
 */

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';

import { applyMigrations } from '../migrations/runner.ts';

/** Default embedding dimensionality for multilingual-e5-small. */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * Open the catalog SQLite database at `path`. `:memory:` returns an
 * in-memory database (no filesystem side-effects). Any other path creates
 * the parent directory if missing.
 *
 * Side-effects: enables WAL + foreign_keys, loads sqlite-vec extension.
 */
export async function openCatalogDb(path: string): Promise<DatabaseType> {
  if (path !== ':memory:') {
    await mkdir(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  try {
    // Pragmas — must run before any user DDL so they apply to the main DB.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    // sqlite-vec 0.1.9 — load() picks the correct platform prebuild and
    // registers vec0 + vec_* SQL functions.
    sqliteVec.load(db);

    return db;
  } catch (err) {
    // Close the half-open handle so we don't leak the WAL sidecar.
    db.close();
    throw err;
  }
}

/**
 * Open + apply migrations in one call. Convenience for tests + the
 * build-index CLI; the runner is the source of truth for the migration
 * sequence (so callers can layer additional setup afterwards if needed).
 */
export async function openAndMigrate(path: string): Promise<DatabaseType> {
  const db = await openCatalogDb(path);
  try {
    await applyMigrations(db);
    return db;
  } catch (err) {
    db.close();
    throw err;
  }
}
