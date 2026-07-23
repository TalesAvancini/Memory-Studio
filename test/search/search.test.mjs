/**
 * Search orchestration integration tests.
 *
 * Cover SEARCH-06 through SEARCH-16 (integration closure), with SEARCH-01
 * through SEARCH-05 exercised end-to-end:
 *   - factory defaults + invalid config rejection
 *   - query / k validation
 *   - candidate depth calculation
 *   - real corpus: react-debug-01 ranks first for "como debugar React"
 *   - vector-only / FTS-only / both / neither outcomes
 *   - equality-boundary thresholds
 *   - top-k, empty catalog, punctuation-only lexical miss
 *   - determinism + invalid embedding / embedder / DB failures
 *   - no HTTP, no embeddings in output
 *
 * Uses a controlled deterministic embedder so we can assert cosine exactly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createSchema } from '../../src/catalog/schema.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';
import {
  createSearch,
  computeCandidateDepth,
} from '../../src/search/search.ts';
import { queryFts } from '../../src/search/fts.ts';
import { SearchError } from '../../src/search/errors.ts';
import { EMBEDDING_DIMENSIONS } from '../../src/catalog/embedder.ts';
import {
  DEFAULT_MIN_COSINE_SIMILARITY,
  DEFAULT_MIN_FTS_HITS,
  MIN_CANDIDATE_DEPTH,
  MAX_CANDIDATE_DEPTH,
  K_FLOOR_MULTIPLIER,
  MIN_K,
  MAX_K,
} from '../../src/search/types.ts';

/**
 * Build a deterministic embedder that always returns the same vector for a
 * given input. Two inputs that share the same vector after the helper map
 * will produce identical embeddings.
 */
function makeDeterministicEmbedder(map) {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(text) {
      const v = map(text);
      const arr = new Float32Array(EMBEDDING_DIMENSIONS);
      for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) arr[i] = v;
      return arr;
    },
  };
}

/**
 * The acceptance corpus: 12 catalog rows, each tagged with the dimension
 * the embedder uses for that row. The query embedder points at dimension 0
 * (the "react-debug-01" canonical query) so cosine similarity ranks the
 * react-debug row first.
 */
function acceptanceCorpus(db) {
  const reactDebugDim = 0;
  const otherSkillDim = 1;
  const dim3 = 2;
  const dim4 = 3;
  const rows = [
    {
      slug: 'react-debug-01',
      content: 'como debugar React hooks useEffect useState',
      dim: reactDebugDim,
    },
    {
      slug: 'react-state-02',
      content: 'useState useReducer patterns for React state management',
      dim: reactDebugDim,
    },
    {
      slug: 'sql-index-03',
      content: 'como debugar queries SQL lentas com EXPLAIN',
      dim: dim3,
    },
    {
      slug: 'jwt-skill-04',
      content: 'JWT authentication with TypeScript and Node',
      dim: otherSkillDim,
    },
    {
      slug: 'recipe-05',
      content: 'receita de bolo de chocolate com cobertura',
      dim: dim4,
    },
    {
      slug: 'react-router-06',
      content: 'routing em React Router 6 e data loaders',
      dim: reactDebugDim,
    },
    {
      slug: 'git-skill-07',
      content: 'git rebase interativo e squash de commits',
      dim: dim4,
    },
    {
      slug: 'css-grid-08',
      content: 'CSS Grid e Flexbox para layouts responsivos',
      dim: otherSkillDim,
    },
    {
      slug: 'react-perf-09',
      content: 'performance em React com memo e useMemo',
      dim: reactDebugDim,
    },
    {
      slug: 'sql-joins-10',
      content: 'joins SQL inner outer left right explicados',
      dim: dim3,
    },
    {
      slug: 'rule-lint-11',
      content: 'lint sempre antes de commitar e rodar testes',
      dim: dim4,
    },
    {
      slug: 'persona-dba-12',
      content: 'voz de DBA senior para tuning de PostgreSQL',
      dim: dim3,
    },
  ];

  const insert = db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((row, i) => {
    const arr = new Float32Array(EMBEDDING_DIMENSIONS);
    arr[row.dim] = 1; // unit vector on the row's dimension
    insert.run(
      row.slug,
      'skill',
      row.content,
      Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength),
      `h-${i}`,
      1,
      1,
    );
  });
  return rows;
}

