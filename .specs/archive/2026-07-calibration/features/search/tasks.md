# Search / Retrieval Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

Tests are co-located with the production change in every task, each task must pass its stated gate before completion, and each task receives one atomic conventional commit. After T7, a fresh Verifier must perform spec-anchored validation and the discrimination sensor.

---

**Design:** `.specs/features/search/design.md`  
**Status:** Draft (autonomous planner resolution)  
**Total tasks:** 7 — one Execute batch; no subchapter split required

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `CLAUDE.md` (every exported function behavior-tested, `src/` coverage ≥80%, real SQLite/ONNX integration contract, `npm test` <10s), `package.json` (native `node:test` and actual scripts), `tsconfig.json` (strict/noUncheckedIndexedAccess), `.specs/features/schema-and-crud/validation.md` and `.specs/features/social-detector/validation.md` (behavior assertions, real `:memory:` SQLite, native coverage, discrimination sensor). Existing samples: `test/catalog/schema.test.mjs`, `writer.test.mjs`, `embedder.test.mjs`, `loader.test.mjs`, `test/social-detector.test.mjs`, `test/smoke.test.mjs`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Contracts / typed errors | unit | Every runtime export behavior-tested; every public error code used by this layer; type contracts pass strict compile | `test/search/contracts.test.mjs` | `npm test` |
| Search schema / extension / triggers | integration | Real `better-sqlite3 :memory:` + real sqlite-vec; FTS/vec DDL, capability check, backfill, idempotency, INSERT/UPDATE/DELETE synchronization, and failure path | `test/search/schema.test.mjs` | `npm test && npm run typecheck` |
| FTS data access | integration | Safe-query edge cases; real `MATCH`; `bm25` ASC; total distinct hit count before limit; empty and SQL failure paths; 1:1 to SEARCH-03 edge cases | `test/search/fts.test.mjs` | `npm test && npm run typecheck` |
| Vector data access | integration | Real vec0 k-NN/cosine; 384d binding, rank/distance/similarity outcomes; invalid dimension/non-finite and SQL failure paths | `test/search/vector.test.mjs` | `npm test && npm run typecheck` |
| RRF business logic | unit | All branches; exact `1/(60+rank)` outcomes; one/two-channel, overlap, original rank, tie-break and empty cases; mutation-sensitive | `test/search/rrf.test.mjs` | `npm test` |
| Search orchestration | integration | Every SEARCH AC and every listed edge case; real engines; ≥10-item seed; vector-only, FTS-only, both, neither, equality boundaries, top-k, deterministic metadata, typed failures | `test/search/search.test.mjs` | `npm test && npm run typecheck` |
| HTTP / e2e | none | Out of scope until Phase 6; no route/server may be added | — | — |
| Search folder aggregate | coverage | ≥80% lines in `src/search/`; every exported function has ≥1 behavior assertion | `src/search/**/*.ts` via `test/search/*.test.mjs` | `npm run test:coverage` |

The ONNX-real clause of the project integration contract is deferred by the locked Phase 2/9 boundary: Phase 4 uses the injected Phase 2 `Embedder` seam and a controlled deterministic test embedder, while SQLite, FTS5, and sqlite-vec are real. No DB/extension mock is permitted.

## Gate Check Commands

> Generated from the actual `package.json`; no nonexistent lint/build/test:integration script is invented.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After pure contracts or RRF tasks | `npm test` |
| Full | After tasks touching SQLite/FTS5/sqlite-vec or orchestration | `npm test && npm run typecheck` |
| Coverage | After T7 and during Verifier | `npm run test:coverage` |
| Phase | Before T7 commit and Verifier verdict | `npm test && npm run typecheck && npm run test:coverage` |

The `npm run test:coverage` script expands `test/search/*.test.mjs` via the
shell so the coverage gate is portable across Windows PowerShell and POSIX
shells; the prior literal `node --experimental-test-coverage --test test/search/`
form fails on Windows with `MODULE_NOT_FOUND`.

**SLA:** the standalone `npm test` invocation must complete in under 10 seconds. The baseline at handoff is 115 passing tests; no task may silently delete or skip any baseline test.

---

## Execution Plan

Phases and tasks execute strictly in order.

### Phase 1: Runtime and storage foundation

```text
T1 → T2 → T3
```

### Phase 2: Retrieval channels and fusion

```text
T4 → T5 → T6
```

### Phase 3: Library orchestration

```text
T7
```

---

## Task Breakdown

### T1: Add the official sqlite-vec runtime dependency

