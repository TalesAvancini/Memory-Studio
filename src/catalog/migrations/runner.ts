/**
 * Versioned SQLite migration runner.
 *
 * Phase 1.2 deliverable. Applies pending SQL files from this directory in
 * lexical order, tracking each applied migration in the `schema_migrations`
 * table. Idempotent: re-running on a DB whose `schema_migrations` already
 * records a given migration name is a no-op for that migration.
 *
 * Migration file convention:
 *   - File name: `<version>_<name>.sql` (e.g. `001_init.sql`).
 *   - Version is the integer parsed from the leading digits.
 *   - Applied atomically inside a transaction; on failure the migration is
 *     NOT recorded, the transaction rolls back, and a MigrationError is
 *     thrown carrying the underlying SQLite message.
 *
 * The runner discovers migrations by scanning its own directory at runtime
 * (`import.meta.url` → `<runner-dir>/../migrations/` is NOT used; the runner
 * reads from the same directory it lives in: `<this-file-dir>/`). Tests
 * resolve the same path through `import.meta.url`, so the contract is stable.
 */

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from 'better-sqlite3';
import { MigrationError } from '../errors.ts';

export interface MigrationResult {
  /** Names of migrations applied in THIS run (lexical order). */
  applied: string[];
  /** Highest version row present in `schema_migrations` after the run. */
  currentVersion: number;
}

const MIGRATIONS_DIR_NAME = '.';
const MIGRATION_FILE_RE = /^(\d{3,})_(.+)\.sql$/;

/** Resolve the migrations directory relative to this module's URL. */
function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, MIGRATIONS_DIR_NAME);
}

export interface ApplyMigrationsOptions {
  /** Override the migrations directory (test seam). */
  dir?: string;
}

/** Parse a migration file name into `{ version, name }`. */
function parseMigrationFileName(fileName: string): { version: number; name: string } | null {
  const match = MIGRATION_FILE_RE.exec(fileName);
  if (!match) return null;
  const version = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(version) || version <= 0) return null;
  return { version, name: fileName.replace(/\.sql$/, '') };
}

/** Ensure the `schema_migrations` table exists. Idempotent. */
function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
}

/** Read the set of migration names already applied. */
function appliedMigrationNames(db: Database): Set<string> {
  const rows = db
    .prepare('SELECT name FROM schema_migrations')
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

/** Highest version recorded; 0 if no migrations applied yet. */
function highestAppliedVersion(db: Database): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS max_version FROM schema_migrations')
    .get() as { max_version: number } | undefined;
  return row?.max_version ?? 0;
}

/**
 * Apply all pending migrations in lexical order.
 *
 * Idempotent: a re-run on a DB whose `schema_migrations` already records the
 * file's name returns `{applied: [], currentVersion}` with no DDL executed.
 * Migration files are read from the directory containing this module.
 */
export async function applyMigrations(
  db: Database,
  options: ApplyMigrationsOptions = {},
): Promise<MigrationResult> {
  ensureMigrationsTable(db);
  const alreadyApplied = appliedMigrationNames(db);

  const dir = options.dir ?? defaultMigrationsDir();
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new MigrationError(`cannot read migrations directory: ${reason}`);
  }

  const candidates = entries
    .map(parseMigrationFileName)
    .filter((entry): entry is { version: number; name: string } => entry !== null)
    .sort((a, b) => a.version - b.version);

  const appliedThisRun: string[] = [];

  for (const migration of candidates) {
    if (alreadyApplied.has(migration.name)) continue;

    const filePath = join(dir, `${migration.name}.sql`);
    let sql: string;
    try {
      sql = await readFile(filePath, 'utf8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new MigrationError(`cannot read ${migration.name}.sql: ${reason}`);
    }

    const insertRecord = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    const tx = db.transaction(() => {
      db.exec(sql);
      insertRecord.run(migration.version, migration.name, Date.now());
    });

    try {
      tx();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new MigrationError(
        `migration ${migration.name} failed: ${reason}`,
        { cause: err },
      );
    }
    appliedThisRun.push(migration.name);
  }

  return {
    applied: appliedThisRun,
    currentVersion: highestAppliedVersion(db),
  };
}

/** Synchronous variant for tests / scripts that already have the SQL in memory. */
export function applyMigrationsSync(
  db: Database,
  migrations: ReadonlyArray<{ name: string; version: number; sql: string }>,
): MigrationResult {
  ensureMigrationsTable(db);
  const alreadyApplied = appliedMigrationNames(db);

  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const appliedThisRun: string[] = [];

  for (const migration of sorted) {
    if (alreadyApplied.has(migration.name)) continue;
    const insertRecord = db.prepare(
      'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
    );
    const tx = db.transaction(() => {
      db.exec(migration.sql);
      insertRecord.run(migration.version, migration.name, Date.now());
    });
    try {
      tx();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new MigrationError(
        `migration ${migration.name} failed: ${reason}`,
        { cause: err },
      );
    }
    appliedThisRun.push(migration.name);
  }

  return {
    applied: appliedThisRun,
    currentVersion: highestAppliedVersion(db),
  };
}
