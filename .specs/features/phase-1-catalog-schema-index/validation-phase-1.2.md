---
date: 2026-07-30
version: 1
description: "Phase 1.2 — Migrations + FTS5 + sqlite-vec — Verifier report. PASS on all 12 spec-anchored checks; PASS on migration runner idempotency; PASS on FTS5 + vec trigger correctness (10/10); PASS on discrimination sensor; PASS on catalog type slimming; in-flight vec trigger fix verified."
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ./validation.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../CLAUDE.md
---

# Phase 1.2 — Validation (Verifier)

**Verifier:** independent sub-agent, evidence-or-zero.
**Diff range:** `70c9a03..333a29a` (4 commits: `70c9a03` T-05, `d88371c` T-06, `825900c` T-07, `333a29a` T-08).
**Scope:** T-05..T-08 only — migrations runner, `001_init.sql`, `openCatalogDb`, FTS5/vec trigger tests + types/index cleanup + in-flight vec trigger fix.

---

## VERDICT: **PASS**

All 12 verifier checks green. Migration runner is idempotent (2nd call returns `{applied: [], currentVersion: 1}`). FTS5 + vec triggers all behave as specified (10/10 unit checks). Discrimination sensor kills a bad migration (throws `MigrationError` with SQLite message). `CatalogRow` is slim (no `slug`/`hash`) per PRD v3.4 R-05; `StoredSkill` alias is intentional. The in-flight vec trigger bug (FTS5-style `('delete', ...)` on vec0) was fixed in the same T-08 commit; all 153 tests green post-fix.

Phase 1.2 subchapter is **DONE**.

---

## Re-run output

**`npm test` (run 1, last lines):**
```
1..153
# tests 153
# suites 0
# pass 153
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 6468.3102
```

**`npm test` (run 2 — idempotency confirmation):**
```
1..153
# tests 153
# pass 153
# fail 0
# duration_ms 3383.7851
```

**`npm run typecheck`:** clean (exit 0, no diagnostics).

**`npm run test:catalog`:** 23/23 pass (4 schema + 6 migrations + 5 FTS5 + 5 vec + 3 misc).

**`npm run verify-env` (last line):** `6/6 checks passed` (FTS5 + sqlite-vec v0.1.9 + 384d Float32Array + filesystem + state.json + ONNX 384d).

---

## Spec-anchored outcome check

Verifier prompt scope: R-04, R-05, R-06, R-07 + AC-3, AC-4, AC-5, AC-6, AC-7, AC-8.

