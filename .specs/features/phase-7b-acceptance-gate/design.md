---
date: 2026-08-02
version: 1
description: "Phase 7b — Empirical Tuning + Acceptance Gate architecture. Designs production-state wiring, exact proxy augmentation/streaming, metrics v2 evidence, immutable snapshots, deterministic evaluation, threshold epochs, and the 7b.1 → 7b.2 → 7b.3 handoff."
explanation: |
  The phase is not a single uninterrupted autonomous run. Its implementation
  surface is small enough for one SDD task list, but a hard external evidence
  boundary separates the autonomous scaffold from the final closure. The
  architecture makes that pause executable: production mode rejects synthetic
  evidence, the human captures immutable snapshots during normal coding work,
  and the same evaluator later hydrates the final report.

  Current source inspection changed the design from the ROADMAP's optimistic
  “reader + gate only” shape. Before measurement is meaningful, the runtime
  must consume state thresholds, production boot must stop selecting the
  in-memory zero-vector context, and the proxy must forward the exact matched
  system while supporting real Messages transports. Those corrections stay
  under `src/server/**` and do not modify locked retrieval/fingerprint/SDK/UI
  layers.
related:
  - ./spec.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../DISCOVERIES.md
  - ../phase-7a-metrics/design.md
  - ../phase-7a-metrics/validation-phase-7a.md
  - ../phase-6b-fast-agent-intel/validation-phase-6b.4.md
  - ../../../PRD.md
  - ../../../.memory-studio/state.json
---

# Phase 7b — Empirical Tuning + Acceptance Gate — Design

**Phase:** 7b  
**Slug:** `phase-7b-acceptance-gate`  
**Companion:** `spec.md`  
**Branch:** `loop/phase-0`

---

## 1. Decision summary

| Decision | Selected design | Rejected alternative | Why |
|---|---|---|---|
| Execution shape | One task list, three ordered execution stages (7b.1 autonomous, 7b.2 human wall-clock, 7b.3 autonomous closure) | Pretend the sandbox can complete a week; or split into three independent SDD subchapters | The evidence boundary is real, but the implementation has only eight atomic tasks. A single spec preserves traceability while the orchestrator pauses at a hard gate. |
| Threshold source | `.memory-studio/state.json` via a server-owned typed adapter | Continue hard-coded defaults or edit `src/search/**` | Final values must affect runtime; locked search remains untouched. |
| Proxy pipeline output | Internal detailed result returns response + exact system blocks; public `runAugment` remains stable | Re-run `buildSystemMessage` from response IDs or keep `{matched: []}` | The pipeline already owns hydrated item text/intel. Rebuilding downstream loses information and can diverge from the audited SHA. |
| Original system | Preserve verbatim in stable prefix before Memory Studio suffix | Replace the coding agent's system prompt | Transparent proxy means augment, not erase. Preserving a stable original prefix also supports provider prefix caching. |
| Real Messages transport | Pass-through request fields + safe header allowlist; JSON and SSE response paths | Narrow JSON-only schema that strips fields; full blind header proxy | Coding agents stream and use evolving fields. A field pass-through plus credential-header allowlist is compatible without forwarding hop-by-hop or arbitrary headers. |
| Fast-agent scheduling | Response-side bounded tail after upstream completion; prior intel read before Turn N | Prompt-first cold call inside Stage 1b on proxy requests | PRD §3/§16 defines response-first. Tail work must remain outside user-visible latency. |
| Metrics semantics | Cumulative evidence counters per process epoch; last-100 latency ring; fractional milliseconds; schema v2 | Claim a true sliding window without eviction; round latency; persist raw requests | This matches actual Phase 7a behavior, makes deltas computable, and retains precision without storing raw content. |
| Acceptance aggregation | Immutable snapshots + complete audit aggregate; exact counter deltas; worst observed latency/memory | Read only the final `/metrics`; average ratios; hand-fill report | The final point can hide spikes/restarts/tuning changes. Counter deltas and max observed budgets are deterministic and conservative. |
| Tuning | One threshold field per qualifying session, deterministic rejection-dominance rule, bounded floors | Autonomous online mutation; manually choose “best-looking” values | Session boundaries keep evidence attributable. Bounded one-variable changes avoid confounding and subjective theater. |
| Synthetic evidence | Explicitly labeled and rejected by production gate | Reuse synthetic smoke to close when API unavailable | Synthetic proves machinery, never production acceptance. |

