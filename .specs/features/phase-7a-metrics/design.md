---
date: 2026-08-01
version: 1
description: "Phase 7a — Metrics Instrumentation design. Mirrors the AuditRingBuffer pattern (count + time trigger + fail-open) for an in-process metrics ring buffer; new GET /metrics endpoint (NOT extension of /health); 5-metric dashboard recomputed every N=10 OR T=60s; transient persistence (reset on restart); zero new npm deps."
explanation: |
  Design rationale for Phase 7a. Five architectural decisions documented
  with "why X and not Y" justification per PRD §0 principle.

  Key design choice: NEW `GET /metrics` endpoint, NOT an extension of
  `/health`. `/health` is the liveness probe — its purpose is to confirm
  the server is up and reachable, with a fixed-shape payload used by
  container orchestrators. Phase 7a's metrics are OBSERVABILITY — a
  different concern with a different shape and different consumer (operator
  dashboards, not Kubernetes). Mixing them would inflate `/health`'s
  payload and confuse the liveness/readiness split (PRD §10.4 keeps them
  separate).

  Ring buffer vs counter for each metric: HYBRID approach. Counters
  (cumulative since boot, monotonic) for `request_hit_rate` (the
  numerator and denominator are both counters; the RING buffer isn't
  needed for the ratio). Ring buffer (last N=10 latency samples) for
  `p50/p99` (percentile needs the actual samples, not just a count).
  `working_set_mb` is sampled at flush time (one number, no buffer).

  Refresh trigger: count + time per R-6. The count trigger is
  synchronous (incremented inside the request hot path; recompute when
  counter % 10 === 0). The time trigger is asynchronous
  (setInterval(60_000) cleared on stop). This mirrors AuditRingBuffer's
  count + time pattern from src/server/audit/buffer.ts.

  Persistence: TRANSIENT (reset on restart). No SQLite persistence.
  Rationale: metrics are operational observability, not audit. PRD §10.4
  ops criteria are per-process. Cross-restart observability is a v3.1+
  enhancement if necessary.

  Working set sampling: process.memoryUsage().rss sampled at every flush
  (count OR time trigger). One number, reported in MB (integer floor).
  No history — Phase 7a is point-in-time.
related:
  - ./spec.md
  - ../../ROADMAP.md
  - ../phase-5b-aux-endpoints/{spec,design}.md (AuditRingBuffer + /health pattern)
  - ../phase-6b-fast-agent-intel/{spec,design,validation-phase-6b.4}.md (latency + cache sources)
  - ../../../PRD.md (§10.4 ops, §14.6 cache hit, §17 cache distinction)
  - ../../STATE.md
  - ../../DISCOVERIES.md (AD-009 POC re-run rule)
---

# Phase 7a — Metrics Instrumentation — Design

**Phase:** 7a
**Slug:** `phase-7a-metrics`
**Companion:** `spec.md` (R-NN/AC-NN references)
**Branch:** `loop/phase-0`

---

## 1. Architecture overview

```
                                          ┌─────────────────────────────┐
                                          │  GET /metrics               │
                                          │  ┌───────────────────────┐  │
                                          │  │ request_hit_rate      │  │
                                          │  │ token_cache_coverage  │  │
                                          │  │ p50_latency_ms        │  │
                                          │  │ p99_latency_ms        │  │
                                          │  │ working_set_mb        │  │
                                          │  └───────────────────────┘  │
                                          └────────────▲────────────────┘
                                                       │ recompute on trigger
                                                       │ (count OR time)
┌─────────────────┐   ┌──────────────────────────┐    │
│ /augment        │──▶│  metrics.collector.ts    │────┘
│  (pipeline.ts)  │   │  - onAugment(            │
│  latencyMs.total│   │     matched: boolean,    │   ┌──────────────────────┐
│  matched.count  │   │     latencyMs: number)   │   │  metrics/            │
└─────────────────┘   │  - onProxy(              │   │   ring-buffer.ts     │
                      │     cacheRead: number,   │──▶│   (count + latency   │
┌─────────────────┐   │     latencyMs: number)   │   │    ring + cache hit) │
│ /v1/messages    │──▶│  - onMemorySample()      │   │                      │
│  (proxy.ts)     │   └──────────────────────────┘   │  dashboard.ts        │
│  cache_read_    │                                   │   computeMetrics()   │
│  input_tokens   │                                   │   on trigger         │
└─────────────────┘                                    └──────────────────────┘
```

