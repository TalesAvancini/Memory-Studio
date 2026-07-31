---
date: 2026-07-31
version: 1
description: "Phase 5a atomic tasks. 13 tasks across 4 subchapters (5a.1 server foundation, 5a.2 retrieval pipeline, 5a.3 tests + smoke, 5a.4 perf + hardening). Each task is one component/file with verification criteria, atomic commit, and traceable to spec R/AC IDs."
explanation: |
  Phase 5a packs into 4 subchapters per SUBCHAPTER_BREAKDOWN trigger
  (13 atomic tasks, 2 Implementer batches of 8+5):

    - 5a.1 Server Foundation: T-01 (Fastify scaffold), T-02 (Zod schemas),
      T-03 (route handler), T-04 (pino logger + minimal /health)
    - 5a.2 Retrieval Pipeline: T-05 (compose src/search/*), T-06 (thresholds),
      T-07 (top-K + tiebreak), T-08 (augmenter 2-block + byte-string SHA256)
    - 5a.3 Tests + Smoke: T-09 (unit tests), T-10 (tiebreak stress 1000),
      T-11 (smoke script + Claude Code guide)
    - 5a.4 Perf + Hardening: T-12 (perf harness), T-13 (e2e route integration)

  Subchapter boundaries are at genuine dependency seams:
    - 5a.1: server bootstrap + validation schemas (no retrieval)
    - 5a.2: retrieval composition + augmentation (depends on 5a.1)
    - 5a.3: tests + smoke (depends on 5a.1 + 5a.2)
    - 5a.4: perf measurement + final hardening (depends on all)

  Two Implementer batches fit naturally:
    - Batch 1: subchapters 5a.1 + 5a.2 (T-01..T-08 = 8 tasks)
    - Batch 2: subchapters 5a.3 + 5a.4 (T-09..T-13 = 5 tasks)

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md

related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../../architecture/memory-studio.html
  - ../../architecture/memory-studio.architecture.json
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../features/phase-1-catalog-schema-index/{spec,design,tasks}.md
  - ../../features/phase-3-sdk-client/{spec,design,tasks}.md
  - ../../../src/search/{rrf,fts,vector,search,types,errors,schema}.ts
  - ../../../src/catalog/index.ts
  - ../../../src/social-detector/index.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../scripts/ui-server.mjs
  - ../../../CLAUDE.md
---

# Phase 5a — API + Retrieval + Byte-string — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `d51c408` (Phase 4.4 Verifier PASS — 375 tests: 207 root + 152 UI + 16 SDK)
**Output deliverables:**
- `src/server/**` (new module: 9 files for Fastify + Zod + retrieval composition)
- `scripts/augment-server.ts` (entry point)
- `scripts/smoke-augment-server.mjs` (end-to-end gate)
- `docs/guides/claude-code-baseurl.md` (integration guide)
- `test/augment/*.test.mjs` (10 new test files)
- `package.json` gains `fastify` dep + `augment-server` script
- NO changes to `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**` (calibration residue preserved), `packages/sdk/**`, `packages/ui/**`, `tsconfig.json`

---

## Test Coverage Matrix

> Generated from spec acceptance criteria + design test strategy + CLAUDE.md testing contract.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Zod schemas** (`schemas.ts`) | unit | Required fields (prompt, fingerprint, activeCatalog, tenantId, schemaVersion); agentId canonical = `"claude-code"` only; schemaVersion = 3; context nullable; context.lastEvent.type enum | `test/augment/schemas.test.mjs` | `npm test -- test/augment/schemas.test.mjs` |
| **Thresholds** (`thresholds.ts`) | unit | Double gate: cosine ≥ 0.75 AND bm25_hits ≥ 1; items below either → `pruningDecisions.rejectedByFloor[]`; `id_not_in_catalog` rejection for activeCatalog IDs not in filesystem | `test/augment/thresholds.test.mjs` | `npm test -- test/augment/thresholds.test.mjs` |
| **Top-K + tiebreak** (`top-k.ts`) | unit | Sort by RRF DESC + id.localeCompare ASC; truncate to 5; warn if < 3 items above threshold | `test/augment/top-k.test.mjs` | `npm test -- test/augment/top-k.test.mjs` |
| **Tiebreak stress** (integration) | benchmark | 1000 synthetic requests with random cosine scores in `[threshold-eps, threshold+eps]`; all 1000 → same SHA256 | `test/augment/tiebreak-stress.test.mjs` | `npm test -- test/augment/tiebreak-stress.test.mjs` |
| **Byte-string determinism** (`byte-string.ts`) | unit | SHA-256 hex of canonical JSON serialization; same input → same hash | `test/augment/byte-string.test.mjs` | `npm test -- test/augment/byte-string.test.mjs` |
| **Augmenter 2-block** (`augmenter.ts`) | unit | Block 1 = persona(s) text, `cache_control: ephemeral`; Block 2 = Skills + Rules + context, `cache_control: ephemeral`; SHA256 stable across runs | `test/augment/augmenter.test.mjs` | `npm test -- test/augment/augmenter.test.mjs` |
| **Retrieval composition** (`retrieval.ts` + `pipeline.ts`) | integration | Compose `src/search/{fts,vector,rrf}.ts` end-to-end with fixture catalog | `test/augment/retrieval.test.mjs` | `npm test -- test/augment/retrieval.test.mjs` |
| **Route handler** (`route.ts`) | integration | POST /augment: validation 400 (R-02, R-05, R-06); happy path 200 (AC-2); D-008 activeCatalog vazio (AC-14); prompt-only (AC-13); social bypass (AC-15); cache hit log (AC-16) | `test/augment/route.test.mjs` | `npm test -- test/augment/route.test.mjs` |
| **Perf budget** (benchmark) | benchmark | 1000 synthetic requests × N≥3 runs; `median(p50) < 50ms` and `p99 < 200ms` | `test/augment/perf.test.mjs` | `npm test -- test/augment/perf.test.mjs` |
| **Log format** (`logger.ts`) | integration | Every response emits parseable JSON log with `usage.cache_read_input_tokens` field | `test/augment/log-format.test.mjs` | `npm test -- test/augment/log-format.test.mjs` |
| **`/health` endpoint** (`health/route.ts`) | unit | GET /health returns 200 + `{ status: "ok", uptime, version }` | `test/augment/health.test.mjs` | `npm test -- test/augment/health.test.mjs` |
| **Smoke script** (`scripts/smoke-augment-server.mjs`) | e2e | Server boots on free port → POST /augment twice → forward to provider → assert 2nd call shows `cache_read_input_tokens > 0` | (script) | `node scripts/smoke-augment-server.mjs` |
| **TypeScript contract** | type gate only | All types strict + `noUncheckedIndexedAccess`; ESM exports; no `any` leaks | All `src/server/**/*.ts` | `npm run typecheck` |
| **Workspace wiring** | operational | `npm install` succeeds; `fastify` resolves to a single version | (npm) | `npm ls fastify` |
| **Scope guard** | scope check | `git diff d51c408..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/` returns empty | (git) | manual |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM) + Phase 1+3 test patterns (`node --test`, ESM imports, `:memory:` better-sqlite3).

---

## Gate Check Commands

> Generated from `package.json` + `CLAUDE.md` testing contract.

| Gate Level | When to Use | Command |
|---|---|---|
| **Quick** | After tasks with unit tests only (T-02, T-04, T-06, T-07, T-08) | `npm test -- test/augment/` |
| **Full** | After tasks with integration/e2e tests (T-05, T-09, T-11) | `npm test` |
| **Typecheck** | After any TS change | `npm run typecheck` |
| **Smoke** | After T-11 | `node scripts/smoke-augment-server.mjs` |
| **Perf** | After T-12 | `node --test test/augment/perf.test.mjs` |
| **Build** | After phase completion (T-13, end of phase) | `npm test && npm run typecheck && npm run catalog:load && npm run augment-server &` + smoke test |
| **Scope guard** | After T-13 (end of phase) | `git diff d51c408..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/` returns empty |

**Note:** Root `npm test` includes `test/augment/**/*.test.mjs` (glob pattern matches). 375-test baseline preserved.

---

## Execution Plan

Four subchapters run sequentially. Each subchapter is ≤ 4 tasks. Whole Phase 5a = 2 Implementer batches.

```
Subchapter 5a.1 (Server Foundation):     T-01 → T-02 → T-03 → T-04
                                                  ↓
Subchapter 5a.2 (Retrieval Pipeline):           T-05 → T-06 → T-07 → T-08
                                                              ↓
Subchapter 5a.3 (Tests + Smoke):                     T-09 → T-10 → T-11
                                                              ↓
Subchapter 5a.4 (Perf + Hardening):                       T-12 → T-13
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 5a.1 + 5a.2 | T-01..T-08 (8 tasks) | Worker A (Implementer sub-agent) |
| **Batch 2** | 5a.3 + 5a.4 | T-09..T-13 (5 tasks) | Worker B (Implementer sub-agent) |
| **Validation** | (all) | (all 13) | Worker C (Verifier sub-agent) — fresh, evidence-or-zero |

Two batches run sequentially; Validation runs once after Batch 2 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 5a.1 — Server Foundation

#### T-01: Fastify server bootstrap + port + graceful shutdown

**File:** `src/server/bootstrap.ts` (new)

**Implements:**
- `createAugmentServer(opts: { portRange: [number, number] })` returns a Fastify instance bound to the first free port in `portRange` (default `[4200, 4299]`). Mirrors `scripts/ui-server.mjs` pattern.
- Server listens on `127.0.0.1` only (no external bind).
- Registers `/health` (T-04) and `/augment` (T-03) routes.
- Returns `{ url: string, close: () => Promise<void> }` so the entry script can log and shut down.
- Graceful shutdown on `SIGINT` / `SIGTERM` with 1s timeout.

**Depends on:** none (first task)

**Verification:**
- `npx tsx -e "import('./src/server/bootstrap.ts').then(m => m.createAugmentServer({portRange:[4200,4209]})).then(s => console.log(s.url))"` exits 0 and prints `http://127.0.0.1:4200` (or next free port).
- `npm run typecheck` exits 0.
- No test required (covered by T-04 + T-11 smoke + T-13 e2e).

**Commit:** `feat(server): Fastify bootstrap with port range + graceful shutdown (phase 5a T-01)`

**Trace:** R-01, AC-1

---

#### T-02: Zod schemas for `/augment` request/response + Context + Fingerprint

**File:** `src/server/augment/schemas.ts` (new)

**Implements:**
- `AugmentRequestSchema` — Zod schema mirroring PRD §7.1. Required: `prompt: string (min 1)`, `fingerprint: { projectPath, agentId, sessionId, gitBranch }`, `activeCatalog: string[] (min 0)`, `tenantId: string`, `schemaVersion: literal(3)`. Optional: `context: ContextSchema | null`.
- `ContextSchema` — optional `scratch: string (max 1024)`, `todos: array({ status: string, text: string }) (max 64)`, `recentFiles: string[]`, `lastEvent: { type: enum("tool_error"|"tool_call"|"tool_result"), severity?: enum, payload: unknown }`, `legacyState: string`, `sessionId: string`.
- `FingerprintSchema` — `projectPath: string`, `agentId: literal("claude-code")` (MVP canonical, returns `validation_error` for any other value per R-06), `sessionId: string (32 hex)`, `gitBranch: string`.
- `AugmentResponseSchema` — full response shape per SPEC §IMod-4. Includes `pruningDecisions` (5 reasons, all arrays), `latencyMs` (4 fields), `decisionTraceId` (UUID), `warnings` (string[]), `emptyReason` (nullable enum), `schemaVersion: literal(3)`. `cacheHit` field is OMITTED.
- Inferred TS types: `AugmentRequest`, `Context`, `Fingerprint`, `AugmentResponse`.

**Depends on:** T-01 (route handler depends on schemas)

**Verification:**
- `npm test -- test/augment/schemas.test.mjs` — 8+ test cases:
  - Valid request → parses
  - Missing `prompt` → ZodError with `"prompt"` path
  - Missing `fingerprint` → ZodError
  - Missing `activeCatalog` → ZodError
  - Missing `tenantId` → ZodError
  - Missing `schemaVersion` → ZodError
  - `schemaVersion: 4` → ZodError `"schemaVersion must be 3"`
  - `agentId: "cursor"` → ZodError `"agentId must be one of: claude-code"`
  - `context: null` → parses (canonical prompt-only)
  - `context: undefined` → parses (also prompt-only)
- `npm run typecheck` exits 0.

**Commit:** `feat(server): Zod schemas for /augment request/response (phase 5a T-02)`

**Trace:** R-02, R-03, R-05, R-06, AC-3, AC-4, AC-5, AC-24

---

#### T-03: POST `/augment` route handler (validation + delegation to pipeline)

**File:** `src/server/augment/route.ts` (new)

**Implements:**
- Fastify route handler for `POST /augment`.
- Body validation via `AugmentRequestSchema.safeParse()`. On failure → 400 with `{ error: "validation_error", details: <ZodError issues> }`.
- On success → calls `runPipeline(req, ctx)` (T-08 imports pipeline from T-05..T-08) and returns 200 with the `AugmentResponse`.
- Generates `requestId = crypto.randomUUID()` and attaches to log context.
- Emits structured log line via `requestLogger()` (T-04).
- Latency timing: `performance.now()` at request entry, subtracted at response exit. Each phase (embedding, retrieval, rerank, total) reported.

**Depends on:** T-01 (bootstrap), T-02 (schemas), T-04 (logger), T-05..T-08 (pipeline — see note below)

**Note on dependency chain:** T-03 imports from `pipeline.ts` which is built across T-05..T-08. For T-03's standalone commit, the route handler includes a STUB pipeline that returns a hardcoded response. T-08 (pipeline implementation) replaces the stub. This decouples the route skeleton from the pipeline composition.

**Verification:**
- `npm test -- test/augment/route.test.mjs` — 6+ test cases:
  - POST /augment with stub pipeline → 200 + stub response
  - POST /augment with invalid body → 400 + validation_error
  - POST /augment with `schemaVersion: 4` → 400
  - POST /augment with `agentId: "cursor"` → 400
  - POST /augment with `context: null` → 200 (prompt-only works with stub)
  - POST /augment with `activeCatalog: []` → 200 with stub
- `npm run typecheck` exits 0.
- Manual: `npm run augment-server` + curl POST → 200 + stub response.

**Commit:** `feat(server): POST /augment route handler with Zod validation (phase 5a T-03)`

**Trace:** R-01, R-02, AC-1, AC-3, AC-4, AC-5

---

#### T-04: Pino structured logger + minimal `/health` endpoint

**Files:** `src/server/logger.ts` (new), `src/server/health/route.ts` (new)

**Implements:**
- `src/server/logger.ts`:
  - `logger = pino({ level: 'info', formatters: { level: label => ({ level: label }) }, timestamp: pino.stdTimeFunctions.isoTime })`
  - `requestLogger(requestId, tenantHashed)` returns a child logger with `requestId` + `tenantId_hashed` fields bound.
- `src/server/health/route.ts`:
  - Fastify route handler for `GET /health`.
  - Returns 200 with `{ status: "ok", uptime: process.uptime(), version: <pkg version from root package.json> }`.

**Depends on:** T-01 (bootstrap registers route), T-03 (route handler uses requestLogger — but logger is its own module)

**Verification:**
- `npm test -- test/augment/log-format.test.mjs` — 3+ test cases:
  - `requestLogger("abc", "hash")` returns a child logger with the fields bound
  - `logger.info({ foo: "bar" }, "test")` emits a parseable JSON log line with `level`, `time`, `msg`
  - Request handler with mock requestId → emitted log line includes `requestId` + `tenantId_hashed`
- `npm test -- test/augment/health.test.mjs` — 2+ test cases:
  - GET /health → 200 + `{ status: "ok", uptime: number > 0, version: string }`
  - Server down → GET fails (negative test)
- `npm run typecheck` exits 0.

**Commit:** `feat(server): pino structured logger + /health endpoint (phase 5a T-04)`

**Trace:** R-15, R-20, AC-16, AC-18

---

### Subchapter 5a.2 — Retrieval Pipeline

#### T-05: Retrieval composition (FTS5 + sqlite-vec + RRF) wiring

**File:** `src/server/augment/retrieval.ts` (new)

**Implements:**
- `runRetrieval(prompt, queryVec, activeCatalog): { fused: FusedCandidate[], retrievalMs: number }`
- Calls `searchFts(prompt)` from `src/search/fts.ts` (Phase 1 calibration residue)
- Calls `searchVector(queryVec)` from `src/search/vector.ts` (Phase 1 calibration residue)
- Calls `fuseRrf(ftsHits, vecHits)` from `src/search/rrf.ts` (Phase 1 calibration residue)
- Filters `fused` to `activeCatalog` IDs only (drops non-active items)
- Returns the fused + filtered array + retrieval latency.

**Depends on:** T-03 (route uses pipeline), T-08 (pipeline composes retrieval)

**Note:** T-05 is the building block. The pipeline orchestrator (T-08) imports `runRetrieval` and stitches it with thresholds + top-K + augmenter + byte-string.

**Verification:**
- `npm test -- test/augment/retrieval.test.mjs` — 4+ test cases (uses in-memory catalog fixture):
  - Prompt with no matches → empty fused array
  - Prompt with FTS5 hits only → fused array reflects FTS5 ranks
  - Prompt with vector hits only → fused array reflects vector ranks
  - Prompt with overlapping hits → fused array sums both channels (RRF formula `1/(60+rank)`)
  - activeCatalog filter → non-active IDs dropped from fused
- `npm run typecheck` exits 0.

**Commit:** `feat(retrieval): compose FTS5 + sqlite-vec + RRF pipeline (phase 5a T-05)`

**Trace:** R-07, AC-6 (partial — assertion count enforced in T-07), AC-7 (partial — threshold enforced in T-06)

---

#### T-06: Double threshold gate (cosine ≥ 0.75 AND bm25_hits ≥ 1) + activeCatalog filesystem validation

**File:** `src/server/augment/thresholds.ts` (new)

**Implements:**
- `applyThresholds(fused, activeCatalog, catalogDir): { passed: FusedCandidate[], rejected: PruningDecisions }`
- Reads `catalogDir` (default `config/catalog/`) and validates each `activeCatalog` ID against the filesystem.
- For each fused candidate:
  - If `cosine_similarity < 0.75` → reject with reason `"below_cosine_threshold"`
  - Else if `bm25_hits < 1` → reject with reason `"below_fts_threshold"`
  - Else if `id` not in `activeCatalog` → reject with reason `"not_in_active_catalog"`
  - Else if `id` not in filesystem → reject with reason `"id_not_in_catalog"`
  - Else → pass
- Returns `passed` (array) + `rejected` (PruningDecisions with 5 reason arrays; only `rejectedByFloor` is populated in MVP).

**Depends on:** T-05 (operates on fused output)

**Verification:**
- `npm test -- test/augment/thresholds.test.mjs` — 6+ test cases:
  - cosine ≥ 0.75 AND bm25_hits ≥ 1 → passes
  - cosine < 0.75 → rejected with `"below_cosine_threshold"`
  - bm25_hits < 1 → rejected with `"below_fts_threshold"`
  - id not in activeCatalog → rejected with `"not_in_active_catalog"`
  - id not in filesystem (fs fixture) → rejected with `"id_not_in_catalog"`
  - Edge case: cosine = 0.75 exactly → passes (≥ boundary inclusive)
- `npm run typecheck` exits 0.

**Commit:** `feat(retrieval): double threshold gate + activeCatalog validation (phase 5a T-06)`

**Trace:** R-08, R-13, AC-7

---

#### T-07: Top-K selection (3-5 items) + tiebreak ordering (D-006)

**File:** `src/server/augment/top-k.ts` (new)

**Implements:**
- `topKAndTiebreak(passed, opts: { minK: 3, maxK: 5 }): { matched: FusedCandidate[], warnings: string[] }`
- Sort `passed` by RRF score DESC, then by `id.localeCompare(b.id)` ASC (D-006 tiebreak).
- Truncate to `opts.maxK` (default 5).
- If `matched.length < opts.minK` (default 3) → push warning `"only N items above threshold (< 3)"` to warnings.
- Returns the matched array + warnings.

**Depends on:** T-06 (operates on threshold-passed output)

**Verification:**
- `npm test -- test/augment/top-k.test.mjs` — 5+ test cases:
  - 7 candidates → top 5 returned (truncation)
  - 2 candidates → both returned + warning `"only 2 items above threshold (< 3)"`
  - Tied RRF scores → tiebreak by id.localeCompare ASC
  - Reverse-order input → tiebreak reorders alphabetically
  - Empty input → empty output + warning
- `npm run typecheck` exits 0.

**Commit:** `feat(retrieval): top-K selection with tiebreak ordering (phase 5a T-07)`

**Trace:** R-09, R-10, AC-6, AC-8

---

#### T-08: Augmenter 2-block `cache_control: ephemeral` + SHA256 byte-string determinism + pipeline orchestrator

**Files:** `src/server/augment/augmenter.ts` (new), `src/server/augment/byte-string.ts` (new), `src/server/augment/pipeline.ts` (new), `src/server/augment/response.ts` (new)

**Implements:**
- `src/server/augment/byte-string.ts`:
  - `sha256Hex(input: string): string` — SHA-256 hex digest via `node:crypto`.
  - `canonicalJsonStringify(value: unknown): string` — JSON.stringify with sorted keys (recursive) for deterministic field order.
- `src/server/augment/augmenter.ts`:
  - `buildSystemMessage(req, matched): { system: SystemBlock[], sha256: string }`
  - Block 1 (stable prefix): persona(s) text joined by `\n\n`, marked `cache_control: { type: "ephemeral" }`.
  - Block 2 (variable suffix): Skills + Rules + context synthesis joined by `\n\n`, marked `cache_control: { type: "ephemeral" }`.
  - Returns the 2-block structure + SHA256 hex of the canonical JSON serialization.
- `src/server/augment/pipeline.ts`:
  - `runPipeline(req, ctx): Promise<AugmentResponse>` — orchestrates the full flow:
    1. Social detector gate (`isSocial(prompt)`)
    2. Active catalog vazio (D-008)
    3. Embed query (calls `MultilingualE5SmallEmbedder.encode`)
    4. Retrieval (`runRetrieval`)
    5. Thresholds (`applyThresholds`)
    6. Top-K + tiebreak (`topKAndTiebreak`)
    7. Augmenter (`buildSystemMessage`)
    8. Build response (`buildResponse`)
- `src/server/augment/response.ts`:
  - `buildResponse(req, pipelineOutput): AugmentResponse` — partitions matched array by type into `matchedSkills/Rules/Personas`, generates `decisionTraceId = crypto.randomUUID()`, computes `latencyMs`, sets `emptyReason` based on pipeline state, returns full response.

**Depends on:** T-04 (logger), T-05 (retrieval), T-06 (thresholds), T-07 (top-K)

**Verification:**
- `npm test -- test/augment/byte-string.test.mjs` — 3+ test cases:
  - SHA256 of empty string matches NIST vector
  - Same input → same hash (determinism)
  - Canonical JSON: `{b:1,a:2}` and `{a:2,b:1}` produce same canonical string
- `npm test -- test/augment/augmenter.test.mjs` — 4+ test cases:
  - 1 persona + 2 skills → 2 blocks, block 1 = persona text only, block 2 = skills + context
  - Both blocks have `cache_control: { type: "ephemeral" }` marker
  - Same input → same SHA256 (determinism)
  - Persona-only case (no matched skills) → block 2 is empty but still present
- `npm test -- test/augment/route.test.mjs` (extended) — full happy path:
  - POST /augment with fixture catalog + query that matches 3-5 items → 200 + valid `AugmentResponse` with SHA256
  - POST /augment with social prompt → 200 + `emptyReason: "social"`
  - POST /augment with `activeCatalog: []` → 200 + `emptyReason: "no_active_items"`
  - POST /augment with `context: null` → 200 + matches (prompt-only mode)
- `npm run typecheck` exits 0.

**Commit:** `feat(augmenter): 2-block cache_control + SHA256 byte-string + pipeline orchestrator (phase 5a T-08)`

**Trace:** R-07, R-08, R-09, R-10, R-11, R-12, R-14, R-17, AC-2, AC-6, AC-7, AC-8, AC-9, AC-11, AC-13, AC-14, AC-15

---

### Subchapter 5a.3 — Tests + Smoke

#### T-09: SHA256 byte-string equality test (D-006) — integration test

**File:** `test/augment/byte-string-equality.test.mjs` (new)

**Implements:**
- Integration test that POSTs `/augment` twice with identical logical input (same prompt, context, activeCatalog, persona IDs).
- Uses an in-process test server (boots on a free port, runs the request handler directly via Fastify `inject()`).
- Asserts: both responses have identical `systemMessage` field (byte-equal hex strings).
- Includes 5+ cases:
  - Identical input → identical SHA256
  - Different prompt → different SHA256
  - Different activeCatalog → different SHA256
  - Different persona → different SHA256
  - Different context (scratch text) → different SHA256

**Depends on:** T-08 (pipeline complete)

**Verification:**
- `npm test -- test/augment/byte-string-equality.test.mjs` — 5+ test cases, all pass.
- `npm run typecheck` exits 0.

**Commit:** `test(augment): SHA256 byte-string equality test (D-006 done criterion) (phase 5a T-09)`

**Trace:** R-12, AC-9

---

#### T-10: Tiebreak stress test (1000 synthetic requests with random cosine scores)

**File:** `test/augment/tiebreak-stress.test.mjs` (new)

**Implements:**
- Generator script that:
  1. Sets up a fixed catalog fixture with N=20 items + embeddings clustered near threshold.
  2. For i = 1 to 1000:
     - Generates a query embedding whose cosine similarity to the same K=5 items falls in `[threshold-eps, threshold+eps]` (eps = 0.05).
     - Calls `/augment` (via in-process Fastify `inject()` for speed).
     - Captures `systemMessage` SHA256 from response.
  3. Asserts: ALL 1000 SHA256 values are identical.
  4. Asserts: matched IDs are the same set in all 1000 responses.
- Uses `seedrandom` or a deterministic PRNG to make the test reproducible.
- Excludes network overhead by using `app.inject()` instead of real HTTP.

**Depends on:** T-08 (pipeline complete)

**Verification:**
- `npm test -- test/augment/tiebreak-stress.test.mjs` — runs 1000 requests, asserts SHA256 equality.
- Output: `[tiebreak-stress] 1000/1000 SHA256 equal: <hash>` and `PASS`.
- `npm run typecheck` exits 0.

**Commit:** `test(augment): tiebreak stress test (1000 requests, D-006 done criterion) (phase 5a T-10)`

**Trace:** R-19, AC-10

---

#### T-11: Smoke script (`scripts/smoke-augment-server.mjs`) + Claude Code integration guide

**Files:** `scripts/smoke-augment-server.mjs` (new), `docs/guides/claude-code-baseurl.md` (new)

**Implements:**
- `scripts/smoke-augment-server.mjs`:
  - Boots the server on a free port (env var override).
  - POSTs `/augment` twice with identical input.
  - Asserts both responses have the same `systemMessage`.
  - Forwards BOTH `systemMessage`s to a provider (real Anthropic API or stub fixture).
  - Asserts 2nd call shows `usage.cache_read_input_tokens > 0`.
  - Captures server log line and verifies `usage.cache_read_input_tokens` field is present.
  - Reports PASS/FAIL with structured output.
- `docs/guides/claude-code-baseurl.md`:
  - Section 1: SDK-level smoke (Phase 5a shipped) — example code wiring `MemoryStudioClient.augment`.
  - Section 2: Transparent proxy (Phase 5b future) — `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>`.
  - Section 3: Troubleshooting — port conflicts, server unreachable, cache hit not appearing in logs.
  - Total < 100 lines.

**Depends on:** T-04 (logger), T-08 (pipeline), T-09 (equality test)

**Verification:**
- `node scripts/smoke-augment-server.mjs` exits 0 with `[smoke] PASS`.
- Manual review of `docs/guides/claude-code-baseurl.md` — sections present, < 100 lines, code examples syntactically valid.

**Commit:** `feat(smoke): end-to-end smoke script + Claude Code integration guide (phase 5a T-11)`

**Trace:** R-16, R-21, AC-12, AC-19

---

### Subchapter 5a.4 — Perf + Hardening

#### T-12: Perf measurement harness (p50<50ms, p99<200ms, N≥3 runs)

**File:** `test/augment/perf.test.mjs` (new)

**Implements:**
- Perf harness that:
  1. Boots the server (in-process via Fastify `inject()` for stability).
  2. Warms up with 100 requests (excluded from measurement).
  3. Runs N=3 measurement rounds.
  4. Per round: sends 1000 synthetic `/augment` requests, records `latencyMs.total` for each.
  5. Computes `min`, `median`, `p95`, `p99` per round.
  6. Reports aggregated `min/median/p95/p99` across N rounds.
  7. Asserts: `median(p50) < 50ms` AND `p99 < 200ms` (per PRD §10.2).
- Uses deterministic fixture catalog + embedding so the embedder warm-cache hits consistently.
- Excludes the embedding round-trip from the 1000-request loop by pre-computing the query embedding and reusing it (proves server overhead, not ONNX runtime cost).

**Depends on:** T-08 (pipeline complete)

**Verification:**
- `node --test test/augment/perf.test.mjs` exits 0.
- Output: `[perf] median(p50)=<ms> p99=<ms> across 3 runs × 1000 requests. PASS` or `FAIL`.
- `npm run typecheck` exits 0.

**Commit:** `test(augment): perf harness p50<50ms p99<200ms across N>=3 runs (phase 5a T-12)`

**Trace:** R-18, AC-17

---

#### T-13: E2E route integration test + entry point (`scripts/augment-server.ts`) + `package.json` wiring + scope guard

**Files:** `scripts/augment-server.ts` (new), `package.json` (modify), `test/augment/route-e2e.test.mjs` (new)

**Implements:**
- `scripts/augment-server.ts`:
  - Entry point that imports `createAugmentServer` from `src/server/bootstrap.ts`.
  - Reads `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var (default `[4200, 4299]`).
  - Boots server, logs `Memory Studio augment server: http://127.0.0.1:<port>`.
  - Sets up SIGINT/SIGTERM graceful shutdown handlers.
  - Mirrors `scripts/ui-server.mjs` structure exactly.
- `package.json`:
  - Adds `"fastify": "^5.x"` to `dependencies`.
  - Adds `"augment-server": "node --experimental-strip-types --no-warnings scripts/augment-server.ts"` to `scripts`.
  - No other changes.
- `test/augment/route-e2e.test.mjs`:
  - Boots the actual `scripts/augment-server.ts` as a child process.
  - Sends 5+ end-to-end requests covering all the AC-NN criteria (validation 400, happy path 200, D-008, prompt-only, social bypass).
  - Asserts the server stays up under concurrent load (10 simultaneous requests).
  - Cleans up the child process.

**Depends on:** T-01..T-12 (entire phase)

**Verification:**
- `npm test -- test/augment/route-e2e.test.mjs` — 8+ test cases, all pass.
- `npm run augment-server` → boots, log line printed, Ctrl-C stops within 1s.
- `git diff d51c408..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/` returns empty (scope guard).
- `npm ls fastify` returns a single resolved version.
- `npm run typecheck` exits 0.
- `npm test` reports ≥375 + new tests passing (target ≥425).
- `node scripts/smoke-augment-server.mjs` exits 0.

**Commit:** `feat(augment-server): entry point + e2e test + package.json wiring (phase 5a T-13)`

**Trace:** R-01, R-22, R-23, AC-1, AC-20, AC-21, AC-22, AC-23

---

## Summary

| Subchapter | Tasks | Files (new) | Files (modify) | Atomic commits |
|---|---|---|---|---|
| **5a.1 Server Foundation** | T-01..T-04 | 4 (`src/server/bootstrap.ts`, `src/server/augment/schemas.ts`, `src/server/augment/route.ts`, `src/server/logger.ts`, `src/server/health/route.ts`) | 0 | 4 |
| **5a.2 Retrieval Pipeline** | T-05..T-08 | 5 (`src/server/augment/retrieval.ts`, `src/server/augment/thresholds.ts`, `src/server/augment/top-k.ts`, `src/server/augment/augmenter.ts`, `src/server/augment/byte-string.ts`, `src/server/augment/pipeline.ts`, `src/server/augment/response.ts`) | 0 (`src/server/augment/route.ts` stub replaced in T-08) | 4 |
| **5a.3 Tests + Smoke** | T-09..T-11 | 3 (`test/augment/byte-string-equality.test.mjs`, `test/augment/tiebreak-stress.test.mjs`, `scripts/smoke-augment-server.mjs`, `docs/guides/claude-code-baseurl.md`) | 0 | 3 |
| **5a.4 Perf + Hardening** | T-12..T-13 | 2 (`test/augment/perf.test.mjs`, `test/augment/route-e2e.test.mjs`, `scripts/augment-server.ts`) | 1 (`package.json`) | 2 |
| **Total** | **13** | **~20 new files** | **1 file (package.json)** | **13 atomic commits** |

**Test count target:** baseline 375 + new tests (~50-70) = target ≥425.
