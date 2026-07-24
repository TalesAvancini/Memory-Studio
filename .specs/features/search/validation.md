# Validation — Phase 4 (search) — Re-verify after iter 1 fixes

**Verdict:** FAIL

**Date:** 2026-07-23  
**Commit (HEAD):** 320079f  
**Baseline commit (last FAIL):** 28d4045  
**Range:** 28d4045..320079f (8 fix commits)  
**Verifier:** independent verifier (author != verifier)

## Iter 1 fix commits

| Commit | Subject |
|---|---|
| `337d24a` | never echo EmbedderError message into public SearchError (Gap 3) |
| `589c02a` | wrap queryFts SQL/precondition failures as typed SearchError (Gap 5a) |
| `63c4d30` | wrap verifySkillsTable precondition in typed SearchError boundary (Gap 5b) |
| `54f40b1` | make vector tie-break deterministic across equal cosine distances (Gap 6) |
| `45be2b2` | declare skill_id INTEGER PRIMARY KEY on skill_embeddings (Gap 4) |
| `fa66766` | add controlled-vector and FTS threshold-boundary fixtures (Gap 1 + Gap 2) |
| `e580241` | make phase coverage command portable across shells (Gap 7) |
| `320079f` | document tie-break on equal cosine distance in design.md (Gap 6 docs) |

## Gates

| Gate | Result |
|---|---|
| `time npm test` | exit 0; real **7.964s** (TAP duration 5.662s); **184 passed, 0 failed, 0 skipped** |
| Baseline comparison | previous iteration (28d4045): **179 passed**; current: **184 passed**; delta **+5** (T-ORCH-13b, T-ORCH-19b, T-ORCH-25, T-ORCH-26, T-SCHEMA-03b) |
| `npx tsc --noEmit` | exit 0 |
| `npm run typecheck` | exit 0 |
| `git diff --stat 28d4045..320079f` | exit 0; 10 files, 1207 insertions, 131 deletions |
| `npm run test:coverage` | exit 0; **69 passed, 0 failed**; full coverage report emitted |

### `src/search/` native coverage (per `npm run test:coverage`)

| File | Lines | Branches | Functions |
|---|---:|---:|---:|
| `src/search/errors.ts` | 100.00% | 83.33% | 100.00% |
| `src/search/fts.ts` | 100.00% | 91.30% | 100.00% |
| `src/search/rrf.ts` | 98.23% | 85.71% | 100.00% |
| `src/search/schema.ts` | 90.11% | 75.00% | 100.00% |
| `src/search/search.ts` | 91.90% | 85.29% | 100.00% |
| `src/search/types.ts` | 100.00% | 100.00% | 100.00% |
| `src/search/vector.ts` | 100.00% | 100.00% | 100.00% |

All `src/search` line percentages are above the 80% requirement. The coverage command itself now exits 0 on this Windows runner (`npm run test:coverage` expands `test/search/*.test.mjs` across shells).

## Spec-anchored check

Each AC re-derived from `spec.md` against the post-fix source. Evidence cites the implementation and the test that pins it.

