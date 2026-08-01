/**
 * Unit test for `parsePortRangeEnv` — the parser that backs the
 * `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var honored by `boot.ts` when
 * it is invoked as the entry module.
 *
 * Phase 5a.4 (LOW 3a follow-up) — the env var was previously
 * "documented but not currently read" by `boot.ts` (see Phase 5a.3
 * Verifier report). LOW follow-up wires it in. This test guards the
 * parser's contract: only `"<lo>-<hi>"` with 0 <= lo <= hi <= 65535
 * parses; everything else returns `null` (which causes `boot.ts` to
 * fall back to `DEFAULT_AUGMENT_PORT_RANGE` and emit a stderr warning).
 *
 * The test runs in pure ESM Node — no Fastify, no server boot, no
 * network. It exercises the parser in isolation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parsePortRangeEnv } from '../../src/server/index.ts';

test('env-var: undefined input returns null (boot.ts falls back to default)', () => {
  assert.equal(parsePortRangeEnv(undefined), null);
});

test('env-var: empty string input returns null', () => {
  assert.equal(parsePortRangeEnv(''), null);
});

test('env-var: valid "lo-hi" parses to [lo, hi]', () => {
  assert.deepEqual(parsePortRangeEnv('42900-43000'), [42900, 43000]);
});

test('env-var: same-port range ("43900-43900") parses to [43900, 43900]', () => {
  // Used by the E2E test (T-13) to pin a single port.
  assert.deepEqual(parsePortRangeEnv('43900-43900'), [43900, 43900]);
});

test('env-var: minimum range ("0-0") parses to [0, 0]', () => {
  assert.deepEqual(parsePortRangeEnv('0-0'), [0, 0]);
});

test('env-var: maximum range ("0-65535") parses to [0, 65535]', () => {
  assert.deepEqual(parsePortRangeEnv('0-65535'), [0, 65535]);
});

test('env-var: range with no hyphen returns null', () => {
  assert.equal(parsePortRangeEnv('42900'), null);
});

test('env-var: range with non-numeric values returns null', () => {
  assert.equal(parsePortRangeEnv('abc-def'), null);
});

test('env-var: range with mixed alpha/numeric returns null', () => {
  assert.equal(parsePortRangeEnv('42900-abc'), null);
  assert.equal(parsePortRangeEnv('abc-43000'), null);
});

test('env-var: range with three parts returns null (regex requires exactly one hyphen)', () => {
  assert.equal(parsePortRangeEnv('42900-43000-43100'), null);
});

test('env-var: inverted range (lo > hi) returns null', () => {
  assert.equal(parsePortRangeEnv('43000-42900'), null);
});

test('env-var: range with hi > 65535 returns null', () => {
  assert.equal(parsePortRangeEnv('0-65536'), null);
  assert.equal(parsePortRangeEnv('0-99999'), null);
});

test('env-var: range with lo > 65535 returns null', () => {
  assert.equal(parsePortRangeEnv('65536-65536'), null);
});

test('env-var: range with whitespace returns null', () => {
  assert.equal(parsePortRangeEnv(' 42900-43000 '), null);
  assert.equal(parsePortRangeEnv('42900 - 43000'), null);
});

test('env-var: leading/trailing dashes return null', () => {
  assert.equal(parsePortRangeEnv('-42900-43000'), null);
  assert.equal(parsePortRangeEnv('42900-43000-'), null);
});

test('env-var: empty lo or hi returns null', () => {
  assert.equal(parsePortRangeEnv('-43000'), null);
  assert.equal(parsePortRangeEnv('42900-'), null);
});
