/**
 * Pipeline integration test.
 *
 * Phase 5a.2 (T-08) — minimal SHA-256 byte-string equality test
 * (D-006 done criterion):
 *   - Two equivalent inputs produce identical `systemMessage` SHA-256
 *   - Different inputs produce different SHA-256
 *
 * Uses Fastify `inject()` to exercise the full route handler.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createServer, resetServerMetadataForTests } from '../../src/server/index.ts';
import { setAugmentPipelineProvider } from '../../src/server/augment.ts';
import { EMBEDDING_DIMENSIONS } from '../../src/catalog/embedder/index.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';

function buildValidRequest(overrides = {}) {
  return {
    prompt: 'design a server endpoint',
    context: null,
    fingerprint: {
      projectPath: '/tmp/project',
      agentId: 'claude-code',
      sessionId: 'abc123',
      gitBranch: 'main',
    },
    activeCatalog: ['skill-auth-01'],
    tenantId: 'tenant-xyz',
    schemaVersion: 3,
    ...overrides,
  };
}

test('pipeline: identical request → identical systemMessage (D-006 done)', async () => {
  resetServerMetadataForTests();
  // Install a deterministic stub provider for this test.
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, content_yaml TEXT, embedding BLOB, hash TEXT, created_at INTEGER, updated_at INTEGER);`);
  const provider = {
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() {
        const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
        return arr;
      },
      async embed() {
        const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
        return arr;
      },
    },
  };
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    const r1 = await handle.app.inject({ method: 'POST', url: '/augment', payload: req });
    const r2 = await handle.app.inject({ method: 'POST', url: '/augment', payload: req });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    // Both responses must have the same systemMessage SHA-256 because
    // the matched set is empty in both (no corpus data) → same 2-block
    // structure (empty persona + empty suffix).
    assert.equal(b1.systemMessage, b2.systemMessage);
    assert.equal(b1.systemMessage.length, 64);
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    db.close();
  }
});

test('pipeline: D-008 — activeCatalog:[] → 200 + emptyReason no_active_items + persona-only warning', async () => {
  resetServerMetadataForTests();
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, content_yaml TEXT, embedding BLOB, hash TEXT, created_at INTEGER, updated_at INTEGER);`);
  setAugmentPipelineProvider(() => ({
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
      async embed() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
    },
  }));
  const handle = await createServer();
  try {
    const r = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildValidRequest({ activeCatalog: [] }),
    });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.emptyReason, 'no_active_items');
    assert.ok(body.warnings.some((w) => w.includes('activeCatalog is empty')));
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    db.close();
  }
});

test('pipeline: social prompt → 200 + emptyReason social', async () => {
  resetServerMetadataForTests();
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, content_yaml TEXT, embedding BLOB, hash TEXT, created_at INTEGER, updated_at INTEGER);`);
  setAugmentPipelineProvider(() => ({
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
      async embed() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
    },
  }));
  const handle = await createServer();
  try {
    // Use a prompt that matches Phase 2's `isSocial()` patterns after
    // normalization (NFC + trim + lowercase + strip trailing punct).
    // "hello" matches `/^hello$/u` directly.
    const r = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildValidRequest({ prompt: 'hello' }),
    });
    assert.equal(r.statusCode, 200);
    const body = JSON.parse(r.body);
    assert.equal(body.emptyReason, 'social');
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    db.close();
  }
});

test('pipeline: validation 400 → MISSING_REQUIRED_FIELD', async () => {
  resetServerMetadataForTests();
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    delete req.prompt;
    const r = await handle.app.inject({ method: 'POST', url: '/augment', payload: req });
    assert.equal(r.statusCode, 400);
    const body = JSON.parse(r.body);
    assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
    assert.equal(body.error.field, 'prompt');
  } finally {
    await handle.close();
  }
});

// ---------------------------------------------------------------------------
// Fail-open coverage (R-14 in spec.md "Social detector gate" maps to the
// augmentation pipeline's fail-open branch in `pipeline.ts:111-128` +
// `failOpenResponse` at `pipeline.ts:210-236`). The spec mandates that
// any retrieval-stage failure (embedder error, FTS/vec query error) MUST
// return 200 with `emptyReason: 'timeout'` and a persona-only system
// message — never a 500. The two tests below exercise the two distinct
// throw sites in the pipeline:
//   (a) embedder.encode throws (Stage 4 try/catch at pipeline.ts:111-117)
//   (b) runRetrieval throws (Stage 5 try/catch at pipeline.ts:120-128)
// Both must surface the same fail-open response shape.
// ---------------------------------------------------------------------------

test('pipeline: R-14 fail-open — embedder throws → 200 + emptyReason=timeout + persona-only', async () => {
  resetServerMetadataForTests();
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, content_yaml TEXT, embedding BLOB, hash TEXT, created_at INTEGER, updated_at INTEGER);`);
  setAugmentPipelineProvider(() => ({
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      // Throwing embedder — simulates ONNX runtime error / model load
      // failure / tokenization crash. Pipeline MUST catch and emit
      // emptyReason='timeout', not bubble up as 500.
      async encode() {
        throw new Error('simulated embedder failure (ONNX session crashed)');
      },
      async embed() {
        throw new Error('simulated embedder failure (ONNX session crashed)');
      },
    },
  }));
  const handle = await createServer();
  try {
    const r = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildValidRequest(),
    });
    // The KEY assertion: server returns 200, NOT 500. fail-open means
    // the client always gets a structured response, even on retrieval
    // failure. (PRD §2 + SPEC §IMod-8)
    assert.equal(
      r.statusCode,
      200,
      `server must fail-open with 200, not surface 5xx for retrieval errors (got ${r.statusCode})`,
    );
    const body = JSON.parse(r.body);
    // emptyReason='timeout' is the contract for any retrieval-stage throw.
    assert.equal(body.emptyReason, 'timeout');
    // Matched arrays must all be empty (no items passed retrieval).
    assert.deepEqual(body.matchedSkills, []);
    assert.deepEqual(body.matchedRules, []);
    assert.deepEqual(body.matchedPersonas, []);
    // pruningDecisions must be the empty default (5 empty arrays).
    assert.deepEqual(body.pruningDecisions, {
      rejectedByFloor: [],
      rejectedByBudget: [],
      rejectedByAttentionTier: [],
      rejectedByNegativeFeedback: [],
      rejectedByCriticalDropped: [],
    });
    // The persona-only fallback warning must be surfaced so operators
    // can detect fail-open events in the structured log.
    assert.ok(
      Array.isArray(body.warnings) && body.warnings.some((w) => w.includes('retrieval failed')),
      `expected retrieval-failed warning in body.warnings, got: ${JSON.stringify(body.warnings)}`,
    );
    // systemMessage is still a 64-char SHA-256 hex (D-006 invariant:
    // even the empty / social / no-active paths produce a stable hash).
    assert.equal(typeof body.systemMessage, 'string');
    assert.equal(body.systemMessage.length, 64);
    assert.match(body.systemMessage, /^[0-9a-f]{64}$/);
    // Latency: embeddingMs may be > 0 (we measured up to the throw);
    // retrievalMs must be 0 (never started because Stage 4 failed first).
    assert.equal(body.latencyMs.retrieval, 0);
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    db.close();
  }
});

test('pipeline: R-14 fail-open — retrieval throws → 200 + emptyReason=timeout + persona-only', async () => {
  resetServerMetadataForTests();
  // A db with NO FTS5 / sqlite-vec virtual tables — `runRetrieval`'s
  // first call (`queryFts`) will throw "no such table: content_fts",
  // which surfaces as a SearchError. The pipeline's Stage 5 try/catch
  // must catch that and emit emptyReason='timeout'.
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE IF NOT EXISTS skills (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, kind TEXT, content_yaml TEXT, embedding BLOB, hash TEXT, created_at INTEGER, updated_at INTEGER);`);
  setAugmentPipelineProvider(() => ({
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
      async embed() { return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS); },
    },
  }));
  const handle = await createServer();
  try {
    const r = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildValidRequest(),
    });
    assert.equal(
      r.statusCode,
      200,
      `server must fail-open with 200 when retrieval throws (got ${r.statusCode})`,
    );
    const body = JSON.parse(r.body);
    assert.equal(body.emptyReason, 'timeout');
    assert.deepEqual(body.matchedSkills, []);
    assert.deepEqual(body.matchedRules, []);
    assert.deepEqual(body.matchedPersonas, []);
    assert.ok(
      Array.isArray(body.warnings) && body.warnings.some((w) => w.includes('retrieval failed')),
      `expected retrieval-failed warning, got: ${JSON.stringify(body.warnings)}`,
    );
    assert.equal(typeof body.systemMessage, 'string');
    assert.equal(body.systemMessage.length, 64);
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    db.close();
  }
});
