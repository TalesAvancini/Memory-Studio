/**
 * FTS5 trigger integration tests (T-08).
 *
 * Derived from spec acceptance criteria:
 *   - AC-11: catalog_fts SELECT on a known token from a Skill's `text`
 *     returns ≥ 1 row with matching rowid.
 *   - AC-3 / R-06: FTS5 virtual table catalog_fts mirrors catalog.text
 *     with INSERT/UPDATE/DELETE triggers keeping it in sync.
 *
 * Each test opens a fresh :memory: DB via `openAndMigrate`, inserts a
 * catalog row, mutates it, and probes catalog_fts with a MATCH query.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openAndMigrate } from '../../src/catalog/db/open.ts';

/** Insert a catalog row with the given id + text. */
function insertCatalogRow(db, { id, text, type = 'skill', title = null }) {
  db.prepare(
    `INSERT INTO catalog (id, type, title, text, category, critical, is_default, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
  ).run(id, type, title, text, `hash-${id}`, Date.now(), Date.now());
}

test('catalog_fts is a contentless FTS5 virtual table (AC-3, AC-11)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    const row = db
      .prepare("SELECT type, sql FROM sqlite_master WHERE name = 'catalog_fts'")
      .get();
    assert.ok(row, 'catalog_fts must exist');
    assert.equal(row.type, 'table');
    assert.match(row.sql, /USING fts5/i);
    assert.match(row.sql, /content='catalog'/i);
  } finally {
    db.close();
  }
});

test('catalog_ai trigger inserts a matching FTS row on catalog INSERT (AC-11)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertCatalogRow(db, { id: 'skill-1', text: 'validate JWT tokens safely' });

    const hits = db
      .prepare(
        "SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH ?",
      )
      .all('tokens');
    assert.deepEqual(hits.map((r) => r.rowid), [1]);

    // The catalog rowid is the FTS5 rowid (bound by the trigger).
    const joinHits = db
      .prepare(
        `SELECT c.id
         FROM catalog_fts f
         JOIN catalog c ON c.rowid = f.rowid
         WHERE catalog_fts MATCH ?`,
      )
      .all('validate');
    assert.deepEqual(
      joinHits.map((r) => r.id),
      ['skill-1'],
      'FTS rowid must equal the parent catalog.rowid',
    );
  } finally {
    db.close();
  }
});

test('catalog_au trigger updates catalog_fts on text change (AC-6, R-06)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertCatalogRow(db, { id: 'skill-1', text: 'original phrase alpha' });
    db.prepare('UPDATE catalog SET text = ? WHERE id = ?').run(
      'completely rewritten phrase beta',
      'skill-1',
    );

    // Old token must be gone.
    const oldHits = db
      .prepare("SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH ?")
      .all('original');
    assert.deepEqual(oldHits, [], 'old token must be removed from FTS index');

    // New tokens must be present and tied to the same rowid.
    const newHits = db
      .prepare("SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH ?")
      .all('rewritten');
    assert.deepEqual(newHits.map((r) => r.rowid), [1]);
  } finally {
    db.close();
  }
});

test('catalog_ad trigger removes catalog_fts row on DELETE (AC-7, R-06)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertCatalogRow(db, { id: 'skill-1', text: 'transient content here' });
    const before = db
      .prepare("SELECT COUNT(*) AS n FROM catalog_fts")
      .get();
    assert.equal(before.n, 1);

    db.prepare('DELETE FROM catalog WHERE id = ?').run('skill-1');

    const after = db.prepare("SELECT COUNT(*) AS n FROM catalog_fts").get();
    assert.equal(after.n, 0, 'catalog_fts row must be deleted with the parent');

    const hits = db
      .prepare("SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH ?")
      .all('transient');
    assert.deepEqual(hits, []);
  } finally {
    db.close();
  }
});

test('unicode61 tokenizer + diacritics removal indexes accented characters (R-06)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    insertCatalogRow(db, { id: 'skill-1', text: 'café com leite amanhã' });
    // 'cafe' (no accent) should match 'café' because diacritics are stripped.
    const hits = db
      .prepare("SELECT rowid FROM catalog_fts WHERE catalog_fts MATCH ?")
      .all('cafe');
    assert.deepEqual(hits.map((r) => r.rowid), [1]);
  } finally {
    db.close();
  }
});
