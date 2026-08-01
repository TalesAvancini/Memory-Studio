/**
 * Placeholder secret redaction tests (Phase 5b T-08).
 *
 * Coverage:
 *   - 4 placeholder patterns: ${VAR}=value, password|token|api_key|
 *     secret_key=, sk-..., Bearer ...
 *   - No-placeholder passthrough unchanged
 *   - Multiple placeholders in one string
 *   - Key overlap (SECRET_KEY vs KEY) replaced correctly
 *   - Empty string passthrough
 *   - Recursive object walk redacts string leaves, preserves keys
 *   - Hash determinism for hashTenantId
 *   - hashTenantId handles undefined / null / empty
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactPlaceholders,
  redactObjectRecursive,
  PLACEHOLDER_PATTERNS,
} from '../../src/server/audit/redact.ts';
import { hashTenantId } from '../../src/server/security/tenant-hash.ts';

test('redact: ${SECRET_KEY}=abc123 → <REDACTED>', () => {
  assert.equal(
    redactPlaceholders('deploy ${SECRET_KEY}=abc123 to prod'),
    'deploy <REDACTED> to prod',
  );
});

test('redact: password=hunter2 → <REDACTED>', () => {
  assert.equal(redactPlaceholders('password=hunter2'), '<REDACTED>');
});

test('redact: api_key=sk-1234567890abcdef1234 → <REDACTED>', () => {
  assert.equal(
    redactPlaceholders('api_key=sk-1234567890abcdef1234'),
    '<REDACTED>',
  );
});

test('redact: sk-ant-abcdefghijklmnop1234567890 → <REDACTED>', () => {
  assert.equal(
    redactPlaceholders('sk-ant-abcdefghijklmnop1234567890'),
    '<REDACTED>',
  );
});

test('redact: Bearer eyJ... JWT → <REDACTED>', () => {
  const bearer = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
  assert.equal(redactPlaceholders(bearer), '<REDACTED>');
});

test('redact: plain text with no placeholders is unchanged', () => {
  const original = 'just a plain sentence with no secrets';
  assert.equal(redactPlaceholders(original), original);
});

test('redact: multiple placeholders in one string → all replaced', () => {
  assert.equal(
    redactPlaceholders('${SECRET_KEY}=abc and ${API_TOKEN}=xyz'),
    '<REDACTED> and <REDACTED>',
  );
});

test('redact: key overlap (SECRET_KEY vs KEY) replaced correctly', () => {
  // The first pattern requires ${...} wrapper. KEY alone should NOT
  // match the first pattern but the second pattern matches
  // api_key=value.
  assert.equal(
    redactPlaceholders('${SECRET_KEY}=secret1 and KEY=value2'),
    '<REDACTED> and KEY=value2',
  );
});

test('redact: empty string passthrough', () => {
  assert.equal(redactPlaceholders(''), '');
});

test('redact: input string is NOT mutated (returns NEW string)', () => {
  const original = 'password=hunter2';
  const copy = original;
  redactPlaceholders(original);
  assert.equal(original, copy, 'original input unchanged');
});

test('redact: recursive object walker redacts string leaves', () => {
  const input = { a: 'password=x', b: { c: 'sk-12345678901234567890' } };
  const redacted = redactObjectRecursive(input);
  assert.equal(redacted.a, '<REDACTED>');
  assert.equal(redacted.b.c, '<REDACTED>');
  // Original input unchanged.
  assert.equal(input.a, 'password=x');
});

test('redact: recursive walker preserves object keys (only values)', () => {
  // The value must contain `key=value` to match pattern 2.
  const input = { password: 'hunter2' };
  const redacted = redactObjectRecursive(input);
  assert.deepEqual(Object.keys(redacted), ['password']);
  // Value has no `=`, so it's NOT redacted (pattern requires `=`).
  assert.equal(redacted.password, 'hunter2');
});

test('redact: recursive walker handles arrays', () => {
  const input = ['password=x', 'plain', 'sk-12345678901234567890'];
  const redacted = redactObjectRecursive(input);
  assert.deepEqual(redacted, ['<REDACTED>', 'plain', '<REDACTED>']);
});

test('redact: recursive walker passes numbers / booleans / null unchanged', () => {
  const input = { n: 42, b: true, z: null, s: 'password=x' };
  const redacted = redactObjectRecursive(input);
  assert.deepEqual(redacted, { n: 42, b: true, z: null, s: '<REDACTED>' });
});

test('redact: PLACEHOLDER_PATTERNS exports 4 patterns', () => {
  assert.equal(PLACEHOLDER_PATTERNS.length, 4);
  for (const p of PLACEHOLDER_PATTERNS) {
    assert.ok(p instanceof RegExp, 'each pattern is a RegExp');
  }
});

// --- hashTenantId (Phase 5b T-04) ------------------------------------------

test('hashTenantId: returns 16 hex chars for valid input', () => {
  const hash = hashTenantId('tenant-acme-12345');
  assert.ok(hash !== null);
  assert.match(hash, /^[0-9a-f]{16}$/);
});

test('hashTenantId: undefined → null', () => {
  assert.equal(hashTenantId(undefined), null);
});

test('hashTenantId: null → null', () => {
  assert.equal(hashTenantId(null), null);
});

test('hashTenantId: empty string → null', () => {
  assert.equal(hashTenantId(''), null);
});

test('hashTenantId: same input → same output (determinism)', () => {
  const a = hashTenantId('tenant-abc');
  const b = hashTenantId('tenant-abc');
  assert.equal(a, b);
  assert.ok(a !== null);
});

test('hashTenantId: different inputs → different outputs', () => {
  const a = hashTenantId('tenant-abc');
  const b = hashTenantId('tenant-xyz');
  assert.notEqual(a, b);
});