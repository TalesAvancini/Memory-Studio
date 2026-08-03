---
date: 2026-08-02
version: 1
description: "Phase 7b operator runbook — human-driven seven-day real evidence collection for the acceptance gate. This runbook is operational, not aspirational: it lists prerequisites, daily cadence, threshold-tuning rules, and stop conditions."
explanation: |
  Phase 7b is the FINAL roadmap phase. The autonomous engineering work
  (T-01..T-06) shipped the gate machinery — but the seven-day real
  evidence collection (T-07) MUST be done by a human operator working
  with real coding agents. The Implementer / orchestrator MUST NOT
  simulate this, idle-loop for a week, backdate artifacts, or
  reinterpret synthetic smoke as real evidence.

  Read this runbook BEFORE booting the augment server for the
  seven-day window. Misalignment here invalidates the entire evidence
  set.
related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ../../STATE.md
  - ../../../.memory-studio/state.json
---

# Phase 7b Operator Runbook (T-07)

**Status:** T-01..T-06 committed. T-07 begins AFTER the orchestrator reports "T-06 PASS, awaiting human evidence".

## 1. Pre-flight checklist (do this BEFORE starting the clock)

| Step | Action | Why |
|---|---|---|
| 1.1 | Confirm all T-01..T-06 commits are merged on `loop/phase-0`. | T-07 evidence is invalid without the production wiring. |
| 1.2 | Run `npm test` — expect 478+ tests PASS. | Catch regressions before starting the seven-day clock. |
| 1.3 | Run `npm run typecheck` — exit 0. | Type safety before the evidence window. |
| 1.4 | Run `node scripts/smoke-acceptance-gate.mjs` — exit 0, all checks PASS. | Synthetic gate machinery is wired correctly. |
| 1.5 | Build the on-disk catalog DB: `npm run build-index`. | The augment server needs the real catalog for the gate to be measurable. |
| 1.6 | Set `MEMORY_STUDIO_CATALOG_DB_PATH=<path>` and `MINIMAX_API_KEY=<real-key>` in your shell. The key is NEVER committed. | Real provider / fast-agent mode required for T-07 (R-9.5). |
| 1.7 | Set `MEMORY_STUDIO_STATE_PATH=.memory-studio/state.json` (default — verify). | Production boot reads state from this path. |
| 1.8 | Edit `.memory-studio/state.json` and confirm `activeCatalog` is NON-EMPTY with at least one skill/rule/persona. | Empty activeCatalog short-circuits the pipeline at Stage 2. |
| 1.9 | Boot the augment server in another terminal: `npm run server:start`. Verify the log shows `MODE=real` for the fast agent. | The log proves real mode is active. |
| 1.10 | Spot-check one real `/v1/messages` request with your real coding agent. Verify the system prompt is preserved (R-4), `usage.cache_read_input_tokens > 0` for stable prompts (R-2), and audit rows are written. | Catch transport / cache / audit bugs before starting the seven-day clock. |
| 1.11 | Capture the FIRST real snapshot via `scripts/snapshot-metrics.mjs` with `--source real`. This anchors the evidence timeline. | The first snapshot's `captured_at` is the epoch start. |

## 2. Daily / per-session cadence

For each qualifying coding session (a single Claude Code / Mavis / Cursor session with a stable identity):

| Step | Action |
|---|---|
| 2.1 | Work normally. Do NOT repeat a canned benchmark script as "real" evidence — that would invalidate the run. |
| 2.2 | Use ONE stable session identity per session. The proxy's `x-memory-studio-session-id` header should be set to a unique value per session. The header is hashed before storage; the raw value is never persisted. |
| 2.3 | Complete at least 10 audited turns per qualifying session. |
| 2.4 | End the session by capturing a real snapshot: |

```bash
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:42900 \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots
```

| Step | Action |
|---|---|
| 2.5 | Review the deterministic threshold-tuning recommendation by running the gate (read-only) with the new snapshot: |

```bash
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
```

The output's `tuning_recommendation` tells you the next action: `freeze`, `lower_cosine`, `lower_fts`, `inspect_cache`, `fix_performance`, `wait`, or `escalate`. **Do not act on `lower_*` until you have ≥1 qualifying session at the current pair.**

| Step | Action |
|---|---|
| 2.6 | If the recommendation is `lower_cosine` or `lower_fts`, AND you have ≥1 qualifying session at the current pair, capture a BOUNDARY snapshot FIRST, then change ONE field in `.memory-studio/state.json` (use the existing atomic temp+rename pattern or a small server config writer), then capture another snapshot. The new threshold pair starts a new threshold epoch. |
| 2.7 | If the recommendation is `freeze`, do NOT change thresholds. Continue collection. |
| 2.8 | If the recommendation is `inspect_cache`, do NOT lower relevance thresholds. The cache failure is in the cacheable-prefix / TTL / transport seam — not in the retrieval gate. Investigate byte stability of the system prompt, actual forwarded system blocks, cacheable-prefix size, provider/model support, and header/body preservation. |
| 2.9 | If the recommendation is `fix_performance`, freeze thresholds. Investigate p50/p99/working-set — do not tune relevance to hide a performance failure. |
| 2.10 | If the recommendation is `escalate` (cosine at floor 0.50 and hit rate still failing), STOP. Phase 7b is blocked. |

