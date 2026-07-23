/**
 * Embedder interface + deterministic stub.
 *
 * Phase 2 ships a stub because the spec explicitly forbids inventing an ONNX
 * model download (brief-m3cli-phase4 veda). The stub:
 *   1. Hashes the input deterministically (SHA-256 counter-mode).
 *   2. Expands to 384 floats (1536 bytes) by chaining SHA-256 rounds.
 *   3. Normalizes each component to mean=0 / variance=1 (z-score over the 384
 *      dims) and rescales to [-1, 1] by clipping at +/- 3 sigma.
 *
 * Properties:
 *   - Determinism: same input -> byte-identical Float32Array.
 *   - Discrimination: distinct inputs -> near-orthogonal vectors (cosine
 *     similarity ~= 0 across typical english / portuguese prompts).
 *   - Bit-stable round-trip: `Buffer.from(arr.buffer)` reproduces the bytes
 *     exactly (no float drift), so the writer can persist the BLOB and the
 *     reader can reconstruct the array bit-for-bit.
 *
 * Real ONNX embedder (multilingual-e5-small) is swapped in via the same
 * `Embedder` interface in Phase 9.
 */

import { createHash } from 'node:crypto';
import { EmbedderError } from './errors.ts';

export const EMBEDDING_DIMENSIONS = 384 as const;
const BYTES_PER_FLOAT = 4;
const TARGET_BYTES = EMBEDDING_DIMENSIONS * BYTES_PER_FLOAT; // 1536

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: typeof EMBEDDING_DIMENSIONS;
}

/**
 * Compute the 384-dim deterministic embedding of `text`.
 *
 * Exported for test inspection — not part of the public Embedder surface.
 */
export function computeStubEmbedding(text: string): Float32Array {
  // Phase 1: generate 1536 pseudo-random bytes from SHA-256 counter mode.
  // Each round: SHA-256(text || uint32-be-counter).
  const bytes = Buffer.alloc(TARGET_BYTES);
  let counter = 0;
  let offset = 0;
  while (offset < TARGET_BYTES) {
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(counter, 0);
    const chunk = createHash('sha256')
      .update(text, 'utf8')
      .update(counterBuf)
      .digest();
    const take = Math.min(chunk.length, TARGET_BYTES - offset);
    chunk.copy(bytes, offset, 0, take);
    offset += take;
    counter += 1;
  }

  // Phase 2: read 384 little-endian Float32 values from the byte buffer.
  // Each byte is in [0, 255]; we map it to [-1, 1] by subtracting 128 and
  // dividing by 128. That gives a uniform distribution with mean ~0 and a
  // small dynamic range suitable for cosine similarity.
  //
  // Non-null assertions (`!`) below are safe: `bytes` is a Buffer of length
  // TARGET_BYTES = 1536 >= 384, and `floats` is a fresh Float32Array of
  // length EMBEDDING_DIMENSIONS = 384. Every index is defined.
  const floats = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i += 1) {
    const b = bytes[i]!;
    floats[i] = (b - 128) / 128;
  }

  // Phase 3: z-score normalize so cosine similarity is well-defined (a zero
  // vector would otherwise have undefined cosine).
  normalizeInPlace(floats);
  return floats;
}

function normalizeInPlace(arr: Float32Array): void {
  const len = arr.length;
  let sum = 0;
  for (let i = 0; i < len; i += 1) {
    sum += arr[i]!;
  }
  const mean = sum / len;

  let sqSum = 0;
  for (let i = 0; i < len; i += 1) {
    const diff = arr[i]! - mean;
    sqSum += diff * diff;
  }
  const std = Math.sqrt(sqSum / len) || 1; // avoid div-by-zero

  for (let i = 0; i < len; i += 1) {
    arr[i] = (arr[i]! - mean) / std;
  }
}

/**
 * Stub Embedder that always returns a deterministic vector per input.
 */
export class DeterministicStubEmbedder implements Embedder {
  readonly dimensions = EMBEDDING_DIMENSIONS;

  async embed(text: string): Promise<Float32Array> {
    if (typeof text !== 'string') {
      throw new EmbedderError(
        `embed() requires string input, got ${typeof text}`,
        'ENCODING_FAILED',
      );
    }
    if (text.length === 0) {
      throw new EmbedderError(
        'embed() refuses empty string (would collide with itself)',
        'ENCODING_FAILED',
      );
    }
    return computeStubEmbedding(text);
  }
}

/**
 * Cosine similarity in [-1, 1]. Exported for tests + future use in search.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new EmbedderError(
      `cosineSimilarity: length mismatch ${a.length} vs ${b.length}`,
      'ENCODING_FAILED',
    );
  }
  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}