---

## 2. L-006 source audit: why scaffolding alone is insufficient

The design is anchored to the current code, not only Phase 7a summaries.

| Current source | Observed behavior | Acceptance impact | Design response |
|---|---|---|---|
| `.memory-studio/state.json` | Configures `minCosineSimilarity: 0.6`, `minFtsHits: 2`. | Intended initial thresholds exist. | Preserve these as configured baseline. |
| `src/server/augment/pipeline.ts:208-210` | Calls `applyThresholds(ranked)` without state options. | Runtime actually uses imported defaults, so changing state is ceremonial. | Runtime-state adapter + `PipelineContext.thresholds`. |
| `src/search/types.ts:20-24` | Defaults are `0.75 / 1`. | Pre-7b effective baseline differs from state. | Record both baselines; do not edit locked file. |
| `src/server/boot.ts:208-235` | `/augment` registration uses its default provider; proxy provider gets DB but stub embedder unless an external override happens to exist. | Direct production boot may measure zero-vector/in-memory behavior. | Production context factory owned by boot/config seam. |
| `src/server/routes/messages-proxy.ts:226-239` | Hardcodes `sessionId: 'proxy'`, `activeCatalog: []`. | All sessions collapse; pipeline returns before Stage 1b/retrieval. | State-backed active catalog + hashed session identity. |
| `messages-proxy.ts:270-274` | Calls `buildSystemMessage(..., {matched: []})` after pipeline. | Matched items/intel are discarded; cache can “pass” on an empty prompt. | Detailed pipeline result; exact system forwarded. |
| `messages-proxy.ts:221-223, 270-280` | Original system is extracted but not included in forwarded blocks. | A coding agent's base instructions are erased. | Preserve original system in stable prefix. |
| `messages-proxy.ts:68-73, 276-294` | Narrow Zod object and fixed headers; additional request fields/auth headers are stripped. | Real upstream/auth/tool/stream requests cannot be treated as transparent. | Passthrough body + explicit safe header allowlist. |
| `messages-proxy.ts:321-394` | Buffers JSON and has no SSE path. | Claude Code/Mavis/Cursor streaming traffic cannot be measured faithfully. | Two response adapters: JSON and streaming tee. |
| `metrics/collector.ts:73-75` | Drops null cache usage. | A successful 200 can disappear from R-2 denominator. | Normalize absent cache read to zero for completed 200. |
| `metrics/ring-buffer.ts:27-40, 101-119` | Counters cumulative; latency ring last 100. | Closed spec says sliding in places. | Resolve contract to actual cumulative/recompute semantics. |
| `metrics/ring-buffer.ts:64, 298-299` | Comment says integer; implementation returns performance floats. | Type contract drift. | Retain fractional values and correct docs/comments. |

### Consequence

A 7b implementation that only writes `acceptance-report.ts` and a gate could produce a mechanically polished but invalid PASS. The gate would be evaluating:

- thresholds that do not affect requests;
- a proxy that short-circuits before matching;
- an empty rebuilt system instead of matched content;
- one collapsed session identity;
- JSON-only stub traffic.

Therefore production-readiness wiring is part of 7b.1, not optional cleanup.

---