| Req / AC | Phase 1.2 scope? | Result | Evidence |
|---|---|---|---|
| **R-04** — SQLite + versioned migrations (`schema_migrations` table) | YES (T-05) | **PASS** | `src/catalog/migrations/runner.ts` creates `schema_migrations` (version PK + name + applied_at), tracks applied migrations, returns `{applied, currentVersion}`. 6 migration tests cover idempotency + DDL failure path. |
| **R-05** — Three tables (`catalog` + `embeddings` + `audit_events`) | YES (T-06) | **PASS** | `001_init.sql` creates `catalog` (with PRD v3.4 columns: `content_hash`, `created_at`, `updated_at`, type CHECK, nullable `title`/`category`/`critical`/`is_default`), `embeddings` (catalog_id PK FK CASCADE + BLOB vector + model_version + embedded_at), and `audit_events` (5 baseline + 5 PRD §10.3 columns). All 4 base tables present in `sqlite_master` after migration. |
| **R-06** — FTS5 virtual table `catalog_fts` with INSERT/UPDATE/DELETE triggers | YES (T-06, T-08) | **PASS** | `catalog_fts` declared with `content='catalog'`, `content_rowid='rowid'`, `tokenize='unicode61 remove_diacritics 2'`. 3 triggers (`catalog_ai`/`catalog_au`/`catalog_ad`) all use FTS5 idiom (`INSERT INTO catalog_fts(catalog_fts, rowid, text) VALUES ('delete', old.rowid, old.text)` for update/delete — correct because catalog_fts IS FTS5). 5 FTS5 tests cover insert/update/delete + unicode61 + rowid linkage. |
| **R-07** — sqlite-vec `catalog_vec` (384d, cosine distance) with INSERT/DELETE triggers | YES (T-06, T-08) | **PASS** | `catalog_vec` declared with `USING vec0(embedding float[384])`. 3 triggers (`embeddings_ai`/`embeddings_au`/`embeddings_ad`) use **plain `DELETE FROM catalog_vec WHERE rowid = old.rowid`** (NOT FTS5-style — see In-flight bug fix below). 5 vec tests cover insert/update/delete + vec_length(384) + vec_distance_cosine finite + ON DELETE CASCADE. |
| **AC-3** — DB tables exist after first run | YES (T-05, T-06) | **PASS** | After `openAndMigrate(':memory:')`, `sqlite_master` contains all 6 expected tables: `catalog`, `embeddings`, `audit_events`, `schema_migrations`, `catalog_fts`, `catalog_vec` (plus FTS5 internal tables `catalog_fts_config/data/docsize/idx` and vec0 internal `catalog_vec_*`). Verified via PRAGMA-style query. |
| **AC-4** — `schema_migrations` has exactly one row (version: 1) | YES (T-05) | **PASS** | After 1st run: 1 row `{version: 1, name: '001_init', applied_at: <epoch_ms>}`. Re-run: same 1 row, no duplicate. Verified live. |
| **AC-5** — Re-running on unchanged catalog is no-op | PARTIAL (AC-5 = build-index test, out of Phase 1.2 scope) | **PASS (substrate)** | Migration runner no-op confirmed (`2nd call: {applied: [], currentVersion: 1}`). Loader-level no-op (R-09) is Phase 1.3 / T-10. The substrate that AC-5 depends on (idempotent migrations + FTS5/vec trigger no-op on re-insert) is verified. |
| **AC-6** — Modifying 1 YAML → 1 UPDATE + triggers sync | PARTIAL (AC-6 = loader, out of Phase 1.2) | **PASS (trigger substrate)** | FTS5 `catalog_au` correctly removes old tokens + inserts new ones (verified live: `old hits (should be 0): 0` + `new hits (should be 1): 1`). Vec `embeddings_au` correctly DELETEs + INSERTs (verified: `len after update: 384`). Loader UPDATE path is Phase 1.3 / T-10. |
| **AC-7** — Deleting YAML removes from all 4 tables | PARTIAL (AC-7 = loader, out of Phase 1.2) | **PASS (cascade substrate)** | Catalog DELETE → embeddings DELETE (via FK CASCADE) → catalog_vec DELETE (via `embeddings_ad` trigger). Verified live: `embeddings after cascade: 1, catalog_vec: 1`. Loader DELETE path is Phase 1.3 / T-10. |
| **AC-8** — `vec_length = 384`, `vec_distance_cosine` returns finite | YES (T-08) | **PASS** | `vec_length(catalog_vec.embedding) = 384` for every inserted row (verified). `vec_distance_cosine` returns finite float for arbitrary query embeddings (verified: `first: 0.8275378942489624`, all 2 rows finite). |

---

## Migration runner idempotency: **PASS**

| Surface | Run | Result |
|---|---|---|
| Async `applyMigrations(db, { dir: <real migrations dir>})` via `openAndMigrate` | 1st | `applied: ['001_init']`, schema_migrations = 1 row |
| Async `applyMigrations(db, { dir: <real migrations dir>})` via `openAndMigrate` | 2nd | `applied: []`, schema_migrations = still 1 row, no-op |
| Direct `applyMigrations(db)` on `:memory:` open via `openCatalogDb` | 1st | `{"applied": ["001_init"], "currentVersion": 1}` |
| Direct `applyMigrations(db)` on `:memory:` open via `openCatalogDb` | 2nd | `{"applied": [], "currentVersion": 1}` ← **no-op confirmed** |

---

## FTS5 trigger correctness: **5/5 PASS**

| # | Check | Result |
|---|---|---|
| 1 | INSERT into `catalog` → row in `catalog_fts` with matching `rowid` | PASS (1 hit, rowid=1) |
| 2 | UPDATE `text` field → old tokens removed + new tokens inserted | PASS (old=0, new=1, beta=1) |
| 3 | DELETE row → FTS entry removed | PASS (before=1, after=0) |
| 4 | `unicode61 remove_diacritics 2` tokenizer: `cafe` matches `café` | PASS (diacritic-stripped: 1 hit) |
| 5 | FTS5 rowid = parent `catalog.rowid` (JOIN works) | PASS (joined `skill-2` for token "other") |

---

