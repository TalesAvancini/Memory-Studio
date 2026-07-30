---
date: 2026-07-30
version: 1
type: per-project-state-doc
description: "Per-project Memory Studio state — directory layout, state.json schema, environment expectations."
explanation: |
  This file is the human-readable companion to `.memory-studio/state.json` and
  documents the on-disk layout the loop expects. The loop reads `state.json`
  (machine) and the human reads this file.

  Created 2026-07-30 as part of tlc-roadmap-loop readiness (handoff v6
  Marco 27). Lives in `.memory-studio/` per project — never committed
  unless the human explicitly opts in (PRD §14.5).
related:
  - ../../CLAUDE.md
  - ../../PRD.md
  - ../../.specs/ROADMAP.md
  - ./state.json
---

# Memory Studio — Per-Project Setup

**Project:** `Memory-Studio` (root: `C:\Users\User\Desktop\AI-Project\Memory-Studio`)
**Era:** `2026-07-foundation-complete → 2026-08-prd-v3-ready`
**Status:** ready for `tlc-roadmap-loop` Phase 0.

---

## Directory layout

```
.memory-studio/
├── setup.md           ← this file
├── state.json         ← toggle state + thresholds (machine-owned, editable by /state/toggle)
└── (audit/)           ← Phase 5b writes here (D-007 async buffer, batch flush, fail-open)
```

Per PRD §14.5: state lives per-project. The directory is **not** committed unless the human adds it to git (it is currently untracked). The `.gitignore` blocks `data/` (SQLite + ONNX cache, ~1GB) and `models/` (ONNX weights) so neither runtime data nor models leak into commits.

---

## state.json schema (Phase 1 default)

Created from `PRD.md §10.4`, `PLAN.md Phase 1 done criteria`, `ROADMAP.md Phase 1 thresholds`:

```json
{
  "schemaVersion": 3,
  "activeCatalog": [],
  "thresholds": {
    "minCosineSimilarity": 0.6,
    "minFtsHits": 2
  },
  "fastAgent": {
    "model": "MiniMax-M2.7-highspeed",
    "baseURL": "https://api.minimax.io/anthropic"
  },
  "integrationMode": "proxy",
  "agentId": "claude-code",
  "ui": {
    "portRange": [41823, 42823],
    "stack": "htmx+alpine"
  }
}
```

These are **initial values**, not tuned. Phase 7a (Empirical Tuning) re-tunes from real session data.

---

## Environment expectations (Phase 0 verify-env.mjs)

Six checks the loop runs in `scripts/verify-env.mjs` before Phase 1 starts:

| # | Check | Source |
|---|---|---|
| 1 | `node --version` returns v22.x LTS | ROADMAP Phase 0 done #1 |
| 2 | `onnxruntime-node` install succeeds | ROADMAP Phase 0 done #2 (Windows has friction) |
| 3 | SQLite FTS5 compiled (`PRAGMA compile_options` shows `ENABLE_FTS5`) | ROADMAP Phase 0 done #3 |
| 4 | sqlite-vec loads (`SELECT vec_version()` returns a string) | ROADMAP Phase 0 done #4 |
| 5 | multilingual-e5-small ONNX downloads and produces a 384d embedding | ROADMAP Phase 0 done #5 (one-time 470MB download; local cache persists for Phase 1+) |
| 6 | Write test to `.memory-studio/state.json` succeeds with correct permissions | ROADMAP Phase 0 done #6 |

Expected runtime: **1-2 hours** (ROADMAP Phase 0 estimate). Windows may take longer than Linux/macOS.

---

## Calibration residue — explicit note for the loop

The `src/` directory contains **calibration residue from phases 0-4 of the foundation era** (2026-07-22 to 2026-07-23). It is **not** the target implementation:

- `src/catalog/` (schema, loader, writer, embedder stub, CLI) — calibration testbed. Schema `skills(slug, kind, content_yaml, …)` is v1; PRD v3 expects `catalog`+`embeddings` with `id/type/title/category/text` YAML.
- `src/search/` (FTS5 + sqlite-vec + RRF orchestrator) — calibration testbed. The retrieval *algorithm* (RRF with denoised ranks, threshold gates, sqlite-vec 0.1.9 workarounds) is solid reference material; the *file layout and types* are not the v3 shape.
- `src/social-detector/is-social.ts` — promote candidate. This is the only piece expected to survive largely intact into Phase 2.

**Expected behavior in the loop:**
- **Phase 0** (Environment Validation): does not touch `src/`.
- **Phase 1** (Catalog + Schema + Index): will likely rewrite the catalog module to match PRD v3 schema. The current `src/catalog/**` should be treated as **reference, not load-bearing**. The Planner should be told to start from PRD §6 / SPEC §IMod-6 / calibration `features/schema-and-crud/{spec,design}.md` (in `.specs/archive/2026-07-calibration/`), not from the current `src/catalog/`.
- **Phase 2** (Detector + Fingerprint): promotes `src/social-detector/is-social.ts` and adds the 4-component fingerprint + `sha256[0:16]` hashing. The current social detector's *patterns* are reusable, the file is small.
- **Phase 4+** (UI, Proxy, Fast Agent, etc.): greenfield, no residue to read.

The Verifier should treat `src/` as **legacy calibration material** during the first 2-3 phases. Drift findings that target `src/` files (e.g. "skills table doesn't match PRD v3") are **expected** and should be marked `quarantined` via `lessons.py quarantine <id>` with reason "calibration residue, rewritten in Phase 1", not escalated.

This is consistent with the calibration `STATE.md` archive and handoff v3 line 79 ("6 fixes pendentes aplicadas em PRD/PLAN") — the foundation closed, the residue stays for reference until Phase 1 rewrites it.

---

## First `tlc-roadmap-loop` invocation

```
phase: "Phase 0 — Environment Validation"
ready: true
worktree: clean (origin/main at 7dfd058)
next-step: "scripts/verify-env.mjs passes 6/6 checks, then loop dispatches Phase 1"
```

The loop should:
1. Read `.specs/STATE.md ## Handoff` → see `phase: "Phase 0"`.
2. Read `.specs/ROADMAP.md` → find `#### Phase 0 — Environment Validation [ ]`, no deps.
3. Dispatch Planner with: PRD §8 stack, ROADMAP Phase 0 done criteria, farol stable IDs for `node22` / `sqlite-ext` / `onnx-rt` from `.specs/ARCHITECTURE.md`, this file.
4. Planner produces `.specs/features/phase-0-environment-validation/{spec.md, tasks.md}`.
5. Implementer creates `scripts/verify-env.mjs` per spec.
6. Verifier runs the 6 checks. PASS → flip `[x]` → Phase 1.

---

## Cross-references

- [CLAUDE.md Testing contract](../../CLAUDE.md) — gate commands (`npm test`, `npm run typecheck`, `npm run catalog:load`)
- [PRD.md §10.4](../../PRD.md) — operational acceptance criteria
- [PRD.md §14.5](../../PRD.md) — per-project state location decision
- [PLAN.md Phase 1](../../PLAN.md) — schema versioning policy
- [`.specs/ROADMAP.md` Phase 0](../../.specs/ROADMAP.md) — `scripts/verify-env.mjs` specs
- [`.specs/STATE.md`](../../.specs/STATE.md) — loop reads/writes here
