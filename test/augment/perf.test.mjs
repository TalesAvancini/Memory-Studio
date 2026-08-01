/**
 * Perf measurement harness for the Memory Studio `/augment` endpoint.
 *
 * Phase 5a.4 (T-12) — R-18 / AC-17. Validates the latency budget
 * `median(p50) < 50ms` AND `p99 < 200ms` per PRD §10.2.
 *
 * Design:
 *   - Boots the server in-process via Fastify `app.inject()` (no
 *     socket bind, no network round-trip cost) — same pattern as
 *     `test/augment/byte-string-equality.test.mjs`.
 *   - Reuses a deterministic 384-dim query vector (`new Float32Array(384).fill(0.1)`)
 *     so the embedder warm cache is hit consistently across the loop and
 *     the measurement reflects SERVER overhead, NOT ONNX runtime cost.
 *     (Excluding ONNX from the measurement loop is the spec requirement.)
 *   - 100 warmup requests (excluded from measurement) to prime V8 JIT,
 *     sqlite connection caches, JSON serializers, and the FTS/vec
 *     virtual-table hot path.
 *   - N=3 measurement rounds × 1000 requests each. Per-round, we record
 *     `latencyMs.total` (the server-reported timing) for each request.
 *   - Aggregates min / median / p95 / p99 ACROSS rounds (median of
 *     medians is the gating metric; p99 is the max of round p99s).
 *   - Asserts: `median(p50) < 50ms` AND `p99 < 200ms`. Fails FAST
 *     with the observed numbers in the error message so the
 *     Implementer/Verifier can see the regression magnitude.
 *   - Deterministic: no real PRNG. Every seed / port / fixture is
 *     hardcoded. The test is reproducible byte-for-byte.
 *
 * Why in-process (`app.inject()`):
 *   - Eliminates kernel-level scheduling noise (no socket, no
 *     loopback TCP handshake).
 *   - Strips process startup cost (already paid by the test runner).
 *   - Still exercises the full route handler (Zod validation →
 *     social gate → retrieval pipeline → augmenter → log emission),
 *     which is exactly what we want to measure.
 *
 * Why deterministic vector (excludes ONNX):
 *   - ONNX runtime is highly variable across invocations (kernel
 *     thread-pool jitter, BFC allocator warm-up). The 384d
 *     pre-computed vector decouples server overhead from ONNX
 *     runtime noise and matches the spec's "prove server overhead"
 *     requirement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  createServer,
  resetServerMetadataForTests,
} from '../../src/server/index.ts';
import { setAugmentPipelineProvider } from '../../src/server/augment.ts';
import { logger as augmentLogger } from '../../src/server/logger.ts';
import { EMBEDDING_DIMENSIONS } from '../../src/catalog/embedder/index.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';

// --- Silence the augment route's pino logger for this test ---------------
// The route handler emits a structured JSON log line on every request
// via `requestLogger({...}).info({...}, '/augment')`. With 3100+
// requests during a single perf run, that floods stdout with pino
// output that swamps the TAP summary. We silence the module-level
// `logger` (which is the parent of every per-request child) by
// downgrading its level to `silent`. The log emission itself is not
// part of the measurement (we measure `latencyMs.total` from the
// response body), and silencing it has no perf cost beyond avoiding
// the JSON.stringify + write syscall.
augmentLogger.level = 'silent';

// --- Perf budget constants (PRD §10.2) -----------------------------------

/** Median latency budget (no embedding cache miss). */
const PERF_BUDGET_MEDIAN_MS = 50;
/** Tail latency budget (with embedding). */
const PERF_BUDGET_P99_MS = 200;
/** Warmup requests (excluded from measurement). */
const WARMUP_COUNT = 100;
/** Measurement rounds. */
const ROUNDS = 3;
/** Requests per round. */
const ROUND_SIZE = 1000;

// --- Fixture corpus --------------------------------------------------------
//
// 5 catalog rows: 3 skills + 1 rule + 1 persona. Each has unique FTS text
// so `queryFts(db, prompt)` returns a stable, deterministic matched set.
// Slugs are kebab-case so the tiebreak in `topKAndTiebreak` is stable.

