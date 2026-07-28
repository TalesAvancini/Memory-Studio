# Validation — Phase 2 (schema-and-crud)

**Verdict:** PASS (with one scope-guard observation — see below)

**Date:** 2026-07-23
**Commit:** 300badc
**Range:** 3f3cf60..300badc (10 commits)

---

## Gates

| Gate | Result |
|---|---|
| `npm test` | exit 0, real **5.122s**, "115 passed, 0 failed" |
| `npx tsc --noEmit` | exit 0 (no output) |
| `npm run catalog:load config/skills/example-jwt-01.yaml` (1st run) | exit 0 — `created skill id=1 slug=example-jwt-01 hash=8f050933b48a9b39f725869271e7abd6c8f78e7c5706b3580e56fadc1121be18` |
| `npm run catalog:load config/skills/example-jwt-01.yaml` (2nd run, idempotency) | exit 0 — `unchanged skill id=1 slug=example-jwt-01 hash=8f0509...be18` (same id, same hash) |
| DB inspection (`SELECT id,slug,kind,length(embedding)`) | `[{id:1, slug:'example-jwt-01', kind:'skill', emb_bytes:1536}]` |
| Coverage `src/catalog/` (combined) | lines **91.00%**, branches **76.65%**, functions **87.06%** — all above spec ≥80% lines / ≥75% branches / ≥80% functions |

Per-file coverage (from `--experimental-test-coverage`):

| File | Lines % | Branches % | Funcs % |
|---|---|---|---|
| cli.ts | 95.62 | 65.96 | 71.43 |
| embedder.ts | 90.41 | 86.49 | 92.31 |
| errors.ts | 85.51 | 85.00 | 84.21 |
| loader.ts | 87.24 | 75.93 | 95.00 |
| schema.ts | 97.83 | 71.43 | 100.00 |
| types.ts | 100.00 | 100.00 | 100.00 |
| writer.ts | 90.65 | 76.67 | 85.71 |

Note: `cli.ts` functions are 71.43% — below 80% line-by-line, but the **folder-level** coverage exceeds all thresholds specified in spec.md (crud-17: "Cobertura mínima 80% em src/catalog/").

Test breakdown:
- `test/smoke.test.mjs`: 5 passed
- `test/social-detector.test.mjs`: 55 passed (Phase 3 untouched — proof skill works)
- `test/catalog/*.test.mjs`: 55 passed
- **Total: 115 passed, 0 failed**

---

## Spec-anchored check (20/20 ACs)

