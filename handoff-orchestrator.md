---
date: 2026-08-03
title: "Orchestrator handoff — tlc-roadmap-loop mid-flight (T-07 PAUSE)"
purpose: "Resume state for session compaction / credit exhaustion / role handoff"
audience: "orchestrator agent (post-compaction) + the human user + any future agent"
---

# Orchestrator Handoff — `tlc-roadmap-loop`

## TL;DR

- **Branch:** `loop/phase-0` (only branch in use; do NOT work on `main`)
- **Mission:** **ORCHESTRATOR PAUSES FOR T-07 USER-DRIVEN WALL-CLOCK** (≥7 days of real production traffic)
- **Tests baseline:** 533 root + 152 UI + 16 SDK = 701 total (was 478; +55 new tests in 7b.1B)
- **HEAD:** `dd987d8` (handoff update)
- **10 of 11 main phases DONE.** Last phase: **7b** (acceptance gate — awaits user-driven wall-clock validation).

> **Phase 7a CLOSED 2026-08-02.** Verifier PASS at `.specs/features/phase-7a-metrics/validation-phase-7a.md`.
>
> **Phase 7b 7b.1A + 7b.1B + Verifier ALL COMPLETE 2026-08-03.**
> - **Verifier LEAN PASS** at `.specs/features/phase-7b-acceptance-gate/validation-phase-7b.md` (commit `71a137d`).
> - 533/533 root tests PASS (2x stable, zero flake). 152 UI + 16 SDK PASS.
> - All 5 L-006 critical findings RESOLVED with real evidence (not stubs).
> - POC re-run: TOTAL p95 = 0.18ms (≪ 5ms budget).
> - Scope guard: empty (no locked-layer leakage).
> - Verdict format: `PASS — 7b.1 scaffolding; PHASE 7b REMAINS OPEN pending user T-07`
>
> **ORCHESTRATOR PAUSES.** T-07 is user-driven wall-clock evidence (≥7 days, ≥5 sessions, ≥10 turns/session). After T-07, dispatch T-08 (autonomous hydration + state freeze).

## Phase Status (snapshot at handoff)

| Phase | Status | Head Commit | Iter |
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
| **5a.2** Retrieval Pipeline | ✅ `[x]` | `3fe84ba` | 3 (1 critical fix, 1 API 429, 1 Windows cleanup) |
| **5a.3** Tests + Smoke | ✅ `[x]` | `ad8be1c` | 1 |
| **5a.4** Perf + Hardening | ✅ `[x]` | `701a2f2` | 1 |
| **5b.1** Audit Foundation | ✅ `[x]` | `d232927` | 1 |
| **5b.2** Read Endpoints | ✅ `[x]` | `351ca9e` | 1 |
| **5b.3** Write Endpoints + R-06 | ✅ `[x]` | `76b7951` | 1 |
| **5b.4** Transparent Proxy | ✅ `[x]` | `c7e7a8d` | 1 |
| **6a.1** Hot Path POC | ✅ `[x]` | `128e044` | 1 |
| **6a.2** Fast Agent POC | ✅ `[x]` | `72dd709` | 1 |
| **6a.3** Byte-String + AD-006 | ✅ `[x]` | `84d70a1` | 1 |
| **6b.1** Intel Store | ✅ `[x]` | `fbc6c47` | 1 |
| **6b.2** Fast Agent Module | ✅ `[x]` | `fbc6c47` | 1 |
| **6b.3** BuildOptions.intel | ✅ `[x]` | `2a692ac` | 1 |
| **6b.4** Pipeline + Cache Hit | ✅ `[x]` | `bc95558` | 1 |
| **7a** Metrics Instrumentation | ✅ `[x]` | `9024006` | 1 |
| **7b** Empirical Tuning + Acceptance Gate | ⏸️ Open — 7b.1 Verifier PASS, awaiting T-07 user-driven | `dd987d8` (HEAD) | 7b.1 PASS + T-07 PAUSE |

## Current In-Flight

