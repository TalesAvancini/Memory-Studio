---
date: 2026-08-01
version: 1
description: "Phase 7a — Metrics Instrumentation spec. Observability layer: 5 metrics (request_hit_rate, token_cache_coverage, p50_latency_ms, p99_latency_ms, working_set_mb) with N=10 OR T=60s refresh trigger. Memory Studio is now functional end-to-end (Phase 6b closed 2026-08-01 with inception híbrida + cache hit invariant verified); this phase adds the production observability needed to validate the system against PRD §10.2 budgets and §14.6 cache hit target (>70%)."
explanation: |
  Memory Studio is **functional end-to-end** after Phase 6b closure
  (627 tests: 459 root + 152 UI + 16 SDK, all gates green; AD-007 +
  AD-008 + AD-009 in `.specs/DISCOVERIES.md`). Inception híbrida is
  wired in production with POC budgets surviving (TOTAL overhead
  max=2.15ms ≪ 10ms budget, 5× headroom). What is missing is the
  observability layer needed to (a) verify PRD §14.6 cache hit
  >70% target in real sessions, (b) track working set growth
  against PRD §10.2.3 budget (<1.5GB/1h), (c) measure p50/p99
  latency percentiles on live traffic, (d) provide a JSON
  dashboard endpoint operators can scrape from the UI panel or
  external monitoring.

  Why this phase matters now: PRD §14.6 (`cache hit > 70%`) and
  §10.2 budgets (`p50<50ms`, `p99<200ms`, `working_set<1.5GB/1h`)
  are PASS thresholds for MVP. Without metrics, they cannot be
  verified — only claimed. Phase 7a delivers the observability
  surface so Phase 7b (Real API measurement + tuning) can read
  metrics from a real session and adjust thresholds.

  Scope guard (extends Phase 6b territory): the audit ring buffer
  (`src/server/audit/buffer.ts`) is the architectural PATTERN for
  the metrics ring buffer — count + time triggers + fail-open.
  The dashboard endpoint extends `/health` route pattern (which
  already surfaces `audit_buffer.{depth, capacity, last_flush_ts}`
  + `catalog.{count, last_rebuild_ts}`). Phase 7a adds a NEW
  endpoint `GET /metrics` rather than further extending `/health`
  (rationale in design.md §3) — `/health` stays a 200 liveness
  probe, `/metrics` becomes the operational observability surface.

  Refresh trigger rationale: N=10 OR T=60s (whichever first) —
  matches PRD §10.4 operational cadence. N=10 keeps the dashboard
  responsive during sustained traffic (no more than 10 requests
  between snapshots); T=60s keeps it responsive during sparse
  traffic (no more than 60s of staleness). Count trigger fires
  synchronously inside the request hot path; time trigger fires
  from a `setInterval(60_000)` cleared on server stop.

  Persistence semantics: TRANSIENT (counters + ring buffer reset
  on server restart). Rationale: metrics are operational
  observability, not audit. PRD §10.4 ops criteria are per-process.
  Persistence is a v3.1+ candidate if cross-restart observability
  becomes necessary.

  Edge cases explicitly handled:
  - **Proxy disabled** (no `MEMORY_STUDIO_ANTHROPIC_BASE_URL`):
    `token_cache_coverage` returns `null` (signal that the metric
    is not measurable), NOT 0 (which would falsely signal
    100% miss-rate). The dashboard reports `proxy_enabled: false`
    alongside.
  - **Empty catalog** (no active items): requests return
    persona-only with `emptyReason: "no_active_items"` — these
    are NOT counted in `request_hit_rate` numerator (it's not a
    "hit") NOR in the denominator (the pipeline short-circuits
    before retrieval). Counted in `total_requests` denominator
    only when measured = yes (matched.count > 0 OR retrieval was
    attempted).
  - **Fail-open path** (retrieval error → `emptyReason:
    "timeout"`): same as empty catalog — excluded from the
    hit-rate ratio. Counted in `total_attempted_requests` only.
  - **Social bypass** (`emptyReason: "social"`): excluded entirely
    (not a retrieval attempt).

  Architectural Reference (farol nodes consumed — runtime-only):
  - `server` (Fastify · 7 ep → 8 ep after Phase 7a)
  - `audit-buffer` (D-007 pattern: ring buffer + count/time trigger)
  - `intel-store` (latency source: pipeline.ts `latencyMs.total`)
  - `match-script` (cache hit source: `usage.cache_read_input_tokens`)
  - `cache` (SHA256(byte-string) — flow reference, not consumed)

  This phase does NOT consume or modify:
  - `src/search/**` (REUSE-ONLY)
  - `src/social-detector/**` (REUSE-ONLY)
  - `src/fingerprint/**` (REUSE-ONLY)
  - `packages/sdk/**` (REUSE-ONLY)
  - `packages/ui/**` (REUSE-ONLY)
  - `CLAUDE.md` (meta-doc)