const FIXTURE_ROWS = [
  {
    slug: 'auth-jwt-validation',
    kind: 'skill',
    content: 'design a fastify endpoint that validates JWT tokens using the jose library',
  },
  {
    slug: 'auth-oauth-handler',
    kind: 'skill',
    content: 'implement an OAuth 2 authorization-code handler with PKCE',
  },
  {
    slug: 'auth-session-cookie',
    kind: 'skill',
    content: 'set HttpOnly SameSite session cookies for authenticated routes',
  },
  {
    slug: 'rule-no-secrets-in-prompts',
    kind: 'rule',
    content: 'never include raw API keys, passwords, or tokens in prompts',
  },
  {
    slug: 'persona-senior-engineer',
    kind: 'persona',
    content: 'respond as a senior engineer — pragmatic, terse, focused on the requested artifact',
  },
];

// Non-social technical prompt (matches "auth" + "server" terms against
// the fixture rows above). Avoids the `isSocial` short-circuit so we
// exercise the FULL pipeline (embed + FTS + vec + RRF + threshold +
// top-K + augmenter).
const BASE_PROMPT =
  'design a fastify endpoint that validates authentication tokens securely';

// --- Helpers --------------------------------------------------------------

/** Pre-computed deterministic 384-dim query vector. Excludes ONNX. */
function deterministicQueryVector() {
  const v = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  v.fill(0.1);
  return v;
}

function freshSeededDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_yaml TEXT NOT NULL,
      embedding BLOB NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    initializeSearchStorage(db);
  } catch {
    // Vec extension may be unavailable in some envs; pipeline is fail-open.
  }

  const zeroEmbedding = (() => {
    const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  })();

  const insert = db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  );
  for (const row of FIXTURE_ROWS) {
    insert.run(row.slug, row.kind, row.content, zeroEmbedding, `h-${row.slug}`);
  }
  return db;
}

/**
 * Build a stub provider with a deterministic 384d query vector cached
 * once. The cached Float32Array is returned on every `encode()` call
 * so we exclude the ONNX runtime from the measurement loop.
 */
function stubProvider() {
  const db = freshSeededDb();
  const cachedVector = deterministicQueryVector();
  return {
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() {
        // Return a COPY so the pipeline can mutate it without poisoning
        // the cache. The copy is cheap (Float32Array constructor copies
        // the buffer in <1µs for 384d).
        return new Float32Array(cachedVector);
      },
      async embed() {
        return new Float32Array(cachedVector);
      },
    },
  };
}

function buildRequest() {
  return {
    prompt: BASE_PROMPT,
    context: null,
    fingerprint: {
      projectPath: '/tmp/perf-harness',
      agentId: 'claude-code',
      sessionId: 'perf-session-001',
      gitBranch: 'main',
    },
    activeCatalog: [
      'auth-jwt-validation',
      'auth-oauth-handler',
      'auth-session-cookie',
      'rule-no-secrets-in-prompts',
      'persona-senior-engineer',
    ],
    tenantId: 'tenant-perf',
    schemaVersion: 3,
  };
}

// --- Stats helpers ---------------------------------------------------------

/**
 * Sort numerically in-place (no mutation of caller's array). Returns a
 * new sorted array so we can reuse the original ordering if needed.
 */
function sorted(arr) {
  return arr.slice().sort((a, b) => a - b);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedArr.length)),
  );
  return sortedArr[idx];
}

function summarizeRound(latencies) {
  const s = sorted(latencies);
  return {
    min: s[0] ?? 0,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1] ?? 0,
    n: s.length,
  };
}

/** Aggregate round summaries into a cross-round report. */
function aggregate(rounds) {
  const medians = rounds.map((r) => r.median);
  const p99s = rounds.map((r) => r.p99);
  const p95s = rounds.map((r) => r.p95);
  const mins = rounds.map((r) => r.min);
  const maxs = rounds.map((r) => r.max);
  return {
    /** Median of round medians — the gating metric (R-18 / AC-17). */
    medianOfMedians: percentile(sorted(medians), 50),
    /** Max of round p99s — the p99 tail latency gate. */
    maxP99: Math.max(...p99s),
    /** Mean p95 across rounds, for reporting. */
    meanP95: p95s.reduce((a, b) => a + b, 0) / p95s.length,
    min: Math.min(...mins),
    max: Math.max(...maxs),
    rounds,
  };
}