Three new files (`src/server/metrics/{ring-buffer,collector,dashboard}.ts`) + one new route (`src/server/routes/metrics.ts`) + barrel update (`src/server/routes/index.ts`) + wiring in `src/server/boot.ts` + sample hooks in `pipeline.ts` (after `buildResponse`) and `messages-proxy.ts` (after `cache_read_input_tokens` capture).

---

## 2. Component design

### 2.1 `src/server/metrics/ring-buffer.ts` — MetricsRingBuffer

Mirrors `AuditRingBuffer` (`src/server/audit/buffer.ts`) but stores the metrics data instead of audit events.

**State (module-scoped singleton via `lifecycle.ts` for testability, OR class with `setForTests()` injection):**

```typescript
class MetricsRingBuffer {
  // Counters (cumulative since boot — monotonic; never reset except on stop)
  private matchedRequests = 0;            // numerator of R-1
  private attemptedRequests = 0;          // denominator of R-1
  private cacheHitRequests = 0;           // numerator of R-2
  private proxyRequests = 0;              // denominator of R-2
  private totalRequestCountSinceReset = 0; // for count trigger

  // Latency ring buffer (last N=100 samples — buffer 2x window for percentile edge cases)
  private readonly latencySamples: number[] = new Array(100).fill(0);
  private latencyWriteIdx = 0;
  private latencyCount = 0;               // how many samples written (<=100)

  // Time trigger
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  // Window state (for the dashboard's `window` field)
  private windowStartTs = 0;              // when window started
  private lastRecomputeTs = 0;            // when dashboard was last recomputed
}
```

**API:**

```typescript
class MetricsRingBuffer {
  constructor();
  start(): void;                          // start time interval (60_000ms)
  async stop(): Promise<void>;            // clear interval, flush state

  /** Called from /augment route after a successful response (any status < 400). */
  recordAugment(opts: { matched: boolean; latencyMs: number }): void;

  /** Called from /v1/messages proxy after a 200 response (skip on 503/502). */
  recordProxy(opts: { cacheReadTokens: number; latencyMs: number }): void;

  /** Force-recompute the dashboard (called by time trigger + count trigger). */
  recomputeDashboard(): MetricsSnapshot;

  /** Read latest dashboard (for /metrics endpoint). */
  snapshot(): MetricsSnapshot;

  /** Test-only reset. */
  resetForTests(): void;
}
```

**Why class (not module-scoped singleton):** testability. `lifecycle.ts` provides the singleton accessor (mirroring `AuditRingBuffer` pattern), but the class itself can be instantiated directly in tests. The Implementer can wire it via `lifecycle.ts` (preferred pattern) OR inject directly (less idiomatic).

**Why latency buffer size 100 (not 10):** p99 nearest-rank on a 10-sample window is index 9 (always the last sample — degenerate). A 100-sample buffer lets p99 be a meaningful number even when the dashboard window is small. The dashboard itself reports `window.request_count` (how many requests in the current window) — that's the "last 10" semantic. The latency buffer holds 100 samples for percentile math.

**Why 100 specifically:** 10× the count trigger (10) — gives p50/p99 headroom when bursts hit. Not larger because ring buffer math is O(N) on recompute; 100 is fine.

### 2.2 `src/server/metrics/collector.ts` — sample ingestion

Pure pass-through to the ring buffer. Two functions:

```typescript
export function recordAugmentSample(opts: {
  matched: boolean;       // matched.count > 0
  latencyMs: number;       // latencyMs.total from pipeline
}): void;

export function recordProxySample(opts: {
  cacheReadTokens: number; // from usage.cache_read_input_tokens
  latencyMs: number;
}): void;
```

Implementation: look up the ring buffer via `lifecycle.getMetricsBuffer()` and call `buffer.recordAugment(opts)` / `buffer.recordProxy(opts)`. If buffer is null (not initialized), no-op.

**Why a thin pass-through:** keeps `pipeline.ts` and `messages-proxy.ts` ignorant of the ring buffer internals — the collector is the seam.

### 2.3 `src/server/metrics/dashboard.ts` — recompute logic

```typescript
export interface MetricsSnapshot {
  readonly request_hit_rate: number | null;
  readonly token_cache_coverage: number | null;
  readonly p50_latency_ms: number | null;
  readonly p99_latency_ms: number | null;
  readonly working_set_mb: number;
  readonly window: {
    readonly request_count: number;
    readonly proxy_request_count: number;
    readonly window_age_ms: number;
  };
  readonly proxy_enabled: boolean;
  readonly schema_version: 1;
  readonly timestamp: number;
}

export function computeDashboard(buffer: MetricsRingBuffer): MetricsSnapshot {
  // Pull samples + counters from the buffer
  // Compute p50/p99 from the latency ring (sorted copy + nearest-rank)
  // Sample process.memoryUsage().rss
  // Read proxy_enabled from MEMORY_STUDIO_ANTHROPIC_BASE_URL
  // Return MetricsSnapshot
}
```

