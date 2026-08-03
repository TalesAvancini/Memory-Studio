---
date: 2026-08-02
version: 1
description: "Phase 7b — Empirical Tuning + Acceptance Gate spec. Defines the autonomous scaffolding, unavoidable seven-day human production run, deterministic hydration closure, real-provider eligibility rules, final threshold evidence, and carry-forward fixes required before Memory Studio can be declared production-ready."
explanation: |
  Phase 7b is the final roadmap phase, but its real-session evidence cannot be
  manufactured by an autonomous sandbox. This spec therefore separates the
  work into three ordered execution stages: 7b.1 builds and proves the gate,
  7b.2 is an explicit human-operated seven-day wall-clock collection, and
  7b.3 deterministically hydrates the final report only after the gate passes.

  L-006 inspection of current source found two production blockers beyond the
  ranked carry-forward list: `.memory-studio/state.json` thresholds are not
  consumed by `runAugment`, and the transparent proxy rebuilds an empty system
  message instead of forwarding the pipeline's matched system blocks. The
  proxy also strips general request fields/credentials and has no streaming
  response measurement path. These are included because a real Claude Code,
  Mavis, or Cursor acceptance run would otherwise measure a stubbed or
  non-functional path rather than Memory Studio.

  Phase 7a's request-weighted provider-cache metric remains the Phase 7b
  roadmap contract. The exact token-weighted PRD §14.6 enhancement remains
  v3.1+; Phase 7b does not silently rename or substitute it.
related:
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../DISCOVERIES.md
  - ../phase-7a-metrics/spec.md
  - ../phase-7a-metrics/design.md
  - ../phase-7a-metrics/tasks.md
  - ../phase-7a-metrics/validation-phase-7a.md
  - ../phase-6b-fast-agent-intel/validation-phase-6b.4.md
  - ../../../PRD.md
  - ../../../CLAUDE.md
  - ../../../.memory-studio/state.json
---

# Phase 7b — Empirical Tuning + Acceptance Gate — Spec

**Phase:** 7b  
**Slug:** `phase-7b-acceptance-gate`  
**Source:** `.specs/ROADMAP.md:972-1001`  
**Branch:** `loop/phase-0`  
**Baseline:** Phase 7a verified at `ca3b22c` on 2026-08-02; 478 root + 152 UI + 16 SDK tests green; `GET /metrics` schema v1 present.  
**Goal:** make production acceptance mechanical and honest: first repair the runtime seams that would invalidate a real measurement, then collect at least seven wall-clock days of non-synthetic traffic in at least five qualifying sessions, then generate the final report and freeze the thresholds only when every required gate passes.  
**Estimate:** 5-7h autonomous engineering + at least 7 days wall-clock user operation + 0.5-1.5h autonomous closure. The larger autonomous estimate replaces ROADMAP's optimistic 3-4h because L-006 source inspection found production wiring that must be corrected before measurement.

---

## 0. Terms and execution states

| Term | Meaning |
|---|---|
| **7b.1 — autonomous scaffolding** | Implementer work that requires no real provider credentials: production wiring fixes, metric-contract fixes, acceptance evaluator, snapshot tool, tests, and synthetic smoke. Completing 7b.1 does **not** close Phase 7b. |
| **7b.2 — user-driven wall-clock gate** | A human operates Memory Studio against real coding-agent traffic and a real provider for at least 7 × 24 hours, using at least five distinct sessions with at least ten turns each. This stage cannot be delegated to the sandbox or replaced with generated timestamps. |
| **7b.3 — hydration closure** | After real evidence is returned, the Implementer runs the deterministic evaluator, writes `acceptance-YYYY-MM-DD.md`, freezes final thresholds in `.memory-studio/state.json`, and reruns all gates. |
| **qualifying session** | A distinct hashed session identity with at least 10 completed, audited turns. Raw session IDs are never persisted. |
| **qualifying snapshot** | A `source: "real"` snapshot from a real provider/runtime, with complete audit evidence, at least 10 turns since the preceding snapshot in its threshold epoch, and metrics schema supported by the evaluator. |
| **threshold epoch** | A contiguous interval during which both `minCosineSimilarity` and `minFtsHits` are unchanged. A threshold change starts a new epoch. |
| **final threshold epoch** | The last epoch, containing at least two qualifying sessions and at least 20 completed turns, from which the final cache ratios are computed. |