**What:** Add only the official `sqlite-vec` runtime package and lock its resolved native artifacts for the current Node 22 project. Do not add ONNX, Fastify, a vector DB, test framework, or fallback dependency.  
**Where:** `package.json`, `package-lock.json`  
**Depends on:** None  
**Reuses:** Existing `better-sqlite3` runtime and npm lockfile policy  
**Requirements:** SEARCH-02, SEARCH-15

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`
- Reference: official [sqlite-vec Node.js binding](https://alexgarcia.xyz/sqlite-vec/js.html)

**Done when:**

- [ ] `sqlite-vec` appears once under runtime `dependencies`, with package-lock resolution committed.
- [ ] Node 22 can import the package on the current platform; no product source or protected domain is changed.
- [ ] Existing baseline remains at least 115 passing tests with no skips/deletions.
- [ ] Gate passes: `npm test && npm run typecheck`.

**Tests:** none — dependency/config layer; existing smoke and build/type gates only  
**Gate:** full  
**Commit:** `chore(search): add sqlite-vec runtime dependency`

---

### T2: Define search contracts and typed errors

**What:** Define `SearchOptions`, `SearchFunction`, channel/fusion/result types and `SearchError` with the exact public code union and cause behavior from the design.  
**Where:** `src/search/types.ts`, `src/search/errors.ts`, `test/search/contracts.test.mjs`  
**Depends on:** T1  
**Reuses:** `SkillKind` and `Embedder` types from direct `src/catalog/` imports; typed-error style from `src/catalog/errors.ts`  
**Requirements:** SEARCH-07, SEARCH-08, SEARCH-13, SEARCH-15

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] Contract types match `design.md`, are readonly where applicable, and introduce no `any`.
- [ ] `SearchError` exposes stable `name`, `code`, and optional `cause` without query content.
- [ ] No barrel `src/search/index.ts` is introduced.
- [ ] At least 4 search contract/error behavior tests pass; cumulative suite is at least 119 tests with the 115-test baseline intact.
- [ ] Gate passes: `npm test`.

**Tests:** unit — all runtime exports and representative error codes/cause/privacy behavior  
**Gate:** quick  
**Commit:** `feat(search): define retrieval contracts and typed errors`

---

### T3: Initialize and synchronize FTS5 and vec0 storage

**What:** Implement one idempotent initializer that loads/capability-checks sqlite-vec, verifies `skills`, creates `content_fts` and `skill_embeddings`, creates sync triggers, and reconciles existing rows transactionally.  
**Where:** `src/search/schema.ts`, `test/search/schema.test.mjs`  
**Depends on:** T2  
**Reuses:** Existing `skills` schema and BLOB format; `EMBEDDING_DIMENSIONS`; `better-sqlite3` transaction pattern  
**Requirements:** SEARCH-01, SEARCH-02, SEARCH-15

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`
- References: official [vec0 reference](https://alexgarcia.xyz/sqlite-vec/features/vec0.html) and [KNN reference](https://alexgarcia.xyz/sqlite-vec/features/knn.html)

**Done when:**

- [ ] `initializeSearchStorage(db)` loads the extension and confirms `vec_version()` before vec DDL.
- [ ] FTS DDL indexes only `content_yaml` as external content; vec0 DDL uses `float[384] distance_metric=cosine` and `skills.id`-aligned keys.
- [ ] Existing rows backfill into both indices; a second initialization leaves one index row per skill.
- [ ] INSERT, UPDATE of content/embedding, and DELETE on `skills` produce corresponding observable changes in both engines without editing `src/catalog/**`.
- [ ] Missing `skills`, extension failure, and DDL/backfill failure are typed and do not expose a usable half-initialized function.
- [ ] At least 7 schema integration tests pass against real FTS5/sqlite-vec; cumulative suite is at least 126 tests.
- [ ] Gate passes: `npm test && npm run typecheck`.

**Tests:** integration — real engines, DDL metadata/behavior, backfill, idempotency, three mutation directions, typed failure  
**Gate:** full  
**Commit:** `feat(search): add synchronized fts and vector indexes`

---

### T4: Implement safe BM25 FTS retrieval

**What:** Implement the Unicode-safe query builder and FTS adapter returning pre-limit total hits plus 1-based BM25-ranked candidates.  
**Where:** `src/search/fts.ts`, `test/search/fts.test.mjs`  
**Depends on:** T3  
**Reuses:** `content_fts` initialized in T3 and `SearchError` from T2  
**Requirements:** SEARCH-03, SEARCH-11, SEARCH-12, SEARCH-15

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] `buildFtsQuery` extracts unique Unicode alphanumeric tokens, safely quotes each, joins fixed `OR`, and returns no expression for punctuation-only input.
- [ ] `queryFts` binds the expression as a parameter, computes `bm25(content_fts)`, ranks ASC with stable ID fallback, and obtains distinct total hits before candidate limit.
- [ ] Quotes, apostrophes, operators, diacritics, repeated tokens, punctuation-only and empty-table cases produce the spec outcome without FTS syntax injection.
- [ ] SQL failure becomes `SearchError(QUERY_ERROR)` without query content.
- [ ] At least 6 FTS behavior/integration tests pass; cumulative suite is at least 132 tests.
- [ ] Gate passes: `npm test && npm run typecheck`.

