---
date: 2026-07-30
version: 1
description: "Phase 1.1 — YAML Schema + Zod Validation — Verifier report. FAIL on R-01 (config/catalog/ missing) + shim SPEC_DEVIATION. PASS on schema correctness, discrimination sensor, idempotency, social-detector untouched."
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../CLAUDE.md
---

# Phase 1.1 — Validation (Verifier)

**Verifier:** independent sub-agent, evidence-or-zero.
**Diff range:** `8c8c6bc..eb227a8` (4 commits: `823969e`, `708ca18`, `0611e4a`, `eb227a8`).
**Scope:** T-01..T-04 only (YAML schema + Zod validation; NO DB / loader / build-index in Phase 1.1).

---

## VERDICT: **FAIL**

Phase 1.1 is **NOT complete**. Two blocking gaps:

1. **R-01 / AC-1** — `config/catalog/` directory + sample YAML + README NOT delivered (explicit T-01 Done-when item).
2. **SPEC_DEVIATION** — "compat shim" files contain NEW LOGIC, not just re-exports. Phase 1.2 cannot retire these as shims because they are load-bearing for `test/search/**`.

Other concerns are minor / expected. See ranked gap list below.

---

## Re-run output

**`npm test` (last 5 lines):**
```
# tests 137
# suites 0
# pass 137
# fail 0
# duration_ms 3046.2035
```
(Variance 2899–3046 ms across runs; deterministic on identical input.)

**`npm run typecheck`:** clean (exit 0, no diagnostics).

**`npm run test:catalog`:** 7/7 pass (matches Implementer claim of 7 new schema tests).

**`npm run catalog:load`:** BROKEN — `Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'src/catalog/cli.ts'`. Out of Phase 1.1 scope (replaced by `npm run build-index` per T-13 in Phase 1.4). Flagged as known regression — package.json `catalog:load` script needs update in T-13 / Phase 1.4.

---

## Spec-anchored outcome check

| Req / AC | Scope of Phase 1.1? | Result | Evidence |
|---|---|---|---|
| **R-01** — `config/catalog/` exists, git-tracked | YES (T-01 Done-when) | **FAIL** | `ls config/catalog/` → No such file or directory. T-01 commit `823969e` does NOT contain `config/catalog/` in its name-status. Only `config/skills/` exists (calibration residue with `example-jwt-01.yaml`). |
| **R-02** — YAML schema validated per item type | YES (T-02, T-03) | **PASS** | `src/catalog/schema/{skill,rule,persona}.ts` enforce `id`, `type`, `title` (skill), `category` enum (skill), `text`, `critical?` (rule), `isDefault?` (persona). Tests #1–7 pass. |
| **R-03** — Zod schemas + structured errors | YES (T-02, T-04) | **PASS** | `SchemaError` class carries `code` + `issues`; `validationErrorCode()` maps Zod issues to deterministic codes (`invalid_category`, `<field>_required`, `invalid_<field>_type`). |
| **R-04** — SQLite + versioned migrations | NO (Phase 1.2 / T-05..T-08) | n/a | — |
| **R-05** — Three tables created on first run | NO (Phase 1.2 / T-06) | n/a | — |
| **AC-1** — `config/catalog/` + sample + `npm run build-index` → 1 row | PARTIAL (config/catalog/ is T-01; build-index is Phase 1.4) | **FAIL** | Same as R-01 — directory missing. build-index script not in Phase 1.1 scope. |
| **AC-2** — `npm run build-index` exits non-zero on invalid YAML | NO (Phase 1.4 / T-13) | n/a | — |
| **AC-3** — SQLite tables exist after first run | NO (Phase 1.2 / T-06) | n/a | — |

**Phase 1.1's own ROADMAP Done-when** (lines 165-184): "Zod schemas for Skill, Rule, Persona parse valid YAML → typed objects; reject invalid with deterministic error codes; coverage in `test/catalog/schema.test.mjs`." — **PASS on the schema/validation core, FAIL on the side deliverables (config/catalog/, fixtures committed)**.