---

## 1. Requirements (R-NN)

### R-1 — Ordered three-stage execution; no synthetic closure

Phase 7b MUST execute in this order:

1. **7b.1:** autonomous implementation and synthetic smoke.
2. **7b.2:** human-operated real sessions over at least seven wall-clock days.
3. **7b.3:** deterministic report hydration and threshold freeze.

The orchestrator MUST pause after 7b.1. A passing synthetic smoke proves only that the gate machinery works. It MUST NOT:

- mark Phase 7b `[x]`;
- create a final report with `verdict: PASS`;
- label synthetic snapshots as real;
- generate backdated snapshot timestamps;
- substitute stub-provider cache hits for real provider evidence.

**References:** ROADMAP Phase 7b done criteria; L-008 deferred-wiring discipline.

### R-2 — `.memory-studio/state.json` is the runtime threshold authority

The production `/augment` and `/v1/messages` paths MUST consume these exact fields from `.memory-studio/state.json`:

```json
{
  "thresholds": {
    "minCosineSimilarity": 0.6,
    "minFtsHits": 2
  }
}
```

The current file's `0.60 / 2` values are the **configured initial baseline**. The current code's effective hard-coded defaults (`0.75 / 1` from `src/search/types.ts`, reached because `pipeline.ts` calls `applyThresholds(ranked)` with no options) MUST be recorded as the **pre-7b effective baseline**, not misreported as the configured baseline.

Production rules:

- State is read through one `src/server/**` adapter; no code under `src/search/**` is modified.
- `runAugment` receives resolved thresholds through `PipelineContext` and passes them to `applyThresholds`.
- `activeCatalog` is read from the same state snapshot so catalog selection and thresholds cannot drift within a request.
- Invalid/missing production threshold fields fail startup loudly when an on-disk production DB is configured. Tests and synthetic smoke may inject an explicit fixture state.
- A final threshold value written to state MUST demonstrably change the runtime gate. A documentation-only value is a failure.
- Field names in state remain camelCase. The final report also prints their roadmap aliases `min_cosine_similarity` and `min_fts_hits`.

### R-3 — Production boot uses the on-disk runtime, not the in-memory stub

When `MEMORY_STUDIO_CATALOG_DB_PATH` is configured, direct `npm run server:start` production boot MUST provide `/augment` and `/v1/messages` with:

- the opened on-disk SQLite DB;
- the real `MultilingualE5SmallEmbedder` already present in the repository;
- the canonical catalog directory (`config/catalog/`, or an explicit server option/env override);
- the resolved runtime state from R-2;
- intel read/write hooks where a session identity is available.

The in-memory zero-vector provider remains valid only for tests and explicit smoke fixtures. A real acceptance snapshot MUST record `runtime_mode: "production"`; the evaluator rejects `runtime_mode: "stub"` for closure.

### R-4 — Transparent proxy forwards the actual augmented system

The proxy MUST stop rebuilding `buildSystemMessage(augmentReq, { matched: [] })` after the pipeline returns. Instead, an internal detailed pipeline seam MUST return both:

- the existing public `AugmentResponse`; and
- the exact two-block system structure whose canonical SHA is in `AugmentResponse.systemMessage`.

The existing public `runAugment(...): Promise<AugmentResponse>` contract remains backward compatible. The proxy-only detailed seam MAY be a sibling function or an internal result type.

Proxy system invariants:

1. The caller's original Anthropic `system` text/blocks are preserved verbatim in the stable prefix; Memory Studio augments rather than deletes the coding agent's system prompt.
2. Matched persona/skill/rule/intel text from the pipeline is present in the forwarded system blocks.
3. The SHA recorded in audit is the SHA of the exact Memory Studio system blocks forwarded upstream.
4. The no-intel baseline remains deterministic when the same original system + active state + request inputs repeat.
5. No locked layer is modified.

### R-5 — Proxy request/session/transport compatibility for real sessions

The proxy MUST support the real Anthropic Messages request surface needed by target coding agents without inventing a second provider protocol:

- Known validated fields (`model`, `max_tokens`, `system`, `messages`) remain validated.
- Additional Anthropic request fields (including `stream`, `tools`, `tool_choice`, `metadata`, and future fields) are passed through rather than silently stripped.
- Only an explicit header allowlist is forwarded: `x-api-key`, `authorization`, `anthropic-version`, `anthropic-beta`, and `content-type`. Credential values are never logged or persisted.
- Upstream status and `content-type` are preserved.
- Both non-streaming JSON and `text/event-stream` responses are supported.
- Streaming bytes are relayed without buffering the full response before the client receives them. A bounded tee/parser may inspect usage and assistant text.

Session identity precedence:

1. Optional `x-memory-studio-session-id` request header, hashed before storage/use.
2. Otherwise, deterministic SHA-256 over the stable original-system text plus the first user prompt.

Only the hash enters `PipelineContext`, intel rows, snapshots, or audit metadata. The existing literal session ID `"proxy"` MUST NOT remain the production identity because it collapses distinct sessions and makes the ≥5-session gate impossible to prove.

### R-6 — Full response-first fast-agent scheduling in the proxy

For proxy traffic, the inception sequence is:

1. Turn N reads previously stored intel, if any, before retrieval.
2. Turn N is forwarded and streamed/returned to the human without waiting for new intel extraction.
3. After the upstream response completes, a tail-scheduled callback extracts assistant response text, calls the existing fast agent, and writes the resulting intel under the hashed session identity.
4. Turn N+1 reads that stored intel.

The proxy MUST use the active catalog from R-2 so it no longer short-circuits before Stage 1b. The existing request-latency path MUST not await the response-side fast agent.

**429 rule (L-007):** a fast-agent 429 or other failure in the tail is fail-open. Existing SDK retry behavior may run, but Phase 7b adds no unbounded custom retry loop. The provider response remains successful; the failure is logged without a key/raw response, and the next turn uses prior intel or the empty sentinel.

### R-7 — Phase 7a metric-contract resolutions required by acceptance

Phase 7b resolves the ranked Phase 7a gaps as follows:

1. **HTTP 200 without `usage.cache_read_input_tokens`:** record a cache miss (`cacheReadTokens: 0`) and increment `proxy_requests`. Every completed HTTP 200 belongs to the denominator.
2. **Window semantics:** ratio counters are cumulative within one process epoch; latency percentiles are over the last 100 samples. The misleading Phase 7a “sliding N=10/60s” wording is corrected. N=10 or T=60s is a **recompute cadence**, not ratio-counter eviction.
3. **Latency types:** `p50_latency_ms` and `p99_latency_ms` remain finite non-negative fractional milliseconds. Precision is retained; comments/specs MUST not claim integer values.
4. **Evidence counters:** `/metrics` schema is bumped to `schema_version: 2` and adds a non-sensitive evidence block:

```typescript
interface MetricsEvidenceV2 {
  matched_requests: number;
  attempted_requests: number;
  cache_hit_requests: number;
  proxy_requests: number;
  latency_sample_count: number;
  process_started_at: number;
}
```

Existing v1 fields remain backward compatible. Raw counters permit exact snapshot deltas across threshold epochs and process restarts; rates MUST equal their corresponding counter ratios.

The missing `/metrics` pino info log is **not** required for acceptance because production boot deliberately disables Fastify request logging. It is deferred to v3.1+ rather than adding a misleading no-op logger.

### R-8 — Snapshot artifact contract

`scripts/snapshot-metrics.mjs` writes one immutable JSON file under:

```text
.specs/acceptance/snapshots/<ISO-UTC-safe-timestamp>.json
```

Required envelope:

```json
{
  "schema_version": 1,
  "captured_at": "2026-08-09T12:00:00.000Z",
  "source": "real",
  "provider_mode": "anthropic-real",
  "fast_agent_mode": "real",
  "runtime_mode": "production",
  "metrics_url": "http://127.0.0.1:42900/metrics",
  "thresholds": {
    "minCosineSimilarity": 0.6,
    "minFtsHits": 2
  },
  "metrics": {},
  "audit": {
    "complete": true,
    "first_event_ts": 0,
    "last_event_ts": 0,
    "turns_by_session_hash": {}
  }
}
```

Rules:

