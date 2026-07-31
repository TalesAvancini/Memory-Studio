---
date: 2026-07-30
version: 1
description: "Phase 0 atomic tasks. 5 tasks, each with verification criteria, atomic commit, and traceable to spec AC IDs."
explanation: |
  Tasks are designed to fit in ONE batch (≤ ~7 tasks per CLAUDE.md guidance).
  No sub-agent dispatch needed — single Implementer can execute all 5
  inline. Each task has:
    - clear scope (one file or one logical unit)
    - verification command(s) the Implementer must run
    - atomic commit with conventional-commit prefix
    - traceable AC IDs from spec.md
related:
  - ./spec.md
  - ../../ROADMAP.md
  - ../../../.memory-studio/setup.md
---

# Phase 0 — Environment Validation — Tasks

**Source spec:** [./spec.md](./spec.md)
**Branch:** `loop/phase-0`
**Output deliverable:** `scripts/verify-env.mjs` (1 executable script)
**Optional:** `package.json` `scripts.verify-env` entry

---

## Task T-01 — Scaffold script skeleton + Node version check (R-01, R-03, AC-1, AC-3)

**File(s):** `scripts/verify-env.mjs` (new)

**Scope:**
- Create `scripts/` dir if missing
- Write minimal ESM script with a `runChecks()` orchestration pattern + structured stdout formatter (`[PASS] <name>: <observed>` per check + final summary line)
- Implement Check 1 (Node version) using `process.versions.node` (parses the `v` prefix and extracts major)
- Mark all 5 remaining checks as `TODO` placeholder that throws (will be replaced in T-02..T-05)
- Exit non-zero if Check 1 fails; exit 0 only when all pass

**Verification commands:**
```bash
node scripts/verify-env.mjs          # must exit 0 on this machine (Node 22 is installed)
node --version                        # baseline: should start with v22.
echo $?                               # should be 0 after running the script
```

**Commit:** `chore(phase-0): scaffold verify-env.mjs with Node version check (T-01)`

**Trace:** R-01, R-03 → AC-1, AC-3, AC-7 (summary line only)

---

## Task T-02 — Add FTS5 + sqlite-vec checks (R-05, R-06, AC-4, AC-5)

**File(s):** `scripts/verify-env.mjs`

**Scope:**
- Implement Check 3 (FTS5): open `better-sqlite3` `:memory:` db, run `PRAGMA compile_options`, assert output contains `ENABLE_FTS5`
- Implement Check 4 (sqlite-vec): in same (or new) db, `require('sqlite-vec')` and call the loader's `load()` (or equivalent per `sqlite-vec` 0.1.x API), then `SELECT vec_version();` returns a non-empty string
- Replace T-01's TODO for checks 3 and 4 with real implementations
- Keep stdout format `[PASS] check-name: observed-value`

**Verification commands:**
```bash
node scripts/verify-env.mjs 2>&1 | grep -E "(PASS|FAIL).*FTS5"
node scripts/verify-env.mjs 2>&1 | grep -E "(PASS|FAIL).*sqlite-vec"
node scripts/verify-env.mjs          # exit 0
```

**Commit:** `feat(phase-0): add SQLite FTS5 + sqlite-vec checks (T-02)`

**Trace:** R-05, R-06 → AC-4, AC-5

---

## Task T-03 — Add onnxruntime-node check (R-04)

**File(s):** `scripts/verify-env.mjs`

**Scope:**
- Implement Check 2: `require('onnxruntime-node')` (or `await import(...)` if package needs install first — see T-06 fallback)
- Assert the module loads without throwing
- Capture observed value: `ort.env.versions?.common` or similar version string for stdout

**Verification commands:**
```bash
node scripts/verify-env.mjs 2>&1 | grep -E "(PASS|FAIL).*onnxruntime"
node scripts/verify-env.mjs          # exit 0
```

**Commit:** `feat(phase-0): add onnxruntime-node load check (T-03)`

**Trace:** R-04 → AC-2 (structured output)

**Note:** If `onnxruntime-node` is NOT installed, T-03 will fail. The expected fix is `npm install onnxruntime-node` — this is part of the env validation contract per ROADMAP Phase 0 #2. Implementer should add to `package.json` if missing, then re-run.

---

## Task T-04 — Add filesystem write check (R-08, AC-10)

**File(s):** `scripts/verify-env.mjs`

**Scope:**
- Implement Check 6: write test to `.memory-studio/state.json`
  - If file exists, capture original content (sha256)
  - Write a minimal valid JSON `{ "schemaVersion": 3, "_verifyEnvTest": true }`
  - Read back, parse, assert JSON validity
  - Restore original content (or remove the test marker)
