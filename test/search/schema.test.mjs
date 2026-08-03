/**
 * Search schema integration tests.
 *
 * Cover SEARCH-01, SEARCH-02, SEARCH-15 against real FTS5 + sqlite-vec on a
 * fresh `:memory:` better-sqlite3 connection.
 *
 * Strategy: each test opens a fresh DB, runs `createSchema` (the catalog
 * contract) then `initializeSearchStorage`. Assertions probe sqlite_master,
 * pragma table_info, count() on the index tables, and mutating catalog rows
 * to confirm triggers reflect changes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createSchema } from '../../src/catalog/schema.ts';
import {
  initializeSearchStorage,
  SEARCH_TABLES,
} from '../../src/search/schema.ts';
import { SearchError } from '../../src/search/errors.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';

/**
 * Build a fresh :memory: db with the catalog schema, search indexes and a
 * pre-populated catalog row. Embeddings are float32 of the locked dimension.
 */
function freshDbWithOneSkill({
  id = 'demo-skill',
  content = 'debugar react hooks com useEffect',
} = {}) {
  const db = new Database(':memory:');
  createSchema(db);
  initializeSearchStorage(db);
  const embeddingArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  for (let i = 0; i < SEARCH_EMBEDDING_DIMENSIONS; i += 1) {
    embeddingArr[i] = (i % 7) / 7 - 0.5;
  }
  const embedding = Buffer.from(
    embeddingArr.buffer,
    embeddingArr.byteOffset,
    embeddingArr.byteLength,
  );
  db.prepare(
    `INSERT INTO catalog (id, type, text, content_hash, created_at, updated_at)
     VALUES (?, 'skill', ?, ?, ?, ?)`,
  ).run(id, content, `hash-${id}`, 1, 1);
  db.prepare(
    `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
     VALUES (?, ?, ?, ?)`,
  ).run(id, embedding, 'multilingual-e5-small@1', 1);
  return db;
}