- `source` is exactly `real` or `synthetic`; production gate ignores/rejects synthetic evidence.
- Real mode must be explicit; the script does not default to `real`.
- Preferred audit source is the configured SQLite DB so all rows are available. HTTP `/audit` fallback is allowed for diagnostics, but final closure requires `audit.complete: true`.
- Snapshot filenames are collision-safe and writes are temp+rename atomic.
- Snapshots contain no raw prompt, response, context, credential, provider key, or raw session ID.
- The script records hashes of evidence inputs so the final report can list them.
- Network/non-200/malformed JSON errors exit non-zero and do not leave a partial file.

### R-9 — Real-session eligibility gate

Production acceptance requires all of the following:

1. `max(audit.ts) - min(audit.ts) >= 604_800_000ms` (7 × 24 hours), not merely seven calendar date labels.
2. At least five distinct hashed session identities.
3. At least five sessions each have at least ten completed audited turns.
4. At least 50 qualifying turns total.
5. Evidence comes only from `source: "real"`, `provider_mode: "anthropic-real"`, `fast_agent_mode: "real"`, and `runtime_mode: "production"` snapshots.
6. Audit evidence is complete.
7. Snapshot timestamps and audit timestamps are monotonic and not in the future relative to evaluator time beyond a 5-minute clock-skew allowance.
8. The final threshold epoch contains at least two qualifying sessions and at least 20 turns.

A process restart does not erase the persistent audit span. Metrics schema v2 counters identify process epochs; the evaluator uses non-negative counter deltas within each process epoch and never subtracts across a restart.

### R-10 — Acceptance budgets and strict inequalities

The final gate uses strict inequalities exactly as ROADMAP states:

| Budget | Evaluation |
|---|---|
| Match request hit rate | `Σ final_epoch_delta.matched_requests / Σ final_epoch_delta.attempted_requests > 0.70` |
| Provider request cache coverage | `Σ final_epoch_delta.cache_hit_requests / Σ final_epoch_delta.proxy_requests > 0.60` |
| p50 latency | maximum observed `p50_latency_ms` across qualifying real snapshots with at least 10 turns is `< 50` |
| p99 latency | maximum observed `p99_latency_ms` across qualifying real snapshots with at least 10 turns is `< 200` |
| Working set | maximum observed `working_set_mb` across qualifying real snapshots is `< 1500`, and at least one contributing process epoch has `window_age_ms >= 3_600_000` (sustained ≥1h) |

Both cache ratios are mandatory (**AND**, not OR). Null, NaN, Infinity, a zero denominator, an unsupported schema, or a missing metric is FAIL.

The report prints:

- aggregate final-epoch cache ratios;
- worst observed qualifying p50/p99/working-set values;
- latest snapshot values for operator context;
- numerator/denominator counts;
- strict threshold comparison and PASS/FAIL per budget.

The max-observed latency/memory rule is intentionally stronger than cherry-picking the final snapshot.

### R-11 — Deterministic threshold-tuning algorithm and empirical log

The initial threshold values are `0.60 / 2`. The tuning log MUST also disclose that pre-7b runtime effectively used `0.75 / 1` because state was not wired.

Tuning is one-variable-at-a-time and session-bounded:

1. Run at least one qualifying session (≥10 turns) at the current pair and capture a snapshot before changing state.
2. If `request_hit_rate <= 0.70`, count `below_cosine_threshold` and `below_fts_threshold` audit rejections for that epoch:
   - cosine rejections greater than FTS rejections: lower cosine by `0.05`, floor `0.50`;
   - FTS rejections greater than cosine rejections and `minFtsHits > 1`: lower FTS by `1`, floor `1`;
   - tie: lower cosine by `0.05` first;
   - change only one field and start a new threshold epoch.
3. If `request_hit_rate > 0.70` but provider cache coverage `<= 0.60`, freeze retrieval thresholds. This is a cache-prefix/transport/session-cadence problem, not evidence to lower relevance gates.
4. If latency or memory fails, freeze thresholds and fix runtime performance; do not tune relevance to hide a performance failure.
5. When both cache ratios and all performance budgets pass, freeze the pair and collect at least two qualifying sessions / 20 turns at that exact pair.
6. If the lower bounds are reached and the hit-rate gate still fails, Phase 7b fails and escalates. The algorithm MUST NOT invent a lower bound or waive the gate.