## 3. Three-stage architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 7b.1 — AUTONOMOUS                                                     │
│                                                                         │
│ state.json ─▶ runtime adapter ─▶ production pipeline/proxy              │
│                                      │                                  │
│ real-shape stub traffic ─────────────┼─▶ /metrics v2 + audit            │
│                                      │              │                   │
│                                      └──────────────┴─▶ snapshot tool   │
│                                                              │          │
│ synthetic fixtures ─▶ acceptance evaluator/gate ◀─────────────┘          │
│                         │                                               │
│                         └─ PASS = machinery works, closure=false        │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ HARD PAUSE
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7b.2 — USER-DRIVEN, ≥ 7 × 24h                                         │
│                                                                         │
│ real coding sessions ─▶ production proxy ─▶ real provider              │
│       ≥5 sessions          │                    │                       │
│       ≥10 turns each       ├─▶ audit DB         └─▶ cache usage         │
│                            └─▶ /metrics v2 ─▶ immutable snapshots       │
│                                                       │                 │
│ threshold algorithm recommends at most one change/session              │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ evidence returned
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 7b.3 — AUTONOMOUS CLOSURE                                              │
│                                                                         │
│ snapshots + audit + tuning log + state                                 │
│                     │                                                   │
│                     ▼                                                   │
│          deterministic acceptance evaluator                            │
│                     │                                                   │
│           FAIL ─────┴───── PASS                                         │
│            │                 │                                          │
│      keep phase open      hydrate acceptance-YYYY-MM-DD.md              │
│                           freeze state thresholds                        │
│                           independent Verifier                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why staged, not a single batch

The autonomous environment lacks two irreducible inputs:

1. real provider credentials/traffic;
2. seven days of elapsed wall-clock time with human coding behavior.

No test harness can substitute either without violating the done criteria. The pause is therefore an acceptance boundary, not a scheduling inconvenience.

### Why no SDD subchapter breakdown

There are eight atomic tasks. Six are one connected preflight implementation, one is the human evidence gate, and one is final hydration. Creating separate specs for 7b.1/7b.2/7b.3 would duplicate R/AC numbering and make the final evaluator's traceability harder. The task file instead marks three **execution batches** and gives T-07 an explicit `[USER-DRIVEN — NON-AUTONOMOUS]` header.

---

## 4. Runtime-state and production-context design

### 4.1 New server-owned adapter

Recommended location:

```text
src/server/config/runtime-state.ts
```

Responsibilities:

- Read and validate `.memory-studio/state.json`.
- Resolve path from an explicit `createServer` option first, then a documented environment override, then `<cwd>/.memory-studio/state.json`.
- Return one immutable request snapshot:

```typescript
interface RuntimeStateSnapshot {
  readonly activeCatalog: readonly string[];
  readonly thresholds: {
    readonly minCosineSimilarity: number;
    readonly minFtsHits: number;
  };
  readonly stateVersion: number | null;
  readonly loadedAt: number;
}
```

- Validate cosine finite/inclusive `[0,1]`; FTS integer within existing server-accepted bounds; active IDs strings.
- Never import from or modify `src/search/**`. It may import public constants read-only if needed, but state values remain authoritative.
- Tests inject a path/reader; no global cwd mutation required.

### 4.2 Request consistency

Read state once per incoming request, not once for `activeCatalog` and again for thresholds. This prevents a concurrent UI toggle from producing a request with catalog version A and thresholds version B.

`PipelineContext` gains a readonly threshold object. `runAugment` changes only this call:

```text
applyThresholds(ranked)
        ↓
applyThresholds(ranked, context.thresholds)
```

The public search module remains untouched.

### 4.3 Production context factory

Recommended location:

```text
src/server/config/production-context.ts
```

It owns the production combination of:

- opened DB handle;
- memoized `MultilingualE5SmallEmbedder` instance;
- catalog directory;
- state snapshot provider;
- intel read/write functions.

Boot rules:

- `MEMORY_STUDIO_CATALOG_DB_PATH` absent: explicit dev/stub behavior remains available.
- DB path present: production context is mandatory; failure to load model/state/catalog is startup failure, not silent zero-vector fallback.
- Tests inject embedder/state factories to avoid loading ONNX.
- DB/model lifetime is process-scoped; request context is shallow and cheap.

### Why fail startup in production

Fail-open is correct for retrieval errors during a live request. It is not correct for a known invalid production configuration before the server starts. Continuing with a zero-vector context would create false acceptance evidence.

---

