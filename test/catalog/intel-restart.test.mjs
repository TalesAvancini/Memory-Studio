/**
 * Intel restart-preservation tests (Phase 6b T-04 / AC-14, R-21).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-14,
 *   R-21 ("Determinism preserved across server restart").
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md` T-04.
 *
 * Verifies that the `intel` SQLite table persists Intel literals
 * across a server restart. A restart in this test is simulated by
 * closing the better-sqlite3 handle and reopening it against the
 * SAME on-disk file (mirroring the Phase 5b.1 WAL-survives-restart
 * convention documented in `src/server/audit/lifecycle.ts`).
 *
 * The migration is applied first to a tmpfile-backed DB so the
 * table + covering index exist before the write. The WAL pragma in
 * the SQL is stripped (it is a no-op inside the runner's transaction
 * wrapper — see migrations-004.test.mjs); we set WAL externally via
 * `db.pragma('journal_mode = WAL')` to match `openCatalogDb`'s
 * production behavior. This combination is what production uses.
 *
 * 3 cases — matches the spec (R-21 + UTF-8 NFC preservation).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { getIntel, writeIntelRow } from '../../src/catalog/index.ts';
import { applyMigrationsSync } from '../../src/catalog/migrations/runner.ts';

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'src', 'catalog', 'migrations');
}

/**
 * Apply the 004_intel migration to a tmpfile-backed DB (Production-
 * style: WAL set externally BEFORE the migration runs, mirroring
 * openCatalogDb). Returns `{ dbPath, cleanup }` so the caller can
 * close + reopen + clean up.
 */
async function openMigratedFileDb() {
  const dir = await mkdtemp(join(tmpdir(), 'ms-intel-restart-'));
  const dbPath = join(dir, 'catalog.sqlite');

  const db = new Database(dbPath);
  try {
    // Production-style: set WAL before any user DDL.
    db.pragma('journal_mode = WAL');

    // Migration (the in-txn PRAGMA is a no-op so we strip it; the
    // CREATE TABLE + CREATE INDEX fire correctly inside the txn).
    const fullSql = readFileSync(
      join(migrationsDir(), '004_intel.sql'),
      'utf8',
    );
    const ddlOnly = fullSql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
    applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);

    const journalModeRow = /** @type {{ journal_mode: string } | undefined} */ (
      db.prepare('PRAGMA journal_mode').get()
    );
    assert.equal(journalModeRow?.journal_mode, 'wal', 'tmpfile DB must be in WAL after open');

    db.close();
  } catch (err) {
    db.close();
    await rm(dir, { recursive: true, force: true });
    throw err;
  }

  return {
    dbPath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

// --- Tests -----------------------------------------------------------------

test('intel-restart: written Intel is preserved across DB close + reopen', async () => {
  const ctx = await openMigratedFileDb();
  try {
    const sessionId = 'session-restart-preserved';
    const intel = {
      agentState: 'implementing fastify augment server',
      nextNeeds: ['catalog-migration', 'wal-mode'],
      recentTopic: 'phase 6b 6b.1 intel store',
    };

    // First connection: write.
    const db1 = new Database(ctx.dbPath);
    try {
      writeIntelRow(db1, sessionId, intel, 1_700_000_010);
    } finally {
      db1.close();
    }

    // Second connection: reopen + read (mirrors server restart).
    const db2 = new Database(ctx.dbPath);
    try {
      const read = getIntel(db2, sessionId);
      assert.ok(read, 'intel must survive close + reopen');
      assert.equal(read.agentState, intel.agentState);
      assert.deepEqual([...read.nextNeeds], intel.nextNeeds);
      assert.equal(read.recentTopic, intel.recentTopic);
    } finally {
      db2.close();
    }
  } finally {
    await ctx.cleanup();
  }
});

test('intel-restart: empty Intel (D-005) is preserved across DB close + reopen', async () => {
  const ctx = await openMigratedFileDb();
  try {
    const sessionId = 'session-restart-empty';
    const empty = { agentState: '', nextNeeds: [], recentTopic: '' };

    const db1 = new Database(ctx.dbPath);
    try {
      writeIntelRow(db1, sessionId, empty, 1_700_000_011);
    } finally {
      db1.close();
    }

    const db2 = new Database(ctx.dbPath);
    try {
      const read = getIntel(db2, sessionId);
      assert.ok(read, 'empty intel must survive close + reopen');
      assert.equal(read.agentState, '');
      assert.deepEqual([...read.nextNeeds], []);
      assert.equal(read.recentTopic, '');
    } finally {
      db2.close();
    }
  } finally {
    await ctx.cleanup();
  }
});

test('intel-restart: UTF-8 NFC normalization preserved for accented characters', async () => {
  const ctx = await openMigratedFileDb();
  try {
    const sessionId = 'session-restart-nfc';
    // Source string is NFC ("café" as a single é codepoint).
    // Decomposed form ("cafe" + combining acute) is NFD — not used here.
    const nfcInput = 'café'; // U+00E9 single codepoint (NFC)
    const intel = {
      agentState: `intel café plán test ${nfcInput}`,
      nextNeeds: ['ção-1', 'ção-2'],
      recentTopic: `tópico: ${nfcInput}`,
    };

    const db1 = new Database(ctx.dbPath);
    try {
      writeIntelRow(db1, sessionId, intel, 1_700_000_012);
    } finally {
      db1.close();
    }

    const db2 = new Database(ctx.dbPath);
    try {
      const read = getIntel(db2, sessionId);
      assert.ok(read, 'NFC intel must survive close + reopen');
      // Round-trip preserves NFC bytes; byte-string equality is the
      // D-006 determinism invariant (no composition form drift).
      const readAgentState = read.agentState;
      assert.equal(Buffer.byteLength(readAgentState, 'utf8'), Buffer.byteLength(intel.agentState, 'utf8'),
        'agentState byte-length must match (NFC preserved across restart)');
      assert.equal(readAgentState, intel.agentState);
      assert.deepEqual([...read.nextNeeds], intel.nextNeeds);
      assert.equal(read.recentTopic, intel.recentTopic);
    } finally {
      db2.close();
    }
  } finally {
    await ctx.cleanup();
  }
});
