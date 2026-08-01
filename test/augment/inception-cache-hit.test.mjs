/**
 * Inception cache hit invariant tests (Phase 6b T-15 / AC-11).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-11
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md` T-15
 * Source design: `.specs/features/phase-6b-fast-agent-intel/design.md` §3.5
 *
 * Verifies the cache hit invariant: when Block 1 (persona) is stable
 * across turns, the 2-block `cache_control: ephemeral` system message
 * hits Anthropic's prompt cache on the 2nd call. The test uses a
 * local stub cache tracker that simulates Anthropic's
 * `usage.cache_read_input_tokens` metric — `0` on the first call for
 * a given SHA, `> 0` on subsequent calls with the same SHA.
 *
 * 3 cases:
 *   1. Same persona: 2nd response cache hit
 *      (`cache_read_input_tokens > 0` via stub provider).
 *   2. Different persona: 2nd response cache miss
 *      (`cache_read_input_tokens === 0`).
 *   3. Single turn: cache miss (`cache_read_input_tokens === 0`).
 *
 * The test exercises the buildSystemMessage → 2-block structure path
 * directly with controlled inputs (persona + matched + intel). A
 * real Anthropic cache hit requires real API access + a TTL window —
 * the stub proves the FLOW. Real cache behavior is Phase 7b's
 * measurement.
 *
 * Block 1 stability guarantee (R-15):
 *   - The `## Intel` section lives ONLY in Block 2 (variable suffix).
 *   - Block 1 (persona) is NEVER modified by intel changes.
 *   - Same persona → identical Block 1 → cache prefix stable → cache hit.
 *
 * The stub cache key is the SHA of the joined system field text
 * (mirroring the Anthropic cache key derivation). Cache hits fire on
 * the 2nd call with the same SHA — this proves that with the
 * production `buildSystemMessage`, the cache key IS stable when
 * persona is stable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { buildSystemMessage } from '../../src/server/augment/augmenter.ts';

function sha256Hex(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Stub cache tracker that simulates Anthropic's cache behavior:
 *   - First call for a given SHA → `cache_read_input_tokens: 0`
 *   - Subsequent calls for the same SHA → `cache_read_input_tokens: 42`
 *
 * Mirrors the smoke-augment-server.mjs stub pattern (Phase 5a.3 T-11).
 */
function makeStubCacheTracker() {
  const seen = new Map();
  return {
    /** Record a system message and return the cache_read metric. */
    record(system) {
      const sha = sha256Hex(system);
      const priorCount = seen.get(sha) ?? 0;
      seen.set(sha, priorCount + 1);
      return {
        sha,
        cache_read_input_tokens: priorCount === 0 ? 0 : 42,
      };
    },
    /** Test introspection — get the seen map (keyed by SHA → call count). */
    snapshot() {
      return Object.fromEntries(seen);
    },
  };
}

function makePersonaItem(personaText) {
  return {
    id: 0,
    slug: 'persona-eng-01',
    kind: 'persona',
    text: personaText,
    rrfScore: 1,
  };
}

const FIXTURE_INTEL = {
  agentState: 'cache-hit-test-agent-state',
  nextNeeds: ['cache-hit-need-a'],
  recentTopic: 'cache-hit-test-recent-topic',
};

const baseRequest = {
  context: null,
  fingerprint: {
    projectPath: '/tmp/inception-cache-hit',
    agentId: 'claude-code',
    sessionId: 'inception-cache-hit-001',
    gitBranch: 'main',
  },
  activeCatalog: ['persona-eng-01', 'skill-auth-01'],
  schemaVersion: 3,
};

// --- Tests ------------------------------------------------------------------

test('inception-cache-hit: same persona + different prompts → 2nd call cache hit (cache_read > 0)', () => {
  const cache = makeStubCacheTracker();
  const personaText = 'persona-senior-engineer';

  // Turn N — fresh prompt. Block 1 = persona. Cache miss (first call).
  const req1 = { ...baseRequest, prompt: 'what is JWT authentication?' };
  const out1 = buildSystemMessage(req1, { matched: [makePersonaItem(personaText)], intel: FIXTURE_INTEL });
  const joined1 = out1.system.map((b) => b.text).join('\n\n');
  const cache1 = cache.record(joined1);
  assert.equal(cache1.cache_read_input_tokens, 0, 'first call → cache miss (cache_read = 0)');
  assert.equal(out1.sha256.length, 64);

  // Turn N+1 — different prompt, SAME persona. Block 1 stable.
  // Block 2 may differ (different matched skills) but Block 1 doesn't.
  // For the FULL 2-block SHA, intel is the same here (same session,
  // same fetched-intel literal), so the full 2-block is byte-identical.
  // The test verifies the SHA stays the same when the persona is the
  // same AND the rest of the deterministic inputs are the same.
  const req2 = { ...baseRequest, prompt: 'is JWT stateless?' };
  const out2 = buildSystemMessage(req2, { matched: [makePersonaItem(personaText)], intel: FIXTURE_INTEL });
  const joined2 = out2.system.map((b) => b.text).join('\n\n');
  const cache2 = cache.record(joined2);
  assert.equal(out1.sha256, out2.sha256, 'same persona + same intel + same matched → identical SHA (cache prefix stable)');
  assert.equal(
    cache2.cache_read_input_tokens,
    42,
    `2nd call with same SHA → cache hit (cache_read = 42), got ${cache2.cache_read_input_tokens}`,
  );
});