related:
  - ../../ROADMAP.md (Phase 7a entry, lines 932-939)
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md (AuditRingBuffer pattern, /health extension)
  - ../phase-6b-fast-agent-intel/{spec,design,tasks,validation-phase-6b.4}.md (latency + cache sources)
  - ../phase-6a-poc-validation/{spec,poc-results}.md (POC budgets Phase 7a inherits)
  - ../../../PRD.md (§10.2 perf budgets, §10.4 ops, §14.6 cache hit measurement, §17 cache distinction)
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../DISCOVERIES.md (AD-007 cache hit invariant, AD-008 writer perf, AD-009 POC re-run)
  - ../../../.scratch/memory-studio/spec.md
  - ../../architecture/memory-studio.architecture.json (farol nodes: server, audit-buffer, intel-store, match-script, cache)
  - ../../../src/server/{boot,index,health,logger}.ts
  - ../../../src/server/augment/{pipeline,augmenter,byte-string,response,top-k,thresholds}.ts
  - ../../../src/server/audit/{buffer,lifecycle,query,types,index}.ts
  - ../../../src/server/routes/{index,messages-proxy,catalog,catalog-rebuild,audit,state-toggle}.ts
  - ../../../src/server/fast-agent/{client,writer,intel-schema,index}.ts
  - ../../../src/catalog/{index,intel-store}.ts
  - ../../../test/audit/{buffer,perf-100ms,messages-proxy}.test.mjs
  - ../../../scripts/{smoke-server-boot,smoke-augment-server,smoke-proxy-local-only,smoke-latency-trick}.mjs
  - ../../../CLAUDE.md
---

# Phase 7a — Metrics Instrumentation — Spec

**Phase:** 7a
**Slug:** `phase-7a-metrics`
**Source:** `.specs/ROADMAP.md` lines 932-939 (Phase 7a entry)
**Branch:** `loop/phase-0`
**Baseline:** commit at end of Phase 6b (`bc95558` per STATE.md Handoff — 627 tests: 459 root + 152 UI + 16 SDK; POC TOTAL overhead max=2.15ms ≪ 10ms budget; AD-007 + AD-008 + AD-009 in DISCOVERIES.md)
**Goal:** ship the operational observability layer that exposes the 5 acceptance metrics on a `/metrics` endpoint, refreshed every N=10 requests OR T=60s, transient (resets on server restart). Make PRD §14.6 cache hit >70% and §10.2 perf budgets measurable from live traffic. **Working set < 1.5GB/1h is also a budget Phase 7a observability must not blow.**
**Estimate:** 2-3h (per ROADMAP — smallest phase yet; 5 metrics + 1 endpoint + 1 ring buffer)

---

## 1. Requirements (R-NN)

### R-1 — `request_hit_rate`

`request_hit_rate` is the fraction of `/augment` requests that returned matched items, over a sliding window.

**Formula:**

```
request_hit_rate = matched_requests ÷ attempted_requests
```

- `matched_requests` = requests where `matched.count > 0` (i.e., the response has at least one item in `matchedSkills`, `matchedRules`, or `matchedPersonas`).
- `attempted_requests` = requests that reached retrieval Stage 5 in `runAugment` (i.e., NOT counted: social bypass, `emptyReason: "no_active_items"`, `emptyReason: "timeout"`, or validation 400 errors).

**Denominator definition (precise):**

