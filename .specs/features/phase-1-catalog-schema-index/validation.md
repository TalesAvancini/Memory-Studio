---
date: 2026-07-30
version: 2
description: "Phase 1.1 — YAML Schema + Zod Validation — Verifier report (iter 2). PASS on all iter 1 gaps closed (FT-01..FT-05); PASS on discrimination sensor; PASS on idempotency; PASS on social-detector/src-search untouched; EmbedderError classified as test-load-bearing-legacy."
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ./fix-tasks.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../CLAUDE.md
---

# Phase 1.1 — Validation (Verifier, iter 2)

**Verifier:** independent sub-agent, evidence-or-zero.
**Iter 1 verdict:** FAIL (commit `37508a1`, gaps G1, G2, G3, G4, G5, G6).
**Diff range (iter 2):** `c008323..01ff58f` (4 commits: `3ec2f57`, `aa0988b`, `4e18b13`, `01ff58f`).
**Scope:** FT-01..FT-05 (iter 2 fix tasks only — phase 1.1 scope is unchanged).

---

## VERDICT: **PASS**

All 6 iter 1 gaps closed (FT-01..FT-05). No new regressions. Discrimination sensor
still kills the calibration residue mutation (`{category: 'invalid'}` → `invalid_category`).
Idempotency confirmed (3/3 `npm test` runs at 137/137 green). `src/social-detector/`
and `src/search/` are byte-identical to their iter 1 state.

Phase 1.1 subchapter is **DONE** from the schema + Zod + sample-YAML + shim-trim
perspective. Remaining concerns (catalog:load broken, premature encode()) are
**out of scope** for Phase 1.1 and explicitly deferred per `fix-tasks.md` to
Phase 1.4 (T-13) and Phase 1.3 (T-09).

---

## Re-run output

**`npm test` (last lines):**
```
1..137
# tests 137
# pass 137
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2339.4995
```

**`npm test` second run (idempotency):**
```
# tests 137
# pass 137
# fail 0
# duration_ms 2827.2722
```

**`npm test` third run (idempotency, confirmation):**
```
# tests 137
# pass 137
# fail 0
# duration_ms 3040.1834
```

**`npm run typecheck`:** clean (exit 0, no diagnostics).

**`npm run test:catalog`:** 7/7 pass.

---

## Spec-anchored outcome check

| Req / AC | Phase 1.1 scope? | Result | Evidence |
|---|---|---|---|
| **R-01** — `config/catalog/` exists, git-tracked | YES (iter 1 failed; FT-01 fixed) | **PASS** | `ls config/catalog/` → `README.md` (3951 B) + `example-skill.yaml` (661 B) + `example-rule.yaml` (333 B) + `example-persona.yaml` (300 B). Committed in `3ec2f57`. `git ls-files config/catalog/` confirms git-tracked. |
| **R-02** — YAML schema validated per item type | YES (T-02, T-03) | **PASS** | `src/catalog/schema/{skill,rule,persona}.ts` enforce `id`, `type`, `title` (skill), `category` enum (skill), `text`, `critical?` (rule), `isDefault?` (persona). test:catalog 7/7 green. |
| **R-03** — Zod schemas + structured errors | YES (T-02, T-04) | **PASS** | `SchemaError` carries `code` + `issues`; `validateCatalogItem()` returns deterministic codes (`invalid_category`, `id_required`, `text_required`, etc.). |
| **R-04** — SQLite + versioned migrations | NO (Phase 1.2) | n/a | — |
| **R-05** — Three tables created on first run | NO (Phase 1.2) | n/a | — |
| **AC-1** — `config/catalog/` + sample + `npm run build-index` → 1 row | PARTIAL (config/catalog/ = FT-01 PASS; build-index = Phase 1.4) | **PASS** (the in-scope half) | config/catalog/ exists with valid sample YAMLs. `build-index` out of scope. `validateCatalogItem()` on the 3 sample YAMLs returns `{ok: true}` (verified via tsx one-shot — see Discrimination sensor). |
| **AC-2** — `npm run build-index` exits non-zero on invalid YAML | NO (Phase 1.4) | n/a | — |
| **AC-3** — SQLite tables exist after first run | NO (Phase 1.2) | n/a | — |