| AC | Met? | Evidence |
|---|---|---|
| **SEARCH-01 — FTS schema and synchronization** | Yes | `src/search/schema.ts:124-170` creates external-content `content_fts` (FTS5, `content='skills'`, `content_rowid='id'`, `tokenize='unicode61 remove_diacritics 2'`) and INSERT/UPDATE/DELETE triggers; `:202-238` reconciles/backfills. `T-SCHEMA-02/04/05/06/08` at `test/search/schema.test.mjs:65-103,160-231,235-281` assert DDL, backfill/idempotency, and mutations against real SQLite/FTS5. |
| **SEARCH-02 — Vector schema with named PK** | Yes | `src/search/schema.ts:143-149` declares `skill_id INTEGER PRIMARY KEY` on `skill_embeddings vec0`. `T-SCHEMA-03b` (`schema.test.mjs:106-140`) asserts `PRAGMA table_info(skill_embeddings)` returns `skill_id` with `pk=1` and `embedding` with `pk=0`, and `sqlite_master.sql` matches `/skill_id\s+INTEGER\s+PRIMARY\s+KEY/i`. T-SCHEMA-04/07 also switched to use `skill_id` instead of `rowid`. |
| **SEARCH-03 — BM25 ranking and safe query** | Yes | `src/search/fts.ts:43-63` extracts Unicode alphanumeric tokens, dedups case-insensitively, quotes and joins OR; `:88-126` counts distinct hits before limit, computes BM25, orders ASC with rowid fallback. `T-FTS-01..07/09` at `test/search/fts.test.mjs:57-145,190-217` assert query construction, real FTS5 ranking, ranks, limits, and punctuation handling. |
| **SEARCH-04 — cosine k-NN ranking** | Yes | `src/search/vector.ts:64-99` validates 384 finite values, uses `embedding MATCH ? AND k = ?`, returns `1 - distance`, JS-side tie-break by `skill_id`, then assigns 1-based ranks. `T-VEC-03/06/07` at `test/search/vector.test.mjs:115-142,172-209` exercise the real sqlite-vec extension and controlled self/orthogonal/opposite vectors. |
| **SEARCH-05 — RRF fusion and tie-break** | Yes | `src/search/rrf.ts:38-112` sums `1/(60+rank)` for each channel, preserves metrics, sorts by `rrfScore DESC`, then `bestRank ASC`, then `id ASC`. `T-RRF-01..09` at `test/search/rrf.test.mjs:20-165` assert one/two-channel scores, overlap, rank preservation, ties, uniqueness, and immutability. |
| **SEARCH-06 — Double threshold OR union** | Yes | `src/search/search.ts:251-256` applies vector threshold `>=` and FTS gate `totalHits >= minFtsHits` independently. `T-ORCH-25` (`search.test.mjs:863-895`) asserts the FTS-only path with `totalHits === minFtsHits`; `T-ORCH-26` (`:897-922`) asserts the FTS-off path with `totalHits === minFtsHits - 1`. The FTS mutation `>=` → `>` is killed by T-ORCH-25. The vector rank compaction mutation **survives** T-ORCH-19b (see Sensor section). |
| **SEARCH-07 — async library contract** | Yes | `src/search/types.ts:69-72` defines `SearchFunction = (query, k) => Promise<readonly RankedSkill[]>`; `src/search/search.ts:193-212` returns the two-argument async closure after eager initialization. The range contains no HTTP/Fastify/server route. Real calls are exercised by `T-ORCH-01..26` in `test/search/search.test.mjs`. |
| **SEARCH-08 — Result shape and top-k** | Yes | `src/search/search.ts:158-177` hydrates only source metadata, slices after fusion, preserves order, and omits embeddings. `T-ORCH-16/18/20` at `search.test.mjs:495-515,540-595,743-755` assert metadata, limit, hash/content, and absence of `embedding`. |
| **SEARCH-09 — Determinism** | Partial | `T-ORCH-12` (`search.test.mjs:405-437`) now asserts every public RankedSkill field across repeated calls and orders across calls. However, the **vector tie-break path for equal cosine distances is not exercised by any committed test** — the acceptance corpus uses distinct cosine values per row, so the JS-side sort in `vector.ts:89-92` is uncovered. The scratch tie-break probe (created during this verification) catches the mutation, but the probe is not committed. |
| **SEARCH-10 — Vector-only pass at equality** | Yes | `src/search/search.ts:184` uses inclusive `>=`; `T-ORCH-08` (`search.test.mjs:324-347`) proves vector-only OR and `T-ORCH-09` (`:349-368`) proves an exact cosine threshold of 1.0 is accepted. |
| **SEARCH-11 — FTS-only pass at equality** | Yes | `src/search/search.ts:252` uses `>=` on the FTS gate; `T-ORCH-25` (`:863-895`) asserts the exact-boundary pass with `totalHits === minFtsHits`; `T-ORCH-26` (`:897-922`) asserts the `totalHits === minFtsHits - 1` failure path. |
| **SEARCH-12 — Neither returns `[]`** | Yes | `src/search/search.ts:254-256` returns `[]` when both approved lists are empty. `T-ORCH-06` (`search.test.mjs:281-298`) asserts unreachable vector and FTS thresholds and `deepEqual(results, [])`. |
| **SEARCH-13 — Invalid input/config/embedder and privacy** | Yes | `src/search/search.ts:111-141` validates inputs; `src/search/vector.ts:33-55` validates embeddings; `src/search/schema.ts:57-91/94-121` validates config/preconditions. `T-ORCH-13b` (`search.test.mjs:464-499`) injects a real `EmbedderError` carrying the secret query and asserts `caught.message === 'embedding failed'` (the fixed query-independent text) and `!caught.message.includes(secretQuery)`. The privacy leak mutation is killed. |
| **SEARCH-14 — Real corpus ranking** | Yes | `test/search/search.test.mjs:58-148` seeds 12 real catalog rows; `T-ORCH-04` (`:210-229`) asserts `react-debug-01` first and output length 1–5. |
| **SEARCH-15 — Typed engine failures** | Yes | `src/search/fts.ts:115-126` wraps SQL/precondition failures as `SearchError(QUERY_ERROR)`; `src/search/schema.ts:57-91` wraps `verifySkillsTable` precondition failures as `SearchError(SCHEMA_ERROR)`; `src/search/vector.ts:69-102` wraps vec SQL failures. `T-FTS-08` (`fts.test.mjs:147-176`) now exercises a closed-handle `queryFts` call (not the wrapper helper); `T-SCHEMA-10` (`schema.test.mjs:325-345`) now exercises a closed-handle `initializeSearchStorage` call. The "remove try/catch" mutations are killed by these tests. |
| **SEARCH-16 — Tests + coverage + SLA + typecheck** | Yes | Numerical gates pass: 184 tests, 7.964s real `npm test`, typecheck 0, `npm run test:coverage` exits 0, all `src/search` line percentages ≥ 80%. The literal coverage command now exits 0 on Windows thanks to the `test:coverage` script expansion `test/search/*.test.mjs`. |