**Phase 7b — Phase 7b.1 (T-01..T-06) scaffolding VERIFIED; ORCHESTRATOR PAUSES for T-07 user-driven wall-clock.**

### 7b.1 Verifier PASS

**Verifier LEAN PASS at `71a137d`. 533/533 root tests PASS twice (stable). All 5 L-006 critical findings RESOLVED with real code evidence:**

| Fix | Verdict | Evidence |
|---|---|---|
| state.json consumed by runAugment | RESOLVED | `production-context.ts:82` → `pipeline.ts:277-281` |
| proxy activeCatalog wired | RESOLVED | `messages-proxy.ts:270-272` reads `runtimeContext.state.activeCatalog` |
| proxy session ID wired | RESOLVED | `deriveSessionIdentity` at `messages-proxy.ts:105-119` (sha256-hashed) |
| proxy exact system forwarding | RESOLVED | `composeForwardedSystem` at `messages-proxy.ts:318` |
| streaming SSE tee | RESOLVED | `src/server/proxy/sse-tee.ts` (276 lines), wired at `messages-proxy.ts:25, 409, 517` |

**4 PRD §10.2 budgets measurable through `/metrics`:**
- `p50_latency_ms`
- `p99_latency_ms`
- `working_set_mb`
- `request_hit_rate` + `token_cache_coverage` (cumulative-per-process)

**POC re-run:** TOTAL p95 = 0.18ms (≪ 5ms budget).

**Scope guard:** empty (no locked-layer leakage).

---

## T-07 — USER-DRIVEN WALL-CLOCK (7 days)

**This is YOUR job. The orchestrator cannot simulate this.**

### Pre-flight checklist (BEFORE starting the clock)

```bash
cd "C:/Users/User/Desktop/AI-Project/Memory-Studio"

# 1. Confirm HEAD
git log -1 --oneline  # should be dd987d8

# 2. Confirm gates
npm test                                # 533/533 PASS
npm run typecheck                       # exit 0
npm run verify-env                      # 6/6 PASS
node scripts/smoke-acceptance-gate.mjs  # PASS

# 3. Build the on-disk catalog
npm run build-index

# 4. Set environment (NEVER commit secrets)
export MINIMAX_API_KEY=<real-key>                              # real provider key
export MEMORY_STUDIO_CATALOG_DB_PATH=$(pwd)/data/memory-studio.sqlite
export MEMORY_STUDIO_STATE_PATH=$(pwd)/.memory-studio/state.json

# 5. Edit .memory-studio/state.json — ensure activeCatalog is NON-EMPTY
# (Empty activeCatalog short-circuits the pipeline at Stage 2.)
# Current state.json: thresholds: minCosineSimilarity=0.6, minFtsHits=2

# 6. Boot the augment server in another terminal
npm run server:start
# Verify log shows "MODE=real" for fast agent and "MODE=production"

# 7. Spot-check one real /v1/messages request with your coding agent
# Verify system prompt preserved, usage.cache_read_input_tokens > 0 for stable prompts

# 8. Capture FIRST snapshot (anchors the evidence timeline)
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:42900 \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots
# This writes .specs/acceptance/snapshots/<ISO_TIMESTAMP>.json
```

### Daily cadence (per session)

For each qualifying session (≥10 turns, stable identity):

```bash
# 1. Use Claude Code / Mavis / Cursor normally with the augment server as proxy
# 2. Set x-memory-studio-session-id header to a unique value per session
# 3. End the session:
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:42900 \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots

# 4. Check the gate (read-only) for tuning recommendation
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
# Output: tuning_recommendation: freeze | lower_cosine | lower_fts | inspect_cache | fix_performance | wait | escalate
```

### Eligibility requirements (the gate checks these)

| Requirement | Threshold |
|---|---|
| Wall-clock span | `max(audit.ts) - min(audit.ts) >= 604_800_000ms` (7 × 24 hours) |
| Distinct sessions | ≥ 5 (each with ≥ 10 audited turns) |
| Total qualifying turns | ≥ 50 |
| Snapshot source | `real` only (synthetic rejected in production mode) |
| Provider mode | `anthropic-real` |
| Fast agent mode | `real` |
| Runtime mode | `production` |
| Final threshold epoch | ≥ 2 sessions, ≥ 20 turns |

