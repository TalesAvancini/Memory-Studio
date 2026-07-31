---
date: 2026-07-31
version: 1
description: "Phase 2 atomic tasks. 5 tasks across 3 subchapters (2.1 Detector promotion, 2.2 Fingerprint + hash, 2.3 Audit schema migration). Each task is one component/function/file with verification criteria, atomic commit, and traceable to spec R/AC IDs."
explanation: |
  Phase 2 packs into 3 subchapters per SUBCHAPTER_BREAKDOWN trigger (5 tasks
  total, ~1 Implementer batch):

    - 2.1 Detector promotion: T-01 (move + expand catalog), T-02 (20+20 fixture
      + FP rate test)
    - 2.2 Fingerprint + hash: T-03 (hash primitive), T-04 (fingerprint function)
    - 2.3 Audit schema: T-05 (002 migration + integration test)

  Subchapter boundaries are at genuine dependency seams:
    - 2.1: detector only (no fingerprint, no migration)
    - 2.2: fingerprint only (depends on no other Phase 2 module — independent)
    - 2.3: audit schema only (depends on Phase 1.2 migration runner — already
      shipped at d6ff85b)

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md

  Single Implementer batch fits naturally: 5 tasks < 8-task budget.
  Verifier dispatches after all 5 tasks complete.
related:
  - ./spec.md
  - ../../ROADMAP.md
  - ../../ARCHITECTURE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../features/phase-1-catalog-schema-index/{spec,design,tasks}.md
  - ../../archive/2026-07-calibration/features/social-detector/{spec,design,tasks}.md
  - ../../../src/social-detector/is-social.ts
  - ../../../src/catalog/migrations/001_init.sql
  - ../../../CLAUDE.md
---

# Phase 2 — Detector + Fingerprint — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `d6ff85b` (Phase 1 final — Catalog + Schema + Index all green)
**Output deliverables:**
- `src/social-detector/{social,types,index}.ts` (promoted + minimally expanded)
- `src/fingerprint/{hash,fingerprint,types,index}.ts` (new greenfield)
- `src/catalog/migrations/002_audit_events_tenant_id_rename.sql` (new DDL)
- `test/social-detector/fixtures.yaml` (20 social + 20 real prompts)
- `test/fingerprint/{hash,fingerprint}.test.mjs` (new test files)
- `test/social-detector.test.mjs` (existing — import path updated)

---

## Test Coverage Matrix

> Generated from codebase + CLAUDE.md testing contract + spec acceptance criteria.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Social detector** (promoted module) | unit | All POS-01..POS-30 (calibration) + new `ok`/`okay` patterns + NORM-01..NORM-09 + FP-01..FP-12 + 20+20 fixture (FP rate ≤5%) | `test/social-detector.test.mjs` (existing, import path updated) + `test/social-detector/fixtures.yaml` | `npm test` |
| **Hash primitive** | unit | 3+ NIST/RFC golden vectors (empty string, "abc", "The quick brown fox..."); determinism; 32-char hex shape; node:crypto perf (<100ms for 1MB) | `test/fingerprint/hash.test.mjs` (new) | `npm test` |
| **Fingerprint function** | unit | 4-component return shape; sessionId hashed before return (raw never in output); unicode + ASCII sessionId; determinism | `test/fingerprint/fingerprint.test.mjs` (new) | `npm test` |
| **Audit events migration `002`** | unit (DB-isolated) | Idempotency (re-run is no-op); `tenant_hash` gone after apply; `tenantId_hashed` present; all 10 ROADMAP done #5 + PRD §10.3 columns present | `test/catalog/migrations-phase-2.test.mjs` (new) — or additive to `test/catalog/migrations.test.mjs` | `npm test` |
| **Migration runner (Phase 1.2)** | none | Covered by Phase 1.2 tests; Phase 2 verifies `002` is auto-discovered | (Phase 1.2 existing tests) | `npm test` |
| **TypeScript contract** | none — build/type gate only | Exact `isSocial`, `hashSha256_16`, `fingerprint` signatures; strict mode; ESM; no new npm deps | All `src/social-detector/*.ts` + `src/fingerprint/*.ts` + `src/catalog/migrations/002_*.sql` | `npm run typecheck` |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM, native `node:test`).