- Print observed: `writable, roundtrip OK`
- Handle missing `.memory-studio/` dir by `mkdir` (with explicit hint if mkdir fails)

**Verification commands:**
```bash
sha256sum .memory-studio/state.json  # baseline
node scripts/verify-env.mjs
sha256sum .memory-studio/state.json  # must be identical (content preserved)
cat .memory-studio/state.json        # should be valid JSON
node scripts/verify-env.mjs          # idempotent, exit 0
```

**Commit:** `feat(phase-0): add filesystem write check with state.json preservation (T-04)`

**Trace:** R-08, R-09, AC-10, AC-2

---

## Task T-05 — Add multilingual-e5-small embedding check (R-07, AC-6) + wire package.json (R-01, AC-8)

**File(s):** `scripts/verify-env.mjs`, `package.json` (scripts block only)

**Scope:**
- Implement Check 5: load `multilingual-e5-small` ONNX model via `@huggingface/transformers` `pipeline('feature-extraction', 'Xenova/multilingual-e5-small')` (or equivalent 384d model loader)
- One-time download (~470MB) cached in `models/` or default HF cache
- Call `embedder("test")` and assert result is `Float32Array` of length **384**
- Print observed: `384d embedding produced in Nms`
- Update `package.json` `scripts` block: add `"verify-env": "node scripts/verify-env.mjs"`
- Do NOT add the embedding package as a hard `dependency` if it can be optional — use `devDependency` or document why it's needed at runtime (Phase 1 will use it, so `dependency` is fine — Implementer decides per Phase 1 needs)

**Verification commands:**
```bash
node scripts/verify-env.mjs 2>&1 | grep -E "(PASS|FAIL).*embedding"
npm run verify-env                  # AC-8: must work via npm
# Idempotency: rerun should NOT re-download model
npm run verify-env 2>&1 | grep -i "download\|fetch"
# expected: no "downloading" log on second run (cache hit)
```

**Commit:** `feat(phase-0): add multilingual-e5-small embedding check + npm script (T-05)`

**Trace:** R-01, R-07, R-09, R-10 → AC-6, AC-8, AC-9

---

## Test Coverage Matrix (spec → AC → Task)

| Req ID | Spec statement | AC ID | Covered by Task(s) | Verification |
|---|---|---|---|---|
| R-01 | Script exists + npm wire | AC-1, AC-8 | T-01, T-05 | `npm run verify-env` → exit 0 |
| R-02 | Structured per-check output | AC-2, AC-7 | T-01..T-05 | stdout contains `[PASS]` lines + `6/6 checks passed` |
| R-03 | Node v22.x | AC-3 | T-01 | stdout shows `v22.x.y` |
| R-04 | onnxruntime-node loads | AC-2 | T-03 | stdout shows PASS for onnx |
| R-05 | FTS5 compiled | AC-4 | T-02 | stdout shows `ENABLE_FTS5` |
| R-06 | sqlite-vec loads | AC-5 | T-02 | stdout shows vec version |
| R-07 | 384d embedding | AC-6 | T-05 | stdout shows `384d` |
| R-08 | state.json write + preservation | AC-10 | T-04 | sha256 before/after identical |
| R-09 | Idempotent | AC-1, AC-10 | T-04, T-05 | rerun does not corrupt / re-download |
| R-10 | Failure stderr + hint | AC-9 | T-01..T-05 | manual: kill one check → non-zero + stderr |

---

## Gate Check Commands

```bash
# Required gates (all must pass before considering Phase 0 done)
npm run verify-env                  # AC-1, AC-2, AC-3..AC-7, AC-8
echo "exit code: $?"                # must be 0
sha256sum .memory-studio/state.json # capture before; rerun script; capture after → equal (AC-10)
node scripts/verify-env.mjs 2>&1 | tee /tmp/phase0.log
grep -c "^\[PASS\]" /tmp/phase0.log # must be 6
grep "checks passed" /tmp/phase0.log # must say "6/6 checks passed"

# Anti-regression: rerun twice in a row — must exit 0 both times
node scripts/verify-env.mjs && node scripts/verify-env.mjs && echo "idempotent OK"
```

---

## Out-of-band checks (Verifier will run independently)

- **Spec-anchored check:** every AC-1..AC-10 above has an explicit command; Verifier runs each.
- **Discrimination sensor:** introduce a deliberate failure (e.g. rename `.memory-studio/` temporarily) → script must exit non-zero and name `.memory-studio/` in stderr. Restore after.
- **Diff range:** Implementer's commits T-01..T-05. Verifier reads those 5 commits + spec.md + tasks.md.