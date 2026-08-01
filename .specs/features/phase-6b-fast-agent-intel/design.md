---
date: 2026-08-01
version: 1
description: "Phase 6b — Fast Agent + Intel Pipeline design. Architecture for in-process MiniMax-M2.7-highspeed integration, SQLite WAL intel store, BuildOptions.intel + suffix injection, cache hit invariant. Reuses Phase 5a/5b primitives; POC-measured budgets (10ms hot path, 3s fast agent) as ceilings. 4 subchapters × 16-18 atomic tasks. 3 Implementer batches."
explanation: |
  Phase 6b is the LARGEST phase yet (12-16h estimate) — a fresh
  in-process module, a new migration, and 2 surgical modifications to
  the existing augmenter + pipeline. This design document is the
  architectural narrative; the spec (spec.md) is the requirement
  contract; the tasks (tasks.md) is the atomic execution plan.

  Four architectural decisions (AD-006) drive the design:
  1. BuildOptions.intel formalization at src/server/augment/augmenter.ts:51-70
  2. Intel store SQLite schema migration 004_intel.sql (WAL + covering index)
  3. Fast agent module location src/server/fast-agent/{client,writer}.ts
  4. Default sync intel write with async batching fallback if measured > 1ms

  Why this design (key choices):

  1. **Intel = post-retrieval injection (NOT query expansion):**
     The match pipeline at /augment runs the existing
     prompt+context+catalog retrieval unchanged (Phase 5a.2 Stage 4-7).
     Intel is appended to Block 2's suffix AFTER retrieval. This
     preserves (a) D-006 byte-string determinism (RRF ties still
     resolved by id.localeCompare — no new tiebreak source); (b)
     src/search/** untouched (CALIBRATION-RESIDUE + Phase 5 scope
     guard); (c) reuses the existing embedding model (no new
     multilingual-e5-small embed call per turn). PRD §16.4
     resolution #3 explicit: "match strategy: embedding pipeline
     existente (FTS5 + sqlite-vec + RRF), não regex novo".

  2. **Fast agent = in-process, NOT daemon:**
     The Anthropic SDK call lives inside the augment server process
     (Node 22 single-process), scheduled via setImmediate after the
     /v1/messages response returns. NO child_process.spawn, NO Unix
     socket, NO sidecar container. The call blocks ONLY the
     setImmediate microtask (not the request response). PRD §16.4 #1
     explicit.

  3. **Block 1 stays untouched (persona anchor = cache hit):**
     The BuildOptions.intel change emits the ## Intel section in
     Block 2 ONLY. Block 1 (persona) is NEVER modified by intel
     changes — the cache hit invariant (R-15) holds across turns when
     the persona is stable. Phase 6a T-09 verified the byte-string
     equality for 2 identical inputs; Phase 6b extends that to
     2 turns with same persona + different prompts.

  4. **WAL mode + covering index for the intel store:**
     PRAGMA journal_mode=WAL is idempotent in SQLite (Phase 5b.1 may
     have already set WAL for audit_events; Phase 6b's migration
     re-applies it safely). Index idx_intel_session_id is a
     covering index on the PK column — the hot-path query "SELECT
     agent_state, next_needs, recent_topic FROM intel WHERE
     session_id = ?" uses index-only scan. Phase 6a POC measured
     0.02ms (250× headroom under the 5ms budget).

  5. **Sync write default, async fallback if measured > 1ms:**
     Phase 6a POC measured write overhead = read overhead = 0.02ms
     (sync is fine). The Implementer runs writer-perf.test.mjs to
     verify p95 ≤ 1ms. If it exceeds the 1ms threshold, the
     Implementer mirrors src/server/audit/buffer.ts (D-007 CRITICAL
     pattern) — in-memory ring buffer + batch flush N=100 OR T=1000ms
     + fail-open. The async fallback is DOCUMENTED, not auto-activated.

  6. **Stub fallback is defensive, not permanent:**
     When MINIMAX_API_KEY is unset (or @anthropic-ai/sdk isn't
     installed), the client falls back to scripts/stub-fast-agent.mjs
     from Phase 6a T-05. The stub returns a deterministic Intel literal
     in < 223ms p95. This is a SAFETY NET for environments without
     API access — not a substitute for the real API. Phase 7b tuning
     re-measures with the real API.

  7. **NEW directory src/server/fast-agent/** follows the
     src/server/augment/ pattern from Phase 5a.2 (separate folder per
     domain module). Sub-modules:
       - intel-schema.ts (Intel type + Zod IntelSchema)
       - client.ts (Anthropic SDK wrapper + stub fallback)
       - writer.ts (sync sqlite write + async fallback if triggered)

  Subchapter breakdown (4 subchapters per SUBCHAPTER_BREAKDOWN trigger):
  - 6b.1 Intel Store Foundation: T-01..T-04 (migration + getIntel +
    helper module + tests)
  - 6b.2 Fast Agent Module: T-05..T-08 (intel-schema + client +
    writer + integration tests)
  - 6b.3 BuildOptions.intel + Suffix Injection: T-09..T-12
    (BuildOptions.intel + buildVariableSuffix ## Intel section +
    byte-string stability + integration tests)
  - 6b.4 Pipeline Integration + Cache Hit Validation: T-13..T-17
    (runAugment calls getIntel + fast-agent-over-response scheduling
    + cache hit verification + latency trick end-to-end smoke)

  Whole Phase 6b = 3 Implementer batches (8 + 4 + 5) + 1 Verifier
  (fresh, evidence-or-zero).

  POC budget respect (non-negotiable per AD-006):
  - sqlite.get(intel) ≤ 5ms p95 → measured 0.02ms (250× headroom)
  - concat ≤ 1ms p95 → measured 0ms (no-op gate)
  - template render ≤ 1ms p95 → measured 0.04ms (typical) + 0.92ms (cold outlier)
  - TOTAL hot path overhead ≤ 10ms p95 → measured 0.07ms (147× headroom)
  - Fast agent ≤ 3s p95 → measured 223ms stub (13× headroom)

  Phase 6b's production wiring MUST honor these as ceilings. The
  Implementer re-runs scripts/poc-6a-hot-path.mjs at end-of-phase
  (AC-12) to confirm the ceilings survive the new code paths.
related:
  - ./spec.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md
  - ../phase-6a-poc-validation/{spec,design,tasks,poc-results}.md
  - ../../../PRD.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../DISCOVERIES.md
  - ../../STATE.md
  - ../../architecture/memory-studio.architecture.json
  - ../../../src/server/{boot,index,augment/{pipeline,augmenter,byte-string,top-k,thresholds,retrieval,response}}.ts
  - ../../../src/catalog/{index,migrations/runner,migrations/001_init,migrations/003_audit_events_ts_index}.ts
  - ../../../src/search/{fts,rrf,vector}.ts
  - ../../../src/server/audit/{buffer,index}.ts
  - ../../../test/augment/{perf,route-e2e,pipeline,augmenter,byte-string-equality}.test.mjs
  - ../../../scripts/{stub-fast-agent,poc-6a-hot-path,smoke-augment-server,smoke-proxy-local-only}.mjs
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../CLAUDE.md
---

# Phase 6b — Fast Agent + Intel Pipeline — Design

**Source spec:** [`./spec.md`](./spec.md)
**Source tasks:** [`./tasks.md`](./tasks.md)
**Branch:** `loop/phase-0`
**Baseline:** commit at end of Phase 6a (`84d70a1` per STATE.md Handoff — 578 tests: 391 root + 152 UI + 16 SDK + 19 POC)
**Output deliverables:**
- `src/server/fast-agent/{intel-schema,client,writer,index}.ts` (NEW directory; 4 files)
- `src/catalog/migrations/004_intel.sql` (NEW; adds `intel` table + WAL pragma + covering index)
- `src/catalog/index.ts` (MODIFY; adds `getIntel` export + Intel type re-export)
- `src/server/augment/augmenter.ts` (MODIFY; adds `intel?: Intel | null` to `BuildOptions` + emits `## Intel` section in `buildVariableSuffix`)
- `src/server/augment/pipeline.ts` (MODIFY; calls `getIntel` before Stage 4 + schedules fast-agent-over-response at end)
- `src/server/boot.ts` (MODIFY; reads `MINIMAX_API_KEY` env var + `.memory-studio/state.json` `fastAgent.model` + constructs fast-agent client)
- `scripts/smoke-latency-trick.mjs` (NEW; AC-13 protocol)
- `scripts/smoke-inception-e2e.mjs` (NEW; AC-23 protocol)
- `test/server/fast-agent/{intel-schema-contract,client,writer-perf,writer-reader-contract,empty-intel,client-mode,model-config}.test.mjs` (NEW)
- `test/augment/{augmenter-intel,intel-injection,pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` (NEW)
- `test/catalog/{intel-store,intel-restart,migrations-004}.test.mjs` (NEW)
- `package.json` (MODIFY if @anthropic-ai/sdk is not present; Phase 5b.4 added it but Phase 6b verifies)

---

## 1. Architecture Overview

```
                        HUMAN (5-30s reading R_N)
                              ↓
                            /  \
                           /    \
              Turn N     /      \   Fast agent (MiniMax-M2.7-highspeed)
        ┌──────────────┐  /        \  ┌─────────────────────┐
        │ Provider     │ /          \ │ Anthropic SDK       │
        │ (Anthropic / │/            \│ @anthropic-ai/sdk   │
        │  MiniMax)    │             ││ baseURL=minimax.io/ │
        └──────┬───────┘              ││ anthropic          │
               │ R_N                  └──────────┬──────────┘
               │                                 │
               ↓                                 ↓
        /v1/messages proxy (Phase 5b.4)    Intel literal { agentState,
               │                            nextNeeds, recentTopic }
               │ (in-process setImmediate)        │
               ↓                                 ↓
        augment server                    writeIntel()
        ├── /augment handler              ├── INSERT OR REPLACE
        ├── runAugment (Stage 1-9)        └── ts = unix_ms
        │                                 │
        │ Stage 5B (NEW): getIntel()      ↓
        │  SELECT ... FROM intel          intel table (SQLite WAL)
        │  WHERE session_id = ?          idx_intel_session_id
        │                                 │
        │ Stage 8 (MODIFIED):             ↓
        │  buildSystemMessage {intel}    Turn N+1 reads intel
        │  → Block 2 = ## Intel + ...    (warm cache; 0.02ms p95)
        │                                 
        └─────────┬──────────────────────┘
                  ↓
          cache hit on Block 1 (persona)
          usage.cache_read_input_tokens > 0
```

**Key insight:** the fast agent and the human read R_N in **parallel**. The fast agent finishes in ~1s (highspeed variant) — well within the 5-30s human reading budget. When the human types Turn N+1, intel is already persisted. Zero latency penalty for the human.

---

## 2. Code Reuse Analysis

### Existing Components to Leverage

| Component | Location | How to Use |
|---|---|---|
| **`canonicalSha256()`** | `src/server/augment/byte-string.ts:82-84` | Reuse for intel byte-string equality tests (Phase 6a T-09 pattern). Phase 6b emits canonical JSON for Intel section in Block 2 |
| **`canonicalJsonStringify()`** | `src/server/augment/byte-string.ts:53-60` | Reuse inside `buildVariableSuffix` for the `## Intel` section. Preserves D-006 byte-string determinism |
| **`buildSystemMessage()`** | `src/server/augment/augmenter.ts:151-172` | EXTEND `BuildOptions` at lines 51-70 to add `intel?: Intel \| null`. EXTEND `buildVariableSuffix` at lines 114-135 to emit `## Intel` section before `## Skills` |
| **`runAugment()`** | `src/server/augment/pipeline.ts:77-164` | MODIFY — add Stage 1b (getIntel before Stage 4 embed) + tail (setImmediate fast-agent schedule if response captured) |
| **`applyMigrations()`** | `src/catalog/migrations/runner.ts` | Reuse — `004_intel.sql` is auto-applied on next `openAndMigrate` call |
| **`AuditRingBuffer`** | `src/server/audit/buffer.ts:59-183` | MIRROR PATTERN — if writer sync p95 > 1ms (per A-6 fallback trigger), copy this exact structure (in-memory ring + batch flush N=100 OR T=1000ms + fail-open) |
| **`@anthropic-ai/sdk`** | `package.json` (Phase 5b.4) | Direct reuse — no new dep. Configure with `baseURL: 'https://api.minimax.io/anthropic'` and `model: 'MiniMax-M2.7-highspeed'` |
| **`stub-fast-agent.mjs`** | `scripts/stub-fast-agent.mjs` (Phase 6a T-05) | Reuse as defensive fallback when MINIMAX_API_KEY unset. Subprocess spawn (mirror Phase 5a.3 `killChild` pattern at `scripts/smoke-augment-server.mjs:203-219`) |
| **`hashTenantId()`** | `src/server/security/tenant-hash.ts` (Phase 5b.1) | Reuse — intel is keyed by `sessionId` (hashed 16-hex form per Phase 3 SDK contract), no need to re-hash |
| **`freshSeededDb()`** pattern | `test/augment/perf.test.mjs:127-191` | Reuse for in-memory test fixtures of the intel store |
| **`.memory-studio/state.json`** | root (Phase 4.1 fixture) | Add `fastAgent.model` field to default fixture; loader reads at boot |

### Integration Points

| System | Integration Method |
|---|---|
| **Existing augment pipeline** | `BuildOptions.intel` flows from `runAugment` → `buildSystemMessage`. Stage 1b reads `getIntel()` BEFORE Stage 4 (embed). Cache hit invariant preserved because Block 1 (persona) is untouched |
| **Catalog SQLite** | `004_intel.sql` migration adds `intel` table + WAL pragma (idempotent re-apply) + covering index `idx_intel_session_id`. Lives in same DB as `audit_events` (Phase 1 + 5b.1) + `catalog`/`embeddings` (Phase 1) |
| **`/v1/messages` proxy (Phase 5b.4)** | The proxy response handler schedules the fast-agent call after returning the upstream response. Same in-process pattern as `/augment`'s first-responder path |
| **Anthropic SDK** | `@anthropic-ai/sdk` already in `package.json`. Configure with `baseURL: 'https://api.minimax.io/anthropic'` and `apiKey: process.env.MINIMAX_API_KEY` |
| **Stub fast-agent (defensive)** | `scripts/stub-fast-agent.mjs` (Phase 6a T-05) is spawned as child process when `MINIMAX_API_KEY` is unset. Mirrors Phase 5a.3's `bootAugmentServer` pattern |

---

## 3. Components

### 3.1 Intel Schema Module

- **Purpose:** Owns the `Intel` literal type (SPEC §IMod-5 shape) + the Zod schema for runtime validation + the writer/reader JSON round-trip helpers
- **Location:** `src/server/fast-agent/intel-schema.ts` (NEW)
- **Interfaces:**
  ```typescript
  export type Intel = {
    readonly agentState: string;
    readonly nextNeeds: string[];
    readonly recentTopic: string;
  };
  export const IntelSchema: z.ZodType<Intel>;
  export function serializeIntel(intel: Intel): string;  // canonical JSON
  export function deserializeIntel(row: { agent_state: string; next_needs: string; recent_topic: string }): Intel;
  export function emptyIntel(): Intel;  // { agentState: '', nextNeeds: [], recentTopic: '' }
  ```
- **Dependencies:** Zod (already in `package.json` from Phase 1)
- **Reuses:** `canonicalJsonStringify()` from `src/server/augment/byte-string.ts:53-60` for `serializeIntel`

### 3.2 Fast Agent Client

- **Purpose:** Wraps the Anthropic SDK for in-process fast-agent calls. Handles `MINIMAX_API_KEY` env var + stub fallback
- **Location:** `src/server/fast-agent/client.ts` (NEW)
- **Interfaces:**
  ```typescript
  export interface FastAgentRequest {
    readonly rN: string;                     // provider response text
    readonly promptContext?: Context | null;  // augment request context (scratch/todos/recentFiles/lastEvent)
    readonly model: string;                  // from .memory-studio/state.json fastAgent.model
  }
  export interface FastAgentResult {
    readonly intel: Intel;
    readonly latencyMs: number;
    readonly mode: 'real' | 'stub';
  }
  export async function callFastAgent(req: FastAgentRequest): Promise<FastAgentResult>;
  ```
- **Dependencies:** `@anthropic-ai/sdk` (Phase 5b.4); `scripts/stub-fast-agent.mjs` (Phase 6a T-05, spawned as child process)
- **Reuses:** Anthropic SDK messages.create pattern from Phase 5b.4 proxy + Phase 6a POC harness

### 3.3 Fast Agent Writer

- **Purpose:** Persists the `Intel` literal to the intel store. Default mode = sync write. Fallback trigger = mirror `AuditRingBuffer` if measured > 1ms (A-6)
- **Location:** `src/server/fast-agent/writer.ts` (NEW)
- **Interfaces:**
  ```typescript
  export interface IntelWriter {
    write(sessionId: string, intel: Intel): Promise<void>;
    /** Test-only — measure sync write latency */
    measureSyncWriteMs(sessionId: string, intel: Intel): Promise<number>;
  }
  export function createSyncIntelWriter(db: Database): IntelWriter;
  export function createAsyncIntelWriter(db: Database): IntelWriter;  // D-007 fallback
  ```
- **Dependencies:** `better-sqlite3` `Database` type from `src/catalog/db/open.ts`
- **Reuses:** Phase 5b.1 `AuditRingBuffer` pattern (lines 59-183) for the async fallback (only if triggered per A-6)

### 3.4 BuildOptions.intel + Suffix Injection

- **Purpose:** Adds `intel?: Intel | null` to `BuildOptions`. Extends `buildVariableSuffix` to emit `## Intel` section in Block 2 before `## Skills`
- **Location:** MODIFY `src/server/augment/augmenter.ts:51-70` (BuildOptions) + lines 114-135 (`buildVariableSuffix`)
- **Interfaces:** (existing `BuildOptions` interface extended)
- **Dependencies:** `Intel` type from `src/server/fast-agent/intel-schema.ts` (NEW)
- **Reuses:** `canonicalJsonStringify()` for the section's value serialization (D-006 determinism)

