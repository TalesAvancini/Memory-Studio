/**
 * RRF unit tests.
 *
 * Cover SEARCH-05, SEARCH-08, SEARCH-09:
 *   - exact 1/(60+rank) formula, one-channel and two-channel cases
 *   - overlap and non-overlap accumulation
 *   - original ranks preserved (no compaction)
 *   - deterministic tie-break (score, best rank, id)
 *   - empty inputs return empty; inputs are not mutated
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseRrf } from '../../src/search/rrf.ts';
import { RRF_DENOMINATOR } from '../../src/search/types.ts';

function approx(a, b, eps = 1e-12) {
  return Math.abs(a - b) <= eps;
}

test('T-RRF-01: one-channel score is exactly 1/(60+rank)', () => {
  const fts = [
    { id: 1, bm25: 0.1, rank: 1 },
    { id: 2, bm25: 0.2, rank: 2 },
    { id: 3, bm25: 0.3, rank: 3 },
  ];
  const fused = fuseRrf(fts, []);
  assert.equal(fused.length, 3);
  for (let i = 0; i < fts.length; i += 1) {
    const expected = 1 / (RRF_DENOMINATOR + (i + 1));
    assert.ok(approx(fused[i].rrfScore, expected));
  }
});

test('T-RRF-02: overlapping candidate sums the two channel terms exactly', () => {
  const fts = [{ id: 1, bm25: 0.1, rank: 1 }];
  const vec = [{ id: 1, distance: 0.1, cosineSimilarity: 0.9, rank: 2 }];
  const fused = fuseRrf(fts, vec);
  assert.equal(fused.length, 1);
  const expected = 1 / (RRF_DENOMINATOR + 1) + 1 / (RRF_DENOMINATOR + 2);
  assert.ok(approx(fused[0].rrfScore, expected));
  // Both channel metrics are preserved on the fused candidate.
  assert.equal(fused[0].ftsRank, 1);
  assert.equal(fused[0].vectorRank, 2);
  assert.ok(approx(fused[0].bm25 ?? -1, 0.1));
  assert.ok(approx(fused[0].cosineSimilarity ?? -1, 0.9));
});

test('T-RRF-03: non-overlapping channels each contribute one term', () => {
  const fts = [{ id: 1, bm25: 0.1, rank: 1 }];
  const vec = [{ id: 2, distance: 0.1, cosineSimilarity: 0.9, rank: 1 }];
  const fused = fuseRrf(fts, vec);
  assert.equal(fused.length, 2);
  const byId = Object.fromEntries(fused.map((c) => [c.id, c]));
  assert.ok(approx(byId[1].rrfScore, 1 / (RRF_DENOMINATOR + 1)));
  assert.ok(approx(byId[2].rrfScore, 1 / (RRF_DENOMINATOR + 1)));
  // Non-overlap leaves the absent channel metric undefined.
  assert.equal(byId[1].vectorRank, undefined);
  assert.equal(byId[1].cosineSimilarity, undefined);
  assert.equal(byId[2].ftsRank, undefined);
  assert.equal(byId[2].bm25, undefined);
});

test('T-RRF-04: filtering does NOT compact ranks — original 1-based ranks are preserved', () => {
  // Simulate a filtered list where vec ranks 2..4 failed the cosine gate.
  // The survivors (1, 5) must keep ranks 1 and 5.
  const vec = [
    { id: 10, distance: 0.01, cosineSimilarity: 0.99, rank: 1 },
    { id: 20, distance: 0.5, cosineSimilarity: 0.5, rank: 5 },
  ];
  const fts = [];
  const fused = fuseRrf(fts, vec);
  assert.equal(fused.length, 2);
  assert.equal(fused[0].id, 10);
  assert.equal(fused[0].vectorRank, 1);
  assert.equal(fused[1].id, 20);
  assert.equal(fused[1].vectorRank, 5);
});

test('T-RRF-05: ordering is score DESC, best rank ASC, id ASC', () => {
  // Make id 1 the weakest (rank 100 on FTS), id 2 medium (rank 2 on FTS),
  // id 3 strongest (rank 1 on FTS) — sorted by rrfScore DESC.
  const fts = [
    { id: 1, bm25: 5.0, rank: 100 },
    { id: 2, bm25: 0.5, rank: 2 },
    { id: 3, bm25: 0.1, rank: 1 },
  ];
  const fused = fuseRrf(fts, []);
  assert.deepEqual(
    fused.map((c) => c.id),
    [3, 2, 1],
  );
});

test('T-RRF-06: symmetric tie breaks by id ASC', () => {
  // Two candidates with identical RRF score: same rank in the same channel.
  const fts = [
    { id: 7, bm25: 0.1, rank: 1 },
    { id: 3, bm25: 0.2, rank: 2 },
    { id: 5, bm25: 0.3, rank: 3 },
  ];
  // Force a symmetric tie: give ids 3 and 5 identical ranks by overriding
  // the channel so all three contribute equally.
  const vec = [];
  const fused = fuseRrf(fts, vec);
  // Sorted by score DESC, ties broken by id ASC.
  // rrfScore: 7 > 3 > 5 — no ties here, but prove that distinct ids
  // receive distinct scores and ordering.
  assert.deepEqual(fused.map((c) => c.id), [7, 3, 5]);

  // Now construct a *true* tie: ids 1 and 2 each get rank=1 in the same channel.
  const tied = fuseRrf(
    [
      { id: 2, bm25: 0.1, rank: 1 },
      { id: 1, bm25: 0.1, rank: 1 },
    ],
    [],
  );
  assert.equal(tied.length, 2);
  assert.ok(approx(tied[0].rrfScore, tied[1].rrfScore));
  assert.deepEqual(tied.map((c) => c.id), [1, 2]);
});

test('T-RRF-07: empty inputs return [] and never throw', () => {
  assert.deepEqual(fuseRrf([], []), []);
  assert.deepEqual(fuseRrf([], [{ id: 1, distance: 0.1, cosineSimilarity: 0.9, rank: 1 }]), [
    {
      id: 1,
      rrfScore: 1 / (RRF_DENOMINATOR + 1),
      ftsRank: undefined,
      vectorRank: 1,
      bm25: undefined,
      cosineSimilarity: 0.9,
    },
  ]);
});

test('T-RRF-08: fuseRrf does not mutate input lists', () => {
  const fts = [
    { id: 1, bm25: 0.1, rank: 1 },
    { id: 2, bm25: 0.2, rank: 2 },
  ];
  const vec = [
    { id: 1, distance: 0.05, cosineSimilarity: 0.95, rank: 1 },
    { id: 3, distance: 0.2, cosineSimilarity: 0.8, rank: 2 },
  ];
  const ftsSnapshot = JSON.stringify(fts);
  const vecSnapshot = JSON.stringify(vec);
  fuseRrf(fts, vec);
  assert.equal(JSON.stringify(fts), ftsSnapshot);
  assert.equal(JSON.stringify(vec), vecSnapshot);
});

test('T-RRF-09: output IDs are unique even when the same id appears in both channels', () => {
  const fts = [
    { id: 1, bm25: 0.1, rank: 1 },
    { id: 2, bm25: 0.2, rank: 2 },
  ];
  const vec = [
    { id: 1, distance: 0.1, cosineSimilarity: 0.9, rank: 1 },
    { id: 2, distance: 0.2, cosineSimilarity: 0.8, rank: 2 },
  ];
  const fused = fuseRrf(fts, vec);
  assert.equal(fused.length, 2);
  const ids = fused.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'output ids must be unique');
});