**Percentile formula (nearest-rank, not linear interpolation):**

```typescript
function percentile(sortedSamples: number[], p: number): number {
  if (sortedSamples.length === 0) return 0; // caller checks for null
  const idx = Math.ceil((p / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, idx)];
}
```

**Why nearest-rank:** simpler, deterministic, easy to test. Linear interpolation (e.g., numpy default) is more accurate but harder to verify. Nearest-rank matches Phase 5a's percentile mental model (the value at the boundary, not interpolated).

### 2.4 `src/server/routes/metrics.ts` — `GET /metrics` route

```typescript
export async function registerMetricsRoute(
  app: FastifyInstance,
  opts: { buffer: MetricsRingBuffer; proxyEnabled: () => boolean }
): Promise<void> {
  app.get('/metrics', async (): Promise<MetricsSnapshot> => {
    return computeDashboard(opts.buffer);
  });
}
```

**Why a separate route file:** matches Phase 5b pattern (`audit.ts`, `catalog.ts`, etc.). Routes are independently testable + barrel-exported.

### 2.5 `src/server/metrics/lifecycle.ts` — singleton accessor (mirrors `audit/lifecycle.ts`)

```typescript
let bufferInstance: MetricsRingBuffer | null = null;

export function initMetricsBuffer(): MetricsRingBuffer {
  if (bufferInstance !== null) return bufferInstance;
  bufferInstance = new MetricsRingBuffer();
  return bufferInstance;
}

export function getMetricsBuffer(): MetricsRingBuffer | null {
  return bufferInstance;
}

export async function startMetricsBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  bufferInstance.start();
}

export async function stopMetricsBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  await bufferInstance.stop();
}

export function resetMetricsBufferForTests(): void {
  if (bufferInstance !== null) {
    bufferInstance.resetForTests();
  }
  bufferInstance = null;
}
```

### 2.6 `src/server/boot.ts` — wiring

In `createServer()` (after `setIntelWriterDb(options.db)`):

```typescript
const metricsBuffer = initMetricsBuffer();
await startMetricsBuffer();
await registerMetricsRoute(app, {
  buffer: metricsBuffer,
  proxyEnabled: () => readUpstreamUrl() !== null,
});
```

In `close()`:

```typescript
await stopMetricsBuffer();
await stopAuditBuffer();
await app.close();
```

### 2.7 Sample hooks in existing code

**`src/server/augment/pipeline.ts`** (after `return buildResponse({...})` line 250, in `runAugment`):

```typescript
// --- Stage 9.6: Metrics sample (Phase 7a) ---------------------------------
// Record matched.count + latencyMs.total for the metrics dashboard.
// NO-OP when the metrics buffer is not initialized (the in-memory smoke
// path). Fire-and-forget — never blocks the request.
recordAugmentSample({
  matched: matched.length > 0,
  latencyMs: totalMs,
});
```

This goes in `runAugment` AFTER `buildResponse` returns. The `matched` variable is in scope from Stage 7 (`topKAndTiebreak`). `totalMs` is already computed. The hook is best-effort (`recordAugmentSample` swallows errors).

