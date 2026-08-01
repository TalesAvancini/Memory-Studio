---
date: 2026-08-01
version: 1
description: "Phase 6b atomic tasks. 17 tasks across 4 subchapters (6b.1 intel store foundation, 6b.2 fast agent module, 6b.3 BuildOptions.intel + suffix injection, 6b.4 pipeline integration + cache hit validation). Each task is one component/file with verification criteria, atomic commit, and traceable R-NN/AC-NN. Largest phase yet (12-16h estimate). 3 Implementer batches (8 + 4 + 5) + 1 Verifier."
explanation: |
  Phase 6b packs into 4 subchapters per SUBCHAPTER_BREAKDOWN trigger
  (the largest phase yet; ~17 atomic tasks):

    - 6b.1 Intel Store Foundation: T-01 (migration 004_intel.sql),
      T-02 (getIntel export from catalog/index.ts), T-03 (intel-schema
      module + Zod), T-04 (test/catalog tests: migrations-004 +
      intel-store + intel-restart)
    - 6b.2 Fast Agent Module: T-05 (client.ts: real + stub),
      T-06 (writer.ts: sync), T-07 (boot.ts env var + .memory-studio
      state.json wiring), T-08 (test/server/fast-agent tests: client +
      writer-perf + client-mode + model-config)
    - 6b.3 BuildOptions.intel + Suffix Injection: T-09 (BuildOptions
      + buildVariableSuffix ## Intel section), T-10 (test/augment
      tests: augmenter-intel + intel-injection + empty-intel),
      T-11 (test/server/fast-agent/intel-schema-contract),
      T-12 (test/server/fast-agent/writer-reader-contract)
    - 6b.4 Pipeline Integration + Cache Hit Validation: T-13 (runAugment
      Stage 1b + tail setImmediate), T-14 (messages-proxy.ts schedules
      fast-agent), T-15 (test/augment tests: pipeline-intel +
      fast-agent-scheduling + inception-cache-hit + inception-e2e),
      T-16 (scripts/smoke-latency-trick + smoke-inception-e2e),
      T-17 (AD-007 + validation-phase-6b.md + re-run POC)

  Subchapter boundaries are at genuine dependency seams:
    - 6b.1: intel store foundation (no augment/fast-agent deps)
    - 6b.2: fast agent module (depends on 6b.1 for getIntel + intel-schema)
    - 6b.3: BuildOptions.intel (depends on 6b.1 Intel type + 6b.2 client)
    - 6b.4: pipeline + cache hit (depends on all previous)

  Three Implementer batches fit naturally:
    - Batch 1: subchapters 6b.1 + 6b.2 (T-01..T-08 = 8 tasks)
    - Batch 2: subchapter 6b.3 (T-09..T-12 = 4 tasks)
    - Batch 3: subchapter 6b.4 (T-13..T-17 = 5 tasks)

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md

  POC budget respect (NON-NEGOTIABLE per AD-006):
  - sqlite.get(intel) ≤ 5ms p95 (Phase 6a measured 0.02ms)
  - concat ≤ 1ms p95 (Phase 6a measured 0ms)
  - template render ≤ 1ms p95 (Phase 6a measured 0.04ms)
  - TOTAL hot path overhead ≤ 10ms p95 (Phase 6a measured 0.07ms)
  - Fast agent ≤ 3s p95 (Phase 6a measured 223ms stub)

  Every task that modifies the hot path (BuildOptions.intel,
  runAugment) must honor these ceilings. T-17 RE-RUNS
  scripts/poc-6a-hot-path.mjs at end-of-phase to confirm.
related:
  - ./spec.md
  - ./design.md
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

# Phase 6b — Fast Agent + Intel Pipeline — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `84d70a1` (Phase 6a closure — 578 tests: 391 root + 152 UI + 16 SDK + 19 POC)
**Output deliverables:**
- `src/server/fast-agent/{intel-schema,client,writer,index}.ts` (NEW dir, 4 files)
- `src/catalog/migrations/004_intel.sql` (NEW)
- `src/catalog/index.ts` (MODIFY: add `getIntel` export + Intel type re-export)
- `src/server/augment/augmenter.ts` (MODIFY: BuildOptions.intel + `## Intel` section in `buildVariableSuffix`)
- `src/server/augment/pipeline.ts` (MODIFY: Stage 1b `getIntel` + tail `setImmediate` fast-agent schedule)
- `src/server/boot.ts` (MODIFY: `MINIMAX_API_KEY` env var + `.memory-studio/state.json` `fastAgent.model` + client construction)
- `src/server/routes/messages-proxy.ts` (MODIFY: schedule fast-agent after upstream response)
- `scripts/smoke-latency-trick.mjs` (NEW; AC-13)
- `scripts/smoke-inception-e2e.mjs` (NEW; AC-23)
- `test/server/fast-agent/{intel-schema-contract,client,writer-perf,writer-reader-contract,empty-intel,client-mode,model-config}.test.mjs` (NEW)
- `test/augment/{augmenter-intel,intel-injection,pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` (NEW)
- `test/catalog/{intel-store,intel-restart,migrations-004}.test.mjs` (NEW)
- `.specs/DISCOVERIES.md` (append AD-007 + AD-008 entries — T-17)
- `.specs/features/phase-6b-fast-agent-intel/validation-phase-6b.md` (NEW; T-17)
- `package.json` (MODIFY only if `@anthropic-ai/sdk` not yet installed; Phase 5b.4 added it but Phase 6a Verifier flagged the MAY-not-be-present gap)

---

## Test Coverage Matrix

