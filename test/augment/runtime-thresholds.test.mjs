/**
 * Phase 7b T-01 full state-to-pipeline threshold seam test.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAugment } from '../../src/server/augment/pipeline.ts';

function request() {
  return {
    prompt: 'boundary prompt',
    context: null,
    fingerprint: {
      projectPath: '/fixture',
      agentId: 'claude-code',
      sessionId: 'fixture-session',
      gitBranch: 'main',
    },
    activeCatalog: ['boundary-item'],
    schemaVersion: 3,
  };
}

const ranked = [{
  id: 1,
  slug: 'boundary-item',
  kind: 'skill',
  text: 'boundary item text',
  rrfScore: 1,
  ftsRank: 1,
  cosineSimilarity: 0.65,
}];

function context(thresholds) {
  return {
    db: {},
    embedder: {
      dimensions: 384,
      async encode() { return new Float32Array(384); },
    },
    thresholds,
    retrieve() {
      return { ranked, ftsTotalHits: 2, retrievalMs: 0 };
    },
  };
}

test('runtime thresholds change the full pipeline outcome at the boundary', async () => {
  const configured = await runAugment(
    request(),
    context({ minCosineSimilarity: 0.6, minFtsHits: 2 }),
  );
  const pre7b = await runAugment(
    request(),
    context({ minCosineSimilarity: 0.75, minFtsHits: 1 }),
  );

  assert.deepEqual(configured.matchedSkills.map((item) => item.id), ['boundary-item']);
  assert.deepEqual(pre7b.matchedSkills, []);
  assert.equal(pre7b.emptyReason, 'low_confidence');
});