### 4 budgets the gate enforces (PRD §10.2 + §14.6)

| Budget | Strict inequality |
|---|---|
| `request_hit_rate` | `> 0.70` |
| `token_cache_coverage` | `> 0.60` |
| `p50_latency_ms` | `< 50` (worst observed across qualifying real snapshots) |
| `p99_latency_ms` | `< 200` |
| `working_set_mb` | `< 1500` (≥1h sustained process epoch) |

**Both cache ratios are mandatory (AND, not OR).**

### Mechanical completion check

```bash
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
# MUST exit 0 (without --allow-synthetic) AND report eligible_for_phase_closure: true
# BEFORE T-07 is considered complete.
```

---

## After T-07 — what to return to the orchestrator

The orchestrator will dispatch T-08 once you provide these:

```
.specs/acceptance/snapshots/*.json         # all committed snapshots
.memory-studio/state.json                 # final state.json
.specs/features/phase-7b-acceptance-gate/threshold-tuning.md  # your tuning log
```

**DO NOT include in the return:**
- API keys or authorization headers
- Raw prompts, responses, or context blocks
- Raw session IDs (snapshots only contain hashed session IDs)
- Any secret-like values

If a secret appears in a snapshot by accident, REMOVE that snapshot, ROTATE the credential, FIX the collector, and recapture.

---

## Operating Memory Studio locally — Quick Reference

### Boot the augment server

```bash
cd "C:/Users/User/Desktop/AI-Project/Memory-Studio"

# Required environment (DO NOT commit secrets):
export MINIMAX_API_KEY=<your-real-key>
export MEMORY_STUDIO_CATALOG_DB_PATH=$(pwd)/data/memory-studio.sqlite
export MEMORY_STUDIO_STATE_PATH=$(pwd)/.memory-studio/state.json

# Build catalog (one-time or after editing .memory-studio/catalog/*.yaml)
npm run build-index

# Boot the server (default port 42900-43000)
npm run server:start
# Server log should show:
#   [boot] fast-agent MODE=real endpoint=https://api.minimax.io/anthropic model=MiniMax-M2.7-highspeed
#   [boot] runtime MODE=production
#   Memory Studio augment server: http://127.0.0.1:<port>/
```

### Available endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness probe (uptime, audit_buffer, catalog) |
| `/metrics` | GET | 5 metrics: request_hit_rate, token_cache_coverage, p50/p99_latency_ms, working_set_mb |
| `/augment` | POST | The augment pipeline (called by SDK or proxy) |
| `/v1/messages` | POST | Transparent proxy (Anthropic Messages API + Memory Studio augmentation) |
| `/audit` | GET | Audit log (redacted) |
| `/audit/summary` | GET | Daily rollups |
| `/catalog` | GET | Current catalog |
| `/catalog/rebuild` | POST | FALLBACK no-op (deferred to v3.1+) |
| `/state/toggle` | POST | Toggle Memory Studio on/off per session |

### Wire Memory Studio to another repo (Coding Agent)

**Option A — Claude Code:**
```bash
# In your other repo, set env:
export ANTHROPIC_BASE_URL=http://127.0.0.1:42900  # augment server
# Plus your real Anthropic key still works through:
export ANTHROPIC_API_KEY=<your-real-key>
# Inside Memory Studio, the proxy forwards to:
#   https://api.minimax.io/anthropic (or whatever MEMORY_STUDIO_ANTHROPIC_BASE_URL says)
```

**Option B — Mavis / Cursor:**
Same pattern — set the proxy base URL to the augment server. The augment server transparently forwards the request to Anthropic with augmented system prompt.

**Option C — Direct SDK (any node.js app):**
```bash
npm install /path/to/Memory-Studio/packages/sdk
# Use the SDK from packages/sdk — see packages/sdk/README.md
```