> Generated from spec acceptance criteria + design test strategy + CLAUDE.md testing contract + Phase 5a/5b/6a patterns.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Migration** (`004_intel.sql`) | unit | DDL applies to `:memory:` SQLite; `intel` table + `idx_intel_session_id` exist; `PRAGMA journal_mode=WAL` returns `wal`; idempotent on re-run | `test/catalog/migrations-004.test.mjs` (3-4 cases) | `npm test -- test/catalog/migrations-004.test.mjs` |
| **`getIntel` helper** (`catalog/index.ts`) | unit | Reads round-tripped intel from seeded `:memory:` DB; returns `null` for unknown `session_id`; graceful on empty Intel fields (D-005) | `test/catalog/intel-store.test.mjs` (4+ cases) | `npm test -- test/catalog/intel-store.test.mjs` |
| **Restart preserves intel** (WAL mode) | unit | Write intel → close DB → reopen → read identical literal | `test/catalog/intel-restart.test.mjs` (3+ cases) | `npm test -- test/catalog/intel-restart.test.mjs` |
| **`Intel` schema** (`fast-agent/intel-schema.ts`) | unit | SPEC §IMod-5 literal shape; Zod validates; graceful on empty fields; type drift fails parse; JSON round-trip preserves shape | `test/server/fast-agent/intel-schema-contract.test.mjs` (6+ cases, mirrors Phase 6a T-10) | `npm test -- test/server/fast-agent/intel-schema-contract.test.mjs` |
| **Fast agent client** (`fast-agent/client.ts`) | unit + integration | Real API when `MINIMAX_API_KEY` set; stub fallback when unset; respects `.memory-studio/state.json` `fastAgent.model`; returns `Intel` literal | `test/server/fast-agent/{client,client-mode,model-config}.test.mjs` (10+ cases total) | `npm test -- test/server/fast-agent/` |
| **Fast agent writer** (`fast-agent/writer.ts`) | unit + perf | Sync write p95 ≤ 1ms across 10 amostras + 5 warmup; D-007 async fallback if measured > 1ms | `test/server/fast-agent/writer-perf.test.mjs` (3-5 cases) | `npm test -- test/server/fast-agent/writer-perf.test.mjs` |
| **Writer-reader contract** | integration | `writeIntel()` → `getIntel()` round-trip preserves shape; D-005 empty fields round-trip unchanged; type drift fails write loudly | `test/server/fast-agent/writer-reader-contract.test.mjs` (5+ cases) | `npm test -- test/server/fast-agent/writer-reader-contract.test.mjs` |
| **Empty intel D-005** | unit | Empty `Intel` literal = same byte-string as no-intel baseline (intel section omitted); no empty `## Intel` header appears | `test/server/fast-agent/empty-intel.test.mjs` (3+ cases) | `npm test -- test/server/fast-agent/empty-intel.test.mjs` |
| **`BuildOptions.intel`** + suffix injection (`augmenter.ts`) | unit | Empty/null/undefined intel → `## Intel` section omitted; valid intel → section appears FIRST in Block 2; canonical JSON serialization preserves D-006 determinism | `test/augment/augmenter-intel.test.mjs` (6+ cases) | `npm test -- test/augment/augmenter-intel.test.mjs` |
| **Byte-string determinism with intel** | unit | Same (persona + intel + Skills) → same SHA; different intel → different SHA; empty intel + same persona + same Skills → same SHA as no-intel baseline | `test/augment/intel-injection.test.mjs` (5+ cases, mirrors Phase 6a T-09) | `npm test -- test/augment/intel-injection.test.mjs` |
| **Pipeline integration** (`runAugment` Stage 1b) | integration | `runAugment()` calls `getIntel()` before Stage 4 (embed); passes `BuildOptions.intel` to `buildSystemMessage`; null when no intel row exists | `test/augment/pipeline-intel.test.mjs` (3+ cases; in-process Fastify `inject`) | `npm test -- test/augment/pipeline-intel.test.mjs` |
| **Fast-agent scheduling** | integration | After `/v1/messages` proxy response returns, intel is persisted to the store within 5s (setImmediate fires async) | `test/augment/fast-agent-scheduling.test.mjs` (3+ cases) | `npm test -- test/augment/fast-agent-scheduling.test.mjs` |
| **Cache hit verification** | integration | 2 turns with same persona + different prompts → `usage.cache_read_input_tokens > 0` on 2nd (via local stub provider that returns the metric when SHA matches) | `test/augment/inception-cache-hit.test.mjs` (3+ cases) | `npm test -- test/augment/inception-cache-hit.test.mjs` |
| **E2E inception e2e** | e2e | Boosts augment server on free port; sends 2 consecutive `/v1/messages`; waits for intel write; asserts cache hit + intel persisted | `test/augment/inception-e2e.test.mjs` (3+ cases; in-process) + `scripts/smoke-inception-e2e.mjs` | `npm test -- test/augment/inception-e2e.test.mjs && node scripts/smoke-inception-e2e.mjs` |
| **Latency trick** | e2e | Fast agent wall-clock < 3s (parallel with simulated 5s human read); `/v1/messages` response p50 unaffected (~5-10ms) | `scripts/smoke-latency-trick.mjs` (runs as smoke, not unit) | `node scripts/smoke-latency-trick.mjs` |
| **TypeScript contract** | type gate only | All TS files strict + `noUncheckedIndexedAccess`; ESM exports; no `any` leaks; `Intel` type re-exported from both `intel-schema.ts` (owner) + `augmenter.ts` (BuildOptions convenience) | All new files | `npm run typecheck` |
| **Workspace wiring** | operational | `npm ls @anthropic-ai/sdk` returns single version; if missing, `npm install @anthropic-ai/sdk` installs cleanly | (npm) | `npm ls @anthropic-ai/sdk` |
| **Scope guard** | scope check | `git diff 84d70a1..HEAD -- src/search/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty. New code in `src/server/fast-agent/**` + `src/server/augment/{augmenter,pipeline}.ts` (modify) + `src/catalog/{index,migrations/004_intel.sql}` (modify + new) + `scripts/smoke-{latency-trick,inception-e2e}.mjs` (new) | (git) | manual |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM) + Phase 5a/5b test patterns (`test/augment/**`, `test/server/**`, `scripts/smoke-*.mjs`) + Phase 6a POC test patterns (`test/poc/**.test.mjs`).

---

## Gate Check Commands

> Generated from `package.json` + `CLAUDE.md` testing contract + Phase 6a POC pattern.

| Gate Level | When to Use | Command |
|---|---|---|
| **Quick** | After unit-test-only tasks (T-02, T-03, T-11, T-12) | `npm test -- test/catalog/ test/server/fast-agent/` |
| **Full** | After integration/e2e tasks (T-04, T-10, T-13, T-15) | `npm test` (must remain ≥578 tests) |
| **Typecheck** | After any TS change | `npm run typecheck` |
| **Writer perf** | After T-06 | `node --test test/server/fast-agent/writer-perf.test.mjs` |
| **POC re-run (AC-12)** | After T-17 (end of phase) | `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` (must report `total-overhead < 10ms`) |
| **Latency trick smoke** | After T-16 | `node scripts/smoke-latency-trick.mjs` |
| **Inception E2E smoke** | After T-16 | `node scripts/smoke-inception-e2e.mjs` |
| **Build** | After phase completion (T-17) | `npm test && npm run typecheck && node scripts/poc-6a-hot-path.mjs && node scripts/smoke-latency-trick.mjs && node scripts/smoke-inception-e2e.mjs && npm test -- test/poc/` (≥578 + Phase 6b new) |
| **Scope guard** | After T-17 (end of phase) | `git diff 84d70a1..HEAD -- src/search/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty |

**Note:** POC scripts from Phase 6a (`scripts/poc-6a-*.mjs`) and their test files (`test/poc/**.test.mjs`) are PRESERVED — Phase 6b does NOT modify them. The Phase 6a Verifier baseline (578 tests) is the regression floor.

---

## Execution Plan

Four subchapters run sequentially. Each subchapter is ≤ 5 tasks. Whole Phase 6b = 3 Implementer batches.

```
Subchapter 6b.1 (Intel Store Foundation):     T-01 → T-02 → T-03 → T-04
                                                  ↓
Subchapter 6b.2 (Fast Agent Module):                  T-05 → T-06 → T-07 → T-08
                                                                       ↓
Subchapter 6b.3 (BuildOptions + Suffix):                     T-09 → T-10 → T-11 → T-12
                                                                              ↓
Subchapter 6b.4 (Pipeline + Cache Hit):                            T-13 → T-14 → T-15 → T-16 → T-17
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 6b.1 + 6b.2 | T-01..T-08 (8 tasks) | Worker A |
| **Batch 2** | 6b.3 | T-09..T-12 (4 tasks) | Worker B |
| **Batch 3** | 6b.4 | T-13..T-17 (5 tasks) | Worker C |
| **Validation** | (all) | (all 17) | Worker D (Verifier — fresh, evidence-or-zero) |

Three sequential batches. Validation runs once after Batch 3 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 6b.1 — Intel Store Foundation

#### T-01: `004_intel.sql` migration (intel table + WAL pragma + covering index)

**File:** `src/catalog/migrations/004_intel.sql` (NEW, ~30 lines)

**Implements:**
- `CREATE TABLE IF NOT EXISTS intel (session_id TEXT PRIMARY KEY, agent_state TEXT NOT NULL DEFAULT '', next_needs TEXT NOT NULL DEFAULT '[]', recent_topic TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL) WITHOUT ROWID;`
- `CREATE INDEX IF NOT EXISTS idx_intel_session_id ON intel(session_id);`
- `PRAGMA journal_mode = WAL;` — idempotent in SQLite (returns current mode on re-apply)
- Migration header comment explains: "Phase 6b inception híbrida Intel store; WAL mode + covering index for hot-path `WHERE session_id = ?` (Phase 6a R-01 measured 0.02ms); matches SPEC §IMod-5 schema shape + D-005 graceful degradation defaults"

**Depends on:** none (first task; matches Phase 1.2 migration pattern)

**Verification:**
- `node --test test/catalog/migrations-004.test.mjs --grep "apply"` — migration applies to `:memory:` DB (to be written in T-04)
- Migration applied twice → no error (idempotency)
- `PRAGMA journal_mode` query returns `wal` after apply
- `npm run typecheck` exits 0

**Commit:** `feat(catalog): intel table + WAL pragma + covering index migration 004 (phase 6b T-01)`

**Trace:** R-04, AC-1

---

#### T-02: `src/catalog/index.ts` exports `getIntel()` + Intel type re-export

**File:** `src/catalog/index.ts` (MODIFY: add ~30 lines for the new export; preserve existing barrel structure)

**Implements:**
- New `src/catalog/intel-store.ts` (NEW, ~50 lines) module that owns the `getIntel(session_id: string): Intel | null` helper + the reverse `writeIntelRow` (used by `writer.ts` in T-06). Module exports:
  ```typescript
  import type Database from 'better-sqlite3';
  import type { Intel } from '../server/fast-agent/intel-schema.ts';

  export function getIntel(db: Database, sessionId: string): Intel | null;
  export function writeIntelRow(db: Database, sessionId: string, intel: Intel, ts: number): void;
  ```
- Implementation:
  - `getIntel`: `const row = db.prepare("SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?").get(sessionId)`; if `null` → return `null`; else `return { agentState: row.agent_state, nextNeeds: JSON.parse(row.next_needs), recentTopic: row.recent_topic }`; catch `JSON.parse` errors → return `null` (graceful degradation)
  - `writeIntelRow`: `INSERT OR REPLACE INTO intel(session_id, agent_state, next_needs, recent_topic, ts) VALUES (?, ?, ?, ?, ?)`
- Add to `src/catalog/index.ts` barrel:
  ```typescript
  export { getIntel, writeIntelRow } from './intel-store.ts';
  export type { Intel } from '../server/fast-agent/intel-schema.ts';
  ```
  (Note: cross-directory import is a known barrel anti-pattern. Phase 6b tolerates this because the import depth is 1 (`src/server/fast-agent/intel-schema.ts` is the canonical location for `Intel`); the catalog barrel re-exports for consumer convenience)

**Depends on:** T-01 (intel table exists)

**Verification:**
- `npm test -- test/catalog/intel-store.test.mjs` — 4+ cases (round-trip, null for unknown, JSON parse error graceful)
- `npm run typecheck` exits 0
- `npm test` baseline preserved (≥578 tests)

**Commit:** `feat(catalog): getIntel helper + Intel type re-export from barrel (phase 6b T-02)`

**Trace:** R-05, AC-2

---

#### T-03: `src/server/fast-agent/intel-schema.ts` (Intel type + Zod schema + serialize/deserialize)

**File:** `src/server/fast-agent/intel-schema.ts` (NEW, ~80 lines)

**Implements:**
- `Intel` type (SPEC §IMod-5 shape literal):
  ```typescript
  export type Intel = {
    readonly agentState: string;
    readonly nextNeeds: readonly string[];
    readonly recentTopic: string;
  };
  ```
- `IntelSchema` Zod schema (the SOLE runtime shape validator):
  ```typescript
  import { z } from 'zod';
  export const IntelSchema = z.object({
    agentState: z.string(),
    nextNeeds: z.array(z.string()),
    recentTopic: z.string(),
  });
  ```
- `serializeIntel(intel: Intel): string` — uses `canonicalJsonStringify()` from `src/server/augment/byte-string.ts:53-60` (preserves D-006 determinism + NFC normalization on string leaves)
- `deserializeIntel(row: { agent_state: string; next_needs: string; recent_topic: string }): Intel | null` — parses `row.next_needs` from JSON; `IntelSchema.safeParse()` the result; returns `null` on parse failure (graceful degradation)
- `emptyIntel(): Intel` returns `{ agentState: '', nextNeeds: [], recentTopic: '' }` (D-005 graceful degradation sentinel)
- `BARREL_EXPORTS` — re-export the `Intel` type from `src/server/augment/augmenter.ts` via a TypeScript-only triple-slash reference at the top of `buildVariableSuffix` (Phase 6b T-09 will use this)

**Depends on:** none (Phase 6a T-10 already verified schema validation patterns — copy the test design)

**Verification:**
- `npm test -- test/server/fast-agent/intel-schema-contract.test.mjs` — 6+ cases (Phase 6a T-10 expanded):
  - Valid literal parses OK
  - Empty fields parse OK (D-005)
  - Missing `nextNeeds` fails parse
  - Wrong type fails parse
  - `JSON.stringify → JSON.parse` round-trip preserves shape
  - Stub fast-agent output (`scripts/stub-fast-agent.mjs` literal) parses OK
- `npm run typecheck` exits 0

**Commit:** `feat(fast-agent): Intel type + Zod schema + serialize/deserialize helpers (phase 6b T-03)`

**Trace:** R-03, AC-3

---

#### T-04: `test/catalog/{migrations-004,intel-store,intel-restart}.test.mjs`

**Files:**
- `test/catalog/migrations-004.test.mjs` (NEW, ~80 lines)
- `test/catalog/intel-store.test.mjs` (NEW, ~60 lines)
- `test/catalog/intel-restart.test.mjs` (NEW, ~50 lines)

**Implements:**

**`migrations-004.test.mjs`:**
- `applyMigrations` runner from `src/catalog/migrations/runner.ts` (Phase 1.2)
- 4 cases:
  - Migration applies cleanly to fresh `:memory:` DB → `intel` table exists with 5 columns
  - `idx_intel_session_id` exists after apply (B-tree index on session_id)
  - `PRAGMA journal_mode` returns `wal` after apply
  - Migration applied twice → no error (idempotency)

**`intel-store.test.mjs`:**
- Use `:memory:` DB + apply `004_intel.sql` via the runner
- 4 cases:
  - Round-trip: write Intel → read via `getIntel` → unchanged
  - Unknown `session_id` → `getIntel` returns `null` (NOT throws)
  - Empty Intel `{ agentState: '', nextNeeds: [], recentTopic: '' }` round-trips unchanged (D-005)
  - Corrupted `next_needs` JSON (e.g., `'not-valid-json'`) → `getIntel` returns `null` gracefully (NOT throws)

**`intel-restart.test.mjs`:**
- Open `:memory:` DB → apply migration → write Intel → close DB → reopen DB (mirror process restart) → read Intel → unchanged
- 3 cases:
  - Restart preserves written Intel
  - Restart preserves empty Intel (D-005)
  - Restart preserves Intel with non-ASCII UTF-8 characters (NFC normalization)

**Depends on:** T-01, T-02, T-03

**Verification:**
- `npm test -- test/catalog/` — 11 cases total (4 + 4 + 3), all pass
- `npm test` reports ≥578 + 11 = ≥589 tests
- `npm run typecheck` exits 0

**Commit:** `test(catalog): migrations-004 + intel-store + intel-restart (phase 6b T-04)`

**Trace:** R-04, R-05, R-18, R-21, AC-1, AC-2, AC-14

---

### Subchapter 6b.2 — Fast Agent Module

#### T-05: `src/server/fast-agent/client.ts` (real Anthropic SDK + stub fallback)

**File:** `src/server/fast-agent/client.ts` (NEW, ~120 lines)

**Implements:**
- `FastAgentRequest` + `FastAgentResult` interfaces per design §3.2
- `callFastAgent(req: FastAgentRequest): Promise<FastAgentResult>`:
  1. Check `process.env.MINIMAX_API_KEY`
     - If SET: real mode → instantiate `Anthropic` SDK client with `apiKey: MINIMAX_API_KEY`, `baseURL: 'https://api.minimax.io/anthropic'` (verified Phase 5b.4)
     - If UNSET: stub mode → spawn `scripts/stub-fast-agent.mjs` as child process (mirror Phase 5a.3 `bootAugmentServer` at `scripts/smoke-augment-server.mjs:170-201`)
  2. Call SDK: `await client.messages.create({ model: req.model, max_tokens: 256, system: '<extraction prompt>', messages: [{ role: 'user', content: req.rN }] })`
  3. Extract assistant text → `JSON.parse(...)` → `IntelSchema.safeParse(...)` → `Intel` literal (graceful on parse failure → `emptyIntel()`)
  4. Record `latencyMs` from `performance.now()` delta
  5. Log: `[fast-agent] MODE=real|stub endpoint=<url> model=<model> latency=<ms>`
  6. Returns `{ intel, latencyMs, mode }`
- System prompt template: "You are an intel-extraction agent. Read the user's response and emit a JSON literal matching { agentState: string, nextNeeds: string[], recentTopic: string }. Empty values are valid (string '', empty array). Output JSON only."
- **Error handling:** try/catch wraps the SDK call. On error: log to stderr, return `{ intel: emptyIntel(), latencyMs, mode }`. The request that triggered the call is NEVER blocked (R-16 + R-20 fire-and-forget)
- **Test seam:** exports `resolveMode(apiKey): 'real' | 'stub'` (synchronous helper) so tests can pin the mode without env manipulation
- **Stub cleanup:** track child process handle; on test teardown, call `taskkill /F /T /PID <pid>` (Windows) or `process.kill(pid, 'SIGTERM')` (POSIX). Mirror Phase 5a.3 `killChild` at `scripts/smoke-augment-server.mjs:203-219`

**Depends on:** T-03 (`Intel` type + Zod schema available)

**Verification:**
- `npm test -- test/server/fast-agent/client.test.mjs` — 6+ cases (mirrors Phase 6a T-06):
  - Stub mode: spawn stub child → POST `/v1/messages` → receive deterministic Intel literal → child cleanup
  - Stub mode: stub respects `SIMULATED_LATENCY_MS` env var (default 200ms)
  - Real mode (gated by env): if `MINIMAX_API_KEY` is set, real SDK call works (rate-limited to 1 call per test run)
  - Real mode error: SDK throws → `emptyIntel()` returned (graceful)
  - Stub mode error: stub returns malformed JSON → `IntelSchema.safeParse` returns `null` → `emptyIntel()` returned (graceful)
  - Latency: stub latency ≤ 500ms p95 (within highspeed range)
- `npm test -- test/server/fast-agent/client-mode.test.mjs` — 2 cases:
  - With `MINIMAX_API_KEY` set, mode = `'real'`
  - Without `MINIMAX_API_KEY`, mode = `'stub'`
- `npm run typecheck` exits 0

**Commit:** `feat(fast-agent): client.ts with real Anthropic SDK + stub fallback (phase 6b T-05)`

**Trace:** R-01, R-02, AC-4, AC-15

---

#### T-06: `src/server/fast-agent/writer.ts` (sync write + perf measurement)

**File:** `src/server/fast-agent/writer.ts` (NEW, ~90 lines)

**Implements:**
- `IntelWriter` interface (per design §3.3):
  ```typescript
  export interface IntelWriter {
    write(sessionId: string, intel: Intel): Promise<void>;
    measureSyncWriteMs(sessionId: string, intel: Intel): Promise<number>;
  }
  ```
- `createSyncIntelWriter(db: Database): IntelWriter`:
  1. `write()` calls the existing `writeIntelRow()` from `src/catalog/intel-store.ts` (T-02)
  2. `ts = Math.floor(Date.now() / 1000)` (unix seconds, matches `audit_events.ts` column type INTEGER)
  3. Catch write error → log to stderr + throw `IntelWriterError` (caller decides retry vs drop)
  4. NO batching, NO async — the synchronous call IS the write
- `createAsyncIntelWriter(db: Database): IntelWriter`:
  - MIRRORS `src/server/audit/buffer.ts:59-183` pattern EXACTLY:
    - In-memory ring buffer (capacity 10_000, `RING_BUFFER_CAPACITY`)
    - `enqueue()` push + immediate return (fire-and-forget)
    - `flush()` triggered at `FLUSH_COUNT_TRIGGER = 100` events OR `FLUSH_TIME_MS = 1000` (whichever first)
    - Fail-open: write error → stderr line, batch dropped, enqueue() never blocks
  - **NOT auto-activated**; the Implementer ONLY creates this factory if `test/server/fast-agent/writer-perf.test.mjs` reports `p95 > 1ms` per A-6
- `measureSyncWriteMs()` records `performance.now()` delta around the synchronous `writeIntelRow()` call. Returns the latency in ms. Used by `writer-perf.test.mjs`

**Depends on:** T-02 (`writeIntelRow` available), T-03 (`Intel` type)

**Verification:**
- `npm test -- test/server/fast-agent/writer-perf.test.mjs` — 5+ cases (extends Phase 6a T-02 perf test pattern):
  - Sync write p95 ≤ 1ms across 10 amostras + 5 warmup (seeded `:memory:` DB + 10 sequential writes)
  - If measured > 1ms: log `[fast-agent-writer] latency budget exceeded (p95=<ms> > 1ms); D-007 async fallback recommended` + assert that `createAsyncIntelWriter` factory exists (forces the Implementer to implement the async path)
  - Empty Intel round-trip via sync write
  - UTF-8 NFC normalization (write "café" → read "café" byte-equal)
- `npm run typecheck` exits 0
- IF async fallback is required, also `npm test -- test/server/fast-agent/writer-perf.test.mjs` asserts async writer p95 (batch flush overhead) ≤ 1ms too

**Commit:** `feat(fast-agent): writer.ts with sync mode + measured-trigger async fallback (phase 6b T-06)`

**Trace:** R-06, AC-5

---

#### T-07: `src/server/boot.ts` env var wiring + `.memory-studio/state.json` `fastAgent.model` + client construction

**File:** `src/server/boot.ts` (MODIFY: read existing Phase 5a.1 bootstrap)

**Implements:**
- At server boot (before `createServer()` returns):
  1. Read `process.env.MINIMAX_API_KEY`
  2. Read `.memory-studio/state.json` `fastAgent.model` (default = `"MiniMax-M2.7-highspeed"`)
  3. Construct the singleton `FastAgentClient` via `callFastAgent({...}, { model, apiKey })`. The client is cached in a module-scoped variable
  4. Log at boot: `[fast-agent] MODE=real|stub endpoint=<url> model=<model>`
  5. If `MINIMAX_API_KEY` is unset AND `@anthropic-ai/sdk` is not installed: log a warning `[fast-agent] WARN: @anthropic-ai/sdk not in node_modules; running in stub-only mode`. The stub path is `scripts/stub-fast-agent.mjs` spawned as child process
  6. Validate `fastAgent.model` is a non-empty string; invalid → log warning + fallback to `"MiniMax-M2.7-highspeed"` (NOT crash per R-17)
- Add `@anthropic-ai/sdk` to `package.json` `dependencies` if NOT already present (Phase 5b.4 added it but Phase 6a Verifier flagged the MAY-not-be-present gap per `poc-results.md §2`). Run `npm install @anthropic-ai/sdk` after the package.json change
- Expose `getFastAgentClient(): FastAgentClient` getter for the pipeline + proxy to consume

**Depends on:** T-05 (`callFastAgent` exists)

**Verification:**
- `npm test -- test/server/fast-agent/model-config.test.mjs` — 3+ cases:
  - Default model = `"MiniMax-M2.7-highspeed"` when `.memory-studio/state.json` missing field
  - Custom model from state.json is respected
  - Invalid model string → stderr warning + fallback to default (NOT crash)
- `npm ls @anthropic-ai/sdk` returns single resolved version
- `npm run typecheck` exits 0
- Manual: `node --experimental-strip-types --no-warnings scripts/augment-server.ts` → log line `[fast-agent] MODE=stub ...` (or `MODE=real` if API key set)

**Commit:** `feat(boot): MINIMAX_API_KEY env var + .memory-studio fastAgent.model wiring (phase 6b T-07)`

**Trace:** R-02, R-17, AC-15, AC-16, AC-20

---

#### T-08: `test/server/fast-agent/{empty-intel,client-mode}.test.mjs` (cross-cuts — runs in Batch 1)

**Files:**
- `test/server/fast-agent/empty-intel.test.mjs` (NEW, ~50 lines)
- `test/server/fast-agent/client-mode.test.mjs` (NEW, ~40 lines)

**Implements:**

**`empty-intel.test.mjs`:**
- D-005 graceful degradation contract: empty Intel literal `{ agentState: '', nextNeeds: [], recentTopic: '' }`
- 3 cases:
  - `serializeIntel(emptyIntel())` → valid canonical JSON string
  - `IntelSchema.safeParse(emptyIntel())` → success
  - `writeIntelRow(db, 'session-x', emptyIntel(), ts)` + `getIntel(db, 'session-x')` → unchanged empty literal

**`client-mode.test.mjs`:**
- 2 cases:
  - With `MINIMAX_API_KEY` set, `resolveMode(apiKey)` returns `'real'`
  - Without `MINIMAX_API_KEY`, `resolveMode(apiKey)` returns `'stub'`

**Depends on:** T-03, T-05

**Verification:**
- `npm test -- test/server/fast-agent/` — all batch-1 tests pass (intel-schema-contract + client + client-mode + writer-perf + writer-reader-contract + empty-intel + model-config)
- `npm test` reports ≥578 + batch-1 new tests
- `npm run typecheck` exits 0

**Commit:** `test(fast-agent): empty-intel + client-mode (phase 6b T-08)`

**Trace:** R-03, R-18, AC-3, AC-15, AC-21

---

### Subchapter 6b.3 — BuildOptions.intel + Suffix Injection

#### T-09: `src/server/augment/augmenter.ts` BuildOptions.intel + ## Intel section

**File:** `src/server/augment/augmenter.ts` (MODIFY: add ~40 lines)

**Implements:**
- Add to `BuildOptions` interface at line ~52 (preserving existing fields):
  ```typescript
  import type { Intel } from '../fast-agent/intel-schema.ts';
  // ...
  export interface BuildOptions {
    readonly matched: ReadonlyArray<RankedItem>;
    readonly personaTextOverride?: string;
    readonly context?: Context | null;
    readonly warnings?: ReadonlyArray<string>;
    /** Phase 6b: Intel literal from previous turn (set by pipeline via getIntel) */
    readonly intel?: Intel | null;
  }
  ```
- Extend `buildVariableSuffix` (lines 114-135) to emit `## Intel` section BEFORE the existing `## Skills` push:
  ```typescript
  function buildVariableSuffix(
    matched: ReadonlyArray<RankedItem>,
    context: Context | null | undefined,
    warnings: ReadonlyArray<string> | undefined,
    intel: Intel | null | undefined,  // NEW parameter
  ): string {
    const sections: string[] = [];

    // NEW: ## Intel — FIRST section in Block 2 (R-10)
    if (intel && (intel.agentState !== '' || intel.nextNeeds.length > 0 || intel.recentTopic !== '')) {
      sections.push('## Intel\n' + canonicalJsonStringify(intel));
    }

    // Existing sections (preserve order):
    const skills = matched.filter((m) => m.kind === 'skill');
    const rules = matched.filter((m) => m.kind === 'rule');
    if (skills.length > 0) {
      sections.push('## Skills\n' + skills.map((s) => s.text).join('\n\n'));
    }
    if (rules.length > 0) {
      sections.push('## Rules\n' + rules.map((r) => r.text).join('\n\n'));
    }
    if (context !== undefined && context !== null) {
      sections.push('## Context\n' + canonicalSha256(JSON.stringify(context)) + '\n' + JSON.stringify(context));
    }
    if (warnings && warnings.length > 0) {
      sections.push('## Warnings\n' + warnings.map((w) => `- ${w}`).join('\n'));
    }
    return sections.join('\n\n');
  }
  ```