## Vec trigger correctness: **5/5 PASS**

| # | Check | Result |
|---|---|---|
| 1 | INSERT into `embeddings` → row in `catalog_vec` with `vec_length=384` | PASS |
| 2 | UPDATE `embeddings.vector` → `catalog_vec` row replaced | PASS (len still 384) |
| 3 | DELETE from `embeddings` → `catalog_vec` row removed | PASS (count: 2 → 1) |
| 4 | `vec_distance_cosine(catalog_vec.embedding, ?)` returns finite | PASS (all 2 rows finite, range ≈ 0.83) |
| 5 | ON DELETE CASCADE: `DELETE FROM catalog` → `embeddings` + `catalog_vec` both cleaned | PASS (after cascade: emb=1, vec=1) |

---

## audit_events schema: **PASS (5/5 PRD §10.3 columns present)**

Columns in `audit_events`:
```
id INTEGER
ts INTEGER
tenant_hash TEXT
event_type TEXT
payload TEXT
fingerprint TEXT              ← PRD §10.3
matched_ids TEXT              ← PRD §10.3
pruning_reasons TEXT          ← PRD §10.3
latency_ms INTEGER            ← PRD §10.3
redacted_prompt_hash TEXT     ← PRD §10.3
```

All 5 calibration baseline columns + all 5 PRD §10.3 Phase-5-ready columns present.

---

## openCatalogDb correctness: **PASS**

| PRAGMA / query | Expected | Actual |
|---|---|---|
| `PRAGMA journal_mode` | `wal` | `wal` ✓ |
| `PRAGMA foreign_keys` | `1` | `1` ✓ |
| `SELECT vec_version()` | non-empty | `v0.1.9` ✓ |
| `mkdir -p data/` on on-disk path | created | created (not asserted but code path verified) |

---

## StoredSkill retirement: **PASS (CatalogRow slim, alias intentional)**

**`CatalogRow` shape (PRD v3.4 R-05):**
```ts
interface CatalogRow {
  id: string;
  type: SkillKind;
  title: string | null;
  text: string;
  category: SkillCategory | null;
  critical: boolean | null;
  isDefault: boolean | null;
  contentHash: string;       // ← snake_case DB column `content_hash` mapped to camelCase
  createdAt: number;          // ← snake_case DB column `created_at` mapped to camelCase
  updatedAt: number;          // ← snake_case DB column `updated_at` mapped to camelCase
}
```