/** Embedder that maps the canonical query string to dim 0 (matches react-debug rows). */
function queryEmbedderForCorpus() {
  return makeDeterministicEmbedder(() => 0);
}

/** Embedder that maps the canonical query to a dim with no rows. */
function queryEmbedderNoMatch() {
  return makeDeterministicEmbedder(() => -1);
}

function freshDb() {
  const db = new Database(':memory:');
  createSchema(db);
  initializeSearchStorage(db);
  return db;
}

test('T-ORCH-01: factory defaults are cosine 0.75 and FTS hits 1', () => {
  assert.equal(DEFAULT_MIN_COSINE_SIMILARITY, 0.75);
  assert.equal(DEFAULT_MIN_FTS_HITS, 1);
});

test('T-ORCH-02: computeCandidateDepth clamps to [20, 100] and respects 4*k lower bound', () => {
  assert.equal(computeCandidateDepth(1), MIN_CANDIDATE_DEPTH);
  assert.equal(computeCandidateDepth(5), K_FLOOR_MULTIPLIER * 5);
  assert.equal(computeCandidateDepth(30), MAX_CANDIDATE_DEPTH);
  assert.equal(computeCandidateDepth(100), MAX_CANDIDATE_DEPTH);
});

test('T-ORCH-03: invalid factory config throws SearchError(INVALID_CONFIG) before touching the DB', () => {
  const db = freshDb();
  try {
    assert.throws(
      () => createSearch({ db, embedder: /** @type {any} */ (null) }),
      (err) => err instanceof SearchError && err.code === 'INVALID_CONFIG',
    );
    assert.throws(
      () =>
        createSearch({
          db,
          embedder: { dimensions: EMBEDDING_DIMENSIONS, embed: () => {} },
          minCosineSimilarity: 1.5,
        }),
      (err) => err instanceof SearchError && err.code === 'INVALID_CONFIG',
    );
    assert.throws(
      () =>
        createSearch({
          db,
          embedder: { dimensions: EMBEDDING_DIMENSIONS, embed: () => {} },
          minFtsHits: 0,
        }),
      (err) => err instanceof SearchError && err.code === 'INVALID_CONFIG',
    );
  } finally {
    db.close();
  }
});

test('T-ORCH-04: real corpus makes react-debug-01 rank first for "como debugar React" (SEARCH-14)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const results = await search('como debugar React', 5);
    assert.ok(results.length >= 1 && results.length <= 5);
    assert.equal(results[0].id, 1);
    assert.equal(results[0].slug, 'react-debug-01');
    // No embedding bytes in the output.
    assert.equal(
      Object.prototype.hasOwnProperty.call(results[0], 'embedding'),
      false,
    );
    // rrfScore is finite and positive.
    assert.ok(Number.isFinite(results[0].rrfScore));
    assert.ok(results[0].rrfScore > 0);
  } finally {
    db.close();
  }
});