| Path | Counted? |
|---|---|
| `/augment` reaches Stage 5 (FTS+vec+RRF) | YES (in denominator) |
| `matched.count > 0` | YES (in numerator) |
| `matched.count === 0` (e.g., thresholds rejected all) | NO numerator, YES denominator |
| Social bypass (`emptyReason: "social"`) | NO |
| Empty active catalog (`emptyReason: "no_active_items"`) | NO |
| Fail-open (`emptyReason: "timeout"`) | NO |
| Validation 400 (schema failure) | NO |
| Proxy path (`POST /v1/messages`) | NO — proxy is a separate metric |

**Window:** last N=10 requests OR last 60s (whichever first — see R-6).

**PRD reference:** §14.6 ("Request hit rate = requests com `cache_read_input_tokens > 0` ÷ total"); §17.1 (provider cache metric only — NOT the augmented cache field `cacheHit` which is v3.1+).

> **Naming conflict caveat:** PRD §14.6 defines "Request hit rate" using `cache_read_input_tokens > 0` as the numerator. Phase 7a generalizes this to "matched.count > 0" (which is the OPERATIONAL hit rate — a request that returned items is a successful match). The PRD's `cache_read_input_tokens` formula is R-2 (`token_cache_coverage`). The R-1 name `request_hit_rate` aligns with operational dashboards ("how often are we matching?"), not the PRD's exact formula. This divergence is intentional: R-1 = match pipeline hit, R-2 = provider cache hit. Verifier should note this in `validation-phase-7a.md`.

### R-2 — `token_cache_coverage`

`token_cache_coverage` is the fraction of `/v1/messages` proxy calls that returned `usage.cache_read_input_tokens > 0`.

**Formula:**

```
token_cache_coverage = cache_hit_requests ÷ proxy_requests
```

- `cache_hit_requests` = proxy calls where `cacheReadInputTokens > 0` (the Anthropic API reported a cache read).
- `proxy_requests` = proxy calls where the proxy returned a 200 status (NOT 503 `proxy_disabled`, NOT 502 `augment_failed`, NOT 502 `upstream_fetch_failed`, NOT 502 `proxy_host_not_allowed`).

**When proxy is disabled** (`upstreamUrl === null`):

- `proxy_enabled: false` is set in the response (signals that R-2 is not measurable).
- `token_cache_coverage: null` is returned (NOT 0, which would falsely signal 100% miss-rate).
- `proxy_requests: 0` (no proxy calls in window).

**Window:** last N=10 proxy requests OR last 60s.

**PRD reference:** §14.6 ("Token cache coverage = Σ `cache_read_input_tokens` ÷ Σ `total_prompt_tokens`") and §17.1 (cache do provedor metric).

> **Phase 7b T-04 resolution note (R-2 denominator edge):** A completed HTTP 200 response that OMITS `usage.cache_read_input_tokens` (or any of the `usage` block) is now counted in the `proxy_requests` denominator. The collector normalizes a null/missing/zero `cacheReadTokens` to `0` BEFORE calling `MetricsRingBuffer.recordProxy()`. This counts as a zero-valued miss (NOT a no-op, NOT a hit). The previous Phase 7a behavior — silently dropping these requests from the denominator — produced an artificially high cache coverage ratio. The fix is the load-bearing acceptance math change in Phase 7b; tests at `test/server/metrics/provider-denominator.test.mjs` enforce the contract.

> **Formula simplification caveat:** PRD §14.6 defines token cache coverage as Σ cache_read_input_tokens ÷ Σ total_prompt_tokens (a token-weighted ratio). Phase 7a uses a request-weighted ratio (cache_hit_requests ÷ proxy_requests) for dashboard simplicity. Token-weighted ratio requires summing per-call tokens which is more expensive to maintain in a ring buffer. The Verifier should note this simplification in `validation-phase-7a.md`. PRD §14.6's exact formula is a v3.1+ enhancement if `working_set_mb` shows Phase 7a's simpler version misses edge cases.

### R-3 — `p50_latency_ms`

`p50_latency_ms` is the median total request latency across the dashboard window.

**Formula:**

```
p50_latency_ms = median(latencyMs.total for each request in window)
```

- `latencyMs.total` = the value already surfaced by `runAugment` (`src/server/augment/pipeline.ts:227` — `totalMs = performance.now() - t0`).
- Source: `pipeline.ts:228-233` (`LatencyTimings` interface).
- Includes ALL paths (matched, no-match, persona-only, social, fail-open) — the metric is per-request latency, not per-success.

**Window:** last N=10 requests OR last 60s (same as R-1).