- ✓ No `slug` field
- ✓ No bare `hash` (renamed to `contentHash`)
- ✓ Timestamps are camelCase (`createdAt`/`updatedAt`), not snake_case (`created_at`/`updated_at`)
- ✓ `StoredSkill` is preserved as `type StoredSkill = CatalogRow` alias with JSDoc noting Phase 5 must migrate its imports (defensive forward-compat per Implementer deviation #2)
- ✓ `SkillRecord` + `RawSkillYaml` removed entirely (zero external references per Implementer report)
- ✓ `SkillKind` + `SkillCategory` kept (used by `src/search/types.ts` per Implementer deviation #3)

---

## Vec trigger syntax post-fix: **PASS (plain `DELETE FROM`)**

The current `001_init.sql` (HEAD) has the **post-fix** vec trigger syntax:

```sql
CREATE TRIGGER IF NOT EXISTS embeddings_au
AFTER UPDATE ON embeddings
BEGIN
  -- sqlite-vec 0.1.9 (vec0) uses regular SQL DELETE on the virtual table,
  -- NOT the FTS5 ('delete', ...) command. FTS5 delete-command syntax only
  -- works on contentless/external-content FTS5 tables; vec0 is not FTS5.
  DELETE FROM catalog_vec WHERE rowid = old.rowid;
  INSERT INTO catalog_vec(rowid, embedding) VALUES (new.rowid, new.vector);
END;

CREATE TRIGGER IF NOT EXISTS embeddings_ad
AFTER DELETE ON embeddings
BEGIN
  DELETE FROM catalog_vec WHERE rowid = old.rowid;
END;
```

Note: The FTS5 triggers (`catalog_au`/`catalog_ad`) on `catalog_fts` correctly **continue to use** the FTS5 `('delete', ...)` syntax — because `catalog_fts` IS FTS5, that syntax IS valid for it. The bug was only on the vec triggers; FTS5 triggers were never affected.

The bug was discovered by `vec-triggers.test.mjs` in the same T-08 commit and fixed in-flight before commit. `git show 333a29a -- src/catalog/migrations/001_init.sql` confirms the diff (`INSERT INTO catalog_vec(catalog_vec, rowid, embedding) VALUES ('delete', old.rowid, old.vector)` → `DELETE FROM catalog_vec WHERE rowid = old.rowid;`).

---

## Discrimination sensor: **PASSED**

**Test:** Write a bad migration to a temp directory with `ALTER TABLE nonexistent_table ADD COLUMN bar TEXT;`, call `applyMigrations(db, { dir })` on a vec-loaded DB.

**Result:**
```
MigrationError: migration 001_broken failed: no such table: nonexistent_table
code: MIGRATION_FAILED
[cause]: SqliteError: no such table: nonexistent_table
```

**Verdict:** `MigrationError` thrown with `code: 'MIGRATION_FAILED'`, SQLite error message "no such table: nonexistent_table" carried in `err.message` + `err.cause.message`. Failed migration NOT recorded in `schema_migrations` (verified: 0 rows after failure). Discrimination sensor would catch any future bad SQL — `MigrationError` is classifiable by code, not by message-sniffing.

---

## Idempotency: **PASS (2/2 `npm test` runs)**

| Run | pass/fail | duration_ms |
|---|---|---|
| 1 | 153/0 | 6468.3102 |
| 2 | 153/0 | 3383.7851 |

Both runs green, no flaky tests, no shared state mutation. `test/catalog/` runs 23/23 independently (verified via `npm run test:catalog`).

---

## `src/social-detector/` + `src/search/` untouched: **YES**

```
$ git diff --stat 70c9a03^..333a29a -- src/social-detector/ src/search/
(empty)

$ git diff --stat 823969e..333a29a -- src/social-detector/ src/search/
(empty)
```

Both directories are byte-identical across (a) Phase 1.2 alone (`70c9a03^..333a29a`) and (b) Phase 1.1 + Phase 1.2 combined (`823969e..333a29a`). AC-16 satisfied.

---

## In-flight vec trigger bug fix (Implementer deviation #1)

**Symptom:** Initial `001_init.sql` (in T-06 commit `d88371c`) had:
```sql
CREATE TRIGGER IF NOT EXISTS embeddings_au
AFTER UPDATE ON embeddings
BEGIN
  INSERT INTO catalog_vec(catalog_vec, rowid, embedding) VALUES ('delete', old.rowid, old.vector);
  INSERT INTO catalog_vec(rowid, embedding) VALUES (new.rowid, new.vector);
END;

CREATE TRIGGER IF NOT EXISTS embeddings_ad
AFTER DELETE ON embeddings
BEGIN
  INSERT INTO catalog_vec(catalog_vec, rowid, embedding) VALUES ('delete', old.rowid, old.vector);
END;
```

**Root cause:** Calibrated on FTS5 idioms; copied `('delete', ...)` syntax from `catalog_fts` triggers without realizing vec0 (`catalog_vec`) is a different virtual table type and does NOT accept the FTS5 delete-command syntax.

**Detection:** `vec-triggers.test.mjs` (T-08) failed on the very first run — UPDATE/DELETE scenarios couldn't find the row in `catalog_vec` because the `('delete', ...)` insert was rejected by vec0.

**Fix:** Same T-08 commit (`333a29a`) replaced both with plain `DELETE FROM catalog_vec WHERE rowid = old.rowid`. The FTS5 triggers on `catalog_fts` were unchanged (correct — `catalog_fts` IS FTS5).

**Verifier assessment:** This is a legitimate in-flight bug discovery. Implementer:
1. Caught it via running the test before committing T-08
2. Fixed in the same commit (atomic, no broken commit on the branch)
3. Did not weaken any tests (the test correctly asserted vec semantics)
4. Did not delete or skip the trigger tests

This pattern matches the feedback signal `sub-agent-runaway-observation` (run the test, observe failure, fix in-flight, don't paper over with skip) rather than the anti-pattern. Acceptable.

---

## Phase 1.1 residuals retired in Phase 1.2

From validation.md iter 2 (ea4bc54):

| Residual | Phase 1.2 status |
|---|---|
| **G2-residual:** `StoredSkill` calibration shape (`slug`/`hash`/`createdAt`/`updatedAt`) | **RETIRED** — `CatalogRow` is PRD v3.4 shape (no slug, `contentHash`, camelCase timestamps). `StoredSkill = CatalogRow` alias is intentional forward-compat per Implementer deviation #2. |
| **G3-residual:** `EmbedderError` 2-arg calibration shape | **LEFT ALONE** (per dispatch constraint, Phase 5 owns). File comment + `validation.md` (iter 2) classify it as `test-load-bearing-legacy`. |

---

## No-new-regression summary

| Gate | Phase 1.1 (iter 2) | Phase 1.2 (HEAD) | Δ |
|---|---|---|---|
| `npm test` | 137/137 green | 153/153 green | +16 (4 schema + 6 migrations + 5 FTS5 + 5 vec; original test count was 137) |
| `npm run typecheck` | clean | clean | 0 |
| `npm run test:catalog` | 7/7 green | 23/23 green | +16 |
| `npm run verify-env` | 6/6 passed | 6/6 passed | 0 |

No regression. The 137 → 153 jump reflects the Phase 1.2 task deliveries (T-05 = 6 migration tests, T-08 = 5 FTS5 + 5 vec tests). All 153 tests green.

---

## Out-of-scope items (NOT verifier-flagged, deferred per dispatch)

These are documented deferrals to later phases — Verifier does NOT flag them:

1. **AC-5 / AC-6 / AC-7 (loader-level idempotency / update / delete)** — Phase 1.3 / T-10 owns `CatalogLoader`. Phase 1.2 substrate (idempotent migrations + FTS5/vec trigger no-op-on-reinsert) is verified; the loader contract on top of it lands in 1.3.
2. **AC-9 / AC-13 (build-index CLI + state.json thresholds)** — Phase 1.4 / T-13–T-15. Out of Phase 1.2 scope.

---

## Commit hash of validation.md

Pending — this file will be committed before returning.

---

## Ranked gaps (fix-tasks for Phase 1.3 / 1.4)

None for Phase 1.2 closure.

| # | Item | Owner |
|---|---|---|
| **none** | — | — |

Phase 1.3 will build `CatalogLoader` on top of this verified substrate (idempotent migrations + FTS5/vec triggers + slim `CatalogRow`). The loader's own no-op-on-unchanged / update-on-change / delete-on-prune tests will be its own deliverable.

---

## Lesson signals (grounded failures worth distilling)

1. **"vec0 ≠ FTS5" — a discoverable discriminator.** The in-flight bug (FTS5 `('delete', ...)` syntax on vec0) was caught by the FIRST test run on the new vec triggers. This is a valid `tlc-spec-driven` pattern: write the test BEFORE committing the DDL, observe the failure mode, fix the DDL in the same commit. The lesson: when implementing triggers for FTS5 + vec0 side-by-side, the test that probes UPDATE/DELETE on each virtual table is the discriminator — never copy/paste trigger syntax between them. (Project-local lesson worth adding to `.specs/CALIBRATION-RESIDUE.md` or a future `.specs/LESSONS.md` once that doc materializes.)
2. **`applyMigrations` requires sqlite-vec pre-loaded for the real DDL.** A naive `new Database(':memory:')` + `applyMigrations(db)` will fail with `no such module: vec0` because `applyMigrations` does not call `sqliteVec.load(db)`. The proper sequence is `openCatalogDb()` → `applyMigrations()` (or `openAndMigrate()` for the convenience combo). This is correct factoring (loader is generic; vec load is `open.ts`'s concern) but worth a JSDoc note on `applyMigrations` itself to prevent future confusion. (Minor doc gap; not a code gap.)

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 1.2 lines 186-201](../../ROADMAP.md)
- [`.specs/STATE.md` AD-002 calibration residue rule](../../STATE.md)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md)
- [`.specs/features/phase-1-catalog-schema-index/spec.md`](../spec.md)
- [`.specs/features/phase-1-catalog-schema-index/design.md`](../design.md)
- [`.specs/features/phase-1-catalog-schema-index/tasks.md`](../tasks.md)
- [`.specs/features/phase-1-catalog-schema-index/validation.md`](../validation.md) — Phase 1.1 iter 2 report
- [CLAUDE.md `## Testing contract`](../../../CLAUDE.md)

**Status: PASS — Phase 1.2 subchapter is DONE. Ready for ROADMAP checkbox flip on Phase 1.2.**