Each tuning-log row records: epoch timestamps, values before/after, qualifying sessions/turns, raw ratio counters, rejection counts, p50/p99/working set, action, and deterministic reason. No subjective “looks good” row may select the final pair.

### R-12 — Deterministic report hydration and closure

`src/server/acceptance/acceptance-report.ts` is the typed evaluator/renderer. `scripts/acceptance-gate.mjs` is the CLI gate.

Required behavior:

- Validate every snapshot before aggregation.
- Ignore synthetic evidence in production mode and report how many files were ignored.
- Sort by `captured_at`, identify process and threshold epochs, and compute deltas from v2 evidence counters.
- Detect counter regressions inside a process epoch, duplicate/colliding snapshot timestamps, unsupported schemas, threshold changes without a boundary snapshot, and incomplete audit evidence.
- Produce the same evaluation for the same input bytes and evaluator date.
- Exit `0` only when every R-9/R-10/R-11 criterion passes; otherwise exit non-zero with failed criterion IDs.
- `--allow-synthetic` exists only for smoke/testing and always outputs `eligible_for_phase_closure: false`.
- The final Markdown report is generated from evaluation data; operators do not hand-edit metric numbers or verdicts.

Final report location:

```text
.specs/features/phase-7b-acceptance-gate/acceptance-YYYY-MM-DD.md
```

The report has YAML frontmatter and these sections: Verdict, Evidence Eligibility, Session Coverage, Budget Table, Threshold Tuning Log, Runtime/Provider Modes, Snapshot Hashes, Gate Commands, Deferred Items, and Conclusion.

### R-13 — Synthetic integrated smoke proves machinery, not production

`scripts/smoke-acceptance-gate.mjs` MUST:

- use a dedicated port range outside `[42900,43000]`;
- boot a real Fastify Memory Studio process with injected fixture DB/embedder/state and a local stub Anthropic upstream;
- drive at least ten turns through `/v1/messages`, including cache miss then repeated stable-prefix cache hits;
- verify the proxy forwards a non-empty augmented system and the response-first intel write completes after the response;
- snapshot `/metrics` as `source: "synthetic"`;
- exercise both passing and failing evaluator fixtures, including a synthesized seven-day/five-session fixture set;
- prove production mode rejects those same synthetic snapshots;
- clean up child processes on Windows and POSIX.

No generated fixture may be moved into the real snapshot directory or used by T-08.

### R-14 — No new dependencies and strict scope guard

No new npm dependency is added. Node 22 built-ins and existing dependencies are sufficient.

Allowed product/runtime scope:

- `src/server/**`
- `scripts/**`
- `test/**`
- `.specs/**`
- `.memory-studio/state.json`

Locked layers MUST remain untouched:

- `src/search/**`
- `src/social-detector/**`
- `src/fingerprint/**`
- `packages/sdk/**`
- `packages/ui/**`
- `CLAUDE.md`

---

## 2. Acceptance Criteria (AC-NN)

### AC-1 — Runtime state changes threshold behavior (R-2)

With a fixed ranked fixture near the boundary, changing only state from `0.60/2` to `0.75/1` changes the expected pass/reject result. The test goes through the production state adapter and pipeline seam; it does not call `applyThresholds` directly with hand-written options.

### AC-2 — Production boot is non-stub when DB configured (R-2, R-3)

A boot integration test with an on-disk fixture DB and injected real-mode embedder factory asserts both `/augment` and proxy contexts use that DB, canonical catalog directory, active catalog, and state thresholds. Production mode does not instantiate the zero-vector in-memory context.

### AC-3 — Proxy forwards exact augmented system and preserves original (R-4)

A non-streaming stub upstream captures the forwarded request. Assertions:

- original system bytes remain present and ordered before Memory Studio's dynamic suffix;
- active fixture items appear in the forwarded system;
- proxy audit SHA equals the canonical SHA of the actual Memory Studio blocks;
- the old empty `{ matched: [] }` rebuild path is absent;
- repeated identical stable inputs are byte-identical.

### AC-4 — Proxy forwards compatible request fields and safe headers (R-5)

