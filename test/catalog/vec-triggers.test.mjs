/**
 * sqlite-vec trigger integration tests (T-08).
 *
 * Derived from spec acceptance criteria:
 *   - AC-8: embeddings.vector column is a non-empty BLOB; vec_length(catalog_vec.embedding)
 *     = 384 for every row; vec_distance_cosine(catalog_vec.embedding, ?) returns a finite
 *     float for an arbitrary query embedding.
 *   - R-07: sqlite-vec virtual table catalog_vec (384d, cosine distance) mirrors
 *     embeddings.vector with INSERT/DELETE triggers keeping it in sync.
 *
 * Each test opens a fresh :memory: DB via `openAndMigrate`, inserts a catalog
 * row + its embedding, then probes catalog_vec with vec_length and
 * vec_distance_cosine. Cascade delete from catalog → embeddings → catalog_vec
 * is exercised end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openAndMigrate } from '../../src/catalog/db/open.ts';

/** Build a deterministic 384d Float32 embedding as a BLOB-ready Buffer. */
function makeEmbedding(seed = 1) {
  const arr = new Float32Array(384);
  for (let i = 0; i < 384; i += 1) {
    arr[i] = ((i * seed) % 97) / 97 - 0.5;
  }
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/** Insert catalog row + matching embeddings row + compute rowid from catalog. */
function insertSkillWithEmbedding(db, { id, text = 'some text' }) {
  const ts = Date.now();
  db.prepare(
    `INSERT INTO catalog (id, type, title, text, category, critical, is_default, content_hash, created_at, updated_at)
     VALUES (?, 'skill', ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(id, `Title ${id}`, text, `hash-${id}`, ts, ts);
  db.prepare(
    'INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at) VALUES (?, ?, ?, ?)',
  ).run(id, makeEmbedding(id.length), 'multilingual-e5-small-v1', ts);
}

test('catalog_vec is a vec0 virtual table with float[384] cosine distance (AC-8)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'catalog_vec'")
      .get();
    assert.ok(row);
    assert.match(row.sql, /USING vec0/i);
    assert.match(row.sql, /float\[384\]/i);
  } finally {
    db.close();
  }
});

test('embeddings_ai trigger inserts a row into catalog_vec (R-07)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertSkillWithEmbedding(db, { id: 'skill-1' });

    const row = db
      .prepare(
        'SELECT rowid, vec_length(catalog_vec.embedding) AS len FROM catalog_vec',
      )
      .get();
    assert.ok(row, 'catalog_vec must contain a row after embeddings INSERT');
    assert.equal(row.len, 384, 'vec_length must equal 384');
  } finally {
    db.close();
  }
});

test('embeddings_au trigger replaces the catalog_vec row on UPDATE (R-07)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertSkillWithEmbedding(db, { id: 'skill-1' });

    // The catalog row gets rowid=1; embeddings and catalog_vec mirror it.
    const before = db
      .prepare('SELECT rowid, vec_length(embedding) AS len FROM catalog_vec')
      .get();
    assert.equal(before.rowid, 1);
    assert.equal(before.len, 384);

    const newVec = makeEmbedding(99);
    db.prepare('UPDATE embeddings SET vector = ? WHERE catalog_id = ?').run(
      newVec,
      'skill-1',
    );

    // After update, rowid=1 must still exist with length 384.
    const after = db
      .prepare('SELECT COUNT(*) AS n FROM catalog_vec WHERE rowid = 1')
      .get();
    assert.equal(after.n, 1, 'rowid 1 must still exist (delete + insert pattern)');

    const len = db
      .prepare('SELECT vec_length(embedding) AS len FROM catalog_vec WHERE rowid = 1')
      .get();
    assert.equal(len.len, 384);
  } finally {
    db.close();
  }
});

test('embeddings_ad trigger + ON DELETE CASCADE removes catalog_vec row (AC-7, R-07)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertSkillWithEmbedding(db, { id: 'skill-1' });
    insertSkillWithEmbedding(db, { id: 'skill-2' });

    const before = db.prepare('SELECT COUNT(*) AS n FROM catalog_vec').get();
    assert.equal(before.n, 2);

    // Cascade: catalog → embeddings → catalog_vec
    db.prepare('DELETE FROM catalog WHERE id = ?').run('skill-1');

    const after = db.prepare('SELECT COUNT(*) AS n FROM catalog_vec').get();
    assert.equal(after.n, 1, 'one catalog_vec row must remain after cascade');

    const remaining = db
      .prepare('SELECT rowid FROM catalog_vec')
      .get();
    assert.ok(remaining, 'exactly one catalog_vec row must remain');

    // The remaining rowid must point back to skill-2's catalog rowid.
    const catalogRow = db
      .prepare('SELECT id FROM catalog WHERE rowid = ?')
      .get(remaining.rowid);
    assert.equal(catalogRow.id, 'skill-2');
  } finally {
    db.close();
  }
});

test('vec_distance_cosine returns a finite float for arbitrary query embeddings (AC-8)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertSkillWithEmbedding(db, { id: 'skill-1' });
    insertSkillWithEmbedding(db, { id: 'skill-2' });

    // Query with a different embedding seed — must return a finite cosine
    // distance (NOT NaN, NOT Infinity, NOT null).
    const queryVec = makeEmbedding(7);
    const rows = db
      .prepare(
        `SELECT rowid, vec_distance_cosine(catalog_vec.embedding, ?) AS d
         FROM catalog_vec
         ORDER BY d ASC`,
      )
      .all(queryVec);

    assert.equal(rows.length, 2);
    for (const r of rows) {
      assert.ok(
        Number.isFinite(/** @type {number} */ (r.d)),
        `vec_distance_cosine must return finite; got ${r.d}`,
      );
    }
  } finally {
    db.close();
  }
});