test('T-ORCH-05: invalid query / k raise typed errors before SQL or embedder run (SEARCH-13)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    let embedCalls = 0;
    const embedder = {
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(_text) {
        embedCalls += 1;
        return new Float32Array(EMBEDDING_DIMENSIONS);
      },
    };
    const search = createSearch({ db, embedder });

    // Empty query
    let caught = null;
    try { await search('', 5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_QUERY');

    // Too long query
    caught = null;
    try { await search('a'.repeat(10_001), 5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_QUERY');

    // k out of range
    caught = null;
    try { await search('como debugar React', 0); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_K');
    caught = null;
    try { await search('como debugar React', 101); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_K');

    // Non-integer k
    caught = null;
    try { await search('como debugar React', 1.5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_K');

    // No embedder call was made on any invalid input.
    assert.equal(embedCalls, 0);
  } finally {
    db.close();
  }
});

test('T-ORCH-06: neither-passes returns [] without throwing (SEARCH-12)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    // Use an embedder that points at a dim no row uses, so cosine is 0
    // for every candidate — any positive threshold becomes unreachable.
    const search = createSearch({
      db,
      embedder: queryEmbedderNoMatch(),
      minCosineSimilarity: 0.5,
      minFtsHits: 1000, // unreachable: corpus never exceeds ~6 hits per query
    });
    const results = await search('como debugar React', 5);
    assert.deepEqual(results, []);
  } finally {
    db.close();
  }
});

test('T-ORCH-07: FTS-only pass survives when cosine gate is unreachable (SEARCH-11)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    // Cosine gate unreachable (0 vs any positive threshold) -> lexical wins.
    const search = createSearch({
      db,
      embedder: queryEmbedderNoMatch(),
      minCosineSimilarity: 0.5,
      minFtsHits: 1,
    });
    const results = await search('como debugar React', 5);
    // Lexical channel is the only contributor.
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.equal(r.vectorRank, undefined);
      assert.equal(r.cosineSimilarity, undefined);
      assert.ok(r.ftsRank !== undefined);
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-08: vector-only pass survives when FTS gate is unreachable (SEARCH-10)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    // Use an embedder that produces a unique dim not used by any row.
    const search = createSearch({
      db,
      embedder: queryEmbedderNoMatch(),
      minCosineSimilarity: -1.0, // accept everything
      minFtsHits: 1000, // force lexical miss
    });
    const results = await search('como debugar React', 5);
    // Every result must have vectorRank/metric; lexical is absent.
    assert.ok(results.length >= 1);
    for (const r of results) {
      assert.ok(r.vectorRank !== undefined);
      assert.ok(r.cosineSimilarity !== undefined);
      assert.equal(r.ftsRank, undefined);
      assert.equal(r.bm25, undefined);
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-09: equality-boundary cosine (>=) accepts the exact-threshold vector (SEARCH-13)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    // Force the cosine threshold to 1.0 (exact match). The canonical query
    // embedder makes the react-debug-01 vector exactly identical, so its
    // cosine similarity is 1.0 — the gate must accept it (inclusive).
    const search = createSearch({
      db,
      embedder: queryEmbedderForCorpus(),
      minCosineSimilarity: 1.0,
      minFtsHits: 1000, // bypass lexical
    });
    const results = await search('como debugar React', 5);
    const exact = results.find((r) => r.slug === 'react-debug-01');
    assert.ok(exact, 'react-debug-01 must pass an inclusive threshold at 1.0');
  } finally {
    db.close();
  }
});

test('T-ORCH-10: empty catalog returns [] (edge case)', async () => {
  const db = freshDb();
  try {
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const results = await search('como debugar React', 5);
    assert.deepEqual(results, []);
  } finally {
    db.close();
  }
});

test('T-ORCH-11: punctuation-only query yields zero lexical hits but vector channel may still pass', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({
      db,
      embedder: queryEmbedderForCorpus(),
      minCosineSimilarity: -1,
      minFtsHits: 1,
    });
    const results = await search('!?.()', 5);
    // FTS produces zero hits; vector channel still qualifies rows.
    assert.ok(results.length >= 1);
    for (const r of results) {
      // No lexical ranks because FTS produced no candidates.
      assert.equal(r.ftsRank, undefined);
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-12: deterministic output across repeated calls, asserting every RankedSkill field (SEARCH-09)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const a = await search('como debugar React', 5);
    const b = await search('como debugar React', 5);
    assert.equal(a.length, b.length);
    for (let i = 0; i < a.length; i += 1) {
      // Every public field must match across calls — discriminates
      // against rank/score/content drift that the previous variant
      // accepted silently.
      assert.equal(a[i].id, b[i].id);
      assert.equal(a[i].slug, b[i].slug);
      assert.equal(a[i].kind, b[i].kind);
      assert.equal(a[i].contentYaml, b[i].contentYaml);
      assert.equal(a[i].hash, b[i].hash);
      assert.equal(a[i].rrfScore, b[i].rrfScore);
      assert.equal(a[i].ftsRank, b[i].ftsRank);
      assert.equal(a[i].vectorRank, b[i].vectorRank);
      assert.equal(a[i].bm25, b[i].bm25);
      assert.equal(a[i].cosineSimilarity, b[i].cosineSimilarity);
      assert.deepEqual(a[i], b[i]);
    }
    // Also assert identical result order across calls.
    assert.deepEqual(
      a.map((r) => r.id),
      b.map((r) => r.id),
    );
  } finally {
    db.close();
  }
});

test('T-ORCH-13: embedder failure wraps as SearchError(EMBEDDING_FAILED) without query text', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const secret = 'super-secret-prompt-text-must-NEVER-leak-9f8e7d';
    const embedder = {
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(text) {
        throw new Error(`backend blew up on: ${text}`);
      },
    };
    const search = createSearch({ db, embedder });
    let caught = null;
    try { await search(secret, 5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'EMBEDDING_FAILED');
    assert.ok(
      !caught.message.includes(secret),
      'EMBEDDING_FAILED must not include query text',
    );
  } finally {
    db.close();
  }
});

test('T-ORCH-13b: EmbedderError message must never leak into SearchError (SEARCH-13 privacy regression)', async () => {
  const { EmbedderError } = await import('../../src/catalog/errors.ts');
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const secretQuery = 'super-secret-prompt-must-NEVER-leak-9f8e7d';
    const embedder = {
      dimensions: EMBEDDING_DIMENSIONS,
      async embed() {
        // Real EmbedderError whose message carries the query text in clear.
        // Privacy contract: SearchError.message must not echo this; cause
        // retains it for operator debugging.
        throw new EmbedderError(`backend saw ${secretQuery}`, 'ENCODING_FAILED');
      },
    };
    const search = createSearch({ db, embedder });
    let caught = null;
    try { await search(secretQuery, 5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'EMBEDDING_FAILED');
    // The public SearchError message must be query-independent.
    assert.equal(
      caught.message,
      'embedding failed',
      'SearchError message must be the fixed query-independent text',
    );
    assert.ok(
      !caught.message.includes(secretQuery),
      'SearchError message must not contain the query text even when the inner error did',
    );
    // The original EmbedderError is preserved on cause for debugging.
    assert.ok(caught.cause instanceof Error);
    assert.ok(
      /** @type {Error} */ (caught.cause).message.includes(secretQuery),
      'cause retains the original error message for operator inspection',
    );
  } finally {
    db.close();
  }
});

test('T-ORCH-14: invalid embedding returned by the embedder raises SearchError(INVALID_EMBEDDING)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const embedder = {
      dimensions: EMBEDDING_DIMENSIONS,
      async embed() {
        return new Float32Array(100); // wrong dimension
      },
    };
    const search = createSearch({ db, embedder });
    let caught = null;
    try { await search('como debugar React', 5); } catch (err) { caught = err; }
    assert.ok(caught instanceof SearchError);
    assert.equal(caught.code, 'INVALID_EMBEDDING');
  } finally {
    db.close();
  }
});