- Update `buildSystemMessage()` (lines 151-172) to pass the new `intel` parameter through:
  ```typescript
  const block2Text = buildVariableSuffix(
    options.matched,
    effectiveContext,
    options.warnings,
    options.intel,  // NEW
  );
  ```

**Depends on:** T-03 (`Intel` type available for import)

**Verification:**
- `npm test -- test/augment/augmenter-intel.test.mjs` — 6+ cases (T-10 writes the test):
  - Empty/null/undefined intel → `## Intel` section OMITTED (no empty header)
  - Non-empty intel → `## Intel` section appears FIRST in Block 2
  - Intel section uses canonical JSON (D-006 determinism)
  - Block 1 (persona) unchanged regardless of intel
  - Existing `Skills/Rules/Context/Warnings` sections still appear in order
  - 2 builds with same (persona + intel + Skills) → same SHA (byte-string determinism)
- `npm test -- test/augment/augmenter.test.mjs` (existing Phase 5a tests) — all still pass (no regression)
- `npm run typecheck` exits 0

**Commit:** `feat(augmenter): BuildOptions.intel + ## Intel section in buildVariableSuffix (phase 6b T-09)`

**Trace:** R-07, R-08, R-10, AC-7, AC-8

---

#### T-10: `test/augment/{augmenter-intel,intel-injection}.test.mjs` (byte-string determinism with intel)

