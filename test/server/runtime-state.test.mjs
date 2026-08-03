/**
 * Phase 7b T-01 runtime-state adapter tests.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RuntimeStateValidationError,
  parseRuntimeState,
  resolveStatePath,
} from '../../src/server/config/runtime-state.ts';

test('runtime state parses and freezes the configured catalog and thresholds', () => {
  const snapshot = parseRuntimeState(JSON.stringify({
    schemaVersion: 3,
    stateVersion: 7,
    activeCatalog: ['skill-a', 'rule-b'],
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
  }), 1234);

  assert.deepEqual(snapshot.activeCatalog, ['skill-a', 'rule-b']);
  assert.deepEqual(snapshot.thresholds, {
    minCosineSimilarity: 0.6,
    minFtsHits: 2,
  });
  assert.equal(snapshot.stateVersion, 7);
  assert.equal(snapshot.loadedAt, 1234);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.activeCatalog));
  assert.ok(Object.isFrozen(snapshot.thresholds));
});

test('runtime state rejects missing and out-of-range production fields', () => {
  assert.throws(
    () => parseRuntimeState(JSON.stringify({ activeCatalog: [], thresholds: { minCosineSimilarity: 0.6 } })),
    (error) => error instanceof RuntimeStateValidationError && error.field === 'minFtsHits',
  );
  assert.throws(
    () => parseRuntimeState(JSON.stringify({ activeCatalog: [], thresholds: { minCosineSimilarity: 1.1, minFtsHits: 2 } })),
    (error) => error instanceof RuntimeStateValidationError && error.field === 'minCosineSimilarity',
  );
  assert.throws(
    () => parseRuntimeState(JSON.stringify({ activeCatalog: ['ok', 1], thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 } })),
    (error) => error instanceof RuntimeStateValidationError && error.field === 'activeCatalog',
  );
});

test('state path precedence is explicit, then env, then cwd', () => {
  const normalize = (value) => value.replaceAll('\\', '/');
  assert.equal(
    normalize(resolveStatePath({ path: 'fixture/state.json', env: { MEMORY_STUDIO_STATE_PATH: 'ignored.json' }, cwd: 'C:/project' })),
    'C:/project/fixture/state.json',
  );
  assert.equal(
    normalize(resolveStatePath({ env: { MEMORY_STUDIO_STATE_PATH: 'fixture/state.json' }, cwd: 'C:/project' })),
    'C:/project/fixture/state.json',
  );
  assert.equal(
    normalize(resolveStatePath({ cwd: 'C:/project' })),
    'C:/project/.memory-studio/state.json',
  );
});