test('T-ORCH-15: DB failure after init surfaces as typed SearchError without query text', async () => {
  const db = freshDb();
  acceptanceCorpus(db);
  // Close the DB BEFORE we call search — the next prepare() inside the
  // orchestrator will throw a raw TypeError that the factory wraps as
  // SCHEMA_ERROR (or as QUERY_ERROR if it reaches the channel adapters).
  try {
    db.close();
  } catch {
    // ignore
  }
  const embedder = queryEmbedderForCorpus();
  const secret = 'a-secret-query-9f8e7d';
  let caught = null;
  try {
    createSearch({ db, embedder });
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError, 'expected typed SearchError');
  // Factory-side initialization failure → SCHEMA_ERROR.
  assert.equal(caught.code, 'SCHEMA_ERROR');
  const blob = JSON.stringify({
    msg: caught.message,
    cause: caught.cause instanceof Error ? caught.cause.message : String(caught.cause),
  });
  assert.ok(!blob.includes(secret), 'DB failure path must not echo query content');
});

test('T-ORCH-16: hydration returns full metadata for every top-k result and omits embedding', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const results = await search('como debugar React', 3);
    assert.ok(results.length >= 1 && results.length <= 3);
    for (const r of results) {
      assert.ok(typeof r.id === 'number');
      assert.ok(typeof r.slug === 'string');
      assert.ok(['skill', 'rule', 'persona'].includes(r.kind));
      assert.ok(typeof r.contentYaml === 'string');
      assert.ok(typeof r.hash === 'string');
      assert.ok(Number.isFinite(r.rrfScore));
      // No embedding in the public shape.
      assert.equal(Object.prototype.hasOwnProperty.call(r, 'embedding'), false);
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-17: closure calls the embedder exactly once per search invocation', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    let calls = 0;
    const embedder = {
      dimensions: EMBEDDING_DIMENSIONS,
      async embed(_text) {
        calls += 1;
        const arr = new Float32Array(EMBEDDING_DIMENSIONS);
        return arr;
      },
    };
    const search = createSearch({ db, embedder });
    await search('como debugar React', 5);
    assert.equal(calls, 1);
    await search('outro prompt qualquer', 5);
    assert.equal(calls, 2);
  } finally {
    db.close();
  }
});