### 3.5 Pipeline Integration

- **Purpose:** Call `getIntel()` before Stage 4 (embed). Schedule fast-agent-over-response at end of `/augment` first-responder + `/v1/messages` proxy response (via `setImmediate`)
- **Location:** MODIFY `src/server/augment/pipeline.ts:77-164` (`runAugment`) + add tail handler
- **Reuses:** Phase 5b.4 `/v1/messages` proxy response handler at `src/server/routes/messages-proxy.ts`

### 3.6 Intel Store (reuses catalog DB)

- **Purpose:** Persist intel rows with `session_id` PK + WAL + covering index
- **Location:** `src/catalog/migrations/004_intel.sql` (NEW) + `src/catalog/index.ts` (MODIFY, exports `getIntel`)
- **Reuses:** `applyMigrations` runner; catalog DB opener (WAL already set by Phase 5b.1 — idempotent re-apply)

---

## 4. Data Models

### Intel Row (SQLite)

```sql
CREATE TABLE IF NOT EXISTS intel (
  session_id   TEXT PRIMARY KEY,
  agent_state  TEXT NOT NULL DEFAULT '',
  next_needs   TEXT NOT NULL DEFAULT '[]',  -- JSON string
  recent_topic TEXT NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_intel_session_id ON intel(session_id);

PRAGMA journal_mode = WAL;  -- idempotent
```

