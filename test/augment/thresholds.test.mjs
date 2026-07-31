/**
 * Double-threshold gate tests.
 *
 * Phase 5a.2 (T-06) — proves the `applyThresholds()` + `validateActiveCatalogIds()`
 * behavior per PRD §8 invariante sólida 7:
 *   "a candidate passes ONLY if cosine_similarity >= 0.75
 *    AND bm25_hits >= 1".
 *
 * Rejections land in `rejectedByFloor[]` with a structured reason
 * (below_cosine_threshold | below_fts_threshold | id_not_in_catalog).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyThresholds,
  validateActiveCatalogIds,
} from '../../src/server/augment/thresholds.ts';

function makeItem(overrides = {}) {
  return {
    id: 1,
    slug: 'skill-auth-01',
    kind: 'skill',
    text: 'JWT validation',
    rrfScore: 0.01,
    ftsRank: 1,
    vectorRank: 1,
    bm25: 0.1,
    cosineSimilarity: 0.9,
    ...overrides,
  };
}

test('thresholds: cosine >= 0.75 AND ftsRank present → passes', () => {
  const out = applyThresholds([makeItem()]);
  assert.equal(out.passed.length, 1);
  assert.equal(out.rejected.length, 0);
});

test('thresholds: cosine < 0.75 → rejected with below_cosine_threshold', () => {
  const out = applyThresholds([makeItem({ cosineSimilarity: 0.5 })]);
  assert.equal(out.passed.length, 0);
  assert.equal(out.rejected.length, 1);
  assert.equal(out.rejected[0].id, 'skill-auth-01');
  assert.equal(out.rejected[0].reason, 'below_cosine_threshold');
});

test('thresholds: cosine undefined (FTS-only path) → rejected with below_cosine_threshold', () => {
  const out = applyThresholds([makeItem({ cosineSimilarity: undefined, vectorRank: undefined })]);
  assert.equal(out.passed.length, 0);
  assert.equal(out.rejected[0].reason, 'below_cosine_threshold');
});

test('thresholds: cosine high but no FTS rank → rejected with below_fts_threshold', () => {
  const out = applyThresholds([makeItem({ ftsRank: undefined, bm25: undefined })]);
  assert.equal(out.passed.length, 0);
  assert.equal(out.rejected[0].reason, 'below_fts_threshold');
});

test('thresholds: edge case cosine = 0.75 exactly → passes (>=)', () => {
  const out = applyThresholds([makeItem({ cosineSimilarity: 0.75 })]);
  assert.equal(out.passed.length, 1);
  assert.equal(out.rejected.length, 0);
});

test('thresholds: ftsHitCountBySlug override enforces per-slug floor', () => {
  const ftsHits = new Map([['skill-auth-01', 0]]);
  const out = applyThresholds([makeItem()], { ftsHitCountBySlug: ftsHits, minFtsHits: 1 });
  assert.equal(out.passed.length, 0);
  assert.equal(out.rejected[0].reason, 'below_fts_threshold');
});

test('thresholds: validateActiveCatalogIds marks missing YAMLs as id_not_in_catalog', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  try {
    writeFileSync(join(dir, 'present-id.yaml'), 'id: present-id\n');
    const { valid, rejected } = validateActiveCatalogIds(
      ['present-id', 'missing-id'],
      dir,
    );
    assert.deepEqual(valid, ['present-id']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].id, 'missing-id');
    assert.equal(rejected[0].reason, 'id_not_in_catalog');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('thresholds: validateActiveCatalogIds with empty input returns empty result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-'));
  try {
    const { valid, rejected } = validateActiveCatalogIds([], dir);
    assert.deepEqual(valid, []);
    assert.deepEqual(rejected, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
