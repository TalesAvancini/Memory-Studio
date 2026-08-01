/**
 * Intel store CRUD tests (Phase 6b T-02 / T-04).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-2.
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md` T-04.
 *
 * Verifies the read/write primitives in `src/catalog/intel-store.ts`:
 *   - `getIntel(db, sessionId)` returns the persisted Intel literal
 *   - `getIntel` returns `null` (NOT throws) for unknown session_id
 *   - `writeIntelRow(db, sessionId, intel, ts)` persists shape
 *   - D-005 graceful degradation: empty fields round-trip unchanged
 *   - Corrupted `next_needs` JSON → `getIntel` returns `null`
 *
 * Tests use `:memory:` SQLite + `applyMigrationsSync` with a single
 * migration entry (the actual 004_intel.sql file content, with the
 * in-transaction-incompatible WAL pragma stripped — see
 * migrations-004.test.mjs for the rationale). The `(getIntel,
 * writeIntelRow)` imports come from the catalog barrel so the test
 * exercises the public surface that the augment pipeline consumes.
 *
 * 4 cases — matches the spec.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
 * Open a fresh `:memory:` DB with the 004_intel migration applied.
 * The migration's WAL pragma is stripped because SQLite forbids
 * changing journal_mode inside an active transaction
 * (`applyMigrationsSync` wraps each migration in `db.transaction`).
 * Production WAL is set by `openCatalogDb` *before* migrations run.
 */
function freshMigratedDb() {
  const db = new Database(':memory:');
  const fullSql = readFileSync(
    join(migrationsDir(), '004_intel.sql'),
    'utf8',
  );
  const ddlOnly = fullSql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
  applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);
  return db;
}

// --- Fixtures (per spec.md) ------------------------------------------------

const VALID_INTEL = {
  agentState: 'implementing the OAuth 2 PKCE flow',
  nextNeeds: ['auth-csrf-token', 'auth-session-expiry'],
  recentTopic: 'fastify endpoint for token rotation',
};

const EMPTY_INTEL_LITERAL = {
  agentState: '',
  nextNeeds: [],
  recentTopic: '',
};

// --- Tests -----------------------------------------------------------------

test('intel-store: writeIntel → getIntel round-trip preserves shape', () => {
  const db = freshMigratedDb();
  try {
    const sessionId = 'session-roundtrip-001';
    writeIntelRow(db, sessionId, VALID_INTEL, 1_700_000_000);

    const read = getIntel(db, sessionId);
    assert.ok(read, 'getIntel must return the persisted Intel literal');
    assert.equal(read.agentState, VALID_INTEL.agentState);
    assert.deepEqual([...read.nextNeeds], VALID_INTEL.nextNeeds);
    assert.equal(read.recentTopic, VALID_INTEL.recentTopic);

    // Spot-check the ts column was persisted.
    const tsRow = /** @type {{ ts: number } | undefined} */ (
      db.prepare('SELECT ts FROM intel WHERE session_id = ?').get(sessionId)
    );
    assert.equal(tsRow?.ts, 1_700_000_000);
  } finally {
    db.close();
  }
});

test('intel-store: unknown session_id returns null (NOT throws) — AC-2', () => {
  const db = freshMigratedDb();
  try {
    const read = getIntel(db, 'nonexistent-session');
    assert.equal(read, null);
  } finally {
    db.close();
  }
});

test('intel-store: empty Intel round-trips unchanged (D-005 graceful degradation)', () => {
  const db = freshMigratedDb();
  try {
    const sessionId = 'session-empty-intel';
    writeIntelRow(db, sessionId, EMPTY_INTEL_LITERAL, 1_700_000_001);

    const read = getIntel(db, sessionId);
    assert.ok(read, 'empty intel must round-trip');
    assert.equal(read.agentState, '');
    assert.deepEqual([...read.nextNeeds], []);
    assert.equal(read.recentTopic, '');

    // The stored next_needs column is the literal `'[]'` — verifies
    // the storage layer persists the array shape as expected.
    const nextNeedsRow = /** @type {{ next_needs: string } | undefined} */ (
      db.prepare('SELECT next_needs FROM intel WHERE session_id = ?').get(sessionId)
    );
    assert.equal(nextNeedsRow?.next_needs, '[]');
  } finally {
    db.close();
  }
});

test('intel-store: corrupted next_needs JSON → getIntel returns null (does NOT throw)', () => {
  const db = freshMigratedDb();
  try {
    // Hand-write a row with garbage in next_needs to simulate a
    // future-schema-row that snuck in (or an adversarial write).
    db.prepare(
      'INSERT INTO intel (session_id, agent_state, next_needs, recent_topic, ts) VALUES (?, ?, ?, ?, ?)',
    ).run('session-corrupted', 'some-state', 'not-valid-json-at-all', 'topic', 1_700_000_002);

    const read = getIntel(db, 'session-corrupted');
    assert.equal(read, null, 'corrupted JSON must degrade to null (D-005 graceful)');
  } finally {
    db.close();
  }
});
