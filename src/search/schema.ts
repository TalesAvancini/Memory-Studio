/**
 * Search-domain storage initializer.
 *
 * Owns:
 *   - Loading the sqlite-vec extension and capability-checking it.
 *   - Creating `catalog_fts` (FTS5, external-content over `catalog.text`).
 *   - Creating `catalog_vec` (vec0, float[384] cosine, keyed by catalog.rowid).
 *   - Creating sync triggers so future INSERT/UPDATE/DELETE on `catalog`
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
 * sqlite-vec 0.1.9 quirks:
 *   - JS Number binding for the vec0 PK column is rejected with the
 *     "Only integers are allows for primary key values" error. We bind
 *     BigInt() during the JavaScript backfill loop and from JS-prepared
 *     INSERT statements. Triggers reading `new.rowid` pass INTEGER through
 *     SQLite's own column-reference path so they accept regular SQL
 *     values directly.
 *   - Without an explicit INTEGER PRIMARY KEY, sqlite-vec exposes the
 *     implicit `rowid` column. All adapter SQL uses `rowid` directly.
 */

import type { Database } from 'better-sqlite3';
import { load as loadSqliteVec } from 'sqlite-vec';
import { asSearchError, SearchError } from './errors.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from './types.ts';

const FTS_TABLE = 'catalog_fts';
const VEC_TABLE = 'catalog_vec';

interface EmbeddingsRowMeta {
  rowid: number;
  vector: Buffer;
}

interface ExtractedFtsRow {
  rowid: number;
}

/**
 * Validate that `catalog` exists with the expected columns. Throws a typed
 * `SearchError(SCHEMA_ERROR)` if the catalog is missing or has a different
 * shape; the schema initializer must not run on top of an unknown table.
 *
 * Any raw driver failure (e.g. a closed connection) is also wrapped as
 * `SearchError(SCHEMA_ERROR)` so callers always see a typed boundary.
 */
function verifyCatalogTable(db: Database): void {
  let row: { name: string } | undefined;
  try {
    row = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='catalog'",
      )
      .get();
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw asSearchError(err, 'SCHEMA_ERROR', 'catalog table verification failed');
  }
  if (!row) {
    throw new SearchError(
      'catalog table is required before search schema initialization',
      'SCHEMA_ERROR',
    );
  }
  let cols: Array<{ name: string }>;
  try {
    cols = db.prepare<[], { name: string }>('PRAGMA table_info(catalog)').all();
  } catch (err) {
    if (err instanceof SearchError) throw err;
    throw asSearchError(err, 'SCHEMA_ERROR', 'catalog column verification failed');
  }
  const names = new Set(cols.map((c) => c.name));
  const required = ['id', 'type', 'text'];
  const missing = required.filter((n) => !names.has(n));
  if (missing.length > 0) {
    throw new SearchError(
      `catalog table missing required columns: ${missing.join(',')}`,
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
       text,
       content='catalog',
       content_rowid='rowid',
       tokenize='unicode61 remove_diacritics 2'
     )`,
  );
  createFts.run();

  // vec0 declared WITHOUT an explicit INTEGER PRIMARY KEY so the
  // implicit `rowid` column is exposed — production wires embeddings via
  // embeddings_ai/ad triggers that bind new.rowid / old.rowid. The
  // JS-side backfill binds BigInt() because sqlite-vec 0.1.9's binding
  // path rejects plain Number values for the implicit rowid; trigger-
  // side references to new.rowid / old.rowid continue to work because
  // SQLite passes the column reference as a true INTEGER.
  const createVec = db.prepare(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${VEC_TABLE} USING vec0(
       embedding float[${SEARCH_EMBEDDING_DIMENSIONS}] distance_metric=cosine
     )`,
  );
  createVec.run();

  // FTS sync triggers — FTS5 external-content protocol. catalog.id is
  // TEXT and the FTS rowid is the catalog rowid (INTEGER). The
  // (catalog_fts, rowid, ...) delete-command syntax is FTS5-standard
  // and only valid on FTS5 tables.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS catalog_ai_fts
    AFTER INSERT ON catalog BEGIN
      INSERT INTO ${FTS_TABLE}(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS catalog_au_fts
    AFTER UPDATE OF text ON catalog BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, text)
        VALUES ('delete', old.rowid, old.text);
      INSERT INTO ${FTS_TABLE}(rowid, text) VALUES (new.rowid, new.text);
    END;

    CREATE TRIGGER IF NOT EXISTS catalog_ad_fts
    AFTER DELETE ON catalog BEGIN
      INSERT INTO ${FTS_TABLE}(${FTS_TABLE}, rowid, text)
        VALUES ('delete', old.rowid, old.text);
    END;
  `);

  // Vec sync triggers — embed rows are added/removed via the embeddings
  // table; their rowid is the catalog rowid by referential cascade, so
  // we bind new.rowid / old.rowid to the vec table's implicit rowid.
  // vec0 uses regular SQL DELETE (NOT the FTS5 ('delete', ...) command).
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS embeddings_ai_vec
    AFTER INSERT ON embeddings BEGIN
      INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (new.rowid, new.vector);
    END;

    CREATE TRIGGER IF NOT EXISTS embeddings_au_vec
    AFTER UPDATE OF vector ON embeddings BEGIN
      DELETE FROM ${VEC_TABLE} WHERE rowid = old.rowid;
      INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (new.rowid, new.vector);
    END;

    CREATE TRIGGER IF NOT EXISTS embeddings_ad_vec
    AFTER DELETE ON embeddings BEGIN
      DELETE FROM ${VEC_TABLE} WHERE rowid = old.rowid;
    END;
  `);
}