### Intel Type (TypeScript)

```typescript
interface Intel {
  readonly agentState: string;
  readonly nextNeeds: string[];  // JSON serialized as TEXT in DB
  readonly recentTopic: string;
}
```

**Relationships:**
- `intel.session_id` ↔ no direct FK (session IDs are opaque hashes per Phase 3 SDK contract)
- `intel` lives in the same DB as `audit_events` (Phase 1 + 5b.1) — no cross-DB joins, but WAL mode is shared

### BuildOptions (Augmenter) — extended

```typescript
export interface BuildOptions {
  readonly matched: ReadonlyArray<RankedItem>;
  readonly personaTextOverride?: string;
  readonly context?: Context | null;
  readonly warnings?: ReadonlyArray<string>;
  // NEW in Phase 6b:
  readonly intel?: Intel | null;
}
```

### FastAgentRequest (Fast Agent Client) — new

```typescript
interface FastAgentRequest {
  readonly rN: string;
  readonly promptContext?: Context | null;
  readonly model: string;
}

interface FastAgentResult {
  readonly intel: Intel;
  readonly latencyMs: number;
  readonly mode: 'real' | 'stub';
}
```

---

## 5. Sub-Section: Suffix Injection Order

| Order | Section | Source | Renders when |
|---|---|---|---|
| Block 1 | (persona text) | existing `buildPersonaText` | always (stable prefix) |
| Block 2 §1 | `## Intel` | NEW (Phase 6b) | `intel && (agentState OR nextNeeds.length OR recentTopic)` |
| Block 2 §2 | `## Skills` | existing `buildVariableSuffix:122-124` | `skills.length > 0` |
| Block 2 §3 | `## Rules` | existing `buildVariableSuffix:125-127` | `rules.length > 0` |
| Block 2 §4 | `## Context` | existing `buildVariableSuffix:128-130` | `context !== null && !== undefined` |
| Block 2 §5 | `## Warnings` | existing `buildVariableSuffix:131-133` | `warnings && warnings.length > 0` |