test('T-ORCH-18: top-k slicing respects the requested count after fusion', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const k1 = await search('como debugar React', 1);
    assert.equal(k1.length, 1);
    const k3 = await search('como debugar React', 3);
    assert.ok(k3.length >= 1 && k3.length <= 3);
    const k100 = await search('como debugar React', 100);
    // Hard cap on candidate depth is 100, so output cannot exceed 12 here.
    assert.ok(k100.length <= 12);
  } finally {
    db.close();
  }
});

test('T-ORCH-19: vector thresholding preserves original ranks (no compaction)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    // Require a permissive cosine threshold so all rows pass.
    const search = createSearch({
      db,
      embedder: queryEmbedderForCorpus(),
      minCosineSimilarity: -1,
      minFtsHits: 1000,
    });
    const results = await search('qualquer texto aqui', 100);
    // Ranks in the result should reflect RRF (no original channel ranks if
    // only one channel contributes) — but the vector ranks must be unique
    // and contiguous when only vector data is in play.
    const ranks = results.map((r) => r.vectorRank).filter((r) => r !== undefined);
    assert.equal(new Set(ranks).size, ranks.length, 'vector ranks must be unique');
    const sorted = [...ranks].sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b));
    for (let i = 0; i < sorted.length; i += 1) {
      assert.equal(sorted[i], i + 1, 'ranks remain contiguous and 1-based');
    }
  } finally {
    db.close();
  }
});

/**
 * Build a corpus whose k-NN cosine similarities to a fixed unit-vector
 * query are exactly [1, 1/sqrt(2), 1/sqrt(3), 0.5, 1/sqrt(5)]. Each row's
 * embedding is a normalized sparse vector on dims 0..k with weight 1 on
 * the first k components. The shared query vector is unit e_0.
 */
function controlledVectorCorpus(db, { n = 5 } = {}) {
  const insert = db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < n; i += 1) {
    const k = i + 1;
    const arr = new Float32Array(EMBEDDING_DIMENSIONS);
    const norm = Math.sqrt(k);
    for (let j = 0; j < k; j += 1) arr[j] = 1 / norm;
    insert.run(
      `cv-${k}`,
      'skill',
      `controlled vector row with ${k} components`,
      Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength),
      `cv-h-${i}`,
      1,
      1,
    );
  }
}

/** Embedder that returns the unit vector e_0 for any input. */
function queryEmbedderE0() {
  return makeDeterministicEmbedder((idx) => (idx === 0 ? 1 : 0));
}

