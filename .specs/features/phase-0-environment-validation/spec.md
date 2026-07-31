---
date: 2026-07-30
version: 1
description: "Phase 0 — Environment Validation spec. Smoke gate (scripts/verify-env.mjs) that proves Node 22 + SQLite FTS5+vec + ONNX runtime + multilingual-e5-small + filesystem permissions all work before Phase 1 begins."
explanation: |
  Phase 0 is a pre-flight gate. The deliverable is a single executable script
  (`scripts/verify-env.mjs`) that runs 6 deterministic checks and exits 0
  iff all pass. Each check has a unique acceptance criterion (AC-N) so the
  Verifier can independently confirm pass/fail from the script's output
  (no self-assessment).

  Scope is intentionally small and pre-implementation: it is intended to be
  ran ONCE in the development environment (Windows in this project) before
  Phase 1 starts, to surface setup friction early. The 1-2h estimate comes
  primarily from the multilingual-e5-small ONNX model download (~470MB) and
  Windows-specific onnxruntime-node prebuilt fetch.

  Architectural reference: farol nodes `node22`, `sqlite-ext`, `onnx-rt`
  (Phase 0 module). The script proves these 3 runtime pieces load
  end-to-end before any product code (Phase 1+) depends on them.
related:
  - ../../ROADMAP.md
  - ../../ARCHITECTURE.md
  - ../../../PLAN.md
  - ../../../.memory-studio/setup.md
  - ../../../.specs/STATE.md
  - ../../../CLAUDE.md
---

# Phase 0 — Environment Validation — Spec

**Phase:** 0
**Slug:** `phase-0-environment-validation`
**Source:** `.specs/ROADMAP.md` lines 86-114
**Goal:** guarantee runtime environment supports Node 22 + SQLite FTS5 + sqlite-vec + ONNX runtime + multilingual-e5-small ONNX + filesystem permissions before Phase 1 begins.

---

## Architectural Reference

> Farol nodes consumed by this spec (Phase 0 module — `.specs/ARCHITECTURE.md §Módulo 2`):
>
> - `node22` — Node 22 LTS runtime (ESM, worker_threads habilitado)
> - `sqlite-ext` — SQLite com extensões FTS5 + sqlite-vec compiladas e carregáveis
> - `onnx-rt` — ONNX Runtime via `onnxruntime-node` (build OS-specific)
>
> These three nodes must load end-to-end before Phase 1 can build the runtime catalog index.

**Out of farol scope for this phase:** Phase 1+ product nodes (`augmenter`, `search`, `catalog`, `cache`, `fts5-vec`, `embed-model`, `fast-agent`, etc.). Phase 0 proves the *runtime substrate*; product code comes later.

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | Script `scripts/verify-env.mjs` exists, is executable via Node 22, and is wired into `npm run verify-env` | ROADMAP Phase 0 #7 |
| **R-02** | Script reports a structured per-check result (pass/fail + observed value) and exits 0 only when all 6 checks pass | Verifier independence — evidence-or-zero |
| **R-03** | Check 1: `node --version` returns a string starting with `v22.` (LTS line) | ROADMAP Phase 0 #1 |
| **R-04** | Check 2: `onnxruntime-node` package is installed and its native binary can be `require()`d without throwing | ROADMAP Phase 0 #2 |
| **R-05** | Check 3: opening a better-sqlite3 connection and running `PRAGMA compile_options` returns a row that contains `ENABLE_FTS5` | ROADMAP Phase 0 #3 |
| **R-06** | Check 4: loading `sqlite-vec` extension and running `SELECT vec_version();` returns a non-empty string | ROADMAP Phase 0 #4 |
| **R-07** | Check 5: ONNX `multilingual-e5-small` model downloads (one-time ~470MB cache) and `embedding.encode("test")` returns a `Float32Array` of length **384** | ROADMAP Phase 0 #5 + farol `embed-model` sublabel |
| **R-08** | Check 6: writing `.memory-studio/state.json` succeeds with both create + read-back roundtrip; existing file is preserved if present | ROADMAP Phase 0 #6 |
| **R-09** | Script is idempotent — re-running does not corrupt state, does not re-download ONNX model unnecessarily, and exits 0 in steady state | Operational sanity |
| **R-10** | Script handles each failure with a clear, actionable stderr message naming the failing check and a remediation hint | Verifier-honest pattern (auto-grill L-NNN) |

### Out of scope (explicit non-goals)