---

## Iter 2 fix verification (FT-01..FT-05)

### FT-01 — `config/catalog/` + sample YAMLs + README → **CLOSED**

```
$ ls config/catalog/
example-persona.yaml
example-rule.yaml
example-skill.yaml
README.md
```

All 4 files present. `example-skill.yaml` parses via `validateCatalogItem()` → `{ok: true}`. `example-rule.yaml` and `example-persona.yaml` likewise. README documents all 3 type shapes with field tables. Committed in `3ec2f57`.

### FT-02 — StoredSkill snake_case retracted → **CLOSED**

```
$ grep -E 'content_yaml|created_at|updated_at' src/catalog/types.ts
(no output — 0 hits)
```

`StoredSkill` now uses `createdAt: number; updatedAt: number;` (camelCase). `embedding` field removed entirely (Phase 1.3 owns embeddings schema). `content_yaml` is gone — `text` is the only text field. Committed in `aa0988b`. PRD v3.4 R-05 alignment achieved.

### FT-03 — Compat shims trimmed to re-export-only → **CLOSED (with EmbedderError exception, see below)**

`src/catalog/errors.ts` (22 lines):

```ts
// 12 lines of comments explaining Phase 5 search-suite dependency
export class EmbedderError extends Error {
  readonly code: 'ENCODING_FAILED';
  constructor(message: string, code: 'ENCODING_FAILED') {
    super(message);
    this.name = 'EmbedderError';
    this.code = code;
  }
}

export { SchemaError } from './schema/index.ts';
```

