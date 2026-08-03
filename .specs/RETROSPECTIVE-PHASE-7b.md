---
date: 2026-08-03
version: 1
description: "Phase 7b retrospective — Empirical Tuning + Acceptance Gate. Captures Planner discovery, Implementer #1 casualty, recovery via WIP commits, T-01+T-02 wins, and 7b.1B T-03..T-06 in-flight."
explanation: |
  This is a documentation-only retrospective authored in parallel with the
  Phase 7b.1B Implementer (T-03..T-06 in-flight). It captures lessons while
  memory is fresh and serves as the source-of-truth record for the L-006
  critical findings that drove Phase 7b from a "reader + gate" scaffold
  shape into a production-wiring correction phase.

  Authored by the Retrospective sub-agent. NOT production code.
related:
  - .specs/features/phase-7b-acceptance-gate/spec.md
  - .specs/features/phase-7b-acceptance-gate/design.md
  - .specs/features/phase-7b-acceptance-gate/tasks.md
  - .specs/features/phase-7a-metrics/validation-phase-7a.md
  - .specs/DISCOVERIES.md
  - .specs/LESSONS.md
  - .specs/lessons.json
  - handoff-orchestrator.md
---

# Phase 7b Retrospective

> **Scope:** Phase 7b — Empirical Tuning + Acceptance Gate (final roadmap phase).
> **Status at write-time:** 7b.1A complete (T-01 + T-02 DONE at `fa399c2`); 7b.1B in-flight (T-03..T-06 dispatched, T-03 + T-04 committed at `33b46ab`). T-05/T-06 outcomes still uncertain at write time — see §6.
> **Authored:** 2026-08-03 (in parallel with 7b.1B Implementer).

---

## 1. What worked

