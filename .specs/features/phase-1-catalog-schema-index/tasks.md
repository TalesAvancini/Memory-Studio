---
date: 2026-07-30
version: 1
description: "Phase 1 atomic tasks. 16 tasks across 4 subchapters (1.1 schema+Zod, 1.2 migrations, 1.3 loader, 1.4 build-index+perf). Each task is one component/function/file with verification criteria, atomic commit, and traceable to spec R/AC IDs."
explanation: |
  Phase 1 packs into 4 subchapters per SUBCHAPTER_BREAKDOWN trigger (>15 tasks).
  Subchapter boundaries are at genuine dependency seams:
    - 1.1: pure TS schema work (no DB)
    - 1.2: DB substrate (depends on 1.1 types only for FK targets)
    - 1.3: writer/orchestration (depends on 1.1 + 1.2)
    - 1.4: CLI + perf + wiring (depends on all above)

  Two Implementer batches fit naturally:
    - Batch 1: subchapters 1.1 + 1.2 (T-01..T-08 = 8 tasks)
    - Batch 2: subchapters 1.3 + 1.4 (T-09..T-16 = 8 tasks)

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md
related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../../../CLAUDE.md
---

# Phase 1 — Catalog + Schema + Index — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Output deliverable:** rewritten `src/catalog/**` + `scripts/build-index.ts` + `config/catalog/` + `data/memory-studio.sqlite` (runtime artifact, gitignored)

---

## Test Coverage Matrix

> Generated from codebase sampling + CLAUDE.md testing contract. Guidelines found: `CLAUDE.md` (testing contract: `npm test`, `npm run typecheck`, `npm run catalog:load`).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Zod schemas** (skill/rule/persona) | unit | 1:1 to R-02 valid+invalid fixtures; every AC-2 error case covered | `test/catalog/schema.test.mjs` | `npm test` |
| **Migration runner** | unit | Idempotency (re-run is no-op); version tracking; DDL error path | `test/catalog/migrations.test.mjs` | `npm test` |
| **FTS5 triggers** | unit (DB-isolated) | INSERT/UPDATE/DELETE sync from catalog → catalog_fts | `test/catalog/fts5-triggers.test.mjs` | `npm test` |
| **sqlite-vec triggers** | unit (DB-isolated) | INSERT/DELETE sync from embeddings → catalog_vec; vec_distance_cosine returns finite | `test/catalog/vec-triggers.test.mjs` | `npm test` |
| **Embedder (multilingual-e5-small)** | unit | 384d output; deterministic for same text; query/passage prefix difference | `test/catalog/embedder.test.mjs` | `npm test` |
| **CatalogLoader** | integration (DB + filesystem) | Idempotency (no-op on unchanged); update on hash diff; prune on deletion; duplicate id handling | `test/catalog/loader.test.mjs` | `npm test` |
| **build-index script** | e2e (process spawn) | Exit codes 0/1/2; perf assertion < 60s for 100-skill fixture; stderr format | `test/catalog/perf.test.mjs` | `npm test` |
| **Version helper** | unit | `getCatalogSchemaVersion() === 3` | `test/catalog/version.test.mjs` | `npm test` |
| **CLI orchestration** | none | — (covered by e2e perf test + manual smoke) | — | — |
| **DDL (001_init.sql)** | none | — (covered by migrations + fts5 + vec trigger tests) | — | — |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM). Existing calibration tests at `test/catalog/*.test.mjs` set the style floor (Node 22 `node --test`, ESM imports, `:memory:` better-sqlite3).

---

## Gate Check Commands

> Generated from `package.json` + `CLAUDE.md` testing contract.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| **Quick** | After tasks with unit tests only (T-02, T-03, T-04, T-06, T-07, T-08, T-10, T-16) | `npm test -- test/catalog/` |
| **Full** | After tasks with integration/e2e tests (T-05, T-09, T-11, T-12, T-13) | `npm test` |
| **Build** | After phase completion (T-15, end of phase) | `npm test && npm run typecheck && npm run catalog:load` |
| **Typecheck** | After any TS change | `npm run typecheck` |