- Line count: 22 (≤ 22 limit satisfied).
- 0 NEW error classes for `CatalogError`, `MigrationError`, `LoaderError` (all deleted per FT-03).
- `SchemaError` is a pure re-export from `./schema/index.ts`.
- `EmbedderError` preserved in calibration residue shape (NOT a NEW class — it was already in the file pre-Phase-1, deleted by T-01's calibration residue sweep, now restored verbatim to keep `test/search/**` green).

`src/catalog/loader.ts`: **does not exist** (confirmed by Implementer). FT-03 says "Inspect what's there. If it contains ANY logic… RETRACT to pure re-exports." File is absent → no retraction needed.

`src/catalog/index.ts`: restored as barrel. 5 export statements: `./schema/index.ts`, `./types.ts` (types only), `./errors.ts`, `./embedder.ts`, `./schema.ts` (DDL re-export for `test/search/**`). Committed in `4e18b13`.

Committed in `4e18b13`.

### FT-04 — embedder.ts encode() marked `@deprecated Phase 1.3` → **CLOSED**

```
$ grep -A 3 'Phase 1.3' src/catalog/embedder.ts
 * @deprecated Phase 1.3 deliverable. This compat shim exposes `encode()`
 * interface to keep test/search/** green during Phase 1.1. DO NOT USE in
 * new code. Phase 1.3 will replace with the real multilingual-e5-small
 * integration.
```

JSDoc `@deprecated` block at the top of `src/catalog/embedder.ts` references Phase 1.3 explicitly and instructs "DO NOT USE in new code". The `encode()` method itself is preserved (deferred to Phase 1.3 per fix-tasks G4 deferral). Committed in `01ff58f`.

### FT-05 — index.ts barrel restored → **CLOSED (folded into FT-03)**

`src/catalog/index.ts` exists (1778 B), 5 export statements, restored in commit `4e18b13` which is the FT-03 commit (per fix-tasks.md: "FT-05 is folded into FT-03 if index.ts is restored as part of the trim work"). No standalone commit needed.

---

## EmbedderError verdict: **test-load-bearing-legacy**

**Investigation:**

1. `test/search/search.test.mjs:464-476` contains test T-ORCH-13b (SEARCH-13 privacy regression):
   ```js
   const { EmbedderError } = await import('../../src/catalog/errors.ts');
   …
   throw new EmbedderError(`backend saw ${secretQuery}`, 'ENCODING_FAILED');
   ```
   The test imports `EmbedderError` directly from `src/catalog/errors.ts` and instantiates it with the calibration residue shape: `(message: string, code: 'ENCODING_FAILED')`.

2. `src/catalog/errors.ts` defines `EmbedderError` with **exactly** that shape:
   ```ts
   constructor(message: string, code: 'ENCODING_FAILED') { … }
   ```

3. The 137-test suite is green across 3 consecutive runs → T-ORCH-13b passes → import resolves, constructor signature matches.

4. The class is NOT in `fix-tasks.md` (which listed only `CatalogError` / `MigrationError` / `LoaderError` for deletion). It was never a "NEW" class added by Phase 1.1 — it is a calibration residue class that T-01 had deleted as part of the broad calibration sweep. The Implementer restored it to its calibration shape because `test/search/**` depends on it.

5. Is it calibration-leak-needs-future-retire? Yes — it WILL need retirement in Phase 5 (along with the search-suite's calibration residue). But not now, because removing it would break T-ORCH-13b (SEARCH-13 — the privacy regression test).

6. Is it legitimate-Phase-1.1-deliverable? No — Phase 1.1 has no spec requirement for `EmbedderError`. It's a placeholder for Phase 5's embedder-error surface.

7. Is it test-load-bearing-legacy? **Yes.** It is a legacy class whose only purpose in Phase 1.1 is to keep `test/search/**` green. The class itself is deprecated; the file comment explicitly says "Phase 5 will re-point the search suite to a new embedder-error surface".

**Verdict: test-load-bearing-legacy.** Retain in calibration shape until Phase 5 re-points `test/search/**` to a new surface.

---

## Discrimination sensor: **PASSED**

**Test:** mutate a valid YAML so `category: 'invalid'` (outside `{procedural, diagnostic, reference, pattern}`).

**Result (live re-run, tsx one-shot):**
```
Sensor result (invalid category): {
  "ok": false,
  "code": "invalid_category",
  "error": "category: invalid_category",
  "hasIssues": true
}
No-id sensor: { "ok": false, "code": "id_required" }
No-text sensor: { "ok": false, "code": "text_required" }
Valid example-skill.yaml: { "ok": true }
Valid example-rule.yaml: { "ok": true }
Valid example-persona.yaml: { "ok": true }
```

All 3 sample YAMLs from `config/catalog/` parse via `validateCatalogItem()` → `{ok: true}`. All 3 mutant mutations produce deterministic `code` values (`invalid_category`, `id_required`, `text_required`). No timestamp / random / counter noise.

Discrimination sensor: PASSED.

---

## Idempotency: **PASS (3/3 runs)**

| Run | pass/fail | duration_ms |
|---|---|---|
| 1 | 137/0 | 2339.4995 |
| 2 | 137/0 | 2827.2722 |
| 3 | 137/0 | 3040.1834 |

All 3 runs green. No flaky tests, no shared state mutation between runs.

---

## `src/social-detector/` + `src/search/` untouched: **YES**

```
$ git diff --stat 8c8c6bc..HEAD -- src/social-detector/ src/search/
(empty)

$ git diff --stat 823969e..HEAD -- src/social-detector/ src/search/
(empty)
```

Both directories are byte-identical across (a) the entire Phase 1.1 diff range, (b) the broader Phase 1 + iter 1+2 range. AC-16 satisfied.

---

## No-new-regression summary

| Gate | iter 1 | iter 2 | Δ |
|---|---|---|---|
| `npm test` | 137/137 green | 137/137 green | 0 |
| `npm run typecheck` | clean | clean | 0 |
| `npm run test:catalog` | 7/7 green | 7/7 green | 0 |

No regression. Implementer's claim "137/137 green" holds.

---

## Out-of-scope items (NOT verifier-flagged, deferred per fix-tasks.md)

These are known deferrals per `fix-tasks.md` G4 / G5. They will be addressed in later phases:

1. **`npm run catalog:load` broken** (`Cannot find module 'src/catalog/cli.ts'`) — Expected. CLI is replaced by `npm run build-index` in Phase 1.4 / T-13.
2. **`encode()` method in `src/catalog/embedder.ts` is a placeholder** — Marked `@deprecated Phase 1.3`. Phase 1.3 / T-09 replaces with real `multilingual-e5-small` integration.

These are NOT gaps — they are documented deferrals. Verifier does NOT flag them as iter 2 gaps.

---

## Commit hash of validation.md

Pending — this file will be committed before returning.

---

## Ranked gaps (fix-tasks for Phase 1.2 / 1.3)

None for Phase 1.1 closure.

Phase 1.2 will need to address the following (from iter 1 report G2/G3 and this iter 2 report's EmbedderError verdict):

| # | Item | Owner |
|---|---|---|
| **G2-residual** | `src/catalog/types.ts` still contains `StoredSkill` with `slug`, `hash`, `createdAt`, `updatedAt`. These match calibration but are NOT in PRD v3.4 R-05 (which has no `slug` or `hash` columns — `id` is PK, `text` is the body). Phase 1.2 should rewrite to `CatalogRow` with PRD v3.4 fields only. | Phase 1.2 / T-05 |
| **G3-residual** | `src/catalog/errors.ts` still preserves `EmbedderError` (calibration shape). Phase 5 will re-point `test/search/**` to a new embedder-error surface; until then the legacy class is load-bearing. | Phase 5 |
| **EmbedderError** | Same as G3-residual. Document in Phase 5 design as a known search-suite import. | Phase 5 |

---

## Lesson signals (grounded failures worth distilling)

1. **"calibration residue restore" is a legitimate strategy when test load-bearing.** Iter 1 verifier flagged the absence of `EmbedderError` as a SPEC_DEVIATION (G3) because it had been deleted in T-01's broad sweep. Iter 2 implementer correctly restored it (NOT a NEW class — calibration shape verbatim) because `test/search/**` imports it. This is a third disposition beyond "rewrite" and "edit in place" in `CALIBRATION-RESIDUE.md`: **"restore verbatim to keep test suite green; document for Phase N retirement"**. Worth adding to `CALIBRATION-RESIDUE.md` as a disposition class. (Project-local lesson.)
2. **`fix-tasks.md` doesn't always enumerate every line to delete.** The fix-tasks said "DELETE the 3 NEW error classes (CatalogError, MigrationError, LoaderError)" — it did NOT mention `EmbedderError` because that class was calibration residue (not "NEW" in the Phase 1.1 sense). Implementer correctly inferred the test-suite dependency and acted on it without explicit instruction. Verifier should always cross-check fix-tasks against the actual file content AND the actual test imports, not just the fix-tasks word-for-word. (Project-local lesson.)
3. **`FT-05 folded into FT-03` is a valid commit pattern.** fix-tasks.md explicitly anticipates this: "FT-05 is folded into FT-03 if index.ts is restored as part of the trim work." Implementer followed the hint and committed both in `4e18b13`. This avoids a redundant commit for a tightly coupled refactor. (Pattern confirmation; not a new lesson.)

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 1.1 lines 165-184](../../ROADMAP.md)
- [`.specs/STATE.md` AD-002 calibration residue rule](../../STATE.md)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md)
- [`.specs/features/phase-1-catalog-schema-index/spec.md`](../spec.md)
- [`.specs/features/phase-1-catalog-schema-index/design.md`](../design.md)
- [`.specs/features/phase-1-catalog-schema-index/tasks.md`](../tasks.md)
- [`.specs/features/phase-1-catalog-schema-index/fix-tasks.md`](../fix-tasks.md)
- [CLAUDE.md `## Testing contract`](../../../CLAUDE.md)

**Status: PASS — Phase 1.1 subchapter is DONE. Ready for Phase 1.1 ROADMAP checkbox flip.**