**Tests:** integration — real FTS5 BM25/hit count plus safe-query unit branches in the same task  
**Gate:** full  
**Commit:** `feat(search): add safe bm25 lexical retrieval`

---

### T5: Implement cosine sqlite-vec retrieval

**What:** Implement query-vector validation/binding and the vec0 k-NN adapter with 1-based ranks and `cosineSimilarity = 1 - distance`.  
**Where:** `src/search/vector.ts`, `test/search/vector.test.mjs`  
**Depends on:** T4  
**Reuses:** `skill_embeddings` from T3, `EMBEDDING_DIMENSIONS`, `SearchError`  
**Requirements:** SEARCH-04, SEARCH-10, SEARCH-12, SEARCH-13, SEARCH-15

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`
- Reference: official [sqlite-vec KNN queries](https://alexgarcia.xyz/sqlite-vec/features/knn.html)

**Done when:**

- [ ] `queryVector` rejects non-384, `NaN`, or infinite arrays before native binding with `INVALID_EMBEDDING`.
- [ ] Real vec0 SQL uses `embedding MATCH ? AND k = ?`, returns ascending cosine distance, stable rank, and finite `1-distance` similarity.
- [ ] Exact/self vector ranks before orthogonal/opposite controlled vectors; empty table returns `[]`.
- [ ] Native/SQL failure becomes `SearchError(QUERY_ERROR)` with cause.
- [ ] At least 6 vector integration tests pass; cumulative suite is at least 138 tests.
- [ ] Gate passes: `npm test && npm run typecheck`.

**Tests:** integration — real sqlite-vec k-NN, metric conversion, empty/error/input boundaries  
**Gate:** full  
**Commit:** `feat(search): add cosine vector retrieval`

---

### T6: Implement deterministic RRF fusion

**What:** Implement a pure RRF function using original 1-based channel ranks, denominator constant 60, preserved metrics, unique IDs and the specified deterministic tie-break.  
**Where:** `src/search/rrf.ts`, `test/search/rrf.test.mjs`  
**Depends on:** T5  
**Reuses:** Candidate/result types from T2; no DB dependency  
**Requirements:** SEARCH-05, SEARCH-08, SEARCH-09

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] One-channel score equals exactly `1/(60+rank)` within floating-point tolerance.
- [ ] Overlap score equals the exact sum of the two channel terms; non-overlap retains only one term.
- [ ] Input rank values are not compacted or mutated and metrics remain associated with the correct ID.
- [ ] Ordering is score DESC, best rank ASC, ID ASC; an intentionally symmetric tie proves the ID fallback.
- [ ] Empty lists return `[]`; output IDs are unique and inputs remain unchanged.
- [ ] At least 7 RRF unit tests pass; cumulative suite is at least 145 tests.
- [ ] Gate passes: `npm test`.

**Tests:** unit — all formula/branch/tie/immutability outcomes, suitable for denominator/rank/order mutations  
**Gate:** quick  
**Commit:** `feat(search): add deterministic reciprocal rank fusion`

---

### T7: Compose the public search library function

**What:** Implement `createSearch(options)` returning the async two-argument `search(query, k)` closure that validates, embeds once, queries both channels, applies independent thresholds, fuses, hydrates source metadata and returns top-k without embeddings.  
**Where:** `src/search/search.ts`, `test/search/search.test.mjs`  
**Depends on:** T6  
**Reuses:** All T2–T6 modules and the injected Phase 2 `Embedder`; direct imports only  
**Requirements:** SEARCH-06 through SEARCH-16 (integration closure), with SEARCH-01 through SEARCH-05 exercised end-to-end

**Tools:**

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when:**

- [ ] Factory defaults are cosine `0.75` and FTS hits `1`; invalid config fails before initialization.
- [ ] Closure validates query (trim/NFC, 1–10,000 code units) and integer `k` (1–100), calls the embedder exactly once, and uses candidate depth `min(max(4*k,20),100)`.
- [ ] Vector filter is inclusive per item; FTS gate is inclusive on pre-limit total hits; the two approved lists combine by OR, and neither-passes returns `[]`.
- [ ] Filtering preserves original channel ranks. Hydration uses a single bounded query, preserves fused order, and omits embedding bytes.
- [ ] A real-engine corpus of at least 10 catalog rows makes `react-debug-01` rank first for `como debugar React` with `k=5`; output length is 1–5 and every output field matches the source row/metrics.
- [ ] Tests independently prove vector-only, FTS-only, both, neither, equality boundaries, top-k, empty catalog, punctuation-only lexical miss, determinism, invalid query/k/config, embedder failure, and DB failure.
- [ ] No HTTP/server/Fastify, cross-encoder, barrel, prompt logging, or edit outside Phase 4 implementation/test/dependency paths is introduced.
- [ ] At least 14 orchestration/integration tests pass; total search tests are at least 44 and cumulative suite is at least 159 tests, with all 115 baseline tests preserved.
- [ ] `src/search/` line coverage is at least 80%, and every export is behavior-tested.
- [ ] Phase gate passes: `npm test && npm run typecheck && node --experimental-test-coverage --test test/search/`; standalone `npm test` is under 10 seconds.

**Tests:** integration — full spec matrix over real SQLite/FTS5/sqlite-vec and controlled injected embedder; no engine mocks  
**Gate:** phase  
**Commit:** `feat(search): expose thresholded hybrid search function`

---

## Phase Execution Map

```text
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ──→ T2 ──→ T3
Phase 2:  T3 ──→ T4 ──→ T5 ──→ T6
Phase 3:  T6 ──→ T7
```

Execution is strictly sequential. Seven tasks fit one task-budgeted Execute batch, so no worker split or `SUBCHAPTER_BREAKDOWN` is warranted.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | One runtime dependency + generated lockfile | Granular |
| T2 | One cohesive public-contract/error surface (two small files) | Granular |
| T3 | One storage-initializer component | Granular |
| T4 | One FTS adapter | Granular |
| T5 | One vector adapter | Granular |
| T6 | One pure fusion function | Granular |
| T7 | One public orchestration factory/function | Granular |

All tests live with the source task they verify; no test-only deferral task exists.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | Phase start → T1 | Match |
| T2 | T1 | T1 → T2 | Match |
| T3 | T2 | T2 → T3 | Match |
| T4 | T3 | T3 → T4 | Match |
| T5 | T4 | T4 → T5 | Match |
| T6 | T5 | T5 → T6 | Match |
| T7 | T6 | T6 → T7 | Match |

No dependency points forward and every diagram edge has the same target dependency in the task body.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Dependency/config | none + build/type gate | none; full gate | OK |
| T2 | Contracts / typed errors | unit | unit in `contracts.test.mjs` | OK |
| T3 | Schema / extension / triggers | integration | real-engine integration in `schema.test.mjs` | OK |
| T4 | FTS data access | integration | real FTS5 integration in `fts.test.mjs` | OK |
| T5 | Vector data access | integration | real sqlite-vec integration in `vector.test.mjs` | OK |
| T6 | RRF business logic | unit | unit in `rrf.test.mjs` | OK |
| T7 | Search orchestration | integration + coverage | real-engine corpus integration in `search.test.mjs` + native coverage | OK |

No production behavior is assigned `Tests: none`, and no test is deferred to a later task.

---

## Requirement-to-Task Closure

| Requirement | Tasks |
| --- | --- |
| SEARCH-01 | T3, T7 |
| SEARCH-02 | T1, T3, T7 |
| SEARCH-03 | T4, T7 |
| SEARCH-04 | T5, T7 |
| SEARCH-05 | T6, T7 |
| SEARCH-06 | T7 |
| SEARCH-07 | T2, T7 |
| SEARCH-08 | T2, T6, T7 |
| SEARCH-09 | T6, T7 |
| SEARCH-10 | T5, T7 |
| SEARCH-11 | T4, T7 |
| SEARCH-12 | T4, T5, T7 |
| SEARCH-13 | T2, T5, T7 |
| SEARCH-14 | T7 |
| SEARCH-15 | T1–T5, T7 |
| SEARCH-16 | T2–T7 |

**Closure:** 16/16 requirements mapped; 0 unmapped.

---

## Verifier Handoff

After T7, the fresh Verifier must at minimum:

1. Run all Phase gates and record elapsed standalone `npm test`, pass/fail counts, and per-file `src/search/` coverage.
2. Re-derive every SEARCH AC from `spec.md`, including exact threshold equality and `react-debug-01` ranking.
3. Inspect phase diff for scope guard compliance and confirm no `src/catalog/**`, server, social-detector, architecture or brief file changed.
4. Run scratch discrimination mutations that invert cosine comparison, change OR to AND, reverse BM25, alter RRF `60` or rank base, and remove tie-break; all must be killed.
5. Confirm the library-vs-server boundary and that `.specs/DISCOVERIES.md` remains unchanged unless implementation actually introduces a new farol component/edge.