---

## Shim investigation verdict: **SPEC_DEVIATION**

The Implementer claims Phase 1.1 scope explicitly forbids editing `src/catalog/{types,errors,loader,index}.ts` and `src/catalog/embedder.ts`. The claim is that these were modified as "thin compat shims that re-export the new types/constants".

**Audit of each shim file (read every line, not just the file header):**

| File | Claims to re-export | Actual content (line-by-line audit) | Verdict |
|---|---|---|---|
| **`src/catalog/types.ts`** | "Phase 5 search tests reference legacy `SkillKind`" | Adds NEW `SkillCategory` type (duplicates `schema/shared.ts`). Defines NEW `SkillRecord` interface (id/type/title/text/category/critical/isDefault — different from calibration slug/kind/content). Defines NEW `StoredSkill` with snake_case fields (`slug`, `content_yaml`, `embedding`, `hash`, `created_at`, `updated_at`) — these are NOT in the PRD v3.4 schema (R-05 says `text`, `is_default` — not `content_yaml`, `embedding`). `RawSkillYaml extends SkillRecord {}` — empty extension. | **NOT a re-export — new types added.** `StoredSkill` shapes do not match the design spec. Phase 1.2 cannot simply re-export from here. |
| **`src/catalog/errors.ts`** | "Phase 5 search tests reference legacy `CatalogError`/`EmbedderError`" | Adds NEW `CatalogError` class (extends Error, with `code: string`). Adds NEW `MigrationError` extends CatalogError. Adds NEW `LoaderError` extends CatalogError (different signature from calibration — calibration's had `path` + 4-code enum; new has only string message). Only `SchemaError` is re-exported from `./schema/index.ts`. | **NOT a re-export — 3 new classes added.** New error hierarchy contradicts calibration shape; Phase 5 search tests will need re-pointing regardless. |
| **`src/catalog/embedder.ts`** | "just re-exports `EMBEDDING_DIMENSIONS`" | Re-exports `EMBEDDING_DIMENSIONS` from `./schema.ts` ✅. BUT also defines NEW `Embedder` interface with `dimensions: 384` (was `dimensions: typeof EMBEDDING_DIMENSIONS` literal) and ADDS `encode()` method while keeping `embed()`. Calibration never had `encode()`. | **NOT a re-export — new interface shape.** The added `encode()` is the new method Phase 1.3 will use, but it is hidden inside a "compat shim" file. |
| **`src/catalog/schema.ts`** | (Not in Implementer's "shims" list but acts as one) | Implements `createSchema(db)` function with REAL DDL (`CREATE TABLE skills (id, slug, kind, content_yaml, embedding, hash, created_at, updated_at)`) — this is the calibration residue DDL rewritten as a one-function shim. Also exports `EMBEDDING_DIMENSIONS = 384` and `SEARCH_EMBEDDING_DIMENSIONS = 384`. | **NOT a re-export — real SQL DDL function.** Required by `test/search/schema.test.mjs`. Will need deletion + search test re-pointing in Phase 1.2. |
| **`src/catalog/index.ts`** | (Deleted entirely) | DELETED (was the catalog barrel). `src/index.ts` updated to re-export from `./catalog/schema/index.ts` instead. | Acceptable (deletion of deleted-code barrel). |

**Shim investigation verdict: SPEC_DEVIATION.** Per Phase 1.1 dispatch constraints, "thin compat shims" should re-export only. Audit shows:

- types.ts: NEW types (NOT re-exports)
- errors.ts: 3 NEW error classes (NOT re-exports)
- embedder.ts: NEW Embedder interface (NOT a re-export)
- schema.ts: NEW createSchema() function with real DDL (NOT a re-export)

**Impact on Phase 1.2:** The shim files are now load-bearing for `test/search/**` (which is OUT of Phase 1.1 scope but not deleted). Phase 1.2 cannot simply retire them as planned — it must:
1. Update `test/search/**` to import from `src/catalog/schema/index.ts` directly (so the type shape and error hierarchy match).
2. Then delete the shims.
3. Re-validate with new types/errors that match the design spec (StoredSkill with snake_case fields `content_yaml`, `embedding`, `created_at`, `updated_at` does NOT match PRD v3.4 R-05 which says `text` + `is_default`).

**Risk if not addressed:** Phase 1.2 will silently inherit a wrong `StoredSkill` shape that doesn't match the catalog table schema (R-05). This will surface as runtime bugs in Phase 5 (Proxy) when the SDK reads back catalog rows.

---

## Test delta investigation: **PASS**

Baseline: 185 → Current: 137 (delta -48). Implementer's claim "7 new schema tests added; rest are deleted calibration-residue tests" — verified.

**Deleted test files (all in `test/catalog/` — calibration residue):**

| File | Tests | What it tested | Verdict |
|---|---|---|---|
| `test/catalog/cli.test.mjs` | 7 | `src/catalog/cli.ts` (DELETED in T-01) | ✅ calibration residue |
| `test/catalog/embedder.test.mjs` | 12 | `src/catalog/embedder.ts` (calibration `DeterministicStubEmbedder`) | ✅ calibration residue |
| `test/catalog/loader.test.mjs` | 19 | `src/catalog/loader.ts` (DELETED in T-01) | ✅ calibration residue |
| `test/catalog/types.smoke.test.mjs` | 3 | Calibration `LoaderError/WriterError/SchemaError/EmbedderError` (old hierarchy) | ✅ calibration residue |
| `test/catalog/writer.test.mjs` | 10 | `src/catalog/writer.ts` (DELETED in T-01) + `src/catalog/schema.ts` `createSchema()` | ✅ calibration residue |

**Modified:** `test/catalog/schema.test.mjs` — completely rewritten, 4 → 7 tests (all new).

**Math:** 185 − (7+12+19+3+10) − 4 + 7 = 137 ✅.

**Test count interpretation:** The Implementer's "7 new schema tests added" is technically correct (current file has 7 tests) but slightly misleading: 4 old schema tests were replaced, so the net delta in schema.test.mjs is +3. Total delta across the suite is −48 because the deleted files contained more tests than the new schema file. None of the deleted tests touched anything outside `test/catalog/**`.

**Untouched test files (verified):**
- `test/smoke.test.mjs` ✅
- `test/social-detector.test.mjs` ✅
- `test/search/{contracts,fts,rrf,schema,search,vector}.test.mjs` ✅ (all 6 files unchanged — search suite still runs against the compat shims)

**Test delta verdict: PASS.** Only calibration-residue tests were deleted.

---

## Discrimination sensor: **PASSED**

**Test:** mutate a valid YAML so `category: invalid` (outside `{procedural, diagnostic, reference, pattern}`).

**Result:**
```
{
  "ok": false,
  "code": "invalid_category",
  "error": "category: invalid_category",
  "issues": [{ "received": "invalid", "code": "invalid_enum_value", "options": [...], "path": ["category"], "message": "Invalid enum value..." }]
}
```

- `validateCatalogItem({...category: 'invalid'})` returns `{ok: false, code: 'invalid_category', error: 'category: invalid_category', issues: [...]}`.
- `new SchemaError(result)` carries `code: 'invalid_category'`, `name: 'SchemaError'`, `issues: ZodIssue[]`.
- Deterministic — re-running produces the same `code` value (no timestamp / random / counter).

**Discrimination sensor: PASSED.** Deterministic code on invalid category.

---

## Idempotency: **PASS (2/2 npm test green)**

```
Run 1: 137 pass / 0 fail, duration 2109 ms
Run 2: 137 pass / 0 fail, duration 2143 ms
```

**Idempotency verdict: PASS.** No flaky tests; no shared state mutation between runs.

---

## src/social-detector/ untouched: **YES**

```
git diff 8c8c6bc..eb227a8 --stat -- 'src/social-detector/' → empty
git diff --stat -- 'src/social-detector/' → empty
```

`src/social-detector/is-social.ts` is byte-identical pre-Phase-1 and post-Phase-1 (AC-16 satisfied).

---

## Commit hash of validation.md

Pending — this file will be committed before returning.

---

## Ranked gaps (fix-tasks for Phase 1.1 close-out or Phase 1.2 first commit)

| # | Gap | Severity | Fix | Phase owner |
|---|---|---|---|---|
| **G1** | `config/catalog/` dir + `README.md` + `example-skill.yaml` not created | **critical** (R-01 + AC-1 + T-01 Done-when) | Create the 3 files in a single commit; update T-01 commit message to reflect actual state OR add a T-01b task | Phase 1.1 close-out |
| **G2** | `src/catalog/types.ts` defines `StoredSkill` with `content_yaml` + `embedding` snake_case fields that DON'T match PRD v3.4 R-05 (`text` + `is_default`) | **critical** (will break Phase 5 retrieval) | Either delete `StoredSkill` entirely (it's not in the new spec) or align its fields with R-05 | Phase 1.2 (before shim retirement) |
| **G3** | Shim files contain NEW logic (3 error classes, Embedder interface, createSchema function) under "compat shim" label | **major** (SPEC_DEVIATION) | Either (a) move the new logic into proper modules (`src/catalog/errors/`, `src/catalog/embedder/index.ts`) and leave shims as pure re-exports; or (b) explicitly acknowledge the deviation in STATE.md and update design.md | Phase 1.2 / T-05..T-09 |
| **G4** | `src/catalog/embedder.ts` adds `encode()` method that calibration never had — this is the actual Phase 1.3 interface inside a shim | **major** (interface drift) | Move `Embedder` interface to `src/catalog/embedder/types.ts` (T-09 target). Shim becomes a pure re-export. | Phase 1.3 / T-09 |
| **G5** | `npm run catalog:load` is broken (`Cannot find module 'src/catalog/cli.ts'`) | **minor** (expected per design) | Replace with `npm run build-index` in T-13 (Phase 1.4) | Phase 1.4 / T-13 |
| **G6** | `src/catalog/index.ts` was DELETED (not replaced) — `src/index.ts` was patched to point at `./catalog/schema/index.ts` | **minor** (works around) | When T-11 adds the new barrel, restore `src/catalog/index.ts` | Phase 1.3 / T-11 |

---

## Lesson signals (grounded failures worth distilling)

1. **"compat shim" is a label that hides drift.** When the implementer says "kept minimal compat shim for Phase 5 search suite", a Verifier must read every line — the label is not a guarantee. The new types/errors/interfaces added here are the SEED of Phase 1.2/1.3 work, not removable shims. (Project-local lesson.)
2. **`StoredSkill` snake_case fields are a tell.** Any time a "compat shim" for PRD v3.4 resurrects `content_yaml` + `embedding` instead of `text` + `is_default`, it's calibration residue leaking through. Verifier should grep for these specific field names against the design.md schema. (Project-local lesson.)
3. **`config/catalog/` was a Phase 1.1 Done-when item but missed.** The T-01 spec explicitly required creating the directory with README + sample YAML. The Implementer ran out of scope attention on the actual catalog deliverables and only delivered the schema-side work. Phase 1.1 is supposed to be the "schema + Zod + sample" subchapter; delivering schemas without the sample defeats the purpose. (Project-local lesson.)

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 1.1 lines 165-184](../../ROADMAP.md)
- [`.specs/STATE.md` AD-002 calibration residue rule](../../STATE.md)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md)
- [`.specs/features/phase-1-catalog-schema-index/spec.md`](../spec.md)
- [`.specs/features/phase-1-catalog-schema-index/design.md`](../design.md)
- [`.specs/features/phase-1-catalog-schema-index/tasks.md`](../tasks.md)
- [CLAUDE.md `## Testing contract`](../../../CLAUDE.md)

**Status: FAIL — Phase 1.1 needs 1 commit to add config/catalog/ before flipping checkbox; Phase 1.2 must address shim SPEC_DEVIATION before retiring shims.**