**PRD reference:** §10.2 budgets (`p50<50ms`).

### R-4 — `p99_latency_ms`

`p99_latency_ms` is the p99 total request latency across the dashboard window.

**Formula:**

```
p99_latency_ms = 99th percentile(latencyMs.total for each request in window)
```

- Source: same as R-3 (`latencyMs.total`).
- **Edge case:** when window has <100 requests, percentile calculation uses nearest-rank (the value at index `Math.ceil(0.99 * n) - 1` in the sorted array). Verifier should note the deviation from linear interpolation in `validation-phase-7a.md`.

**Window:** last N=10 requests OR last 60s.

**PRD reference:** §10.2 budgets (`p99<200ms`).

### R-5 — `working_set_mb`

`working_set_mb` is the process RSS at flush time.

**Formula:**

```
working_set_mb = process.memoryUsage().rss / 1024 / 1024
```

- Source: `process.memoryUsage().rss` (Node built-in, all platforms).
- Sampling: at every dashboard recompute (count OR time trigger).
- Unit: megabytes (integer floor via `Math.floor`).

**PRD reference:** §10.2.3 budget (`working_set < 1.5GB / 1h`). The 1.5GB ceiling is 1536 MB.

> **Platform caveat:** `rss` (Resident Set Size) is the OS-specific measure of how much physical memory the process occupies. On Windows, RSS may grow but not shrink within the process lifetime even after garbage collection. On Linux/macOS, RSS may fluctuate more. Phase 7a reports the raw value; interpretation is the operator's responsibility (per L-005 honesty).

### R-6 — Refresh trigger (N=10 OR T=60s)

The dashboard recomputes on EITHER trigger:

- **Count trigger:** every 10 requests (synchronous, fires inside the request hot path after the response is built).
- **Time trigger:** every 60 seconds (asynchronous, fires from a `setInterval(60_000)` cleared on server stop).

Whichever fires first wins. The ring buffer's recompute is O(N) where N ≤ window size (typically ≤ 10).

**Behavior:**

- On count trigger: increment request counter; if counter % 10 === 0, recompute dashboard.
- On time trigger: recompute dashboard; reset request counter (do NOT lose samples already in the ring buffer).
- On server stop: clear the time interval.

**Why count + time (not just time):** count-trigger keeps the dashboard fresh during sustained traffic (no more than 10 requests stale); time-trigger keeps it fresh during sparse traffic (no more than 60s stale). Either alone misses one regime.

**PRD reference:** ROADMAP.md Phase 7a entry "atualizado a cada N=10 requests ou T=60s".

> **Phase 7b T-04 resolution note:** The R-6 trigger cadence (N=10 / T=60s) is the **recompute cadence only** — it does NOT evict ratio counters. The match/cache ratio counters (`attemptedRequests`, `matchedRequests`, `proxyRequests`, `cacheHitRequests`) are **cumulative within one process epoch** (transient persistence: reset on server stop / restart, no SQLite storage). The latency ring buffer remains last-100 samples (R-3/R-4). The previous "sliding N=10/60s" wording was misleading; the implementation was always cumulative. Phase 7b formalizes this in the contract — see spec.md AC-8 and the schema v2 evidence block (`process_started_at` anchors the epoch).

### R-7 — `/metrics` endpoint contract

A NEW endpoint `GET /metrics` returns the 5 metrics as JSON.

**Request:** `GET /metrics`

**Response shape:**

```typescript
interface MetricsResponse {
  request_hit_rate: number | null;       // 0..1, null when attempted_requests = 0
  token_cache_coverage: number | null;   // 0..1, null when proxy disabled or proxy_requests = 0
  p50_latency_ms: number | null;         // finite non-negative fractional ms, null when window empty (Phase 7b T-04)
  p99_latency_ms: number | null;         // finite non-negative fractional ms, null when window empty (Phase 7b T-04)
  working_set_mb: number;                // integer MB (MB granularity), always present
  window: {
    request_count: number;               // how many /augment requests in window
    proxy_request_count: number;         // how many /v1/messages requests in window
    window_age_ms: number;               // ms since window started (or last reset)
  };
  proxy_enabled: boolean;                // mirrors MEMORY_STUDIO_ANTHROPIC_BASE_URL
  evidence: {                            // Phase 7b T-04 — raw counters for acceptance evaluator
    matched_requests: number;
    attempted_requests: number;
    cache_hit_requests: number;
    proxy_requests: number;
    latency_sample_count: number;
    process_started_at: number;
  };
  schema_version: 2;                     // Phase 7b T-04: bumped from 1
  timestamp: number;                     // epoch ms of dashboard recompute
}
```