## 3. Stop / failure conditions

| Condition | Action |
|---|---|
| Seven days not yet elapsed | WAIT. Continue collection. |
| Fewer than 5 qualifying sessions | CONTINUE. Run a longer / more varied session. |
| Fewer than 50 total qualifying turns | CONTINUE. |
| Lower bounds reached (cosine 0.50, FTS 1) and hit rate still failing | ESCALATE. Do not lower below the floor. |
| Real provider or real fast agent unavailable | PAUSE. Do not switch to stub evidence. |
| Threshold change without a boundary snapshot | Recapture cleanly. Do not hand-edit counters. |
| Production transport / system / audit bug found | Stop the affected evidence window, fix, restart the interval honestly. Document the restart in `threshold-tuning.md`. |
| Hit rate OK but cache coverage failing | `inspect_cache` — do NOT lower relevance thresholds. |
| Cache hit rate failing AND provider returned 200 with NO `usage` block | Confirmed R-2 fix is in effect (Phase 7b T-04). Continue. |

## 4. What to return to the orchestrator after T-07

```bash
# The committed snapshot directory:
.specs/acceptance/snapshots/*.json

# The state.json at the end of the run:
.memory-studio/state.json

# The tuning log:
.specs/features/phase-7b-acceptance-gate/threshold-tuning.md
```

**DO NOT include in the return:**
- API keys or authorization headers.
- Raw prompts, responses, or context blocks.
- Raw session IDs (the snapshot only contains hashed session IDs).
- Any secret-like values.

If a secret appears in a snapshot by accident, REMOVE that snapshot, ROTATE the exposed credential, FIX the collector, and recapture. Never commit the leak.

## 5. The mechanical completion check

```bash
node scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
```

This MUST exit 0 (without `--allow-synthetic`) and report `eligible_for_phase_closure: true` BEFORE T-07 is considered complete.

If the gate reports `verdict=FAIL`, the failing criterion IDs are listed on stderr. The Phase 7b run is NOT complete — go back to the relevant step.

## 6. What the gate is checking (PRD §10.2 + §14.6)

| Budget | Strict inequality |
|---|---|
| `request_hit_rate` | `> 0.70` (over the final threshold epoch) |
| `token_cache_coverage` | `> 0.60` (over the final threshold epoch) |
| `p50_latency_ms` | `< 50` (worst observed across qualifying real snapshots) |
| `p99_latency_ms` | `< 200` (worst observed across qualifying real snapshots) |
| `working_set_mb` | `< 1500` (worst observed, with ≥1h sustained process epoch) |

Both cache ratios are mandatory (AND, not OR). Null, NaN, Infinity, zero denominator, unsupported schema, or missing metric all FAIL.

## 7. Evidence eligibility requirements

| Requirement | Threshold |
|---|---|
| Wall-clock span | `max(audit.ts) - min(audit.ts) >= 604_800_000ms` (7 × 24 hours) |
| Distinct sessions | ≥ 5 (each with ≥ 10 audited turns) |
| Total qualifying turns | ≥ 50 |
| Snapshot source | `real` only (synthetic is rejected in production mode) |
| Provider mode | `anthropic-real` |
| Fast agent mode | `real` |
| Runtime mode | `production` |
| Audit | `complete: true` (HTTP `/audit` may be truncated — direct SQLite aggregate is final source) |
| Monotonic snapshots | Strictly non-decreasing `captured_at` |
| Final threshold epoch | ≥ 2 sessions, ≥ 20 turns |

## 8. Deferred items (per Phase 7b spec §4)

| Item | Resolution |
|---|---|
| `/metrics` pino info logging | Deferred to v3.1+. Production boot deliberately disables Fastify request logging. |
| `POST /catalog/rebuild` TEMP+rename production wiring | Deferred to v3.1+. This runbook uses `npm run build-index` + controlled server restart. The endpoint is a no-op fallback. |
| test#366 port-range cleanup | Deferred to v3.1+. Phase 7b smokes use dedicated port ranges (e.g. `[48900, 48999]`) and robust cleanup. |

## 9. What happens after T-07

If the gate exits 0 with `eligible_for_phase_closure: true`:

1. The orchestrator dispatches T-08 (autonomous final hydration).
2. T-08 runs the evaluator against the committed snapshots, generates the dated `acceptance-YYYY-MM-DD.md` report, and verifies the final `.memory-studio/state.json` pair matches the evaluator-selected final threshold epoch.
3. An independent Verifier confirms T-08 output.
4. ROADMAP Phase 7b flips to `[x]`.
5. Memory Studio is declared production-ready.

If the gate does NOT exit 0, Phase 7b stays `[ ]` and the orchestrator dispatches a fresh Implementer for remediation per the failing criterion IDs.