### Active catalog

Edit `.memory-studio/state.json`:
```json
{
  "schemaVersion": 3,
  "activeCatalog": [
    /* array of skill/rule/persona IDs from .memory-studio/catalog/*.yaml */
  ],
  "thresholds": {
    "minCosineSimilarity": 0.6,
    "minFtsHits": 2
  },
  "fastAgent": {
    "model": "MiniMax-M2.7-highspeed",
    "baseURL": "https://api.minimax.io/anthropic"
  },
  "integrationMode": "proxy",
  "agentId": "claude-code"
}
```

Bootstrap the catalog from YAML samples:
```bash
npm run catalog:load            # loads .memory-studio/catalog/*.yaml into SQLite
```

---

## Cumulative Phase Results Summary

### Phase 5a (Server + Retrieval + Byte-string) — DONE
13 atomic commits across 4 sub-phases. 309 root + 152 UI + 16 SDK = 477 tests.

### Phase 5b (Audit + Endpoints + Security) — DONE
11 atomic commits across 4 sub-phases. 391 root + 152 UI + 16 SDK = 559 tests.
**Deferred gap:** POST /catalog/rebuild uses FALLBACK no-op (rebuild via controlled server restart).

### Phase 6a (POC Validation) — DONE
6 atomic commits. 19 POC tests added. POC verdict: PASS on all 3 targets.
- Hot path overhead: 0.07ms vs 10ms budget (147× headroom)
- Fast agent latency: 223ms stub vs 3s budget
- Byte-string determinism: 10/10 tests PASS
**AD-006:** 4 architectural decisions for Phase 6b.

### Phase 6b (Fast Agent + Intel Pipeline) — DONE
17 atomic tasks across 4 sub-phases. 459 root + 152 UI + 16 SDK = 627 tests.
**POC re-run at end-of-phase:** TOTAL overhead max=2.15ms ≪ 10ms budget (5× headroom).
**R-15 cache hit invariant validated.**

### Phase 7a (Metrics Instrumentation) — DONE
7 atomic tasks (T-01..T-07). 478 root + 152 UI + 16 SDK = 646 tests.
**POC re-run:** total overhead 0.10ms p95 (Phase 6b invariant preserved).
**GET /metrics endpoint:** 5 metrics, refresh N=10 OR T=60s.
**5 non-blocking gaps** carried to Phase 7b cleanup.

### Phase 7b (Empirical Tuning + Acceptance Gate) — 7b.1 VERIFIED, T-07 PAUSES
- 7b.1: T-01..T-06 committed. 533 root + 152 UI + 16 SDK = 701 tests.
- All 5 L-006 critical findings RESOLVED.
- Verifier PASS at `71a137d`.
- **T-07 awaiting user-driven wall-clock (≥7 days).**
- T-08 (autonomous hydration) deferred until T-07 completes.

## Working Tree at Handoff

```
M handoff-orchestrator.md          (this file — being committed)
CLEAN — no other modifications
```

## After session compaction (manual or auto), the next session must