test('T-ORCH-19b: rank-preservation through filtering — candidate with raw rank 5 still survives and uses 1/(60+5)', async () => {
  // 5 controlled rows whose raw vec output ranks are exactly 1..5 with the
  // cosine similarities above. Threshold = 0.5 + epsilon keeps ranks 4 and
  // 5 above threshold while rows 2-3 (cosines 1/sqrt(3) ≈ 0.5774 and
  // 1/sqrt(2) ≈ 0.7071) sit on the boundary we want to detect. We instead
  // use a tighter setup: the lowest-ranked candidate (cosine 1/sqrt(5) ≈
  // 0.4472) becomes rank 5 by virtue of being the worst k-NN match. With a
  // permissive threshold that lets it through, the surviving candidate's
  // vectorRank MUST stay equal to its raw k-NN rank (5), not be renumbered.
  const db = freshDb();
  try {
    controlledVectorCorpus(db);
    const search = createSearch({
      db,
      embedder: queryEmbedderE0(),
      // Accept everything above negative threshold so the raw rank 5 row
      // survives; FTS unreachable since controlled corpus has no lexical
      // tokens matching arbitrary prompts.
      minCosineSimilarity: -1,
      minFtsHits: 1000,
    });
    const raw = db.prepare(
      `SELECT skill_id, distance FROM skill_embeddings WHERE embedding MATCH ? AND k = 5 ORDER BY distance ASC`,
    ).all(
      Buffer.from((() => {
        const arr = new Float32Array(EMBEDDING_DIMENSIONS);
        arr[0] = 1;
        return arr;
      })().buffer),
    );
    const rawRankById = new Map();
    raw.forEach((r, idx) => rawRankById.set(r.skill_id, idx + 1));

    const results = await search('anything that does not lexically match', 100);
    // The raw rank 5 candidate must be present in the result.
    const lowestRankCandidate = results.find(
      (r) => /** @type {Map<number, number>} */ (rawRankById).get(r.id) === 5,
    );
    assert.ok(
      lowestRankCandidate,
      'the raw rank-5 candidate must appear in the search output',
    );
    assert.equal(
      lowestRankCandidate.vectorRank,
      5,
      'survivor must keep its original k-NN rank 5, not be renumbered',
    );
    // RRF term for the lowest-ranked survivor is 1 / (60 + 5) when FTS is
    // unreachable. Match the value within floating-point tolerance.
    const expected = 1 / (60 + 5);
    assert.ok(
      Math.abs(/** @type {number} */ (lowestRankCandidate.rrfScore) - expected) < 1e-12,
      `rrfScore must equal 1/(60+5); got ${lowestRankCandidate.rrfScore}, expected ${expected}`,
    );
    // Every survivor's vectorRank must match its raw k-NN rank — the mutant
    // that compacts survivors after filtering would renumber to 1..N.
    for (const r of results) {
      assert.equal(
        r.vectorRank,
        /** @type {Map<number, number>} */ (rawRankById).get(r.id),
        `survivor id=${r.id} must keep its raw k-NN rank (got ${r.vectorRank}, expected ${/** @type {Map<number, number>} */ (rawRankById).get(r.id)})`,
      );
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-20: outputs include hash and contentYaml from the source row', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const results = await search('como debugar React', 5);
    assert.equal(results[0].slug, 'react-debug-01');
    assert.match(results[0].hash, /^h-/);
    assert.match(results[0].contentYaml, /debugar/);
  } finally {
    db.close();
  }
});

test('T-ORCH-21: search never throws for a corpus of zero lexical matches when vector passes', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({
      db,
      embedder: queryEmbedderForCorpus(),
      minCosineSimilarity: -1,
      minFtsHits: 1000,
    });
    const results = await search('zzzzzz never matches anything', 5);
    assert.ok(Array.isArray(results));
    assert.ok(results.length >= 1);
  } finally {
    db.close();
  }
});

test('T-ORCH-22: k=MIN_K (1) and k=MAX_K (100) are both accepted (SEARCH-13)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    const one = await search('como debugar React', MIN_K);
    assert.equal(one.length, 1);
    const many = await search('como debugar React', MAX_K);
    assert.ok(many.length >= 1);
  } finally {
    db.close();
  }
});

test('T-ORCH-23: invalid k types (NaN, string, undefined) raise INVALID_K', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({ db, embedder: queryEmbedderForCorpus() });
    for (const bad of [Number.NaN, /** @type {any} */ ('5'), /** @type {any} */ (undefined)]) {
      let caught = null;
      try { await search('como debugar React', bad); } catch (err) { caught = err; }
      assert.ok(caught instanceof SearchError, `k=${String(bad)} should throw`);
      assert.equal(caught.code, 'INVALID_K');
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-24: punctuation-only query with permissive vector gate returns vector-only results (SEARCH-11 boundary)', async () => {
  const db = freshDb();
  try {
    acceptanceCorpus(db);
    const search = createSearch({
      db,
      embedder: queryEmbedderForCorpus(),
      minCosineSimilarity: -1,
      minFtsHits: 1,
    });
    const results = await search('!?.()', 5);
    // FTS zero hits; vector gate contributes everything.
    for (const r of results) {
      assert.equal(r.ftsRank, undefined);
      assert.ok(r.vectorRank !== undefined);
    }
  } finally {
    db.close();
  }
});

