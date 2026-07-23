/**
 * Search-domain storage initializer.
 *
 * Owns:
 *   - Loading the sqlite-vec extension and capability-checking it.
 *   - Creating `content_fts` (FTS5, external-content over `skills.content_yaml`).
 *   - Creating `skill_embeddings` (vec0, float[384] cosine, keyed by skills.id).
 *   - Creating sync triggers so future INSERT/UPDATE/DELETE on `skills`
 *     keep both indexes consistent without modifying `src/catalog/**`.
 *   - Idempotently backfilling existing rows on each invocation.
 *
 * Design constraints:
 *   - No `any`. No barrel `src/search/index.ts`. No edits under `src/catalog/**`.
 *   - All work is wrapped in a single better-sqlite3 transaction so a DDL or
 *     backfill failure rolls back cleanly.
 *   - Typed errors are thrown via `SearchError`. Query content is never
 *     included in messages (only types/identifiers).
 *
 * sqlite-vec 0.1.9 quirk:
 *   - better-sqlite3 binding from JS Number to a vec0 PK column is rejected
 *     ("Only integers are allows"). Triggers reading `new.id` work because
 *     SQLite passes the rowid as a proper INTEGER. We therefore use the
 *     implicit rowid (= skills.id) for the vec0 table and bind BigInt only
 *     during the JavaScript backfill loop.
 */

import type { Database } from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import { asSearchError, SearchError } from './errors.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from './types.ts';

const FTS_TABLE = 'content_fts';
const VEC_TABLE = 'skill_embeddings';

interface SkillsRowMeta {
  id: number;
  content_yaml: string;
  embedding: Buffer;
}

interface ExtractedFtsRow {
  rowid: number;
}

/**
 * Validate that `skills` exists with the expected columns. Throws a typed
 * `SearchError(SCHEMA_ERROR)` if the catalog is missing or has a different
 * shape; the schema initializer must not run on top of an unknown table.
 *
 * Any raw driver failure (e.g. a closed connection) is also wrapped as
 * `SearchError(SCHEMA_ERROR)` so callers always see a typed boundary.
 */
function verifySkillsTable(db: Database): void {
  let row: { name: string } | undefined;
  try {
    row = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='skills'",
      )
      .get();
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw asSearchError(err, 'SCHEMA_ERROR', 'skills table verification failed');
  }
  if (!row) {
    throw new SearchError(
      'skills table is required before search schema initialization',
      'SCHEMA_ERROR',
    );
  }
  let cols: Array<{ name: string }>;
  try {
    cols = db.prepare<[], { name: string }>('PRAGMA table_info(skills)').all();
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw asSearchError(err, 'SCHEMA_ERROR', 'skills column verification failed');
  }
  const names = new Set(cols.map((c) => c.name));
  const required = ['id', 'slug', 'kind', 'content_yaml', 'embedding', 'hash'];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new SearchError(
      `skills table missing required columns: ${missing.join(',')}`,
      'SCHEMA_ERROR',
    );
  }
}

/** Load sqlite-vec into the connection and verify the extension responded. */
function loadAndVerifyVectorExtension(db: Database): void {
  try {
    loadSqliteVec(db);
  } catch (err) {
    throw new SearchError(
      'sqlite-vec failed to load into better-sqlite3 connection',
      'VECTOR_EXTENSION_UNAVAILABLE',
      err,
    );
  }
  let version: unknown;
  try {
    const row = db.prepare<[], { v: string }>('SELECT vec_version() AS v').get();
    version = row?.v;
  } catch (err) {
    throw asSearchError(
      err,
      'VECTOR_EXTENSION_UNAVAILABLE',
      'vec_version() probe failed',
    );
  }
  if (typeof version !== 'string' || version.length === 0) {
    throw new SearchError(
      'vec_version() did not return a non-empty string',
      'VECTOR_EXTENSION_UNAVAILABLE',
    );
  }
}

