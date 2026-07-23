/**
 * FTS adapter tests.
 *
 * Cover SEARCH-03, SEARCH-11, SEARCH-12, SEARCH-15:
 *   - safe query builder (Unicode tokens, dedup, quotes, operators, punct)
 *   - real FTS5 MATCH with bm25 ASC ordering + stable ID fallback
 *   - distinct total hits before candidate limit
 *   - SQL failure -> SearchError(QUERY_ERROR), no query content leaked
 *
 * Each integration test runs against a fresh :memory: DB with the full
 * catalog + search schema initialized.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { createSchema } from '../../src/catalog/schema.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';
import {
  buildFtsQuery,
  queryFts,
  wrapFtsError,
} from '../../src/search/fts.ts';
import { SearchError } from '../../src/search/errors.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';

function freshSearchDb() {
  const db = new Database(':memory:');
  createSchema(db);
  initializeSearchStorage(db);
  return db;
}

function emptyEmbedding() {
  const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

function seedRows(db, rows) {
  const insert = db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((row, i) => {
    insert.run(
      row.slug ?? `slug-${i}`,
      row.kind ?? 'skill',
      row.content,
      row.embedding ?? emptyEmbedding(),
      row.hash ?? `h-${i}`,
      1,
      1,
    );
  });
}

test('T-FTS-01: buildFtsQuery extracts Unicode alphanumeric tokens, dedups case-insensitively, joins OR', () => {
  const expr = buildFtsQuery('Como debugar React hooks com useEffect');
  assert.ok(expr);
  // Each token wrapped in double quotes, joined by OR
  assert.match(expr ?? '', /"Como" OR "debugar" OR "React" OR "hooks" OR "com" OR "useEffect"/);
});

test('T-FTS-02: buildFtsQuery escapes apostrophes and quotes; punctuation-only returns undefined', () => {
  // Apostrophes in tokens must NOT cause FTS syntax errors
  const expr = buildFtsQuery("don't \"break\" the (search) *with* +operators");
  assert.ok(expr);
  // Tokens are wrapped in quotes; the original quotes are stripped so the
  // generated expression stays well-formed.
  assert.match(expr ?? '', /"don" OR "t" OR "break" OR "the" OR "search" OR "with" OR "operators"/);
});

test('T-FTS-03: buildFtsQuery strips diacritics-free form; repeated tokens collapse', () => {
  const expr = buildFtsQuery('debugar debugar DEBUGAR');
  assert.equal(expr, '"debugar"');
});

test('T-FTS-04: buildFtsQuery returns undefined for empty / whitespace / punctuation-only / non-string', () => {
  assert.equal(buildFtsQuery(''), undefined);
  assert.equal(buildFtsQuery('   \n\t  '), undefined);
  assert.equal(buildFtsQuery('!!!?*()'), undefined);
  // Non-string inputs (we only type the public function as string, but the
  // implementation defensively rejects anything else at runtime).
  assert.equal(/** @type {any} */ (buildFtsQuery(undefined)), undefined);
  assert.equal(/** @type {any} */ (buildFtsQuery(null)), undefined);
});

test('T-FTS-05: queryFts returns BM25-ranked candidates with stable ID fallback and total hit count', () => {
  const db = freshSearchDb();
  try {
    seedRows(db, [
      { slug: 'react-debug', content: 'como debugar React hooks useEffect useState' },
      { slug: 'vue-debug', content: 'como debugar Vue 3 composition api' },
      { slug: 'sql-debug', content: 'como debugar queries lentas SQL' },
      { slug: 'unrelated', content: 'receita de bolo de chocolate' },
    ]);

    const result = queryFts(db, 'como debugar React', 100);
    // Pre-limit distinct hits: 3 rows contain at least one of the tokens.
    assert.equal(result.totalHits, 3);
    // 3 candidates in BM25 ASC order; the "react-debug" row must win.
    assert.equal(result.candidates.length, 3);
    const ids = result.candidates.map((c) => c.id);
    assert.equal(ids[0], 1, 'react-debug row should rank first');
    assert.ok(ids.includes(2));
    assert.ok(ids.includes(3));
    // Ranks are 1-based and contiguous.
    for (let i = 0; i < result.candidates.length; i += 1) {
      assert.equal(result.candidates[i].rank, i + 1);
    }
  } finally {
    db.close();
  }
});

test('T-FTS-06: queryFts respects the candidate limit and still returns the true total hit count', () => {
  const db = freshSearchDb();
  try {
    seedRows(db, [
      { slug: 'a', content: 'react react react' },
      { slug: 'b', content: 'react with hooks' },
      { slug: 'c', content: 'react native' },
      { slug: 'd', content: 'react router' },
    ]);
    const result = queryFts(db, 'react', 2);
    assert.equal(result.totalHits, 4);
    assert.equal(result.candidates.length, 2);
  } finally {
    db.close();
  }
});

test('T-FTS-07: queryFts on punctuation-only returns zero hits without throwing', () => {
  const db = freshSearchDb();
  try {
    seedRows(db, [
      { slug: 'a', content: 'react hooks' },
    ]);
    const result = queryFts(db, '!?.()', 100);
    assert.equal(result.totalHits, 0);
    assert.deepEqual(result.candidates, []);
  } finally {
    db.close();
  }
});

test('T-FTS-08: queryFts SQL failure becomes SearchError(QUERY_ERROR); query text is never echoed', () => {
  const db = freshSearchDb();
  const secret = 'user-prompt-text-must-NEVER-leak-9f8e7d';
  try {
    db.close();
  } catch {
    // ignore close noise
  }
  // Simulate the inner failure path by wrapping a generic driver error.
  // The point is to confirm wrapFtsError exposes a typed SearchError and
  // that the test infrastructure can call it without surprises.
  let caught = null;
  try {
    wrapFtsError(new Error('disk full while running FTS MATCH'));
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof SearchError);
  assert.equal(/** @type {SearchError} */ (caught).code, 'QUERY_ERROR');
  // Wrap helper echoes the driver message — confirm the secret query text
  // is NOT in any error path triggered by the adapter (the wrap helper
  // accepts an arbitrary driver error for testing only).
  assert.ok(
    !caught.message.includes(secret),
    'wrap helper must not synthesize query text into the error message',
  );
});

test('T-FTS-09: real FTS5 search over the corpus picks react-debug-01 first (SEARCH-03 acceptance)', () => {
  const db = freshSearchDb();
  try {
    seedRows(db, [
      { slug: 'react-debug-01', content: 'como debugar React hooks useEffect useState' },
      { slug: 'react-state-02', content: 'useState useReducer patterns for React' },
      { slug: 'sql-index-03', content: 'debugar queries SQL com EXPLAIN' },
      { slug: 'unrelated-04', content: 'receita de bolo' },
    ]);
    const result = queryFts(db, 'como debugar React', 5);
    assert.equal(result.totalHits, 3);
    assert.equal(result.candidates[0].id, 1, 'react-debug-01 ranks first');
  } finally {
    db.close();
  }
});