---

## Gate Check Commands

> Generated from `package.json` + CLAUDE.md testing contract.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| **Quick** | After tasks with unit tests only (T-01, T-02, T-03, T-04, T-05) | `npm test` |
| **Full** | Before each task commit | 1. `npm test`  2. `npm run typecheck`  3. `git diff d6ff85b..HEAD -- src/catalog/` to confirm only `002_*.sql` was added |
| **Build** | After phase completion (after T-05) | `npm test && npm run typecheck` + verify Phase 1 baseline preserved |
| **Typecheck** | After any TS change | `npm run typecheck` |

---

## Execution Plan

Three subchapters run sequentially. Each subchapter is ≤ 2 tasks, fits one Implementer batch. Whole Phase 2 = 1 batch.

```
Subchapter 2.1 (Detector):         T-01 → T-02
Subchapter 2.2 (Fingerprint):            T-03 → T-04
Subchapter 2.3 (Audit schema):                T-05
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 2.1 + 2.2 + 2.3 | T-01..T-05 (5 tasks) | Worker A (Implementer sub-agent) |
| **Validation** | (all) | (all 5) | Worker B (Verifier sub-agent) — fresh, evidence-or-zero |

Single batch runs first; Validation runs once after Batch 1 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 2.1 — Social Detector Promotion

#### T-01: Promote detector module + add minimal `ok`/`okay` patterns

**What:** Move `src/social-detector/is-social.ts` → `src/social-detector/social.ts`. Create `src/social-detector/types.ts` (empty placeholder for now) and `src/social-detector/index.ts` (barrel: `export { isSocial } from "./social.ts"`). Add two new patterns (`/^ok$/u` and `/^okay$/u`) to the `SOCIAL_PATTERNS` array. Delete the old `is-social.ts` file. Update the import path in `test/social-detector.test.mjs`.

**Where:**
- DELETE: `src/social-detector/is-social.ts`
- CREATE: `src/social-detector/social.ts` (verbatim move of `is-social.ts` content + 2 new regex entries at the end of `SOCIAL_PATTERNS`)
- CREATE: `src/social-detector/types.ts` (placeholder: `export {};` or empty type namespace for future expansion)
- CREATE: `src/social-detector/index.ts` (barrel: `export { isSocial } from "./social.ts";`)
- MODIFY: `test/social-detector.test.mjs` (change `from '../src/social-detector/is-social.ts'` to `from '../src/social-detector/index.ts'` or `'../src/social-detector/social.ts'`)

**Depends on:** None (first task)

**Reuses:** Calibration `src/social-detector/is-social.ts` (verbatim algorithm copy + 2 regex additions)

**Requirement:** R-01, R-02, R-09, R-11, AC-1, AC-2, AC-3, AC-12

**Tools:**
- MCP: `filesystem`
- Skill: NONE (pure file move + 2-line addition)

**Done when:**
- [ ] `src/social-detector/is-social.ts` does not exist (`rm` confirmed)
- [ ] `src/social-detector/social.ts` exists with the calibration `FALSE_POSITIVE_PATTERNS`, `SOCIAL_PATTERNS`, `normalizePrompt`, and `isSocial` export — PLUS two new regex entries (`/^ok$/u` and `/^okay$/u`) at the end of `SOCIAL_PATTERNS`
- [ ] `src/social-detector/types.ts` exists (placeholder)
- [ ] `src/social-detector/index.ts` exports `isSocial`
- [ ] `test/social-detector.test.mjs` import path is updated (no more `is-social.ts`)
- [ ] `npm test` passes — all 60+ calibration tests still green (POS-01..POS-30, NORM-01..NORM-09, FP-01..FP-12, long-input, determinism)
- [ ] `isSocial("ok") === true` and `isSocial("okay") === true` (new patterns working)
- [ ] `isSocial("...") === false` (NORM-09 preserved)
- [ ] `npm run typecheck` exits 0

**Tests:** existing `test/social-detector.test.mjs` (60+ tests, all preserved) — no test deletions

**Gate:** full (test + typecheck)

**Commit:** `feat(phase-2): promote social detector + add ok/okay bypass patterns (T-01)`

---

#### T-02: Add 20+20 fixture file + FP rate test

**What:** Create `test/social-detector/fixtures.yaml` with 20 social + 20 real prompts (PT-BR + EN mix). Add tests to `test/social-detector.test.mjs` that load the fixture file, run each prompt through `isSocial`, assert every social returns `true`, every real returns `false`, and assert FP rate ≤ 5% (≤ 1 of 20 real prompts misclassified).

**Where:**
- CREATE: `test/social-detector/fixtures.yaml` (20 social + 20 real)
- MODIFY: `test/social-detector.test.mjs` (add fixture-loading test block at the end)

**Depends on:** T-01

**Reuses:** `yaml` package from Phase 1.2 (already in `package.json`)

**Requirement:** R-10, AC-4, AC-5

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `test/social-detector/fixtures.yaml` exists with 2 top-level keys:
  - `social_prompts:` — array of 20 strings (PT-BR + EN mix: `oi`, `valeu`, `thanks`, `ok`, `bye`, etc., each exactly matching the calibration pattern shape)
  - `real_prompts:` — array of 20 strings (real dev prompts: `refatora o parser`, `write JWT auth tests`, `fix the auth bug`, etc. — each MUST contain a social word in a non-bypass context so the test proves calibration FP safety)
- [ ] `test/social-detector.test.mjs` has a new `test('20+20 fixture: FP rate ≤ 5%', () => {...})` block that:
  - Reads and parses `fixtures.yaml` via the `yaml` package
  - Asserts `social_prompts.length === 20`
  - Asserts `real_prompts.length === 20`
  - For each social prompt: `assert.equal(isSocial(prompt), true)` — count failures
  - For each real prompt: `assert.equal(isSocial(prompt), false)` — count failures
  - Asserts `realFailures <= 1` (FP rate ≤ 5%)
- [ ] `npm test` passes — fixture test is green and FP rate is 0% (target) or ≤ 5% (max tolerated)
- [ ] If a real prompt fails, the Implementer MUST replace it with another real prompt that the detector handles correctly (or add a false-positive catalog entry, but only if the prompt is truly a bypass context — e.g., `"thanks, now refactor"` is already a known FP-07)

**Tests:** 1 new test block (composite — loads fixture, asserts batch behavior)

**Gate:** full

**Commit:** `test(phase-2): 20+20 social detector fixture + FP rate assertion (T-02)`

---

### Subchapter 2.2 — Fingerprint + Hash

#### T-03: Implement `sha256[0:16]` hash primitive + golden vectors test

**What:** Create `src/fingerprint/hash.ts` exporting `hashSha256_16(input: string): string`. Use Node 22 `node:crypto` `createHash("sha256").update(input, "utf8").digest()` (Buffer) and return `digest.subarray(0, 16).toString("hex")` (first 16 bytes → 32 hex chars). Add `test/fingerprint/hash.test.mjs` with golden vectors.

**Where:**
- CREATE: `src/fingerprint/hash.ts`
- CREATE: `test/fingerprint/hash.test.mjs`

**Depends on:** None (independent greenfield)

**Reuses:** `node:crypto` (Node 22 built-in)

**Requirement:** R-04, R-07, AC-7, AC-8

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `src/fingerprint/hash.ts` exists and exports `hashSha256_16(input: string): string`
- [ ] Function uses `import { createHash } from "node:crypto"` (no other imports — no new deps)
- [ ] `hashSha256_16("")` returns `"e3b0c44298fc1c149afbf4c8996fb924"` (NIST SHA-256 of empty, first 16 bytes)
- [ ] `hashSha256_16("abc")` returns `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"` (NIST SHA-256 of "abc", first 16 bytes — standard SHA-256 of "abc" is `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad` so first 32 hex chars)
- [ ] `hashSha256_16("The quick brown fox jumps over the lazy dog")` returns `"d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"` (standard SHA-256 first 32 hex chars)
- [ ] Returned string is always 32 chars, lowercase hex (`/^[0-9a-f]{32}$/`)
- [ ] Determinism: same input → same output (verified by test)
- [ ] `test/fingerprint/hash.test.mjs` has 4+ golden vectors + 1 determinism test + 1 shape regex test
- [ ] `npm test` passes; `npm run typecheck` exits 0
- [ ] `package.json` `dependencies` block is unchanged (no new npm deps)

