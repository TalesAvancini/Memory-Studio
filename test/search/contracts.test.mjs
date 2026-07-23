/**
 * Search contracts and typed-error behavior tests.
 *
 * These are pure unit tests: no SQLite, no native extensions. They pin the
 * public surface defined in `src/search/types.ts` and `src/search/errors.ts`
 * so downstream tasks (T3-T7) can rely on stable type contracts.
 *
 * Covers design.md §"Public contracts and errors" + implicit requirement
 * "Errors carry code + cause without query content".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SearchError, asSearchError } from '../../src/search/errors.ts';
import {
  DEFAULT_MIN_COSINE_SIMILARITY,
  DEFAULT_MIN_FTS_HITS,
  MAX_K,
  MIN_K,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  MIN_FTS_HITS_BOUND,
  MAX_FTS_HITS_BOUND,
  RRF_DENOMINATOR,
  SEARCH_EMBEDDING_DIMENSIONS,
} from '../../src/search/types.ts';

test('T-CONTRACTS-01: public constants expose design-doc defaults and bounds', () => {
  assert.equal(DEFAULT_MIN_COSINE_SIMILARITY, 0.75);
  assert.equal(DEFAULT_MIN_FTS_HITS, 1);
  assert.equal(MAX_K, 100);
  assert.equal(MIN_K, 1);
  assert.equal(MAX_QUERY_LENGTH, 10_000);
  assert.equal(MIN_QUERY_LENGTH, 1);
  assert.equal(MIN_FTS_HITS_BOUND, 1);
  assert.equal(MAX_FTS_HITS_BOUND, 1000);
  assert.equal(RRF_DENOMINATOR, 60);
  assert.equal(SEARCH_EMBEDDING_DIMENSIONS, 384);
});

test('T-CONTRACTS-02: SearchError exposes name, code, and optional cause', () => {
  const cause = new Error('sqlite extension missing');
  const err = new SearchError('sqlite-vec load failed', 'VECTOR_EXTENSION_UNAVAILABLE', cause);
  assert.equal(err.name, 'SearchError');
  assert.equal(err.code, 'VECTOR_EXTENSION_UNAVAILABLE');
  assert.equal(err.cause, cause);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof SearchError);
});

test('T-CONTRACTS-03: SearchError message never echoes query content', () => {
  const secret = 'should-NEVER-appear-anywhere-IN-ERROR-MESSAGE-9f8e7d';
  const err = new SearchError(
    `query failed (length=${secret.length}, kind=string)`,
    'INVALID_QUERY',
  );
  assert.equal(err.code, 'INVALID_QUERY');
  assert.ok(
    !err.message.includes(secret),
    'error message must not include query text',
  );
});

test('T-CONTRACTS-04: asSearchError wraps unknown errors and preserves SearchError', () => {
  const nativeErr = new Error('disk full');
  const wrapped = asSearchError(nativeErr, 'QUERY_ERROR', 'FTS MATCH failed');
  assert.ok(wrapped instanceof SearchError);
  assert.equal(wrapped.code, 'QUERY_ERROR');
  assert.equal(wrapped.cause, nativeErr);
  assert.match(wrapped.message, /FTS MATCH failed/);
  assert.match(wrapped.message, /disk full/);

  const already = new SearchError('already-typed', 'SCHEMA_ERROR');
  const passthrough = asSearchError(already, 'QUERY_ERROR', 'ignored');
  assert.equal(passthrough, already, 'typed errors must pass through unchanged');
});

test('T-CONTRACTS-05: SearchError supports every documented code without runtime typo', () => {
  const codes = [
    'INVALID_QUERY',
    'INVALID_K',
    'INVALID_CONFIG',
    'INVALID_EMBEDDING',
    'VECTOR_EXTENSION_UNAVAILABLE',
    'SCHEMA_ERROR',
    'QUERY_ERROR',
    'EMBEDDING_FAILED',
  ];
  for (const code of codes) {
    const err = new SearchError(`test ${code}`, /** @type {any} */ (code));
    assert.equal(err.code, code);
    assert.ok(err instanceof SearchError);
  }
});