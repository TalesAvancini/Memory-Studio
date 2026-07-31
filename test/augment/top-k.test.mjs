/**
 * Top-K selection + tiebreak ordering tests.
 *
 * Phase 5a.2 (T-07) — proves PRD §10.1 item 2 + D-006:
 *   - 3-5 items, truncate at maxK, warn when < minK
 *   - PRIMARY ordering by `slug.localeCompare` ASC (score-INDEPENDENT)
 *   - SECONDARY tiebreak by `b.rrfScore - a.rrfScore` only on slug
 *     collision (rare — slugs are stable kebab-case per SPEC §IMod-6)
 *   - 1000 random-score requests → identical byte-string (D-006 done)
 *
 * The PRIMARY slug sort happens BEFORE byte-string serialization so
 * the SHA-256 is stable across runs with different RRF score
 * perturbations. Iter 2 corrected the comparator (was: RRF DESC primary,
 * slug ASC secondary). The full 1000-iteration stress test lives in
 * `test/augment/byte-string-determinism.test.mjs`; this file proves
 * the same invariant on a smaller surface.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topKAndTiebreak, DEFAULT_MIN_K, DEFAULT_MAX_K } from '../../src/server/augment/top-k.ts';
import { canonicalSha256 } from '../../src/server/augment/byte-string.ts';

function makeItem(overrides) {
  return {
    id: 0,
    slug: '',
    kind: 'skill',
    text: '',
    rrfScore: 0,
    ...overrides,
  };
}

test('top-k: 7 candidates → top 5 returned (truncation by maxK)', () => {
  const ranked = Array.from({ length: 7 }, (_, i) =>
    makeItem({ id: i + 1, slug: `s-${i + 1}`, rrfScore: 1 / (60 + i + 1) }),
  );
  const { matched, warnings } = topKAndTiebreak(ranked);
  assert.equal(matched.length, DEFAULT_MAX_K);
  // PRIMARY sort is slug ASC → first 5 slugs are s-1..s-5. RRF score is
  // the secondary tiebreak and only matters on slug collisions (none here).
  assert.deepEqual(
    matched.map((m) => m.slug),
    ['s-1', 's-2', 's-3', 's-4', 's-5'],
  );
  assert.equal(warnings.length, 0);
});

test('top-k: 2 candidates → both returned + warning (below minK)', () => {
  const ranked = [makeItem({ slug: 'a' }), makeItem({ slug: 'b' })];
  const { matched, warnings } = topKAndTiebreak(ranked);
  assert.equal(matched.length, 2);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /only 2 items above threshold/);
});

test('top-k: PRIMARY ordering by slug.localeCompare ASC', () => {
  // Same input as before but with intentionally swapped scores to
  // prove the comparator is score-INDEPENDENT: even when the higher-
  // scoring slug is later in the alphabet, it MUST NOT float to the top.
  const ranked = [
    makeItem({ slug: 'zebra', rrfScore: 0.99 }),
    makeItem({ slug: 'mango', rrfScore: 0.10 }),
    makeItem({ slug: 'alpha', rrfScore: 0.10 }),
  ];
  const { matched } = topKAndTiebreak(ranked);
  assert.deepEqual(
    matched.map((m) => m.slug),
    ['alpha', 'mango', 'zebra'],
    'order must be slug ASC, NOT score DESC',
  );
});

test('top-k: reverse-order input is re-sorted by slug ASC (PRIMARY)', () => {
  const ranked = [
    makeItem({ slug: 'c', rrfScore: 0.01 }),
    makeItem({ slug: 'b', rrfScore: 0.02 }),
    makeItem({ slug: 'a', rrfScore: 0.03 }),
  ];
  const { matched } = topKAndTiebreak(ranked);
  assert.deepEqual(
    matched.map((m) => m.slug),
    ['a', 'b', 'c'],
  );
});

test('top-k: empty input → empty output + warning', () => {
  const { matched, warnings } = topKAndTiebreak([]);
  assert.equal(matched.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /only 0 items/);
});

test('top-k: stable score-order input preserves byte-string under score perturbation (D-006)', () => {
  // Sanity check on the easy case: input is already in slug order; the
  // PRIMARY slug sort produces the same SHA-256 regardless of where the
  // scores land. This proves the byte-string-building pipeline is hooked
  // to slug order, not score order.
  const fixedSlugs = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  const fixedSet = fixedSlugs.map((slug, i) =>
    makeItem({ slug, rrfScore: 1 / (60 + i + 1) }),
  );
  const baseline = topKAndTiebreak(fixedSet).matched.map((m) => m.slug);
  const baselineSha = canonicalSha256(baseline);
  for (let i = 0; i < 50; i += 1) {
    const perturbed = fixedSet.map((item) => ({
      ...item,
      rrfScore: item.rrfScore + Math.random() * 0.001,
    }));
    const matchedSlugs = topKAndTiebreak(perturbed).matched.map((m) => m.slug);
    assert.deepEqual(
      matchedSlugs,
      baseline,
      `iteration ${i}: order must be stable across score-only perturbations`,
    );
    assert.equal(canonicalSha256(matchedSlugs), baselineSha, `iteration ${i}: SHA-256 must be stable`);
  }
});

test('top-k: score perturbations that REVERSE input order still produce slug-ASC output (D-006)', () => {
  // Hard case for D-006: pre-fix, this test would FAIL because the
  // comparator sorted by RRF DESC and the reversed scores would
  // reorder the items. Post-fix (PRIMARY slug), the order is invariant.
  const fixedSlugs = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];
  const fixedSet = fixedSlugs.map((slug, i) =>
    makeItem({ slug, rrfScore: 1 / (60 + i + 1) }),
  );
  const baseline = topKAndTiebreak(fixedSet).matched.map((m) => m.slug);
  assert.deepEqual(baseline, fixedSlugs);
  const baselineSha = canonicalSha256(baseline);

  // 50 iterations. Each iteration REVERSES the score vector (so the
  // previous "winner" is now the "loser"), then randomizes the floor.
  for (let i = 0; i < 50; i += 1) {
    const reversedScores = fixedSet
      .map((item) => ({ ...item, rrfScore: 0 }))
      .map((item, idx) => ({ ...item, rrfScore: 1 / (60 + (fixedSlugs.length - 1 - idx)) }));
    const perturbed = reversedScores.map((item) => ({
      ...item,
      rrfScore: item.rrfScore + Math.random() * 0.05,
    }));
    const matchedSlugs = topKAndTiebreak(perturbed).matched.map((m) => m.slug);
    assert.deepEqual(
      matchedSlugs,
      baseline,
      `iteration ${i} (reversed scores): order must remain slug ASC`,
    );
    assert.equal(canonicalSha256(matchedSlugs), baselineSha);
  }
});

test('top-k: secondary tiebreak — colliding slugs sort by RRF DESC', () => {
  // Built-in invariance check: when two items share a slug (an
  // engineering error, not a runtime case), the secondary comparator
  // picks the higher-scoring one first. Kept as a sanity check so a
  // future refactor that drops the secondary key fails this test.
  const ranked = [
    makeItem({ slug: 'dup', rrfScore: 0.10 }),
    makeItem({ slug: 'dup', rrfScore: 0.50 }),
  ];
  const { matched } = topKAndTiebreak(ranked);
  assert.equal(matched.length, 2);
  assert.equal(matched[0].rrfScore, 0.50, 'higher score should rank first on slug collision');
  assert.equal(matched[1].rrfScore, 0.10);
});

test('top-k: input array is NOT mutated (pure function)', () => {
  const ranked = [
    makeItem({ slug: 'c', rrfScore: 0.01 }),
    makeItem({ slug: 'b', rrfScore: 0.02 }),
    makeItem({ slug: 'a', rrfScore: 0.03 }),
  ];
  const originalOrder = ranked.map((r) => r.slug);
  topKAndTiebreak(ranked);
  assert.deepEqual(
    ranked.map((r) => r.slug),
    originalOrder,
  );
});
