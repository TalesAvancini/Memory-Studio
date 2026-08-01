---
date: 2026-08-01
version: 1
description: "Phase 7a — Metrics Instrumentation tasks. 7 atomic tasks (T-01..T-07) — single batch, NO subchapter split. Mirrors AuditRingBuffer pattern; new GET /metrics endpoint; 5-metric dashboard with N=10 OR T=60s refresh; transient persistence; zero new deps. Hot path overhead budget < 0.10ms (POC re-run gates AC-13)."
explanation: |
  Atomic task breakdown for Phase 7a. Each task is one logical unit (one
  file or one tightly-coupled pair). Dependencies are explicit
  (`Depends on:`) so the Implementer can sequence correctly. AC-NN
  references trace every task back to the spec's acceptance criteria.

  Sequencing rationale:
  - T-01 (ring buffer) is foundational — T-02 (lifecycle) depends on it.
  - T-02 (lifecycle) is the singleton accessor — T-03 (collector) and
    T-05 (boot) depend on it.
  - T-03 (collector) is the seam — T-04 (route) consumes it via
    dashboard.ts. T-06 (wiring into pipeline/proxy) consumes it directly.
  - T-04 (route) consumes the dashboard snapshot.
  - T-05 (boot) wires everything together — depends on T-01..T-04.
  - T-06 (hot path hooks in pipeline.ts + messages-proxy.ts) depends on T-03.
  - T-07 (tests + smoke) depends on T-01..T-06.
  - T-08 (optional integration test) depends on T-07.

  Each task includes:
  - One paragraph describing the change
  - Explicit `Depends on:`
  - File(s) to create or modify
  - Verification commands (test runner decides — no self-assessment)
  - AC-NN traceability
  - Atomic commit message
related:
  - ./spec.md (R-NN/AC-NN references)
  - ./design.md (architecture rationale)
  - ../../ROADMAP.md (Phase 7a entry)
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md (AuditRingBuffer pattern reference)
  - ../phase-6b-fast-agent-intel/{spec,design,tasks,validation-phase-6b.4}.md (latency + cache sources)
  - ../../../PRD.md (§10.4 ops, §14.6 cache hit, §17 cache distinction)
  - ../../STATE.md
  - ../../DISCOVERIES.md (AD-009 POC re-run rule)
---

# Phase 7a — Metrics Instrumentation — Tasks

**Phase:** 7a
**Slug:** `phase-7a-metrics`
**Companions:** `spec.md`, `design.md`
**Branch:** `loop/phase-0`
**Total tasks:** 7 atomic + 1 optional integration test (T-08)
**Subchapter breakdown:** NO (single batch, ≤ 8 tasks per `tlc-spec-driven` rule)

---

## Task sequencing overview

```
T-01 (ring-buffer.ts)
  │
  ▼
T-02 (lifecycle.ts)
  │
  ├──────────────┐
  ▼              ▼
T-03          T-04 (route.ts + dashboard.ts)
(collector.ts)  │
  │              │
  └──────┬───────┘
         ▼
       T-05 (boot.ts wiring)
         │
         ▼
       T-06 (pipeline.ts + messages-proxy.ts hooks)
         │
         ▼
       T-07 (tests + smoke)
         │
         ▼
       T-08 (OPTIONAL integration test)
```

---

## T-01 — MetricsRingBuffer class (`src/server/metrics/ring-buffer.ts`)

**Description:** Create the `MetricsRingBuffer` class that mirrors `AuditRingBuffer` (`src/server/audit/buffer.ts`). Stores counters for hit-rate / cache-coverage ratios + a 100-element ring buffer for latency samples (for p50/p99 percentile calculation). Implements `start()`, `stop()`, `recordAugment()`, `recordProxy()`, `recomputeDashboard()`, `snapshot()`, `resetForTests()`.

**Depends on:** none (foundational — mirrors existing `src/server/audit/buffer.ts`)

**Files to create:**
- `src/server/metrics/ring-buffer.ts` (NEW, ~120 lines)

**Required interface (matches design.md §2.1):**