A fixture request containing `tools`, `tool_choice`, `metadata`, an unknown future field, `stream: false`, and test credential headers reaches the upstream with those fields/allowed headers intact. Audit/log output contains none of the credential values. A disallowed header is not forwarded.

### AC-5 — Streaming proxy captures usage without buffering (R-5, R-7)

A stub SSE upstream emits multiple delayed events and a terminal usage event. The client receives the first event before the upstream finishes. On completion, metrics/audit contain the expected cache tokens and proxy denominator. Upstream status/content-type are preserved.

### AC-6 — Response-first fast-agent path is end-to-end (R-6)

Two-turn streaming and non-streaming integration cases prove:

- Turn N response completes before fast-agent/write completion;
- the tail reads assistant response text, not the user prompt;
- intel is stored under a hashed per-session identity;
- Turn N+1 reads that intel and includes it in Block 2;
- an injected 429/error leaves the provider response intact and does not create an unbounded retry loop.

### AC-7 — Successful response missing usage is a counted miss (R-7)

A 200 JSON response with no `usage`, and a completed 200 SSE response with no cache usage field, each increment `proxy_requests` by one and `cache_hit_requests` by zero. `token_cache_coverage` becomes `0`, not `null`.

### AC-8 — Metrics v2 evidence is internally consistent (R-7)

`GET /metrics` returns schema v2 plus evidence counters. Tests assert:

- `request_hit_rate === matched_requests / attempted_requests` when denominator >0;
- `token_cache_coverage === cache_hit_requests / proxy_requests` when enabled/denominator >0;
- counters are cumulative within a process epoch;
- p50/p99 accept fractional values and retain the last-100-sample behavior;
- `process_started_at` is stable for the process.

### AC-9 — Snapshot writer is atomic, redacted, and strict (R-8)

A test captures metrics + complete fixture audit and validates the exact envelope, collision-safe filename, input hashes, and absence of raw prompts, responses, credentials, and raw session IDs. A malformed/non-200 metrics response exits non-zero and leaves no final or temp artifact.

### AC-10 — Eligibility gate rejects insufficient evidence (R-9, R-12)

Independent fixtures fail for each condition: span one millisecond below seven days; only four qualifying sessions; one session with nine turns; incomplete audit; stub runtime; stub fast agent; synthetic source; future timestamp; final threshold epoch with only one session.

### AC-11 — Budget gate uses strict AND semantics (R-10)

Fixture matrix proves:

- exactly `0.70` request hit rate fails;
- exactly `0.60` cache coverage fails;
- one passing cache ratio and one failing ratio fails;
- exactly 50ms/200ms/1500MB fails;
- null/NaN/Infinity/zero denominator fails;
- all values strictly inside the budgets pass.

### AC-12 — Threshold algorithm emits one deterministic next action (R-11)

Fixtures cover cosine-dominant, FTS-dominant, tied rejection counts, lower-bound exhaustion, cache-only failure, performance failure, and full pass/freeze. Each produces one exact action/reason, never changes two thresholds, and never lowers a relevance threshold for a cache-only failure.

### AC-13 — Synthetic integrated smoke passes but cannot close (R-1, R-13)

The smoke exits 0 in `--allow-synthetic` mode, proves ten-turn proxy/metrics/fast-agent flow, and produces `eligible_for_phase_closure: false`. Running production gate against the same fixture exits non-zero with `synthetic_evidence`.

### AC-14 — Seven-day real evidence exists (R-8, R-9)

User-returned evidence has an audit span ≥604,800,000ms, ≥5 distinct qualifying session hashes, ≥10 turns in each, ≥50 total turns, complete audit, real provider/fast-agent/runtime modes, and monotonic snapshots.

### AC-15 — All final budgets pass on real evidence (R-10)

Production `scripts/acceptance-gate.mjs` exits 0 and prints both cache ratios plus p50/p99/working-set values satisfying every strict inequality. This AC cannot be satisfied by tests or synthetic smoke.

### AC-16 — Final thresholds are frozen and evidenced (R-2, R-11)

The final threshold epoch has ≥2 qualifying sessions / ≥20 turns. `.memory-studio/state.json` equals the final tuning-log pair, and a runtime snapshot records the same values. The report shows configured initial, pre-7b effective, every empirical change, and final values.