**Files:**
- `test/augment/augmenter-intel.test.mjs` (NEW, ~120 lines)
- `test/augment/intel-injection.test.mjs` (NEW, ~100 lines)

**Implements:**

**`augmenter-intel.test.mjs`:**
- Unit tests for the BuildOptions.intel extension (T-09 verification surface)
- 6 cases (from T-09 verification list)
- Imports: `buildSystemMessage` from `src/server/augment/augmenter.ts`
- Fixtures: same as Phase 5a.2 (`FIXTURE_PERSONA`, `FIXTURE_SKILLS`) + `FIXTURE_INTEL = { agentState: 'augmenter-test-agent-state', nextNeeds: ['augmenter-need-a', 'augmenter-need-b'], recentTopic: 'augmenter-test-recent-topic' }`

**`intel-injection.test.mjs`:**
- Integration tests verifying byte-string determinism with intel (Phase 6a T-09 pattern extended)
- 5 cases:
  - 2 builds with identical (persona + intel + Skills) → identical 64-char SHA-256 hex
  - Different intel → different SHA (different `recentTopic`)
  - Different ordering of intel fields → same SHA (canonical JSON key sort from `byte-string.ts:30-43`)
  - Empty intel + same persona + same Skills → same SHA as no-intel baseline (intel section conditional)
  - SHA matches `/^[0-9a-f]{64}$/`

