---
date: 2026-08-01
title: "Orchestrator handoff — tlc-roadmap-loop mid-flight"
purpose: "Resume state for session compaction / credit exhaustion"
audience: "orchestrator agent (post-compaction) + the human user"
---

# Orchestrator Handoff — `tlc-roadmap-loop`

## TL;DR

- **Branch:** `loop/phase-0` (only branch in use; do NOT work on `main`)
- **Mission:** Phase 7b.1B — T-03..T-06 (streaming + metrics v2 + acceptance evaluator + snapshot tool) — *Implementer 7b.1B running*
- **Tests baseline:** 478 root + 152 UI + 16 SDK = 646 total (T-01 + T-02 PARTIAL: 22/22 PASS in target areas, full suite needs re-verification after 7b.1B)
- **HEAD:** `fa399c2` (T-02 commit)
- **10 of 11 main phases DONE.** Last phase: **7b** (acceptance gate — needs user-driven wall-clock validation).

> **Phase 7a CLOSED 2026-08-02.** Verifier PASS at `.specs/features/phase-7a-metrics/validation-phase-7a.md`. Final HEAD `ca3b22c + 9024006` (closure).
>
> **Phase 7b T-01 + T-02 DONE 2026-08-03** (commits `8449251`, `aac824b`, `fa399c2`).
> - `runtime-state.ts` loads OK (TS parameter property bug fixed)
> - 22/22 target tests PASS (runtime-state, production-context, proxy-production-request, messages-proxy, endpoints)
> - `.memory-studio/state.json` now consumed by `runAugment`
> - Proxy forwards real active catalog + per-session identity + exact matched system
>
> **Phase 7b.1B (T-03..T-06) dispatched** (agent `aa39d491263d166cf`). Streaming work partially uncommitted (sse-tee.ts + messages-proxy.ts pending).

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
| **7a** Metrics Instrumentation | ✅ `[x]` | `9024006` (closure) | 1 |
| **7b** Real API Measurement + Tuning | ⏳ 7b.1A done (T-01+T-02), 7b.1B running (T-03..T-06) | `fa399c2` (HEAD) | 7b.1A iter 1 + 7b.1B in-flight |

**10 of 11 main phases DONE.** Last phase: **7b** (acceptance gate — needs user-driven wall-clock validation).

## Current In-Flight

**Phase 7b — Real API Measurement + Tuning — Planner dispatched, awaiting artifacts.**

### Phase 7a — CLOSED 2026-08-02 (`9024006`)

**Verifier PASS at `.specs/features/phase-7a-metrics/validation-phase-7a.md`.**

- 478 root + 152 UI + 16 SDK = 646 tests PASS twice
- POC re-run 4/4 PASS at total overhead p95 0.14-0.21ms (≪ 0.30ms Phase 7a ceiling)
- 8/8 forge tests PASS
- AC-1..AC-14 all PASS
- R-1 naming divergence + R-2 formula simplification documented
- 5 non-blocking gaps (R-2 denominator edge, sliding-window vs cumulative, fractional latency, missing pino info log, direct `recordAugment` signature drift) carried to Phase 7b cleanup

### Phase 7a — Pre-closure Implementer result (rolled into above)

**(Historical; preserved for traces)**

