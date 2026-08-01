---
date: 2026-07-31
title: "Orchestrator handoff — tlc-roadmap-loop in mid-flight"
purpose: "Resume state for session compaction / handoff to a fresh Claude session"
audience: "orchestrator agent (post-compaction) + the human user"
---

# Orchestrator Handoff — `tlc-roadmap-loop`

## TL;DR

- **Branch:** `loop/phase-0` (only branch in use; do NOT work on `main`)
- **Mission:** Phase 5a.2 — Retrieval Pipeline — *iter 2 FIX in mid-flight* (Implementer dispatched, awaiting result)
- **Tests baseline:** 266 root + 152 UI + 16 SDK = **~434 tests** (pre-Phase 5a.2 iter 2 fix)
- **Last known good commit (Phase 5a.2 has 1 PASS so far) on Phase 5a.1 baseline:** `9e48501`
- **Latest commit on disk:** `526ddf5` (FT-02 smoke), with iter-2 Implementer still working

## Phase Status (snapshot at handoff time)

| Phase | Status | Commits | Iter |
|---|---|---|---|
| **0** Env Validation | ✅ `[x]` | `218dad1` | 1 |
| **1.1** Schema + Zod | ✅ `[x]` | `ea4bc54` | 2 (1 fix) |
| **1.2** Migrations + FTS5 + vec | ✅ `[x]` | `b49ae4f` | 1 |
| **1.3** Loader + Embedder | ✅ `[x]` | `635778e` | 1 |
| **1.4** build-index + perf | ✅ `[x]` | `4de0632` | 1 |
| **2** Detector + Fingerprint | ✅ `[x]` | `74b4cdc` | 1 |
| **3** SDK Cliente | ✅ `[x]` | `50e887b` | 1 |
| **4.1** UI workspace + state | ✅ `[x]` | `688a507` | 1 |
| **4.2** Skills/Rules/Personas tabs | ✅ `[x]` | `e9189c5` | 1 |
| **4.3** Audit + Settings tabs | ✅ `[x]` | `5718c60` | 2 (1 fix) |
| **4.4** Toggle + perf + responsive | ✅ `[x]` | `d51c408` | 1 |
| **5a.1** Server Foundation | ✅ `[x]` | `5cf6894` | 1 |
| **5a.2** Retrieval Pipeline | ⏳ **iter 2 FIX in progress** | iter 1 was FAIL at `1ff1611`; iter 2 dispatched (FT-01 ✅ `fe07efa`, FT-02 ✅ `526ddf5`, FT-03 pending) | iter 2 of 3 cap |
| 5a.3, 5a.4 | ⏳ | – | – |
| 5b, 6a, 6b, 7a, 7b | ⏳ | – | – |

**8 of 11 main phases DONE** (0 + 1.1-1.4 + 2 + 3 + 4.1-4.4). 3 to go (5a.2-5b + 6a-6b + 7a-7b).

## Current In-Flight

**Phase 5a.2 — Retrieval Pipeline — iter 2 of 3 cap, fix PARTIALLY done (Implementer hit API 429 token limit).**

### Iter 1 RESULT: FAIL (`1ff1611`)

Verifier (`af2476f142c7b70e5`) returned **FAIL** on iter 1 with 3 ranked gaps:

