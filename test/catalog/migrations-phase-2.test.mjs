/**
 * Migration `002_audit_events_tenant_id_rename` tests (T-05).
 *
 * Derived from spec acceptance criteria:
 *   - AC-9: DDL file exists with the exact `ALTER TABLE ... RENAME COLUMN`
 *     statement.
 *   - AC-10: After applying 001 + 002, `schema_migrations` has version 2
 *     and `audit_events` has all 10 columns (5 calibration + 5 PRD §10.3),
 *     including `"tenantId_hashed"` (NOT `tenant_hash`).
 *   - AC-11: The `tenant_hash` column does not exist after migration 002.
 *   - AC-6 (R-06): Migration runner is idempotent — re-running on a DB
 *     that has version 2 applied is a no-op.
 *   - Edge case: data preservation — values written under the old
 *     column name are still readable after the rename.
 *
 * The tests use `openCatalogDb(':memory:')` (loads the sqlite-vec
 * extension, sets pragmas) before `applyMigrations` so the `vec0` virtual
 * table in `001_init.sql` resolves at migration time. Without the
 * extension load, `applyMigrations` would fail with "no such module: vec0"
 * on the CREATE VIRTUAL TABLE catalog_vec statement in 001_init.sql.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { openCatalogDb } from '../../src/catalog/db/open.ts';
import { applyMigrations } from '../../src/catalog/migrations/runner.ts';

/**
 * Resolve the on-disk path to `src/catalog/migrations/` so the test
 * reads the same SQL the runner applies.
 */
function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'src', 'catalog', 'migrations');
}

/**
 * Open an in-memory DB with sqlite-vec loaded + pragmas set. Mirrors
 * `openAndMigrate` minus the `applyMigrations` call so tests can drive
 * the migration sequence themselves.
 */
async function freshDbWithVec() {
  return openCatalogDb(':memory:');
}

/**
 * Read the on-disk content of the 002 migration file to verify AC-9
 * (the file's DDL matches the spec).
 */
async function readMigration002() {
  return readFile(join(migrationsDir(), '002_audit_events_tenant_id_rename.sql'), 'utf8');
}

// ---------------------------------------------------------------------------
// AC-9: migration file exists with the expected DDL
// ---------------------------------------------------------------------------

test('AC-9: 002_audit_events_tenant_id_rename.sql contains the ALTER TABLE statement', async () => {
  const sql = await readMigration002();
  assert.match(
    sql,
    /ALTER\s+TABLE\s+audit_events\s+RENAME\s+COLUMN\s+tenant_hash\s+TO\s+"tenantId_hashed"\s*;/iu,
    '002 must contain the verbatim ALTER TABLE ... RENAME COLUMN statement',
  );
});

// ---------------------------------------------------------------------------
// AC-10: schema_migrations version 2 + audit_events has all 10 columns
// ---------------------------------------------------------------------------