```typescript
export class MetricsRingBuffer {
  constructor();
  start(): void;                                                       // sets setInterval(60_000)
  async stop(): Promise<void>;                                          // clears interval, clears state

  recordAugment(opts: { matched: boolean; latencyMs: number }): void;  // increments counters, pushes latency
  recordProxy(opts: { cacheReadTokens: number; latencyMs: number }): void; // increments counters

  recomputeDashboard(): MetricsSnapshot;                                // forced recompute
  snapshot(): MetricsSnapshot;                                          // returns cached

  resetForTests(): void;                                                // test-only reset
}

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
```

**Key implementation notes:**

- Latency ring buffer: 100-element `Float64Array` (or `number[]`) with `writeIdx` (mod 100). Oldest samples dropped on overflow (matches `AuditRingBuffer` pattern with `RING_BUFFER_CAPACITY` hard cap).
- Percentile calculation: nearest-rank (not linear interpolation). `idx = Math.ceil(p / 100 * sorted.length) - 1`. Returns the sample at that index after `Array.sort()`.
- `working_set_mb`: `Math.floor(process.memoryUsage().rss / 1024 / 1024)`.
- `proxy_enabled`: reads `process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL']` at compute time (NOT cached — allows runtime env changes; though none expected).
- `setInterval` must `unref()` so a pending interval does not keep the event loop alive in tests.

**Forbidden:**
- New npm deps (NO `lodash`, NO `mathjs`, NO `percentile` libs — use built-in sort).
- Touching any file outside `src/server/metrics/ring-buffer.ts`.

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
node --experimental-strip-types --no-warnings -e "
  const { MetricsRingBuffer } = await import('./src/server/metrics/ring-buffer.ts');
  const buf = new MetricsRingBuffer();
  buf.start();
  buf.recordAugment({ matched: true, latencyMs: 10 });
  buf.recordAugment({ matched: false, latencyMs: 20 });
  buf.recordProxy({ cacheReadTokens: 42, latencyMs: 30 });
  const snap = buf.snapshot();
  console.assert(snap.request_hit_rate === 0.5, 'R-1: 1/2 = 0.5');
  console.assert(snap.working_set_mb > 0, 'R-5: rss > 0');
  await buf.stop();
"
```

**AC-NN traceability:** AC-4, AC-5, AC-6, AC-7 (substrate for all 5 metrics)

**Atomic commit:**
```bash
git add src/server/metrics/ring-buffer.ts
git commit -m "feat(metrics): MetricsRingBuffer class — counters + latency ring + dashboard recompute (phase 7a T-01)"
```

---

## T-02 — Metrics lifecycle singleton (`src/server/metrics/lifecycle.ts`)

**Description:** Create the singleton accessor for `MetricsRingBuffer`, mirroring `src/server/audit/lifecycle.ts`. Provides `initMetricsBuffer()`, `getMetricsBuffer()`, `startMetricsBuffer()`, `stopMetricsBuffer()`, `resetMetricsBufferForTests()`.

**Depends on:** T-01 (`MetricsRingBuffer` class)

**Files to create:**
- `src/server/metrics/lifecycle.ts` (NEW, ~50 lines)

**Required interface (matches design.md §2.5):**

```typescript
import { MetricsRingBuffer } from './ring-buffer.ts';

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

export function setMetricsBufferForTests(buffer: MetricsRingBuffer | null): void {
  bufferInstance = buffer;
}

export function resetMetricsBufferForTests(): void {
  if (bufferInstance !== null) {
    bufferInstance.resetForTests();
  }
  bufferInstance = null;
}
```

**Forbidden:**
- Touching any file outside `src/server/metrics/lifecycle.ts`.
- Adding new npm deps.

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
node --experimental-strip-types --no-warnings -e "
  const m = await import('./src/server/metrics/lifecycle.ts');
  const buf = m.initMetricsBuffer();
  console.assert(m.getMetricsBuffer() === buf, 'singleton');
  m.resetMetricsBufferForTests();
  console.assert(m.getMetricsBuffer() === null, 'reset works');
"
```

**AC-NN traceability:** none directly (substrate for T-03/T-05)

**Atomic commit:**
```bash
git add src/server/metrics/lifecycle.ts
git commit -m "feat(metrics): lifecycle singleton accessor (phase 7a T-02)"
```