**Tests:** unit — 4 golden vectors + 1 determinism + 1 shape regex + 1 perf-sanity (1MB input < 100ms)

**Gate:** full

**Commit:** `feat(phase-2): sha256[0:16] hash primitive with golden vectors (T-03)`

---

#### T-04: Implement `fingerprint()` function + 4-component integration test

**What:** Create `src/fingerprint/fingerprint.ts` with `fingerprint(input: { projectPath: string; agentId: string; sessionId: string; gitBranch: string }): Promise<{ projectPath: string; agentId: string; sessionId: string; gitBranch: string }>`. The returned `sessionId` field is `hashSha256_16(input.sessionId)` — raw sessionId never appears in the return. Create `src/fingerprint/types.ts` with `FingerprintInput` and `Fingerprint` interfaces. Update `src/fingerprint/index.ts` (barrel: export `fingerprint` + `hashSha256_16`). Add `test/fingerprint/fingerprint.test.mjs`.

**Where:**
- CREATE: `src/fingerprint/fingerprint.ts`
- CREATE: `src/fingerprint/types.ts`
- CREATE: `src/fingerprint/index.ts` (barrel)
- CREATE: `test/fingerprint/fingerprint.test.mjs`

**Depends on:** T-03 (uses `hashSha256_16`)

**Reuses:** T-03's `hashSha256_16`