## 5. Exact pipeline output and system preservation

### 5.1 Detailed internal result

Current `runAugment` computes both `system` and `sha256` but returns only the public response. Add an internal seam conceptually equivalent to:

```typescript
interface DetailedAugmentResult {
  readonly response: AugmentResponse;
  readonly system: readonly SystemBlock[];
}
```

Design constraints:

- Existing `runAugment` delegates to the detailed seam and returns `.response`.
- Proxy calls the detailed seam and forwards `.system`.
- Tests using `runAugment` remain source-compatible.
- Every early-return path also produces detailed blocks, so the proxy never reconstructs them.
- `canonicalSha256(result.system) === result.response.systemMessage` is an invariant.

### 5.2 Preserve original system without changing non-proxy baseline

Add an optional proxy-only stable prefix input to the system builder. When absent, all existing `/augment` byte-string fixtures remain unchanged. When present:

```text
Block 1 stable text:
  <original system bytes>
  <deterministic separator>
  <persona text>

Block 2 variable text:
  Intel
  Skills
  Rules
  Context
  Warnings
```

Why combine original system and persona in Block 1 instead of creating an arbitrary third structure:

- The architecture's stable-prefix boundary stays explicit.
- The provider can cache the agent's usually large stable system plus persona together.
- The two Memory Studio blocks and their SHA remain a single deterministic unit.
- The optional field preserves the historical no-proxy baseline.

If the original system is already an array of text blocks, preserve text order and exact text bytes. Unsupported non-text system blocks are passed through ahead of Memory Studio blocks rather than stringified; the detailed output/hash contract must clearly identify which Memory Studio blocks it hashes.

---

## 6. Transparent proxy design

### 6.1 Request adapter

```text
incoming Messages request
   │
   ├─ validate required core fields
   ├─ retain additional fields (passthrough)
   ├─ derive hashed session identity
   ├─ read one runtime state snapshot
   ├─ call detailed augment with prior intel
   ├─ replace only `system` with exact augmented blocks
   └─ forward body + safe headers
```

The proxy is provider-shaped, not provider-reimplemented. It validates the minimum needed to extract prompt/system and leaves future valid fields intact.

### 6.2 Header policy

Forward only:

- `x-api-key`
- `authorization`
- `anthropic-version`
- `anthropic-beta`
- `content-type`

Do not forward:

- `host`, `connection`, `content-length`, transfer/hop-by-hop headers;
- arbitrary client headers;
- Memory Studio internal session header upstream.

Never include header values in audit, pino, error bodies, snapshot artifacts, or test failure snapshots.

### 6.3 Session identity

```text
x-memory-studio-session-id present
  └─ sha256(raw header) ─▶ session hash

otherwise
  └─ sha256(original-system-text + NUL + first-user-prompt) ─▶ session hash
```

The fallback is deterministic and stores no raw content. The header path is preferred because two sessions may legitimately begin with identical text.

The same hash is used for:

- `fingerprint.sessionId` in internal augment request;
- `PipelineContext.sessionId`;
- intel store key;
- proxy audit fingerprint;
- acceptance session aggregation.

### 6.4 Non-streaming response

- Parse JSON once.
- Extract usage; absent cache read normalizes to zero on completed 200.
- Extract assistant response text for tail fast agent.
- Record audit + metrics.
- Return original upstream JSON/status/content-type.

### 6.5 Streaming response

Use Node 22 built-in streams; no dependency.

```text
upstream SSE body
      │
      ├────────────────────────────▶ downstream client (immediate)
      │
      └─ bounded line/SSE parser
            ├─ cache usage accumulator
            ├─ assistant text accumulator (bounded)
            └─ terminal/abort state
```

Requirements:

- The downstream receives the first event before upstream completion.
- Parser keeps only bounded state needed for usage and fast-agent response text; it does not retain the whole byte stream.
- Unknown event types are forwarded unchanged.
- Usage may appear in message-start or terminal events; accumulator takes the latest defined non-negative values.
- On clean completion, finalize metrics/audit and schedule fast agent.
- On abort/parser error, forward behavior remains fail-open where possible, record an incomplete marker without raw event text, and never claim a cache hit.

