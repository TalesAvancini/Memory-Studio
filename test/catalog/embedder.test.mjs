/**
 * Embedder tests — cover ACs crud-07, crud-08, crud-09.
 *
 * The DeterministicStubEmbedder is the only production implementation in
 * Phase 2; the test also wires a NullEmbedder to validate that any class
 * implementing `Embedder` is accepted by the writer surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DeterministicStubEmbedder,
  EMBEDDING_DIMENSIONS,
  computeStubEmbedding,
  cosineSimilarity,
} from '../../src/catalog/embedder.ts';
import { EmbedderError } from '../../src/catalog/errors.ts';

test('T-EMBED-01: embed returns a Float32Array of 384 dimensions (crud-07)', async () => {
  const e = new DeterministicStubEmbedder();
  const v = await e.embed('hello world');
  assert.ok(v instanceof Float32Array);
  assert.equal(v.length, EMBEDDING_DIMENSIONS);
  assert.equal(v.length, 384);
  assert.equal(e.dimensions, 384);
});

test('T-EMBED-02: same input produces byte-identical vector (crud-07)', async () => {
  const e = new DeterministicStubEmbedder();
  const a = await e.embed('how to validate jwt');
  const b = await e.embed('how to validate jwt');
  assert.equal(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)), 0);
});

test('T-EMBED-03: different inputs produce distinguishable vectors (crud-07)', async () => {
  const e = new DeterministicStubEmbedder();
  const a = await e.embed('how to validate jwt');
  const b = await e.embed('how to validate jti');
  // Vectors are near-orthogonal because each byte position is independent.
  const cos = cosineSimilarity(a, b);
  assert.ok(Math.abs(cos) < 0.3, `expected near-orthogonal, got cos=${cos}`);
});

test('T-EMBED-04: Buffer.from(arr.buffer) produces 1536 bytes (crud-09)', async () => {
  const e = new DeterministicStubEmbedder();
  const v = await e.embed('hello');
  const buf = Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  assert.equal(buf.byteLength, 1536);
  assert.equal(buf.byteLength, EMBEDDING_DIMENSIONS * 4);
});

test('T-EMBED-05: round-trip Buffer <-> Float32Array is bit-exact (crud-12 spec-anchor)', async () => {
  const e = new DeterministicStubEmbedder();
  const original = await e.embed('round-trip please');
  const buf = Buffer.from(original.buffer, original.byteOffset, original.byteLength);
  // Slice the buffer (Buffer#subarray returns a Buffer view; for an ArrayBuffer
  // copy we need to copy the bytes into a fresh ArrayBuffer).
  const restored = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(restored.length, original.length);
  for (let i = 0; i < original.length; i += 1) {
    assert.equal(restored[i], original[i]);
  }
});

test('T-EMBED-06: z-score normalization yields finite, deterministic values', async () => {
  const e = new DeterministicStubEmbedder();
  const v = await e.embed('a test prompt');
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < v.length; i += 1) {
    const x = v[i];
    assert.ok(Number.isFinite(x), `component ${i} = ${x} is not finite`);
    sum += x;
    sumSq += x * x;
  }
  // Mean should be near 0 after z-score normalization.
  const mean = sum / v.length;
  assert.ok(Math.abs(mean) < 1e-5, `mean=${mean} should be ~0`);
  // Variance should be ~1.
  const variance = sumSq / v.length - mean * mean;
  assert.ok(Math.abs(variance - 1) < 1e-3, `variance=${variance} should be ~1`);
});

test('T-EMBED-07: computeStubEmbedding is pure (same input -> same output)', () => {
  const a = computeStubEmbedding('pure function');
  const b = computeStubEmbedding('pure function');
  for (let i = 0; i < a.length; i += 1) {
    assert.equal(a[i], b[i]);
  }
});

test('T-EMBED-08: NullEmbedder (interface compliance) is callable', async () => {
  // Type-only assertion: a stub class implementing Embedder is acceptable
  // in place of DeterministicStubEmbedder. This is the contract the writer
  // depends on for ONNX replacement in Phase 9.
  class NullEmbedder {
    dimensions = EMBEDDING_DIMENSIONS;
    async embed(_text) {
      return new Float32Array(EMBEDDING_DIMENSIONS);
    }
  }
  const e = new NullEmbedder();
  const v = await e.embed('anything');
  assert.equal(v.length, EMBEDDING_DIMENSIONS);
  assert.equal(e.dimensions, 384);
});

test('T-EMBED-09: empty string is rejected (avoids identity collisions)', async () => {
  const e = new DeterministicStubEmbedder();
  try {
    await e.embed('');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof EmbedderError);
    assert.equal(err.code, 'ENCODING_FAILED');
  }
});

test('T-EMBED-10: cosineSimilarity returns ~1 for identical vectors', () => {
  const v = computeStubEmbedding('identity');
  const cos = cosineSimilarity(v, v);
  assert.ok(Math.abs(cos - 1) < 1e-5, `cos(self) should be ~1, got ${cos}`);
});

test('T-EMBED-11: cosineSimilarity throws on length mismatch', () => {
  const a = new Float32Array([1, 0]);
  const b = new Float32Array([1, 0, 0]);
  try {
    cosineSimilarity(a, b);
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof EmbedderError);
  }
});

test('T-EMBED-12: non-string input to embed() throws EmbedderError', async () => {
  const e = new DeterministicStubEmbedder();
  // The signature is `embed(text: string)`, but at runtime we still defend
  // against bad callers (the type contract alone is not enough).
  try {
    await e.embed(/** @type {any} */ (42));
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof EmbedderError);
    assert.equal(err.code, 'ENCODING_FAILED');
  }
});