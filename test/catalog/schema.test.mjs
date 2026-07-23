/**
 * Schema tests — cover ACs crud-01, crud-02, crud-03.
 *
 * Strategy: open a fresh `:memory:` SQLite db, run createSchema, then assert
 * via `PRAGMA table_info(name)` that every required column exists with the
 * expected name / type / constraints. Idempotency is checked by calling
 * createSchema twice in a row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createSchema } from '../../src/catalog/schema.ts';

function openMemoryDb() {
  return new Database(':memory:');
}

function getColumns(db, tableName) {
  // PRAGMA cannot be parameterized; the tableName is a constant literal in
  // each call site, so safe to interpolate.
  return /** @type {Array<{name: string, type: string, notnull: 0 | 1, pk: 0 | 1, dflt_value: unknown}>} */ (
    db.prepare(`PRAGMA table_info(${tableName})`).all()
  );
}

test('T-SCHEMA-01: createSchema creates `skills` table with the expected columns (crud-01)', () => {
  const db = openMemoryDb();
  try {
    createSchema(db);
    const cols = getColumns(db, 'skills');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    // Required columns per spec.md crud-01
    const required = [
      { name: 'id', type: 'INTEGER' },
      { name: 'slug', type: 'TEXT' },
      { name: 'kind', type: 'TEXT' },
      { name: 'content_yaml', type: 'TEXT' },
      { name: 'embedding', type: 'BLOB' },
      { name: 'hash', type: 'TEXT' },
      { name: 'created_at', type: 'INTEGER' },
      { name: 'updated_at', type: 'INTEGER' },
    ];
    for (const { name, type } of required) {
      assert.ok(byName[name], `column ${name} should exist in skills`);
      assert.equal(
        byName[name].type,
        type,
        `column ${name} should be ${type}, got ${byName[name].type}`,
      );
    }

    // id is PRIMARY KEY AUTOINCREMENT
    assert.equal(byName.id.pk, 1, 'id should be PRIMARY KEY');

    // slug and hash are UNIQUE (notnull enforced by SQLite UNIQUE)
    assert.equal(byName.slug.notnull, 1, 'slug NOT NULL');
    assert.equal(byName.hash.notnull, 1, 'hash NOT NULL');

    // Timestamp columns not nullable
    assert.equal(byName.created_at.notnull, 1);
    assert.equal(byName.updated_at.notnull, 1);

    // The CHECK on kind is expressed via DDL; verify it triggers below.
  } finally {
    db.close();
  }
});

test('T-SCHEMA-01b: skills table rejects invalid `kind` via CHECK constraint', () => {
  const db = openMemoryDb();
  try {
    createSchema(db);
    const stmt = db.prepare(
      `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    assert.throws(
      () =>
        stmt.run(
          'demo-skill',
          'bogus-kind',
          'content',
          Buffer.alloc(1536),
          'h1',
          Date.now(),
          Date.now(),
        ),
      /CHECK constraint failed/i,
      'invalid kind must violate CHECK',
    );
  } finally {
    db.close();
  }
});

test('T-SCHEMA-02: createSchema creates `audit_events` table with expected columns (crud-02)', () => {
  const db = openMemoryDb();
  try {
    createSchema(db);
    const cols = getColumns(db, 'audit_events');
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    const required = [
      { name: 'id', type: 'INTEGER' },
      { name: 'ts', type: 'INTEGER' },
      { name: 'tenant_hash', type: 'TEXT' },
      { name: 'event_type', type: 'TEXT' },
      { name: 'payload', type: 'TEXT' },
    ];
    for (const { name, type } of required) {
      assert.ok(byName[name], `column ${name} should exist in audit_events`);
      assert.equal(
        byName[name].type,
        type,
        `column ${name} should be ${type}, got ${byName[name].type}`,
      );
    }

    assert.equal(byName.id.pk, 1, 'id PRIMARY KEY');
    assert.equal(byName.ts.notnull, 1);
    assert.equal(byName.tenant_hash.notnull, 1);
    assert.equal(byName.event_type.notnull, 1);
    assert.equal(byName.payload.notnull, 1);
  } finally {
    db.close();
  }
});

test('T-SCHEMA-03: createSchema called twice is idempotent (crud-03)', () => {
  const db = openMemoryDb();
  try {
    createSchema(db);
    // Second call must not throw.
    createSchema(db);

    // Data inserted before the second call must still be there.
    db.prepare(
      `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'survives',
      'skill',
      'c',
      Buffer.alloc(1536),
      'hh',
      Date.now(),
      Date.now(),
    );

    createSchema(db); // third call still fine
    const row = db
      .prepare('SELECT slug FROM skills WHERE slug = ?')
      .get('survives');
    assert.equal(row?.slug, 'survives');
  } finally {
    db.close();
  }
});