### 6.6 Response-first tail

```text
provider response end ─▶ setImmediate/queueMicrotask boundary
                              │
                              ▼
                      fetchIntel(assistant text)
                              │
                         success/error
                              │
                  write under hashed session / log fail-open
```

The tail is never awaited by the request handler. For a stream, it starts only after terminal completion. For JSON, it starts after the response object is ready to send.

L-007 handling:

- Use the existing SDK's bounded retry behavior.
- Do not add a custom while/retry-until-success loop.
- A 429/error logs mode + status class + latency only; no key or assistant text.
- Prior intel remains available if the write fails.

---

## 7. Metrics v2 design

### 7.1 Why evidence counters are needed

Phase 7a exposed only ratios and coarse counts. That is insufficient to:

- combine process epochs after a restart;
- isolate traffic before/after a threshold change;
- distinguish a ratio's numerator/denominator;
- verify a missing-usage 200 was counted.

Metrics v2 adds aggregate counters, not raw events.

### 7.2 Response shape extension

All v1 fields remain. Add:

```text
schema_version: 2

evidence:
  matched_requests
  attempted_requests
  cache_hit_requests
  proxy_requests
  latency_sample_count
  process_started_at
```

Invariant checks:

```text
request_hit_rate = matched_requests / attempted_requests
provider cache ratio = cache_hit_requests / proxy_requests
window.proxy_request_count = proxy_requests
```

When a denominator is zero, public ratio remains null.

### 7.3 Cumulative versus ring semantics

| Field | Semantics |
|---|---|
| Match/cache evidence counters | Cumulative from `process_started_at` until process restart/test reset. |
| `window.request_count` | Cumulative raw augment volume for the process epoch. |
| p50/p99 | Nearest-rank over last 100 latency samples. |
| N=10 / T=60s | Snapshot recompute cadence only. It does not evict ratio counters. |
| Working set | Point-in-time RSS at recompute. |

### 7.4 Missing usage

At the completed-200 boundary:

```text
cache_read_input_tokens number > 0  => hit + denominator
number === 0                        => miss + denominator
missing/null                        => miss + denominator
non-200                             => no denominator
```

This resolves the only Phase 7a gap that changes a provider-cache ratio.

---

## 8. Snapshot design

### 8.1 Collector inputs

`scripts/snapshot-metrics.mjs` receives explicit flags for:

- server base URL;
- state path;
- DB path (preferred complete audit source);
- source (`real` or `synthetic`, required);
- provider mode;
- fast-agent mode;
- runtime mode;
- output directory.

It never receives or prints an API key.

### 8.2 Capture sequence

1. Fetch `GET /metrics`; require 200 and schema v2 for real closure.
2. Read and validate state thresholds.
3. Aggregate audit DB by hashed session ID and timestamp.
4. Verify metrics evidence and audit are non-negative/finite.
5. Build canonical JSON with sorted keys where hashes depend on bytes.
6. Redaction/forbidden-field scan.
7. Write sibling temp file.
8. Atomic rename to timestamp filename.
9. Print path + summary only.

### 8.3 Audit aggregate

Only aggregate data is stored:

```typescript
interface AuditAcceptanceEvidence {
  readonly complete: true;
  readonly first_event_ts: number;
  readonly last_event_ts: number;
  readonly turns_by_session_hash: Readonly<Record<string, number>>;
  readonly rejection_counts: {
    readonly below_cosine_threshold: number;
    readonly below_fts_threshold: number;
  };
  readonly incomplete_proxy_streams: number;
}
```

No prompt/response/audit payload body is copied into the snapshot.

### 8.4 Immutability and dedupe

- Existing final snapshot filename is never overwritten.
- Content hash is included in report input manifest.
- Duplicate content at a new timestamp is allowed but contributes no counter delta.
- Same timestamp with different content is a gate failure.

---

## 9. Acceptance evaluator and gate

### 9.1 Module split