**Why intel FIRST:** Anthropic reads blocks top-down; intel is the most-recent turn signal. Top placement in Block 2 maximizes the cache key stability window when only Skills/Rules shift. **Block 1 is NEVER touched by intel** — preserves the cache hit invariant.

---

## 6. Sub-Section: Async vs Sync Intel Write Decision

**Default:** sync write. Phase 6a POC measured sqlite INSERT overhead = SELECT overhead (0.02ms). Well under the 1ms fallback trigger.

**Fallback trigger (A-6):** `test/server/fast-agent/writer-perf.test.mjs` reports `writer.p95 > 1ms` across 10 amostras with seeded catalog. If triggered:

- Mirror `src/server/audit/buffer.ts:59-183` pattern verbatim:
  - In-memory ring buffer (capacity 10000)
  - `enqueue(sessionId, intel)` push + immediate return (fire-and-forget)
  - `flush()` either count-trigger (N=100 events) or time-trigger (T=1000ms)
  - Fail-open: write error → stderr line, batch dropped, enqueue() never blocks

**NOT auto-activated.** The Implementer logs a finding + the design.md A-6 falls back. A documented optimization, not a regression.

---

## 7. Subchapter Breakdown (SUBCHAPTER_BREAKDOWN TRIGGER)

4 subchapters × 4-5 tasks = **17 atomic tasks** (within the 16-20 target). Whole Phase 6b = **3 Implementer batches (8 + 4 + 5) + 1 Verifier**.

