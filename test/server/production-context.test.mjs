/**
 * Phase 7b T-01 production context tests.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createProductionContext } from '../../src/server/config/production-context.ts';

const state = JSON.stringify({
  schemaVersion: 3,
  activeCatalog: ['skill-a'],
  thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
});

test('production context reads one state snapshot and threads it into the pipeline', async () => {
  const db = new Database(':memory:');
  let reads = 0;
  const context = createProductionContext({
    db,
    embedder: {
      dimensions: 384,
      async encode() { return new Float32Array(384); },
    },
    catalogDir: 'config/catalog',
    statePath: 'fixture-state.json',
    stateReader: async () => {
      reads += 1;
      return state;
    },
    now: () => 9876,
  });

  const request = await context.requestContext({ sessionId: 'hashed-session' });
  assert.equal(reads, 1);
  assert.deepEqual(request.state.activeCatalog, ['skill-a']);
  assert.deepEqual(request.pipeline.thresholds, {
    minCosineSimilarity: 0.6,
    minFtsHits: 2,
  });
  assert.equal(request.pipeline.sessionId, 'hashed-session');
  assert.equal(request.pipeline.db, db);
  assert.equal(request.pipeline.catalogDir.endsWith('config\\catalog') || request.pipeline.catalogDir.endsWith('config/catalog'), true);

  db.close();
});

test('production context does not silently substitute the zero-vector embedder', () => {
  const embedder = {
    dimensions: 384,
    async encode() { return new Float32Array(384); },
  };
  const db = new Database(':memory:');
  const context = createProductionContext({ db, embedder, stateReader: async () => state });
  assert.equal(context.embedder, embedder);
  db.close();
});

void assert;