**Depends on:** T-09 (BuildOptions extension in place)

**Verification:**
- `npm test -- test/augment/augmenter-intel.test.mjs test/augment/intel-injection.test.mjs` — 11 cases, all pass
- `npm test -- test/augment/` reports ≥578 + 11
- `npm run typecheck` exits 0

**Commit:** `test(augmenter): BuildOptions.intel + intel-injection determinism (phase 6b T-10)`

**Trace:** R-07, R-08, AC-7, AC-8

---

#### T-11: `test/server/fast-agent/intel-schema-contract.test.mjs` (D-005 hardening)

**File:** `test/server/fast-agent/intel-schema-contract.test.mjs` (NEW, ~80 lines)

**Implements:**
- 6+ test cases — Phase 6a `test/poc/intel-schema.test.mjs` (T-10) pattern, extended + elevated to the production `IntelSchema` (NOT the inline POC Zod)
- Imports: `IntelSchema`, `serializeIntel`, `deserializeIntel`, `emptyIntel` from `src/server/fast-agent/intel-schema.ts`
- Fixtures: `VALID_INTEL`, `EMPTY_INTEL` (D-005), `INVALID_MISSING_FIELD`, `INVALID_WRONG_TYPE`
- Cases:
  - `IntelSchema: valid literal parses OK` (mirrors Phase 6a T-10)
  - `IntelSchema: empty fields parse OK (graceful degradation)` (D-005)
  - `IntelSchema: missing nextNeeds fails parse`
  - `IntelSchema: wrong type on agentState fails parse`
  - `serializeIntel + JSON.parse round-trip preserves shape` (canonical JSON)
  - `stub fast-agent output matches IntelSchema` (wire-level compat with `scripts/stub-fast-agent.mjs` literal)

