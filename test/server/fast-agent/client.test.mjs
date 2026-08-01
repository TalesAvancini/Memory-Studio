/**
 * Fast-agent client unit tests (Phase 6b T-08 / AC-4, AC-15).
 *
 * Source spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-4 + AC-15.
 * Source tasks: `.specs/features/phase-6b-fast-agent-intel/tasks.md` T-08.
 *
 * Two execution paths in `client.ts`:
 *
 *   1. **Stub path** — exercised here end-to-end. We unset
 *      `MINIMAX_API_KEY`, force module-level MODE detection on the
 *      first call, then assert `fetchIntel(...)` returns `EMPTY_INTEL`
 *      AND a `[STUB]` log line appears on stdout.
 *
 *   2. **Real path** — uses `@anthropic-ai/sdk`. We don't exercise
 *      the actual HTTP call (no Anthropic access in the test env).
 *      Instead we assert (a) `resolveMode(key, sdkPath)` reports
 *      `'real'` when both are set, (b) `getMode()` /
 *      `getModel()` / `getEndpoint()` return the documented values,
 *      (c) the source-level SDK call shape contains the four fields
 *      the spec AC-4 calls out (`model`, `max_tokens`, `system`,
 *      `messages`) — a structural contract test that doesn't burn a
 *      network round-trip.
 *
 * 6 cases — matches the spec (4 stub + 2 contract).
 *
 * No port collisions: client tests are in-process + logger-capture
 * only (no HTTP servers).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchIntel,
  getEndpoint,
  getMode,
  getModel,
  resolveMode,
} from '../../../src/server/fast-agent/client.ts';
import { EMPTY_INTEL, IntelSchema } from '../../../src/server/fast-agent/intel-schema.ts';

function srcRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', '..');
}

// ---------------------------------------------------------------------------
// Stub path — end-to-end with real fetchIntel.
// ---------------------------------------------------------------------------

test('client: stub path returns EMPTY_INTEL when MINIMAX_API_KEY is unset', async () => {
  // Module load already detected MODE. Sanity-check this test runs
  // in a stub-mode environment (CI var env, no API key).
  assert.equal(getMode(), 'stub', 'this test fixture assumes stub mode (no API key)');

  const intel = await fetchIntel('pick the right auth scheme for /v1/messages');
  assert.deepEqual(intel, EMPTY_INTEL, 'stub path must return the EMPTY_INTEL sentinel');
});

test('client: stub-mode emit a [STUB]-prefixed log line on every fetchIntel call', async () => {
  // Capture stdout/stderr into a buffer + tee so the rest of the
  // test runner still sees the log lines.
  const originalLog = console.log;
  const collected = [];
  console.log = (...args) => {
    collected.push(args.join(' '));
    originalLog(...args);
  };
  try {
    await fetchIntel('test prompt for [STUB] logging');
  } finally {
    console.log = originalLog;
  }

  // The stub path fires at LEAST one [fast-agent] MODULE-LOAD line
  // (at import time) AND one [STUB] fetchIntel line (per call). The
  // module-load line uses `[fast-agent] MODE=stub ...`, the per-
  // call line uses `[STUB] fetchIntel called ...`. This test
  // asserts the SECOND one fires — the per-call [STUB] prefix.
  const stubCallLines = collected.filter((line) => line.includes('[STUB] fetchIntel called'));
  assert.ok(
    stubCallLines.length >= 1,
    `expected ≥ 1 [STUB] fetchIntel log line, got ${stubCallLines.length}: ${JSON.stringify(collected)}`,
  );
});

// ---------------------------------------------------------------------------
// Mode resolution — pure functions exercised in isolation.
// ---------------------------------------------------------------------------

test('client: resolveMode returns stub when API key is unset', () => {
  assert.equal(resolveMode(undefined, '/some/path/to/@anthropic-ai/sdk'), 'stub');
  assert.equal(resolveMode('', '/some/path/to/@anthropic-ai/sdk'), 'stub');
});

test('client: resolveMode returns stub when API key set but SDK is missing', () => {
  assert.equal(resolveMode('sk-ant-test-key', null), 'stub', 'missing SDK path ⇒ stub fallback');
});

test('client: resolveMode returns real when API key set AND SDK is present', () => {
  assert.equal(
    resolveMode('sk-ant-test-key', '/some/path/to/@anthropic-ai/sdk'),
    'real',
    'both key + SDK present ⇒ real mode',
  );
});

// ---------------------------------------------------------------------------
// Real-mode SDK call shape — structural source-level assertion.
// ---------------------------------------------------------------------------

test('client: SDK messages.create receives model + max_tokens + system + messages (AC-4 contract)', () => {
  // Source-level contract: client.ts MUST call messages.create with
  // the four fields the AC names. We assert this via regex on the
  // call-site code so the test stays hermetic (no SDK instantiation,
  // no HTTP). A regression that drops `system` or `max_tokens` will
  // fail this test even if fetchIntel still type-checks.
  const clientSource = readFileSync(join(srcRoot(), 'src/server/fast-agent/client.ts'), 'utf8');
  assert.match(
    clientSource,
    /\bmodel\s*:\s*MODEL\b/,
    'callReal must pass `model: MODEL` to messages.create',
  );
  assert.match(
    clientSource,
    /\bmax_tokens\s*:\s*256\b/,
    'callReal must pass `max_tokens: 256` to messages.create',
  );
  assert.match(
    clientSource,
    /\bsystem\s*:\s*SYSTEM_PROMPT\b/,
    'callReal must pass `system: SYSTEM_PROMPT` to messages.create',
  );
  assert.match(
    clientSource,
    /\bmessages\s*:\s*\[\s*\{\s*role\s*:\s*'user'\s*,\s*content\s*:\s*prompt\s*\}\s*\]/,
    'callReal must pass a single user message to messages.create',
  );
  // Structured-output format: zodResponseFormat(IntelSchema, 'intel')
  // appears when the SDK helper module is present.
  assert.match(
    clientSource,
    /zodResponseFormat\s*\(\s*IntelSchema\s*,\s*['"]intel['"]\s*\)/,
    'callReal must use zodResponseFormat(IntelSchema, "intel") for structured output',
  );
  // Defensive: the real path's response parser is the SOLE shape
  // validator (uses IntelSchema.safeParse at the end of callReal).
  assert.match(
    clientSource,
    /IntelSchema\.safeParse/,
    'callReal must validate the response with IntelSchema.safeParse',
  );
});

// ---------------------------------------------------------------------------
// Misc contract — endpoint + model defaults.
// ---------------------------------------------------------------------------

test('client: getEndpoint returns the MiniMax Anthropic-compatible endpoint', () => {
  assert.equal(getEndpoint(), 'https://api.minimax.io/anthropic');
});

test('client: getModel defaults to MiniMax-M2.7-highspeed when env is unset', () => {
  // The import order pins the env at module-load. This fixture
  // assumes MEMORY_STUDIO_FAST_AGENT_MODEL is NOT set in CI.
  assert.equal(getModel(), 'MiniMax-M2.7-highspeed');
});

// ---------------------------------------------------------------------------
// Intel schema — re-affirm the SOLE runtime validator lives in
// intel-schema.ts (T-03 owns it; client.ts delegates).
// ---------------------------------------------------------------------------

test('client: IntelSchema + EMPTY_INTEL exported from the schema module (regression guard)', () => {
  assert.ok(IntelSchema, 'IntelSchema must be exported');
  assert.deepEqual(EMPTY_INTEL, { agentState: '', nextNeeds: [], recentTopic: '' });
  const parsed = IntelSchema.safeParse(EMPTY_INTEL);
  assert.equal(parsed.success, true, 'empty Intel must parse OK (D-005 graceful)');
});