### AC-17 — Final report is generated, not hand-authored (R-12)

The evaluator generates `acceptance-YYYY-MM-DD.md` with `verdict: PASS`, evidence hashes, all required sections, and no unresolved placeholders. Rerunning against unchanged inputs produces byte-identical body content except an explicitly supplied generation timestamp.

### AC-18 — Gates, dependencies, and scope are clean (R-14)

Before each commit and at final closure:

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

At final closure also run UI/SDK regressions, the acceptance smoke, production acceptance gate, and locked-layer diff. No dependency manifest changes and no locked-layer diff are permitted.

---

## 3. Edge Cases (EC-NN)

### EC-1 — No real provider credentials

7b.1 still completes. 7b.2 remains blocked and Phase 7b remains unchecked. The evaluator reports `real_provider_evidence_missing`; it never falls back to stub evidence.

### EC-2 — API 429 during the user week

A main provider 429/non-200 is not a completed 200 proxy request and therefore is not added to the cache denominator. A fast-agent 429 after the provider response is fail-open and does not invalidate the completed turn, but the tail failure is logged. If rate limits prevent the minimum session/turn evidence, the gate fails for insufficient evidence.

### EC-3 — HTTP 200 lacks usage

Count exactly one proxy request and zero cache hits. This is the prioritized Phase 7a R-2 denominator fix.

### EC-4 — SSE disconnects after a 200 status

The proxy records a zero-cache completed-attempt marker only when its response lifecycle has enough information to finalize the request; an aborted/incomplete stream is separately marked in audit. It MUST NOT be misreported as a cache hit. The acceptance evaluator lists incomplete streams and excludes them from qualifying turns unless the route contract records a completed response.

### EC-5 — Server restarts during the week

Persistent audit evidence continues across restarts. Metrics v2 `process_started_at` separates process epochs; deltas are never computed across counter reset. At least one process epoch must demonstrate ≥1h sustained operation for the working-set gate.

### EC-6 — Threshold changes without a boundary snapshot

The evaluator cannot assign counter deltas to an exact threshold pair and fails with `ambiguous_threshold_epoch`. The runbook requires a snapshot immediately before a change and after the next qualifying session.

### EC-7 — Sparse or non-qualifying sessions

Sessions with fewer than ten completed turns remain visible in the report but do not count toward the five-session minimum or final-threshold-epoch stability.

### EC-8 — More than 500 audit rows

HTTP `/audit` export may be truncated. Final acceptance uses direct SQLite aggregation and requires `audit.complete: true`; a truncated HTTP export is diagnostic only.

### EC-9 — Snapshot contains a secret-like value or raw content field

Snapshot creation fails before rename. The script scans keys and serialized values for forbidden raw-content/credential fields and common key patterns. Hashes and aggregate counts are allowed.

### EC-10 — Provider cache remains zero despite stable inputs

Thresholds are frozen. The operator investigates prefix byte stability, actual forwarded system blocks, cacheable-prefix size, provider/model support, TTL/session cadence, and header/body preservation. The gate does not lower relevance thresholds to manufacture provider cache hits.

### EC-11 — Fractional latency values

Any finite non-negative number is valid. Values are not rounded before comparison; `49.999` passes p50 and `50.0` fails.

### EC-12 — Working set spike

The maximum observed qualifying value is authoritative. A later lower final sample does not erase an earlier `>=1500MB` spike.

### EC-13 — Synthetic and real snapshots share a directory

Production evaluation filters by `source` and lists ignored files. Synthetic files never contribute numerators, denominators, wall-clock span, session counts, or budgets.

### EC-14 — Catalog rebuild endpoint remains fallback-only

Phase 7b validation uses `npm run build-index` plus controlled server restart; it does not claim `POST /catalog/rebuild` performs a TEMP+rename production swap. The real rebuild is explicitly deferred to v3.1+.

---

## 4. Carry-forward decision

### Folded into Phase 7b