**Depends on:** T-03 (IntelSchema exists)

**Verification:**
- `npm test -- test/server/fast-agent/intel-schema-contract.test.mjs` — 6+ cases pass
- `npm test` reports ≥578 + new tests
- `npm run typecheck` exits 0

**Commit:** `test(fast-agent): IntelSchema D-005 contract (phase 6b T-11)`

**Trace:** R-03, R-18, AC-3, AC-6, AC-21

---

#### T-12: `test/server/fast-agent/writer-reader-contract.test.mjs` (end-to-end Intel round-trip)

**File:** `test/server/fast-agent/writer-reader-contract.test.mjs` (NEW, ~100 lines)

**Implements:**
- Open `:memory:` DB + apply `004_intel.sql` (via `applyMigrations` runner)
- Use `writeIntelRow()` from `src/catalog/intel-store.ts` (T-02) + `getIntel()` from same module
- 5+ cases:
  - Round-trip: write Intel → read via `getIntel` → unchanged
  - Empty Intel round-trip (D-005): `{ agentState: '', nextNeeds: [], recentTopic: '' }` → write → read → unchanged
  - Non-empty `nextNeeds` array: write `['a', 'b', 'c']` → read → unchanged (order preserved)
  - UTF-8 NFC normalization: write "café" → read "café" (byte-equal after normalization per `byte-string.ts:62-67`)
  - Type drift fails write loudly: write attempt with `nextNeeds: 'not-array'` → `IntelSchema.parse()` throws → write aborts (NOT silently coerced)

**Depends on:** T-02 (getIntel + writeIntelRow), T-03 (IntelSchema)

**Verification:**
- `npm test -- test/server/fast-agent/writer-reader-contract.test.mjs` — 5+ cases pass
- `npm test -- test/server/fast-agent/` reports all batch-2 tests pass
- `npm run typecheck` exits 0

**Commit:** `test(fast-agent): writer-reader round-trip + D-005 graceful degradation (phase 6b T-12)`

**Trace:** R-18, AC-6, AC-21

---

### Subchapter 6b.4 — Pipeline Integration + Cache Hit Validation

#### T-13: `src/server/augment/pipeline.ts` Stage 1b getIntel + tail setImmediate fast-agent schedule

**File:** `src/server/augment/pipeline.ts` (MODIFY: add ~50 lines)

**Implements:**
- `PipelineContext` extension (preserving existing fields):
  ```typescript
  export interface PipelineContext {
    readonly db: Database;
    readonly embedder: Embedder;
    readonly catalogDir?: string;
    readonly encodeQuery?: (prompt: string) => Promise<Float32Array>;
    // NEW in Phase 6b:
    readonly getIntel?: (sessionId: string) => Intel | null;
    readonly writeIntel?: (sessionId: string, intel: Intel) => Promise<void>;
    readonly callFastAgent?: (req: FastAgentRequest) => Promise<FastAgentResult>;
    readonly sessionId?: string;
  }
  ```