```text
src/server/acceptance/acceptance-report.ts
  - types + validation
  - process epoch detection
  - threshold epoch detection
  - counter delta aggregation
  - eligibility and budget evaluation
  - tuning recommendation
  - Markdown renderer

scripts/acceptance-gate.mjs
  - CLI parsing
  - load files/state/tuning log
  - call typed evaluator
  - print criterion table
  - write report only when requested
  - exit 0/1
```

The evaluator is a deep module; the CLI is thin.

### 9.2 Evaluation pipeline

```text
files
  ↓ validate schema/modes/time/finite values
eligible real snapshots + ignored synthetic list
  ↓ sort and identify process epochs
non-negative counter deltas
  ↓ identify threshold epochs from state values
final threshold epoch aggregate
  ↓ join complete audit coverage
session/wall-clock eligibility
  ↓ budgets + tuning stability
AcceptanceEvaluation
  ↓
Markdown / console / exit code
```

### 9.3 Counter deltas

For two snapshots in the same process epoch:

```text
delta = current evidence counter - previous evidence counter
```

Rules:

- Negative delta inside one process epoch = corrupted evidence, FAIL.
- New `process_started_at` = new epoch; baseline is zero for the first snapshot only when it is the first capture after boot. If prior unseen traffic exists, that first sample may contribute to overall runtime context but not to an attributable threshold delta unless state has remained unchanged since process start.
- A threshold change requires a boundary snapshot before new traffic. Otherwise FAIL `ambiguous_threshold_epoch`.

### 9.4 Budget aggregation

**Cache ratios:** aggregate raw deltas in final threshold epoch, never average ratios.

```text
Σ matched / Σ attempted
Σ cache hits / Σ successful proxy requests
```

**Latency:** evaluate every qualifying snapshot's last-100 ring; report the maximum p50 and maximum p99. This is conservative and prevents cherry-picking.

**Memory:** report maximum RSS across qualifying snapshots; require one process epoch age ≥1h.

### 9.5 Exit behavior

| Mode | Synthetic allowed? | Can exit 0? | Closure eligible? |
|---|---:|---:|---:|
| Default production | No | Yes, only all real gates pass | Yes |
| `--allow-synthetic` | Yes | Yes for fixture/smoke gates | **Always no** |
| Mixed production input | Synthetic ignored and listed | Yes if real evidence independently passes | Yes |

No warning-only downgrade exists for a done criterion.

---

## 10. Threshold tuning design

### 10.1 Baselines

The report distinguishes:

| Label | Cosine | FTS | Meaning |
|---|---:|---:|---|
| Configured initial | 0.60 | 2 | Existing `.memory-studio/state.json`. |
| Pre-7b effective | 0.75 | 1 | Hard-coded defaults actually used because state was not wired. |
| Final | empirical | empirical | Last stable threshold epoch after gate passes. |

This avoids rewriting history.

### 10.2 Epoch protocol

```text
snapshot boundary
   ↓
≥10 real turns in one session at fixed pair
   ↓
snapshot + rejection counts
   ↓
evaluate
   ├─ hit rate low + cosine dominant ─▶ cosine -0.05
   ├─ hit rate low + FTS dominant    ─▶ FTS -1
   ├─ cache only low                 ─▶ freeze; inspect cache seam
   ├─ perf low                       ─▶ freeze; fix performance
   └─ all pass                       ─▶ freeze final pair
```

Only one state field changes between epochs. State writes use the existing atomic temp+rename pattern or a small server config writer; no partial JSON.

### 10.3 Why not auto-tune online

- Online mutation would make request evidence non-attributable.
- A high match rate can be achieved by accepting irrelevant items; the bounded floor preserves a minimum relevance guard.
- Provider cache failures often have nothing to do with retrieval thresholds.
- The human is already operating sessions; applying a deterministic recommendation between sessions is low friction and auditable.

### 10.4 Final stability rule

The final pair is accepted only after:

- at least two qualifying sessions;
- at least 20 turns;
- both cache ratios pass on exact counter deltas;
- every qualifying snapshot in that epoch passes latency/memory;
- no later state change.

