/**
 * Hash primitive tests (T-03).
 *
 * Derived from spec acceptance criteria:
 *   - AC-7: 3+ NIST/RFC golden vectors for SHA-256 (first 16 bytes = 32 hex chars).
 *   - AC-8: Determinism — same input → same output.
 *   - AC-8: shape regex — returned string is always 32 chars, lowercase hex.
 *   - Edge case (spec §Edge Cases): 1MB input completes in < 100ms (perf sanity).
 *
 * No npm dependencies; tests use `node:crypto` directly to compute the
 * reference hashes so the test does not depend on the implementation
 * being correct (independence is the verifier property — if the test
 * re-implements the algorithm, it would only fail when both move
 * together).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { hashSha256_16, HASH_HEX_LENGTH } from '../../src/fingerprint/hash.ts';

/**
 * Compute the reference 32-char hex (first 16 bytes of SHA-256) directly
 * via node:crypto. Independent from the SUT.
 */
function referenceHash(input) {
  const digest = createHash('sha256').update(input, 'utf8').digest();
  return digest.subarray(0, 16).toString('hex');
}

// ---------------------------------------------------------------------------
// Golden vectors (NIST SHA-256, first 16 bytes = 32 hex chars)
// ---------------------------------------------------------------------------

const goldenVectors = [
  // NIST: SHA-256 of empty string — first 16 bytes.
  ['', 'e3b0c44298fc1c149afbf4c8996fb924'],
  // NIST: SHA-256 of "abc" — first 16 bytes.
  ['abc', 'ba7816bf8f01cfea414140de5dae2223'],
  // Wikipedia / RFC: SHA-256 of "The quick brown fox..." — first 16 bytes.
  ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f'],
  // Extra: pure digits — proves encoding path handles ASCII.
  ['1234567890', 'c775e7b757ede630cd0aa1113bd10266'],
];

for (const [input, expected] of goldenVectors) {
  test(`hashSha256_16("${input}") returns ${expected.slice(0, 8)}... (golden vector)`, () => {
    assert.equal(hashSha256_16(input), expected);
  });
}

test('hashSha256_16 matches node:crypto reference (independence check)', () => {
  const inputs = ['', 'abc', 'hello world', 'Memory Studio', 'olá mundo 🌎', '   spaces   '];
  for (const input of inputs) {
    assert.equal(
      hashSha256_16(input),
      referenceHash(input),
      `mismatch for input ${JSON.stringify(input)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Determinism (AC-8)
// ---------------------------------------------------------------------------

test('hashSha256_16 is deterministic for the same input', () => {
  const input = 'deterministic-test-input-42';
  const first = hashSha256_16(input);
  const second = hashSha256_16(input);
  assert.equal(first, second);
  assert.equal(first.length, HASH_HEX_LENGTH);
});

// ---------------------------------------------------------------------------
// Shape regex (AC-8) — always 32 lowercase hex chars
// ---------------------------------------------------------------------------

test('hashSha256_16 returns a 32-char lowercase hex string', () => {
  const inputs = ['', 'abc', 'The quick brown fox jumps over the lazy dog', 'unicode: 你好 🌎'];
  const shapeRe = /^[0-9a-f]{32}$/u;
  for (const input of inputs) {
    const result = hashSha256_16(input);
    assert.match(result, shapeRe, `output ${JSON.stringify(result)} for input ${JSON.stringify(input)} must be 32 lowercase hex chars`);
    assert.equal(result.length, 32);
  }
});

// ---------------------------------------------------------------------------
// Perf sanity (edge case in spec) — 1MB input completes in < 100ms
// ---------------------------------------------------------------------------

test('hashSha256_16 hashes a 1MB string in under 100ms', () => {
  const oneMb = 'x'.repeat(1024 * 1024);
  const start = performance.now();
  const result = hashSha256_16(oneMb);
  const elapsed = performance.now() - start;
  assert.equal(result.length, 32, '1MB hash must still be 32 chars');
  assert.ok(elapsed < 100, `1MB hashing took ${elapsed.toFixed(2)}ms, must be < 100ms`);
});
