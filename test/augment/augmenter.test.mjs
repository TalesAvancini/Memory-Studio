/**
 * Augmenter 2-block `cache_control: ephemeral` tests.
 *
 * Phase 5a.2 (T-08) — proves the system message structure:
 *   Block 1 (stable prefix): persona(s) text joined by \n\n
 *   Block 2 (variable suffix): Skills + Rules + context + warnings
 *   Both blocks carry `cache_control: { type: 'ephemeral' }`
 *   The systemMessage field = SHA-256 hex of the canonical-JSON-
 *   serialized 2-block structure (D-006 done criterion).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemMessage, partitionByKind } from '../../src/server/augment/augmenter.ts';

function makeItem(overrides) {
  return {
    id: 0,
    slug: '',
    kind: 'skill',
    text: '',
    rrfScore: 0,
    ...overrides,
  };
}

const baseRequest = {
  prompt: 'design a server endpoint',
  context: null,
  fingerprint: {
    projectPath: '/tmp',
    agentId: 'claude-code',
    sessionId: 'abc',
    gitBranch: 'main',
  },
  activeCatalog: ['skill-auth-01', 'rule-no-secrets-01', 'persona-eng-01'],
  schemaVersion: 3,
};

test('augmenter: 2 blocks, block 1 = persona, block 2 = skills + rules', () => {
  const matched = [
    makeItem({ slug: 'persona-eng-01', kind: 'persona', text: 'voz de Engenheiro Sênior' }),
    makeItem({ slug: 'skill-auth-01', kind: 'skill', text: 'JWT validation flow' }),
    makeItem({ slug: 'rule-no-secrets-01', kind: 'rule', text: 'never log secrets' }),
  ];
  const { system, sha256 } = buildSystemMessage(baseRequest, { matched });
  assert.equal(system.length, 2);
  // Block 1 = persona(s) text only.
  assert.match(system[0].text, /voz de Engenheiro Sênior/);
  assert.doesNotMatch(system[0].text, /JWT/);
  assert.doesNotMatch(system[0].text, /never log/);
  // Block 2 = skills + rules.
  assert.match(system[1].text, /JWT validation flow/);
  assert.match(system[1].text, /never log secrets/);
  assert.match(system[1].text, /## Skills/);
  assert.match(system[1].text, /## Rules/);
  // SHA-256 is 64 hex chars.
  assert.equal(sha256.length, 64);
  assert.match(sha256, /^[0-9a-f]{64}$/);
});

test('augmenter: both blocks have cache_control: ephemeral', () => {
  const matched = [makeItem({ slug: 'p', kind: 'persona', text: 'p' })];
  const { system } = buildSystemMessage(baseRequest, { matched });
  for (const block of system) {
    assert.equal(block.type, 'text');
    assert.deepEqual(block.cache_control, { type: 'ephemeral' });
  }
});

test('augmenter: same input → same SHA-256 (determinism, D-006)', () => {
  const matched = [makeItem({ slug: 'p', kind: 'persona', text: 'p' })];
  const r1 = buildSystemMessage(baseRequest, { matched });
  const r2 = buildSystemMessage(baseRequest, { matched });
  assert.equal(r1.sha256, r2.sha256);
});

test('augmenter: persona-only path (matched empty) still returns 2 blocks with block 1 from override', () => {
  const { system } = buildSystemMessage(baseRequest, {
    matched: [],
    personaTextOverride: 'persona override text',
  });
  assert.equal(system.length, 2);
  assert.equal(system[0].text, 'persona override text');
  // Block 2 may be empty but must still be present + marked cache_control.
  assert.equal(system[1].cache_control.type, 'ephemeral');
});

test('augmenter: context is included in block 2 when present', () => {
  const matched = [makeItem({ slug: 'p', kind: 'persona', text: 'p' })];
  const reqWithContext = {
    ...baseRequest,
    context: { scratch: 'todo list', sessionId: 's1' },
  };
  const { system } = buildSystemMessage(reqWithContext, { matched });
  assert.match(system[1].text, /## Context/);
  assert.match(system[1].text, /todo list/);
});

test('augmenter: warnings appear in block 2 when present', () => {
  const matched = [makeItem({ slug: 'p', kind: 'persona', text: 'p' })];
  const { system } = buildSystemMessage(baseRequest, {
    matched,
    warnings: ['only 2 items above threshold (< 3)'],
  });
  assert.match(system[1].text, /## Warnings/);
  assert.match(system[1].text, /only 2 items above threshold/);
});

test('augmenter: partitionByKind splits matched into skills/rules/personas', () => {
  const matched = [
    makeItem({ slug: 's1', kind: 'skill', text: 's1', cosineSimilarity: 0.9 }),
    makeItem({ slug: 'r1', kind: 'rule', text: 'r1', cosineSimilarity: 0.85 }),
    makeItem({ slug: 'p1', kind: 'persona', text: 'p1', cosineSimilarity: 0.95 }),
  ];
  const out = partitionByKind(matched);
  assert.equal(out.skills.length, 1);
  assert.equal(out.skills[0].id, 's1');
  assert.equal(out.skills[0].source, 'builtin');
  assert.equal(out.rules.length, 1);
  assert.equal(out.rules[0].id, 'r1');
  assert.equal(out.rules[0].critical, false);
  assert.equal(out.personas.length, 1);
  assert.equal(out.personas[0].id, 'p1');
  assert.equal(out.personas[0].isDefault, false);
});
