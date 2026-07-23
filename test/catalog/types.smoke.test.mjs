/**
 * Smoke test placeholder for the catalog domain.
 * T2 adds the public types + error hierarchy; real assertions come with T3+.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LoaderError,
  WriterError,
  SchemaError,
  EmbedderError,
} from '../../src/catalog/errors.ts';
import { VALID_KINDS, SLUG_PATTERN } from '../../src/catalog/types.ts';

test('T-SMOKE-01: error classes extend Error and carry their own name', () => {
  const loaderErr = new LoaderError('boom', 'INVALID_KIND', 'p.yaml');
  const writerErr = new WriterError('dup', 'HASH_COLLISION');
  const schemaErr = new SchemaError('ddl', 'DB_ERROR');
  const embedErr = new EmbedderError('nan', 'ENCODING_FAILED');

  assert.ok(loaderErr instanceof Error);
  assert.ok(loaderErr instanceof LoaderError);
  assert.equal(loaderErr.name, 'LoaderError');
  assert.equal(loaderErr.code, 'INVALID_KIND');
  assert.equal(loaderErr.path, 'p.yaml');

  assert.ok(writerErr instanceof Error);
  assert.ok(writerErr instanceof WriterError);
  assert.equal(writerErr.name, 'WriterError');

  assert.ok(schemaErr instanceof Error);
  assert.ok(schemaErr instanceof SchemaError);
  assert.equal(schemaErr.name, 'SchemaError');

  assert.ok(embedErr instanceof Error);
  assert.ok(embedErr instanceof EmbedderError);
  assert.equal(embedErr.name, 'EmbedderError');
});

test('T-SMOKE-02: valid kinds enum is the documented triplet', () => {
  assert.deepEqual([...VALID_KINDS], ['skill', 'rule', 'persona']);
});

test('T-SMOKE-03: slug pattern accepts kebab-case and rejects junk', () => {
  assert.equal(SLUG_PATTERN.test('auth-jwt-01'), true);
  assert.equal(SLUG_PATTERN.test('react-debug'), true);
  assert.equal(SLUG_PATTERN.test('a'), true);
  assert.equal(SLUG_PATTERN.test('Auth-JWT'), false);
  assert.equal(SLUG_PATTERN.test('auth_jwt'), false);
  assert.equal(SLUG_PATTERN.test('auth--jwt'), false);
  assert.equal(SLUG_PATTERN.test('-auth'), false);
  assert.equal(SLUG_PATTERN.test(''), false);
});