1. **Read `STATE.md ## Handoff`** to learn current phase pointer.
2. **Read `.specs/DISCOVERIES.md` AD-001..AD-010** for accumulated architectural decisions.
3. **Read `.specs/features/phase-7b-acceptance-gate/validation-phase-7b.md`** for Verifier PASS report.
4. **Read this handoff** (you're reading it now) for context + T-07 instructions.
5. **Read `.specs/features/phase-7b-acceptance-gate/runbook.md`** for full T-07 operator runbook.
6. **`cd C:\Users\User\Desktop\AI-Project\Memory-Studio`** + `git checkout loop/phase-0`.
7. **Check current state:**
   - `git log -10 --oneline` — see commit chain.
   - `git status --short` — verify clean.
   - `git log -1 --oneline` — HEAD should be `dd987d8`.
8. **Phase 7b status:** Verifier PASS at `71a137d`. ORCHESTRATOR PAUSES for T-07.
9. **DO NOT dispatch Implementer/Verifier** until user provides T-07 snapshots.

## Lesson Log

- **L-001..L-008** (Phases 1-5b)
- **L-009** (Phase 7b): Node 22 strip-types rejects TS parameter properties. Use explicit field + constructor-body assignment.
- **L-010** (Phase 7b): Sub-agent context limits at ~6 atomic tasks. Split batches > 4 tasks in 1A+1B prophylactically. L-007 protocol + 3 casualties in 24h.

Effective practice after Phase 7b:
- When writing dispatch prompts for the loop, NEVER instruct "PASS test X looks like Y" — instead say "verify X via reading `path/to/code`" or "read `design.md` §X for the contract".
- Always include an explicit WIP checkpoint protocol in Implementer dispatch prompts when crossing ~5 tasks.
- **Lean read-only Verifier** profile (~30-45 min) is more reliable than heavy custom-forgery Verifier when credits are tight.

## Subchapter Pattern (Phases 1, 4, 5a, 5b, 6a, 6b — all split)

When Planner returns SUBCHAPTER_BREAKDOWN, orchestrator inserts sub-phase entries in `.specs/ROADMAP.md` between parent and next sibling, all `[ ]`, depending on parent. Then dispatches Implementer per sub-phase. Parent phase is annotated "Closed via subchapters X.Y, X.Z, ..." but never marked `[x]` directly — subchapter entries are the verification record.

## Fast Feedback (Waldemar #1) — Test Wall Time

`npm test` baseline wall time: **~50-95s** (varies by phase). Don't break this. If gate exceeds ~120s, Investigate.

## Spec Documents (the loop's source of truth)

| Path | Use |
|---|---|
| `.specs/ROADMAP.md` | Phase ordering + done criteria (input to Planner) |
| `.specs/STATE.md` | Phase pointer (`## Handoff`) + decisions (`## Decisions` append-only) — orchestrator's primary read |
| `.specs/LESSONS.md` | Generated from `lessons.py` store |
| `.specs/DISCOVERIES.md` | AD-NNN append-only (AD-001..AD-010) |
| `.specs/RETROSPECTIVE-PHASE-7b.md` | Phase 7b retrospective |
| `.specs/features/<phase>/spec.md` | Per-phase spec |
| `.specs/features/<phase>/design.md` | Per-phase design rationale |
| `.specs/features/<phase>/tasks.md` | Per-phase atomic tasks |
| `.specs/features/<phase>/validation-phase-<X>.md` | Per-phase Verifier report |
| `.specs/features/<phase>/runbook.md` | Operator runbook (Phase 7b) |
| `.specs/architecture/memory-studio.architecture.json` | Farol stable IDs |
| `.scratch/memory-studio/spec.md` | SPEC v2 — 70+ user stories, 20+ impl decisions |
| `PRD.md` | Product spec |
| `CLAUDE.md` | Testing contract, authority boundaries, gates |
| `handoff-orchestrator.md` | THIS FILE — resume state + T-07 instructions |

## Code Touch Surface Map (phases layered cleanly)

| Layer | Phase | State |
|---|---|---|
| `scripts/verify-env.mjs` | 0 | ✅ locked |
| `config/catalog/` (YAML samples) | 1.1 | ✅ locked |
| `.memory-studio/` | 1.1, 7b.1 | ✅ locked (state.json + setup.md) |
| `src/catalog/**` | 1, 5b.1, 6b.1 | ✅ locked (REUSE-ONLY) |
| `src/social-detector/**` | 2 | ✅ locked |
| `src/fingerprint/**` | 2 | ✅ locked |
| `packages/sdk/` | 3 | ✅ locked |
| `packages/ui/` | 4 | ✅ locked |
| `src/server/{boot,index,health,logger}.ts` | 5a.1, 6b.1, 7a, 7b.1 | ✅ locked |
| `src/server/augment/**` | 5a.2-5a.4, 6b.3-6b.4, 7a, 7b.1 | ✅ locked |
| `src/server/audit/**` | 5b.1 | ✅ locked |
| `src/server/security/**` | 5b.1, 5b.4 | ✅ locked |
| `src/server/routes/**` | 5b.2, 5b.3, 5b.4, 7a, 7b.1 | ✅ locked |
| `src/server/fast-agent/**` | 6b.1, 6b.2 | ✅ locked |
| `src/server/metrics/**` | 7a | ✅ locked |
| `src/server/config/**` | 7b.1 | ✅ locked (NEW in 7b.1) |
| `src/server/proxy/**` | 7b.1 | ✅ locked (NEW in 7b.1) |
| `src/server/acceptance/**` | 7b.1 | ✅ locked (NEW in 7b.1) |
| `scripts/{acceptance-gate,snapshot-metrics,smoke-acceptance-gate}.mjs` | 7b.1 | ✅ locked (NEW in 7b.1) |
| `src/search/*` | 5a.2 (reuse) | REUSE-ONLY — DO NOT modify |

## Personas & Roles (mental model for the orchestrator)

- **Planner**: dispatches once per phase (or per subchapter when split). Produces spec.md, design.md, tasks.md. NEVER writes code.
- **Implementer**: dispatches once per (sub)phase. Atomic commits. NEW strategies only when scope is expanded by orchestrator.
- **Verifier (HEAVY)**: dispatches once per (sub)phase AFTER Implementer reports done. Validates against spec.md / tasks.md / design.md. Re-runs gates. Author ≠ Implementer — fresh context. Honest uncertainty > confident theater.
- **Verifier (LEAN)**: read-only audit + rerun gates. NO custom forgery scripts. ~30-45 min budget. Use when credits are tight or Implementer pushed hard.
- **Retrospective**: parallel to Implementer. Documentation-only. Captures lessons, writes AD-NNN, updates MEMORY.md.
- **Orchestrator (you/me)**: NEVER write code (except for 1-line enum-style scope-expand authorizations). Read sub-agent outputs, dispatch next, handle verdicts, file lessons.

## Critical Conventions (NEVER violate)

1. **NEVER** run dispatches to sub-agents that aren't the right role. Implementer runs code, Verifier audits. Don't mix.
2. **NEVER** fix code yourself as orchestrator. Dispatch Implementer.
3. **NEVER** touch `.claude/settings.json` (peer's request or otherwise). Treat as local-only.
4. **NEVER** commit secrets, `.env.*` files, or `.claude/` config.
5. **L-003 discipline:** Phase boundary modifications to root `package.json` are risk-laden.
6. **L-006 discipline:** dispatch assertions about expected behavior can be wrong. Read actual code.
7. **L-007 discipline:** API 429 mid-task recovery. Stop, commit WIP, return structured report.
8. **L-008 discipline:** deferred-wiring pattern. Document deferred-to-user work in file headers.
9. **L-010 discipline:** split batches > 4 tasks in 1A+1B prophylactically.

## Skill Warnings (3-iter cap)

The `tlc-roadmap-loop` SKILL.md (`.claude/skills/tlc-roadmap-loop/SKILL.md`) has hard cap of 3 fix→re-verify iterations per phase. Phase 5a.2 used all 3. Don't go beyond iter 3 — escalate to user.

## End of Handoff

When resuming:
1. **State pointer:** "Phase 7b — T-07 user-driven wall-clock (ORCHESTRATOR PAUSES)"
2. **T-07 instructions:** Section "T-07 — USER-DRIVEN WALL-CLOCK" above
3. **Branch:** `loop/phase-0`
4. **Tests baseline:** 701 (533 root + 152 UI + 16 SDK)
5. **HEAD:** `dd987d8`
6. **Mission:** wait for T-07 snapshots from user, then dispatch T-08 (autonomous hydration + state freeze).

If anything looks broken post-compaction (commits don't match, working tree dirty for unknown reasons), prefer "stop and ask the user" over guessing. The loop is autonomous but not sacred — the human decides if something looks wrong.
