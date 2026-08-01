/**
 * Byte-string stability with BuildOptions.intel (Phase 6b T-10).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md`
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md`
 *
 * Proves that the BuildOptions.intel extension (T-09) preserves
 * byte-string determinism (D-006) across the 4 critical input
 * permutations:
 *
 *   1. Same input (persona + intel + Skills) → same SHA-256.
 *   2. Different intel → different SHA-256 (intel is incorporated).
 *   3. Same intel + different persona → different SHA-256 (persona
 *      in Block 1 still drives the byte-string).
 *   4. Empty/null/undefined intel → SHA matches the no-intel
 *      baseline (backward-compatible — empty intel is "section
 *      omitted", so the byte-string is byte-identical to the
 *      pre-Phase-6b baseline).
 *
 * This is the byte-string stability contract that the cache hit
 * invariant (R-15) depends on. The 4 cases mirror the Phase 6a
 * `test/poc/byte-string-equality.test.mjs` pattern but exercise the
 * PRODUCTION `buildSystemMessage` (with the new `intel` field)
 * instead of the inline POC helper.
 *
 * Uses NO DB / NO server / NO mocks. Pure unit tests on the
 * deterministic `buildSystemMessage` function.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemMessage } from '../../src/server/augment/augmenter.ts';
import { canonicalSha256 } from '../../src/server/augment/byte-string.ts';

// --- Fixtures ---------------------------------------------------------------

const FIXTURE_PERSONA_TEXT = 'persona-senior-engineer';

const FIXTURE_SKILLS = [
  'auth-jwt-validation',
  'auth-oauth-handler',
  'auth-session-cookie',
];

const FIXTURE_INTEL = {
  agentState: 'augmenter-test-agent-state',
  nextNeeds: ['augmenter-need-a', 'augmenter-need-b'],
  recentTopic: 'augmenter-test-recent-topic',
};

const FIXTURE_INTEL_ALT = {
  agentState: 'augmenter-test-agent-state',
  nextNeeds: ['augmenter-need-a', 'augmenter-need-b'],
  recentTopic: 'augmenter-test-recent-topic-DIFFERENT',
};

const ALT_PERSONA_TEXT = 'persona-staff-engineer';

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
    projectPath: '/tmp/byte-string-with-intel',
    agentId: 'claude-code',
    sessionId: 'bswi-session-001',
    gitBranch: 'main',
  },
  activeCatalog: ['skill-auth-01', 'rule-no-secrets-01', 'persona-eng-01'],
  schemaVersion: 3,
};

function matchedWithPersona(personaText) {
  return [
    makeItem({ slug: 'persona-eng-01', kind: 'persona', text: personaText }),
    ...FIXTURE_SKILLS.map((slug, i) =>
      makeItem({ slug, kind: 'skill', text: `skill text ${slug} ${i}`, rrfScore: 1 - i * 0.1 }),
    ),
  ];
}

// --- Tests ------------------------------------------------------------------

test('byte-string-with-intel: same input (persona + intel + Skills) → same SHA-256', () => {
  const matched = matchedWithPersona(FIXTURE_PERSONA_TEXT);
  const r1 = buildSystemMessage(baseRequest, { matched, intel: FIXTURE_INTEL });
  const r2 = buildSystemMessage(baseRequest, { matched, intel: FIXTURE_INTEL });
  assert.equal(r1.sha256, r2.sha256, `expected identical SHA-256; got ${r1.sha256} vs ${r2.sha256}`);
  // Cross-check the SHA format (D-006 done criterion).
  assert.equal(r1.sha256.length, 64);
  assert.match(r1.sha256, /^[0-9a-f]{64}$/);
});

test('byte-string-with-intel: different intel → different SHA-256 (intel is incorporated)', () => {
  const matched = matchedWithPersona(FIXTURE_PERSONA_TEXT);
  const r1 = buildSystemMessage(baseRequest, { matched, intel: FIXTURE_INTEL });
  const r2 = buildSystemMessage(baseRequest, { matched, intel: FIXTURE_INTEL_ALT });
  assert.notEqual(
    r1.sha256,
    r2.sha256,
    `expected different SHA-256 for different intel; both got ${r1.sha256}`,
  );
});

test('byte-string-with-intel: same intel + different persona → different SHA-256 (Block 1 dominates)', () => {
  const matchedA = matchedWithPersona(FIXTURE_PERSONA_TEXT);
  const matchedB = matchedWithPersona(ALT_PERSONA_TEXT);
  const r1 = buildSystemMessage(baseRequest, { matched: matchedA, intel: FIXTURE_INTEL });
  const r2 = buildSystemMessage(baseRequest, { matched: matchedB, intel: FIXTURE_INTEL });
  assert.notEqual(
    r1.sha256,
    r2.sha256,
    `expected different SHA-256 for different persona; both got ${r1.sha256}`,
  );
  // Cross-check: the intel section IS present in BOTH (so the
  // difference is indeed Block 1, not Block 2's intel presence).
  assert.match(r1.system[1].text, /## Intel/);
  assert.match(r2.system[1].text, /## Intel/);
});

test('byte-string-with-intel: empty/null/undefined intel → SHA matches no-intel baseline (backward-compatible)', () => {
  const matched = matchedWithPersona(FIXTURE_PERSONA_TEXT);

  // Baseline: no intel at all (options field unset).
  const baseline = buildSystemMessage(baseRequest, { matched });

  // Empty intel literal (D-005 sentinel) must produce the SAME SHA.
  const EMPTY_INTEL = { agentState: '', nextNeeds: [], recentTopic: '' };
  const emptyLiteral = buildSystemMessage(baseRequest, { matched, intel: EMPTY_INTEL });

  // Explicit null.
  const explicitNull = buildSystemMessage(baseRequest, { matched, intel: null });

  // Explicit undefined.
  const explicitUndefined = buildSystemMessage(baseRequest, { matched, intel: undefined });

  assert.equal(
    baseline.sha256,
    emptyLiteral.sha256,
    `empty intel literal must produce same SHA as no-intel baseline; got ${baseline.sha256} vs ${emptyLiteral.sha256}`,
  );
  assert.equal(
    baseline.sha256,
    explicitNull.sha256,
    `explicit null intel must produce same SHA as no-intel baseline; got ${baseline.sha256} vs ${explicitNull.sha256}`,
  );
  assert.equal(
    baseline.sha256,
    explicitUndefined.sha256,
    `explicit undefined intel must produce same SHA as no-intel baseline; got ${baseline.sha256} vs ${explicitUndefined.sha256}`,
  );

  // Cross-check: the SHA matches a manually-computed hash of the
  // 2-block structure with no Intel section. This isolates the
  // hash to the canonical-JSON form (no other side effects).
  const manual = canonicalSha256([
    { type: 'text', text: FIXTURE_PERSONA_TEXT, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: '## Skills\n' + FIXTURE_SKILLS.map((s, i) => `skill text ${s} ${i}`).join('\n\n'),
      cache_control: { type: 'ephemeral' },
    },
  ]);
  assert.equal(
    baseline.sha256,
    manual,
    `baseline SHA must match manual canonical-JSON hash; got ${baseline.sha256} vs ${manual}`,
  );

  // Cross-check: NO `## Intel` header appears in the empty/null/undefined
  // system message Block 2 (R-10 + D-005 — empty intel = section omitted).
  assert.doesNotMatch(baseline.system[1].text, /## Intel/);
  assert.doesNotMatch(emptyLiteral.system[1].text, /## Intel/);
  assert.doesNotMatch(explicitNull.system[1].text, /## Intel/);
  assert.doesNotMatch(explicitUndefined.system[1].text, /## Intel/);
});

// --- Bonus: Intel section appears FIRST in Block 2 (R-10 + AD-006 #1) ------
//
// Not directly in the 4-case spec but a critical AD-006 invariant —
// if Intel drifts to a later position, the cache key stability window
// shrinks when only Skills/Rules shift. Cheap to assert here.

test('byte-string-with-intel: ## Intel section appears FIRST in Block 2 when present', () => {
  const matched = matchedWithPersona(FIXTURE_PERSONA_TEXT);
  const { system } = buildSystemMessage(baseRequest, {
    matched,
    intel: FIXTURE_INTEL,
  });
  const block2 = system[1].text;
  // `## Intel` must be the very first `## <name>` heading in Block 2.
  const firstHeaderMatch = block2.match(/^## (\w+)/m);
  assert.ok(firstHeaderMatch, `Block 2 must contain at least one ## header; got ${block2.slice(0, 80)}`);
  assert.equal(
    firstHeaderMatch[1],
    'Intel',
    `## Intel must be the first header in Block 2; got ## ${firstHeaderMatch[1]}`,
  );
  // The Section after ## Intel must be Skills (in the order Intel → Skills → Rules).
  const skillsPos = block2.indexOf('## Skills');
  assert.ok(skillsPos > 0, `## Skills must appear after ## Intel; got block2:\n${block2}`);
  const intelPos = block2.indexOf('## Intel');
  assert.ok(intelPos < skillsPos, `## Intel (pos ${intelPos}) must precede ## Skills (pos ${skillsPos})`);
});
