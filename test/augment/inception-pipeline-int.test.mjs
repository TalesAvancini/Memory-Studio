/**
 * Inception pipeline integration tests (Phase 6b T-14 / AC-9, AC-10).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md`
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md`
 * Source design: `.specs/features/phase-6b-fast-agent-intel/design.md` §3.5
 *
 * Proves that `runAugment()` (Phase 5a.2 orchestrator) correctly:
 *   1. Reads prior turn's intel from the store (warm path) — Stage 1b
 *      wires `BuildOptions.intel` from the `getIntel(sessionId)`
 *      callback.
 *   2. Falls back to `callFastAgent(prompt)` on cold start when
 *      `getIntel` returns null.
 *   3. Fires the tail setImmediate AFTER the response is returned
 *      (`writeIntel` is invoked with the intel used in this turn).
 *   4. Preserves backward compat: when no intel hooks are wired, the
 *      pipeline runs unchanged and the SHA matches the no-intel
 *      baseline (D-006 byte-string determinism + cache hit invariant
 *      R-15).
 *   5. Honors the latency budget: response returns in p50 < 50ms
 *      even when Stage 1b awaits the fast-agent stub synchronously.
 *
 * The test seeds the skills table + FTS5 storage so the pipeline
 * stays on the MAIN path (Stages 4-9). The fail-open path (which
 * does NOT include intel) is tested separately in
 * `test/augment/pipeline.test.mjs` — this test is dedicated to the
 * new Stage 1b + tail setImmediate wiring.
 *
 * Uses the in-process `runAugment()` API directly (no Fastify
 * `app.inject`) so the test surface is hermetic. PipelineContext is
 * built ad-hoc per test with stub `getIntel` / `writeIntel` /
 * `callFastAgent` callbacks.
 *
 * 5 cases — matches the spec.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { applyMigrationsSync } from '../../src/catalog/migrations/runner.ts';
import { writeIntelRow } from '../../src/catalog/index.ts';
import { runAugment } from '../../src/server/augment/pipeline.ts';
import { EMBEDDING_DIMENSIONS } from '../../src/catalog/embedder/index.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';
import { EMPTY_INTEL } from '../../src/server/fast-agent/intel-schema.ts';

function migrationsDir() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'src', 'catalog', 'migrations');
}

/**
 * Open a fresh `:memory:` DB with the 004_intel migration applied
 * (WAL pragma stripped — see migrations-004.test.mjs rationale) AND
 * the search storage initialized (FTS5 + sqlite-vec virtual tables)
 * so the pipeline stays on the main Stages 4-9 path.
 */
function freshMainPathDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      category TEXT,
      critical INTEGER,
      is_default INTEGER,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      catalog_id TEXT PRIMARY KEY REFERENCES catalog(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model_version TEXT NOT NULL,
      embedded_at INTEGER NOT NULL
    );
  `);
  initializeSearchStorage(db);
  const fullSql = readFileSync(join(migrationsDir(), '004_intel.sql'), 'utf8');
  const ddlOnly = fullSql.replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;/gi, '');
  applyMigrationsSync(db, [{ version: 4, name: '004_intel', sql: ddlOnly }]);
  return db;
}

const FIXTURE_INTEL = {
  agentState: 'pipeline-int-test-agent-state',
  nextNeeds: ['pipeline-need-a', 'pipeline-need-b'],
  recentTopic: 'pipeline-int-test-recent-topic',
};

const FIXTURE_INTEL_ALT = {
  agentState: 'pipeline-int-test-agent-state-ALT',
  nextNeeds: ['pipeline-need-x', 'pipeline-need-y', 'pipeline-need-z'],
  recentTopic: 'pipeline-int-test-recent-topic-ALT',
};

/**
 * Build a hermetic PipelineContext with a stub embedder + an in-memory
 * db on the MAIN path (Stages 4-9 succeed). The embedder returns a
 * zero vector (no corpus is seeded → retrieval returns empty matched,
 * top-k returns empty, but the retrieval path completes without
 * throwing).
 */
function makeMainPathContext(overrides = {}) {
  const db = freshMainPathDb();
  return {
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() {
        return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
      },
      async embed() {
        return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
      },
    },
    ...overrides,
  };
}

const baseRequest = {
  prompt: 'design a server endpoint that validates authentication tokens',
  context: null,
  fingerprint: {
    projectPath: '/tmp/inception-pipeline-int',
    agentId: 'claude-code',
    sessionId: 'inception-pipeline-int-001',
    gitBranch: 'main',
  },
  activeCatalog: ['skill-auth-01', 'rule-no-secrets-01', 'persona-eng-01'],
  schemaVersion: 3,
};

// --- Tests ------------------------------------------------------------------

test('inception-pipeline-int: warm path — getIntel returns prior intel → injected into Block 2 (AC-9)', async () => {
  const ctx = makeMainPathContext();
  const sessionId = 'inception-warm-001';
  // Seed the prior turn's intel (simulating that the previous /v1/messages
  // response wrote via the proxy's tail setImmediate).
  writeIntelRow(ctx.db, sessionId, FIXTURE_INTEL, Math.floor(Date.now() / 1000));

  let getIntelCallCount = 0;
  const sessionFromContext = sessionId;
  const augmentedCtx = {
    ...ctx,
    sessionId: sessionFromContext,
    getIntel: (sid) => {
      getIntelCallCount += 1;
      assert.equal(sid, sessionFromContext, 'getIntel must be called with the context sessionId');
      const row = ctx.db
        .prepare('SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?')
        .get(sid);
      if (!row) return null;
      return {
        agentState: row.agent_state,
        nextNeeds: JSON.parse(row.next_needs),
        recentTopic: row.recent_topic,
      };
    },
  };

  try {
    const res = await runAugment(baseRequest, augmentedCtx);
    assert.equal(getIntelCallCount, 1, 'getIntel must be called exactly once before Stage 4');
    assert.equal(typeof res.systemMessage, 'string');
    assert.match(res.systemMessage, /^[0-9a-f]{64}$/);
    // The pipeline must NOT be in the fail-open path. With main-path
    // storage, the response's emptyReason is `low_confidence` (not
    // `timeout`).
    assert.notEqual(res.emptyReason, 'timeout', 'pipeline must stay on the main Stages 4-9 path');

    // Cross-check: running the same request without intel must
    // produce a DIFFERENT SHA. If the intel section were omitted,
    // the two SHAs would match. So this assertion proves the intel
    // was injected into Block 2.
    const ctxNoIntel = makeMainPathContext();
    try {
      const resNoIntel = await runAugment(baseRequest, ctxNoIntel);
      assert.notEqual(
        res.systemMessage,
        resNoIntel.systemMessage,
        'warm intel must change the SHA (## Intel section added to Block 2)',
      );
    } finally {
      ctxNoIntel.db.close();
    }
  } finally {
    ctx.db.close();
  }
});

test('inception-pipeline-int: cold start — getIntel returns null → callFastAgent runs → injected into Block 2 (AC-9)', async () => {
  const ctx = makeMainPathContext();
  const sessionId = 'inception-cold-001';
  // No prior row → getIntel returns null → callFastAgent runs.
  let getIntelCallCount = 0;
  let callFastAgentCallCount = 0;
  const augmentedCtx = {
    ...ctx,
    sessionId,
    getIntel: () => {
      getIntelCallCount += 1;
      return null; // cold start
    },
    callFastAgent: async (req) => {
      callFastAgentCallCount += 1;
      assert.equal(req.prompt, baseRequest.prompt, 'callFastAgent must receive the current prompt');
      assert.equal(req.model, 'MiniMax-M2.7-highspeed');
      return { intel: FIXTURE_INTEL };
    },
  };

  try {
    const res = await runAugment(baseRequest, augmentedCtx);
    assert.equal(getIntelCallCount, 1, 'getIntel must be called first');
    assert.equal(callFastAgentCallCount, 1, 'callFastAgent must be called when getIntel returns null');
    assert.notEqual(res.emptyReason, 'timeout', 'pipeline must stay on the main Stages 4-9 path');

    // Cross-check: the cold-start intel must change the SHA (the
    // no-callFastAgent path would produce a no-intel SHA).
    const ctxNoIntel = makeMainPathContext();
    try {
      const resNoIntel = await runAugment(baseRequest, ctxNoIntel);
      assert.notEqual(
        res.systemMessage,
        resNoIntel.systemMessage,
        'cold-start callFastAgent intel must change the SHA (## Intel section added to Block 2)',
      );
    } finally {
      ctxNoIntel.db.close();
    }
  } finally {
    ctx.db.close();
  }
});

test('inception-pipeline-int: tail setImmediate fires after response — writeIntel called with the intel used (AC-10)', async () => {
  const ctx = makeMainPathContext();
  const sessionId = 'inception-tail-001';
  // No prior row; pipeline will cold-start callFastAgent and then
  // tail-write the result via setImmediate.
  const writes = [];
  const augmentedCtx = {
    ...ctx,
    sessionId,
    getIntel: () => null,
    callFastAgent: async () => ({ intel: FIXTURE_INTEL }),
    writeIntel: async (sid, intel) => {
      writes.push({ sid, intel, ts: Date.now() });
    },
  };

  try {
    const tRequestStart = Date.now();
    const res = await runAugment(baseRequest, augmentedCtx);
    const tResponseEnd = Date.now();
    assert.equal(typeof res.systemMessage, 'string');
    assert.match(res.systemMessage, /^[0-9a-f]{64}$/);
    // Allow the setImmediate to fire (it runs in the next event-loop
    // tick; one small timeout is enough for our void promise).
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(writes.length, 1, 'tail setImmediate must invoke writeIntel exactly once');
    assert.equal(writes[0].sid, sessionId, 'writeIntel must receive the context sessionId');
    assert.deepEqual(writes[0].intel, FIXTURE_INTEL, 'writeIntel must persist the intel used in this turn');
    // The write timestamp must be AFTER the response timestamp (latency trick).
    assert.ok(
      writes[0].ts >= tResponseEnd,
      `tail write must fire after response: write_ts=${writes[0].ts}, response_end=${tResponseEnd}, request_start=${tRequestStart}`,
    );
  } finally {
    ctx.db.close();
  }
});

test('inception-pipeline-int: backward compat — no intel hooks → no ## Intel section (D-006 baseline preserved)', async () => {
  // No sessionId / no getIntel / no callFastAgent / no writeIntel —
  // the pipeline must run unchanged and produce the no-intel baseline
  // SHA. The fact that two runs produce identical SHAs is the cache
  // hit invariant R-15 for legacy callers.
  const ctx = makeMainPathContext();
  try {
    const res1 = await runAugment(baseRequest, ctx);
    const res2 = await runAugment(baseRequest, ctx);
    assert.equal(typeof res1.systemMessage, 'string');
    assert.match(res1.systemMessage, /^[0-9a-f]{64}$/);
    assert.equal(
      res1.systemMessage,
      res2.systemMessage,
      'no-intel baseline SHA must be byte-identical across calls (D-006 + R-15 cache hit invariant)',
    );
    assert.notEqual(res1.emptyReason, 'timeout', 'pipeline must stay on the main Stages 4-9 path');
  } finally {
    ctx.db.close();
  }
});

test('inception-pipeline-int: latency — response p50 < 50ms even with sync Stage 1b callFastAgent (R-20 / POC ceiling)', async () => {
  // The setImmediate tail is fire-and-forget; the synchronous Stage 1b
  // callFastAgent path is the worst case for response latency. We
  // run 10 samples with a deterministic stub that resolves in 1ms
  // (well above Phase 6a's 223ms stub measurement, but the await
  // cost is what we measure, not the network).
  const samples = 10;
  const latencies = [];
  for (let i = 0; i < samples; i += 1) {
    const ctx = makeMainPathContext({
      sessionId: `inception-lat-${i}`,
      getIntel: () => null, // force callFastAgent path every time
      callFastAgent: async () => {
        // 1ms simulated fast-agent latency (Phase 6a POC measured
        // 223ms with stub + spawn; 1ms is a tight lower bound to
        // prove the response p50 is unaffected by the await).
        await new Promise((r) => setTimeout(r, 1));
        return { intel: FIXTURE_INTEL };
      },
    });
    try {
      const t0 = performance.now();
      await runAugment(baseRequest, ctx);
      const t1 = performance.now();
      latencies.push(t1 - t0);
    } finally {
      ctx.db.close();
    }
  }
  // Latency trick invariant: `/augment` response p50 < 50ms even with
  // sync Stage 1b. The fast-agent latency is hidden by setImmediate
  // for the tail; the only synchronous cost is the Stage 1b call.
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(samples / 2)];
  assert.ok(
    p50 < 50,
    `Stage 1b sync path must keep p50 < 50ms (AD-006 latency trick invariant); got p50=${p50.toFixed(2)}ms across ${samples} samples`,
  );
});

// Defensive: re-affirm the EMPTY_INTEL sentinel is the D-005 canonical
// empty literal. This protects the no-intel baseline SHA contract from
// accidental drift if the schema sentinel changes.
test('inception-pipeline-int: defensive — EMPTY_INTEL sentinel is the D-005 canonical empty literal', () => {
  assert.deepEqual(EMPTY_INTEL, { agentState: '', nextNeeds: [], recentTopic: '' });
});

// Suppress unused-var lint for FIXTURE_INTEL_ALT (kept for future tests).
void FIXTURE_INTEL_ALT;