## Discrimination sensor

Tests assert public outputs over controlled SQLite/FTS5/sqlite-vec fixtures, but the sensor is **No** because one previously-surviving mutant still survives after the iter 1 fixes.

| Mutation | Location | Scratch result |
|---|---|---|
| Cosine gate `>=` → `>` | `src/search/search.ts:184` | **Killed** — search tests exit 1, 27/28 pass; T-ORCH-09 fails (exact cosine threshold rejected). |
| FTS gate `>=` → `>` | `src/search/search.ts:252` | **Killed** — search tests exit 1, 27/28 pass; T-ORCH-25 fails (`totalHits === minFtsHits` no longer passes). |
| Compact surviving vector ranks after threshold filtering | `src/search/search.ts:184` (renumber) | **SURVIVED — 28/28 search tests pass with mutation in place.** T-ORCH-19b uses `minCosineSimilarity: -1`; all 5 rows pass, so renumbered 1..5 equals original 1..5. The test does not actually exercise the rank-preservation path; the test name says "rank-preservation through filtering" but the corpus has no filtered rows. |
| EmbedderError message echoed into SearchError | `src/search/search.ts:226` | **Killed** — T-ORCH-13b fails; `caught.message.includes(secretQuery)` is true. |
| `skill_id INTEGER PRIMARY KEY` removed from vec0 DDL | `src/search/schema.ts:145` | **Killed** — T-SCHEMA-03b fails; `pk=1` is no longer present on `skill_id`. |
| JS-side tie-break removed in vector sort | `src/search/vector.ts:89-92` | **NOT killed by any committed test.** The acceptance corpus and other tests have distinct cosine distances per row. A scratch tie-break probe (two skills with identical embeddings) catches the mutation, but the probe is not committed to the test suite. |
| `try/catch` removed in `queryFts` | `src/search/fts.ts:115-126` | **Killed** — T-FTS-08 fails; closed handle raises raw `TypeError`, not `SearchError(QUERY_ERROR)`. |
| `try/catch` removed in `verifySkillsTable` | `src/search/schema.ts:57-91` | **Killed** — T-SCHEMA-10 fails; closed handle raises raw `TypeError`, not `SearchError(SCHEMA_ERROR)`. |
| BM25 `ASC` → `DESC` | `src/search/fts.ts:112` | **Killed** — FTS tests exit 1, 7 pass / 2 fail. |
| RRF denominator off by one | `src/search/rrf.ts:52` | **Killed** — RRF tests exit 1, 6 pass / 3 fail. |
| RRF ID tie-break removed | `src/search/rrf.ts:108` | **Killed** — RRF tests exit 1, 8 pass / 1 fail. |
| Channel empty `&&` → `\|\|` | `src/search/search.ts:254` | **Killed** — search tests exit 1, 19 pass / 5 fail. |

Scratch copies were removed after each run; the working source and committed tests were not mutated by the sensor.

## Library-vs-server invariant

Yes. Phase 4 remains library-only. `createSearch` is dependency-injected (`src/search/search.ts:193-212`), returns `Promise<readonly RankedSkill[]>`, and no HTTP server, Fastify import, route, or transport adapter was added. HTTP belongs to Phase 6 as specified.

## Scope-guard compliance

`git diff --name-only 28d4045..320079f` over the fix range:

- `.specs/features/search/design.md` — Phase 4 scope (search design; created in fix range)
- `.specs/features/search/tasks.md` — Phase 4 scope (search tasks; created in fix range)
- `package.json` — Phase 4 scope (added `test:coverage` script)
- `src/search/fts.ts` — Phase 4 scope
- `src/search/schema.ts` — Phase 4 scope
- `src/search/search.ts` — Phase 4 scope
- `src/search/vector.ts` — Phase 4 scope
- `test/search/fts.test.mjs` — Phase 4 scope
- `test/search/schema.test.mjs` — Phase 4 scope
- `test/search/search.test.mjs` — Phase 4 scope