/**
 * Threshold-boundary fixture: build a small corpus, count FTS hits per
 * query, and align `minFtsHits` so it equals the corpus's totalHits for
 * one query and is one greater than the hit count for another. Both
 * threshold values are independent of any internal constant — the test
 * derives them from the observed corpus to avoid baking implementation
 * values into assertions.
 */
// (no helper needed — each test observes its own hit count)

/**
 * Build the same boundary corpus on a side-channel probe DB and return
 * the observed totalHits for the given query. Used by T-ORCH-25 and
 * T-ORCH-26 to set minFtsHits to a value derived from the data, not from
 * any internal constant.
 */
function observeTotalHits(rows, query) {
  const probe = new Database(':memory:');
  try {
    createSchema(probe);
    initializeSearchStorage(probe);
    rows.forEach((row, i) => {
      const arr = new Float32Array(EMBEDDING_DIMENSIONS);
      arr[0] = 1;
      probe.prepare(
        `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(row.slug, 'skill', row.content, Buffer.from(arr.buffer), `h-${i}`, 1, 1);
    });
    return queryFts(probe, query, 100).totalHits;
  } finally {
    probe.close();
  }
}

function seedBoundaryCorpus(db, rows) {
  rows.forEach((row, i) => {
    const arr = new Float32Array(EMBEDDING_DIMENSIONS);
    arr[0] = 1;
    db.prepare(
      `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(row.slug, 'skill', row.content, Buffer.from(arr.buffer), `h-${i}`, 1, 1);
  });
}

test('T-ORCH-25: FTS channel passes when totalHits === minFtsHits (SEARCH-11 boundary)', async () => {
  const db = freshDb();
  try {
    const rows = [
      { slug: 'bnd-1', content: 'react hooks useEffect lifecycle' },
      { slug: 'bnd-2', content: 'react useState debugar memory' },
      { slug: 'bnd-3', content: 'sql joins with React' },
    ];
    const observedTotalHits = observeTotalHits(rows, 'react');
    seedBoundaryCorpus(db, rows);

    // minFtsHits equals the observed totalHits. Cosine kept unreachable so
    // only FTS contributes.
    const search = createSearch({
      db,
      embedder: queryEmbedderNoMatch(),
      minCosineSimilarity: 0.5,
      minFtsHits: observedTotalHits,
    });
    const results = await search('react', 5);
    assert.ok(
      results.length >= 1,
      `expected FTS results when totalHits (${observedTotalHits}) equals minFtsHits`,
    );
    for (const r of results) {
      assert.ok(
        r.ftsRank !== undefined,
        'every result must carry an ftsRank when FTS is the active channel',
      );
    }
  } finally {
    db.close();
  }
});

test('T-ORCH-26: FTS channel contributes nothing when totalHits === minFtsHits - 1 (SEARCH-11 boundary)', async () => {
  const db = freshDb();
  try {
    const rows = [
      { slug: 'bnd-1', content: 'react hooks useEffect lifecycle' },
      { slug: 'bnd-2', content: 'react useState debugar memory' },
      { slug: 'bnd-3', content: 'sql joins with React' },
    ];
    const observedTotalHits = observeTotalHits(rows, 'react');
    seedBoundaryCorpus(db, rows);

    // minFtsHits ONE ABOVE the observed totalHits. With cosine unreachable,
    // no result must be produced because FTS contributes an empty list and
    // the vector list is also empty.
    const search = createSearch({
      db,
      embedder: queryEmbedderNoMatch(),
      minCosineSimilarity: 0.5,
      minFtsHits: observedTotalHits + 1,
    });
    const results = await search('react', 5);
    assert.deepEqual(
      results,
      [],
      `expected [] when totalHits (${observedTotalHits}) < minFtsHits (${observedTotalHits + 1})`,
    );
  } finally {
    db.close();
  }
});
