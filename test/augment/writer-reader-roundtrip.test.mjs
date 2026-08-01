/**
 * Writer-reader roundtrip with intel injection (Phase 6b T-11).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md`
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md`
 *
 * End-to-end verification of the writer-reader contract:
 *   1. Construct an Intel literal.
 *   2. Write it via `writeIntelRow(slotId, intel)` (T-02 helper).
 *   3. Read it back via `getIntel(slotId)` (T-02 helper).
 *   4. Assert: returned Intel equals written Intel (deep equal).
 *   5. Inject into `buildSystemMessage(req, matched, { intel })` →
 *      Block 2 contains the `## Intel` section.
 *   6. Hash stability: same intel twice → same SHA.
 *
 * Mirrors the Phase 6b T-08 `writer.test.mjs` pattern but elevates
 * the assertion to the writer-reader-AUGMENT integration boundary:
 * proves that the writer's persist shape survives the round-trip
 * AND survives the augmenter's BuildOptions.intel injection path.
 *
 * Uses `:memory:` SQLite + the `setIntelWriterDb` / `resetIntelWriterForTests`
 * pattern from Batch 1. WAL pragma stripped from the migration SQL
 * (per `migrations-004.test.mjs` rationale — `journal_mode` cannot
 * be changed inside a transaction on `:memory:`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { applyMigrationsSync } from '../../src/catalog/migrations/runner.ts';
import { getIntel, writeIntelRow } from '../../src/catalog/index.ts';
import { buildSystemMessage } from '../../src/server/augment/augmenter.ts';
import { EMPTY_INTEL } from '../../src/server/fast-agent/intel-schema.ts';

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'src', 'catalog', 'migrations');
}

/**
 * Open a fresh `:memory:` DB with the 004_intel migration applied
 * (WAL pragma stripped — see migrations-004.test.mjs for rationale).
 */
function freshDb() {
  const db = new Database(':memory:');
  const fullSql = readFileSync(join(migrationsDir(), '004_intel.sql'), 'utf8');
  const ddlOnly = fullSql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
  applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);
  return db;
}

function makeItem(overrides) {
  return {
    id: 0,
    slug: '',
    kind: 'skill',
    text: '',
    rrfScore: 0,
    ...overrides,
  };
}

const baseRequest = {
  prompt: 'design a server endpoint',
  context: null,
  fingerprint: {
    projectPath: '/tmp/writer-reader-roundtrip',
    agentId: 'claude-code',
    sessionId: 'wrr-session-001',
    gitBranch: 'main',
  },
  activeCatalog: ['skill-auth-01', 'rule-no-secrets-01', 'persona-eng-01'],
  schemaVersion: 3,
};

const FIXTURE_INTEL = {
  agentState: 'coding',
  nextNeeds: ['run tests', 'commit changes'],
  recentTopic: 'phase 6b',
};

// --- Tests -----------------------------------------------------------------

test('writer-reader-roundtrip: writeIntelRow → getIntel → deep-equal (phase 6b T-11)', () => {
  const db = freshDb();
  try {
    const sessionId = 'wrr-session-canonical';
    const ts = 1_700_000_001;

    writeIntelRow(db, sessionId, FIXTURE_INTEL, ts);
    const read = getIntel(db, sessionId);

    assert.ok(read, 'getIntel must return the literal we just wrote');
    assert.deepEqual(
      read,
      FIXTURE_INTEL,
      `expected deep-equal round-trip; got ${JSON.stringify(read)} vs ${JSON.stringify(FIXTURE_INTEL)}`,
    );
  } finally {
    db.close();
  }
});