All 8 commits were checked individually. Each touched only its expected source/test pair, or the dependency file for `337d24a` (none of the fix commits touched `package.json` — `test:coverage` was added in `e580241`). Protected paths have **no changes** in the Phase 4 range:

- `src/social-detector/**`, `src/catalog/**` — not touched
- `src/augmenter/`, `src/cache/`, `src/agents/`, `src/server/`, `src/shared/` — not touched
- `test/smoke.test.mjs`, `test/social-detector.test.mjs`, `test/catalog/**` — not touched
- `.claude/**` — not touched
- `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json` — not touched
- `.specs/features/social-detector/**`, `.specs/features/schema-and-crud/**` — not touched
- `CLAUDE.md`, `proposta-consolidada.md`, `conversa-loop.md`, `handoff-session.md`, `PLAN.md` — not touched
- `brief-m3cli-phase*.md` — not touched

Side-effects in protected files: **None**.

## Architectural drift check

None. `.specs/ARCHITECTURE.md:31-38,87-89` already defines `search`, `sqlite`, `sqlite-fts5`, and `sqlite-vec` and the three edges. The change to `skill_id INTEGER PRIMARY KEY` in `src/search/schema.ts:145` is an internal vec0 schema detail (sqlite-vec 0.1.9 binding-path quirk); the JavaScript-side sort in `vector.ts:89-92` is an internal adapter mechanism; the try/catch boundary additions are internal error-mapping. None of these adds a new farol node, edge, authority boundary, or transport adapter. `.specs/DISCOVERIES.md` remains unchanged.

## Ranked gaps

1. **Surviving vector-rank compaction mutant (Major; SEARCH-06/16).** T-ORCH-19b uses `minCosineSimilarity: -1` so all 5 rows pass; renumbered 1..5 equals original 1..5, so the mutation `applyVectorThreshold` → renumber survives. Add a non-trivial threshold (e.g. `0.6`) that filters out the worst two rows. The surviving rank 3, 4, 5 must keep their original ranks, not be renumbered 1, 2, 3. The current test is decorative; it does not exercise the discrimination it claims.
2. **Tie-break probe is not committed (Major; SEARCH-09/16).** The implementation has the correct JS-side `sort by (distance ASC, skill_id ASC)` in `vector.ts:89-92`, but no committed test exercises the equal-cosine-distance path. Add a unit test in `vector.test.mjs` that inserts two skills with identical embeddings and asserts the lower id gets rank 1 deterministically. A scratch probe during this verification caught the mutation but the probe is not committed.
3. **T-ORCH-19b test design misleading (Minor; SEARCH-06).** The test docstring claims "rank-preservation through filtering" but the corpus has no filtered rows. The test passes either way. Fix the corpus or threshold so the test actually discards some rows, which would catch the compaction mutation.

## Library-vs-server invariant

Confirmed. `createSearch` is dependency-injected (`src/search/search.ts:193-212`), returns `Promise<readonly RankedSkill[]>`, and no HTTP server, Fastify import, route, or transport adapter was introduced. HTTP belongs to Phase 6 as specified.

## Lesson signals

Signals found: 1 surviving mutant (rank compaction, gated by a non-discriminating test), 1 untested equal-distance tie-break path, and a docstring-vs-observation mismatch in T-ORCH-19b. The hard verifier scope permits only this `validation.md` (and append-only `DISCOVERIES.md` if structural drift exists), so no lesson-state files were modified. No architectural discovery was recorded because the BigInt/PK/Js-sort changes are internal rather than structural.

## Summary

**Overall:** Not ready — **FAIL**.

**Spec-anchored check:** 15/16 fully met; 1 criterion (SEARCH-09) is partially met because the equal-cosine-distance tie-break path is not exercised by any committed test (the implementation is correct, but the evidence is missing).

**Sensor:** 7/9 mutations killed; 2 still survive or lack committed coverage:
- Rank compaction mutation is caught by the test name but not by the test's actual assertions.
- Tie-break mutation is caught by a scratch probe created during this verification but not by any committed test.

**Gates:** Full suite and typecheck pass; `npm run test:coverage` exits 0 on this Windows runner; all `src/search` line percentages ≥ 80%; full suite 7.964s.

**Scope-guard:** All 8 fix commits touched only Phase 4 source/test/spec files; no protected paths modified.

**Architectural drift:** None. Topos unchanged.

The implementation demonstrates a working real-engine hybrid search and stays within Phase 4 scope. The remaining gaps are test-coverage gaps rather than implementation bugs — the discriminated code (no compaction, deterministic JS-side tie-break) is correct, but the committed tests do not exercise that path. The verification cannot grant PASS until the gated test exercises the rank-preservation path with a non-trivial threshold and the tie-break probe is committed.