test('inception-cache-hit: different persona → 2nd call cache miss (cache_read = 0)', () => {
  const cache = makeStubCacheTracker();

  // Turn N — persona A.
  const req1 = { ...baseRequest, prompt: 'what is JWT authentication?' };
  const out1 = buildSystemMessage(req1, { matched: [makePersonaItem('persona-senior-engineer')], intel: FIXTURE_INTEL });
  const cache1 = cache.record(out1.system.map((b) => b.text).join('\n\n'));
  assert.equal(cache1.cache_read_input_tokens, 0);

  // Turn N+1 — different persona. Block 1 changes → SHA changes.
  const req2 = { ...baseRequest, prompt: 'what is JWT authentication?' };
  const out2 = buildSystemMessage(req2, { matched: [makePersonaItem('persona-staff-engineer')], intel: FIXTURE_INTEL });
  const cache2 = cache.record(out2.system.map((b) => b.text).join('\n\n'));
  assert.notEqual(out1.sha256, out2.sha256, 'different persona → different SHA');
  assert.equal(
    cache2.cache_read_input_tokens,
    0,
    `different persona → 2nd call is a cache miss (cache_read = 0), got ${cache2.cache_read_input_tokens}`,
  );
});

test('inception-cache-hit: single turn → cache miss (cache_read = 0)', () => {
  const cache = makeStubCacheTracker();
  const req1 = { ...baseRequest, prompt: 'only call' };
  const out1 = buildSystemMessage(req1, { matched: [makePersonaItem('persona-senior-engineer')], intel: FIXTURE_INTEL });
  const cache1 = cache.record(out1.system.map((b) => b.text).join('\n\n'));
  assert.equal(cache1.cache_read_input_tokens, 0, 'single turn → cache miss by definition (no prior cache)');
  assert.equal(out1.sha256.length, 64);
  // The stub saw exactly 1 SHA.
  assert.equal(Object.keys(cache.snapshot()).length, 1, 'stub cache should have exactly 1 SHA after single call');
});

test('inception-cache-hit: defensive — Block 1 byte-identical across 3 intel variations (R-15 invariant)', () => {
  // This is a structural assertion about the cache prefix. Even with
  // 3 different intel variations, Block 1 (the cache prefix) MUST
  // stay byte-identical. The previous test verifies the SHA changes
  // (which is fine for the FULL 2-block); here we verify that Block 1
  // itself never moves, which is what makes the cache hit possible
  // across turns in the real Anthropic flow.
  const personaText = 'persona-senior-engineer';
  const variants = [
    null, // no intel
    FIXTURE_INTEL,
    { agentState: 'different', nextNeeds: ['x'], recentTopic: 'different' },
  ];
  const block1Texts = variants.map((intel) => {
    const out = buildSystemMessage(baseRequest, { matched: [makePersonaItem(personaText)], intel });
    return out.system[0].text; // Block 1 (cache prefix)
  });
  for (const block1 of block1Texts) {
    assert.equal(block1, personaText, `Block 1 must be byte-identical to the persona text across intel variations; got ${block1}`);
  }
});

test('inception-cache-hit: defensive — full 2-block SHA differs when intel changes (intentional)', () => {
  // Counterpart to the previous test: the FULL 2-block SHA DOES
  // change when intel changes (Block 2 grows the `## Intel` section).
  // This is by design — the cache key for the WHOLE 2-block shifts.
  // Anthropic's cache hits on per-block granularity, so Block 1
  // (persona) is the cache-stable prefix; Block 2 (intel + ...) is
  // the variable suffix that gets cache-missed on every intel update.
  const personaText = 'persona-senior-engineer';
  const a = buildSystemMessage(baseRequest, { matched: [makePersonaItem(personaText)], intel: FIXTURE_INTEL });
  const b = buildSystemMessage(baseRequest, { matched: [makePersonaItem(personaText)], intel: { ...FIXTURE_INTEL, recentTopic: 'different' } });
  assert.notEqual(a.sha256, b.sha256, 'full 2-block SHA MUST differ when intel changes (intentional — Block 2 grows)');
  assert.equal(a.system[0].text, b.system[0].text, 'Block 1 (persona) MUST stay identical (R-15 cache hit prefix)');
});