- No product code (`src/` untouched in Phase 0 — calibration residue policy applies).
- No tests other than the smoke script itself (the script IS the gate for Phase 0).
- No dependency upgrades or version bumps (Phase 1+).
- No `npm install` of new packages beyond what Phase 1+ already requires.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `node scripts/verify-env.mjs` exits with code 0 |
| **AC-2** | stdout contains 6 lines, each starting with `[PASS]` and the check name in fixed order |
| **AC-3** | stdout includes the observed Node major version (e.g. `v22.x.y`) after the Node 22 check |
| **AC-4** | stdout includes the FTS5 compile flag string (`ENABLE_FTS5`) after the FTS5 check |
| **AC-5** | stdout includes the sqlite-vec version string after the sqlite-vec check |
| **AC-6** | stdout includes the embedding dimension (`384`) after the embedding check |
| **AC-7** | stdout includes a final summary line `6/6 checks passed` |
| **AC-8** | `package.json` has a `verify-env` script that delegates to `scripts/verify-env.mjs` |
| **AC-9** | When ANY check fails, script exits non-zero and the failing check's stderr line names the check + a remediation hint |
| **AC-10** | `.memory-studio/state.json` is not corrupted: if it existed before the run, content is unchanged after; if it did not exist, a minimal valid JSON is written |

---

## Assumptions & Open Questions

| # | Assumption | Why safe | If violated → mitigation |
|---|---|---|---|
| A-1 | The Windows development machine has Node 22 LTS pre-installed | `package.json` `engines.node` is `>=22.0.0`; project already developed on this machine per STATE.md | Check 1 fails with clear "install Node 22 LTS from https://nodejs.org" hint |
| A-2 | `onnxruntime-node` prebuilt binaries are available for Node 22 + Windows x64 | npm registry has prebuilds for this combo; document fallback to `python` build | Check 2 fails with "try `npm rebuild onnxruntime-node --build-from-source`" hint |
| A-3 | multilingual-e5-small ONNX weights can be fetched at runtime via `@huggingface/transformers` (or equivalent) | Hugging Face hosts the model publicly; Phase 1 catalog pipeline will reuse the same loader | Check 5 fails with explicit URL hint |
| A-4 | SQLite FTS5 + sqlite-vec can be loaded as extensions on better-sqlite3 11.x | `sqlite-vec` package is already in `package.json` dependencies | Check 3/4 fail with extension-load hint |
| A-5 | The `.memory-studio/` directory already exists (or can be created) | STATE.md and `.memory-studio/setup.md` confirm it; Phase 0 READ-ONLY policy applies to `state.json` content | Check 6 fails with "create `.memory-studio/` directory" hint |
| A-6 | No need for a separate test suite for Phase 0 — the script is the gate | ROADMAP says "smoke script"; 6 atomic checks already self-validate | If Verifier objects, can add `test/verify-env.test.mjs` later |

---

## Cross-references

- **ROADMAP Phase 0** (lines 86-114) — source of 6 checks + done criteria
- **PLAN.md §Phase 0** (line 308) — estimate 1-2h
- **`.memory-studio/setup.md ## Environment expectations`** — same 6 checks enumerated as runtime pre-reqs
- **`.specs/ARCHITECTURE.md §Módulo 2 — Phase 0`** — farol nodes `node22` / `sqlite-ext` / `onnx-rt`
- **PRD §8** — stack locked (Node 22, Fastify, SQLite + FTS5 + sqlite-vec, multilingual-e5-small)
- **PRD §10.4** — operational acceptance (downstream phases consume Phase 0's PASS)
- **CLAUDE.md ## Testing contract** — `npm test` / `npm run typecheck` / `npm run catalog:load` (Phase 1+, not Phase 0)

---

## Contract with Implementer

- **Single deliverable:** `scripts/verify-env.mjs` (Node ESM script, runnable via `node scripts/verify-env.mjs`).
- **Optional deliverable:** add `"verify-env": "node scripts/verify-env.mjs"` to `package.json` scripts block (recommended for parity with `npm test` etc.).
- **Touch scope:** ONLY `.specs/features/phase-0-environment-validation/` (spec/tasks) + `scripts/verify-env.mjs` (the deliverable) + optionally `package.json` (script wire-up). DO NOT touch `src/`, `.memory-studio/state.json` content (only the script may write to it for AC-10), or any other Phase 1+ file.
- **Atomic commits:** one commit per task (see `tasks.md`).