/** Create FTS5 + vec0 virtual tables and the sync triggers. */
function createVirtualTablesAndTriggers(db: Database): void {
  const createFts = db.prepare(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
       content_yaml,
       content='skills',
       content_rowid='id',
       tokenize='unicode61 remove_diacritics 2'
     )`,
  );
  createFts.run();

  // sqlite-vec 0.1.9 quirk: explicit non-rowid INTEGER PRIMARY KEY columns
  // are rejected by the JS binding path. We rely on the implicit rowid
  // (= skills.id) and store only the vector column.
  const createVec = db.prepare(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(
       embedding float[${SEARCH_EMBEDDING_DIMENSIONS}] distance_metric=cosine
     )`,
  );
  createVec.run();

  // FTS sync triggers — FTS5 external-content protocol.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ai_fts
    AFTER INSERT ON skills BEGIN
      INSERT INTO ${FTS_TABLE}(rowid, content_yaml) VALUES (new.id, new.content_yaml);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_au_content_fts
    AFTER UPDATE OF content_yaml ON skills BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, content_yaml)
        VALUES ('delete', old.id, old.content_yaml);
      INSERT INTO ${FTS_TABLE}(rowid, content_yaml) VALUES (new.id, new.content_yaml);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_ad_fts
    AFTER DELETE ON skills BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, content_yaml)
        VALUES ('delete', old.id, old.content_yaml);
    END;
  `);

  // Vec sync triggers — sqlite-vec 0.1.9 accepts INTEGER values passed by
  // SQLite itself (e.g. new.id / old.id inside triggers); only the JS
  // binding path rejects plain Number primary keys.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS skills_ai_vec
    AFTER INSERT ON skills BEGIN
      INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (new.id, new.embedding);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_au_embedding_vec
    AFTER UPDATE OF embedding ON skills BEGIN
      DELETE FROM ${VEC_TABLE} WHERE rowid = old.id;
      INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (new.id, new.embedding);
    END;

    CREATE TRIGGER IF NOT EXISTS skills_ad_vec
    AFTER DELETE ON skills BEGIN
      DELETE FROM ${VEC_TABLE} WHERE rowid = old.id;
    END;
  `);
}

/**
 * Reconcile both indexes to current `skills` rows. Called once per
 * initialization. Removes stale FTS rows and rebuilds the vec table from
 * scratch so a second call leaves exactly one row per skill in each index.
 *
 * Uses BigInt for the rowid bind because sqlite-vec's vec0 binding path
 * rejects plain Number primary keys when called from JS.
 */
function reconcileIndexes(db: Database): void {
  // 1. Drop FTS rows whose underlying skill no longer exists.
  const ftsRows = db.prepare<[], ExtractedFtsRow>(`SELECT rowid FROM ${FTS_TABLE}`).all();
  const skillRows = db.prepare<[], { id: number }>('SELECT id FROM skills').all();
  const skillIds = new Set(skillRows.map((r) => r.id));

  if (ftsRows.length > 0) {
    const deleteFts = db.prepare(`DELETE FROM ${FTS_TABLE} WHERE rowid = ?`);
    for (const fts of ftsRows) {
      if (!skillIds.has(fts.rowid)) {
        deleteFts.run(fts.rowid);
      }
    }
  }

  // 2. Rebuild vec table from scratch — it only mirrors skills.id +
  //    skills.embedding and is cheap at expected catalog scale.
  db.exec(`DELETE FROM ${VEC_TABLE}`);

  const allSkills = db
    .prepare<[], SkillsRowMeta>('SELECT id, content_yaml, embedding FROM skills')
    .all();
  const insertFts = db.prepare(
    `INSERT INTO ${FTS_TABLE}(rowid, content_yaml) VALUES (?, ?)`,
  );
  const insertVec = db.prepare(
    `INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (?, ?)`,
  );
  for (const row of allSkills) {
    insertFts.run(row.id, row.content_yaml);
    insertVec.run(BigInt(row.id), row.embedding);
  }
}

/**
 * Initialize search-domain storage (FTS5 + sqlite-vec + triggers + backfill)
 * atomically on a caller-owned `better-sqlite3` connection.
 *
 * Safe to call repeatedly: DDL uses `IF NOT EXISTS`, the trigger names are
 * fixed, and the backfill is idempotent.
 *
 * Throws `SearchError(SCHEMA_ERROR | VECTOR_EXTENSION_UNAVAILABLE)` if the
 * catalog is missing/malformed or the extension cannot be loaded. A failure
 * leaves the connection in its prior state because the work runs inside a
 * `db.transaction(...)` block.
 */
export function initializeSearchStorage(db: Database): void {
  // 1. Pre-conditions — these checks throw before we mutate anything.
  verifySkillsTable(db);
  loadAndVerifyVectorExtension(db);

  // 2. All DDL + backfill in a single transaction.
  const txn = db.transaction(() => {
    createVirtualTablesAndTriggers(db);
    reconcileIndexes(db);
  });
  try {
    txn();
  } catch (err) {
    throw asSearchError(err, 'SCHEMA_ERROR', 'search schema initialization failed');
  }
}

/** Public table-name constants for downstream adapters and tests. */
export const SEARCH_TABLES = {
  fts: FTS_TABLE,
  vec: VEC_TABLE,
} as const;