| AC | Met? | Evidence |
|---|---|---|
| **crud-01** skills table schema | Yes | `src/catalog/schema.ts:18-39` (DDL). Test `T-SCHEMA-01` (`test/catalog/schema.test.mjs:27-69`) asserts column names/types from `PRAGMA table_info(skills)`. |
| **crud-02** audit_events schema | Yes | `schema.ts:32-38` (DDL). Test `T-SCHEMA-02` (`schema.test.mjs:99-130`) asserts column metadata for `audit_events`. |
| **crud-03** idempotent createSchema | Yes | `schema.ts:21` (`CREATE TABLE IF NOT EXISTS`). Test `T-SCHEMA-03` (`schema.test.mjs:132-161`) calls `createSchema` 3×, inserts a row between calls, verifies row survives. |
| **crud-04** loader validation (kind/slug/content/YAML) | Yes | `src/catalog/loader.ts:41-99` (validateKind/Slug/Content). Tests `T-LOADER-02`, `T-LOADER-03a/b/c`, `T-LOADER-04/04b`, `T-LOADER-05` (`loader.test.mjs:49-118`) cover each error code. |
| **crud-05** extra fields preserved | Yes | `loader.ts:152` (`canonicalYamlString(raw)`) keeps all keys. Test `T-LOADER-06` (`loader.test.mjs:120-140`) asserts `extra:/references:` survive canonicalization. |
| **crud-06** NFC + trim + hash | Yes | `loader.ts:71` (NFC + trim), `loader.ts:101-103` (sha256). Tests `T-LOADER-07` (`loader.test.mjs:142-161`) compute expected hash via `crypto.createHash('sha256').update(contentYaml).digest('hex')` and verify equality — independent check. `T-LOADER-07b` (`loader.test.mjs:163-179`) uses NFD input. |
| **crud-07** 384-dim deterministic embedder | Yes | `src/catalog/embedder.ts:26` (`EMBEDDING_DIMENSIONS = 384`), `:40-77` (deterministic algorithm), `:102-120` (class). Tests `T-EMBED-01/02/03` (`embedder.test.mjs:19-42`) assert length, byte equality, near-orthogonality. |
| **crud-08** Embedder swappable | Yes | `embedder.ts:30-33` (interface). Test `T-EMBED-08` (`embedder.test.mjs:92-106`) defines a `NullEmbedder implements Embedder` and verifies it is callable. |
| **crud-09** BLOB = 1536 bytes | Yes | `embedder.ts:26-28` (TARGET_BYTES = 384×4). Test `T-EMBED-04` (`embedder.test.mjs:44-50`) asserts `buf.byteLength === 1536`. |
| **crud-10** upsert by hash | Yes | `src/catalog/writer.ts:117-148` (SELECT by hash first; INSERT if absent). Tests `T-WRITER-01/02` (`writer.test.mjs:67-94`) assert `action:'inserted'` then `action:'unchanged'` with same `id`. |
| **crud-11** WriterWarning on slug collision | Yes | `writer.ts:133-146` (log warn, do not modify). Test `T-WRITER-03` (`writer.test.mjs:96-120`) captures pino JSON-line output and asserts `WriterWarning`/`slug_differs_for_same_hash`/`original-slug`/`renamed-slug` strings appear. |
| **crud-12** embedding round-trip bit-exact | Yes | `writer.ts:67-85` (`embeddingToBuffer` / `bufferToEmbedding`). Tests `T-WRITER-04` (`writer.test.mjs:122-141`) via `readSkillById`; `T-WRITER-07` (`writer.test.mjs:183-193`) via direct buffer round-trip. `T-EMBED-05` (`embedder.test.mjs:52-63`) does the same at embedder level. |
| **crud-13** created_at frozen, updated_at stable | Yes | `writer.ts:157-189` (insert sets both to `now()`; unchanged returns stored). Test `T-WRITER-05` (`writer.test.mjs:143-163`) injects virtual clock `1700000000000`, runs, advances clock by 5s, asserts `updatedAt` unchanged. |
| **crud-14** CLI argv validation | Yes | `src/catalog/cli.ts:45-55` (`isUsageError`), `:57-61` (return 2). Test `T-CLI-03` (`cli.test.mjs:84-90`) calls `main()` directly for 4 invalid argv cases; asserts exit code 2. |
| **crud-15** CLI stdout format | Yes | `cli.ts:79-82` (`stdout.write` format). Test `T-CLI-01` (`cli.test.mjs:46-69`) subprocess-runs the CLI against `example-jwt-01.yaml`, asserts `created skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}` then `unchanged skill id=\d+ ...`. End-to-end smoke verified same output. |
| **crud-16** CLI exit code ≠ 0 on error | Yes | `cli.ts:84-111` (`stderr.write` + return 1). Tests `T-CLI-02/04/05/07` (`cli.test.mjs:71-164`) cover missing file, bad YAML content, invalid DB path — each asserts `status !== 0`. |
| **crud-17** ≥80% coverage on src/catalog/ | Yes | 91.00% lines, 76.65% branches, 87.06% functions (folder-level). All exports have ≥1 behavior assertion. |
| **crud-18** npm test < 10s | Yes | Real elapsed 5.122s — comfortably under budget. |
| **crud-19** typed errors | Yes | `src/catalog/errors.ts:14-69` (`LoaderError`, `WriterError`, `SchemaError`, `EmbedderError`). Tests assert `err instanceof LoaderError`/`WriterError`. No bare `throw new Error(...)` in production code (verified by code review of `src/catalog/*.ts`). |
| **crud-20** pino silent in tests | Yes | `cli.ts:65-66` (`MS_CATALOG_LOAD_QUIET === '1' → silent`). Tests set `MS_CATALOG_LOAD_QUIET=1` (`cli.test.mjs:39, 103`). Test `T-CLI-01` (`cli.test.mjs:54`) asserts stdout is a single line (no JSON-line noise). |

---

## Discrimination sensor

**Yes — tests derive expected results from spec, not from implementation state.**

Evidence:

1. **T-LOADER-07** (`loader.test.mjs:142-161`): computes expected hash via `createHash('sha256').update(record.contentYaml, 'utf8').digest('hex')` and asserts equality with the loader's output. Independent recomputation, not a snapshotted constant.
2. **T-LOADER-07b** (`loader.test.mjs:163-179`): constructs NFD input at runtime (`String.fromCodePoint(0x0301)`), normalizes both NFD/NFC variants, asserts same hash — anchors the NFC normalization invariant in spec.md crud-06.
3. **T-EMBED-04** (`embedder.test.mjs:44-50`): derives `1536` from spec math (`EMBEDDING_DIMENSIONS * 4`) — not a magic constant.
4. **T-WRITER-05** (`writer.test.mjs:143-163`): injects a controllable clock (`now: () => virtualNow`) and asserts timestamp semantics directly. No snapshot.
5. **T-CLI-01** matches stdout against regex `/created skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}/` — derives from spec wording; would still pass on different id/hash values if behavior matches.
6. **T-WRITER-03** captures pino output into a memory buffer and asserts content markers (`WriterWarning`, `slug_differs_for_same_hash`) — derives from spec § 4 wording, not from log line format.

No test imports private state, mirrors implementation details, or hardcodes values that would break without spec change.

---

## Scope-guard compliance

`git diff --stat 3f3cf60..300badc` — files in range:

```
 brief-m3cli-phase3.md             |  227 +
 config/skills/example-jwt-01.yaml |    9 +
 package-lock.json                 | 1127 +
 package.json                      |   17 +-
 src/catalog/cli.ts                |  137 +
 src/catalog/embedder.ts           |  146 +
 src/catalog/errors.ts             |   69 +
 src/catalog/index.ts              |   18 +
 src/catalog/loader.ts             |  196 +
 src/catalog/schema.ts             |   46 +
 src/catalog/types.ts              |   36 +
 src/catalog/writer.ts             |  214 +
 src/index.ts                      |   12 +-
 test/catalog/cli.test.mjs         |  164 +
 test/catalog/embedder.test.mjs    |  147 +
 test/catalog/loader.test.mjs      |  286 +
 test/catalog/schema.test.mjs      |  161 +
 test/catalog/types.smoke.test.mjs |   54 +
 test/catalog/writer.test.mjs      |  258 +
 tsconfig.json                     |    2 +
```

**Phase 2 implementation files**: all 8 new `src/catalog/*.ts` files, `src/index.ts` (re-export), `package.json` + `package-lock.json` (deps), `tsconfig.json` (allowImportingTsExtensions + noEmit — documented in design.md § dependencies as `tsx` rationale), `config/skills/example-jwt-01.yaml` (CLI fixture), 6 new `test/catalog/*.test.mjs` files. All within scope.

**Side-effects in protected files: ONE VIOLATION observed.**

The dispatch's critical-check list includes `brief-m3cli-phase*.md`. The range `3f3cf60..300badc` contains 10 commits. The dispatch's commit breakdown claims "9 implementation + 1 deps chore" but the actual breakdown is:

| Commit | Subject | Scope status |
|---|---|---|
| 300badc | chore(catalog): verify phase 2 gates pass and document coverage | Phase 2 |
| 210331f | feat(catalog): re-export catalog domain from src/index | Phase 2 |
| 2930661 | feat(catalog): add CLI entry point for catalog:load | Phase 2 |
| d70f5bd | feat(catalog): add sqlite writer with idempotent upsert by hash | Phase 2 |
| b3799fb | feat(catalog): add Embedder interface and deterministic stub (384d) | Phase 2 |
| 913e02c | feat(catalog): add yaml loader with kind and slug validation | Phase 2 |
| 25197b5 | feat(catalog): add sqlite schema with skills and audit_events tables | Phase 2 |
| a9e04aa | feat(catalog): add public types and error hierarchy | Phase 2 |
| 91f8c01 | chore(deps): add catalog phase 2 dependencies | Phase 2 (deps chore) |
| **d441e05** | **docs: brief Phase 3 — calibration run da skill loop** | **OUT-OF-SCOPE: created `brief-m3cli-phase3.md`** |

Commit `d441e05` (the oldest in the range) created `brief-m3cli-phase3.md` — a Phase 3 docs brief, not a Phase 2 deliverable. This is the file appearing in the diff stat (`brief-m3cli-phase3.md | 227 +`).

This is **not a Phase 2 implementation fault** — the brief commit is purely additive and doesn't touch Phase 2 code — but it is a scope-guard violation per the dispatch's own CRITICAL CHECK list (`brief-m3cli-phase*.md` is on the protected list).

The dispatch's commit count description ("9 implementation + 1 deps chore" = 10 total) does not account for this Phase 3 commit; the actual range contains 8 catalog implementation commits + 1 deps chore + 1 Phase 3 brief commit. The Implementation author either: (a) branched off a tree that already included `d441e05` and did not rebase to exclude it; or (b) included the brief commit as a branch baggage.

**Verdict impact:** PASS on implementation quality (20/20 ACs, gates green, discrimination sensor clean). The scope-guard violation is a **procedural gap** for the orchestrator to address — either rebase to drop `d441e05` from the Phase 2 branch, or surface to human whether Phase 3 docs committal before Phase 2 verification completion is acceptable.

All other files on the protection list were **not touched**: zero changes to `src/social-detector/**`, `src/augmenter/**`, `src/cache/**`, `src/agents/**`, `src/server/**`, `src/shared/**`, `test/smoke.test.mjs`, `test/social-detector.test.mjs`, `.claude/**`, `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json`, `.specs/features/social-detector/**`, `CLAUDE.md`, `proposta-consolidada.md`, `conversa-loop.md`, `handoff-session.md`, `PLAN.md`. The 5 smoke tests and 55 social-detector tests continue to pass unchanged.

---

## Discovery signals

**None.** Implementation maps cleanly to design.md. Stable IDs from farol (`.specs/ARCHITECTURE.md` § Camada produto) all exercised via existing edges:
- `catalog → catalog-yaml-files (load)` — loader.ts reads `config/skills/*.yaml`
- `catalog → embedding-model (encode)` — embedder.ts interface consumed
- `catalog → sqlite (write)` — writer.ts writes via schema.ts

No new component or edge introduced. Topology unchanged.

---

## Ranked gaps

1. **Scope-guard violation** — commit `d441e05` (Phase 3 brief) sits inside the Phase 2 git range.
   - Fix: orchestrator should ask the Implementation author either to `git rebase -i 3f3cf60~1` to drop `d441e05`, or to escalate to human whether interleaving Phase 3 docs commits into the Phase 2 verification branch is sanctioned. The Phase 2 code itself is not at fault.

No other gaps. All 20 ACs met with file:line + test-name evidence; all gates pass; tests are spec-anchored not implementation-mirroring.
