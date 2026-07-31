---
date: 2026-07-30
version: 1
description: "Phase 1.1 fix-tasks. Iteration 2 of 3 cap. Generated from Verifier FAIL report validation.md (commit 37508a1)."
explanation: |
  Phase 1.1 Verifier returned FAIL on iter 1 with 6 ranked gaps. This file
  is the canonical fix list for iter 2. Decisions on which gaps to fix:

  - **FIX G1 (CRITICAL)**: missing config/catalog/. Clear R-01 / AC-1 violation.
  - **FIX G2 (CRITICAL)**: StoredSkill snake_case fields leak calibration residue.
    Will break Phase 1.2 shim retirement if not retracted now.
  - **FIX G3 (MAJOR)**: shim files contain NEW LOGIC, not pure re-exports.
    Trim to re-export-only.
  - **DEFER G4 (encode() in embedder.ts)**: this is premature Phase 1.3 leakage.
    Add comment "DO NOT USE; Phase 1.3 will replace" but leave code in place
    to avoid scope creep. Verifier may still flag — acceptable trade.
  - **DEFER G5 (catalog:load broken)**: known Phase 1.4 regression. Fix T-13.
  - **FIX G6 (index.ts deleted without replacement)**: small T-11 barrel that
    test/search/** depends on.

  Out-of-scope reminders:
  - Do NOT touch src/social-detector/.
  - Do NOT add DB migrations or embeddings work (Phase 1.2 owns).
  - Do NOT add build-index (Phase 1.4 owns).
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ./validation.md
---

# Phase 1.1 — Fix Tasks (iter 2)

**Source FAIL validation:** commit `37508a1` on `loop/phase-0`.
**Iteration count:** 1 → 2 (cap 3).

---

## FT-01 — Create config/catalog/ directory + sample YAML + README (fixes G1)

**File(s):** `config/catalog/README.md`, `config/catalog/example-skill.yaml`, `config/catalog/example-rule.yaml`, `config/catalog/example-persona.yaml`

**Scope:**
- Create `config/catalog/` directory (R-01 AC-1).
- Write 3 sample YAML files demonstrating valid Skill, Rule, Persona shapes (one per type).
- Write README.md documenting the directory purpose, schema invariants, and how a user adds a new catalog entry.
- Update `package.json` scripts to add `"validate-catalog": "tsx src/catalog/cli.ts validate config/catalog/"` if useful, OR defer until Phase 1.4.

**Why:** R-01 + AC-1 explicitly require `config/catalog/` exist with sample YAML for the YAML Schema + Zod Validation subchapter to be meaningful (without sample YAML, the schemas can't be exercised end-to-end).

**Verification commands:**
```bash
ls config/catalog/                     # must list README + 3 yaml files
cat config/catalog/example-skill.yaml  # must parse via SkillSchema
node -e 'import("./src/catalog/schema/skill.ts").then(m => console.log(m.SkillSchema.parse((require("fs").readFileSync("config/catalog/example-skill.yaml", "utf8")).replace(/---/g, "").trim().split("\n").reduce((a,l,i,arr)=>{if(!l.trim().startsWith("-") && arr[i-1]?.trim()==="---") return a; if(l.trim()==="---") return a; return a.concat(l)},[]).join("\n"))))' 2>&1 | tail -3
# Above parses YAML → TS object. Better: use tsx
npx tsx scripts/parse-example-yaml.ts config/catalog/example-skill.yaml skill
```

**Commit:** `feat(phase-1.1): create config/catalog/ with sample YAML + README (FT-01)`

---

## FT-02 — Retract StoredSkill shim to camelCase per PRD v3.4 (fixes G2)

**File(s):** `src/catalog/types.ts`

**Scope:**
- Replace snake_case fields with PRD v3.4-compliant camelCase:
  - `content_yaml` → `text` (already in SkillRecord)
  - `embedding` → REMOVE (Phase 1.3 owns embeddings schema)
  - `created_at` → `createdAt`
  - `updated_at` → `updatedAt`
  - Keep `slug`, `hash` as-is (already camelCase)
- Add a comment: `// NOTE: This interface is a Phase 1.1 compat shim only. Phase 1.2 will replace with DB-row types.`

**Why:** PRD v3.4 R-05 schema uses `text` (not `content_yaml`). snake_case is a calibration residue leak (calibration `skills(slug, kind, content_yaml, …)` table was v1; PRD v3 uses `catalog` table). If not retracted, Phase 1.2 DB-row types will conflict with this shim.

**Verification commands:**
```bash
grep -E 'content_yaml|created_at|updated_at' src/catalog/types.ts  # must return 0 hits
grep -E 'text:|createdAt:|updatedAt:' src/catalog/types.ts          # must show PRD-compliant fields
npm run typecheck                                                     # must exit 0
```

**Commit:** `refactor(phase-1.1): retract StoredSkill snake_case to PRD v3.4 camelCase (FT-02)`

---

## FT-03 — Trim compat shims to re-export-only (fixes G3)

**File(s):** `src/catalog/errors.ts`, `src/catalog/loader.ts`, `src/catalog/index.ts`

**Scope:**
- `src/catalog/errors.ts`:
  - DELETE the 3 NEW error classes (`CatalogError`, `MigrationError`, `LoaderError`).
  - KEEP only `SchemaError` re-export from `src/catalog/schema/errors.ts` (or wherever Phase 1.1 T-04 put it).
  - File should be `export {SchemaError} from './schema/errors.js';` and nothing else.
- `src/catalog/loader.ts`:
  - Inspect what's there. If it contains ANY logic beyond `export * from './schema/...';`, RETRACT to pure re-exports.
  - Reference: which test files import from `src/catalog/loader.ts`? `grep -r "from.*catalog/loader" test/` and check each one — confirm each import resolves via re-export.
- `src/catalog/index.ts`:
  - Restore the deleted barrel file.
  - Should re-export from all current `src/catalog/**` modules.

**Why:** The Verifier flagged these as "SPEC_DEVIATION — shim files contain NEW LOGIC, not just re-exports". Phase 1.2 needs to retire these as planned. Keeping pure re-exports makes retirement a 1-commit delete.

**Verification commands:**
```bash
# errors.ts must be only re-exports
wc -l src/catalog/errors.ts            # should be ≤ 5 lines
cat src/catalog/errors.ts              # must be only `export {...}` lines
# index.ts must exist
ls -la src/catalog/index.ts            # must exist
# Run full test suite + typecheck
npm test && npm run typecheck          # both must exit 0
```

**Commit:** `refactor(phase-1.1): trim compat shims to re-export-only (FT-03)`

---

## FT-04 — Document DO NOT USE on premature encode() method (defers G4)

**File(s):** `src/catalog/embedder.ts`

**Scope:**
- Add a top-of-file JSDoc comment:
  ```ts
  /**
   * @deprecated Phase 1.3 deliverable. This compat shim exposes `encode()`
   * interface to keep test/search/** green during Phase 1.1. DO NOT USE in
   * new code. Phase 1.3 will replace with the real multilingual-e5-small
   * integration.
   */
  ```
- Do NOT delete the encode() method (would break test/search/**).
- Do NOT add real embedder logic (Phase 1.3 scope).

**Why:** Avoid scope creep on Phase 1.1 by NOT implementing real embedding. Document the premature interface so downstream consumers know it's a placeholder.

**Verification commands:**
```bash
grep -A 3 'deprecated Phase 1.3' src/catalog/embedder.ts  # must show the comment
npm test                                                  # must exit 0
```

**Commit:** `docs(phase-1.1): mark embedder.ts encode() as Phase 1.3 placeholder (FT-04)`

---

## FT-05 — Restore index.ts barrel (fixes G6)

This is folded into FT-03 if index.ts is restored as part of the trim work. If FT-03 does not touch index.ts, do this as standalone:

**File(s):** `src/catalog/index.ts`

**Scope:**
- Restore the deleted index.ts barrel.
- Should re-export from all current `src/catalog/**` modules that need to be public.

**Why:** `test/search/**` may import from index.ts. Verifier flagged it as deleted without replacement.

**Verification commands:**
```bash
ls -la src/catalog/index.ts  # must exist
grep -E "^export" src/catalog/index.ts | head -10  # must show barrel exports
npm test                                              # must exit 0
```

**Commit:** `refactor(phase-1.1): restore catalog/index.ts barrel (FT-05)` — skip if folded into FT-03.

---

## Out-of-band checks (Verifier will re-run independently)

- **Spec-anchored check:** R-01 (NOW PASS expected — config/catalog/ exists with sample YAML); R-02 (still PASS); R-03 (still PASS); AC-1 (NOW PASS); AC-2, AC-3 (still PASS).
- **Discrimination sensor:** re-run with `{category: 'invalid'}` → still rejects with `code: 'invalid_category'`.
- **No new regression:** npm test still 137/137 green; npm run typecheck still clean.
- **G5 (catalog:load broken)** — VERIFIER WILL STILL FLAG; this is expected and will be closed in Phase 1.4 T-13. Don't try to fix in iter 2.

---

## NOT in scope for iter 2

- Building real DB migrations (Phase 1.2).
- Building real embedder with multilingual-e5-small integration (Phase 1.3).
- Restoring `npm run catalog:load` (Phase 1.4 will replace with `npm run build-index`).
- Adding any test that previously existed in calibration residue — those tests are correctly retired with their tested modules.