---

## T-03 — Metrics collector (`src/server/metrics/collector.ts`) + dashboard helper (`src/server/metrics/dashboard.ts`)

**Description:** Create the collector (thin pass-through from `pipeline.ts` / `messages-proxy.ts` to the ring buffer) and the dashboard helper (extracted from T-01's class to allow direct invocation from the route without a buffer instance).

**Depends on:** T-01, T-02

**Files to create:**
- `src/server/metrics/collector.ts` (NEW, ~30 lines)
- `src/server/metrics/dashboard.ts` (NEW, ~50 lines)

**Required interface:**

**`collector.ts`:**
```typescript
import { getMetricsBuffer } from './lifecycle.ts';

export function recordAugmentSample(opts: { matched: boolean; latencyMs: number }): void {
  try {
    const buf = getMetricsBuffer();
    buf?.recordAugment(opts);
  } catch {
    // fail-open: metrics never block the request
  }
}

export function recordProxySample(opts: { cacheReadTokens: number; latencyMs: number }): void {
  try {
    const buf = getMetricsBuffer();
    buf?.recordProxy(opts);
  } catch {
    // fail-open
  }
}
```

**`dashboard.ts`:**
```typescript
import type { MetricsRingBuffer, MetricsSnapshot } from './ring-buffer.ts';

export function computeDashboard(buffer: MetricsRingBuffer): MetricsSnapshot {
  // Internal helper — allows the route to recompute on demand OR use cached
  return buffer.recomputeDashboard();
}

export function readDashboard(buffer: MetricsRingBuffer): MetricsSnapshot {
  // Returns the cached snapshot (no recompute)
  return buffer.snapshot();
}
```

**Why split collector + dashboard:**
- `collector.ts` is the WRITE path (from pipeline/proxy). Thin pass-through to keep callers ignorant of buffer internals.
- `dashboard.ts` is the READ path (from route). Provides both `compute` (recompute on demand) and `read` (cached) — route uses `read` for fast responses.

**Forbidden:**
- Adding new npm deps.
- Touching files outside `src/server/metrics/{collector,dashboard}.ts`.

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
node --experimental-strip-types --no-warnings -e "
  const lc = await import('./src/server/metrics/lifecycle.ts');
  const col = await import('./src/server/metrics/collector.ts');
  const buf = lc.initMetricsBuffer();
  col.recordAugmentSample({ matched: true, latencyMs: 50 });
  col.recordAugmentSample({ matched: false, latencyMs: 75 });
  console.assert(buf.snapshot().request_hit_rate === 0.5, 'ratio correct');
  lc.resetMetricsBufferForTests();
"
```

**AC-NN traceability:** AC-1, AC-2, AC-3 (substrate)

**Atomic commit:**
```bash
git add src/server/metrics/collector.ts src/server/metrics/dashboard.ts
git commit -m "feat(metrics): collector (write path) + dashboard helper (read path) (phase 7a T-03)"
```

---

## T-04 — `/metrics` endpoint (`src/server/routes/metrics.ts` + barrel update)

**Description:** Create the `GET /metrics` route that returns the `MetricsSnapshot` as JSON. Update `src/server/routes/index.ts` barrel to re-export `registerMetricsRoute`.

**Depends on:** T-03 (`dashboard.ts` provides `readDashboard`)

**Files to create:**
- `src/server/routes/metrics.ts` (NEW, ~30 lines)

**Files to modify:**
- `src/server/routes/index.ts` (+1 line — re-export `registerMetricsRoute`)

**Required interface:**

```typescript
// src/server/routes/metrics.ts
import type { FastifyInstance } from 'fastify';
import type { MetricsRingBuffer } from '../metrics/ring-buffer.ts';
import { readDashboard } from '../metrics/dashboard.ts';

export async function registerMetricsRoute(
  app: FastifyInstance,
  opts: { buffer: MetricsRingBuffer }
): Promise<void> {
  app.get('/metrics', async (): Promise<unknown> => {
    return readDashboard(opts.buffer);
  });
}
```

**Barrel update** (`src/server/routes/index.ts`):
```typescript
// Add at end of existing re-exports:
export { registerMetricsRoute } from './metrics.ts';
```

**Forbidden:**
- Touching files outside `src/server/routes/metrics.ts` and `src/server/routes/index.ts`.
- Adding new npm deps.

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
# Smoke: create Fastify app, register route, GET /metrics, assert 200 + shape
node --experimental-strip-types --no-warnings -e "
  const Fastify = (await import('fastify')).default;
  const lc = await import('./src/server/metrics/lifecycle.ts');
  const { registerMetricsRoute } = await import('./src/server/routes/metrics.ts');
  const buf = lc.initMetricsBuffer();
  const app = Fastify();
  await registerMetricsRoute(app, { buffer: buf });
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  console.assert(res.statusCode === 200, 'AC-8: 200');
  const body = res.json();
  console.assert(typeof body.working_set_mb === 'number', 'AC-8: working_set_mb present');
  console.assert(body.schema_version === 1, 'AC-8: schema_version 1');
  await app.close();
  lc.resetMetricsBufferForTests();
"
```

**AC-NN traceability:** AC-8 (endpoint shape)

**Atomic commit:**
```bash
git add src/server/routes/metrics.ts src/server/routes/index.ts
git commit -m "feat(metrics): GET /metrics route + barrel update (phase 7a T-04)"
```

---

## T-05 — `boot.ts` wiring (init + start + register route + close)

**Description:** Wire the metrics module into the server lifecycle. After `setIntelWriterDb(options.db)`, call `initMetricsBuffer()` + `startMetricsBuffer()` + `registerMetricsRoute(app, { buffer })`. Update `close()` to call `stopMetricsBuffer()` BEFORE `stopAuditBuffer()`.

**Depends on:** T-02, T-03, T-04

**Files to modify:**
- `src/server/boot.ts` (+~10 lines)

**Specific changes:**

1. Import block (after existing `setIntelWriterDb` import):
```typescript
import {
  initMetricsBuffer,
  startMetricsBuffer,
  stopMetricsBuffer,
} from './metrics/lifecycle.ts';
import { registerMetricsRoute } from './routes/index.ts';
```

2. In `createServer()` body, AFTER `setIntelWriterDb(options.db)` (around line 188):
```typescript
// Phase 7a (T-05) — metrics module wiring. The buffer is initialized
// AFTER the audit buffer so the metrics module sees the audit
// lifecycle first (audit owns the DB). startMetricsBuffer begins the
// 60s time trigger; registerMetricsRoute adds GET /metrics to the
// Fastify instance. The buffer is module-scoped via lifecycle.ts so
// the route + collectors share the same instance.
const metricsBuffer = initMetricsBuffer();
await startMetricsBuffer();
await registerMetricsRoute(app, { buffer: metricsBuffer });
```

3. In `close()` (around line 226), modify to:
```typescript
async close() {
  // Stop the metrics time interval BEFORE closing Fastify so the
  // interval does not fire during shutdown. Then drain the audit
  // buffer (existing Phase 5b behavior). Then close Fastify.
  await stopMetricsBuffer();
  await stopAuditBuffer();
  await app.close();
},
```

**Forbidden:**
- Touching any file outside `src/server/boot.ts`.
- Changing existing routes' behavior (Phase 6b territory preserved).
- Adding new npm deps.

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
# Smoke: boot server with no DB, hit /metrics, expect 200 + valid shape
node --experimental-strip-types --no-warnings src/server/boot.ts &
SERVER_PID=$!
sleep 2
curl -s http://127.0.0.1:42900/metrics | head -c 500  # adjust port from logs
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
# Expect: working_set_mb present, schema_version=1, proxy_enabled=false (env unset)
```

**AC-NN traceability:** AC-7 (refresh trigger wired), AC-8 (endpoint served), AC-9 (reset on restart)

**Atomic commit:**
```bash
git add src/server/boot.ts
git commit -m "feat(metrics): wire metrics module into boot.ts lifecycle (phase 7a T-05)"
```

---

## T-06 — Sample hooks in `pipeline.ts` + `messages-proxy.ts`

**Description:** Add `recordAugmentSample` calls to `runAugment` (after `buildResponse` in all 3 paths: matched, persona-only, fail-open) + `recordProxySample` calls to the `/v1/messages` route (after `cache_read_input_tokens` capture on 200 responses only). Capture proxy entry time `tProxyStart` for the latency measurement.

**Depends on:** T-03 (`collector.ts` provides `recordAugmentSample` + `recordProxySample`)

**Files to modify:**
- `src/server/augment/pipeline.ts` (+~15 lines, 3 hook sites)
- `src/server/routes/messages-proxy.ts` (+~10 lines, 1 hook site + 1 time capture)

**Specific changes:**

**`pipeline.ts`** — add at the end of `runAugment` (after `return buildResponse({...})` at line 250):

```typescript
// --- Stage 9.6: Metrics sample (Phase 7a T-06) -----------------------------
// Record matched.count + latencyMs.total for the metrics dashboard.
// NO-OP when the metrics buffer is not initialized (the in-memory smoke
// path) OR when the buffer throws (fail-open per D-007 mirror). Never
// blocks the request — fire-and-forget.
recordAugmentSample({
  matched: matched.length > 0,
  latencyMs: totalMs,
});
```

Add at the end of `personaOnlyResponse` (after `return buildResponse({...})` at line 319):

```typescript
// --- Phase 7a T-06: metrics sample (fail-open path, matched=false) -------
recordAugmentSample({
  matched: false,
  latencyMs: totalMs,
});
```

Add at the end of `failOpenResponse` (after `return buildResponse({...})` at line 354):

```typescript
// --- Phase 7a T-06: metrics sample (fail-open path, matched=false) -------
recordAugmentSample({
  matched: false,
  latencyMs: totalMs,
});
```

**`messages-proxy.ts`** — at the top of the route handler (after `const decisionTraceId = ...` at line 177):

```typescript
const tProxyStart = performance.now();  // Phase 7a T-06 — metrics entry time
```

After the audit `enqueueAuditSafe` call (line 371, BEFORE `reply.code(upstreamRes.status)`):

```typescript
// --- Phase 7a T-06: metrics sample (proxy path) ---------------------------
// Only record on 200 responses (NOT 503 proxy_disabled, NOT 502
// augment_failed/upstream_fetch_failed/proxy_host_notallowed — those
// failures don't count as proxy_requests per R-2 denominator).
if (upstreamRes.status === 200 && cacheReadInputTokens !== null) {
  recordProxySample({
    cacheReadTokens: cacheReadInputTokens,
    latencyMs: performance.now() - tProxyStart,
  });
}
```

**Forbidden:**
- Changing existing `runAugment` / `messages-proxy.ts` behavior (Phase 6b + 5b territory preserved).
- Touching any file outside `pipeline.ts` + `messages-proxy.ts`.
- Adding new npm deps.
- Touching `src/server/audit/**` (existing audit behavior must remain unchanged).

**Verification (gate must pass):**
```bash
npm run typecheck                                         # exit 0
npm test -- --test-name-pattern="inception-pipeline"      # existing tests still PASS (no regression)
npm test -- --test-name-pattern="inception-cache-hit"     # existing tests still PASS
# Smoke: boot server, drive /augment 10x, GET /metrics, expect request_count=10, p50 populated
node --experimental-strip-types --no-warnings src/server/boot.ts &
SERVER_PID=$!
sleep 2
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -s -X POST http://127.0.0.1:42900/augment -H 'content-type: application/json' \
    -d '{"prompt":"test","context":null,"fingerprint":{"projectPath":".","agentId":"claude-code","sessionId":"test","gitBranch":"main"},"activeCatalog":[],"tenantId":"test","schemaVersion":3}'
done
curl -s http://127.0.0.1:42900/metrics | head -c 500
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null
```

**AC-NN traceability:** AC-1, AC-3, AC-4, AC-5 (sample sources wired), AC-13 (POC re-run gates hot-path overhead)

**Atomic commit:**
```bash
git add src/server/augment/pipeline.ts src/server/routes/messages-proxy.ts
git commit -m "feat(metrics): sample hooks in pipeline.ts + messages-proxy.ts (phase 7a T-06)"
```

---

## T-07 — Tests (`test/server/metrics/{ring-buffer,dashboard,route,reset}.test.mjs`) + smoke (`scripts/smoke-metrics.mjs`)

**Description:** Add unit tests for the ring buffer + dashboard + endpoint + reset semantics. Add a smoke script that boots the server, drives `/augment` 10 times, GETs `/metrics`, asserts the 5 metrics + the refresh trigger fired.

**Depends on:** T-01..T-06

**Files to create:**
- `test/server/metrics/ring-buffer.test.mjs` (NEW, ~80 lines) — T-01 substrate
- `test/server/metrics/dashboard.test.mjs` (NEW, ~150 lines, ≥8 cases) — T-01+T-03 substrate
- `test/server/metrics/route.test.mjs` (NEW, ~50 lines, ≥2 cases) — T-04 endpoint shape
- `test/server/metrics/reset.test.mjs` (NEW, ~30 lines, 1 case) — AC-9 transient on restart
- `scripts/smoke-metrics.mjs` (NEW, ~150 lines) — end-to-end smoke

**Required test cases (from spec.md AC-NN):**

**`test/server/metrics/dashboard.test.mjs`:**
1. `request_hit_rate_with_mixed_paths` — AC-1
2. `request_hit_rate_zero_attempted_returns_null` — EC-1
3. `token_cache_coverage_proxy_disabled` — AC-2
4. `token_cache_coverage_proxy_enabled` — AC-3
5. `p50_latency_ms_with_known_samples` — AC-4
6. `p99_latency_ms_nearest_rank_with_100_samples` — AC-5
7. `p99_latency_ms_nearest_rank_with_10_samples` — AC-5 (small-sample)
8. `working_set_mb_positive_integer` — AC-6
9. `refresh_trigger_count_and_time` — AC-7 (mock timers for time trigger)
10. `request_hit_rate_excludes_social_and_failopen` — AC-1 edge case

**`test/server/metrics/route.test.mjs`:**
1. `metrics_endpoint_shape` — AC-8 (200 + 9 keys present)
2. `metrics_endpoint_always_200` — AC-8 (even with empty buffer)

**`test/server/metrics/ring-buffer.test.mjs`:**
1. `recordAugment_increments_counters`
2. `recordProxy_increments_counters`
3. `ring_buffer_overflow_drops_oldest` (push 105 samples, verify only 100 retained)
4. `start_stop_clears_interval`

**`test/server/metrics/reset.test.mjs`:**
1. `metrics_reset_on_restart` — AC-9

**`scripts/smoke-metrics.mjs` (Phase 5b-style smoke):**
1. Boot server with port range `[48300, 48399]` (distinct from `[42900, 43000]` to avoid test#366 flake + distinct from `[47700, 47799]` smoke-latency-trick)
2. Drive 10 `/augment` requests with stub payload (1 matched, 9 persona-only)
3. GET `/metrics` → assert `request_hit_rate = 0.1`, `p50_latency_ms > 0`, `p99_latency_ms > 0`, `working_set_mb > 0`, `proxy_enabled = false`, `schema_version = 1`
4. (Optional) Boot a stub upstream, drive 5 `/v1/messages`, assert `token_cache_coverage` populates

**Port range reminder:** test#366 exhausts `[42900, 43000]`. Phase 6b smokes used `[47700, 47799]`. Phase 7a must use a distinct range to avoid port exhaustion. Choose `[48300, 48399]` (or `[49200, 49299]` — pick a range that's documented + unused).

**Forbidden:**
- Touching any existing test file (no regressions to Phase 6b/6a/5b test suites).
- Touching locked layers (`src/search/**`, `src/social-detector/**`, `src/fingerprint/**`, `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md`).
- Adding new npm deps.

**Verification (gate must pass):**
```bash
npm test -- --test-name-pattern="metrics"                  # all metrics tests PASS
node --experimental-strip-types --no-warnings scripts/smoke-metrics.mjs  # exit 0
```

**AC-NN traceability:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9 (all functional ACs)

**Atomic commit:**
```bash
git add test/server/metrics/ scripts/smoke-metrics.mjs
git commit -m "test(metrics): ring buffer + dashboard + route + reset tests + smoke (phase 7a T-07)"
```

---

## T-08 — OPTIONAL: integration test (`test/server/metrics/integration.test.mjs`)

**Description:** Optional integration test that boots a real Fastify server, drives `/augment` 100 times via `app.inject()`, and verifies all 5 metrics accumulate correctly. This is the end-to-end gate that exercises the full stack (T-01..T-07 wired together). **Implementer should only do this if T-07 leaves gaps; otherwise T-07's tests + smoke are sufficient.**

**Depends on:** T-07

**Files to create (only if Implementer decides to):**
- `test/server/metrics/integration.test.mjs` (NEW, ~120 lines, 1 large case)

**Required test cases (single case or 3 sub-cases):**

1. **Drive 100 `/augment` requests via `app.inject()`** with mixed payloads (50 matched, 30 no-match, 10 social, 10 fail-open via empty activeCatalog).
2. Assert `request_hit_rate = 50 / 80 = 0.625` (denominator excludes 20 social/no-active).
3. Assert `p50_latency_ms > 0` and `p99_latency_ms > 0` and `p50 ≤ p99`.
4. Assert `working_set_mb > 0` and `< 1500`.
5. Assert `window.request_count = 100` (all requests in window).
6. Assert refresh trigger fired at request #10 (timestamp advances).

**Why optional:** T-07 already covers unit + smoke. The integration test exercises a higher-fidelity stack (Fastify inject with full boot) but adds test runtime (~5s) without much incremental confidence. **Implementer judgment call.**

**Forbidden:** Same as T-07.

**Verification (gate must pass):**
```bash
npm test -- --test-name-pattern="metrics/integration"      # PASS (if implemented)
```

**AC-NN traceability:** AC-13 (POC ceilings), AC-14 (working set < 1500), AC-12 (scope guard)

**Atomic commit (only if implemented):**
```bash
git add test/server/metrics/integration.test.mjs
git commit -m "test(metrics): optional integration test — 100 /augment drives, all metrics accumulate (phase 7a T-08)"
```

---

## Final gates (after T-07 or T-08)

The Implementer MUST run these gates before requesting Verifier:

```bash
npm test                                                 # all tests PASS (≥475 root, ≥152 UI, ≥16 SDK)
npm run typecheck                                        # exit 0, no output
npm run verify-env                                       # 6/6 checks PASS
node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs  # TOTAL overhead ≤ 0.30ms (AC-13)
node --experimental-strip-types --no-warnings scripts/smoke-metrics.mjs    # exit 0
git diff --stat $(git rev-list --max-parents=0 HEAD)..
  src/search src/social-detector src/fingerprint packages/sdk packages/ui CLAUDE.md  # MUST be empty
```

**POC re-run** (AC-13) is the CRITICAL gate. If `poc-6a-hot-path.mjs` reports `total-overhead > 0.30ms`, the Implementer MUST:
1. NOT skip the test
2. NOT collapse the metrics hook (per AD-009 "ajustar, não collapsar")
3. Optimize: e.g., make `recordAugmentSample` a single direct call (skip `try/catch` when buffer is initialized), inline the counter increment, etc.

If optimization cannot bring it under 0.30ms, escalate to orchestrator + record a DISCOVERIES.md entry.

---

## Verifier handoff

After all gates pass, Implementer writes `validation-phase-7a.md` (or `validation-phase-7a.md` + `validation-phase-7a.{T-NN}.md` if there are sub-batch reports). The Verifier sub-agent audits:

1. **Code review (L-006):** read all 7 new files + 4 modified files, confirm R-NN/AC-NN contracts.
2. **Forgery tests:** independent cache-hit + percentile + ring buffer overflow tests.
3. **POC re-run:** re-run `poc-6a-hot-path.mjs` 3 times, confirm ≤ 0.30ms.
4. **Scope guard:** `git diff <6b-head>..HEAD` against locked layers (must be empty).
5. **R-NN traceability:** every AC-NN from spec.md has a passing test in `test/server/metrics/`.

**Verdict:** PASS / FAIL with ranked gap list. Gaps become fix tasks (capped at 3 fix iterations per `tlc-spec-driven`).

---

**Tasks complete. Ready for Implementer.**