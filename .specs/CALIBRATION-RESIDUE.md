---
date: 2026-07-30
version: 1
type: calibration-residue-marker
status: active
description: "Marker for the calibration-era source code in src/ — explains what it is, why it stays, and how the loop should treat it."
explanation: |
  Created 2026-07-30 as part of tlc-roadmap-loop readiness (handoff v6
  Marco 27). The calibration source code in src/ + test/ is **not** the
  target implementation of Memory Studio. It is **reference material**
  from phases 0-4 of the foundation era (2026-07-22 to 2026-07-23)
  that taught the loop to drive a real codebase to PASS.

  Per handoff v3 Marco 7-9 and PRD.md §9 (north star: "Memory Studio é
  objetivo final. Skill = fundação. Phases 0-4 = calibração. NÃO
  construir Memory Studio sem autorização."), the calibration source
  is intentional residue that survives into the PRD v3 era as
  **reference for the Implementer**, not as the code to be modified.

  This file is the single anchor the Verifier should read before
  flagging any `src/**/*.ts` file as drift in the first 2-3 phases.
related:
  - ../../CLAUDE.md
  - ../../PRD.md
  - ../../History.md
  - ../../handoff-session.md
  - ../../archive_handoff/handoff-session-2026-07-23.md
  - ../../archive_handoff/handoff-session-2026-07-23-post.md
  - ../../.specs/archive/2026-07-calibration/
  - ../../.memory-studio/setup.md
---

# Calibration residue — `src/` is reference, not target

## TL;DR

`src/catalog/**`, `src/search/**`, `src/social-detector/**`, and the matching test files are **calibration testbed from the 2026-07-22 foundation era**. They are not the implementation of Memory Studio per PRD v3.4. The Verifier should treat any drift finding on these files during Phase 0, Phase 1, and the early part of Phase 2 as **`quarantined`**, not escalated — they will be either rewritten in-place (Phase 1 catalog) or promoted intact (Phase 2 social detector) as the new phases run.

Do **not** move, rename, or rewrite `src/` files before Phase 1 starts. The 185-test green baseline is the loop's fast-feedback guarantee (Waldemar #1); breaking it before the loop's first iteration is strictly worse than the drift risk.

## What is in `src/` and where it came from

The calibration era was a 9-phase roadmap (`.specs/archive/2026-07-calibration/ROADMAP.md`):

| Phase | Spec archive | Status then | Status now | In `src/` today? |
|---|---|---|---|---|
| 1 — Setup | (n/a) | PASS | done | `package.json`, `tsconfig.json`, `src/index.ts` (placeholder) |
| 2 — Schema + CRUD | `features/schema-and-crud/` | PASS | done | `src/catalog/{schema,loader,writer,embedder,errors,cli,types,index}.ts` + tests |
| 3 — Social detector | `features/social-detector/` | PASS | done | `src/social-detector/is-social.ts` + tests |
| 4 — Search / retrieval | `features/search/` | PASS (after recovery) | done | `src/search/{schema,fts,vector,rrf,search,errors,types}.ts` + tests |
| 5 — System message builder | `features/system-message-builder/` | **never executed** | **never executed** | **no code, no tests** |
| 6 — Forwarder | (no spec) | `[ ]` | open | not started |
| 7 — UI mínima | (no spec) | `[ ]` | open | not started |
| 8 — Migration of built-in skills | (no spec) | `[ ]` | open | not started |
| 9 — Test + tuning | (no spec) | `[ ]` | open | not started |

Phase 4 had a famous recovery: the loop got stuck at iter 2 on the T-ORCH-19b fixture (threshold permissive, tie-break not asserted). The recovery brief `brief-m3cli-phase4-recovery.md` (2026-07-23) made 2 surgical test fixes without touching `src/`. Result: 184→185 tests, all green. This is the single demonstration of the loop's recovery path (Sinal 3 strict) and is what the readiness is anchored on.

## What changes in PRD v3 (the gap)

PRD v3 (2026-07-26 → v3.4) introduces a different schema and vocabulary from the calibration code. The deltas:

| Concern | Calibration (current `src/`) | PRD v3.4 (target) | Where in PRD |
|---|---|---|---|
| Table name | `skills` (single) | `catalog` + `embeddings` (split) | §6 / SPEC IMod-1 |
| YAML top-level | `slug`, `kind`, `content`, `extra` | `id`, `type`, `title`, `text` | §6.1-6.3 |
| Skill category | (not modeled) | `category: procedural \| diagnostic \| reference \| pattern` | §6.1 |
| Rule atomicity | (not modeled) | `critical: true` flag | §6.2 |
| Persona default | (not modeled) | `isDefault: bool` | §6.3 |
| Audit events | `id, ts, tenant_hash, event_type, payload` | `+ fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash` | §10.3, ROADMAP Phase 2 |
| Hash columns | `hash TEXT UNIQUE` on skills | schema versioning + `schemaVersion: 3` exposed in API | §6.4 / §10.4 |
| Embedder | DeterministicStubEmbedder (calibration-allowed) | multilingual-e5-small ONNX, 384d (real, swapped in Phase 1 via the same `Embedder` interface) | §8 / §16.4 |
| Embedding storage | `BLOB` (correct) | `BLOB` (same — calibration got this right) | PRD doesn't change |
| Indexes | FTS5 + vec0 (correct, with sqlite-vec 0.1.9 workarounds) | same (calibration got this right) | §8 |
| Social detector | `isSocial()` (correct) | same | §8 invariant 6 |
| Fingerprint | (not implemented) | 4-component (projectPath, agentId, sessionId-hashed, gitBranch) | §5, §10.3 |

The good news: the **algorithms** (RRF with denoised ranks, sqlite-vec 0.1.9 PK binding workaround, NFC normalization in loader, deterministic stub embedder) are reference-quality. The bad news: the **file layout and types** don't match PRD v3.4.

## How the loop should treat `src/` per phase

| Phase | Treatment |
|---|---|
| Phase 0 (Environment Validation) | Ignore. The phase creates `scripts/verify-env.mjs` only. |
| Phase 1 (Catalog + Schema + Index) | **Rewrite** `src/catalog/**` to PRD v3 schema. The Implementer should read the calibration `features/schema-and-crud/{spec,design}.md` first, then port the *algorithms* (canonical YAML serialization, deterministic stub embedder, hash-keyed idempotency, embedding BLOB round-trip) into a new module that matches PRD §6. Tests in `test/catalog/` get rewritten too. The 185-test count will drop and grow back as Phase 1's tests are added. |
| Phase 2 (Detector + Fingerprint) | **Promote** `src/social-detector/is-social.ts` largely intact. Add 4-component fingerprint, `sha256[0:16]` hashing, and the new audit_events DDL. The calibration test suite (`test/social-detector.test.mjs`) is reusable. |
| Phase 3 (SDK Cliente) | Greenfield. Reads `src/search/types.ts` only for type references (e.g. `SkillKind`, `RankedSkill`). |
| Phase 4+ | Greenfield. `src/search/**` is referenced as reference material for the retrieval algorithm, but the *file layout* will change when the package structure (`packages/server/`) materializes per SPEC §IMod-1. |

## Verifier behavior on `src/` files in the first 3 phases

- **DO** flag semantic drift (e.g. "RRF formula is wrong" or "sqlite-vec query changed") as `critical` or `structural` per the normal rules.
- **DO NOT** flag schema/layout drift (e.g. "table is named `skills` not `catalog`", or "YAML field is `slug` not `id`") as `critical`. These are **expected** and will be addressed in Phase 1. Mark them `quarantined` via `scripts/lessons.py quarantine <id>` with reason `calibration residue, rewritten in Phase 1`.
- **DO** assert that `npm test` and `npm run typecheck` keep passing throughout (Waldemar #1 + #2). If Phase 1's rewrite breaks the test count, that is a real FAIL and must be addressed before flipping the phase checkbox.

## Why not move `src/` to an archive subdirectory

Three reasons:

1. **Waldemar #1 (fast feedback).** Moving the source out of the standard layout requires re-wiring `tsconfig.json` `include: ["src/**/*"]` and the `test/` runner's import paths. That breaks the test green baseline, which is the loop's pre-condition guarantee. Risk > benefit.
2. **The handoff v3 already marks it as residue.** "O código em `src/` é resíduo descartável do exercício" (handoff v3 Marco 7-9). This file extends that marker into a per-file scope for the Verifier.
3. **The Implementer in Phase 1 will rewrite in place anyway.** Per SPEC §IMod-1, the target layout is `packages/{catalog,sdk,server,ui}/` (npm workspaces). Phase 1's first atomic commit will be the new module skeleton. The old `src/catalog/` becomes dead code at that point and can be removed by a follow-up commit (likely Phase 1's last task).

## Where to read the source-of-truth instead of `src/`

For the loop:

- **PRD v3.4** — strategic decisions ("por que X e não Y") — `PRD.md`
- **SPEC v2** — granular + atomic, ready-for-agent — `.scratch/memory-studio/spec.md`
- **ROADMAP v5** — phase ordering, deps, done criteria — `.specs/ROADMAP.md`
- **Calibration specs** — for the per-feature spec/design/tasks/validation pattern that the new SPEC was modeled on — `.specs/archive/2026-07-calibration/features/*/`
- **Farol** — runtime architecture (5 modules, 25 components) — `.specs/ARCHITECTURE.md` (text) / `.specs/architecture/memory-studio.html` (visual)

## Cross-references

- [History.md](../../History.md) — north star narrative; phases 0-4 are "calibração" per Marco 7-9
- [handoff-session.md](../../handoff-session.md) v6 — readiness checklist (Marcos 24-27)
- [PRD.md §9](../../PRD.md) — 41-55h estimate for Memory Studio proper
- [`.memory-studio/setup.md`](../../.memory-studio/setup.md) — per-project state and environment expectations
- [`.specs/archive/2026-07-calibration/`](.) — calibration specs and the 9-phase era roadmap
- [archive_handoff/handoff-session-2026-07-23.md](../../archive_handoff/handoff-session-2026-07-23.md) — Phase 4 recovery narrative
