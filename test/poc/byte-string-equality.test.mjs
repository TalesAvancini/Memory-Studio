/**
 * Phase 6a — Template Byte-String Equality POC (T-09)
 *
 * Source spec: `.specs/features/phase-6a-poc-validation/spec.md`
 * Source tasks: `.specs/features/phase-6a-poc-validation/tasks.md`
 *
 * Proves that the 2-block `cache_control: ephemeral` system message
 * builder (with the `intel` literal appended to Block 2's variable
 * suffix) produces a deterministic SHA-256 hex digest (D-006).
 *
 * 4 test cases:
 *   1. 2 identical inputs (same persona + same intel + same Skills
 *      ativas) → same 64-char SHA-256 hex (`R-07 / AC-5`).
 *   2. Different intel → different SHA-256 (sanity check — proves the
 *      intel literal is actually incorporated into the byte-string).
 *   3. Same intel + different field ordering → same SHA-256
 *      (canonical JSON via `canonicalJsonStringify`).
 *   4. SHA-256 is 64 lowercase hex chars (regex `/^[0-9a-f]{64}$/`).
 *
 * The builder uses the existing `canonicalSha256()` from
 * `src/server/augment/byte-string.ts` as a read-only import (per spec
 * R-13 scope guard).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256, canonicalJsonStringify } from '../../src/server/augment/byte-string.ts';

// --- Fixtures (per tasks.md T-09) ------------------------------------------

const FIXTURE_INTEL = {
  agentState: 'poc-6a-fixture-agent-state',
  nextNeeds: ['fixture-need-a', 'fixture-need-b'],
  recentTopic: 'poc-6a-fixture-recent-topic',
};

const FIXTURE_PERSONA = 'persona-senior-engineer';

const FIXTURE_SKILLS = [
  'auth-jwt-validation',
  'auth-oauth-handler',
  'auth-session-cookie',
];

// --- Inline helper (matches Phase 5a.2 `buildSystemMessage` shape) --------
//
// Phase 6a uses an INLINE extension (local helper) to avoid modifying
// `BuildOptions` (per spec R-14 scope guard). Phase 6b will formalize
// `intel?: Intel` as a `BuildOptions` field.

function buildSystemMessageWithIntel(persona, skills, intel) {
  const block1 = {
    type: 'text',
    text: persona,
    cache_control: { type: 'ephemeral' },
  };
  const block2 = {
    type: 'text',
    text:
      `## Skills\n${skills.join('\n\n')}\n\n` +
      `## Intel\n${canonicalJsonStringify(intel)}`,
    cache_control: { type: 'ephemeral' },
  };
  return canonicalSha256([block1, block2]);
}

// --- Tests -----------------------------------------------------------------

test('byte-string: 2 identical inputs → same SHA-256 (D-006 done)', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  assert.equal(sha1, sha2, `expected identical SHA-256 for identical inputs; got ${sha1} vs ${sha2}`);
});

test('byte-string: different intel → different SHA-256', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, {
    ...FIXTURE_INTEL,
    recentTopic: 'different-topic',
  });
  assert.notEqual(
    sha1,
    sha2,
    `expected different SHA-256 for different intel; both got ${sha1}`,
  );
});

test('byte-string: same intel + different key ordering → same SHA-256 (canonical JSON)', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, {
    agentState: 'a',
    nextNeeds: ['x'],
    recentTopic: 'r',
  });
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, {
    recentTopic: 'r',
    agentState: 'a',
    nextNeeds: ['x'],
  });
  assert.equal(
    sha1,
    sha2,
    `canonical JSON should sort keys; got ${sha1} vs ${sha2}`,
  );
});

test('byte-string: SHA-256 is 64 lowercase hex chars', () => {
  const sha = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  assert.equal(typeof sha, 'string', 'SHA must be a string');
  assert.equal(sha.length, 64, `SHA-256 hex must be 64 chars, got ${sha.length}`);
  assert.match(sha, /^[0-9a-f]{64}$/, `SHA must be lowercase hex: ${sha}`);
});