---

## 11. User-driven run protocol

The runbook created by T-06 is operational, not aspirational.

### Start conditions

- T-01 through T-06 committed and independently verified.
- On-disk DB built via `npm run build-index`.
- Production server boot logs production runtime and real fast-agent mode.
- Real provider routing configured by the human; credentials remain in environment/client headers.
- `.memory-studio/state.json` has a non-empty active catalog and initial thresholds.
- Synthetic snapshot directory is separate or clearly labeled.

### Daily/session cadence

1. Keep normal coding behavior; do not repeat a canned benchmark script as “real” evidence.
2. Use a stable session identity within one coding session and a new identity for a distinct session.
3. Reach at least ten completed turns.
4. Capture a snapshot after the session.
5. Review evaluator recommendation.
6. If changing a threshold, capture the boundary snapshot, change one field, and start a new session/epoch.
7. Continue until ≥7 × 24h and all minimums pass.

### Stop conditions

- Gate passes: return snapshots/tuning log for T-08.
- Lower bounds reached and hit rate still fails: stop and escalate.
- Proxy/system/auth/stream failure: fix code and restart the evidence window affected by the invalid path; do not retain invalid evidence as real.

---

## 12. Synthetic smoke design

The smoke has two layers:

### Live ten-turn flow

- Fixture DB + active state.
- Stub embedder and stub fast agent.
- Stub upstream emits cache miss on first stable prefix and hit thereafter.
- Both JSON and SSE subcases.
- Verifies non-empty matched system, session-specific intel, metrics v2 counters, and no response wait on tail.

### Temporal gate fixtures

A live smoke cannot wait seven days. The script creates **synthetic-labeled** fixture snapshots with controlled timestamps/session counts to exercise:

- seven-day exact boundary;
- five × ten sessions/turns;
- threshold epochs;
- strict budget boundaries;
- process restarts;
- fail cases.

`--allow-synthetic` can pass these fixtures but closure eligibility remains false. Default production gate rejects them.

### Port/process strategy

Use a dedicated Phase 7b range such as `[48900,48999]` and a separate stub range. Cleanup:

- Windows: `taskkill /F /T /PID` when graceful shutdown does not complete.
- POSIX: SIGTERM, bounded wait, then SIGKILL.
- Always remove temp DB/state/snapshot fixture directories.

This avoids touching carry-forward test#366.

---

## 13. Carry-forward rationale

### Fold now

1. **R-2 missing-usage denominator** — load-bearing acceptance math.
2. **Cumulative vs sliding wording** — needed for valid aggregation.
3. **Fractional latency contract** — needed for exact comparisons.
4. **Proxy activeCatalog/fast-agent scheduling** — real proxy acceptance otherwise cannot exercise the product.

The fourth expands to the adjacent production seams discovered in source: exact system forwarding, session identity, request-field/header compatibility, and streaming usage capture. These are the minimum coherent fix; correcting only `activeCatalog` would still forward an empty system and yield invalid evidence.

### Defer

1. `/metrics` pino info log — explicit snapshot artifacts supersede it for this gate.
2. TEMP+rename catalog rebuild — separate cold-path feature; runbook uses build-index + restart.
3. Global port exhaustion cleanup — dedicated Phase 7b ranges avoid it without broad test-harness change.

---

## 14. Scope and farol impact

All runtime changes stay inside the existing `server` farol node:

- config adapter;
- proxy transport;
- metrics response evidence;
- offline acceptance evaluator.

No new farol-level product component is required. The snapshot/gate scripts are operational tooling, not runtime architecture nodes. The farol remains runtime-only; no Planner/Implementer/Verifier/meta-tool appears.

Locked layers remain read-only. The design reuses their public contracts.

---

## 15. Security and privacy