**Important — fail-open paths:** `personaOnlyResponse` and `failOpenResponse` also call `recordAugmentSample` (with `matched: false`) so their latency is counted in p50/p99 (they're real requests that took real time).

**`src/server/routes/messages-proxy.ts`** (after the `enqueueAuditSafe(...)` call at line 371):

```typescript
// --- 10.5 Metrics sample (Phase 7a) ---------------------------------------
// Record cache_read_input_tokens + total latency for the metrics dashboard.
// NO-OP when metrics buffer is not initialized or proxy is disabled.
if (cacheReadInputTokens !== null) {
  recordProxySample({
    cacheReadTokens: cacheReadInputTokens,
    latencyMs: performance.now() - tProxyStart,  // need to capture tProxyStart at entry
  });
}
```

`tProxyStart` needs to be captured at the top of the route handler (Phase 6b doesn't currently capture proxy entry time). The Verifier should check this addition is non-regressive.

---

## 3. Endpoint: `GET /metrics` vs extend `/health`

**Decision:** NEW endpoint `GET /metrics`. NOT an extension of `/health`.

**Why X (new endpoint) and not Y (extend /health):**

- **X** keeps `/health` a minimal liveness probe (200 + uptime + last_request_ts + audit_buffer + catalog). Container orchestrators (Kubernetes, ECS) parse `/health` and expect a fixed, minimal shape. Inflating it with 5+ metric fields makes it harder to grep in container logs and harder to mock.
- **X** separates LIFECYCLE concerns: `/health` is "is the server up?" (binary yes/no); `/metrics` is "how is the server performing?" (quantitative).
- **Y** (extending `/health`) was tempting because `/health` already exists, but it conflates two responsibilities:
  - The `audit_buffer` block in `/health` is a D-007 STUCK-BUFFER SIGNAL (a binary "is the buffer stuck?" indicator for operators).
  - The metrics are a quantitative dashboard for trend analysis.
  - Mixing them makes the `/health` shape drift over time as metrics evolve.
- **Y** would require versioning the `/health` shape every time metrics change (consumer pain for K8s probes).
- **X** matches Phase 5b's existing pattern: `/health` is stable (Phase 5b T-08 enhanced it once with `audit_buffer` + `catalog`, schema_version bumped to 3); NEW endpoints (`/audit`, `/audit/summary`, `/catalog`, `/catalog/rebuild`, `/state/toggle`, `/v1/messages`) are added for new functionality. Phase 7a follows the same pattern.

**Schema version:** `/metrics` returns `schema_version: 1` (its own counter, not tied to `/health`'s v3).

---

## 4. Counter vs ring buffer per metric

| Metric | Storage | Why |
|---|---|---|
| `request_hit_rate` | Counter pair (`matchedRequests`, `attemptedRequests`) | The ratio is a single division of two counters. No buffer needed. |
| `token_cache_coverage` | Counter pair (`cacheHitRequests`, `proxyRequests`) | Same as R-1. |
| `p50_latency_ms` | Ring buffer (last 100 samples) | Percentile needs the actual samples, not just a count. |
| `p99_latency_ms` | Ring buffer (shared with R-3) | Same. |
| `working_set_mb` | Single number (re-sampled at recompute) | Point-in-time; no history. |
| Window metadata | Single `windowStartTs` + `lastRecomputeTs` | Trivial. |

**Why NOT keep ALL metrics in counters (R-3/R-4 specifically):** `request_hit_rate` is a simple ratio. `p50_latency_ms` is NOT — it's a percentile that needs the underlying samples to compute correctly. A counter (sum + count) can give the MEAN but not the percentile. The ring buffer gives both (sum + count + samples for percentiles).

**Why NOT keep ALL metrics in a ring buffer:** `request_hit_rate` only needs hit/miss booleans, not the samples themselves. Storing booleans in a ring buffer would be more expensive than two counters.

---

## 5. Refresh trigger implementation

### 5.1 Count trigger (every 10 requests)

Inside `runAugment` (after `recordAugmentSample`), the metrics ring buffer increments `totalRequestCountSinceReset`. When `totalRequestCountSinceReset % 10 === 0`, `recomputeDashboard()` fires synchronously:

```typescript
// In ring-buffer.ts
recordAugment(opts: { matched: boolean; latencyMs: number }): void {
  // ... update counters + ring buffer ...
  if (opts.matched) this.matchedRequests++;
  this.attemptedRequests++;
  this.totalRequestCountSinceReset++;
  this.pushLatencySample(opts.latencyMs);

  // Count trigger
  if (this.totalRequestCountSinceReset % 10 === 0) {
    this.recomputeDashboard();
  }
}
```

The `recomputeDashboard()` is synchronous and fast (O(100) for percentile sort + O(1) for everything else). AC-13 budgets < 0.10ms added overhead.

### 5.2 Time trigger (every 60s)

In `MetricsRingBuffer.start()`:

```typescript
start(): void {
  this.flushTimer = setInterval(() => {
    this.recomputeDashboard();
    this.totalRequestCountSinceReset = 0;  // reset count trigger window
  }, 60_000);
  this.flushTimer.unref?.();  // don't keep event loop alive in tests
}
```

### 5.3 What "recompute" means

`recomputeDashboard()` is the SAME function that the `/metrics` route calls. It produces a `MetricsSnapshot`. The route serves the latest snapshot (no recompute on the request path — just read). The trigger recomputes and caches the snapshot.

**Optimization:** the `recomputeDashboard` is called from both triggers AND the `/metrics` endpoint reads from a cached snapshot. The endpoint does NOT recompute on read — it just returns the cached value. This keeps `/metrics` fast (constant-time, < 1ms) and decouples read cost from write cost.

---

## 6. Persistence semantics

**Decision:** TRANSIENT (counters + ring buffer reset on restart).

**Why X (transient) and not Y (persist to SQLite):**

- **X** matches PRD §10.4's per-process ops criteria. The budgets (`p50<50ms`, `p99<200ms`, `working_set<1.5GB/1h`) are per-process.
- **X** is simpler — no SQLite schema migration, no schema_version tracking, no restore-on-boot logic.
- **X** keeps the metrics module isolated from the audit buffer (which DOES persist to SQLite). Mixing them would conflate two responsibilities.
- **Y** (persist) is v3.1+ if cross-restart observability becomes necessary (e.g., to compare "this morning's session" vs "yesterday's session"). Phase 7a is the MVP observability surface, not the historical analytics surface.

**State on restart:**
- `matchedRequests = 0`, `attemptedRequests = 0`
- `cacheHitRequests = 0`, `proxyRequests = 0`
- `latencySamples = [0, 0, ..., 0]`, `latencyCount = 0`
- `windowStartTs = Date.now()`, `lastRecomputeTs = 0`
- `workingSetMb = process.memoryUsage().rss / 1024 / 1024` (re-sampled at first flush)

---

## 7. Subchapter breakdown recommendation

**Decision:** NO subchapter breakdown. Single batch (≤8 atomic tasks).

**Why X (single batch):**

- **X** fits the task budget: 6-8 atomic tasks (T-01..T-06 + optional T-07 integration). Single Implementer batch is the canonical pattern for ≤7 tasks (per `tlc-spec-driven` sub-agent delegation rule).
- **X** is the smallest phase yet (2-3h estimate; 5 metrics + 1 endpoint). Subchapter overhead (planning + re-verification cycles) would exceed the implementation cost.
- **Y** (subchapters) would be excessive for a feature this small. Phase 6b needed subchapters because it had 17 atomic tasks across 4 distinct concerns (intel store, fast agent, BuildOptions.intel, pipeline integration). Phase 7a has 1 concern (metrics dashboard).

**If something forces a split (unlikely):**
- **7a.1** — metrics module (ring buffer + dashboard logic) + tests
- **7a.2** — endpoint + wiring + smoke

This split is NOT anticipated. Implementer should plan for single batch.

---

## 8. Hot path overhead (AC-13 budget)

The metrics sample hook in `runAugment` adds:

1. Function call overhead (`recordAugmentSample`): ~1μs (Node built-in call).
2. Counter increments: ~0.1μs (two number increments).
3. Ring buffer write (one number push): ~0.5μs.
4. Count trigger check (`% 10 === 0`): ~0.05μs.
5. Total: < 2μs (~0.002ms).

**POC re-run budget:** total overhead should remain ≤ 0.30ms (Phase 6b measured ≤ 0.22ms; +0.10ms budget for metrics hook). If POC re-run shows > 0.30ms, optimize (not collapse) per AD-009 rule.

---

## 9. Working set measurement

`process.memoryUsage().rss` returns the OS-level Resident Set Size. Platform behavior:

- **Windows:** RSS grows monotonically within a process (even after garbage collection). Reported value may be higher than actual in-use memory.
- **Linux/macOS:** RSS may fluctuate (page reclamation by the kernel).

Phase 7a reports the raw value. Operators interpret based on platform knowledge. PRD §10.2.3 budget (<1.5GB) is generous enough to accommodate Windows RSS behavior.

**Why NOT use `heapUsed`:** that's V8-specific heap. RSS is the more honest "process working set" measure.

**Why NOT compute a trend:** Phase 7a is point-in-time. Trend requires persistence (v3.1+).

---

## 10. Out of scope (Phase 7a)

- Token-weighted `token_cache_coverage` (PRD §14.6's exact formula)
- Cross-restart persistence
- UI metrics panel (UI consumes the JSON endpoint via a follow-up)
- Prometheus exporter
- Per-tenant metrics
- Working set history / trend
- Alert thresholds (e.g., "p99 > 200ms → alert")
- Time-series storage (e.g., SQLite-backed ring of snapshots)

All deferred to Phase 7b (real-API tuning) or v3.1+ (general observability enhancements).

---

**Design complete. Ready for tasks.md.**