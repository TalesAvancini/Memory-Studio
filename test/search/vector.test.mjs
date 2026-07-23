/**
 * Vector adapter tests.
 *
 * Cover SEARCH-04, SEARCH-10, SEARCH-12, SEARCH-13, SEARCH-15:
 *   - validateEmbedding rejects wrong-dim / NaN / Infinity
 *   - queryVector returns 1-based ranks, distance ASC, 1 - distance similarity
 *   - self/orthogonal/opposite vectors rank in expected order
 *   - empty table -> []
 *   - SQL failure -> SearchError(QUERY_ERROR) with cause
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createSchema } from '../../src/catalog/schema.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';
import {
  queryVector,
  validateEmbedding,
} from '../../src/search/vector.ts';
import { SearchError } from '../../src/search/errors.ts';
import {
  SEARCH_EMBEDDING_DIMENSIONS,
} from '../../src/search/types.ts';

function freshSearchDb() {
  const db = new Database(':memory:');
  createSchema(db);
  initializeSearchStorage(db);
  return db;
}

function makeUnitVector(scale = 1) {
  // Unit vector along dimension 0: e_i normalized
  const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  arr[0] = scale;
  return arr;
}

function makeOrthogonalVector() {
  const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  arr[1] = 1;
  return arr;
}

function makeOppositeVector() {
  const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  arr[0] = -1;
  return arr;
}

function embeddingBuffer(arr) {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function seedEmbedding(db, id, arr) {
  db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`slug-${id}`, 'skill', `content-${id}`, embeddingBuffer(arr), `h-${id}`, 1, 1);
}

test('T-VEC-01: validateEmbedding accepts a 384-dim Float32Array of finite values', () => {
  const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  assert.doesNotThrow(() => validateEmbedding(arr));
});

test('T-VEC-02: validateEmbedding rejects wrong-dim and NaN/Infinity inputs with INVALID_EMBEDDING', () => {
  // wrong length
  let caught = null;
  try {
    validateEmbedding(new Float32Array(100));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'INVALID_EMBEDDING');

  // non-Float32Array
  caught = null;
  try {
    validateEmbedding(/** @type {any} */ ([1, 2, 3]));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'INVALID_EMBEDDING');

  // NaN
  const nanArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  nanArr[10] = Number.NaN;
  caught = null;
  try {
    validateEmbedding(nanArr);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'INVALID_EMBEDDING');

  // Infinity
  const infArr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  infArr[5] = Number.POSITIVE_INFINITY;
  caught = null;
  try {
    validateEmbedding(infArr);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'INVALID_EMBEDDING');
});

test('T-VEC-03: queryVector ranks self > orthogonal > opposite for a controlled corpus (SEARCH-04)', () => {
  const db = freshSearchDb();
  try {
    seedEmbedding(db, 1, makeOrthogonalVector());
    seedEmbedding(db, 2, makeUnitVector(1));
    seedEmbedding(db, 3, makeOppositeVector());

    const query = makeUnitVector(1);
    const candidates = queryVector(db, query, 10);
    assert.equal(candidates.length, 3);
    // Self (id=2) has cosine distance 0 -> rank 1
    assert.equal(candidates[0].id, 2);
    assert.equal(candidates[0].rank, 1);
    assert.equal(candidates[0].distance, 0);
    assert.equal(candidates[0].cosineSimilarity, 1);
    // Opposite vector has the highest cosine distance -> rank 3
    assert.equal(candidates[2].id, 3);
    // Orthogonal sits in the middle
    assert.equal(candidates[1].id, 1);
    // 1 - distance is finite for every candidate.
    for (const c of candidates) {
      assert.ok(Number.isFinite(c.cosineSimilarity));
      assert.ok(Number.isFinite(c.distance));
    }
  } finally {
    db.close();
  }
});

test('T-VEC-04: queryVector returns [] on empty table without throwing', () => {
  const db = freshSearchDb();
  try {
    const candidates = queryVector(db, makeUnitVector(1), 10);
    assert.deepEqual(candidates, []);
  } finally {
    db.close();
  }
});

test('T-VEC-05: queryVector SQL failure becomes SearchError(QUERY_ERROR)', () => {
  const db = freshSearchDb();
  try {
    seedEmbedding(db, 1, makeUnitVector(1));
    db.close();
  } catch {
    // ignore
  }
  let caught = null;
  try {
    queryVector(db, makeUnitVector(1), 5);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'QUERY_ERROR');
});

test('T-VEC-06: queryVector caps at the limit and preserves 1-based ranks (SEARCH-04)', () => {
  const db = freshSearchDb();
  try {
    for (let i = 1; i <= 5; i += 1) {
      // Each row gets a unit vector pointing in a unique dimension so
      // cosine distances are monotonically non-decreasing.
      const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
      arr[i - 1] = 1;
      seedEmbedding(db, i, arr);
    }
    const query = makeUnitVector(1); // query points at dim 0
    const all = queryVector(db, query, 100);
    assert.equal(all.length, 5);
    assert.equal(all[0].id, 1, 'exact match ranks first');
    assert.equal(all[0].cosineSimilarity, 1);

    const limited = queryVector(db, query, 2);
    assert.equal(limited.length, 2);
    assert.equal(limited[0].rank, 1);
    assert.equal(limited[1].rank, 2);
  } finally {
    db.close();
  }
});

test('T-VEC-07: queryVector cosineSimilarity is finite and equals 1 - distance for every result', () => {
  const db = freshSearchDb();
  try {
    seedEmbedding(db, 1, makeUnitVector(1));
    seedEmbedding(db, 2, makeOrthogonalVector());
    const candidates = queryVector(db, makeUnitVector(1), 10);
    for (const c of candidates) {
      assert.ok(Math.abs(c.cosineSimilarity - (1 - c.distance)) < 1e-6);
      assert.ok(c.cosineSimilarity >= -1.0000001);
      assert.ok(c.cosineSimilarity <= 1.0000001);
    }
  } finally {
    db.close();
  }
});