test('T-SCHEMA-01: extension loads and vec_version() returns a non-empty string (SEARCH-02, SEARCH-15)', () => {
  const db = new Database(':memory:');
  try {
    createSchema(db);
    initializeSearchStorage(db);
    const row = db.prepare('SELECT vec_version() AS v').get();
    assert.equal(typeof row?.v, 'string');
    assert.ok(/** @type {string} */ (row?.v).length > 0);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-02: catalog_fts is an FTS5 virtual table with external content on text (SEARCH-01)', () => {
  const db = freshDbWithOneSkill();
  try {
    const row = /** @type {{ type: string, sql: string }} */ (
      db
        .prepare(
          "SELECT type, sql FROM sqlite_master WHERE name = ?",
        )
        .get(SEARCH_TABLES.fts)
    );
    assert.equal(row.type, 'table', 'FTS virtual table is reported as table');
    assert.match(row.sql, /catalog_fts/i);
    assert.match(row.sql, /USING fts5/i);
    assert.match(row.sql, /content='catalog'/i);
    assert.match(row.sql, /unicode61/i);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-03: catalog_vec is a vec0 virtual table with float[384] cosine (SEARCH-02)', () => {
  const db = freshDbWithOneSkill();
  try {
    const row = /** @type {{ type: string, sql: string }} */ (
      db
        .prepare(
          "SELECT type, sql FROM sqlite_master WHERE name = ?",
        )
        .get(SEARCH_TABLES.vec)
    );
    assert.equal(row.type, 'table');
    assert.match(row.sql, /USING vec0/i);
    assert.match(row.sql, /float\[384\]/);
    assert.match(row.sql, /distance_metric=cosine/i);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-04: existing rows backfill into both indexes; second init is idempotent (SEARCH-01/02)', () => {
  const db = new Database(':memory:');
  try {
    createSchema(db);
    initializeSearchStorage(db); // init before any rows — backfill is a no-op.

    // Insert 3 rows directly, then re-init: each must appear once per index.
    const embeddingArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    const embedding = Buffer.from(
      embeddingArr.buffer,
      embeddingArr.byteOffset,
      embeddingArr.byteLength,
    );
    const insertCatalog = db.prepare(
      `INSERT INTO catalog (id, type, text, content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertEmbed = db.prepare(
      `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
       VALUES (?, ?, ?, ?)`,
    );
    insertCatalog.run('a', 'skill', 'first row content', 'h1', 1, 1);
    insertEmbed.run('a', embedding, 'multilingual-e5-small@1', 1);
    insertCatalog.run('b', 'rule', 'second row content', 'h2', 1, 1);
    insertEmbed.run('b', embedding, 'multilingual-e5-small@1', 1);
    insertCatalog.run('c', 'persona', 'third row content', 'h3', 1, 1);
    insertEmbed.run('c', embedding, 'multilingual-e5-small@1', 1);

    initializeSearchStorage(db); // backfills 3 rows into both indexes

    const catalogCount = /** @type {{ n: number }} */ (
      db.prepare('SELECT COUNT(*) AS n FROM catalog').get()
    ).n;
    assert.equal(catalogCount, 3);

    // FTS: each rowid exists exactly once.
    const ftsIds = /** @type {Array<{ rowid: number }>} */ (
      db.prepare(`SELECT rowid FROM ${SEARCH_TABLES.fts} ORDER BY rowid`).all()
    ).map((r) => r.rowid);
    assert.deepEqual(ftsIds, [1, 2, 3]);

    // Vec: each rowid exists exactly once.
    const vecIds = /** @type {Array<{ rowid: number }>} */ (
      db.prepare(`SELECT rowid FROM ${SEARCH_TABLES.vec} ORDER BY rowid`).all()
    ).map((r) => r.rowid);
    assert.deepEqual(vecIds, [1, 2, 3]);

    // Re-init again — counts must remain identical.
    initializeSearchStorage(db);
    const ftsCount2 = /** @type {{ n: number }} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM ${SEARCH_TABLES.fts}`).get()
    ).n;
    const vecCount2 = /** @type {{ n: number }} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM ${SEARCH_TABLES.vec}`).get()
    ).n;
    assert.equal(ftsCount2, 3);
    assert.equal(vecCount2, 3);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-05: INSERT on catalog is mirrored to catalog_fts (SEARCH-01)', () => {
  const db = freshDbWithOneSkill();
  try {
    const embeddingArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    const embedding = Buffer.from(
      embeddingArr.buffer,
      embeddingArr.byteOffset,
      embeddingArr.byteLength,
    );
    db.prepare(
      `INSERT INTO catalog (id, type, text, content_hash, created_at, updated_at)
       VALUES (?, 'skill', ?, ?, ?, ?)`,
    ).run('inserted', 'palavra nova', 'h-new', 1, 1);
    db.prepare(
      `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
       VALUES (?, ?, ?, ?)`,
    ).run('inserted', embedding, 'multilingual-e5-small@1', 1);

    const ftsRows = /** @type {Array<{ rowid: number }>} */ (
      db.prepare(`SELECT rowid FROM ${SEARCH_TABLES.fts} ORDER BY rowid`).all()
    );
    assert.deepEqual(ftsRows.map((r) => r.rowid), [1, 2]);

    const hit = db
      .prepare(
        `SELECT rowid FROM ${SEARCH_TABLES.fts} WHERE ${SEARCH_TABLES.fts} MATCH ?`,
      )
      .all('palavra');
    assert.deepEqual(hit.map((/** @type {{ rowid: number }} */ r) => r.rowid), [2]);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-06: UPDATE of text on catalog updates the FTS row (SEARCH-01)', () => {
  const db = freshDbWithOneSkill();
  try {
    db.prepare(`UPDATE catalog SET text = ? WHERE id = ?`).run(
      'conteudo totalmente novo',
      'demo-skill',
    );
    const oldHits = db
      .prepare(
        `SELECT rowid FROM ${SEARCH_TABLES.fts} WHERE ${SEARCH_TABLES.fts} MATCH ?`,
      )
      .all('debugar');
    assert.deepEqual(
      oldHits.map((/** @type {{ rowid: number }} */ r) => r.rowid),
      [],
      'old lexical content must be gone after text update',
    );
    const newHits = db
      .prepare(
        `SELECT rowid FROM ${SEARCH_TABLES.fts} WHERE ${SEARCH_TABLES.fts} MATCH ?`,
      )
      .all('conteudo');
    assert.deepEqual(
      newHits.map((/** @type {{ rowid: number }} */ r) => r.rowid),
      [1],
    );
  } finally {
    db.close();
  }
});

test('T-SCHEMA-07: UPDATE of vector on embeddings replaces the vec row (SEARCH-02)', () => {
  const db = freshDbWithOneSkill();
  try {
    const newEmbeddingArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    for (let i = 0; i < SEARCH_EMBEDDING_DIMENSIONS; i += 1) {
      newEmbeddingArr[i] = 0.99 - i / 1000;
    }
    const newEmbedding = Buffer.from(
      newEmbeddingArr.buffer,
      newEmbeddingArr.byteOffset,
      newEmbeddingArr.byteLength,
    );
    db.prepare(`UPDATE embeddings SET vector = ? WHERE catalog_id = ?`).run(
      newEmbedding,
      'demo-skill',
    );

    const row = db
      .prepare(
        `SELECT rowid FROM ${SEARCH_TABLES.vec} WHERE rowid = ?`,
      )
      .get(1);
    assert.ok(row, 'vec row must still exist after update');

    // Count should remain 1 (delete-then-insert).
    const count = /** @type {{ n: number }} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM ${SEARCH_TABLES.vec}`).get()
    ).n;
    assert.equal(count, 1);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-08: DELETE on catalog removes row from both indexes (SEARCH-01/02)', () => {
  const db = freshDbWithOneSkill();
  try {
    db.prepare(`DELETE FROM catalog WHERE id = ?`).run('demo-skill');

    const ftsCount = /** @type {{ n: number }} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM ${SEARCH_TABLES.fts}`).get()
    ).n;
    const vecCount = /** @type {{ n: number }} */ (
      db.prepare(`SELECT COUNT(*) AS n FROM ${SEARCH_TABLES.vec}`).get()
    ).n;
    assert.equal(ftsCount, 0);
    assert.equal(vecCount, 0);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-09: missing catalog table throws SearchError(SCHEMA_ERROR) before extension load (SEARCH-15)', () => {
  const db = new Database(':memory:');
  try {
    // Deliberately skip createSchema — initializeSearchStorage must refuse.
    assert.throws(
      () => initializeSearchStorage(db),
      (err) => {
        assert.ok(err instanceof SearchError);
        assert.equal(/** @type {SearchError} */ (err).code, 'SCHEMA_ERROR');
        return true;
      },
    );
  } finally {
    db.close();
  }
});

test('T-SCHEMA-10: typed precondition boundary raises SearchError on a closed handle (SEARCH-15)', () => {
  const db = new Database(':memory:');
  createSchema(db);
  // Close the underlying handle so the next prepare() inside
  // initializeSearchStorage throws a raw driver error. The contract is that
  // every failure at this boundary becomes a typed SearchError, not a raw
  // TypeError leaking out.
  db.close();
  let caught = null;
  try {
    initializeSearchStorage(db);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError, 'expected typed SearchError');
  // Either precondition may fire first; both are typed.
  assert.ok(
    /** @type {SearchError} */ (caught).code === 'SCHEMA_ERROR' ||
      /** @type {SearchError} */ (caught).code === 'VECTOR_EXTENSION_UNAVAILABLE',
    `expected SCHEMA_ERROR or VECTOR_EXTENSION_UNAVAILABLE, got ${/** @type {SearchError} */ (caught).code}`,
  );
});