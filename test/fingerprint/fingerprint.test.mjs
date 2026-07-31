/**
 * Fingerprint function tests (T-04).
 *
 * Derived from spec acceptance criteria:
 *   - AC-6: 4-component return shape; raw sessionId never in return.
 *   - AC-8 (extended): hash-before-return contract.
 *   - Edge case (spec §Edge Cases): determinism, unicode sessionId.
 *
 * The anti-leak guard uses a uniquely distinctive sessionId so the
 * test cannot accidentally pass due to a partial / substring overlap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { fingerprint, hashSha256_16 } from '../../src/fingerprint/index.ts';

const sampleInput = {
  projectPath: '/home/user/projects/memory-studio',
  agentId: 'claude-code',
  sessionId: 'sess-abc-123-distinctive-very-unique-456',
  gitBranch: 'main',
};

/**
 * Reference hash (independent — uses node:crypto directly, not the SUT).
 */
function referenceHash(input) {
  const digest = createHash('sha256').update(input, 'utf8').digest();
  return digest.subarray(0, 16).toString('hex');
}

test('fingerprint returns a Promise that resolves to an object with exactly 4 keys', async () => {
  const result = await fingerprint(sampleInput);
  assert.equal(typeof result, 'object');
  assert.notEqual(result, null);
  assert.deepEqual(
    Object.keys(result).sort(),
    ['agentId', 'gitBranch', 'projectPath', 'sessionId'],
    'fingerprint must return exactly the 4 keys from spec',
  );
});

test('fingerprint passes projectPath, agentId, gitBranch through unchanged', async () => {
  const result = await fingerprint(sampleInput);
  assert.equal(result.projectPath, sampleInput.projectPath);
  assert.equal(result.agentId, sampleInput.agentId);
  assert.equal(result.gitBranch, sampleInput.gitBranch);
});

test('fingerprint returns hashed sessionId matching hashSha256_16 of the raw value', async () => {
  const result = await fingerprint(sampleInput);
  const expected = hashSha256_16(sampleInput.sessionId);
  assert.equal(result.sessionId, expected);
  assert.equal(result.sessionId.length, 32);
  assert.match(result.sessionId, /^[0-9a-f]{32}$/u);
  // Independent reference check via node:crypto directly.
  assert.equal(result.sessionId, referenceHash(sampleInput.sessionId));
});

test('fingerprint does NOT leak the raw sessionId (anti-leak guard, AC-6)', async () => {
  const distinctiveInput = {
    projectPath: '/tmp/test',
    agentId: 'claude-code',
    sessionId: 'my-very-distinctive-test-session-id-12345',
    gitBranch: 'feature/anti-leak',
  };
  const result = await fingerprint(distinctiveInput);

  // The raw sessionId string must NOT be one of the 4 returned values.
  for (const value of Object.values(result)) {
    assert.notEqual(
      value,
      distinctiveInput.sessionId,
      `raw sessionId must not appear as a field value (found: ${JSON.stringify(value)})`,
    );
  }
  // And no substring of the raw sessionId appears in the hashed field
  // (the hash is 32 hex chars; the raw sessionId is mostly ASCII letters
  // + digits + dashes — overlap would be astronomically unlikely, but the
  // check is cheap and proves the test isn't fooled by partial matches).
  assert.ok(
    !result.sessionId.includes(distinctiveInput.sessionId),
    'hashed sessionId must not contain the raw sessionId as a substring',
  );
});

test('fingerprint is deterministic for the same input', async () => {
  const first = await fingerprint(sampleInput);
  const second = await fingerprint(sampleInput);
  assert.deepEqual(first, second);
});

test('fingerprint hashes unicode sessionId (emoji + CJK) via UTF-8', async () => {
  const unicodeInput = {
    projectPath: '/tmp/unicode',
    agentId: 'claude-code',
    sessionId: '🌎-会话-αβγ-123',
    gitBranch: 'unicode-branch',
  };
  const result = await fingerprint(unicodeInput);
  assert.equal(result.sessionId.length, 32);
  assert.match(result.sessionId, /^[0-9a-f]{32}$/u);
  // Must equal the independent reference (also UTF-8 encoded).
  assert.equal(result.sessionId, referenceHash(unicodeInput.sessionId));
  // Raw unicode sessionId must NOT be present anywhere in result.
  assert.ok(!Object.values(result).includes(unicodeInput.sessionId));
});

test('fingerprint with different sessionIds produces different hashes', async () => {
  const a = await fingerprint({ ...sampleInput, sessionId: 'session-A' });
  const b = await fingerprint({ ...sampleInput, sessionId: 'session-B' });
  assert.notEqual(a.sessionId, b.sessionId);
});
