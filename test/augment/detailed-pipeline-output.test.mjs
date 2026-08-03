/**
 * Phase 7b T-02 detailed pipeline seam tests.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAugment, runAugmentDetailed } from '../../src/server/augment/pipeline.ts';
import { canonicalSha256 } from '../../src/server/augment/byte-string.ts';

const request = {
  prompt: 'find the boundary item',
  context: null,
  fingerprint: {
    projectPath: '.',
    agentId: 'claude-code',
    sessionId: 'session-hash',
    gitBranch: 'main',
  },
  activeCatalog: ['matched-skill'],
  schemaVersion: 3,
};

const context = {
  db: {},
  embedder: { dimensions: 384, async encode() { return new Float32Array(384); } },
  thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
  originalSystemText: 'ORIGINAL SYSTEM',
  retrieve() {
    return {
      ranked: [{
        id: 1,
        slug: 'matched-skill',
        kind: 'skill',
        text: 'MATCHED SKILL BODY',
        rrfScore: 1,
        ftsRank: 1,
        cosineSimilarity: 0.9,
      }],
      ftsTotalHits: 1,
      retrievalMs: 0,
    };
  },
};

test('detailed seam returns exact blocks and public wrapper remains compatible', async () => {
  const detailed = await runAugmentDetailed(request, context);
  const publicResponse = await runAugment(request, context);

  assert.equal(detailed.response.systemMessage, canonicalSha256(detailed.system));
  assert.equal(detailed.response.systemMessage, publicResponse.systemMessage);
  assert.equal(detailed.system[0].text.includes('ORIGINAL SYSTEM'), true);
  assert.equal(detailed.system[1].text.includes('MATCHED SKILL BODY'), true);
  assert.equal(detailed.system.length, 2);
});