### 7.1 Subchapter 6b.1 — Intel Store Foundation (4 tasks)

**Goal:** the `intel` table exists, migration applies cleanly, `getIntel` helper works, `Intel` type is shared.

**Tasks:**
- T-01: `004_intel.sql` migration with DDL + WAL pragma + covering index
- T-02: `src/catalog/index.ts` exports `getIntel(session_id)` + `Intel` type re-export
- T-03: `src/server/fast-agent/intel-schema.ts` with `Intel` type + Zod schema + serialize/deserialize helpers
- T-04: `test/catalog/{migrations-004,intel-store,intel-restart}.test.mjs` — migration + restart + empty/valid round-trip

**Deliverables:** migration applies; `getIntel` reads; type shared; restart preserves intel.

### 7.2 Subchapter 6b.2 — Fast Agent Module (4 tasks)

**Goal:** in-process Anthropic SDK client with stub fallback + Intel writer + perf measurement.

**Tasks:**
- T-05: `src/server/fast-agent/client.ts` with `callFastAgent()` + stub fallback mode
- T-06: `src/server/fast-agent/writer.ts` with `createSyncIntelWriter()` + per-write p95 latency
- T-07: `src/server/boot.ts` env var wiring — `MINIMAX_API_KEY` + `.memory-studio/state.json` `fastAgent.model` + client construction
- T-08: `test/server/fast-agent/{client,writer-perf,client-mode,model-config}.test.mjs` — real/stub paths + perf + config