**HTTP status:** 200 (always — observability never fails the dashboard).

**Auth:** none (operational endpoint, like `/health`).

**Logging:** request is logged via pino at `info` level (matches existing `/health` style).

### R-8 — Transient persistence (counter reset on restart)

Counters and the latency ring buffer reset on server restart. No SQLite persistence for metrics.

**Rationale:** metrics are operational observability per-process; cross-restart persistence is a v3.1+ enhancement.

**Affected state:**

- Request counter (count trigger): resets to 0 on restart.
- Latency ring buffer: empty on restart.
- Cache-hit counter: resets to 0 on restart.
- Proxy-request counter: resets to 0 on restart.
- `working_set_mb`: starts fresh (sampled at first flush).

### R-9 — No new npm dependencies

Phase 7a uses Node built-ins + `pino` (already in deps) + `fastify` (already in deps). NO new dependencies are added.

Specifically:
- `process.memoryUsage()` — Node built-in.
- `performance.now()` — Node built-in (already used in `pipeline.ts`).
- Ring buffer storage — plain `Float64Array` + `number[]` (no library needed).
- Percentile calculation — plain `Array.sort()` + index lookup (no library needed).

---

## 2. Acceptance Criteria (AC-NN)

Each AC maps to a verification gate (test or manual smoke). Numbered for traceability to R-NN.

### AC-1 — `request_hit_rate` computation (R-1)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `request_hit_rate_with_mixed_paths`.

**Verification:**
- Drive `/augment` 10 times: 4 matched (`matched.count > 0`), 3 no-match (`matched.count === 0`), 2 social bypass, 1 fail-open.
- Assert `request_hit_rate = 4 / 7` (denominator excludes social + fail-open; matched/numerator = 4; attempted = 7).
- Denominator = 4 + 3 = 7. Numerator = 4. Ratio = 4/7 ≈ 0.571.

### AC-2 — `token_cache_coverage` proxy disabled (R-2)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `token_cache_coverage_proxy_disabled`.

**Verification:**
- Boot server with `MEMORY_STUDIO_ANTHROPIC_BASE_URL` unset.
- Hit `/v1/messages` → expect 503 `proxy_disabled` (NOT counted).
- Hit `/metrics` → expect `token_cache_coverage: null`, `proxy_enabled: false`, `proxy_request_count: 0`.

### AC-3 — `token_cache_coverage` proxy enabled (R-2)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `token_cache_coverage_proxy_enabled`.

**Verification:**
- Boot server with stub upstream.
- Hit `/v1/messages` 10 times with stub returning `cache_read_input_tokens: 42` on second call (cache hit), `0` on others.
- Assert `token_cache_coverage = 1 / 10` (1 cache hit out of 10 proxy requests).

### AC-4 — `p50_latency_ms` computation (R-3)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `p50_latency_ms_with_known_samples`.

**Verification:**
- Inject 10 latency samples: `[10, 20, 30, 40, 50, 60, 70, 80, 90, 100]`.
- Assert `p50_latency_ms = 50` (median of sorted array; index 5 = 50).

### AC-5 — `p99_latency_ms` computation (R-4)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `p99_latency_ms_nearest_rank`.

**Verification:**
- Inject 100 latency samples: `[1, 2, 3, ..., 100]`.
- Assert `p99_latency_ms = 99` (nearest-rank at index `Math.ceil(0.99 * 100) - 1 = 98`).
- Inject 10 latency samples: `[1, 2, 3, ..., 10]`.
- Assert `p99_latency_ms = 10` (small-sample case; nearest-rank index `Math.ceil(0.99 * 10) - 1 = 9`).

### AC-6 — `working_set_mb` sampling (R-5)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `working_set_mb_positive_integer`.

**Verification:**
- Boot server (any port range).
- Hit `/metrics`.
- Assert `working_set_mb > 0` (process always has some RSS).
- Assert `working_set_mb === Math.floor(process.memoryUsage().rss / 1024 / 1024)`.

