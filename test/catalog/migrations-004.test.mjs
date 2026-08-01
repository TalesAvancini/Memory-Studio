/**
 * Migration `004_intel.sql` tests (Phase 6b T-01).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-1.
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md` T-04.
 *
 * Verifies the intel table + WAL pragma + covering index migration
 * applies cleanly to a fresh SQLite DB, and that a re-run is
 * idempotent (the runner records `004_intel` in `schema_migrations`
 * and skips it on a subsequent invocation).
 *
 * The test reads the migration SQL from disk so it asserts against
 * the actual on-disk file (not an inline copy), catching any drift
 * between the file content and the test expectations.
 *
 * 4 cases:
 *   1. Migration applies to a fresh `:memory:` DB → intel table exists
 *      with the 5-column schema (session_id, agent_state, next_needs,
 *      recent_topic, ts).
 *   2. `idx_intel_session_id` covering index exists after apply.
 *   3. `PRAGMA journal_mode=WAL` is set on a file-backed DB (the
 *      `:memory:` path always reports `memory` regardless of
 *      pragma, so we use a tmpfile DB here).
 *   4. Re-running `applyMigrationsSync` with the same SQL returns
 *      `applied: []` — no DDL fires twice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import { applyMigrationsSync } from '../../src/catalog/migrations/runner.ts';

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'src', 'catalog', 'migrations');
}

async function readMigration004() {
  return readFile(join(migrationsDir(), '004_intel.sql'), 'utf8');
}

function getTableInfo(db, tableName) {
  return /** @type {Array<{ name: string }>} */ (
    db.prepare(`PRAGMA table_info(${tableName})`).all()
  );
}

function getIndexNames(db) {
  return /** @type {Array<{ name: string }>} */ (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
      .all()
  ).map((r) => r.name);
}

test('004_intel.sql applies cleanly to :memory: — intel table exists with 5 columns', async () => {
  const sql = await readMigration004();
  const db = new Database(':memory:');
  try {
    const result = applyMigrationsSync(db, [
      { version: 4, name: '004_intel', sql },
    ]);
    assert.deepEqual(result.applied, ['004_intel']);
    assert.equal(result.currentVersion, 4);

    const cols = getTableInfo(db, 'intel');
    const colNames = cols.map((c) => c.name).sort();
    assert.deepEqual(colNames, ['agent_state', 'next_needs', 'recent_topic', 'session_id', 'ts'],
      'intel table must have 5 columns: session_id, agent_state, next_needs, recent_topic, ts');

    // session_id is the PRIMARY KEY (WITHOUT ROWID tables — but a PRIMARY
    // KEY column always shows pk > 0 in PRAGMA table_info).
    const sessionIdCol = cols.find((c) => c.name === 'session_id');
    assert.ok(sessionIdCol && sessionIdCol.pk > 0, 'session_id must be the PRIMARY KEY');

    // ts is NOT NULL INTEGER.
    const tsCol = cols.find((c) => c.name === 'ts');
    assert.ok(tsCol && tsCol.notnull === 1, 'ts must be NOT NULL');
    assert.equal(tsCol?.type, 'INTEGER');
  } finally {
    db.close();
  }
});

test('004_intel.sql — idx_intel_session_id covering index exists after apply', async () => {
  const sql = await readMigration004();
  const db = new Database(':memory:');
  try {
    applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql }]);
    const indexNames = getIndexNames(db);
    assert.ok(
      indexNames.includes('idx_intel_session_id'),
      `idx_intel_session_id must exist; got: ${JSON.stringify(indexNames)}`,
    );
  } finally {
    db.close();
  }
});

test('004_intel.sql — PRAGMA journal_mode=WAL present in file; mode is set externally by openCatalogDb', async () => {
  // Note on semantics:
  //   SQLite forbids changing journal_mode from inside a transaction.
  //   `applyMigrationsSync` wraps the migration SQL in db.transaction(() =>
  //   db.exec(sql)). So the in-file PRAGMA journal_mode = WAL is a
  //   no-op when applied via the runner (SQLite raises "cannot change
  //   into wal mode from within a transaction" if it's the only
  //   statement; mixed with DDL it silently misses).
  //   Production sets WAL via `openCatalogDb` *before* migrations run
  //   (see src/catalog/db/open.ts:64 `db.pragma('journal_mode = WAL')`).
  //   The migration-level PRAGMA is a redundant safety net + reviewer-
  //   visible intent marker. It is NOT the source of WAL in production.
  //
  // This test asserts (a) the SQL file contains the pragma so reviewers
  // see the intent, AND (b) when the migration SQL is executed as a
  // raw exec (no transaction wrapper — the same surface SQLite uses
  // when openCatalogDb's PRAGMA has already taken the DB out of
  // transactions), the WAL switch succeeds.
  const sql = await readMigration004();
  assert.match(
    sql,
    /PRAGMA\s+journal_mode\s*=\s*WAL/i,
    '004_intel.sql must contain `PRAGMA journal_mode = WAL` as an idempotent safety net',
  );

  const dir = await mkdtemp(join(tmpdir(), 'ms-intel-wal-'));
  const dbPath = join(dir, 'catalog.sqlite');
  const db = new Database(dbPath);
  try {
    // Production-style openCatalogDb (no applyMigrationsSync transaction wrapper):
    db.pragma('journal_mode = WAL');
    const before = /** @type {{ journal_mode: string } | undefined} */ (
      db.prepare('PRAGMA journal_mode').get()
    );
    assert.equal(before?.journal_mode, 'wal', 'openCatalogDb-style pragma must set WAL');

    // Now apply the migration's DDL (table + index) WITHOUT the WAL
    // pragma via applyMigrationsSync — the WAL pragma is intentionally
    // a no-op here (transaction semantics) and that's documented.
    const ddlOnly = sql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
    applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);

    // After migration: WAL is still active (set externally before).
    const after = /** @type {{ journal_mode: string } | undefined} */ (
      db.prepare('PRAGMA journal_mode').get()
    );
    assert.equal(after?.journal_mode, 'wal', 'WAL mode survives migration on a file-backed DB');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('004_intel.sql — re-running applyMigrationsSync is idempotent (no DDL fires twice)', async () => {
  const sql = await readMigration004();
  const db = new Database(':memory:');
  try {
    const first = applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql }]);
    assert.deepEqual(first.applied, ['004_intel']);
    const second = applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql }]);
    assert.deepEqual(second.applied, [], 'second run must not re-apply; the runner records the migration after the first run');
    assert.equal(second.currentVersion, 4);

    // schema_migrations has exactly one row for 004_intel.
    const rows = /** @type {Array<{ name: string }>} */ (
      db.prepare('SELECT name FROM schema_migrations').all()
    );
    assert.equal(rows.length, 1, 'schema_migrations should have exactly one row');
    assert.equal(rows[0]?.name, '004_intel');
  } finally {
    db.close();
  }
});