| Original item | Decision | Why |
|---|---|---|
| **1. R-2 denominator on 200 without usage** | **FOLD** | It changes the provider-cache ratio and therefore directly affects the final acceptance verdict. See R-7/AC-7. |
| **2. Sliding wording vs cumulative counters** | **FOLD** | Seven-day aggregation requires unambiguous counter semantics. Cumulative-per-process is retained and documented. |
| **3. Fractional p50/p99 vs integer comments** | **FOLD** | Precision is useful for empirical measurement; contract is corrected to finite fractional milliseconds. |
| **5. Proxy T-14 activeCatalog short-circuit** | **FOLD and expand to the actual production seam** | Real proxy sessions otherwise never exercise Stage 1b or matched augmentation. L-006 also found empty-system rebuilding/session collapse/transport gaps that must be corrected for valid measurement. |

### Deferred to v3.1+

| Original item | Decision | Why not Phase 7b |
|---|---|---|
| **4. `/metrics` pino info logging** | **DEFER** | Current Fastify boot intentionally disables request logging. Acceptance uses explicit snapshot artifacts; adding a no-op or noisy request logger does not improve evidence. |
| **6. `POST /catalog/rebuild` FALLBACK no-op** | **DEFER** | Real TEMP+rename rebuild is a separate cold-path persistence feature. The acceptance runbook uses `npm run build-index` + restart and states the endpoint limitation honestly. |
| **7. test#366 `[42900,43000]` port exhaustion** | **DEFER** | Phase 7b smokes use a dedicated port range and robust cleanup. Changing the global default range is unrelated to empirical acceptance and can be handled with the broader test-harness cleanup. |

### Additional L-006 production blockers folded in

1. State thresholds/configured active catalog are not consumed by the current production pipeline.
2. Direct production boot with a DB does not wire the real pipeline/embedder into `/augment`.
3. Proxy discards matched pipeline output by rebuilding with `matched: []` and does not preserve the original system prompt.
4. Proxy strips general Messages fields/credential headers and lacks a streaming usage-capture path needed by coding agents.
5. Proxy's literal session ID `proxy` cannot prove five distinct sessions.

These are not optional polish: without them, Phase 7b would measure a stub/empty/non-transparent route and could produce a false PASS.

---

## 5. Done criteria

### 7b.1 — autonomous scaffolding complete

- [ ] R-2 through R-8 and R-12 through R-14 implemented.
- [ ] AC-1 through AC-13 and AC-18 pass with real code + synthetic fixtures.
- [ ] No real-provider PASS is claimed.
- [ ] Orchestrator pauses and hands the runbook to the human.

### 7b.2 — user-driven wall-clock evidence complete

- [ ] Audit span is at least 604,800,000ms.
- [ ] At least five sessions have at least ten completed turns each.
- [ ] At least 50 qualifying turns total.
- [ ] Real provider, real fast agent, and production runtime modes evidenced.
- [ ] Final threshold epoch has at least two qualifying sessions / 20 turns.
- [ ] AC-14 passes.

### 7b.3 — final closure complete

- [ ] `request_hit_rate > 0.70` AND `token_cache_coverage > 0.60` on the final threshold epoch.
- [ ] Worst observed qualifying `p50_latency_ms < 50`.
- [ ] Worst observed qualifying `p99_latency_ms < 200`.
- [ ] Maximum observed qualifying `working_set_mb < 1500`, including a process epoch sustained ≥1h.
- [ ] Final threshold values and complete empirical tuning log documented.
- [ ] `.memory-studio/state.json` contains and runtime uses the final pair.
- [ ] Generated `acceptance-YYYY-MM-DD.md` has `verdict: PASS` and no placeholders.
- [ ] AC-15 through AC-18 pass.
- [ ] Independent Verifier returns PASS.
- [ ] Only then may ROADMAP Phase 7b flip to `[x]` and Memory Studio be declared production.

---

## 6. Out of scope

- Token-weighted `Σ cache_read_input_tokens / Σ total_prompt_tokens` implementation (PRD §14.6 exact formula; Phase 7a intentionally selected request-weighted coverage for MVP roadmap acceptance).
- Prometheus, UI dashboard, or time-series database.
- Automatic online threshold mutation during live requests.
- Cross-project or per-tenant metrics.
- Real TEMP+rename `/catalog/rebuild` wiring.
- Global test-port-range redesign.
- Changes to any locked layer.

---

**Spec complete. See `design.md` for architecture and `tasks.md` for the eight atomic tasks.**