**Tasks completed:** T-01..T-07 (T-08 skipped as optional per Planner's note "Implementer judgment").

| File | Lines | Purpose |
|---|---|---|
| `src/server/metrics/ring-buffer.ts` | 366 | `MetricsRingBuffer` class — counters + 100-element latency ring + dashboard recompute |
| `src/server/metrics/lifecycle.ts` | 59 | Singleton accessor (mirrors `audit/lifecycle.ts`) |
| `src/server/metrics/collector.ts` | 98 | Write seam (recordAugment + recordProxy) |
| `src/server/metrics/dashboard.ts` | 39 | Read helper (compute 5 metrics from ring buffer) |
| `src/server/routes/metrics.ts` | 43 | `GET /metrics` endpoint (constant-time < 1ms) |
| `test/server/metrics/{ring-buffer,dashboard,route,reset}.test.mjs` | 457 | 19 new tests |
| `scripts/smoke-metrics.mjs` | 163 | Smoke boots server, sends 50 requests, asserts metrics |

**Files modified:**
- `src/server/boot.ts` — +24/-2 (init + start + register + stop on SIGTERM)
- `src/server/augment/pipeline.ts` — +33/-9 (3 hook sites: matched path, personaOnlyResponse, failOpenResponse)
- `src/server/routes/messages-proxy.ts` — +18/-4 (tProxyStart capture + recordProxySample on 200)
- `src/server/routes/index.ts` — +2/-1 (re-export registerMetricsRoute)

**Gates result:**
- `npm test`: 478/478 PASS (target ≥ 475 met)
- `npm run typecheck`: exit 0
- `node scripts/smoke-metrics.mjs`: PASS
- `node scripts/poc-6a-hot-path.mjs`: **total overhead 0.10ms p95** ≪ 10ms budget (Phase 6b invariant preserved)
- All other gates green

**GET /metrics sample response:**
```json
{
  "request_hit_rate": null,
  "token_cache_coverage": null,
  "p50_latency_ms": 0.071,
  "p99_latency_ms": 2.575,
  "working_set_mb": 80,
  "window": { "request_count": 5, "proxy_request_count": 0, "window_age_ms": 273 },
  "proxy_enabled": false,
  "schema_version": 1,
  "timestamp": 1785608539233
}
```

### Implementer deviations worth flagging

1. **Buffer `recordAugment` signature:** accepts `{ matched, outcome, latencyMs }` (with explicit `outcome` enum) rather than tasks.md's simpler `{ matched, latencyMs }`. The collector's `outcomeFromEmptyReason` translates from `AugmentResponse.emptyReason` to `AugmentOutcome`. Needed to honor spec.md R-1 denominator exclusion (social/no_active_items/timeout).
2. **Low-confidence paths counted as `measured`:** `emptyReason: 'low_confidence'` is NOT in spec.md R-1's exclusion list — counted in denominator.
3. **`readProxyEnabled()` reads env at recompute time**, NOT cached. Runtime env changes reflected immediately.
4. **`window.request_count` = total augment requests (all paths)**, not just measured. By design (raw volume for dashboards).
5. **Pre-existing test#366 flake** in `test/server/smoke.test.mjs:111` — port exhaustion `[42900, 43000]`. Not caused by Phase 7a. Phase 7a smoke uses distinct port range `[48300, 48399]`.

### Next actions (when resuming)

1. **Inspect working tree first:** `git status --short` — should be clean (Phase 7a closed at `9024006`).
2. **Check if Phase 7b Planner artifacts landed** (`ls .specs/features/phase-7b-acceptance-gate/`).
3. **If Planner returned:** commit artifacts, dispatch Implementer Phase 7b (single batch or sub-batch 1 of N).
4. **If Verifier-Implementer pipeline running:** follow closure protocol (ROADMAP flip, STATE.md update, commit).
5. **Phase 7b is the LAST phase.** Closure of 7b = Memory Studio in production.

### Quick decision tree (when resuming)

```
Is there a Planner returned for Phase 7b?
├── YES → commit artifacts + dispatch Implementer Phase 7b
├── NO → check `.specs/features/phase-7b-acceptance-gate/` for spec.md/design.md/tasks.md

Is there a Verifier pending for the current Phase 7b batch?
├── YES → dispatch Verifier (use Phase 6b.4 validation report template)
└── NO → read STATE.md ## Handoff for current phase pointer

Is HEAD < 9024006?
├── YES → run `git log -10 --oneline` to see current state, then catch up
└── NO → proceed with current state pointer

Do you have unanswered user messages?
├── YES → ANSWER THEM FIRST before dispatching (user got frustrated when I ran long dispatches in foreground)
└── NO → dispatch freely
```

### Concrete resume commands (copy-paste ready)

```bash
# 1. Get current state
cd "C:/Users/User/Desktop/AI-Project/Memory-Studio"
git checkout loop/phase-0
git log -10 --oneline
git status --short

# 2. Read state pointer
cat .specs/STATE.md | head -100

# 3. Read this handoff for context
cat handoff-orchestrator.md

# 4. Check what Verifier dispatch template exists
ls .specs/features/phase-6b-fast-agent-intel/validation-phase-6b.*.md

# 5. Dispatch Verifier Phase 7a (after reading tasks.md and validation-phase-7a.md template)
# Use Agent tool with subagent_type: "general-purpose"
# Reference: .specs/features/phase-7a-metrics/{spec,design,tasks}.md
# Write validation report to: .specs/features/phase-7a-metrics/validation-phase-7a.md
```

### Critical user-experience lesson (MUST follow)

**DO NOT run long Implementer/Planner/Verifier dispatches in foreground without acknowledging the user first.** When the user asks "como estamos?" mid-dispatch, they WAIT — sometimes 30+ minutes. Solutions:
- Run long dispatches in `run_in_background: true` so you can respond to status queries.
- If you must run foreground, send a 1-line "Implementer started, will report back in ~30 min" message BEFORE calling the Agent tool.
- After every long dispatch returns, respond IMMEDIATELY to any queued user messages.

**User explicitly flagged this frustration on 2026-08-01:** "Eu te perguntei 3 vezes vc ficou meia hora sem me responder, fdp." Do not repeat this pattern.

### Known issues to track (do NOT skip)

1. **test#366 flake** — `test/server/smoke.test.mjs:366` (was line 111, line 237, line 285 across phases — line number shifts as tests are added). Port exhaustion in `[42900, 43000]`. Pre-existing across Phases 5a, 5b, 6a, 6b, 7a. **Recommendation:** widen port range in Phase 7b cleanup, or add SIGTERM + 500ms delay in smoke wrapper.
2. **Proxy T-14 deviation** — `src/server/routes/messages-proxy.ts:230` uses `activeCatalog: []` which short-circuits BEFORE Stage 1b. Documented in AD-009. Pickup candidate for Phase 7b.
3. **POST /catalog/rebuild no-op fallback** — `src/server/routes/catalog-rebuild.ts:55-65` uses FALLBACK_REBUILD that returns count without doing actual rebuild. Documented in file header lines 17-23. Pickup candidate for Phase 7b.
4. **Token-weighted `token_cache_coverage`** — Phase 7a uses request-weighted (simpler). PRD §14.6 specifies token-weighted. v3.1+ if needed.

### Phase 7a Verifier dispatch template (use when resuming)

The Verifier for Phase 7a should:
- Read `.specs/features/phase-7a-metrics/{spec,design,tasks}.md`
- Audit `src/server/metrics/ring-buffer.ts` (366 lines) — counters, latency ring, refresh trigger
- Audit `src/server/metrics/collector.ts` (98 lines) — write seam
- Audit `src/server/routes/metrics.ts` (43 lines) — GET /metrics endpoint
- Audit hook sites in `src/server/augment/pipeline.ts` and `src/server/routes/messages-proxy.ts`
- Run `npm test -- test/server/metrics/` — 19 tests must PASS
- Run `node scripts/smoke-metrics.mjs` — must exit 0
- Run `node scripts/poc-6a-hot-path.mjs` — must show total overhead < 10ms (Phase 6b invariant)
- Document PRD divergences in validation-phase-7a.md per spec.md §5
- Write report to `.specs/features/phase-7a-metrics/validation-phase-7a.md`

### Phase 7b scope preview (per ROADMAP)

Phase 7b — Real API Measurement + Tuning. 2-3h estimate. Depends on Phase 5 + Phase 6b.

Done criteria (per ROADMAP):
- Real `MiniMax-M2.7-highspeed` API latency p95 measurement (vs POC stub 223ms)
- Cache hit validation with real Anthropic API (vs POC stub `cache_read_input_tokens=42`)
- Working set measurement at 1h mark vs PRD §10.2.3 budget (<1.5GB)
- Tuned thresholds based on real data

**Likely cleanup candidates picked up here:**
- test#366 flake fix
- Proxy T-14 deviation (AD-009)
- POST /catalog/rebuild production wiring (Phase 5b.3 deferred gap)

### Authoritative files for resume (READ IN ORDER)

1. `handoff-orchestrator.md` (this file) — TL;DR + decision tree + recovery commands
2. `.specs/STATE.md` — current phase pointer + decisions + handoff
3. `.specs/ROADMAP.md` — phase ordering + done criteria
4. `.specs/DISCOVERIES.md` — AD-001..AD-009 architectural decisions
5. `.specs/features/phase-7a-metrics/{spec,design,tasks}.md` — Phase 7a contracts (T-01..T-07)
6. `.specs/features/phase-7a-metrics/validation-phase-7a.md` — Verifier report (when written)
7. `.claude/agents/` or `~/.claude/agents/` — if you need to dispatch sub-agents, use the same agent types as before (general-purpose for Implementer/Verifier/Planner)

## Cumulative Phase Results Summary

### Phase 5a (Server + Retrieval + Byte-string) — DONE
13 atomic commits across 4 sub-phases. 309 root + 152 UI + 16 SDK = 477 tests.

### Phase 5b (Audit + Endpoints + Security) — DONE
11 atomic commits across 4 sub-phases. 391 root + 152 UI + 16 SDK = 559 tests.
**Deferred gap documented:** POST /catalog/rebuild uses FALLBACK no-op (cannot recover from corrupted catalog). Real TEMP+rename swap deferred to Phase 5c/7a follow-up.

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
**Known scope gap:** proxy route at `src/server/routes/messages-proxy.ts:230` uses `activeCatalog: []` which short-circuits BEFORE Stage 1b — full proxy fast-agent scheduling deferred to Phase 7b per AD-009.

### Phase 7a (Metrics Instrumentation) — Implementer PASS
7 atomic tasks (T-01..T-07). 478 root + 152 UI + 16 SDK = 646 tests.
**POC re-run:** total overhead 0.10ms ≪ 10ms budget (Phase 6b invariant preserved).

## Working Tree at Handoff

```
 M handoff-orchestrator.md          (this file — being committed)
 M src/server/metrics/collector.ts  (Implementer's edit between commits — pending commit)
 ?? .specs/architecture/custom-farol.html.bak   (untracked, NOT loop work)
 ?? .specs/archive/architeture/                 (untracked, NOT loop work — note: typo "architeture")
 ?? .specs/archive/auto-grill-output/           (untracked)
 ?? UsersUserDesktopAI-ProjectMemory-Studio.claudeagents/   (untracked)
 ?? old_arquive-miscelanea/                    (untracked)
```

**Note:** `src/server/metrics/collector.ts` is modified but uncommitted — likely a small adjustment the Implementer made between commits. Inspect + commit with Phase 7a closure.

## After session compaction (manual or auto), the next session must

1. **Read `STATE.md ## Handoff`** to learn current phase pointer.
2. **Read `.specs/DISCOVERIES.md` AD-001..AD-009** for accumulated architectural decisions.
3. **Read `.specs/features/phase-7a-metrics/validation-phase-7a.md`** (when Verifier writes it) for Verifier report.
4. **Read this handoff** (you're reading it now) for context.
5. **`cd C:\Users\User\Desktop\AI-Project\Memory-Studio`** + `git checkout loop/phase-0`.
6. **Check current state:**
   - `git log -10 --oneline` — see commit chain.
   - `git status --short` — see if uncommitted changes remain.
   - `git diff src/server/metrics/collector.ts` — verify state.
7. **Dispatch Verifier Phase 7a** (if not already done — see `git log` for validation-phase-7a.md commit).
8. **If Verifier PASS:** step 8 PASS branch — flip Phase 7a `[ ]` → `[x]`, update `STATE.md ## Handoff`, commit, dispatch Implementer Phase 7b (or Planner first if Phase 7b needs new spec).
9. **If Verifier FAIL** (iter 2 of cap = 2nd attempt): implement fix-tasks + re-verify.

## L-007 candidate (already saved) — API 429 mid-task recovery

**Pattern:** Implementer/Verifier can die mid-task from API 429 token limit. Recovery: don't restart from scratch; inspect working tree, commit partial work, resume from where it stopped. **Recurrence=2** (Phase 4.4 + Phase 5a.2 — Phase 5a.2 Implementer iter 2 died after committing FT-01 + FT-02).

## Lesson Log (`scripts/lessons.py add --feature <feat> --signal <type> --source <file:line> --text <one-line>`)

- **L-001** (Phase 1.2): vec0 ≠ FTS5 trigger syntax
- **L-002** (Phase 1.4): Windows EBUSY retry-with-backoff (50ms→1000ms, 25 attempts)
- **L-003** (Phase 1.4): residue deletion must update `package.json` scripts in same task
- **L-004** (Phase 1.4): D-001 §18.x grep needs 2-axis classification (stale section refs vs META documentation of rule itself)
- **L-005** (Phase 3): Implementer "true observation, wrong reason" pattern
- **L-006** (Phase 3, 4.4, 5a.1, 5a.2): dispatch assertions can be wrong. Read design.md / spec.md / code before claiming contracts.
- **L-007** (Phase 5a.2): API 429 mid-task recovery pattern (recurrence=2).
- **L-008** (Phase 5b.3): deferred-wiring pattern for contractually-correct no-op fallback (file header documents the gap).

**Effective practice after Phase 6b:** when writing dispatch prompts for the loop, NEVER instruct "PASS test X looks like Y" — instead, say "verify X via reading `path/to/code`" or "read `design.md` §X for the contract".

## Subchapter Pattern (Phases 1, 4, 5a, 5b, 6a, 6b — all split)

When Planner returns SUBCHAPTER_BREAKDOWN, orchestrator inserts sub-phase entries in `.specs/ROADMAP.md` between parent and next sibling, all `[ ]`, depending on parent. Then dispatches Implementer per sub-phase. Parent phase is annotated "Closed via subchapters X.Y, X.Z, ..." but never marked `[x]` directly — subchapter entries are the verification record.

**Pattern:** when sub-phase > 4 tasks, batch Implementer dispatches across multiple sub-phases (Phase 5b: 6b.1+6b.2 in batch 1, 6b.3+6b.4 in batch 2; Phase 6b: 6b.1+6b.2 in batch 1, 6b.3 in batch 2, 6b.4 in batch 3).

## Fast Feedback (Waldemar #1) — Test Wall Time

`npm test` baseline wall time: **~50-95s** (varies by phase). Don't break this. If gate exceeds ~120s, Investigate.

## Spec Documents (the loop's source of truth)

| Path | Use |
|---|---|
| `.specs/ROADMAP.md` | Phase ordering + done criteria (input to Planner) |
| `.specs/STATE.md` | Phase pointer (`## Handoff`) + decisions (`## Decisions` append-only) — orchestrator's primary read |
| `.specs/LESSONS.md` | Generated from `lessons.py` store |
| `.specs/DISCOVERIES.md` | AD-NNN append-only (current: AD-001..AD-009) |
| `.specs/features/<phase>/spec.md` | Per-phase spec |
| `.specs/features/<phase>/design.md` | Per-phase design rationale |
| `.specs/features/<phase>/tasks.md` | Per-phase atomic tasks with verification commands |
| `.specs/features/<phase>/validation-phase-<X>.md` | Per-phase Verifier report |
| `.specs/features/<phase>/fix-tasks-phase-<X>.md` | Per-phase Verifier-FAIL fix task list |
| `.specs/architecture/memory-studio.architecture.json` | Farol stable IDs |
| `.scratch/memory-studio/spec.md` | SPEC v2 — 70+ user stories, 20+ impl decisions |
| `PRD.md` | Product spec |
| `CLAUDE.md` | Testing contract, authority boundaries, gates |

## Code Touch Surface Map (phases layered cleanly)

| Layer | Phase | State |
|---|---|---|
| `scripts/verify-env.mjs` | 0 | ✅ locked |
| `config/catalog/` (YAML samples) | 1.1 | ✅ locked |
| `src/catalog/**` | 1, 5b.1, 6b.1 | ✅ locked (REUSE-ONLY — except `index.ts` + new migrations) |
| `src/social-detector/**` | 2 | ✅ locked |
| `src/fingerprint/**` | 2 | ✅ locked |
| `packages/sdk/` | 3 | ✅ locked |
| `packages/ui/` | 4 | ✅ locked |
| `src/server/{boot,index,health}.ts` | 5a.1, 6b.1, 7a | in-flight (most recent: Phase 7a wiring) |
| `src/server/augment/**` | 5a.2-5a.4, 6b.3-6b.4, 7a | in-flight (most recent: Phase 7a hook sites) |
| `src/server/audit/**` | 5b.1 | ✅ locked |
| `src/server/security/**` | 5b.1, 5b.4 | ✅ locked |
| `src/server/routes/**` | 5b.2, 5b.3, 5b.4, 7a | in-flight (most recent: Phase 7a metrics route) |
| `src/server/fast-agent/**` | 6b.1, 6b.2 | ✅ locked |
| `src/server/metrics/**` | 7a | **NEW — in-flight (just shipped)** |
| `src/search/*` | 5a.2 (reuse) | REUSE-ONLY — DO NOT modify |

**Calibration residue that's INTENTIONAL & locked:**
- `src/search/{fts,rrf,schema,vector,types,errors,search}.ts` — REUSE-ONLY per CALIBRATION-RESIDUE.md
- `src/social-detector/is-social.ts` deleted in Phase 2 (promoted to `social.ts`)

## Personas & Roles (mental model for the orchestrator)

- **Planner**: dispatches once per phase (or per subchapter when split). Produces spec.md, design.md, tasks.md. NEVER writes code.
- **Implementer**: dispatches once per (sub)phase. Atomic commits. NEW strategies only when scope is expanded by orchestrator (e.g., Phase 4.3 iter 2 STEP A for `state.ts`).
- **Verifier**: dispatches once per (sub)phase AFTER Implementer reports done. Validates against spec.md / tasks.md / design.md. Re-runs gates. Author ≠ Implementer — fresh context. Honest uncertainty > confident theater.
- **Orchestrator (you/me)**: NEVER write code (except for 1-line enum-style scope-expand authorizations). Read sub-agent outputs, dispatch next, handle verdicts, file lessons.

## Critical Conventions (NEVER violate)

1. **NEVER** run dispatches to sub-agents that aren't the right role. Implementer runs code, Verifier audits. Don't mix.
2. **NEVER** fix code yourself as orchestrator. Dispatch Implementer. The 1-line enum extension in Phase 4.3 iter 2 was authorized scope expansion, NOT "orchestrator fixes code".
3. **NEVER** touch `.claude/settings.json` (peer's request or otherwise). Treat as local-only.
4. **NEVER** commit secrets, `.env.*` files, or `.claude/` config.
5. **L-003 discipline:** Phase boundary modifications to root `package.json` are risk-laden. When adding workspace deps or scripts, verify `git diff` shows ONLY the additive lines before committing.
6. **L-006 discipline:** dispatch assertions about expected behavior can be wrong. Read actual code (`scripts/build-index.ts` has `printHelp` documenting exit codes; `src/fingerprint/` has golden vectors; `.specs/features/<phase>/{spec,design,tasks}.md` are authoritative). When dispatch and design.md disagree, **design.md wins**.

## Skill Warnings (3-iter cap)

The `tlc-roadmap-loop` SKILL.md (`.claude/skills/tlc-roadmap-loop/SKILL.md`) has hard cap of 3 fix→re-verify iterations per phase. Phase 5a.2 used all 3 (iter 1 FAIL → iter 2 partial + API 429 → iter 3 PASS). Don't go beyond iter 3 — escalate to user.

## End of Handoff

When resuming:
1. **State pointer:** "Phase 7a — Metrics Instrumentation" (Implementer iter 1 PASS, awaiting Verifier)
2. **Next dispatch:** Verifier Phase 7a (T-01..T-07 audit + validation-phase-7a.md report)
3. **Branch:** `loop/phase-0`
4. **Tests baseline:** 646 (478 root + 152 UI + 16 SDK)
5. **HEAD:** `03cee68` (Phase 7a T-07 — last Implementer commit)
6. **Mission:** close Phase 7a entirely (after Verifier PASS), then dispatch Phase 7b (Real API Measurement + Tuning). Phase 7b is the FINAL phase.

If anything looks broken post-compaction (commits don't match, working tree dirty for unknown reasons), prefer "stop and ask the user" over guessing. The loop is autonomous but not sacred — the human decides if something looks wrong.