### AC-7 — Refresh trigger count + time (R-6)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `refresh_trigger_count_and_time`.

**Verification:**
- Drive 10 requests in <60s → expect dashboard recomputed at request #10.
- Drive 1 request, then wait 60s → expect dashboard recomputed at T+60s.
- Verify by reading `/metrics` and checking `timestamp` advances on each trigger.

### AC-8 — `/metrics` endpoint shape (R-7)

**Test:** `test/server/metrics/route.test.mjs` — case `metrics_endpoint_shape`.

**Verification:**
- GET `/metrics` returns 200 with all 9 keys present: `request_hit_rate`, `token_cache_coverage`, `p50_latency_ms`, `p99_latency_ms`, `working_set_mb`, `window`, `proxy_enabled`, `schema_version`, `timestamp`.
- Schema version is `1`.
- HTTP status is 200 (always).

### AC-9 — Transient on restart (R-8)

**Test:** `test/server/metrics/dashboard.test.mjs` — case `metrics_reset_on_restart`.

**Verification:**
- Boot server, drive 5 requests, hit `/metrics`, capture state.
- Stop server.
- Boot server fresh.
- Hit `/metrics` → expect `request_count: 0`, empty window, `working_set_mb` re-sampled.

### AC-10 — Typecheck clean (R-9)

**Gate:** `npm run typecheck` exits 0 with no output.

### AC-11 — No new deps (R-9)

**Gate:** `package.json` `dependencies` diff is empty.

### AC-12 — Scope guard (locked layers untouched)

**Gate:** `git diff --stat <6b-head>..HEAD` returns only:
- `src/server/metrics/**` (NEW)
- `src/server/routes/metrics.ts` (NEW)
- `src/server/routes/index.ts` (barrel update — register `metricsRoute`)
- `src/server/boot.ts` (wire metrics module)
- `src/server/augment/pipeline.ts` (add metrics sample hook)
- `src/server/routes/messages-proxy.ts` (add metrics sample hook)
- `test/server/metrics/**` (NEW)
- `scripts/smoke-metrics.mjs` (NEW)

Locked layers (`src/search/**`, `src/social-detector/**`, `src/fingerprint/**`, `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md`) MUST have empty diff.

### AC-13 — POC ceilings survive (no hot path bloat)

**Gate:** `scripts/poc-6a-hot-path.mjs` re-run shows TOTAL overhead p95 ≤ 0.30ms (Phase 6b ceiling was 0.07-0.22ms; we add < 0.10ms budget for metrics hook). AD-009 rule: "ajustar, não collapsar".

### AC-14 — `working_set_mb` < 1500 MB at boot + smoke

**Gate:** After boot + 1 `/metrics` hit + 1 `/augment` hit, `working_set_mb < 1500` (PRD §10.2.3 budget).

---

## 3. Edge Cases (EC-NN)

### EC-1 — Empty window (no requests yet)

Dashboard returns `null` for all rate/percentile metrics. `working_set_mb` is still populated. `window.request_count = 0`.

### EC-2 — Empty active catalog (`emptyReason: "no_active_items"`)

These requests return at Stage 2 (`pipeline.ts:129`) BEFORE Stage 1b (intel) AND BEFORE Stage 5 (retrieval). They are NOT counted in `request_hit_rate` denominator (not an "attempted" retrieval). Latency sample is still recorded for `p50/p99`.

### EC-3 — Fail-open (`emptyReason: "timeout"`)

Same as EC-2 — not counted in `request_hit_rate` ratio. Latency sample is recorded (the failure itself has latency).

### EC-4 — Proxy disabled

`token_cache_coverage: null`, `proxy_enabled: false`, `proxy_request_count: 0`.

### EC-5 — Validation 400 errors

NOT counted anywhere (the request never reached the pipeline). Standard Fastify 400.

### EC-6 — Concurrent requests

The ring buffer is append-only with no locks (same pattern as `AuditRingBuffer`). Concurrent enqueues from concurrent requests use a mutex via Node's single-threaded event loop (no real concurrency, just sequencing).

### EC-7 — Hot reload / test reset

`resetForTests()` clears the ring buffer + counters + interval. Same pattern as `AuditRingBuffer.resetForTests()`.