**Deliverables:** client works (real + stub); writer perf-measured; env vars read; default model used.

### 7.3 Subchapter 6b.3 — BuildOptions.intel + Suffix Injection (4 tasks)

**Goal:** `intel` flows through `buildSystemMessage` → Block 2 emits `## Intel` section → byte-string stays deterministic.

**Tasks:**
- T-09: `src/server/augment/augmenter.ts` BuildOptions extension + `buildVariableSuffix` ## Intel section
- T-10: `test/augment/{augmenter-intel,intel-injection,empty-intel}.test.mjs` — formalize + byte-string stability
- T-11: `test/server/fast-agent/intel-schema-contract.test.mjs` — D-005 hardening (empty fields, type drift, round-trip)
- T-12: `test/server/fast-agent/writer-reader-contract.test.mjs` — write via writer → read via getIntel → round-trip

**Deliverables:** intel section appears; byte-string stable; D-005 graceful degradation; writer-reader round-trip.

### 7.4 Subchapter 6b.4 — Pipeline Integration + Cache Hit Validation (5 tasks)

**Goal:** `runAugment` calls `getIntel` before embed; `/v1/messages` schedules fast-agent-over-response; cache hit test fires; latency trick smoke runs.

**Tasks:**
- T-13: `src/server/augment/pipeline.ts` Stage 1b `getIntel` + tail `setImmediate` fast-agent schedule
- T-14: `src/server/routes/messages-proxy.ts` schedules fast-agent after upstream response
- T-15: `test/augment/{pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` — Stage 1b + scheduling + cache hit + E2E
- T-16: `scripts/smoke-{latency-trick,inception-e2e}.mjs` — full smoke validates AC-13 + AC-23
- T-17: AD-007 + `validation-phase-6b.md` — re-run POC + scope guard verification

**Deliverables:** full integration; cache hit verified; latency trick validated; AD-007 records the budgets survived.

### 7.5 Batch Packing

| Batch | Subchapters | Tasks | Worker |
|---|---|---|---|
| **Batch 1** | 6b.1 + 6b.2 | T-01..T-08 (8 tasks) | Worker A |
| **Batch 2** | 6b.3 | T-09..T-12 (4 tasks) | Worker B |
| **Batch 3** | 6b.4 | T-13..T-17 (5 tasks) | Worker C |
| **Validation** | (all) | (all 17) | Worker D (Verifier, fresh, evidence-or-zero) |

Three sequential batches. Validation runs once after Batch 3.

---