- In `runAugment()` (lines 77-164):
  1. **Stage 1b (NEW):** AFTER Stage 1 (social gate) but BEFORE Stage 4 (embed), if `context.getIntel !== undefined && context.sessionId !== undefined`:
     ```typescript
     const intel = context.getIntel(context.sessionId);
     ```
     Pass `intel` to `buildSystemMessage` via `BuildOptions.intel` (modify the Stage 8 call):
     ```typescript
     const { sha256 } = buildSystemMessage(request, {
       matched,
       context: request.context,
       warnings: topKWarnings,
       intel,  // NEW
     });
     ```
  2. **Tail (NEW):** if the response will be returned to a real provider (i.e., NOT a unit test stub) AND `context.callFastAgent !== undefined && context.sessionId !== undefined`:
     - Capture `R_N` from the response (if the response is forwarded to `/v1/messages`, the proxy reports it; otherwise the tail doesn't fire)
     - `setImmediate(async () => { ... })` — fire-and-forget fast-agent call:
       ```typescript
       setImmediate(async () => {
         try {
           const result = await context.callFastAgent!({ rN: capturedResponse, promptContext: request.context, model: 'MiniMax-M2.7-highspeed' });
           await context.writeIntel!(context.sessionId!, result.intel);
         } catch (err) {
           console.error('[fast-agent] background call failed:', err);
         }
       });
       ```
     - This tail runs AFTER the response is built; it does NOT block the response
- Tests inject stub versions of `getIntel`/`writeIntel`/`callFastAgent` via the `PipelineContext` to avoid depending on the real modules in unit tests

**Depends on:** T-02 (getIntel), T-05 (callFastAgent), T-06 (writeIntel), T-09 (BuildOptions.intel)

**Verification:**
- `npm test -- test/augment/pipeline-intel.test.mjs` (T-15 writes the test):
  - 3 cases:
    - `runAugment()` calls `context.getIntel(sessionId)` BEFORE Stage 4 (embed)
    - Returned intel (or null) is passed to `buildSystemMessage` via `BuildOptions.intel`
    - When `context.getIntel` returns `null` OR is undefined, `BuildOptions.intel` is `null` (intel section omitted)
- Existing `test/augment/{pipeline,route-e2e}.test.mjs` (Phase 5a) — all still pass (no regression)
- `npm run typecheck` exits 0

**Commit:** `feat(pipeline): Stage 1b getIntel + tail setImmediate fast-agent schedule (phase 6b T-13)`

**Trace:** R-11, R-20, AC-9, AC-10

---

#### T-14: `src/server/routes/messages-proxy.ts` schedules fast-agent after upstream response

**File:** `src/server/routes/messages-proxy.ts` (MODIFY: extend existing Phase 5b.4 proxy route)

**Implements:**
- The proxy response handler currently (Phase 5b.4) calls `/augment` in-process, forwards to upstream, captures `usage.cache_read_input_tokens`, returns the response. Phase 6b adds:
  - After `await upstreamResponse.json()` returns AND BEFORE the handler returns to the client:
    ```typescript
    if (request.fingerprint?.sessionId !== undefined && context.callFastAgent !== undefined) {
      const rN = extractAssistantText(upstreamResponse);  // helper from Phase 5b.4
      setImmediate(async () => {
        try {
          const result = await context.callFastAgent!({ rN, promptContext: extractedContext, model: 'MiniMax-M2.7-highspeed' });
          await context.writeIntel!(request.fingerprint.sessionId, result.intel);
        } catch (err) {
          console.error('[fast-agent] proxy schedule failed:', err);
        }
      });
    }
    ```
- The setImmediate runs after the proxy response is sent → zero impact on `/v1/messages` p50 latency (Phase 5b.4 baseline preserved per R-12)
- Hash session ID via existing `hashTenantId()` pattern (Phase 5b.1 `src/server/security/tenant-hash.ts`) — actually, the session ID is already hashed by the SDK per Phase 3 contract, so the proxy uses `request.fingerprint.sessionId` AS-IS (16-hex form)

**Depends on:** T-13 (pipeline integration; proxy uses same `callFastAgent` + `writeIntel` context)

**Verification:**
- `npm test -- test/augment/fast-agent-scheduling.test.mjs` (T-15 writes the test):
  - 3 cases:
    - `/v1/messages` returns 200 with the stub upstream response
    - Within 5s after the response, intel is persisted (poll SELECT via `:memory:` test DB)
    - `/v1/messages` response latency stays at the Phase 5b.4 baseline (≤ 50ms median — setImmediate fires AFTER return)
- Existing `test/server/smoke-proxy-local-only.test.mjs` (Phase 5b.4) — all still pass (no regression)
- `npm run typecheck` exits 0

**Commit:** `feat(proxy): messages-proxy schedules fast-agent after upstream response (phase 6b T-14)`

**Trace:** R-11, R-20, AC-10

---

#### T-15: `test/augment/{pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs`

**Files:** (4 test files, ~300 lines total)

**Implements:**

**`pipeline-intel.test.mjs` (3 cases — covers T-13):**
- See T-13 verification
- Uses `:memory:` DB + in-process Fastify `inject`

**`fast-agent-scheduling.test.mjs` (3 cases — covers T-14):**
- See T-14 verification
- Uses stub upstream provider (Phase 5b.4 pattern) + polling for intel write

**`inception-cache-hit.test.mjs` (3 cases — covers AC-11):**
- 2 turns with same persona + different prompts
- Local stub provider that simulates Anthropic's cache: reports `usage.cache_read_input_tokens: 42` on the 2nd call when the 2nd request's system message SHA-256 hash matches the 1st's
- Cases:
  - 2 turns: assert 2nd response includes `usage.cache_read_input_tokens: 42`
  - 2 turns with DIFFERENT persona: assert 2nd response has `usage.cache_read_input_tokens: 0` (different prefix = no cache hit)
  - Single turn: assert response has `usage.cache_read_input_tokens: 0` (no prior cache)

**`inception-e2e.test.mjs` (3 cases — covers AC-23):**
- Boosts the augment server on a free port (in-process Fastify `inject`)
- Sends 2 `/v1/messages` requests consecutively with same `sessionId` + same persona + different prompts
- After Turn 1: polls `SELECT FROM intel WHERE session_id = ?` every 100ms up to 5s for intel write
- After Turn 2: asserts cache hit + intel persisted
- Cases:
  - 2 turns: intel persisted within 5s; 2nd response cache hit + intel row present
  - Restart intel store between turns: 2nd response still cache hit (intel re-read from DB)
  - First turn with no prior intel: gracefully degrades (no intel section in Block 2; response 200)

**Depends on:** T-13, T-14

**Verification:**
- `npm test -- test/augment/{pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` — 12+ cases, all pass
- `npm test -- test/augment/` reports all Phase 6b + Phase 5a/5b tests passing
- `npm test` reports ≥578 + new tests
- `npm run typecheck` exits 0

**Commit:** `test(augment): pipeline-intel + fast-agent-scheduling + inception-cache-hit + inception-e2e (phase 6b T-15)`

**Trace:** R-09, R-11, R-15, R-20, AC-9, AC-10, AC-11, AC-23

---

#### T-16: `scripts/smoke-{latency-trick,inception-e2e}.mjs` (end-to-end smoke)

**Files:**
- `scripts/smoke-latency-trick.mjs` (NEW, ~150 lines)
- `scripts/smoke-inception-e2e.mjs` (NEW, ~150 lines)

**Implements:**

**`smoke-latency-trick.mjs` (AC-13):**
- Boots the augment server on a free port (`MEMORY_STUDIO_AUGMENT_PORT_RANGE=47700-47799`, distinct from test#237's exhausted range)
- Uses stub fast-agent (no API key)
- Sends 1 `/v1/messages` request with a fixture R_N + persona + sessionId
- Measures:
  - `t_response_end` = when `/v1/messages` returns
  - `t_intel_written` = when `SELECT FROM intel WHERE session_id = ?` returns the persisted row (poll every 100ms up to 5s)
- Parallel: `await new Promise(r => setTimeout(r, 5000))` (simulate human read)
- Asserts:
  - `(t_intel_written - t_response_end) < 5000` (fast agent ≤ 5s floor)
  - `(t_intel_written - t_response_end) < 3000` (strict budget, AD-006)
  - `(t_response_end - t_request_start) < 50` (`/v1/messages` p50 unaffected)
- Output: `[latency-trick] PASS|FAIL intel-write=<ms> response=<ms> budget-intel<3000ms budget-response<50ms`
- Exits 0 on PASS, 1 on FAIL
- Cleanup: Windows-safe `taskkill /F /T /PID` for the stub child + the augment server

**`smoke-inception-e2e.mjs` (AC-23):**
- Same boot (free port + stub fast-agent)
- Sends Turn 1 + waits for intel write (max 5s polling)
- Sends Turn 2 (same `sessionId` + same persona, different prompt)
- Local stub provider reports `usage.cache_read_input_tokens: 42` on 2nd call when system message SHA matches previous turn
- Asserts:
  - Both responses are 200
  - 2nd response `usage.cache_read_input_tokens === 42` (cache hit verified at FLOW level)
  - `SELECT FROM intel WHERE session_id = ?` returns the persisted row
- Output: `[inception-e2e] PASS|FAIL cache-hit=42 budget-intel<3000ms`
- Exits 0 on PASS, 1 on FAIL

**Depends on:** T-15 (the integration tests validate the same code paths in-process; the smoke scripts run end-to-end via real HTTP on a free port for the deploy-time gate)

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/smoke-latency-trick.mjs` exits 0
- `node --experimental-strip-types --no-warnings scripts/smoke-inception-e2e.mjs` exits 0
- Both output lines match the format above
- Cleanup verified: no orphan stub child (check `netstat -ano | findstr :477` shows no LISTENING after run)
- `npm run typecheck` exits 0

**Commit:** `feat(smoke): latency-trick + inception-e2e end-to-end gates (phase 6b T-16)`

**Trace:** R-15, R-16, AC-13, AC-23

---

#### T-17: AD-007 + `validation-phase-6b.md` + POC re-run + scope guard

**Files:**
- `.specs/DISCOVERIES.md` (append AD-007 + AD-008 entries)
- `.specs/features/phase-6b-fast-agent-intel/validation-phase-6b.md` (NEW, ~150 lines)
- `.specs/features/phase-6b-fast-agent-intel/poc-results-6b.md` (NEW, ~80 lines)

**Implements:**

**T-17a: AD-007 entry in `.specs/DISCOVERIES.md`:**

```markdown
### AD-007 — Phase 6b inception híbrida production wiring outcome (2026-08-01)

**Decision:** Phase 6b production wiring **RE-RUNS the Phase 6a POC ceilings** and reports. <PASS|FAIL | N/A>.

**Measurements (re-run of Phase 6a POC, with new code paths active):**
- Hot path overhead (sqlite.get(intel) + concat + template render, p95): <ms> (Phase 6a budget <10ms)
- Fast agent latency (MiniMax-M2.7-highspeed, p95): <ms> (Phase 6a budget <3s)
- Cache hit invariant (2 turns same persona, 2nd turn cache read): <PASS|FAIL>

**Por quê:** Phase 6b is the production wiring — the POC numbers become ceilings the runtime MUST honor. If the wiring exceeds the ceilings, the human decides to optimize (NOT add a fallback) per PRD §16.7 rule.

**Regra:** If any ceiling breached, Phase 6b is NOT closed until the breach is resolved.
```

**T-17a': AD-008 entry in `.specs/DISCOVERIES.md` (writer perf):**

```markdown
### AD-008 — Phase 6b writer latency outcome (2026-08-01)

**Decision:** <sync | async> writer is canonical for Phase 6b.

**Measurements (test/server/fast-agent/writer-perf.test.mjs):**
- Sync write p95: <ms> (budget <1ms per A-5)
- Decision: <"sync (measured <1ms, no fallback needed)" | "async (measured >1ms, D-007 fallback enabled)">

**Por quê:** Per AD-006 #4, sync is the default. Async is the fallback IF measured > 1ms. The Implementer MUST measure and decide.
```

**T-17b: `validation-phase-6b.md`:**
- Per-AC evidence table (mirrors Phase 5b.4 `validation-phase-5b.4.md`):
  - AC-1..AC-23 from spec.md, each with PASS/FAIL/SKIP + evidence
  - Diff range: `git diff 84d70a1..HEAD --stat`
- Verifier sub-agent writes this file (NOT the Implementer)

**T-17c: `poc-results-6b.md`:**
- Re-run output of `scripts/poc-6a-hot-path.mjs` after the new code paths are active
- 3 measurement components: sqlite.get(intel) p95 + concat p95 + template render p95 = total overhead p95
- Verdict: PASS (total <10ms) or FAIL (with specific component + adjustment recommendation)
- AD-007 references this doc for the measurement values

**T-17d: Scope guard verification:**
- `git diff 84d70a1..HEAD -- src/search/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty
- `npm test` reports ≥578 + Phase 6b new tests
- `npm run typecheck` exits 0
- Re-run Phase 6a POC tests: `node --test test/poc/` — all 19 POC tests pass

**Depends on:** T-01..T-16 (entire phase)

**Verification:**
- `npm test` exit 0 with total test count reporting
- `npm run typecheck` exits 0
- `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` exits 0 with `total-overhead < 10ms`
- `node scripts/smoke-latency-trick.mjs` exits 0
- `node scripts/smoke-inception-e2e.mjs` exits 0
- Scope guard git diff returns empty
- `validation-phase-6b.md` exists with all 23 ACs verified
- AD-007 + AD-008 entries added to `.specs/DISCOVERIES.md`

**Commit:** `docs(phase-6b): AD-007 + AD-008 + validation-phase-6b.md + poc-results-6b.md (phase 6b T-17)`

**Trace:** R-12, R-13, R-14, R-22, AC-12, AC-13, AC-17, AC-18, AC-22

---

## Execution Notes for the Implementer

1. **POC budgets are NON-NEGOTIABLE ceilings.** Phase 6a measured: sqlite.get(intel)=0.02ms (250× headroom under 5ms), concat=0ms, template render=0.04ms, TOTAL=0.07ms (147× headroom under 10ms), fast agent=223ms stub (13× headroom under 3s). Every task that modifies the hot path MUST honor these. T-17 RE-RUNS the POC at end-of-phase to confirm ceilings survive the new code paths.

2. **Async fallback is DOCUMENTED, not auto-activated.** Phase 6a POC measured sync write overhead = 0.02ms — well under the 1ms fallback trigger. The Implementer SHOULD measure first (`writer-perf.test.mjs`); if `p95 > 1ms`, the `createAsyncIntelWriter()` factory ships; otherwise sync is canonical. Record in AD-008.

3. **Stub fast-agent from Phase 6a stays as defensive fallback.** When `MINIMAX_API_KEY` is unset, `callFastAgent()` spawns `scripts/stub-fast-agent.mjs` as child process. The stub returns a deterministic Intel literal matching SPEC §IMod-5 + a known latency (~223ms). This is a SAFETY NET for environments without API access — Phase 7b tunes the REAL cache behavior. Do NOT substitute the stub for the real API in any production wiring test.

4. **Cache hit invariant: Block 1 NEVER modified by intel.** The `## Intel` section lives ONLY in Block 2 (variable suffix). Block 1 (persona) is the cache hit prefix. The R-15 test asserts `usage.cache_read_input_tokens > 0` on Turn N+1 when persona is stable.

5. **Match script semantics = post-retrieval injection, NOT query expansion.** The match pipeline at `/augment` runs the existing prompt+context+catalog retrieval unchanged (Phase 5a.2 Stage 4-7). Intel is appended to Block 2's suffix AFTER retrieval. `src/search/**` is REUSE-ONLY.

6. **Windows-specific child cleanup.** T-05's stub spawn needs `taskkill /F /T /PID <pid>` pattern from Phase 5a.3 `scripts/smoke-augment-server.mjs:203-219`. Wrap all `child_process.spawn` in `try/finally` with explicit kill on test teardown. Verify no orphan: `netstat -ano | findstr :472` shows no LISTENING after run.

7. **test#237 port exhaustion:** `test/server/smoke.test.mjs:237` exhausts `[42900, 43000]`. Use DISTINCT port ranges for any Phase 6b test (e.g., `[47700, 47799]` for the smoke scripts).

8. **`@anthropic-ai/sdk` install gap.** Phase 5b.4 added it to `package.json` but Phase 6a Verifier noted it MAY not be installed in this environment (`poc-results.md §2`). Phase 6b T-07 MUST verify + re-install if missing (`npm install @anthropic-ai/sdk`).

9. **No regression to Phase 5a/5b/6a tests.** All 477 Phase 5a/b tests + 19 Phase 6a POC tests continue to pass without modification. Phase 6b adds new tests at `test/server/fast-agent/**`, `test/augment/{augmenter-intel,intel-injection,pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs`, and `test/catalog/{intel-store,intel-restart,migrations-004}.test.mjs`. Total test count after Phase 6b: ≥578 + new (target: ≥595).

10. **Subchapter boundaries are inviolable.** Do NOT start a subchapter's tasks before the previous subchapter's tasks are complete + committed. The 3 Implementer batches run SEQUENTIALLY.

11. **One atomic commit per task.** Use the `Commit:` line in each task body as the commit message. Use conventional commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`).

---

## Cross-references

- [Spec](./spec.md) — 23 acceptance criteria + 23 requirements
- [Design](./design.md) — architecture + components + latency trick protocol
- [.specs/ROADMAP.md](../../ROADMAP.md) lines 805-850 — Phase 6b canonical scope
- [.specs/DISCOVERIES.md](../../DISCOVERIES.md) — AD-006 4 architectural decisions + AD-007/AD-008 (T-17)
- [.specs/features/phase-6a-poc-validation/{spec,design,tasks,poc-results}.md](../phase-6a-poc-validation/) — POC artifacts
- [PRD.md §16, §16.2, §16.4, §16.5, §16.7](../../../PRD.md) — inception híbrida + engineering decisions
- [.scratch/memory-studio/spec.md §IMod-5](../../../.scratch/memory-studio/spec.md) — `Intel` shape (D-005)
- [Phase 5a tasks](../phase-5a-api-retrieval/tasks.md) — pipeline + augmenter patterns
- [Phase 5b tasks](../phase-5b-aux-endpoints/tasks.md) — audit buffer (D-007) + endpoint surface
- [src/server/audit/buffer.ts](../../../src/server/audit/buffer.ts) — D-007 async batching pattern (A-6 fallback reference)
- [scripts/stub-fast-agent.mjs](../../../scripts/stub-fast-agent.mjs) — Phase 6a stub fallback
- [scripts/poc-6a-hot-path.mjs](../../../scripts/poc-6a-hot-path.mjs) — Phase 6a POC re-run at T-17 (AC-12)
- [test/augment/perf.test.mjs](../../../test/augment/perf.test.mjs) — Phase 5a.4 perf harness (T-06 model)
- [CLAUDE.md](../../../CLAUDE.md) `## Testing contract` — gates, scope guard, atomic commit discipline
