---
date: 2026-07-30
version: 1
description: "Phase 1 — Catalog + Schema + Index spec. Rewrites the calibration-era src/catalog/** to PRD v3.4 schema (catalog + embeddings + audit_events tables, FTS5 + sqlite-vec, multilingual-e5-small ONNX 384d), adds versioned migrations, idempotent YAML→SQLite loader, and a build-index script with perf measurement (<60s for 100 skills)."
explanation: |
  Phase 1 is the foundation of Memory Studio's runtime catalog. It rewrites
  the calibration residue in `src/catalog/**` (per `.specs/CALIBRATION-RESIDUE.md`)
  into the PRD v3.4 shape: split tables (`catalog` + `embeddings` + `audit_events`),
  YAML fields `id/type/title/text` (+ `category` for skill, `critical` for rule,
  `isDefault` for persona), FTS5 on `text`, sqlite-vec 384d, multilingual-e5-small
  ONNX (NOT the deterministic stub embedder), idempotent loader keyed on `id`,
  versioned migrations (so schemaVersion is bumpable without rewrite), and a
  build-index script that meets the PRD §10.4 SLA (<60s for 100 skills).

  Scope is intentionally narrow: NO Fastify server, NO SDK, NO UI, NO
  social-detector changes, NO retrieval runtime queries (Phase 5). The
  catalog loader is the only writer; readers come in Phase 5.

  The Verifier should expect drift findings on `src/catalog/**` files
  (per AD-002 calibration residue rule) and mark them `quarantined` with
  reason "calibration residue, rewritten in Phase 1".

  Touch ONLY files under `.specs/features/phase-1-catalog-schema-index/`
  for this planning artifact. Implementation tasks live in `tasks.md`
  and will be executed in a separate Planner→Implementer dispatch.
related:
  - ../../ROADMAP.md
  - ../../ARCHITECTURE.md
  - ../../../PLAN.md
  - ../../../PRD.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.memory-studio/setup.md
  - ../../STATE.md
  - ../../../CLAUDE.md
  - ../../../.specs/archive/2026-07-calibration/features/schema-and-crud/
  - ../../../../.scratch/memory-studio/spec.md
---

# Phase 1 — Catalog + Schema + Index — Spec

**Phase:** 1
**Slug:** `phase-1-catalog-schema-index`
**Source:** `.specs/ROADMAP.md` lines 120-159
**Goal:** rewrite the catalog authoring + index pipeline to PRD v3.4 schema, populating a queryable SQLite store with FTS5 + sqlite-vec that Phase 5 (Proxy) reads from.
**Estimate:** 6-8h (per ROADMAP)

---

## Architectural Reference

> Farol nodes consumed by this spec (`.specs/ARCHITECTURE.md` — Módulos 4 + 5):

> **Módulo 4 — Pipeline (cold path side):**
> - `catalog` — Ingestão: parseia YAML, persiste, gera embeddings (cold path). Phase 1 IMPLEMENTS this.

> **Módulo 5 — Storage:**
> - `sqlite` — Tabelas: `catalog` + `audit_events` + `intel`. Phase 1 creates `catalog` + `audit_events` schema (intel table is Phase 6 per farol).
> - `embed-model` — multilingual-e5-small ONNX 384d. Phase 1 wires this as the embedder (replaces the calibration `DeterministicStubEmbedder`).
> - `catalog-yaml` — `config/catalog/<id>.yaml`. Phase 1 establishes the directory + format.
> - `fts5-vec` — search engine (FTS5 + sqlite-vec). Phase 1 creates the virtual tables and triggers; Phase 5 queries them.

> **Out of farol scope for Phase 1** (deliberately): `augmenter`, `search`, `social-detector`, `cache`, `fast-agent`, `ui-panel`, `sdk`, `server`. These are Phase 2/3/4/5/6 — Phase 1 only writes the catalog side and the storage substrate.