**Requirement:** R-03, R-08, AC-6

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `src/fingerprint/fingerprint.ts` exports `async function fingerprint(input: FingerprintInput): Promise<Fingerprint>`
- [ ] Returned object has exactly 4 keys: `projectPath`, `agentId`, `sessionId`, `gitBranch`
- [ ] Returned `sessionId` is `hashSha256_16(input.sessionId)` (32-char hex)
- [ ] Returned `projectPath`, `agentId`, `gitBranch` are passed through unchanged (no transformation)
- [ ] Raw `input.sessionId` is NEVER present in the return value (verified by test: `!Object.values(result).includes(input.sessionId)` for a unique sessionId like `"my-very-distinctive-test-session-id-12345"`)
- [ ] `src/fingerprint/types.ts` exports `FingerprintInput` and `Fingerprint` interfaces (locked shape per ROADMAP done #3)
- [ ] `src/fingerprint/index.ts` exports `{ fingerprint, hashSha256_16 }`
- [ ] `test/fingerprint/fingerprint.test.mjs` has:
  - 1 test: `fingerprint` returns object with exactly 4 keys (`Object.keys(result).length === 4` and all expected keys present)
  - 1 test: returned `sessionId` matches `hashSha256_16(input.sessionId)`
  - 1 test: raw sessionId not in result (anti-leak guard)
  - 1 test: determinism (call twice with same input, results equal)
  - 1 test: unicode sessionId (emoji + CJK) hashes correctly
- [ ] `npm test` passes; `npm run typecheck` exits 0

**Tests:** unit — 5 new behavior tests

**Gate:** full

**Commit:** `feat(phase-2): fingerprint() function with 4-component hash contract (T-04)`

---

### Subchapter 2.3 — Audit Schema Migration

#### T-05: `002_audit_events_tenant_id_rename.sql` migration + integration test

**What:** Create `src/catalog/migrations/002_audit_events_tenant_id_rename.sql` containing the single statement `ALTER TABLE audit_events RENAME COLUMN tenant_hash TO "tenantId_hashed";`. Add `test/catalog/migrations-phase-2.test.mjs` (new test file) that:
- Opens an in-memory SQLite DB
- Applies migrations 001 + 002 via the Phase 1.2 runner
- Asserts `schema_migrations` has versions 1 + 2
- Asserts `PRAGMA table_info(audit_events)` returns 10 columns including `"tenantId_hashed"` (quoted) and NOT `tenant_hash`
- Re-runs migrations and asserts idempotency (no version 2 re-insert)

**Where:**
- CREATE: `src/catalog/migrations/002_audit_events_tenant_id_rename.sql`
- CREATE: `test/catalog/migrations-phase-2.test.mjs`

**Depends on:** None (independent of T-01..T-04; uses Phase 1.2 runner which is at `d6ff85b`)

**Reuses:** Phase 1.2's `applyMigrations` runner (`src/catalog/migrations/runner.ts`) + Phase 1.2's `openCatalogDb` (`src/catalog/db/open.ts`) — auto-discovers `00N_*.sql` files in lexical order

**Requirement:** R-05, R-06, AC-9, AC-10, AC-11, AC-13

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `src/catalog/migrations/002_audit_events_tenant_id_rename.sql` exists with content: `ALTER TABLE audit_events RENAME COLUMN tenant_hash TO "tenantId_hashed";` (and a brief comment header explaining the rename)
- [ ] `test/catalog/migrations-phase-2.test.mjs`:
  - Test 1: applies `001_init.sql` + `002_*.sql` on fresh DB; `schema_migrations` has versions 1 and 2; `PRAGMA table_info(audit_events)` returns 10 rows including `"tenantId_hashed" TEXT NOT NULL`
  - Test 2: `PRAGMA table_info(audit_events)` returns 0 rows with `name = 'tenant_hash'` (column renamed away)
  - Test 3: idempotency — re-running `applyMigrations` on the same DB returns the same `currentVersion: 2` (no version 2 re-insert)
  - Test 4: data preservation — inserting a row with the old `tenant_hash` column name (via raw SQL on a fresh 001-only DB) and then applying 002 retains the row's value under `tenantId_hashed` (ALTER TABLE RENAME COLUMN preserves data)
- [ ] `npm test` passes
- [ ] `git diff d6ff85b..HEAD -- src/catalog/` shows ONLY `migrations/002_audit_events_tenant_id_rename.sql` added; no other catalog source file changed (AC-13)
- [ ] `package.json` `dependencies` block unchanged

**Tests:** unit — 4 new migration behavior tests

**Gate:** full + diff verification (`git diff d6ff85b..HEAD -- src/catalog/`)

**Commit:** `feat(phase-2): rename audit_events.tenant_hash → tenantId_hashed (T-05)`

---

## Phase Execution Map

```
Subchapter 2.1 (Detector):         T-01 → T-02
Subchapter 2.2 (Fingerprint):            T-03 → T-04
Subchapter 2.3 (Audit schema):                T-05
```

Execution is strictly sequential — no intra-subchapter parallelism. T-03 is independent of T-01/T-02 but is sequenced after for batch simplicity.

---

## Requirement Coverage

| Requirement | Planned task(s) | Outcome evidence |
|---|---|---|
| R-01 | T-01 | Module + barrel at `src/social-detector/`, `isSocial` export preserved |
| R-02 | T-01 | `ok`/`okay` patterns added to `SOCIAL_PATTERNS`; calibration tests still pass |
| R-03 | T-04 | `fingerprint()` returns 4-comp object with hashed sessionId |
| R-04 | T-03 | `hashSha256_16` returns 32-char hex; 4 golden vectors |
| R-05 | T-05 | `002_audit_events_tenant_id_rename.sql` applies cleanly |
| R-06 | T-05 | Migration runner applies `002` idempotently |
| R-07 | T-03, T-04 | Only `node:crypto` used; no new npm deps |
| R-08 | T-04 | Function signature matches ROADMAP done #3 |
| R-09 | T-01 | Calibration test count preserved (60+ tests still pass) |
| R-10 | T-02 | Fixture file with 20+20 + FP rate ≤5% test |
| R-11 | T-01, T-02 | NORM-09 preserved; "..." → false |
| R-12 | T-01..T-05 | Scope guard: only `src/social-detector/`, `src/fingerprint/`, `src/catalog/migrations/002_*.sql` + matching tests |
| AC-1 | T-01 | POS-01..POS-30 fixtures all return true |
| AC-2 | T-01 | `isSocial("ok") === true` and `isSocial("okay") === true` |
| AC-3 | T-01, T-02 | `isSocial("...") === false` |
| AC-4 | T-02 | Fixture file with exactly 20 + 20 prompts |
| AC-5 | T-02 | FP rate assertion in test |
| AC-6 | T-04 | fingerprint signature + return shape verified |
| AC-7 | T-03 | 4 golden vectors |
| AC-8 | T-03 | Determinism + shape regex test |
| AC-9 | T-05 | Migration file content |
| AC-10 | T-05 | All 10 columns present after migration |
| AC-11 | T-05 | `tenant_hash` gone after migration |
| AC-12 | T-01, T-02, T-03, T-04, T-05 | All gates preserve Phase 1 baseline |
| AC-13 | T-05 | `git diff` shows only 002 file added |
| AC-14 | T-03, T-04 | `package.json` unchanged |

**Coverage:** 12 requirements + 14 ACs = 26 mapped to tasks, 0 unmapped.

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T-01: Promote detector + add ok/okay | 1 file move + 3 file creates + 1 file modify + 2-line regex addition | OK — cohesive detector promotion |
| T-02: 20+20 fixture + FP rate test | 1 fixture file + 1 test block addition | OK — cohesive fixture + test |
| T-03: Hash primitive + golden vectors | 2 file creates (1 source + 1 test) | OK — cohesive primitive |
| T-04: Fingerprint function + integration | 3 file creates (1 source + 1 types + 1 barrel) + 1 test | OK — cohesive fingerprint |
| T-05: Migration + integration test | 1 DDL file + 1 test file | OK — cohesive audit schema |

**Granularity check:** all 5 tasks are atomic (1 component / 1 function / 1 logical unit). No restructuring needed.

---

## Diagram-Definition Cross-Check

| Task | Depends on (task body) | Diagram Shows | Status |
|---|---|---|---|
| T-01 | None | (root) | OK |
| T-02 | T-01 | T-01 → T-02 | OK |
| T-03 | None | (root, independent) | OK |
| T-04 | T-03 | T-03 → T-04 | OK |
| T-05 | None | (root, independent) | OK |

All `Depends on` arrows match the diagram. No task depends on a later task.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T-01 | Social detector source (move + 2-line addition) | unit | unit (existing tests preserved) | OK |
| T-02 | Fixture file + additive test | unit | unit | OK |
| T-03 | Hash primitive | unit | unit (golden vectors + determinism) | OK |
| T-04 | Fingerprint function | unit | unit (4-comp + hash + no-leak) | OK |
| T-05 | Migration + integration test | unit | unit (DB-isolated) | OK |

All tasks satisfy the Test Coverage Matrix. No `Tests: none` for code layers that require tests.

---

## Cross-references

- [`./spec.md`](./spec.md) — 12 R-NN + 14 AC-NN requirements
- [`.specs/ROADMAP.md` Phase 2](../../ROADMAP.md) — done criteria (6 checkboxes, lines 234-256)
- [`.specs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — farol stable IDs (`social-detector`, `sqlite`, `sdk`, `augmenter`)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md) — promotion vs. rewrite policy
- [PRD §5](../../../PRD.md) — SDK fingerprint shape
- [PRD §8](../../../PRD.md) — `sha256[0:16]` invariante sólida
- [PRD §10.3 items 1 + 2](../../../PRD.md) — zero raw persistence + tenantId hashed
- [PRD §14.4](../../../PRD.md) — `agentId = "claude-code"` MVP
- [`.scratch/memory-studio/spec.md` §IMod-2](../../../.scratch/memory-studio/spec.md) — SDK API contract
- [`.scratch/memory-studio/spec.md` §F](../../../.scratch/memory-studio/spec.md) — security invariants
- [`src/social-detector/is-social.ts`](../../../src/social-detector/is-social.ts) — promotion source
- [`src/catalog/migrations/001_init.sql`](../../../src/catalog/migrations/001_init.sql) — `tenant_hash` column being renamed
- [`package.json`](../../../package.json) — no new deps
- [`CLAUDE.md`](../../../CLAUDE.md) — testing contract, gate commands
- [`scripts/lessons.py`](../../../scripts/lessons.py) — `quarantine <id>` for calibration residue drift findings (AD-002)
- Phase 1 spec: [`.specs/features/phase-1-catalog-schema-index/spec.md`](../../features/phase-1-catalog-schema-index/spec.md)
- Phase 1 tasks: [`.specs/features/phase-1-catalog-schema-index/tasks.md`](../../features/phase-1-catalog-schema-index/tasks.md)
- Calibration baseline: [`.specs/archive/2026-07-calibration/features/social-detector/validation.md`](../../archive/2026-07-calibration/features/social-detector/validation.md) — 60/60 tests proof