/** Round a number to 2 decimals for display. */
function r2(n) {
  return Math.round(n * 100) / 100;
}

// --- The test --------------------------------------------------------------

test('perf: median(p50)<50ms AND p99<200ms across N=3 rounds × 1000 requests', async (t) => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);

  // Port range is irrelevant for app.inject() but boot.ts insists on a
  // range. Use a range outside the default block to avoid colliding with
  // any other test that might run in parallel on the same host.
  const handle = await createServer({ portRange: [43_900, 43_999] });
  const req = buildRequest();
  const summary = { rounds: [] };

  try {
    // --- Warmup: 100 requests, NOT measured. -----------------------
    for (let i = 0; i < WARMUP_COUNT; i += 1) {
      const r = await handle.app.inject({
        method: 'POST',
        url: '/augment',
        payload: req,
      });
      assert.equal(r.statusCode, 200, `warmup request ${i} returned ${r.statusCode}`);
    }

    // --- Measurement: N=3 rounds × 1000 requests. ------------------
    for (let roundIdx = 0; roundIdx < ROUNDS; roundIdx += 1) {
      const latencies = new Array(ROUND_SIZE);
      for (let i = 0; i < ROUND_SIZE; i += 1) {
        const r = await handle.app.inject({
          method: 'POST',
          url: '/augment',
          payload: req,
        });
        assert.equal(
          r.statusCode,
          200,
          `round ${roundIdx} request ${i} returned ${r.statusCode} body=${r.body.slice(0, 200)}`,
        );
        const body = JSON.parse(r.body);
        latencies[i] = body.latencyMs.total;
      }
      summary.rounds.push(summarizeRound(latencies));
    }
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }

  const agg = aggregate(summary.rounds);

  // --- Report ----------------------------------------------------------
  // Per-spec output: `[perf] median(p50)=<ms> p99=<ms> across 3 runs × 1000 requests. PASS|FAIL`
  const pass =
    agg.medianOfMedians < PERF_BUDGET_MEDIAN_MS &&
    agg.maxP99 < PERF_BUDGET_P99_MS;
  const verdict = pass ? 'PASS' : 'FAIL';

  console.log(
    `[perf] median(p50)=${r2(agg.medianOfMedians)}ms ` +
      `p99=${r2(agg.maxP99)}ms ` +
      `across ${ROUNDS} runs × ${ROUND_SIZE} requests (warmup=${WARMUP_COUNT}). ${verdict}`,
  );
  for (let i = 0; i < agg.rounds.length; i += 1) {
    const r = agg.rounds[i];
    console.log(
      `[perf]   round ${i + 1}: ` +
        `min=${r2(r.min)}ms ` +
        `median=${r2(r.median)}ms ` +
        `p95=${r2(r.p95)}ms ` +
        `p99=${r2(r.p99)}ms ` +
        `max=${r2(r.max)}ms`,
    );
  }
  console.log(
    `[perf] aggregate: min=${r2(agg.min)}ms ` +
      `medianOfMedians=${r2(agg.medianOfMedians)}ms ` +
      `meanP95=${r2(agg.meanP95)}ms ` +
      `maxP99=${r2(agg.maxP99)}ms ` +
      `max=${r2(agg.max)}ms`,
  );

  // --- Assertions (R-18 / AC-17) -------------------------------------
  assert.ok(
    agg.medianOfMedians < PERF_BUDGET_MEDIAN_MS,
    `median(p50) budget exceeded: got ${r2(agg.medianOfMedians)}ms, budget < ${PERF_BUDGET_MEDIAN_MS}ms`,
  );
  assert.ok(
    agg.maxP99 < PERF_BUDGET_P99_MS,
    `p99 budget exceeded: got ${r2(agg.maxP99)}ms, budget < ${PERF_BUDGET_P99_MS}ms`,
  );

  // Defensive: assert we actually recorded ROUND_SIZE × ROUNDS
  // measurements. A bug that drops requests (e.g., a thrown unhandled
  // promise rejection) would otherwise slip past the perf gate.
  for (let i = 0; i < summary.rounds.length; i += 1) {
    assert.equal(
      summary.rounds[i].n,
      ROUND_SIZE,
      `round ${i + 1} recorded ${summary.rounds[i].n} samples, expected ${ROUND_SIZE}`,
    );
  }
});