test('AC-10: 001 + 002 apply cleanly; audit_events has 10 columns including "tenantId_hashed"', async () => {
  const db = await freshDbWithVec();
  try {
    const result = await applyMigrations(db);
    // Phase 5b added migration 003 (perf index) — currentVersion is now 3.
    assert.ok(
      result.currentVersion >= 2,
      `currentVersion must be >= 2 after applying 001 + 002, got ${result.currentVersion}`,
    );
    assert.ok(
      result.applied.includes('001_init') &&
        result.applied.includes('002_audit_events_tenant_id_rename'),
      'both 001 and 002 must be applied',
    );

    // schema_migrations has both (and possibly 003 from Phase 5b).
    const versions = db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all();
    assert.ok(versions.length >= 2, `schema_migrations must have >= 2 rows, got ${versions.length}`);
    assert.equal(versions[0].version, 1);
    assert.equal(versions[0].name, '001_init');
    assert.ok(versions.some((v) => v.name === '002_audit_events_tenant_id_rename'));

    // audit_events has 10 columns with the expected names.
    const cols = db.prepare('PRAGMA table_info(audit_events)').all();
    assert.equal(cols.length, 10, `audit_events must have 10 columns, got ${cols.length}`);

    const names = cols.map((c) => c.name);
    // PRAGMA table_info returns identifiers WITHOUT surrounding quotes
    // even when the column was created as `"tenantId_hashed"` — SQLite
    // strips the quotes at the storage layer.
    assert.ok(names.includes('tenantId_hashed'), 'tenantId_hashed must be present (unquoted identifier in PRAGMA table_info)');
    assert.ok(names.includes('id'));
    assert.ok(names.includes('ts'));
    assert.ok(names.includes('fingerprint'));
    assert.ok(names.includes('matched_ids'));
    assert.ok(names.includes('pruning_reasons'));
    assert.ok(names.includes('latency_ms'));
    assert.ok(names.includes('redacted_prompt_hash'));

    // The tenantId_hashed column is NOT NULL.
    const tenantCol = cols.find((c) => c.name === 'tenantId_hashed');
    assert.ok(tenantCol, 'tenantId_hashed column must exist');
    assert.equal(tenantCol.notnull, 1, 'tenantId_hashed must be NOT NULL');
    assert.equal(tenantCol.type, 'TEXT');
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// AC-11: tenant_hash column does not exist after migration 002
// ---------------------------------------------------------------------------

test('AC-11: tenant_hash column does NOT exist after migration 002', async () => {
  const db = await freshDbWithVec();
  try {
    await applyMigrations(db);
    const cols = db.prepare('PRAGMA table_info(audit_events)').all();
    const hasOldName = cols.some((c) => c.name === 'tenant_hash');
    assert.equal(
      hasOldName,
      false,
      'tenant_hash column must be renamed away (not present in PRAGMA table_info)',
    );
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// AC-6 / R-06: idempotency — re-running applyMigrations is a no-op
// ---------------------------------------------------------------------------

test('AC-6 / R-06: re-running applyMigrations on a DB with version 2 is a no-op', async () => {
  const db = await freshDbWithVec();
  try {
    const first = await applyMigrations(db);
    // Phase 5b adds migration 003 (perf index) — currentVersion can be 3.
    assert.ok(first.currentVersion >= 2, `expected currentVersion >= 2, got ${first.currentVersion}`);
    assert.ok(first.applied.length >= 2, 'at least 2 migrations should be applied');

    const second = await applyMigrations(db);
    assert.deepEqual(second.applied, [], 'no migrations should be re-applied');
    assert.equal(second.currentVersion, first.currentVersion, 'currentVersion must be unchanged on re-run');

    const count = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    assert.ok(count.n >= 2, `schema_migrations must have >= 2 rows, got ${count.n}`);
  } finally {
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Edge case: data preservation — ALTER TABLE RENAME COLUMN keeps values
// ---------------------------------------------------------------------------

test('Edge case: values written under tenant_hash are preserved as tenantId_hashed after rename', async () => {
  // Stage a temp migrations directory containing 001_init.sql ONLY, so
  // the test can apply 001, insert a row referencing the old column
  // name, then apply 002 (from a temp dir that has both 001 + 002 — the
  // runner is idempotent and skips 001 the second time) and verify the
  // row's value survives the rename.
  const initSql = await readFile(join(migrationsDir(), '001_init.sql'), 'utf8');
  const migration002Sql = await readMigration002();

  const tmpDir = await mkdtemp(join(tmpdir(), 'ms-mig-phase2-'));
  try {
    await writeFile(join(tmpDir, '001_init.sql'), initSql, 'utf8');
    const db = await freshDbWithVec();
    try {
      const first = await applyMigrations(db, { dir: tmpDir });
      assert.equal(first.currentVersion, 1, 'only 001 should apply in the first run');

      // Insert a row referencing the OLD column name (tenant_hash).
      const insert = db.prepare(
        `INSERT INTO audit_events (ts, tenant_hash, event_type, payload)
         VALUES (?, ?, ?, ?)`,
      );
      const testHash = 'phase2-preservation-marker';
      insert.run(1234567890, testHash, 'test_event', JSON.stringify({ fixture: true }));

      // Now write 002 into the temp dir and re-apply — 001 is idempotent
      // (already in schema_migrations); 002 runs.
      await writeFile(join(tmpDir, '002_audit_events_tenant_id_rename.sql'), migration002Sql, 'utf8');
      const second = await applyMigrations(db, { dir: tmpDir });
      assert.equal(second.currentVersion, 2);
      assert.deepEqual(second.applied, ['002_audit_events_tenant_id_rename']);

      // The row must be readable under the NEW column name with the
      // original value intact.
      const row = db
        .prepare('SELECT "tenantId_hashed" AS value FROM audit_events WHERE event_type = ?')
        .get('test_event');
      assert.ok(row, 'row must exist after rename');
      assert.equal(
        row.value,
        testHash,
        'value written under tenant_hash must be readable as "tenantId_hashed" after ALTER TABLE RENAME COLUMN',
      );
    } finally {
      db.close();
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