| Risk | Control |
|---|---|
| Provider credentials forwarded upstream | Header allowlist only; never log/persist; no arbitrary header proxy. |
| Raw prompts/responses in evidence | Snapshot stores hashes/counts only; forbidden-field scan before atomic rename. |
| Raw session ID | Hash at ingress; only hash used in DB/audit/snapshots. |
| SSE parser accidentally logs chunks | Parser errors log event type/status only, never raw data. |
| State threshold corruption | Validate before production boot; atomic writes between epochs. |
| Synthetic evidence mislabeled real | Explicit required source/mode flags; production gate rejects synthetic and stub modes. |
| Report tampering | Evidence content hashes listed; report regenerated from artifacts. |
| Unbounded tail retries after 429 | Existing bounded SDK behavior only; no custom retry loop; fail-open. |

---

## 16. Risk register

| Risk | Likelihood | Impact | Mitigation/gate |
|---|---:|---:|---|
| Streaming proxy task is larger than ROADMAP estimate | High | High | Separate T-02 request correctness from T-03 streaming/tail; targeted integration tests before acceptance tooling. |
| Original system + Memory Studio prefix exceeds or misses provider cache minimum | Medium | High | Real cache evidence; exact byte equality tests; do not tune relevance thresholds for cache-only failure. |
| User restarts server | Medium | Medium | Process epochs in metrics v2; persistent audit; non-cross-epoch deltas; ≥1h sustained epoch required. |
| Threshold change cannot be attributed | Medium | High | Boundary snapshots mandatory; ambiguous epoch is hard FAIL. |
| Five sessions collide under fallback hash | Low | Medium | Prefer explicit session header; report derivation mode; SHA-256 fallback only. |
| Audit volume exceeds HTTP limit | Medium | Medium | Direct SQLite aggregate is final source; HTTP fallback diagnostic only. |
| A real provider response omits usage | Low | Medium | Count as miss; ratio remains conservative. |
| Cache gate fails because stable prefix is below provider minimum | Medium | High | Report as cache seam issue; do not lower retrieval thresholds. Human/implementation fixes cacheable content before restarting affected epoch. |
| Working-set spike hidden by final sample | Medium | High | Gate maximum observed qualifying RSS, not final-only. |
| Human cannot supply seven days | Unknown | Certain blocker | Phase remains open; no synthetic fallback. |

---

## 17. Execution batches and estimated runtime

| Batch | Tasks | Owner | Estimate | Exit condition |
|---|---|---|---:|---|
| **Batch 1 — 7b.1** | T-01..T-06 | Implementer | 5-7h | All autonomous ACs + synthetic smoke pass; no production claim. |
| **Batch 2 — 7b.2** | T-07 | Human operator | ≥7 days wall-clock; ~10-15 min evidence work per qualifying session in addition to normal coding | Real evidence satisfies AC-14 and is returned. |
| **Batch 3 — 7b.3** | T-08 | Implementer | 0.5-1.5h | Production gate + final report + final state + full gates pass. |

**Subchapter breakdown:** NO. Eight atomic tasks remain within the delegation cap. The three batches are execution-state boundaries, not separate feature specs.

---

## 18. Verifier strategy

The independent Verifier must not accept summaries alone. It should:

1. Read actual state adapter, boot context, detailed pipeline seam, proxy JSON/SSE code, metrics v2, snapshot script, evaluator, and final state/report.
2. Forge a 200 response with missing usage and verify denominator increment.
3. Forge active matched items and confirm exact forwarded system bytes/SHA.
4. Forge delayed SSE and prove first-byte relay precedes completion.
5. Forge fast-agent 429 and prove provider response/tail boundedness.
6. Forge every strict boundary (`0.70`, `0.60`, `50`, `200`, `1500`, 7d−1ms, 4 sessions, 9 turns).
7. Verify synthetic mode cannot close.
8. For final closure, hash and independently evaluate the real snapshots; verify ≥7d/5×10 and final threshold state.
9. Run all repository gates and locked-layer diff.

The Verifier may return PASS for Batch 1 scaffolding while explicitly marking Phase 7b **OPEN pending T-07**. Final phase PASS requires real T-07 evidence and T-08 hydration.

---

**Design complete. See `tasks.md` for atomic implementation order.**
