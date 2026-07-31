/**
 * Byte-string + canonical JSON serialization tests.
 *
 * Phase 5a.2 (T-08) — proves the SHA-256 + canonical-JSON determinism
 * primitives used by the augmenter. D-006 done criterion depends on
 * these being byte-exact across runs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  sha256Hex,
  canonicalJsonStringify,
  canonicalSha256,
} from '../../src/server/augment/byte-string.ts';

test('byte-string: SHA-256 of empty string matches NIST test vector', () => {
  // NIST CAVP: SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.equal(sha256Hex(''), expected);
  // Cross-check with a fresh createHash to prove the wrapper is correct.
  const control = createHash('sha256').update('', 'utf8').digest('hex');
  assert.equal(control, expected);
});

test('byte-string: same input → same hash (determinism)', () => {
  const a = sha256Hex('hello world');
  const b = sha256Hex('hello world');
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('byte-string: canonical JSON sorts keys recursively', () => {
  const a = canonicalJsonStringify({ b: 1, a: 2 });
  const b = canonicalJsonStringify({ a: 2, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1}');
});

test('byte-string: canonical JSON is stable across nested key reorderings', () => {
  const a = canonicalJsonStringify({ outer: { z: 1, a: 2, m: 3 } });
  const b = canonicalJsonStringify({ outer: { a: 2, m: 3, z: 1 } });
  assert.equal(a, b);
});

test('byte-string: canonical JSON preserves array order (intentional)', () => {
  // Arrays keep their order because the matched-items list is already
  // tiebreak-sorted upstream. Reordering would BREAK determinism.
  const a = canonicalJsonStringify([3, 1, 2]);
  const b = canonicalJsonStringify([3, 1, 2]);
  assert.equal(a, b);
  assert.equal(a, '[3,1,2]');
});

test('byte-string: canonical JSON has no whitespace', () => {
  const out = canonicalJsonStringify({ a: 1, b: 2 });
  assert.equal(out.indexOf(' '), -1);
  assert.equal(out.indexOf('\n'), -1);
});

test('byte-string: canonicalSha256 returns the same value as sha256Hex(canonicalJsonStringify(...))', () => {
  const value = { a: 1, b: 2, c: [3, 4] };
  const composed = sha256Hex(canonicalJsonStringify(value));
  assert.equal(canonicalSha256(value), composed);
});

test('byte-string: NFC normalization produces identical hashes for NFD vs NFC inputs', () => {
  // Build an explicitly NFD string ('a' + combining acute) so the input
  // differs in bytes from NFC. The replacer must normalize to NFC
  // before the SHA is computed.
  const nfd = 'S' + 'a' + '̃' + 'o Paulo'; // 'ã' decomposed: 'a' + U+0303
  const nfc = nfd.normalize('NFC');
  assert.notEqual(nfd, nfc, 'precondition: NFD and NFC strings differ in bytes');
  assert.equal(canonicalSha256({ name: nfd }), canonicalSha256({ name: nfc }));
});