/**
 * Reconcile both indexes to current `catalog` rows. Called once per
 * initialization. Removes stale FTS rows and rebuilds the vec table from
 * scratch so a second call leaves exactly one row per catalog entry in
 * each index.
 *
 * Uses BigInt for the vec PK bind because sqlite-vec's vec0 0.1.9 binding
 * path rejects plain Number primary keys when called from JS. The FTS
 * rowid column is unrelated to this quirk and uses plain Number.
 */
function reconcileIndexes(db: Database): void {
  // 1. Drop FTS rows whose underlying catalog entry no longer exists.
  const ftsRows = db.prepare<[], ExtractedFtsRow>(`SELECT rowid FROM ${FTS_TABLE}`).all();
  const catalogRows = db
    .prepare<[], { rowid: number }>('SELECT rowid FROM catalog')
    .all();
  const catalogRowids = new Set(catalogRows.map((r) => r.rowid));

  if (ftsRows.length > 0) {
    const deleteFts = db.prepare(`DELETE FROM ${FTS_TABLE} WHERE rowid = ?`);
    for (const fts of ftsRows) {
      if (!catalogRowids.has(fts.rowid)) {
        deleteFts.run(fts.rowid);
      }
    }
  }

  // 2. Rebuild vec table from scratch — it only mirrors embeddings.vector
  //    (which is keyed by catalog.rowid via FK cascade) and is cheap at
  //    expected catalog scale.
  db.exec(`DELETE FROM ${VEC_TABLE}`);

  const allEmbeddings = db
    .prepare<[], EmbeddingsRowMeta>(
      `SELECT e.rowid AS rowid, e.vector AS vector
       FROM embeddings e
       INNER JOIN catalog c ON c.rowid = e.rowid`,
    )
    .all();
  const insertFts = db.prepare(
    `INSERT INTO ${FTS_TABLE}(rowid, text) VALUES (?, ?)`,
  );
  const catalogTextStmt = db.prepare<[number], { text: string }>(
    'SELECT text FROM catalog WHERE rowid = ?',
  );
  // vec0 implicit rowid: sqlite-vec 0.1.9's JS binding path requires
  // BigInt() for this column, while trigger-side references (new.rowid)
  // work without the conversion.
  const insertVec = db.prepare(
    `INSERT INTO ${VEC_TABLE}(rowid, embedding) VALUES (?, ?)`,
  );
  for (const row of allEmbeddings) {
    const textRow = catalogTextStmt.get(row.rowid);
    if (textRow === undefined) continue; // orphan embedding — skip
    insertFts.run(row.rowid, textRow.text);
    insertVec.run(BigInt(row.rowid), row.vector);
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
  verifyCatalogTable(db);
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