## 8. Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
|---|---|---|---|
| **`Augmenter` change breaks byte-string determinism** | `src/server/augment/augmenter.ts:114-135` (Phase 6b adds new section) | Block 2 byte-string shifts → cache hit invariant breaks (R-15 fails). Phase 6a T-09's 10/10 success needs to hold for the new section shape | R-08 + AC-8 explicitly test the determinism. Re-run `test/poc/byte-string-equality.test.mjs` (Phase 6a) + new `test/augment/intel-injection.test.mjs` (Phase 6b). Empty intel + same persona + same Skills → same SHA as no-intel baseline (the section is CONDITIONAL + D-006 determinism extends by testing) |
| **`runAugment` modification leaks `setImmediate` callback** | `src/server/augment/pipeline.ts:140-150` (NEW tail handler) | Memory leak in long-lived server (10000s of pending microtasks). Test pollution (callbacks fire after test exits) | `setImmediate` runs in the same event loop tick; Node GC reclaims after the callback's `try/catch` returns. Test cleanup uses `process.removeAllListeners('exit')` + the existing `resetServerMetadataForTests()` hook (Phase 5a.1) |
| **WAL pragma re-applied when already WAL** | `004_intel.sql` (`PRAGMA journal_mode=WAL`) | Idempotent — SQLite returns `wal` either way. No corruption. Phase 5b.1 may have already set WAL for audit_events (re-confirms it for the new table) | SQLite semantic guarantee; covered by `test/catalog/migrations-004.test.mjs` idempotency case |
| **Stub fast-agent child process orphaned on Windows** | `scripts/smoke-latency-trick.mjs` (spawns stub via `client.ts`) | TCP port held by orphan stub; subsequent test runs fail. Same risk Phase 6a T-07 / Phase 5a.3 faced | Use `taskkill /F /T /PID` pattern from Phase 5a.3 `scripts/smoke-augment-server.mjs:203-219`. Wrap all `child_process.spawn` calls in `try/finally` with explicit kill on test teardown |
| **Stub child process spawn overhead inflates fast-agent latency** | `src/server/fast-agent/client.ts` stub fallback | Stub mode measures 223ms p95 (Phase 6a). Phase 6b's `callFastAgent` adds spawn overhead (~50-100ms on Windows). Could push measured latency above the 3s budget for the first call (warmup) | Phase 6b's stub latency budget is < 500ms (within highspeed < 1s range, per A-10). 5-warmup pattern eliminates the first-call spawn overhead from p95. Documented in `test/server/fast-agent/client.test.mjs` |
| **Fast agent model string drift** | `src/server/fast-agent/client.ts` `.memory-studio/state.json` `fastAgent.model` | If user sets a non-existent model string, Anthropic SDK throws. Could block fast-agent-over-response (fire-and-forget by default = OK, but the request might log a noisy error) | Fire-and-forget + try/catch; errors → stderr (NOT audit; NOT block). Verified by `test/server/fast-agent/model-config.test.mjs` invalid-model case (A-9 says fallback to default, NOT crash) |
| **`@anthropic-ai/sdk` install gap between environments** | `package.json` deps | Phase 5b.4 added `@anthropic-ai/sdk` but Phase 6a Verifier noted it MAY not be installed (`poc-results.md` §2). Phase 6b MUST verify + re-install if missing | T-07 (boot.ts wiring) checks for SDK presence + logs warning; T-08 test counts on `node_modules/@anthropic-ai/sdk` existence. If install fails, the test FAILS explicitly — the human intervenes |
| **Async fallback trigger (A-6) — Implementer MUST measure, not just declare** | `src/server/fast-agent/writer.ts` | If Implementer declares "perf is fine" without measuring, Phase 6b ships sync even when async would be safer | `test/server/fast-agent/writer-perf.test.mjs` is MANDATORY. Result is recorded in `validation-phase-6b.md`. If `p95 > 1ms`, the fallback is implemented BEFORE Phase 6b closes |
| **Real Anthropic cache hit cannot be verified in this environment** | `/v1/messages` proxy stub (Phase 5b.4) | CLAUDE.md context: no direct Anthropic access. The stub provider simulates `usage.cache_read_input_tokens: 42` when system message SHA matches previous turn (AC-11) | Stub proves the FLOW. Real cache hit is Phase 7b's measurement. Phase 6b validation explicitly records "stub verified, real deferred to Phase 7b" |
| **DOC + validation drift** | `.specs/features/phase-6b-fast-agent-intel/{spec,design,tasks}.md` vs Implementer's actual work | Design may propose split that Implementer finds impractical. Drift risk | Phase 5a/b precedent: Verifier sub-agent validates against spec.md R-NN + AC-NN. Drift = finding → fix task |

---

## 9. Tech Decisions (only non-obvious ones)

| Decision | Choice | Rationale |
|---|---|---|
| Intel store location | **Same catalog DB**, new table via migration | Co-location (faster — no cross-file open). Phase 6a R-01 measured 0.02ms for in-DB read; cross-file would be ~5-10ms |
| Match script semantics | **Post-retrieval injection** (NOT query expansion) | D-006 preserved (RRF ties unaffected). `src/search/**` untouched (CALIBRATION-RESIDUE). PRD §16.4 #3 explicit |
| Suffix injection order | **`## Intel` FIRST in Block 2** | Top placement maximizes cache-key stability. Phase 6a design.md §4.1 |
| Async vs sync write default | **Sync**, with measured-trigger fallback | Phase 6a POC measured 0.02ms write overhead — well under budget. D-007 async pattern as documented fallback only |
| BuildOptions.intel placement | **Single new field** at line ~52 of `augmenter.ts` | AD-006 #1 explicit. Minimal change. Empty/null/undefined treated identically (intel section omitted) |
| Fast agent module location | **NEW directory `src/server/fast-agent/`** (3 files) | AD-006 #3 explicit. Mirrors Phase 5a's `src/server/augment/` pattern |
| Stub fallback pattern | **subprocess spawn** of `scripts/stub-fast-agent.mjs` | Phase 6a T-05 already ships the Anthropic-compatible stub. Reuse. Spawn overhead ~50-100ms on Windows (within the 500ms budget per A-10) |
| Fast agent call site | **`setImmediate` from `/v1/messages` proxy + `/augment` first-responder** | PRD §16.4 #1. Fire-and-forget. The `/v1/messages` response is unaffected by fast-agent latency |
| Cache hit verification | **Local stub provider** that reports `usage.cache_read_input_tokens: 42` on 2nd call when system message SHA matches | Real Anthropic cache hit requires real API access + TTL window. Stub proves the FLOW. Phase 7b tunes the REAL cache behavior |

> **Project-level decisions:** None of these decisions sets a new project-wide convention. The architectural references (suffix order, store location, async fallback trigger) are Phase 6b LOCAL — documented in `tasks.md` for the Implementer and reused only in this phase. Future phases MAY extend them via explicit AD-NNN entries; Phase 6b does not preempt future work.

---

## 10. Sub-Section: Latency Trick Validation Protocol

