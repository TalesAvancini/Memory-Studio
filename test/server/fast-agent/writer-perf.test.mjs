/**
 * Fast-agent writer perf tests (Phase 6b T-06 / AC-5).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md`
 *   AC-5 (sync write p95 ≤ 1ms across 10 amostras + 5 warmup;
 *   D-007 async fallback recommended if measured > 1ms).
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md`
 *   T-06 (mandatory perf test, result feeds AD-008).
 *
 * Distinct port range from any other test:
 *   - No port collisions (writer tests are in-process + SQLite-only).
 *   - 100 sequential writes (`n=100`) — same order of magnitude as the
 *     Phase 5b.1 audit buffer triggers (N=100 OR T=1000ms).
 *
 * Output feeds AD-008 (recorded in Batch 3 / T-17). The test
 * PASSES either way:
 *   - p95 < 1ms → AD-008 picks "sync (measured < 1ms, default)".
 *   - p95 ≥ 1ms → AD-008 picks "async (D-007 fallback)" + the
 *     `createAsyncIntelWriter` factory must already exist (covered
 *     by a structural assertion below).
 *
 * 4 cases — sync write perf + structural coverage of the async
 * fallback factory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import {
  createAsyncIntelWriter,
  createSyncIntelWriter,
} from '../../../src/server/fast-agent/writer.ts';
import { applyMigrationsSync } from '../../../src/catalog/migrations/runner.ts';

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..', 'src', 'catalog', 'migrations');
}

/**
 * Open a fresh `:memory:` DB with the 004_intel migration applied
 * (WAL pragma stripped — see migrations-004.test.mjs for rationale).
 */
function freshMigratedDb() {
  const db = new Database(':memory:');
  const sql = readFileSync(join(migrationsDir(), '004_intel.sql'), 'utf8');
  const ddlOnly = sql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
  applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);
  return db;
}

/**
 * Compute the p95 (95th percentile) of a sorted-ms array.
 *
 * 95th percentile index: Math.ceil(0.95 * n) - 1, clamped to [0, n-1].
 * For n=100 this picks sample #94 (zero-indexed) of the sorted
 * array — the standard textbook p95 calculation.
 */
function p95(samples) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  const v = sorted[idx];
  return typeof v === 'number' ? v : 0;
}

// --- Fixtures (per spec.md) ------------------------------------------------

const FIXTURE_INTEL = {
  agentState: 'writer-perf-agent-state-line',
  nextNeeds: ['writer-perf-need-1', 'writer-perf-need-2'],
  recentTopic: 'writer-perf-recent-topic-line',
};

// --- Tests -----------------------------------------------------------------

test('writer-perf: sync write p95 ≤ 1ms across 100 writes (5 warmup + 95 measured)', async () => {
  const db = freshMigratedDb();
  try {
    const writer = createSyncIntelWriter(db);

    // 5 warmup writes — primes SQLite's statement cache + better-sqlite3
    // native binding hot path. Discard these measurements.
    for (let i = 0; i < 5; i++) {
      await writer.write(`warmup-${i}`, FIXTURE_INTEL);
    }

    // 95 measured writes — gives us a sample size worth the p95 label.
    const samples = [];
    for (let i = 0; i < 95; i++) {
      const ms = await writer.measureSyncWriteMs(`perf-${i}`, FIXTURE_INTEL);
      samples.push(ms);
    }
    const p95ms = p95(samples);

    // Surface the measurement to the test runner so AD-008 captures it.
    // (node:test does not natively stream values; we use console.log
    // which the harness surfaces in its TAP output.)
    console.log(`[writer-perf] sync p95=${p95ms.toFixed(3)}ms (n=${samples.length})`);

    assert.ok(
      p95ms <= 1,
      `sync write p95 must be ≤ 1ms (Phase 6a POC measured 0.02ms); got ${p95ms.toFixed(3)}ms`,
    );
  } finally {
    db.close();
  }
});

test('writer-perf: sync write round-trips the Intel literal (100 distinct sessionIds)', async () => {
  const db = freshMigratedDb();
  try {
    const writer = createSyncIntelWriter(db);
    // Write 100 rows; read all back via writeIntelRow → getIntel.
    for (let i = 0; i < 100; i++) {
      await writer.write(`session-${String(i).padStart(3, '0')}`, FIXTURE_INTEL);
    }
    const count = /** @type {{ n: number } | undefined} */ (
      db.prepare('SELECT COUNT(*) AS n FROM intel').get()
    );
    assert.equal(count?.n, 100, 'all 100 rows must be persisted');

    // Spot-check the first + last rows.
    const first = db.prepare('SELECT agent_state FROM intel WHERE session_id = ?').get('session-000');
    const last = db.prepare('SELECT agent_state FROM intel WHERE session_id = ?').get('session-099');
    assert.equal(/** @type {{ agent_state: string }} */ (first).agent_state, FIXTURE_INTEL.agentState);
    assert.equal(/** @type {{ agent_state: string }} */ (last).agent_state, FIXTURE_INTEL.agentState);
  } finally {
    db.close();
  }
});

test('writer-perf: empty Intel (D-005) round-trips byte-equal via the sync writer', async () => {
  const db = freshMigratedDb();
  try {
    const writer = createSyncIntelWriter(db);
    const empty = { agentState: '', nextNeeds: [], recentTopic: '' };
    await writer.write('session-empty-intel', empty);

    const row = /** @type {{ agent_state: string; next_needs: string; recent_topic: string } | undefined} */ (
      db.prepare('SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?').get('session-empty-intel')
    );
    assert.ok(row, 'empty intel row must be persisted');
    assert.equal(row.agent_state, '');
    assert.equal(row.next_needs, '[]');
    assert.equal(row.recent_topic, '');
  } finally {
    db.close();
  }
});

test('writer-perf: createAsyncIntelWriter factory exists for D-007 fallback (structural)', () => {
  // The async factory MUST exist regardless of whether it's activated.
  // writer.ts imports it; if the import resolves, the factory ships.
  // This test ASSERTS that calling createAsyncIntelWriter returns an
  // IntelWriter-shaped object whose `write` is callable (even if we
  // never await it — just structural).
  const db = freshMigratedDb();
  try {
    const asyncWriter = createAsyncIntelWriter(db);
    assert.equal(typeof asyncWriter.write, 'function', 'async writer must expose write()');
    assert.equal(typeof asyncWriter.measureSyncWriteMs, 'function', 'async writer must expose measureSyncWriteMs()');
    // measureSyncWriteMs is documented as 0 for the async factory
    // (the async path is fire-and-forget).
    return (async () => {
      const ms = await asyncWriter.measureSyncWriteMs('session-structural', FIXTURE_INTEL);
      assert.equal(typeof ms, 'number', 'measureSyncWriteMs must return a number (0 for async)');
    })();
  } finally {
    db.close();
  }
});