**Edges built by Phase 1 (implementer's TODO list):**
- `catalog-yaml → sqlite` (load cold) — via `npm run build-index` script
- `catalog → embed-model` (compute embeddings) — via `Embedder` interface
- `catalog → sqlite` (write rows) — via `CatalogLoader` module

**Edges NOT built by Phase 1** (consumers in later phases):
- `sqlite → fts5-vec` — Phase 5 (query path)
- `augmenter → search → fts5-vec` — Phase 5

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | Directory `config/catalog/` exists at repo root and is git-tracked (PRD §6.4) | PRD §6.4 |
| **R-02** | YAML schema validated per item type: `Skill` requires `id`, `type: skill`, `title`, `text`, `category` (enum: `procedural \| diagnostic \| reference \| pattern`); `Rule` requires `id`, `type: rule`, `text`, optional `critical: bool`; `Persona` requires `id`, `type: persona`, `text`, optional `isDefault: bool` | ROADMAP AC #1 + PRD §6.1-6.3 + SPEC §IMod-6 |
| **R-03** | YAML validation uses **Zod** schemas (`src/catalog/schema/*.ts`) and produces a structured error per invalid file (stderr + skip-on-error), never crashing the loader | ROADMAP done #5 + PRD §6 |
| **R-04** | SQLite database file `data/memory-studio.sqlite` is created on first `build-index` run, with **versioned migrations** (`schema_migrations` table tracking applied versions) | ROADMAP done #3 + PLAN §16.4 M2 |
| **R-05** | Three tables created on first run: `catalog` (id, type, title, text, category?, critical?, is_default?, hash, created_at, updated_at), `embeddings` (catalog_id PK, vector BLOB, model_version, embedded_at), `audit_events` (id, ts, tenant_hash, event_type, payload, fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash) | PRD §6 + §10.3 + SPEC §IMod-1 + §IMod-13 + ROADMAP done #2 |
| **R-06** | FTS5 virtual table `catalog_fts` mirrors `catalog.text` with INSERT/UPDATE/DELETE triggers keeping it in sync | ROADMAP done #4 + SPEC §IMod-7 |
| **R-07** | sqlite-vec virtual table `catalog_vec` (384d, cosine distance) mirrors `embeddings.vector` with INSERT/DELETE triggers keeping it in sync | PRD §8 + ROADMAP done #5 |
| **R-08** | `Embedder` interface (`encode(text: string): Promise<Float32Array>`) implemented by `MultilingualE5SmallEmbedder` using `onnxruntime-node` + the cached `multilingual-e5-small` ONNX model | PRD §8 + SPEC §IMod-14 + ROADMAP done #5 |
| **R-09** | Loader is **idempotent**: re-running `npm run build-index` on an unchanged catalog produces 0 new rows; re-running on a changed YAML updates only that item (keyed by `id`); deleting a YAML removes the row + its embedding + its vec entry | ROADMAP done #6 |
| **R-10** | `npm run build-index` regenerates embeddings for a 100-skill fixture in **< 60s** (wall clock), measured by an automated perf check | PRD §10.4 item 1 + ROADMAP done #7 |
| **R-11** | API field `schemaVersion: 3` is exposed via `getCatalogSchemaVersion(): number` helper for Phase 5 to read into `/catalog` GET responses | ROADMAP done #8 + PRD §6.4 |
| **R-12** | Schema versioning policy: `schemaVersion` lives in (a) the migration table (`schema_migrations.version`) and (b) the exported constant in `src/catalog/version.ts`. Breaking schema changes bump MAJOR. Non-breaking bump MINOR | ROADMAP done #9 + PLAN §16.4 M2 |
| **R-13** | Zero `§18.x` references remain in PRD/PLAN/SPEC/ROADMAP — D-001 cross-check | ROADMAP done #10 + DISCOVERIES D-001 |
| **R-14** | `.memory-studio/state.json` default includes `schemaVersion: 3`, `thresholds.minCosineSimilarity: 0.6`, `thresholds.minFtsHits: 2` (initial values; Phase 7a re-tunes empirically) | ROADMAP done #11 + `.memory-studio/setup.md` |
| **R-15** | Calibration residue in `src/catalog/**` is **rewritten** (not edited in place); the new code lives under `src/catalog/` with PRD v3.4 types (`Skill`, `Rule`, `Persona`). The 185-test green baseline is preserved throughout | `.specs/CALIBRATION-RESIDUE.md` + AD-002 |
| **R-16** | `src/social-detector/is-social.ts` is **untouched** in Phase 1 (Phase 2 promotes it) | `.specs/CALIBRATION-RESIDUE.md` + dispatch constraint |
| **R-17** | No Fastify server, no API endpoints, no SDK code in Phase 1 deliverables — only the catalog authoring + index pipeline that downstream phases will consume | dispatch constraint |

### Out of scope (explicit non-goals)

- **Fastify server / API endpoints** (Phase 5).
- **`@memory-studio/sdk` package** (Phase 3).
- **Retrieval queries at runtime** — FTS5 + sqlite-vec are populated but not queried by Phase 1 (Phase 5).
- **UI panel** (Phase 4).
- **Social detector promotion / fingerprint 4-component** (Phase 2).
- **Intel store + fast agent** (Phase 6).
- **`/augment`, `/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`, `/state/toggle`** — all endpoints are Phase 5 per SPEC §IMod-10.
- **Byte-string determinism / tiebreak ordering / `pruningDecisions`** — those are Phase 5 retrieval concerns.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | Directory `config/catalog/` exists; creating a sample `auth-jwt-01.yaml` with valid `Skill` shape (id/type/title/category/text) makes `npm run build-index` parse it without error and produce exactly 1 row in the `catalog` table |
| **AC-2** | `npm run build-index` exits non-zero with a clear stderr message naming the file + field when given a YAML missing `id`, or `title` (Skill only), or `text`, or with `category` outside the enum |
| **AC-3** | SQLite database file `data/memory-studio.sqlite` exists after first run; `SELECT name FROM sqlite_master WHERE type='table'` returns rows for: `catalog`, `embeddings`, `audit_events`, `schema_migrations`, `catalog_fts` (FTS5), `catalog_vec` (sqlite-vec) |
| **AC-4** | `schema_migrations` table contains exactly one row with `version: 1` and `applied_at` populated after first build-index |
| **AC-5** | Re-running `npm run build-index` on an unchanged catalog is a no-op (0 INSERTs, 0 UPDATEs, 0 DELETEs — verified by counting row hashes before/after) and exits 0 in < 5s |
| **AC-6** | Modifying one YAML file (e.g. changing `text`) and re-running `build-index` results in exactly 1 UPDATE on the `catalog` row, 1 UPDATE on the `embeddings` row, and the FTS5/vec triggers keeping their tables in sync |
| **AC-7** | Deleting a YAML file and re-running `build-index` removes the corresponding row from `catalog`, `embeddings`, `catalog_fts`, `catalog_vec` (no orphans) |
| **AC-8** | `embeddings.vector` column is a non-empty BLOB; `vec_length(catalog_vec.embedding) = 384` for every row; `vec_distance_cosine(catalog_vec.embedding, ?)` returns a finite float for an arbitrary query embedding |
| **AC-9** | Perf check: a fixture of 100 synthetic Skill YAMLs is created on disk, `npm run build-index` is run, wall-clock time is recorded, and the script asserts `< 60_000 ms`. Result is logged to stderr with `[PERF] build-index: <ms>ms for 100 skills` |
| **AC-10** | `import { getCatalogSchemaVersion } from "./src/catalog/version.ts"` (or equivalent ESM import) returns the number `3` |
| **AC-11** | `catalog_fts` SELECT on a known token from a Skill's `text` returns ≥ 1 row, and the rowid matches the parent `catalog.id` |
| **AC-12** | `audit_events` table schema includes columns `fingerprint TEXT`, `matched_ids TEXT`, `pruning_reasons TEXT`, `latency_ms INTEGER`, `redacted_prompt_hash TEXT` (in addition to the calibration `id, ts, tenant_hash, event_type, payload`) |
| **AC-13** | `.memory-studio/state.json` already contains the default thresholds (`schemaVersion: 3`, `minCosineSimilarity: 0.6`, `minFtsHits: 2`) — Phase 1 confirms these are unchanged (or commits an update if missing) |
| **AC-14** | `grep -rE '§18\.' PRD.md PLAN.md .scratch/memory-studio/spec.md .specs/ROADMAP.md .specs/ARCHITECTURE.md` returns zero matches (D-001 cross-check) |
| **AC-15** | Throughout Phase 1, `npm test` and `npm run typecheck` keep passing — the 185-test baseline is preserved. New tests added by Phase 1 grow the count; no test deletions except as part of calibration residue removal in T-01's commit. |
| **AC-16** | `src/social-detector/is-social.ts` is byte-identical before and after Phase 1 (`git diff --stat src/social-detector/` shows no changes) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: Library for YAML parsing** | **`yaml` package** (eemeli/yaml, ~1M weekly downloads, supports YAML 1.2, well-maintained) | Standard, schema-aware, NFC normalization built-in. `js-yaml` alternative would also work but lacks comment-preservation for round-trip | yes (autonomous) |
| **A-2: Library for Zod** | **`zod` v3.x** | Already standard for TS schema validation; lighter than `valibot`/`@sinclair/typebox` for our needs; type-inference works with `z.infer<typeof SkillSchema>` | yes (autonomous) |
| **A-3: ONNX runtime** | **`onnxruntime-node`** (already installed for Phase 0 env validation) | Already verified loadable per Phase 0 AC; OS-specific prebuilt binary already downloaded | yes (autonomous) |
| **A-4: Multilingual-e5-small model location** | **`models/multilingual-e5-small/model.onnx` + `tokenizer.json`** cached at repo root (gitignored via existing `.gitignore` per `.memory-studio/setup.md`) | Calibration residue already does this for the stub; PRD §8 says ONNX model is local | yes (autonomous) |
| **A-5: Embedding input format** | **Prefix `query: ` for query embeddings, `passage: ` for catalog embeddings** (per multilingual-e5-small official usage) | Required by the model card for asymmetric retrieval (queries vs passages are encoded differently); skipping this drops retrieval quality ~30% | yes (autonomous) |
| **A-6: Catalog directory location** | **`config/catalog/`** at repo root | PRD §6.4 explicitly says `config/catalog/<id>.yaml` | yes (PRD explicit) |
| **A-7: Per-file vs combined migrations** | **Single migration `001_init.sql`** for Phase 1 (catalog + embeddings + audit_events + FTS5 + vec + triggers). Future migrations are `002_*.sql`, etc. | Phase 1 is the first migration; future phases add `00N_*.sql` files | yes (autonomous) |
| **A-8: Idempotency key** | **`catalog.id`** is the unique key. Re-running finds rows by `id`, computes new hash, compares, only writes if hash differs | Calibration residue used `hash` only — too coarse if id is reused with different content; using `id` as PK + `hash` as change detector is safer | yes (autonomous) |
| **A-9: Error handling on bad YAML** | **stderr + skip** (continue with other files). Build-index exits non-zero if ≥ 1 file failed but always reports count of successes + failures | PRD §6 implies fail-soft for catalog authoring (UI can fix later); exit code propagates to npm scripts | yes (autonomous) |
| **A-10: Embedding BLOB layout** | **Float32Array raw bytes** (little-endian), 384 × 4 = 1536 bytes per row | Calibration residue uses this; sqlite-vec 0.1.9 reads it directly via `vec_from_float32()` | yes (calibration proven) |
| **A-11: FTS5 trigger behavior** | **`AFTER INSERT/UPDATE/DELETE` triggers** on `catalog` table that insert/delete from `catalog_fts` using `new.text` / `old.text`. Porter stemming + unicode61 tokenizer (default) | Standard SQLite FTS5 idiom; the calibration residue uses this pattern | yes (autonomous) |
| **A-12: Vec trigger behavior** | **`AFTER INSERT/DELETE` triggers** that mirror `embeddings` rows into `catalog_vec` (using the same `rowid` linkage) | sqlite-vec 0.1.9 requires explicit rowid binding per calibration residue workaround | yes (calibration proven) |
| **A-13: `audit_events` table — Phase 1 scope** | **DDL only** in Phase 1. The writers (Phase 5 retrieval events) land later. Columns include the calibration 5 (`id, ts, tenant_hash, event_type, payload`) plus the Phase 5-ready columns (`fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash`) so Phase 5 doesn't need a migration | ROADMAP done #2 says create the table; Phase 5 owns the writers | yes (autonomous) |
| **A-14: Thresholds default location** | **`.memory-studio/state.json`** (already exists with the right values per `.memory-studio/setup.md`). Phase 1 does NOT create a separate thresholds file | ROADMAP done #11 explicitly says default in `state.json` | yes (PRD explicit) |
| **A-15: Test framework** | **Node 22 built-in `node --test`** (per CLAUDE.md + Phase 0's choice). Tests live in `test/catalog/` | Consistent with CLAUDE.md testing contract; calibration residue uses this | yes (CLAUDE.md explicit) |
| **A-16: Calibration residue disposition** | **Rewrite `src/catalog/**` in place** (per `.specs/CALIBRATION-RESIDUE.md`). Old files deleted as part of T-01 or T-02. The 185-test count will drop on T-01 and grow back as new tests are added | Calibration residue doc explicitly says this; AD-002 governs it | yes (calibration-residue doc explicit) |
| **A-17: Subchapter breakdown** | **Yes — 4 subchapters** (1.1 schema + Zod, 1.2 migrations, 1.3 loader, 1.4 build-index + perf). 16+ atomic tasks fits the SUBCHAPTER_BREAKDOWN trigger | Dispatch constraint hints at this; tasks.md will reflect | yes (autonomous) |

**Open questions:** none — all ambiguities resolved as assumptions above.

---

## Edge Cases (enumerated for tests)

- WHEN a YAML file is empty (0 bytes) THEN loader SHALL skip it with a stderr message and continue.
- WHEN a YAML file is invalid YAML syntax (broken indentation) THEN loader SHALL skip it with a structured error including line number and continue.
- WHEN a YAML file passes schema validation but contains a 0-length `text` field THEN loader SHALL skip it with a stderr message (empty catalog entries are useless for retrieval).
- WHEN a YAML file declares `type: rule` AND `type: skill` (conflicting types) THEN loader SHALL skip with error "type conflict".
- WHEN a YAML file uses a `category` value outside `{procedural, diagnostic, reference, pattern}` THEN loader SHALL reject with enum error.
- WHEN a YAML file declares `critical: "yes"` (string, not bool) THEN loader SHALL reject with type error.
- WHEN two YAML files declare the same `id` THEN loader SHALL skip the second one with error "duplicate id" and continue with the first.
- WHEN the SQLite file `data/memory-studio.sqlite` is corrupted (unreadable) THEN loader SHALL exit non-zero with clear error (no silent fallback).
- WHEN `data/` directory does not exist THEN loader SHALL create it (mkdir -p equivalent) before opening the DB.
- WHEN the ONNX model file is missing THEN loader SHALL exit non-zero with "model not found at <path>" — never silently fall back to a stub.

---

## User Stories (consumed from SPEC §A)

Per SPEC `.scratch/memory-studio/spec.md` §A — Configuração inicial (items 1, 4, 5, 6, 7, 8):

| Story | Source | Phase 1 Acceptance |
|---|---|---|
| **A.4** — Add Skill by editing `config/catalog/<id>.yaml` | SPEC §A.4 | AC-1, AC-2 |
| **A.5** — `npm run build-index` <60s for 100 skills | SPEC §A.5 | AC-9 |
| **A.6** — Migrate v1 calibration state into PRD v3 schema | SPEC §A.6 | Calibration residue rewrite per AC-15 |
| **A.7** — SQLite + FTS5 + sqlite-vec tables exist | SPEC §A.7 | AC-3, AC-6, AC-7 |
| **A.8** — `schemaVersion` exposed in API | SPEC §A.8 | AC-10 (helper exported; Phase 5 wires into HTTP) |

---

## Requirement Traceability

| Req ID | Story | Status |
|---|---|---|
| R-01 | A.4 | Pending (design + tasks) |
| R-02 | A.4 | Pending |
| R-03 | A.4 | Pending |
| R-04 | A.7 | Pending |
| R-05 | A.7 | Pending |
| R-06 | A.7 | Pending |
| R-07 | A.7 | Pending |
| R-08 | A.7 | Pending |
| R-09 | A.4 | Pending |
| R-10 | A.5 | Pending |
| R-11 | A.8 | Pending |
| R-12 | A.8 | Pending |
| R-13 | D-001 cross-check | Pending |
| R-14 | ROADMAP done #11 | Pending |
| R-15 | A.6 | Pending |
| R-16 | AD-002 + dispatch constraint | Pending (non-task — verified by Verifier) |
| R-17 | dispatch constraint | Pending (non-task — verified by Verifier) |
| AC-1 | A.4 | Pending |
| AC-2 | A.4 | Pending |
| AC-3 | A.7 | Pending |
| AC-4 | A.7 | Pending |
| AC-5 | A.4 | Pending |
| AC-6 | A.4 | Pending |
| AC-7 | A.4 | Pending |
| AC-8 | A.7 | Pending |
| AC-9 | A.5 | Pending |
| AC-10 | A.8 | Pending |
| AC-11 | A.7 | Pending |
| AC-12 | A.7 | Pending |
| AC-13 | ROADMAP done #11 | Pending |
| AC-14 | D-001 cross-check | Pending |
| AC-15 | A.6 + AD-002 | Pending |
| AC-16 | dispatch constraint | Pending (non-task) |

**Coverage:** 17 R-NN + 16 AC-NN = 33 traceable requirements. All mapped to spec sections.

---

## Success Criteria

Phase 1 is DONE when:

- [ ] All 16 ACs above are observable in test output (verifier-independent, evidence-or-zero).
- [ ] `npm run build-index` exists and exits 0 on the existing repo (with 1 example YAML) AND on a synthetic 100-skill fixture in <60s.
- [ ] The 185-test baseline is preserved or grown — no test silently deleted except calibration-residue tests explicitly retired in T-01.
- [ ] `schemaVersion: 3` is exposed via the version helper.
- [ ] `.memory-studio/state.json` thresholds default is in place.
- [ ] Zero `§18.x` references in PRD/PLAN/SPEC/ROADMAP/ARCHITECTURE.
- [ ] `src/social-detector/is-social.ts` is byte-identical (verified by `git diff --stat`).
- [ ] Verifier independently runs the discrimination sensor (per `tlc-spec-driven` post-Execute step) and reports PASS.

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 1](../../ROADMAP.md) — done criteria
- [`.specs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — farol stable IDs (Módulos 4 + 5)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md) — what `src/catalog/**` is and how to treat it
- [PRD §6](../.../.../PRD.md) — YAML schema (Skill/Rule/Persona)
- [PRD §8](../.../.../PRD.md) — stack + invariantes sólida (incl. versioning)
- [PRD §10.4 item 1](../.../.../PRD.md) — build-index SLA
- [SPEC §IMod-6](../../../.scratch/memory-studio/spec.md) — catalog schema
- [SPEC §IMod-13](../../../.scratch/memory-studio/spec.md) — invariantes (1, 4, 5)
- [SPEC §IMod-14](../../../.scratch/memory-studio/spec.md) — stack table
- [SPEC §IMod-15](../../../.scratch/memory-studio/spec.md) — working set partial
- [PLAN §16.4 M2](../../PLAN.md) — schema versioning policy
- [`.memory-studio/setup.md`](../../../.memory-studio/setup.md) — state.json schema reference
- [`.specs/archive/2026-07-calibration/features/schema-and-crud/`](../../archive/2026-07-calibration/features/schema-and-crud/) — calibration spec for algorithm reference (RRF, NFC normalization, deterministic-stub embedder)