test('writer-reader-roundtrip: getIntel after write → injected into buildSystemMessage → ## Intel section present', () => {
  const db = freshDb();
  try {
    const sessionId = 'wrr-session-inject';
    const ts = 1_700_000_002;

    writeIntelRow(db, sessionId, FIXTURE_INTEL, ts);
    const retrieved = getIntel(db, sessionId);
    assert.ok(retrieved, 'retrieved Intel must be non-null');

    const matched = [
      makeItem({ slug: 'persona-eng-01', kind: 'persona', text: 'persona-senior-engineer' }),
      makeItem({ slug: 'skill-auth-01', kind: 'skill', text: 'JWT validation flow' }),
    ];
    const { system, sha256 } = buildSystemMessage(baseRequest, {
      matched,
      intel: retrieved,
    });

    // Block 2 must contain the canonical-JSON serialized Intel.
    assert.match(system[1].text, /## Intel/, 'Block 2 must include the ## Intel section header');
    assert.match(
      system[1].text,
      /agentState/,
      'Intel section must contain the canonical-JSON field "agentState"',
    );
    assert.match(
      system[1].text,
      /recentTopic/,
      'Intel section must contain the canonical-JSON field "recentTopic"',
    );
    assert.match(
      system[1].text,
      /## Intel[\s\S]*## Skills/,
      '## Intel must precede ## Skills in Block 2 (R-10 + AD-006 #1)',
    );

    // Block 1 (persona) is untouched by intel — cache hit invariant.
    assert.equal(
      system[0].text,
      'persona-senior-engineer',
      'Block 1 must be just the persona text (unmodified by intel)',
    );

    // Cross-check the SHA format (D-006 done criterion).
    assert.equal(sha256.length, 64);
    assert.match(sha256, /^[0-9a-f]{64}$/);
  } finally {
    db.close();
  }
});

test('writer-reader-roundtrip: hash stability — same intel twice → same SHA-256', () => {
  const db = freshDb();
  try {
    const sessionId = 'wrr-session-hash-stability';
    const ts = 1_700_000_003;

    writeIntelRow(db, sessionId, FIXTURE_INTEL, ts);
    const first = getIntel(db, sessionId);
    assert.ok(first, 'first read must succeed');

    // Same literal built twice — must produce the same SHA.
    const matched = [
      makeItem({ slug: 'persona-eng-01', kind: 'persona', text: 'persona-senior-engineer' }),
      makeItem({ slug: 'skill-auth-01', kind: 'skill', text: 'JWT validation flow' }),
    ];
    const r1 = buildSystemMessage(baseRequest, { matched, intel: first });
    const r2 = buildSystemMessage(baseRequest, { matched, intel: first });

    assert.equal(r1.sha256, r2.sha256, `expected identical SHA-256; got ${r1.sha256} vs ${r2.sha256}`);

    // Also: write the SAME literal a second time with a different ts
    // — the ts column is not in the round-tripped shape, so the SHA
    // must remain identical (D-006 determinism for augmenting).
    writeIntelRow(db, sessionId, FIXTURE_INTEL, ts + 1);
    const reread = getIntel(db, sessionId);
    assert.ok(reread, 'second read must succeed');
    const r3 = buildSystemMessage(baseRequest, { matched, intel: reread });
    assert.equal(
      r1.sha256,
      r3.sha256,
      `expected SHA-256 stable across row rewrites (ts differs in DB but not in literal); got ${r1.sha256} vs ${r3.sha256}`,
    );
  } finally {
    db.close();
  }
});

test('writer-reader-roundtrip: empty Intel (D-005) round-trips → ## Intel section omitted', () => {
  const db = freshDb();
  try {
    const sessionId = 'wrr-session-empty';
    const ts = 1_700_000_004;

    writeIntelRow(db, sessionId, EMPTY_INTEL, ts);
    const retrieved = getIntel(db, sessionId);
    assert.ok(retrieved, 'empty Intel must round-trip');
    assert.deepEqual(retrieved, EMPTY_INTEL, 'empty Intel must be byte-equal after round-trip');

    const matched = [
      makeItem({ slug: 'persona-eng-01', kind: 'persona', text: 'persona-senior-engineer' }),
      makeItem({ slug: 'skill-auth-01', kind: 'skill', text: 'JWT validation flow' }),
    ];

    // Inject the retrieved empty Intel — the section must be omitted
    // (D-005 graceful degradation: empty = no section).
    const { system } = buildSystemMessage(baseRequest, {
      matched,
      intel: retrieved,
    });
    assert.doesNotMatch(
      system[1].text,
      /## Intel/,
      'empty Intel must NOT emit the ## Intel section header (D-005)',
    );

    // Cross-check: the SHA matches the no-intel baseline (same
    // matched + no intel).
    const noIntel = buildSystemMessage(baseRequest, { matched });
    assert.equal(
      system.length,
      noIntel.system.length,
      'Block 2 must be present (cache_control ephemeral) for both builds',
    );
    assert.equal(
      noIntel.sha256,
      buildSystemMessage(baseRequest, { matched, intel: retrieved }).sha256,
      'empty Intel must produce the same SHA as the no-intel baseline',
    );
  } finally {
    db.close();
  }
});

test('writer-reader-roundtrip: unknown session_id → getIntel returns null → section omitted', () => {
  const db = freshDb();
  try {
    const read = getIntel(db, 'never-written-session');
    assert.equal(read, null, 'getIntel on unknown session must return null');

    const matched = [
      makeItem({ slug: 'persona-eng-01', kind: 'persona', text: 'persona-senior-engineer' }),
    ];
    const { system } = buildSystemMessage(baseRequest, {
      matched,
      intel: read, // null — the augmenter must handle this gracefully
    });
    assert.doesNotMatch(
      system[1].text,
      /## Intel/,
      'null intel must NOT emit the ## Intel section header',
    );
  } finally {
    db.close();
  }
});
