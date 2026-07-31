/**
 * Migration runner tests (T-05).
 *
 * Derived from spec acceptance criteria:
 *   - AC-4 / R-04: `applyMigrations` on empty DB creates `schema_migrations`,
 *     applies pending migrations, records each with `version` + `applied_at`,
 *     returns `{ applied, currentVersion }`.
 *   - Idempotency (R-04): re-running on the same DB is a no-op.
 *   - DDL failure path: bad SQL throws `MigrationError` (code: 'MIGRATION_FAILED')
 *     carrying the underlying SQLite message; the migration is NOT recorded.
 *
 * Tests use both the async `applyMigrations(db, { dir })` and the synchronous
 * `applyMigrationsSync(db, [...])` helper to cover the two execution surfaces
 * without requiring 001_init.sql to be present in the runner's own directory
 * (T-06 owns that file). After T-06 lands, an additional test reads from the
 * real migrations directory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import {
  applyMigrations,
  applyMigrationsSync,
} from '../../src/catalog/migrations/runner.ts';
import { MigrationError } from '../../src/catalog/errors.ts';

/**
 * Open an in-memory better-sqlite3 db. Each call returns a fresh DB so
 * migrations from one test never leak into another.
 */
function freshDb() {
  return new Database(':memory:');
}

/**
 * Create a temp directory containing the SQL files passed in. Returns the
 * directory path; caller must `rm(dir, { recursive: true })` on cleanup.
 */
async function tempMigrationsDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ms-migrations-'));
  for (const [name, sql] of files) {
    await writeFile(join(dir, `${name}.sql`), sql, 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Async surface: applyMigrations(db, { dir })
// ---------------------------------------------------------------------------

test('applyMigrations on empty DB applies pending migrations and records version (AC-4)', async () => {
  const db = freshDb();
  const dir = await tempMigrationsDir([
    ['001_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);'],
  ]);
  try {
    const result = await applyMigrations(db, { dir });
    assert.deepEqual(result.applied, ['001_init']);
    assert.equal(result.currentVersion, 1);

    // schema_migrations table exists with exactly the one recorded row.
    const rows = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations')
      .all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, 1);
    assert.equal(rows[0].name, '001_init');
    assert.ok(typeof rows[0].applied_at === 'number' && rows[0].applied_at > 0);

    // The migration's DDL actually executed (table exists).
    const fooExists = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='foo'",
      )
      .get();
    assert.ok(fooExists, 'foo table must exist after migration applied');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyMigrations re-run is a no-op (R-04 idempotency)', async () => {
  const db = freshDb();
  const dir = await tempMigrationsDir([
    ['001_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);'],
    ['002_add_bar', 'ALTER TABLE foo ADD COLUMN bar TEXT;'],
  ]);
  try {
    const first = await applyMigrations(db, { dir });
    assert.deepEqual(first.applied, ['001_init', '002_add_bar']);
    assert.equal(first.currentVersion, 2);

    const second = await applyMigrations(db, { dir });
    assert.deepEqual(second.applied, [], 'no migrations should be re-applied');
    assert.equal(second.currentVersion, 2);

    // schema_migrations still has exactly the two recorded rows.
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get();
    assert.equal(count.n, 2);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyMigrations throws MigrationError on bad DDL and does NOT record the failed migration', async () => {
  const db = freshDb();
  const dir = await tempMigrationsDir([
    ['001_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);'],
    ['002_broken', 'THIS IS NOT VALID SQL;'],
  ]);
  try {
    await assert.rejects(
      applyMigrations(db, { dir }),
      (err) => {
        assert.ok(err instanceof MigrationError);
        assert.equal(/** @type {MigrationError} */ (err).code, 'MIGRATION_FAILED');
        assert.match(
          /** @type {MigrationError} */ (err).message,
          /002_broken failed/,
          'error message must name the failing migration',
        );
        return true;
      },
    );

    // 001_init was committed; 002_broken was rolled back (not recorded).
    const recorded = db
      .prepare('SELECT name FROM schema_migrations ORDER BY name')
      .all();
    assert.deepEqual(
      recorded.map((/** @type {{ name: string }} */ r) => r.name),
      ['001_init'],
      'failed migration must not appear in schema_migrations',
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Sync surface: applyMigrationsSync (no filesystem dependency)
// ---------------------------------------------------------------------------

test('applyMigrationsSync records the migration row with applied_at timestamp', () => {
  const db = freshDb();
  try {
    const result = applyMigrationsSync(db, [
      {
        version: 1,
        name: '001_init',
        sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
      },
    ]);
    assert.deepEqual(result.applied, ['001_init']);
    assert.equal(result.currentVersion, 1);

    const row = db
      .prepare('SELECT version, name, applied_at FROM schema_migrations')
      .get();
    assert.ok(row, 'schema_migrations row must exist');
    assert.equal(row.version, 1);
    assert.equal(row.name, '001_init');
    assert.ok(
      typeof row.applied_at === 'number' && row.applied_at > 0,
      'applied_at must be a positive epoch-ms integer',
    );
  } finally {
    db.close();
  }
});

test('applyMigrationsSync is idempotent on a re-run', () => {
  const db = freshDb();
  try {
    const migration = {
      version: 1,
      name: '001_init',
      sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY);',
    };
    const first = applyMigrationsSync(db, [migration]);
    assert.deepEqual(first.applied, ['001_init']);

    const second = applyMigrationsSync(db, [migration]);
    assert.deepEqual(second.applied, []);
    assert.equal(second.currentVersion, 1);

    const count = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get();
    assert.equal(count.n, 1);
  } finally {
    db.close();
  }
});

test('applyMigrationsSync throws MigrationError when SQL references a missing table', () => {
  const db = freshDb();
  try {
    assert.throws(
      () =>
        applyMigrationsSync(db, [
          {
            version: 1,
            name: '001_broken',
            sql: 'ALTER TABLE nonexistent_table ADD COLUMN bar TEXT;',
          },
        ]),
      (err) => {
        assert.ok(err instanceof MigrationError);
        assert.equal(/** @type {MigrationError} */ (err).code, 'MIGRATION_FAILED');
        // The underlying SQLite message is carried in the wrapped message.
        assert.match(
          /** @type {MigrationError} */ (err).message,
          /001_broken failed/,
        );
        return true;
      },
    );
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM schema_migrations')
      .get();
    assert.equal(count.n, 0, 'failed migration must not be recorded');
  } finally {
    db.close();
  }
});