1. **G1 — CRITICAL — Tiebreak D-006 violation**: Implementer's comparator was `b.rrfScore - a.rrfScore` (DESC) primary, slug tiebreak secondary. With randomized scores, byte-string varies with score values. D-006 invariant requires score-INDEPENDENT byte-string determinism. Verifier's 1000-iteration stress failed first iteration ("drift 0").
2. **G2 — High — Server boot smoke probe gap**: Verifier probed port 4200 (which server doesn't bind — it binds 42900-43000). Operational, not regression.
3. **G3 — Medium — Idempotency unconfirmed**: augment tests run once, not twice.

### Iter 2 PARTIAL RESULT: API 429 token limit (Implementer `ae4a8451ab544ebdd` died mid-fix-tasks)

Implementer iter 2 was dispatched but terminated early by **API 429 Token Plan usage limit reached** — the SECOND 429 in this loop session (first was Phase 4.4 dispatch). Credit reset by the user mid-session.

**What was committed before the crash:**
- `fe07efa` — FT-01 tiebreak fix (`slug.localeCompare` primary, `rrfScore` secondary) ✅
- `526ddf5` — FT-02 `scripts/smoke-server-boot.mjs` ✅

**What was being edited at crash (NOT committed):**
- `package.json` — added 1 line: `"test:idempotent": "npm test && npm test"` (FT-03 partial)
- `scripts/smoke-server-boot.mjs` — appears modified but `git diff` returns no content (possibly timestamp/mode only — verify)

**Working tree at handoff (commit `2570f86`):**
```
 M package.json             ← FT-03 pending: `"test:idempotent": "npm test && npm test"` (1 line added)
 M scripts/smoke-server-boot.mjs  ← verify whether content diff or just metadata
 ?? .specs/architecture/custom-farol.html.bak   (untracked, NOT loop work)
 ?? .specs/archive/architeture/                 (untracked, NOT loop work — note: typo "architeture")
 ?? .specs/archive/auto-grill-output/           (untracked)
 ?? UsersUserDesktopAI-ProjectMemory-Studio.claudeagents/   (untracked)
 ?? handoff-orchestrator.md                    (this file — just created, will be committed)
 ?? old_arquive-miscelanea/                    (untracked)
```

### After session compaction (manual or auto), the next session must

1. **Inspect uncommitted FT-03 + smoke file state carefully:**
   - `git diff scripts/smoke-server-boot.mjs` — should be empty (mode only) OR has further edits.
   - `git diff package.json` — should show 1-line `"test:idempotent"` addition (FT-03 partial).
2. **Either:**
   - (a) Commit the partial 1-line addition as `chore(phase-5a.2): add test:idempotent script (FT-03 stub)` and proceed to dispatch Verifier iter 2 (with risk that FT-03 didn't fully complete — e.g., no test for the idempotent script itself).
   - (b) Verify FT-03 is fully done (run `npm run test:idempotent` twice, both must exit 0), then commit + Verifier.
   - (c) If smoke file or other state is unclear, re-dispatch Implementer iter 3 (LAST of cap) with explicit "complete FT-03 + only that, idempotent script for npm test twice" instructions.
3. **If Verifier iter 2 returns PASS**: Step 8 PASS branch — flip Phase 5a.2 `[ ]` → `[x]`, update `STATE.md ## Handoff`, commit, dispatch Implementer Phase 5a.3.
4. **If Verifier iter 2 returns FAIL** (iter 3 of cap = last attempt): escalate to user. Use the lesson log to capture the failure pattern.

## API 429 Pattern (NEW lesson signal — consider saving as L-007)

- **Pattern**: Implementer/Planner agent dispatched mid-task → API 429 token limit reached → agent terminates early, working tree has uncommitted partial work.
- **Observed**: 2x in this session (Phase 4.4 dispatch, Phase 5a.2 iter 2).
- **Recovery**: User must manually reset credits. Working tree inspection shows partial commits.
- **Recommended orchestration response** (post-L-006 lesson):
  - Don't dispatch new sub-agents after a 429 without user confirmation.
  - Wait for user signal "credits reset" before re-dispatching.
  - When token limit is hit DURING work, check working tree and resume from where it stopped (don't restart from scratch).

## Resume Instructions (post-compaction)

When the next session starts:

1. **Read `STATE.md ## Handoff`** to learn current phase pointer.
2. **Read `.specs/features/phase-5a-api-retrieval/validation-phase-5a.2.md`** to see iter 1 Verifier FAIL details.
3. **Read `.specs/features/phase-5a-api-retrieval/fix-tasks-phase-5a.2.md`** to see what the iter 2 was trying to do.
4. **Read this handoff** (you're reading it now) for context.
5. **`cd C:\Users\User\Desktop\AI-Project\Memory-Studio`** + `git checkout loop/phase-0`.
6. **Check working tree carefully:**
   - `git log -10 --oneline` — see commit chain.
   - `git status --short` — see if uncommitted changes remain from interrupted Implementer.
   - `git diff` package.json + scripts/smoke-server-boot.mjs — verify state of FT-03.
7. **Inspect & commit FT-03 if not yet committed**, then dispatch Verifier iter 2.

## Skill Warnings (L-007 candidate)

The `tlc-roadmap-loop` SKILL.md (`.claude/skills/tlc-roadmap-loop/SKILL.md`) has hard cap of 3 fix→re-verify iterations per phase. Phase 5a.2 currently at iter 2 — has iter 3 budget remaining. Don't go beyond iter 3 — escalate to user.

## End of Handoff

When resuming:
1. **State pointer:** Phase 5a.2 iter 2 fix — PARTIAL (FT-01 ✅ FT-02 ✅ FT-03 uncommitted); Verifier iter 2 awaiting after FT-03 commit.
2. **Next dispatch:** Verifier Phase 5a.2 (after FT-03 commit). Implementer already-overdue. User credit reset allowed new dispatch.
3. **Branch:** `loop/phase-0`
4. **Tests baseline:** 434 (pre-iter-2-fix; 5a.2 iter 2 fixes should preserve this)
5. **Mission:** close Phase 5a entirely (5a.2 → 5a.3 → 5a.4), then Phase 5b, then 6a/6b/7a/7b.

If anything looks broken post-compaction (commits don't match, working tree dirty for unknown reasons), prefer "stop and ask the user" over guessing. The loop is autonomous but not sacred — the human decides if something looks wrong.

## Architecture / Conventions

### Critical Conventions (NEVER violate)

1. **NEVER** run dispatches to sub-agents that aren't the right role. Implementer runs code, Verifier audits. Don't mix.
2. **NEVER** fix code yourself as orchestrator. Dispatch Implementer. The 1-line enum extension in Phase 4.3 iter 2 was authorized scope expansion, NOT "orchestrator fixes code".
3. **NEVER** touch `.claude/settings.json` (peer's request or otherwise). Treat as local-only.
4. **NEVER** commit secrets, `.env.*` files, or `.claude/` config.
5. **L-003 discipline:** Phase boundary modifications to root `package.json` are risk-laden. When adding workspace deps or scripts, verify `git diff` shows ONLY the additive lines before committing.
6. **L-006 discipline:** dispatch assertions about expected behavior can be wrong. Read actual code (`scripts/build-index.ts` has `printHelp` documenting exit codes; `src/fingerprint/` has golden vectors; `.specs/features/<phase>/{spec,design,tasks}.md` are authoritative). When dispatch and design.md disagree, **design.md wins**.

### Lesson Log (`scripts/lessons.py add --feature <feat> --signal <type> --source <file:line> --text <one-line>`)

- **L-001** (Phase 1.2): vec0 ≠ FTS5 trigger syntax — `vec0` rejects `('delete', old, ...)`; use plain `DELETE FROM vec_table WHERE rowid = old.rowid`. FTS5 keep `'delete', old, ...`. See `.specs/lessons.json`.
- **L-002** (Phase 1.4): Windows EBUSY retry-with-backoff (50ms→1000ms, 25 attempts).
- **L-003** (Phase 1.4): residue deletion must update `package.json` scripts in same task.
- **L-004** (Phase 1.4): D-001 §18.x grep needs 2-axis classification (stale section refs vs META documentation of rule itself).
- **L-005** (Phase 3): Implementer "true observation, wrong reason" pattern — verify both observation AND reasoning, not just trust either.
- **L-006** (Phase 3, 4.4, 5a.1, 5a.2): dispatch assertions can be wrong. Read design.md / spec.md / code before claiming contracts to sub-agents. **Most-recent application: Phase 5a.2 iter 1 Implementer chose score-then-slug tiebreak despite dispatch prompt saying reverse — Verifier caught the real bug.**

**Effective practice after Phase 5a.2:** when writing dispatch prompts for the loop, NEVER instruct "PASS test X looks like Y" — instead, say "verify X via reading `path/to/code`" or "read `design.md` §X for the contract".

### Subchapter Pattern (4 sub-phases of Phase 1, 4 of Phase 4, 4 of Phase 5a)

When Planner returns SUBCHAPTER_BREAKDOWN, orchestrator inserts sub-phase entries in `.specs/ROADMAP.md` between parent and next sibling, all `[ ]`, depending on parent. Then dispatches Implementer per sub-phase. Parent phase is annotated "Completed via subchapters 1.1, 1.2, ..." but never marked `[x]` directly — subchapter entries are the verification record.

### Fast Feedback (Waldemar #1) — Test Wall Time

`npm test` baseline wall time: **3-4s** (after Phase 1.1 fix: `node --test test/**/*.test.mjs` instead of recursive `--test`). Don't break this. If gate exceeds 10s, optimize.

## Spec Documents (the loop's source of truth)

| Path | Use |
|---|---|
| `.specs/ROADMAP.md` | Phase ordering + done criteria (input to Planner) |
| `.specs/STATE.md` | Phase pointer (`## Handoff`) + decisions (`## Decisions` append-only) — orchestrator's primary read |
| `.specs/LESSONS.md` | Generated from `lessons.py` store |
| `.specs/features/<phase>/spec.md` | Per-phase spec |
| `.specs/features/<phase>/design.md` | Per-phase design rationale |
| `.specs/features/<phase>/tasks.md` | Per-phase atomic tasks with verification commands |
| `.specs/features/<phase>/validation-phase-<X>.md` | Per-phase Verifier report |
| `.specs/features/<phase>/fix-tasks-phase-<X>.md` | Per-phase Verifier-FAIL fix task list (when applicable) |
| `.specs/architecture/memory-studio.architecture.json` | Farol stable IDs for design.md `## Architectural Reference` |
| `.scratch/memory-studio/spec.md` | SPEC v2 — 70+ user stories, 20+ impl decisions |
| `PRD.md` | Product spec — every "PRD §X" reference points here |
| `CLAUDE.md` | Testing contract, authority boundaries, gates |

## Code Touch Surface Map (phases layered cleanly, do NOT regress)

| Layer | Phase | State |
|---|---|---|
| `scripts/verify-env.mjs` | 0 | ✅ locked |
| `config/catalog/` (YAML samples) | 1.1 | ✅ locked |
| `src/catalog/{schema,migrations,db,embedder,loader,version}` + `src/catalog/index.ts` | 1 | ✅ locked; reuse, don't modify |
| `src/social-detector/{social,types,index}.ts` | 2 | ✅ locked |
| `src/fingerprint/{hash,fingerprint,types,index}.ts` | 2 | ✅ locked |
| `packages/sdk/` (workspace) | 3 | ✅ locked |
| `packages/ui/` (workspace) + `scripts/ui-server.mjs` | 4 | ✅ locked |
| `src/server/{boot,index,schema,augment,logger,health}.ts` | 5a.1, 5a.2 | in-flight (5a.2 is iter 2 fix) |
| `src/augment/*` or `src/server/augment/*` (per design.md) | 5a.2+ | in-flight |

**Calibration residue that's INTENTIONAL & locked:**
- `src/search/{fts,rrf,schema,vector,types,errors,search}.ts` — `src/search/*` is REUSE-ONLY per CALIBRATION-RESIDUE.md. Don't modify, only import.
- `src/social-detector/is-social.ts` deleted in Phase 2 (it was promoted to `social.ts`).

## Personas & Roles (mental model for the orchestrator)

- **Planner**: dispatches once per phase (or per subchapter when split). Produces spec.md, design.md, tasks.md. NEVER writes code.
- **Implementer**: dispatches once per (sub)phase. Atomic commits. NEW strategies only when scope is expanded by orchestrator (e.g. Phase 4.3 iter 2 STEP A for `state.ts`).
- **Verifier**: dispatches once per (sub)phase AFTER Implementer reports done. Validates against spec.md / tasks.md / design.md. Re-runs gates. Author ≠ Implementer — fresh context.
- **Orchestrator (you/me)**: NEVER write code (except for 1-line enum-style scope-expand authorizations). Read sub-agent outputs, dispatch next, handle verdicts, file lessons.

## Resume Instructions (post-compaction)

When the next session starts:

1. **Read `STATE.md ## Handoff`** to learn current phase pointer.
2. **Read `.specs/features/phase-5a-api-retrieval/validation-phase-5a.2.md`** to see iter 1 Verifier FAIL details.
3. **Read this handoff** (you're reading it now) for context.
4. **`cd C:\Users\User\Desktop\AI-Project\Memory-Studio`** + `git checkout loop/phase-0`.
5. **Check current state:**
   - `git log -10 --oneline` — see commit chain.
   - `git status --short` — see working tree state.
   - The Implementer iter 2 may have:
     - (a) finished: working tree clean, all commits present, awaiting next dispatch
     - (b) still running: working tree has uncommitted changes from in-flight FT-03
     - (c) failed: working tree has uncommitted partial changes from a crash
   - In cases (b) or (c): consider re-dispatching Implementer or completing manually.
6. **If all FT-01/02/03 committed:** dispatch Verifier iter 2 (template: see prior dispatch for Phase 5a.2 Verifier). Use `subagent_type: "general-purpose"`.
7. **If Verifier PASS:** step 8 PASS branch (flip `[x]`, update STATE.md, commit, dispatch Implementer 5a.3).
8. **If Verifier FAIL (iter 3 of cap = last attempt):** escalate to user.

## Files NOT to touch

The working tree will show 5 untracked items. **DO NOT touch these**:
- `.specs/architecture/custom-farol.html.bak`
- `.specs/archive/architeture/` (note: `architeture`, not `architecture` — pre-existed untracked)
- `.specs/archive/auto-grill-output/`
- `UsersUserDesktopAI-ProjectMemory-Studio.claudeagents/` (sessions metadata)
- `old_arquive-miscelanea/`

These are leftover from previous sessions / pre-loop baseline. Not part of the work product.

## End of Handoff

When resuming:
1. **State pointer:** Phase 5a.2 iter 2 fix — Implementer dispatched
2. **Next dispatch:** Verifier Phase 5a.2 (after Implementer returns)
3. **Branch:** `loop/phase-0`
4. **Tests baseline:** 434 (pre-iter-2-fix)
5. **Mission:** close Phase 5a entirely (5a.2 → 5a.3 → 5a.4), then Phase 5b, then 6a/6b/7a/7b.

If anything looks broken post-compaction (commits don't match, working tree dirty for unknown reasons), prefer "stop and ask the user" over guessing. The loop is autonomous but not sacred — the human decides if something looks wrong.