Goal: prove the fast agent finishes BEFORE the human does, so Turn N+1's augment runs with a populated intel store without the human noticing.

### Protocol (`scripts/smoke-latency-trick.mjs`)

```
1. Boot augment server on free port (with stub fast-agent, no API key)
2. Send 1 `/v1/messages` request with a fix Turn-N prompt + context
3. Measure:
   - t_response_start = performance.now() at response start
   - t_response_end   = performance.now() at response end
   - t_intel_written  = performance.now() when SELECT FROM intel WHERE session_id = ? returns the persisted row
4. Schedule a parallel "human read" simulated with:
   await new Promise(r => setTimeout(r, 5000))  // 5s minimum human budget
5. Assert:
   - (t_intel_written - t_response_start) < 5000   // fast agent ≤ 5s
   - (t_intel_written - t_response_start) < 3000   // strict budget (Phase 6a R-12)
   - (t_response_end - t_response_start) < 50      // /v1/messages p50 unaffected
6. Output:
   [latency-trick] PASS|FAIL intel-write=<ms> response=<ms> budget-intel<3000ms budget-response<50ms
```

### Cache Hit Test (`scripts/smoke-inception-e2e.mjs`)

```
1. Same boot
2. Send Turn 1 with persona-senior-engineer + prompt "what's JWT?"
3. Wait up to 3s for intel write (poll SELECT FROM intel WHERE session_id = ? every 100ms)
4. Send Turn 2 with same persona + different prompt "is JWT stateless?"
5. Stub provider reports usage.cache_read_input_tokens: 42 when 2nd call's system message SHA matches the 1st
6. Assert response.usage.cache_read_input_tokens === 42
7. Output: [inception-e2e] PASS|FAIL cache-hit=42 budget-intel<3000ms
```

---

## 11. Sub-Section: Hot Path Overhead Re-Verification (AC-12)

**Why:** Phase 6a POC measured the budgets in isolation. Phase 6b's production wiring MUST re-verify the budgets survive the new code path.

**How:** at the end of Phase 6b (T-17), the Implementer re-runs `scripts/poc-6a-hot-path.mjs`. Expected output:
```
[hot-path] PASS median=<ms> p95=<ms> total-overhead=<ms> [sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]
```
with `total-overhead < 10ms` and per-component within the per-component budgets (sqlite.get ≤ 5ms, concat ≤ 1ms, template ≤ 1ms).

**If ANY budget is exceeded:**
- The Implementer reports a finding in `validation-phase-6b.md`
- The human decides to optimize (per PRD §16.7 rule "ajustar, não collapsar")
- Phase 6b does NOT close until the budget is honored

---

## 12. Out of Design Scope

- `src/search/**` modifications — REUSE-ONLY per CALIBRATION-RESIDUE.md
- New endpoint surface — Phase 5b closed the 7 endpoints
- Anthropic Adapter (OpenAI↔Anthropic) — v3.1+ per PRD §11
- Multi-tenant — v4+
- Long-term memory — v4+
- Discovery signals + curator LLM — v3.2+
- Semantic cache 2-tier — v3.1+ per PRD §17.1
- Per-turn feedback vote persistent — v3.1+
- Attention tiers / relevance-decay — v3.1+
- Hook + MCP integration modes — v3.1+
- Real Anthropic cache hit validation — Phase 7b
- Async batching fallback (unless measured > 1ms) — DOCUMENTED, not auto-activated
- Handoff middleware-managed — FORA per PRD §2

---

## 13. Cross-References

- [Spec](./spec.md) — full requirement contract
- [Tasks](./tasks.md) — atomic execution plan
- [.specs/ROADMAP.md](../../ROADMAP.md) lines 805-850 — Phase 6b canonical scope
- [.specs/DISCOVERIES.md](../../DISCOVERIES.md) — AD-006 4 architectural decisions
- [.specs/features/phase-6a-poc-validation/{spec,design,tasks,poc-results}.md](../phase-6a-poc-validation/) — POC artifacts + ceiling derivations
- [PRD.md §16, §16.4, §16.5](../../../PRD.md) — inception híbrida + engineering decisions + intel schema
- [.scratch/memory-studio/spec.md §IMod-5](../../../.scratch/memory-studio/spec.md) — `Intel` shape (D-005)
- [Phase 5a design](../phase-5a-api-retrieval/design.md) — pipeline + augmenter patterns
- [Phase 5b design](../phase-5b-aux-endpoints/design.md) — audit buffer (D-007) + endpoint surface
- [src/server/audit/buffer.ts](../../../src/server/audit/buffer.ts) — D-007 async batching pattern (A-6 fallback reference)
- [scripts/stub-fast-agent.mjs](../../../scripts/stub-fast-agent.mjs) — Phase 6a stub fallback
- [CLAUDE.md](../../../CLAUDE.md) `## Testing contract` — gates, scope guard, atomic commit discipline