- **L-006 source audit changed the shape of Phase 7b.** The Planner's pre-implementation grep of `src/server/augment/pipeline.ts:208-210`, `src/server/routes/messages-proxy.ts:226-239`, `src/server/boot.ts:208-235`, and `.memory-studio/state.json` produced 5 critical findings that prevented Phase 7b from validating a stub path. Without this, the 7-day wall-clock collection would have measured a non-functional route and produced a false PASS.
- **T-01 + T-02 single-batch delivery worked.** Both tasks landed atomically (commits `8449251`, `aac824b`, `fa399c2`). 22/22 target-area tests passed (runtime-state, production-context, proxy-production-request, messages-proxy, endpoints). State.json thresholds now actually consumed by `runAugment`; proxy forwards real active catalog + per-session identity + exact matched system.
- **L-007 protocol saved the day (twice).** When Implementer #1 died mid-T-01 returning corrupted output, the orchestrator dispatched a fresh sub-agent scoped to the remaining items instead of restarting from scratch. WIP commit `3331660` (partial T-01: `runtime-state.ts` + `production-context.ts` + `boot.ts` + `pipeline.ts`) was preserved as the recovery point.
- **Three-stage architecture (7b.1 → 7b.2 → 7b.3).** Keeping autonomous scaffolding separate from human wall-clock collection means T-07 cannot be confused with `npm test` output. `--allow-synthetic` flag is structurally separated from production mode.
- **TypeScript parameter property bug fix (commit `8449251`).** When Node 22 `--experimental-strip-types` rejected `constructor(private foo: Bar)` shorthand, the implementer replaced it with explicit field declarations + constructor-body assignment, restoring TS runtime loading. This is now L-009.
- **Carry-forward discipline from Phase 7a Verifier.** The 4 ranked gaps (R-2 denominator, sliding-window wording, fractional latency, proxy T-14) plus 3 deferred items (pino log, `/catalog/rebuild` TEMP+rename, test#366 port range) were folded/deferred explicitly in `spec.md §4`. No silent redefinition of the roadmap contract.
- **L-008 deferred-wiring pattern recycled.** `src/server/config/runtime-state.ts:9-10` documents "configured initial values are 0.60/2; before Phase 7b the pipeline used the search defaults 0.75/1" in the file header — same grep-able contract discipline as `catalog-rebuild.ts:17-23`.

---

## 2. What didn't work

- **Implementer #1 died mid-T-01** (Phase 7b Dispatch 1). Returned corrupted output (garbled partial file). Root cause: batch was too large for a single sub-agent context window given the depth of L-006 production-wiring corrections (5 critical findings × multiple file edits × non-trivial test scaffolding). WIP commit `3331660` preserved partial state across the casualty.
- **ROADMAP's optimistic 3-4h estimate was wrong by 2x.** The Planner's L-006 source audit found that production wiring was broken in 5 places, not 1. The corrected estimate (5-7h) still proved tight; actual 7b.1A alone consumed 3 commits + a casualty + recovery. ROADMAP estimate model needs calibration against future phases.
- **Phase 7a Verifier left 4 non-blocking gaps that became blocking for 7b.** The "carry-forward" hygiene worked, but the gaps were load-bearing for 7b's metric math (R-2 denominator, sliding-window contract). Treating them as "non-blocking for 7a" was correct but understated their downstream impact.
- **No graceful tooling for sub-agent context exhaustion mid-batch.** When Implementer #1 died, recovery was manual: inspect working tree, commit partial, dispatch fresh. There is no automatic WIP checkpoint or "split at next stable task" signal. L-010 captures this as a recurrence-2 lesson.
- **TS strip-types tooling limitation was discovered at runtime, not at typecheck.** The bug only manifests when the file is `node --experimental-strip-types --no-warnings`'d; `tsc --noEmit` accepted the shorthand. This is the kind of toolchain assumption that wastes a casualty-cycle to discover.

---

## 3. L-006 critical findings (the meaty part)

The Planner's pre-implementation source inspection of `src/server/**` + `.memory-studio/state.json` produced **5 critical findings** that re-shaped Phase 7b from "acceptance scaffolding only" into "production wiring correction + scaffolding". Without these corrections, T-07 wall-clock collection would have measured a stubbed or non-functional route rather than Memory Studio.

### L-006 finding #1 — `state.json` thresholds NOT consumed by `runAugment`

**Observed:** `.memory-studio/state.json` configured `minCosineSimilarity: 0.6`, `minFtsHits: 2`. But `src/server/augment/pipeline.ts:208-210` called `applyThresholds(ranked)` with no options, so the runtime used `src/search/types.ts:20-24` defaults (`0.75 / 1`). Changing state was ceremonial; documented configured `0.60/2` ≠ effective `0.75/1`.

**Acceptance impact:** T-07 collection would have measured a system that ignored its own configuration. Threshold tuning would be theater. Final report's "configured initial vs empirical final" would be a lie.

**Design response:** `src/server/config/runtime-state.ts` + `production-context.ts` typed adapter. `PipelineContext` gains readonly thresholds; `runAugment` passes them to `applyThresholds`. State is read **once per request** so activeCatalog + thresholds cannot drift within a request. T-01 implementation: `runtime-state.ts:1-50` shows the pattern.

### L-006 finding #2 — `activeCatalog: []` hardcoded in proxy

**Observed:** `src/server/routes/messages-proxy.ts:226-239` hardcoded `activeCatalog: []`, which caused the pipeline to short-circuit before Stage 1b (retrieval never ran for proxy traffic). The proxy was structurally a no-op augmentation path.

**Acceptance impact:** Real Claude Code / Mavis / Cursor sessions through the proxy would measure zero retrieval and zero matches. Request hit rate would always be 0/0 → null. The cache ratio would be undefined.

**Design response:** Proxy now reads activeCatalog from the same runtime state snapshot as thresholds. T-02 implementation: `fa399c2` forwards real active catalog.

### L-006 finding #3 — Session ID "proxy" hardcoded

**Observed:** `src/server/routes/messages-proxy.ts:226` used literal `sessionId: 'proxy'`. Every proxy request collapsed into one identity. R-9 ("≥5 distinct hashed session identities") was structurally impossible to prove.

**Acceptance impact:** The five-session gate could never pass — the audit log would show one session with all turns.

**Design response:** Optional `x-memory-studio-session-id` header, hashed at ingress before storage. Fallback is deterministic SHA-256 over stable original system + first user prompt. Only the hash enters `PipelineContext`, intel rows, snapshots, audit metadata. T-02 implementation.

### L-006 finding #4 — Proxy rebuilds system with `matched: []`

**Observed:** `src/server/routes/messages-proxy.ts:270-274` called `buildSystemMessage(augmentReq, { matched: [] })` AFTER the pipeline ran. Even when the pipeline found matches, they were discarded and an empty system was rebuilt. The audit SHA recorded the empty system, not the real augmented system.

**Acceptance impact:** Cache hit invariant (R-15, AD-007) would never trigger because Block 1 would never include matched items. `token_cache_coverage` would be 0. The provider cache prefix was structurally unmeasurable.

**Design response:** Internal detailed pipeline seam returns `{response, system}` so the proxy can forward the exact system blocks whose SHA is in `AugmentResponse.systemMessage`. Original system is preserved verbatim in stable prefix; Memory Studio augments rather than deletes. T-02 implementation.

### L-006 finding #5 — Proxy strips Messages fields + auth headers + no streaming path

**Observed:** `src/server/routes/messages-proxy.ts:68-73, 276-294` used a narrow Zod object that stripped `tools`, `tool_choice`, `metadata`, future Anthropic fields, AND credential headers (`x-api-key`, `authorization`). JSON-only response path; no SSE relay for streaming. No usage extraction from either path.

**Acceptance impact:** Real Claude Code streaming traffic could not pass through the proxy intact. Tool-use requests would silently lose tools. Provider usage fields would never reach the metrics module. Phase 7a's `token_cache_coverage` would be perpetually null.

**Design response:** Pass-through body for known + future fields. Explicit header allowlist (`x-api-key`, `authorization`, `anthropic-version`, `anthropic-beta`, `content-type`); credential values never logged. Two response adapters: JSON and streaming tee. Usage extracted on both paths; `cache_hit_requests` denominator increments on completed 200 regardless of usage presence (R-2 fix). T-02 (request path) + T-03 (streaming + tail) + T-04 (metrics v2) implementation.

### Consequence of L-006

A Phase 7b that only built `acceptance-report.ts` + a gate would produce a mechanically polished but invalid PASS. The gate would be evaluating:

- thresholds that do not affect requests (finding #1);
- a proxy that short-circuits before matching (finding #2);
- an empty rebuilt system instead of matched content (finding #4);
- one collapsed session identity (finding #3);
- JSON-only stub traffic with stripped tool/auth/streaming fields (finding #5).

Therefore production-readiness wiring is part of 7b.1, not optional cleanup. This is the architectural reason Phase 7b grew from "2-3h acceptance gate" (ROADMAP) to "5-7h autonomous + 7 days wall-clock + 0.5-1.5h closure" (Planner revision 2026-08-02).

---

## 4. Implementer casualties (recovery pattern)

### Implementer #1 — Phase 7b T-01 casualty (2026-08-02)

**What happened:** Initial Implementer dispatched with full Batch 1 (T-01..T-06, 5-7h estimate) died mid-T-01 returning corrupted output. Root cause: batch scope was too large for a single sub-agent context window given the depth of L-006 production wiring corrections across multiple non-trivial files (`runtime-state.ts`, `production-context.ts`, `boot.ts`, `pipeline.ts`, `augmenter.ts`).

**Recovery:**
1. Orchestrator inspected working tree (`git status --short`).
2. Committed partial T-01 work as `3331660 wip(phase-7b): partial T-01 — runtime-state.ts + production-context.ts + boot.ts + pipeline.ts`.
3. Dispatched Implementer #2 scoped to T-01 (completion) + T-02.

**Outcome:** Implementer #2 completed T-01 + T-02 atomically. Three commits landed: `8449251` (strip-types support), `aac824b` (T-01 wiring), `fa399c2` (T-02 proxy). All 22/22 target tests pass.

### Implementer #2 — Phase 7b T-03..T-06 dispatch (2026-08-03, in-flight at write-time)

**Current state:** 7b.1B dispatched with T-03..T-06 (4 tasks: streaming + metrics v2 + evaluator + snapshot/smoke). T-03 and T-04 committed (`fb75813`, `33b46ab`). T-05 + T-06 outcomes still uncertain at retrospective write-time — see §6 for honest uncertainty.

**L-007 protocol applied twice in Phase 7b.** Both casualties fit the recovery pattern: inspect tree → commit WIP → dispatch fresh sub-agent scoped to remaining items. No restart-from-scratch. Recurrence=2 + Phase 4.4 + Phase 5a.2 → confirms L-007 pattern (now updated as L-010 with explicit batch-sizing recommendation).

### Lesson scoping matters

The 5-7h batch was too big for a single sub-agent. A sub-agent context window appears to saturate around ~6 atomic tasks when each task involves multi-file edits + new test scaffolding + L-006 production wiring depth. Splitting Batch 1 into 1A (T-01..T-02) + 1B (T-03..T-06) was the correct recovery — but the orchestrator only learned to split AFTER the casualty, not prophylactically. L-010 carries this forward.

---

## 5. Carry-forward items status

### Folded into 7b.1A (T-01 + T-02)

| Carry-forward item | Folded into | Status |
|---|---|---|
| R-2 missing-usage denominator | T-04 (metrics v2) | Pending — T-04 committed, verification in 7b.1B completion |
| Sliding-window vs cumulative | T-04 | Pending — same |
| Fractional latency contract | T-04 | Pending — same |
| Proxy T-14 activeCatalog short-circuit | T-02 | **DONE** at `fa399c2` |
| L-006 finding #2 (activeCatalog=[]) | T-02 | **DONE** |
| L-006 finding #3 (session ID) | T-02 | **DONE** |
| L-006 finding #4 (matched rebuild) | T-02 | **DONE** |
| L-006 finding #5 (transport + streaming) | T-02 + T-03 | **DONE** at T-02; streaming at T-03 committed `fb75813` |

### Folded into 7b.1B (T-03..T-06, in-flight at write-time)

| Carry-forward item | Task | Status |
|---|---|---|
| Streaming proxy + response-first tail | T-03 | Committed `fb75813` |
| Metrics v2 + R-2 denominator edge | T-04 | Committed `33b46ab` |
| Acceptance evaluator | T-05 | Pending |
| Snapshot collector + smoke | T-06 | Pending |

### Deferred to v3.1+

| Item | Why deferred |
|---|---|
| `/metrics` pino info logging | Fastify boot intentionally disables request logging; snapshot artifacts supersede it for the gate. Adding a no-op logger doesn't improve evidence. |
| `POST /catalog/rebuild` TEMP+rename | Real production rebuild is a separate cold-path persistence feature (L-008 deferred-wiring pattern). Runbook uses `npm run build-index` + restart. |
| test#366 `[42900,43000]` port exhaustion | Phase 7b smokes use dedicated range `[48900,48999]` + robust cleanup. Widening the global default range is unrelated to empirical acceptance. |

---

## 6. Honest uncertainty — T-05 + T-06 not yet landed

This retrospective was authored in parallel with the 7b.1B Implementer. At write-time:

- **T-03 + T-04 committed:** streaming proxy + response-first tail + metrics v2.
- **T-05 + T-06 not yet committed:** acceptance evaluator + snapshot collector + synthetic smoke + runbook.
- **Unknown:** Whether T-05 + T-06 will land cleanly in 7b.1B or require a 7b.1C sub-batch. The Implementer dispatched at 2026-08-03 with 4 tasks; if context saturates around T-05 (evaluator's 30+ fixture matrix per `tasks.md §5`), a second casualty is possible.
- **Watch items:** If T-05 commits but T-06 (snapshot + smoke + runbook) does not, Phase 7b.1 cannot fully pass to a Verifier (smoke is required for AC-13). The orchestrator should consider 7b.1C = T-06 only if 7b.1B returns T-05 complete + T-06 partial.

This uncertainty is recorded explicitly per the `feedback-verifier-honest-uncertainty` MEMORY pattern (2026-07-28).

---

## 7. Recommendations for v3.1+

1. **Prophylactic batch split for any phase > 4 atomic tasks.** The 4-task sub-batch cap fits within sub-agent context budgets for production-wiring depth. Batch 1A (T-01..T-02, wiring) + Batch 1B (T-03..T-04, transport + metrics) + Batch 1C (T-05..T-06, evaluator + snapshot) would have prevented the Implementer #1 casualty. L-010.
2. **Toolchain `npm` script that runs `node --experimental-strip-types --no-warnings` on a smoke TS file.** Detect strip-types incompatibilities (parameter properties, enum declarations, etc.) at gate-time rather than at runtime. Pre-commit gate could add `node --experimental-strip-types --check <each-new-ts-file>`.
3. **Move production wiring fixes (L-006 class) into the Planner's pre-implementation source audit by default.** Currently this is per-Planner judgment. A reusable L-006 checklist (state.json consumption, hardcoded IDs, system rebuilds, transport stripping, streaming missing) would catch the same shape of bug across phases.
4. **Auto-WIP checkpoint protocol.** When sub-agent context exceeds N% saturation (heuristic: ~6 atomic tasks or ~3 commits worth of new code), automatically commit WIP and request fresh dispatch. Manual inspection today.
5. **Real-mode default detection for sub-agent outputs.** When Implementer returns "DONE" but the output is shorter than expected or contains toolchain error markers, treat as casualty. Don't trust "DONE" alone.

---

## 8. Loop operational improvements

- **SPLIT BATCH 1 INTO 1A + 1B when > 4 tasks.** Single-batch 5-7h estimates have now produced 2 casualties (Phase 4.4 + Phase 5a.2 + Phase 7b Implementer #1). Cap sub-agent batches at 4 atomic tasks. Phase 7b should have been dispatched as 7b.1A (T-01..T-02) + 7b.1B (T-03..T-04) + 7b.1C (T-05..T-06) from the start.
- **WATCH FOR API 429 with explicit WIP checkpoint protocol.** If a sub-agent shows signs of context saturation (output shrinking, toolchain errors mid-task, garbled partial file), commit WIP immediately and dispatch fresh. Don't wait for full casualty.
- **L-006 SOURCE INSPECTION before every Implementer dispatch.** The Planner's pre-implementation grep of `src/server/**` + `.memory-studio/state.json` saved Phase 7b from validating a stub path. Make this a default sub-step, not per-Planner judgment.
- **Batch sizing rule: 2 commits + 2 test scaffolds = 1 sub-agent dispatch.** Rough heuristic: a sub-agent can comfortably land 2 atomic commits (each with new TS file + test scaffold + pre-commit gates) before context saturates.
- **Toolchain gates BEFORE runtime gates.** The TS strip-types bug was discovered at runtime (`node scripts/acceptance-gate.mjs` failed) but `tsc --noEmit` accepted the syntax. Add a strip-types smoke gate to pre-commit to catch this class earlier.

---

## 9. L-009 + L-010 lessons recorded

Two new lessons captured via `scripts/lessons.py add`:

- **L-009** (`gate_fail` signal, scope `src/server/**/*.ts`) — Node 22 `--experimental-strip-types` does NOT support TypeScript parameter properties. Use explicit field declarations + constructor-body assignment. Symptom: TypeError on module load. Fix: replace `constructor(private foo: Bar)` shorthand with explicit `declare`/`readonly` field + assignment in constructor body. Source: `src/server/config/runtime-state.ts:1`.
- **L-010** (`surviving_mutant` signal, scope `loop orchestration + batch sizing`) — Implementer sub-agent context limits at 5-7h batch (~6 atomic tasks). L-007 protocol: if API 429 risk detected, commit partial work as WIP, return structured report. Actually-occurred: Phase 7b Implementer #1 returned corrupted output mid-T-01, Implementer #2 hit API 429 token limit mid-T-03. Both recovered via WIP commits. RECOMMENDATION: split batches > 4 tasks into 1A+1B.

---

## 10. Related artifacts

- **Phase 7b contracts:** `.specs/features/phase-7b-acceptance-gate/{spec,design,tasks}.md`
- **Phase 7a baseline:** `.specs/features/phase-7a-metrics/validation-phase-7a.md`
- **L-006 → AD-010:** `.specs/DISCOVERIES.md` (AD-010 appended 2026-08-03)
- **Lessons store:** `.specs/lessons.json` + `.specs/LESSONS.md` (regenerated)
- **Commits chain:** `9024006` (Phase 7a close) → `298ea31` (Planner artifacts) → `3331660` (WIP) → `8449251`/`aac824b`/`fa399c2` (T-01 + T-02) → `fb75813`/`33b46ab` (T-03 + T-04) → `[pending]` (T-05 + T-06)
- **HEAD at write-time:** `173c8d7` (handoff update for 7b.1B in-flight)
- **MEMORY.md:** updated 2026-08-03 with `ts-parameter-property-strip-types.md`, `phase-7b-implementer-context-limits.md`, `memory-studio-v3-1-deferred-items.md`

---

**Retrospective complete. 7b.1A verified PASS, 7b.1B in-flight pending T-05 + T-06, 7b.2 (T-07) is human-driven wall-clock gate, 7b.3 (T-08) is deterministic hydration closure. Phase 7b is the last phase; closure = Memory Studio in production.**