**Note:** `npm run catalog:load` is the existing calibration CLI gate; after Phase 1, this command will be replaced by `npm run build-index` (T-13 wires it; package.json updated to point at `scripts/build-index.ts`).

---

## Execution Plan

Four subchapters run sequentially. Each subchapter is ≤ 4 tasks, fits one Implementer batch. Whole Phase 1 = 2 batches.

```
Subchapter 1.1 (schema + Zod):    T-01 → T-02 → T-03 → T-04
                                       ↓
Subchapter 1.2 (migrations):           T-05 → T-06 → T-07 → T-08
                                                       ↓
Subchapter 1.3 (loader):                     T-09 → T-10 → T-11 → T-12
                                                       ↓
Subchapter 1.4 (build-index + perf):               T-13 → T-14 → T-15 → T-16
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 1.1 + 1.2 | T-01..T-08 (8 tasks) | Worker A (Implementer sub-agent) |
| **Batch 2** | 1.3 + 1.4 | T-09..T-16 (8 tasks) | Worker B (Implementer sub-agent) |
| **Validation** | (all) | (all 16) | Worker C (Verifier sub-agent) — fresh, evidence-or-zero |

Batches run sequentially. Validation runs once after Batch 2 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 1.1 — YAML schema + Zod validation

#### T-01: Delete calibration residue + scaffold new module layout

**What:** Delete `src/catalog/{cli,writer,embedder,types,schema,index,errors,loader}.ts` (calibration residue); create new `src/catalog/{index,types,errors,version,loader}.ts` skeletons with placeholder exports. Create `config/catalog/` dir + `README.md` + `example-skill.yaml`. Also remove any `test/catalog/*.test.mjs` files that import deleted calibration code.

**Where:**
- DELETE: `src/catalog/cli.ts`, `src/catalog/writer.ts`, `src/catalog/embedder.ts`, `src/catalog/schema.ts`, `src/catalog/types.ts`, `src/catalog/index.ts`, `src/catalog/errors.ts`, `src/catalog/loader.ts` (and matching test files in `test/catalog/`)
- CREATE: `src/catalog/index.ts` (skeleton), `src/catalog/types.ts` (placeholder), `src/catalog/errors.ts` (placeholder), `src/catalog/version.ts`, `src/catalog/loader.ts` (skeleton)
- CREATE: `config/catalog/README.md`, `config/catalog/example-skill.yaml`

**Depends on:** None (first task)

**Reuses:** None (cleanup)

**Requirement:** R-15, R-16, AC-15, AC-16

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `src/catalog/cli.ts`, `writer.ts`, `embedder.ts`, `schema.ts`, `types.ts` (old), `index.ts` (old), `errors.ts` (old), `loader.ts` (old) are deleted
- [ ] New skeletons exist: `src/catalog/{index,types,errors,version,loader}.ts` (export `{}` placeholders)
- [ ] `config/catalog/` dir exists with `README.md` (1 page usage doc) and `example-skill.yaml` (valid Skill shape)
- [ ] `npm run typecheck` passes (skeletons compile)
- [ ] `git diff --stat src/social-detector/` is empty (AC-16)
- [ ] Test count: ≥ 0 (calibration tests for catalog deleted; rest of 185-test baseline preserved outside `src/catalog/`)

**Tests:** none (cleanup + scaffold task; tests land in T-02..T-04)

**Gate:** quick (`npm test` — confirms no other test broke from the deletions)

**Commit:** `refactor(phase-1): delete calibration residue, scaffold new src/catalog (T-01)`

---

#### T-02: Define Zod schemas for Skill/Rule/Persona + shared refinements

**What:** Implement `src/catalog/schema/{skill,rule,persona,shared}.ts` with full Zod schemas per PRD §6.1-6.3. `shared.ts` exports `idPattern` (kebab-case regex) and `nfcNormalize(text: string): string` helper (ported from calibration residue).

**Where:**
- `src/catalog/schema/skill.ts` — `SkillSchema` (id, type:"skill", title, category enum, text)
- `src/catalog/schema/rule.ts` — `RuleSchema` (id, type:"rule", text, critical?)
- `src/catalog/schema/persona.ts` — `PersonaSchema` (id, type:"persona", text, isDefault?)
- `src/catalog/schema/shared.ts` — `idPattern`, `nfcNormalize`, common refinements
- `src/catalog/schema/index.ts` — barrel: `validateCatalogItem(parsed: unknown): ValidationResult`

**Depends on:** T-01

**Reuses:** `idPattern` regex from calibration `src/catalog/types.ts`; `nfcNormalize` helper ported from calibration

**Requirement:** R-02, R-03

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] All 4 schema files compile and export as designed
- [ ] `SkillSchema.parse({...valid})` succeeds; `SkillSchema.parse({...missing title})` throws ZodError with field path
- [ ] `RuleSchema.parse({critical: "yes"})` throws (type error, not bool)
- [ ] `PersonaSchema.parse({isDefault: 1})` throws (type error)
- [ ] `validateCatalogItem` returns `{ok: true, record}` or `{ok: false, error: string}` with file/field/reason
- [ ] `npm run typecheck` passes

**Tests:** unit (`test/catalog/schema.test.mjs`) — covers all AC-2 error cases + valid cases for all 3 types

**Gate:** quick

**Commit:** `feat(phase-1): Zod schemas for Skill/Rule/Persona (T-02)`

---

#### T-03: Define CatalogRecord + public TypeScript types

**What:** Implement `src/catalog/types.ts` with the public types matching PRD v3.4 shape: `Skill`, `Rule`, `Persona`, `CatalogRecord`, `SkillCategory` enum, `ValidationResult`. Replace the calibration `SkillRecord` / `StoredSkill` / `RawSkillYaml` exports with the new names.

**Where:** `src/catalog/types.ts` (full replacement)

**Depends on:** T-02

**Reuses:** Calibration's NFC-normalized string handling

**Requirement:** R-02

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] All 6 types exported: `Skill`, `Rule`, `Persona`, `CatalogRecord`, `SkillCategory`, `ValidationResult`
- [ ] No reference to old calibration `SkillRecord` / `StoredSkill` / `RawSkillYaml` remains
- [ ] `npm run typecheck` passes (all imports resolve)

**Tests:** unit (additive to T-02's test file — type-level assertions via `typeof` checks)

**Gate:** quick

**Commit:** `feat(phase-1): public CatalogRecord types (T-03)`

---

#### T-04: Implement typed CatalogError hierarchy

**What:** Implement `src/catalog/errors.ts` with typed error classes: `CatalogError` (base), `SchemaError`, `EmbedderError`, `MigrationError`, `LoaderError`. Each carries a `code: string` field for machine-readability (calibration residue had only `SchemaError`; we expand for Phase 5's needs).

**Where:** `src/catalog/errors.ts` (full replacement)

**Depends on:** T-01

**Reuses:** Calibration's `SchemaError` as starting point

**Requirement:** R-03 (structured errors)

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] All 5 error classes exported
- [ ] Each has a `readonly code: string` field with a stable enum value
- [ ] `instanceof CatalogError` works for all subclasses
- [ ] `npm run typecheck` passes

**Tests:** unit (additive — instanceof + code field checks)

**Gate:** quick

**Commit:** `feat(phase-1): typed CatalogError hierarchy (T-04)`

---

### Subchapter 1.2 — SQLite migrations + FTS5 + vec

#### T-05: Implement migration runner + version tracking

**What:** Implement `src/catalog/migrations/runner.ts` with `applyMigrations(db: Database): Promise<{ applied: string[]; currentVersion: number }>`. Reads `migrations/*.sql` files in lexical order, checks `schema_migrations` for what's applied, applies only pending, records each applied migration. Idempotent — re-running is a no-op.

**Where:** `src/catalog/migrations/runner.ts`

**Depends on:** T-01 (errors module)

**Reuses:** None (greenfield — calibration never had versioned migrations)

**Requirement:** R-04, AC-4

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `applyMigrations(db)` on empty DB creates `schema_migrations` table + applies all pending migrations + returns `{applied: ['001_init'], currentVersion: 1}`
- [ ] Re-running on the same DB returns `{applied: [], currentVersion: 1}` (no-op)
- [ ] Migration with bad DDL throws `MigrationError` with the SQLite error message
- [ ] `npm run typecheck` passes

**Tests:** unit (`test/catalog/migrations.test.mjs`) — covers idempotency + error path

**Gate:** quick

**Commit:** `feat(phase-1): versioned migration runner (T-05)`

---

#### T-06: Write 001_init.sql with all Phase 1 DDL

**What:** Create `src/catalog/migrations/001_init.sql` with the full schema: `catalog`, `embeddings`, `audit_events` tables, `schema_migrations` table, `catalog_fts` FTS5 virtual table, `catalog_vec` sqlite-vec virtual table, and AFTER triggers for FTS5 sync (catalog_ai/au/ad) and vec sync (embeddings_ai/ad).

**Where:** `src/catalog/migrations/001_init.sql`

**Depends on:** T-05

**Reuses:** None

**Requirement:** R-05, R-06, R-07, AC-3, AC-12

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] File exists with all 4 base tables + 2 virtual tables + triggers
- [ ] Migration runner applies it cleanly (T-05's test confirms)
- [ ] `audit_events` schema includes the 5 PRD §10.3 columns (fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash) in addition to the 5 calibration columns (id, ts, tenant_hash, event_type, payload)
- [ ] `catalog_vec` is `FLOAT[384]` with explicit rowid binding
- [ ] `npm run typecheck` passes (no TS changes; just file presence)

**Tests:** none (DDL-only; covered by T-05 + T-07 + T-08)

**Gate:** quick (verify migration runner still works)

**Commit:** `feat(phase-1): 001_init.sql with catalog + embeddings + audit + FTS5 + vec (T-06)`

---

#### T-07: Implement openCatalogDb + sqlite-vec extension load

**What:** Implement `src/catalog/db/open.ts` with `openCatalogDb(path: string): Database`. Opens `better-sqlite3`, enables WAL mode + foreign keys, loads `sqlite-vec` extension via the loader's `load()` API, returns the `Database` instance. Handles `data/` directory creation.

**Where:** `src/catalog/db/open.ts`

**Depends on:** T-06

**Reuses:** Calibration's sqlite-vec 0.1.9 load pattern (documented inline as JSDoc)

**Requirement:** R-04, R-07, AC-3

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `openCatalogDb("data/memory-studio.sqlite")` creates `data/` if missing, opens DB, loads vec extension
- [ ] After open: `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`
- [ ] `SELECT vec_version()` returns a non-empty string
- [ ] `npm run typecheck` passes

**Tests:** unit (additive to T-05 — covers `openCatalogDb` happy path)

**Gate:** quick

**Commit:** `feat(phase-1): openCatalogDb with sqlite-vec extension load (T-07)`

---

#### T-08: Verify FTS5 + vec triggers work (write trigger integration tests)

**What:** Write `test/catalog/fts5-triggers.test.mjs` and `test/catalog/vec-triggers.test.mjs` covering: INSERT/UPDATE/DELETE on `catalog` syncs to `catalog_fts`; INSERT/DELETE on `embeddings` syncs to `catalog_vec`; `vec_distance_cosine` returns finite for valid vectors.

**Where:**
- `test/catalog/fts5-triggers.test.mjs` (new)
- `test/catalog/vec-triggers.test.mjs` (new)

**Depends on:** T-06, T-07

**Reuses:** Test pattern from calibration `test/search/` (FTS5 trigger test fixture style)

**Requirement:** R-06, R-07, AC-3, AC-8, AC-11

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `fts5-triggers.test.mjs` passes: inserting a Skill row makes `SELECT * FROM catalog_fts WHERE catalog_fts MATCH 'token-from-skill-text'` return ≥ 1 row with matching rowid
- [ ] `fts5-triggers.test.mjs` passes: deleting the parent row removes the FTS5 entry
- [ ] `fts5-triggers.test.mjs` passes: updating the `text` field updates the FTS5 entry
- [ ] `vec-triggers.test.mjs` passes: `vec_length(catalog_vec.embedding) === 384` for every inserted embedding
- [ ] `vec-triggers.test.mjs` passes: `vec_distance_cosine(...)` returns finite float for arbitrary query embedding
- [ ] `npm test` green

**Tests:** unit (these are tests; no separate code test required)

**Gate:** full

**Commit:** `test(phase-1): FTS5 + sqlite-vec trigger integration tests (T-08)`

---

### Subchapter 1.3 — Loader (YAML → SQLite)

#### T-09: Define Embedder interface + multilingual-e5-small implementation

**What:** Implement `src/catalog/embedder/{types.ts,multilingual-e5-small.ts,model-path.ts}`. Interface `Embedder { encode(text: string): Promise<Float32Array>; readonly dimensions: 384 }`. `MultilingualE5SmallEmbedder` loads `models/multilingual-e5-small/model.onnx` via `onnxruntime-node`, uses `@huggingface/transformers` tokenizer, applies `query: ` or `passage: ` prefix based on a constructor arg, returns Float32Array of length 384.

**Where:**
- `src/catalog/embedder/types.ts` (new)
- `src/catalog/embedder/multilingual-e5-small.ts` (new)
- `src/catalog/embedder/model-path.ts` (new)
- `src/catalog/embedder/index.ts` (new barrel)

**Depends on:** T-04 (errors module)

**Reuses:** Calibration's `InferenceSession` lifecycle pattern; BLOB round-trip helpers ported from calibration `src/catalog/embedder.ts` + `src/search/vector.ts`

**Requirement:** R-08, AC-8

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `MultilingualE5SmallEmbedder` instance loads model successfully (or throws `EmbedderError` with clear "model not found" message)
- [ ] `embedder.encode("hello world")` returns Float32Array of length 384
- [ ] Same text input → same Float32Array output (deterministic)
- [ ] `query: ` vs `passage: ` prefix produces different embeddings (asymmetric retrieval)
- [ ] `npm run typecheck` passes

**Tests:** unit (`test/catalog/embedder.test.mjs`) — covers all 4 checks above

**Gate:** quick

**Commit:** `feat(phase-1): multilingual-e5-small Embedder implementation (T-09)`

---

#### T-10: Implement CatalogLoader (parse → validate → embed → upsert → prune)

**What:** Implement `src/catalog/loader.ts` with `CatalogLoader` class. `loadAll()` reads all `*.yaml` files in `config/catalog/`, parses each, validates via Zod (skip on error with stderr), embeds via `Embedder`, upserts to `catalog` + `embeddings` tables by `id`, deletes rows whose `id` is no longer in the YAML set. Returns counts `{added, updated, deleted, skipped, durationMs}`.

**Where:** `src/catalog/loader.ts` (full replacement)

**Depends on:** T-02, T-05, T-07, T-09

**Reuses:** Calibration's NFC normalization + idempotency-by-id pattern (ported)

**Requirement:** R-09, AC-5, AC-6, AC-7

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `CatalogLoader` constructor takes `db`, `embedder`, `options: { yamlDir: string }`
- [ ] `loadAll()` parses, validates, embeds, upserts, prunes
- [ ] Idempotency: running on unchanged catalog returns `{added: 0, updated: 0, deleted: 0, skipped: 0}`
- [ ] Modification: change 1 YAML's `text`, re-run returns `{updated: 1, ...}`
- [ ] Deletion: remove 1 YAML, re-run returns `{deleted: 1, ...}`
- [ ] Skip on invalid: corrupted YAML returns `{skipped: 1, ...}` with stderr message
- [ ] `npm run typecheck` passes

**Tests:** integration (`test/catalog/loader.test.mjs`) — covers all 5 scenarios above with `:memory:` DB + temp yamlDir

**Gate:** full

**Commit:** `feat(phase-1): CatalogLoader with idempotent upsert + prune (T-10)`

---

#### T-11: Implement version.ts + getCatalogSchemaVersion()

**What:** Implement `src/catalog/version.ts` with `export const CATALOG_SCHEMA_VERSION = 3 as const; export function getCatalogSchemaVersion(): number { return CATALOG_SCHEMA_VERSION; }`. Update `src/catalog/index.ts` barrel to export the public surface.

**Where:**
- `src/catalog/version.ts` (new, full impl)
- `src/catalog/index.ts` (full — re-export `getCatalogSchemaVersion`, `CatalogLoader`, `Embedder`, types)

**Depends on:** T-10

**Reuses:** None

**Requirement:** R-11, R-12, AC-10

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `import { getCatalogSchemaVersion } from "./src/catalog/version.ts"` returns `3`
- [ ] `src/catalog/index.ts` exports public surface
- [ ] `npm run typecheck` passes

**Tests:** unit (`test/catalog/version.test.mjs`) — `getCatalogSchemaVersion() === 3`

**Gate:** quick

**Commit:** `feat(phase-1): catalog schemaVersion helper (T-11)`

---

#### T-12: Loader error-path coverage (graceful degradation tests)

**What:** Add tests to `test/catalog/loader.test.mjs` covering the edge cases from spec: empty file, broken YAML, conflicting `type` field, duplicate `id`, missing required field, `category` enum violation, `critical` as string. Each test asserts: loader returns `{skipped: N, ...}`, stderr contains the expected message, DB state is consistent.

**Where:** `test/catalog/loader.test.mjs` (additive)

**Depends on:** T-10

**Reuses:** Loader test fixtures from T-10

**Requirement:** R-03, all "Edge Cases" in spec

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] Each of the 7 edge cases has a test that asserts the loader's skip behavior + stderr output
- [ ] DB integrity check: after a run with mixed valid/invalid YAMLs, all valid items are in DB, no invalid items leaked
- [ ] `npm test` green

**Tests:** integration (additive to T-10's test file)

**Gate:** full

**Commit:** `test(phase-1): loader error-path coverage (T-12)`

---

### Subchapter 1.4 — Build-index script + perf

#### T-13: Implement scripts/build-index.ts CLI orchestrator

**What:** Implement `scripts/build-index.ts` that orchestrates: open DB, apply migrations, instantiate embedder, instantiate loader, run `loader.loadAll()`, measure wall-clock perf, print structured stderr summary, exit with proper code (0/1/2).

**Where:** `scripts/build-index.ts` (new)

**Depends on:** T-10, T-11

**Reuses:** None (greenfield script)

**Requirement:** R-10, AC-9, AC-13

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] Running `node scripts/build-index.ts` on the example catalog exits 0 with `[INFO] build-index: 1 items loaded` + `[PERF] build-index: <ms>ms for 1 skills` on stderr
- [ ] Exit 1 if ONNX model is missing (stderr `[ERROR] model not found at <path>`)
- [ ] Exit 2 if any YAML file is invalid (stderr `[WARN] skipped <file>: <reason>`)
- [ ] `data/memory-studio.sqlite` is created if missing
- [ ] `npm run typecheck` passes

**Tests:** e2e (`test/catalog/build-index.test.mjs`) — spawn script as child process, assert exit codes + stderr content for the 3 scenarios

**Gate:** full

**Commit:** `feat(phase-1): build-index CLI orchestrator (T-13)`

---

#### T-14: Wire `npm run build-index` + perf test with 100-skill fixture

**What:** Add `"build-index": "node --experimental-strip-types scripts/build-index.ts"` (or equivalent) to `package.json` `scripts`. Write `test/catalog/perf.test.mjs` that generates a 100-skill synthetic YAML fixture in a temp dir, runs the loader, asserts wall-clock < 60_000 ms.

**Where:**
- `package.json` (add `scripts.build-index`)
- `test/catalog/perf.test.mjs` (new)

**Depends on:** T-13

**Reuses:** None

**Requirement:** R-10, AC-9

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `npm run build-index` works (same as `node scripts/build-index.ts`)
- [ ] `perf.test.mjs` generates 100 YAMLs, runs `loadAll()`, asserts durationMs < 60_000
- [ ] Test logs `[PERF] build-index: <actual>ms for 100 skills` to stderr
- [ ] `npm test` green (perf test passes)

**Tests:** e2e (this task IS the perf test)

**Gate:** full

**Commit:** `feat(phase-1): npm run build-index + 100-skill perf test (T-14)`

---

#### T-15: Confirm `.memory-studio/state.json` thresholds default + gitignore coverage

**What:** Verify `.memory-studio/state.json` contains `schemaVersion: 3`, `thresholds.minCosineSimilarity: 0.6`, `thresholds.minFtsHits: 2`. If missing, update. Also confirm `.gitignore` blocks `data/` (SQLite + ONNX cache) and `models/` (ONNX weights) per `.memory-studio/setup.md`.

**Where:**
- `.memory-studio/state.json` (verify or update)
- `.gitignore` (verify entries)

**Depends on:** None (independent verification)

**Reuses:** Existing `state.json` content

**Requirement:** R-14, AC-13

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `.memory-studio/state.json` has all 3 keys (schemaVersion, minCosineSimilarity, minFtsHits) with correct values
- [ ] `.gitignore` has `data/` and `models/` entries (or they are already absent and untracked)
- [ ] No changes to source files (no `npm run typecheck` needed)

**Tests:** none (operational verification)

**Gate:** build (`npm test && npm run typecheck` — confirm baseline preserved)

**Commit:** `chore(phase-1): confirm state.json thresholds + gitignore coverage (T-15)`

---

#### T-16: D-001 cross-check (zero §18.x references) + final spec docs sync

**What:** Run `grep -rE '§18\.' PRD.md PLAN.md .scratch/memory-studio/spec.md .specs/ROADMAP.md .specs/ARCHITECTURE.md` and confirm zero matches. If matches exist, fix them (replace with `§16.x`). Also confirm `src/social-detector/is-social.ts` is byte-identical pre-Phase-1 (AC-16).

**Where:** grep across PRD/PLAN/SPEC/ROADMAP/ARCHITECTURE (no file edits unless drift found)

**Depends on:** None (independent verification)

**Reuses:** None

**Requirement:** R-13, R-16, AC-14, AC-16

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] grep returns zero matches
- [ ] `git diff src/social-detector/` is empty
- [ ] Full Phase 1 baseline check: `npm test && npm run typecheck && npm run build-index` (or equivalent) passes on the example catalog
- [ ] 185-test baseline preserved or grown (no silent deletions)

**Tests:** none (verification only)

**Gate:** build (full)

**Commit:** `chore(phase-1): D-001 cross-check + baseline confirmation (T-16)`

---

## Phase Execution Map

```
Subchapter 1.1 (Schema + Zod):     T-01 → T-02 → T-03 → T-04
                                              ↓
Subchapter 1.2 (Migrations + DB):         T-05 → T-06 → T-07 → T-08
                                                          ↓
Subchapter 1.3 (Loader):                       T-09 → T-10 → T-11 → T-12
                                                          ↓
Subchapter 1.4 (Build-index + Perf):               T-13 → T-14 → T-15 → T-16
```

Execution is strictly sequential — no intra-subchapter parallelism.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T-01: Delete residue + scaffold | 1 cleanup + 5 file creates | OK (cleanup is cohesive: residue gone + new layout) |
| T-02: Zod schemas | 4 schema files + 1 barrel | OK (one logical unit: schema layer) |
| T-03: Public types | 1 file (types.ts) | OK |
| T-04: Error hierarchy | 1 file (errors.ts) | OK |
| T-05: Migration runner | 1 file (runner.ts) | OK |
| T-06: 001_init.sql | 1 SQL file | OK |
| T-07: openCatalogDb | 1 file (open.ts) | OK |
| T-08: FTS5/vec trigger tests | 2 test files | OK (one logical unit: trigger tests) |
| T-09: Embedder | 4 files (embedder/*) | OK (one logical unit: embedder module) |
| T-10: CatalogLoader | 1 file (loader.ts) | OK |
| T-11: version.ts + index.ts | 2 files | OK (one logical unit: version + public surface) |
| T-12: Loader error tests | additive to T-10's test file | OK |
| T-13: build-index script | 1 file (build-index.ts) | OK |
| T-14: package.json wiring + perf test | 2 changes | OK (one logical unit: CLI contract) |
| T-15: state.json + gitignore | 2 verifications | OK (one logical unit: operational sanity) |
| T-16: D-001 cross-check | grep + diff | OK (one logical unit: final baseline) |

**Granularity check:** all 16 tasks are atomic (1 component / 1 function / 1 file change). No restructuring needed.

---

## Diagram-Definition Cross-Check

| Task | Depends on (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T-01 | None | (root) | OK |
| T-02 | T-01 | T-01 → T-02 | OK |
| T-03 | T-02 | T-02 → T-03 | OK |
| T-04 | T-01 | T-01 → T-04 | OK |
| T-05 | T-01 | T-01 → T-05 | OK |
| T-06 | T-05 | T-05 → T-06 | OK |
| T-07 | T-06 | T-06 → T-07 | OK |
| T-08 | T-06, T-07 | T-06/T-07 → T-08 | OK |
| T-09 | T-04 | T-04 → T-09 | OK |
| T-10 | T-02, T-05, T-07, T-09 | T-02/T-05/T-07/T-09 → T-10 | OK |
| T-11 | T-10 | T-10 → T-11 | OK |
| T-12 | T-10 | T-10 → T-12 | OK |
| T-13 | T-10, T-11 | T-10/T-11 → T-13 | OK |
| T-14 | T-13 | T-13 → T-14 | OK |
| T-15 | None | (independent verification) | OK |
| T-16 | None | (independent verification) | OK |

All `Depends on` arrows match the diagram. No task depends on a later task.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T-01 | Cleanup (no new code) | none | none | OK |
| T-02 | Zod schemas | unit | unit | OK |
| T-03 | Public types | unit (additive to T-02) | unit | OK |
| T-04 | Error hierarchy | unit (additive) | unit | OK |
| T-05 | Migration runner | unit | unit | OK |
| T-06 | DDL | none (covered by T-05+T-08) | none | OK |
| T-07 | DB open | unit (additive to T-05) | unit | OK |
| T-08 | FTS5/vec trigger tests | unit (these ARE tests) | unit | OK |
| T-09 | Embedder | unit | unit | OK |
| T-10 | CatalogLoader | integration | integration | OK |
| T-11 | version helper | unit | unit | OK |
| T-12 | Loader error tests | integration (additive) | integration | OK |
| T-13 | build-index CLI | e2e (spawn child process) | e2e | OK |
| T-14 | npm wiring + perf test | e2e (this IS the perf test) | e2e | OK |
| T-15 | state.json + gitignore (operational) | none | none | OK |
| T-16 | D-001 + baseline (verification) | none | none | OK |

All tasks satisfy the Test Coverage Matrix. No `Tests: none` for code layers that require tests.

---

## Cross-references

- [`./spec.md`](./spec.md) — 17 R-NN + 16 AC-NN requirements
- [`./design.md`](./design.md) — architecture + components + reuse strategy
- [`.specs/ROADMAP.md` Phase 1](../../ROADMAP.md) — done criteria (16 checkboxes)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md) — `src/catalog/**` disposition rules
- [`CLAUDE.md` testing contract](../../../CLAUDE.md) — gate commands
- [`scripts/lessons.py`](../../../scripts/lessons.py) — `quarantine <id>` for calibration residue drift findings (AD-002)