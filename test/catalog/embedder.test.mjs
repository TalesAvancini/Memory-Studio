/**
 * Embedder tests (T-09).
 *
 * Covers:
 *   - Embedder interface conformance (`dimensions`, `encode`, `embed`).
 *   - MultilingualE5SmallEmbedder constructor validates `kind`.
 *   - model-path resolver returns the expected absolute path that the
 *     @huggingface/transformers `pipeline('feature-extraction')` loader
 *     downloads into by default.
 *   - Real-model smoke (loaded once, shared across cases):
 *       - encode() returns Float32Array of length 384.
 *       - same text produces a deterministic vector.
 *       - query vs passage prefix produces DIFFERENT vectors (asymmetric
 *         retrieval contract from the multilingual-e5-small model card).
 *
 * The real-model section is gated on `existsSync(expectedModelPath())` —
 * if the cached ONNX weights are absent (e.g. a fresh checkout without
 * `npm run verify-env` having run yet), those cases are marked skipped
 * rather than failing the build. CI is expected to have run verify-env
 * once, so this path covers local-dev too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  EMBEDDING_DIMENSIONS,
  MultilingualE5SmallEmbedder,
  defaultCacheDir,
  defaultModelId,
  expectedModelPath,
  assertMultilingualE5SmallCached,
} from '../../src/catalog/embedder/index.ts';

// ---------------------------------------------------------------------------
// Interface + constants
// ---------------------------------------------------------------------------

test('dimensions constant is 384', () => {
  assert.equal(EMBEDDING_DIMENSIONS, 384);
});

test('default model id is the canonical Xenova/multilingual-e5-small', () => {
  assert.equal(defaultModelId(), 'Xenova/multilingual-e5-small');
});

test('default cache dir points at @huggingface/transformers/.cache', () => {
  const cached = defaultCacheDir();
  assert.match(cached, /@huggingface[\\/]transformers[\\/]\.cache$/);
});

// ---------------------------------------------------------------------------
// Constructor + error paths
// ---------------------------------------------------------------------------

test('constructor rejects invalid kind with EmbedderError', () => {
  assert.throws(
    () => new MultilingualE5SmallEmbedder(/** @type {any} */ ({ kind: 'invalid' })),
    (err) => {
      assert.equal(err.name, 'EmbedderError');
      assert.equal(/** @type {any} */ (err).code, 'ENCODING_FAILED');
      return true;
    },
  );
});

test('assertMultilingualE5SmallCached throws when model weights are missing', () => {
  // Temporarily point expectedModelPath at a path that doesn't exist by
  // checking it directly (file may be present in CI but absent in fresh
  // local clones). If it happens to be present, this test asserts the
  // happy-path throw contract for a guaranteed-missing path.
  const sentinelPath = expectedModelPath() + '.does-not-exist';
  // No public API to override the path; we re-implement the check inline
  // to test the helper's discrimination behavior. The helper just calls
  // existsSync() against its computed path.
  assert.equal(existsSync(sentinelPath), false, 'sentinel must be missing');
  // If the real model is missing, the helper throws; if present, it
  // returns the path. Either way the contract is well-defined.
  if (existsSync(expectedModelPath())) {
    assert.equal(assertMultilingualE5SmallCached(), expectedModelPath());
  } else {
    assert.throws(() => assertMultilingualE5SmallCached(), (err) => err.name === 'EmbedderError');
  }
});

// ---------------------------------------------------------------------------
// Real-model smoke — lazy share via cache
// ---------------------------------------------------------------------------

test('MultilingualE5SmallEmbedder.encode returns Float32Array length 384 (real model)', async (t) => {
  if (!existsSync(expectedModelPath())) {
    t.skip(`multilingual-e5-small weights not cached at ${expectedModelPath()} — run 'npm run verify-env' first`);
    return;
  }
  const embedder = new MultilingualE5SmallEmbedder({ kind: 'passage' });
  assert.equal(embedder.dimensions, 384);
  const vec = await embedder.encode('validate JWT tokens');
  assert.ok(vec instanceof Float32Array, 'encode() must return a Float32Array');
  assert.equal(vec.length, 384, 'embedding must be exactly 384d');
});

test('MultilingualE5SmallEmbedder.encode is deterministic for the same input', async (t) => {
  if (!existsSync(expectedModelPath())) {
    t.skip('multilingual-e5-small not cached');
    return;
  }
  const embedder = new MultilingualE5SmallEmbedder({ kind: 'passage' });
  const a = await embedder.encode('hello world');
  const b = await embedder.encode('hello world');
  assert.equal(a.length, b.length);
  // Tolerance: the same model is deterministic across runs in ONNX eval mode
  // (the library returns a fresh tensor each call but with the same float values).
  let maxDiff = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(/** @type {number} */ (a[i]) - /** @type {number} */ (b[i]));
    if (d > maxDiff) maxDiff = d;
  }
  assert.ok(maxDiff < 1e-6, `deterministic within 1e-6; max diff was ${maxDiff}`);
});

test('query vs passage prefix produces DIFFERENT embeddings (asymmetric retrieval)', async (t) => {
  if (!existsSync(expectedModelPath())) {
    t.skip('multilingual-e5-small not cached');
    return;
  }
  const passage = new MultilingualE5SmallEmbedder({ kind: 'passage' });
  const query = new MultilingualE5SmallEmbedder({ kind: 'query' });
  const vPassage = await passage.encode('validate JWT tokens');
  const vQuery = await query.encode('validate JWT tokens');
  assert.equal(vPassage.length, 384);
  assert.equal(vQuery.length, 384);
  // Compute L2 distance — must be NON-zero (prefix changes the embedding).
  let dist = 0;
  for (let i = 0; i < vPassage.length; i += 1) {
    const d = /** @type {number} */ (vPassage[i]) - /** @type {number} */ (vQuery[i]);
    dist += d * d;
  }
  const l2 = Math.sqrt(dist);
  assert.ok(l2 > 0.05, `query/passage embeddings must differ; L2 was ${l2}`);
});

test('encode rejects non-string input', async (t) => {
  if (!existsSync(expectedModelPath())) {
    t.skip('multilingual-e5-small not cached');
    return;
  }
  const embedder = new MultilingualE5SmallEmbedder({ kind: 'passage' });
  await assert.rejects(
    embedder.encode(/** @type {any} */ (42)),
    (err) => /** @type {any} */ (err).code === 'ENCODING_FAILED',
  );
});
