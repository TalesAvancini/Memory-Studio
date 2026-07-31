---
date: 2026-07-31
version: 1
description: "Phase 5a.2 fix-tasks (iter 2). Verifier FAIL on R-11 Tiebreak D-006 plus 2 non-blocking gaps."
explanation: |
  Phase 5a.2 Verifier returned FAIL on iter 1 with 3 ranked gaps:

  - **G1 (CRITICAL)**: Tiebreak D-006 violation. Implementer's code uses
    `b.rrfScore - a.rrfScore` (DESC) as primary comparator, falling to
    `slug.localeCompare()` only when scores are EQUAL. With random RRF
    scores across equivalent items, byte-string varies with score values.
    D-006 requires score-INDEPENDENT byte-string determinism.
    Fix: sort by `slug.localeCompare` as PRIMARY; rrfScore only as
    secondary tiebreak when slugs collide (rare — IDs are stable kebab-case).

  - **G2 (High)**: Server boot smoke probe unconfirmed (Verifier probed
    port 4200, server configures 42900-43000 — Verifier operational gap).
    Add a smoke test that boots `scripts/server-start-with-smoke.mjs` (or
    uses `import.meta.url` programmatic), curls `/health` on the
    actual bound port, asserts 200 + uptime, then kills.

  - **G3 (Medium)**: Idempotency unconfirmed — augment tests run once, not
    twice. Add a 2-pass required run or assert in CI.

  Resolution choices: G1 (CRITICAL) is a code change. G2 (High) is a smoke
  test addition. G3 (Medium) is a CI script.

  Iteration count: 1 → 2 of 3 cap.
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ./validation-phase-5a.2.md
---

# Phase 5a.2 — Fix Tasks (iter 2)

**Source FAIL validation:** commit `1ff1611` on `loop/phase-0`.
**Iteration count:** 1 → 2 of 3 cap.

---

## FT-01 — Fix tiebreak to be score-INDEPENDENT (G1 CRITICAL)

**Where:**
- MODIFY: `src/server/augment/top-k.ts` (or wherever `topKAndTiebreak` lives)
- MODIFY: `test/augment/top-k.test.mjs` — add 1000-iteration stress test asserting score-independent byte-string
- NEW: `test/augment/byte-string-determinism.test.mjs` — dedicated stress test for the full pipeline byte-string

**Scope:**
- Replace Implementer's tiebreak: `if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore; return a.slug.localeCompare(b.slug);`
- With: PRIMARY `a.slug.localeCompare(b.slug)` (or `a.id.localeCompare(b.id)` — slugs/ids must be stable kebab-case per SPEC §IMod-6); SECONDARY `b.rrfScore - a.rrfScore` only when primary returns 0 (rare collision).
- This ensures byte-string order doesn't depend on score magnitudes.

**Why:** D-006 invariant — byte-string determinism independent of score values. With randomized scores, orders were shuffling, hash varied. Real bug.

**Verification commands:**
```bash
# Stress test: 1000 random score perturbations on fixed K=5 set, all byte-strings identical
node --test test/augment/top-k.test.mjs
node --test test/augment/byte-string-determinism.test.mjs
# Compare with validation-phase-5a.2 Verifier scenario:
#   "1 fixed K=5 set + 1000 random RRF scores" — all 1000 must have IDENTICAL systemMessage SHA-256
```

**Commit:** `fix(augmenter): tiebreak is id.primary, score.secondary — byte-string score-independent (FT-01)`

---

## FT-02 — Add boot smoke test (G2 High)

**Where:**
- NEW: `scripts/smoke-server-boot.mjs` — boots server, captures actual bound port, curls `/health`, asserts 200 + uptime > 0 + kills server
- NEW: `test/server/smoke-boot.test.mjs` — runs the smoke script as child process + asserts exit 0 + parses stdout for URL

**Scope:**
- Boosts from Verifier's operational gap: it probed port 4200 (which server doesn't bind) — this smoke uses the actual `npm run server:start` output to find the bound port.
- Smoke is fast (~2s): starts server, waits <3s for boot, parses `Memory Studio augment server: http://127.0.0.1:<port>/`, curls `/health`, asserts response, kills server.

**Why:** Independent server boot + /health probe is fast proof that Phase 5a.1 (server foundation) integrates with Phase 5a.2 (retrieval pipeline) end-to-end. Verifier couldn't probe (used wrong port); this fixes that.

**Verification commands:**
```bash
node scripts/smoke-server-boot.mjs  # should exit 0 + print [PASS]
```

**Commit:** `test(server): boot + /health smoke proves server foundation + retrieval pipeline integration (FT-02)`

---

## FT-03 — Add CI-style 2x idempotency require (G3 Medium)

**Where:**
- MODIFY: `package.json` — add `"test:idempotent": "npm test && npm test"` or similar script
- (Optional) `tools/ci-check.sh` — wraps npm test twice

**Scope:**
- Adds a quick `npm run test:idempotent` script that runs npm test twice. Catches idempotency regressions automatically.
- Optional: integrate into root package.json `scripts.preflight` (NOT a phase scope, but a CI hygiene task).

**Why:** Verifier flagged idempotency as unconfirmed in iter 1. This makes it a single-command check.

**Verification commands:**
```bash
npm run test:idempotent  # both runs must be green + identical counts
```

**Commit:** `chore: add test:idempotent script for CI loop (FT-03)`

---

## Out-of-band checks (Verifier will re-run for iter 2)

- **R-11 Determinism (CRITICAL)**: stress test must show 1000 reqs with random RRF scores → identical systemMessage SHA-256 across all 1000.
- **R-09, R-10, R-12, R-13, R-14**: should still PASS (Implementer didn't touch these).
- **Smoke**: server boot + /health 200 in <2s.
- **Idempotency**: augment tests run twice, identical counts.

---

## NOT in scope for iter 2

- Catalog wiring (production DB + ONNX embedder) — Phase 5a.4 or 5b.
- Port range env var `MEMORY_STUDIO_AUGMENT_PORT_RANGE` — Phase 5a.4 T-13.
- `GET /augment → 405 + Allow: POST` (vs 404) — Phase 5a.4 hardening.
- Cache hi/lo provider wiring (Phase 5b).