### EC-8 — Server stop during refresh

`stop()` clears the time interval and DOES NOT wait for in-flight recompute (recompute is O(N) where N ≤ 10 — completes in < 1ms; not worth awaiting). Same pattern as `AuditRingBuffer.stop()`.

---

## 4. Architectural Reference

The farol (`.specs/architecture/memory-studio.architecture.json`) is runtime-only (per `farol-runtime-only` MEMORY.md). Phase 7a consumes:

| Farol node | Phase 7a touch | Rationale |
|---|---|---|
| `server` (Fastify · 7 ep → 8 ep) | ADD `GET /metrics` endpoint | New endpoint per R-7 |
| `audit-buffer` (D-007 pattern) | REPLICATE pattern in `metrics-ring-buffer.ts` | Count + time trigger + fail-open |
| `intel-store` / `pipeline.ts` | READ `latencyMs.total` per request | R-3 + R-4 source |
| `match-script` / `messages-proxy.ts` | READ `cache_read_input_tokens` per proxy call | R-2 source |
| `cache` | NOT touched (SHA256(byte-string) is a flow reference, not consumed) | — |

The metrics module is a NEW farol-level concern (operational observability). The `farol-runtime-only` rule means the metrics module itself doesn't get a farol node — it's an internal implementation detail of the `server` node. However, if Phase 7b adds more observability concerns (e.g., a UI dashboard panel), THAT would warrant a new farol node. For Phase 7a, the metrics module is buried inside `server`.

---

## 5. Out of scope (Phase 7a)

Explicitly NOT in Phase 7a (deferred to Phase 7b or later):

- **Real API measurement** (Phase 7b) — re-measure cache hit + latency with real Anthropic API + 10+ turn session. Phase 7a only delivers the OBSERVABILITY surface.
- **Threshold tuning** (Phase 7b) — adjust `min_cosine_similarity: 0.6` and `min_fts_hits: 2` based on metrics from real session.
- **Token-weighted cache coverage** (v3.1+) — PRD §14.6's exact formula (Σ cache_read_input_tokens ÷ Σ total_prompt_tokens). Phase 7a uses request-weighted for dashboard simplicity.
- **Cross-restart metrics persistence** (v3.1+) — Phase 7a resets on restart.
- **Metrics dashboard panel in UI** (v3.1+) — Phase 7a is `GET /metrics` JSON only; UI integration is a follow-up.
- **Prometheus exporter** (v3.1+) — Phase 7a is JSON only.
- **Per-tenant metrics** (v4+) — single-process scope only.
- **Working set trend over time** (v3.1+) — Phase 7a reports the latest sample; historical trend requires persistence.

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Metrics hook adds latency to hot path | Low | High (PRD §10.2 budget) | AC-13 POC re-run after wiring; budget < 0.10ms added |
| `process.memoryUsage().rss` behaves differently on Windows vs POSIX | Low | Low (observability only) | Platform caveat documented in R-5; report raw value |
| Time trigger drift on system clock change | Very low | Low | Use `Date.now()` (epoch ms) not `setTimeout`-only cadence |
| Count trigger race during high QPS | Very low | Low (Node single-threaded) | Count trigger is `counter % 10 === 0` check inside the hot path — atomic |
| Ring buffer overflow | Very low | Low | Cap at 100 samples (window size); drop oldest on overflow (same pattern as AuditRingBuffer) |

---

## 7. Done criteria (closed checkbox)

- [ ] `GET /metrics` endpoint registered
- [ ] `request_hit_rate` computed per R-1
- [ ] `token_cache_coverage` computed per R-2 (null when proxy disabled)
- [ ] `p50_latency_ms` computed per R-3
- [ ] `p99_latency_ms` computed per R-4
- [ ] `working_set_mb` computed per R-5
- [ ] Refresh trigger N=10 OR T=60s implemented per R-6
- [ ] Metrics reset on server restart per R-8
- [ ] No new npm deps per R-9
- [ ] AC-1..AC-14 all PASS
- [ ] POC re-run passes AC-13
- [ ] Scope guard clean (AC-12)
- [ ] Smoke `scripts/smoke-metrics.mjs` passes
- [ ] Test count ≥ 475 root (Phase 6b baseline 459 + ≥16 new metrics tests)

---

**Spec complete. Ready for design.md.**