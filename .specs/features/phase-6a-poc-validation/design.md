---
date: 2026-08-01
version: 1
description: "Phase 6a — POC Validation design. Measurement methodology + harness contracts for 3 POC targets (hot path overhead, fast agent latency, byte-string determinism with template). Reuses Phase 5a.4 perf harness pattern; in-process app.inject + 10 amostras + p95 statistics."
explanation: |
  Phase 6a is MEASUREMENT + ANALYSIS, not implementation. This design
  documents the HOW: synthetic fixtures, statistical methodology, harness
  contracts, fallback strategy, and decision tree on failure.

  Why this design (key choices):

  1. **In-process measurement, no socket:** Phase 5a.4 T-12 pattern proven.
     `app.inject()` eliminates kernel scheduling noise. Same `portRange`
     strategy (`[43900, 43999]` reserved, no collision with [42900-43000]).

  2. **ONNX excluded from hot path loop:** the 3 measured operations are
     `sqlite.get(intel)` + concat + template render — none touch ONNX.
     Embedder is stubbed with a cached 384d Float32Array (Phase 5a.4
     `deterministicQueryVector()` pattern). The hot path POC measures
     SERVER overhead of the NEW operations, not ONNX runtime noise.

  3. **10 amostras per target:** PRD §16.7 explicit. p95 is the gating
     metric. Reports `min / median / p95 / max` per set (matches Phase 5a.4
     reporting format `[perf] median(p50)=<ms> p99=<ms>...`).

  4. **Stub fast agent as fallback:** CLAUDE.md context (no direct API
     guaranteed). Real `MiniMax-M2.7-highspeed` is the default per
     ROADMAP; stub at `scripts/stub-fast-agent.mjs` is the fallback when
     `MINIMAX_API_KEY` unset. The stub is MARKED `[STUB]` in every line
     so the Implementer cannot confuse stub output with real API output.

  5. **Incremental overhead measurement (A-6):** the 3 new operations
     are run as an ADDITIVE wrapper around a no-op baseline. The result
     is the INCREMENTAL cost the Implementer needs to budget against
     the existing Phase 5a.4 pipeline baseline (~1.91ms median).
     The total `<10ms` budget = the NEW cost added, not the full cost.

  6. **Byte-string determinism with template:** the 2-block template from
     Phase 5a.2 (`buildSystemMessage`) is extended with an `## Intel`
     section in Block 2's variable suffix. Same `canonicalSha256()`
     primitive. The test asserts 64-char hex equality for 2 identical
     inputs (same persona + same intel + same Skills ativas).

  Subchapter breakdown (3 subchapters per A-8):
  - 6a.1 Hot Path Overhead POC: T-01..T-04 (harness + 3 measurements + analysis)
  - 6a.2 Fast Agent Latency POC: T-05..T-08 (real API harness + stub fallback + 10 amostras + analysis)
  - 6a.3 Byte-String Determinism + AD-006: T-09..T-11 (template equality test + AD-006 record + poc-results.md)

  Whole Phase 6a = 1 Implementer batch (≤12 tasks fits single worker).
  3 Verifier dispatches (one per subchapter) after each closes.
related:
  - ./spec.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5a-api-retrieval/validation-phase-5a.4.md
  - ../../../PRD.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../../test/augment/perf.test.mjs
  - ../../../scripts/smoke-{augment-server,proxy-local-only}.mjs
  - ../../../src/server/augment/{pipeline,augmenter,byte-string}.ts
---

# Phase 6a — POC Validation (hot path + fast agent) — Design

**Source spec:** [`./spec.md`](./spec.md)
**Source tasks:** [`./tasks.md`](./tasks.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `c7e7a8d` (Phase 5b.4 closure — 559 tests: 391 root + 152 UI + 16 SDK)
**Output deliverables:**
- `scripts/poc-6a-hot-path.mjs` (hot path measurement script — R-01..R-04)
- `scripts/poc-6a-fast-agent.mjs` (fast agent measurement script — R-05, R-06)
- `scripts/stub-fast-agent.mjs` (Anthropic-compatible stub fallback — R-06)
- `test/poc/byte-string-equality.test.mjs` (template equality test — R-07)
- `test/poc/intel-schema.test.mjs` (SPEC §IMod-5 shape validation — D-005 hardening)
- `.specs/features/phase-6a-poc-validation/poc-results.md` (consolidated report — R-12)
- `.specs/DISCOVERIES.md` AD-006 (decision record — R-11)
- NO changes to `src/server/**`, `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`, `packages/sdk/**`, `packages/ui/**`

---

## 1. Measurement Methodology

### 1.1 Statistical Discipline

Per PRD §16.7 + ROADMAP §6a done criteria: **N=10 amostras per target**. Statistics:

| Statistic | Used for | Reporting |
|---|---|---|
| `min` | Lower bound (sanity) | always reported |
| `median` | Central tendency | always reported |
| `p95` | **Gating metric** (PRD §16.7 explicit) | always reported + asserted |
| `max` | Outlier flag (transparency) | always reported |

Per Phase 5a.4 Verifier feedback (test#237 honest uncertainty), the p95 budget has **no slack** — measured numbers must be strictly `< budget` (no `≤`). If p95 hits the wall (e.g., 9.99ms vs 10ms budget), the harness reports FAIL with adjustment recommendation.

### 1.2 In-Process Pattern (matches Phase 5a.4 T-12)

```
createServer({ portRange: [43900, 43999] })  // outside default [42900, 43000]
  ↓
handle.app.inject({ method, url, payload })  // no socket, no kernel noise
```

Why in-process:
- Eliminates loopback TCP handshake (~100-200µs per request on Windows)
- Strips process startup cost (already paid by harness)
- Still exercises the FULL handler path (Zod → social gate → retrieval → augmenter → log)
- Deterministic across runs (no OS scheduling jitter)

### 1.3 ONNX Exclusion (matches Phase 5a.4 R-08)

Embedder is stubbed with a cached 384d Float32Array:

```javascript
const cachedVector = new Float32Array(384).fill(0.1);
embedder.encode = () => Promise.resolve(new Float32Array(cachedVector));
```

Result: hot path measurements reflect SERVER overhead only, not ONNX runtime noise. Same as Phase 5a.4 T-12 (`perf.test.mjs:127-191`).

### 1.4 Incremental Overhead (per A-6)

The 3 new operations are NOT measured in isolation against the full Phase 5a.4 baseline (~1.91ms median). They are measured INCREMENTALLY:

```
baseline(no-op) = empty buildSystemMessage() with no intel
incremental(intel) = baseline(no-op) + sqlite.get + concat + template render with intel
overhead = incremental(intel) - baseline(no-op)
```

This gives the Implementer the **delta** to budget against. The `total < 10ms` budget = this delta, NOT the full pipeline cost.

### 1.5 Synthetic Fixtures (deterministic, no flake)

Per Phase 5a.4 fixture pattern (`perf.test.mjs:89-115`):

| Fixture | Determinism source |
|---|---|
| `session_id` | Fixed string `"poc-6a-session-001"` |
| `Intel` literal | Fixed object literal `{ agentState, nextNeeds, recentTopic }` |
| `prompt` | Fixed string matching the canonical Phase 5a.4 BASE_PROMPT |
| `persona` | Fixed id from fixture corpus (`persona-senior-engineer`) |
| `Skills ativas` | Fixed id list (3 skills from fixture) |
| Embedding | Pre-computed 384d Float32Array (`new Float32Array(384).fill(0.1)`) |

No PRNG. No `setTimeout` jitter. Every measurement is reproducible byte-for-byte across runs (within OS scheduling noise floor).

---

## 2. Hot Path Harness Design (R-01..R-04)

### 2.1 Measurement Architecture

```
┌─────────────────────────────────────────────────┐
│ scripts/poc-6a-hot-path.mjs                     │
│                                                 │
│ ┌──────────────┐  ┌──────────────┐  ┌─────────┐ │
│ │ Component 1  │  │ Component 2  │  │ Comp 3  │ │
│ │ sqlite.get   │  │ concat       │  │ template│ │
│ │ (intel)      │  │ (intel+prompt│  │ render  │ │
│ │              │  │              │  │ (2-block│ │
│ │              │  │              │  │ +intel) │ │
│ └──────────────┘  └──────────────┘  └─────────┘ │
│         ↓                ↓              ↓       │
│      p95 stats        p95 stats      p95 stats  │
│         ↓                ↓              ↓       │
│         └────────────────┴──────────────┘       │
│                  ↓                               │
│          total_overhead (p95 sum)               │
│                  ↓                               │
│   PASS if total_overhead < 10ms                 │
│   FAIL otherwise (per-component flag)           │
└─────────────────────────────────────────────────┘
```

### 2.2 Component 1: `sqlite.get(intel)` (R-01)

**Setup:**
- Real `:memory:` SQLite via `better-sqlite3` (matches Phase 5a.4 `freshSeededDb()`)
- DDL applied: `CREATE TABLE intel (session_id TEXT PRIMARY KEY, agent_state TEXT NOT NULL DEFAULT '', next_needs TEXT NOT NULL DEFAULT '[]', recent_topic TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)`
- 10 rows seeded with deterministic `Intel` literals (one per amostra)

**Measurement loop (per amostra):**
```javascript
const t0 = performance.now();
const row = db.prepare('SELECT * FROM intel WHERE session_id = ?').get(`poc-6a-session-${String(i).padStart(3, '0')}`);
const intel = { agentState: row.agent_state, nextNeeds: JSON.parse(row.next_needs), recentTopic: row.recent_topic };
const t1 = performance.now();
sqliteGetLatencies.push(t1 - t0);
```

**Gate:** `p95 < 5ms`

**Excludes:** nothing (the read IS the thing being measured; no mocks of SQLite).

### 2.3 Component 2: `concat(intel + prompt)` (R-02)

**Setup:**
- Pure function, no I/O
- Input: 1 `Intel` literal + 1 prompt string

**Measurement loop:**
```javascript
const t0 = performance.now();
const concatText = `## Intel\n${intel.agentState}\n\n## NextNeeds\n${intel.nextNeeds.join(', ')}\n\n## RecentTopic\n${intel.recentTopic}\n\n## Prompt\n${prompt}`;
const t1 = performance.now();
concatLatencies.push(t1 - t0);
```

**Gate:** `p95 < 1ms`

**Excludes:** `sqlite.get` (measured separately in Component 1) and template render (measured in Component 3).

### 2.4 Component 3: `template render` (R-03)

**Setup:**
- Reuses `buildSystemMessage()` from Phase 5a.2 (`src/server/augment/augmenter.ts:151-172`)
- Input: a stub `RankedItem[]` (3 skills, same as Phase 5a.4 fixture) + a `Context` literal + the `Intel` literal
- The `Intel` literal is added to Block 2's variable suffix as an `## Intel` section (extends `buildVariableSuffix` in `augmenter.ts:114-135`)

**Measurement loop:**
```javascript
const t0 = performance.now();
const { sha256 } = buildSystemMessage(stubRequest, {
  matched: FIXTURE_MATCHED,
  context: stubContext,
  warnings: [],
  intel,  // ← new param (Phase 6b adds it formally; Phase 6a POC uses an inline extension)
});
const t1 = performance.now();
templateLatencies.push(t1 - t0);
```

**Gate:** `p95 < 1ms`

**Excludes:** `sqlite.get` and concat (both measured separately).

**Note on `intel` param:** the existing `BuildOptions` interface does NOT include `intel`. Phase 6a POC uses an INLINE extension (a local helper that builds the same 2-block structure but with intel appended). This avoids modifying Phase 5a.2's `BuildOptions` (scope guard per R-14). Phase 6b will add `intel` to `BuildOptions` formally.

### 2.5 Total + Verdict

```javascript
const totalP95 = sqliteGetP95 + concatP95 + templateP95;
const pass = totalP95 < 10 && sqliteGetP95 < 5 && concatP95 < 1 && templateP95 < 1;
```

Output format (matches Phase 5a.4 `[perf]` line):
```
[hot-path] PASS|FAIL median=<ms> p95=<ms> total-overhead=<ms> [sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]
```

### 2.6 Hot Path Failure Decision Tree

| Failed component | Recommended adjustment (NOT collapse) |
|---|---|
| `sqlite.get` p95 > 5ms | Add `idx_intel_session_id` covering index; or denormalize into `audit_events` row; or use prepared statement cache |
| `concat` p95 > 1ms | Use `String.prototype.concat` or template literal JIT path; or precompute template skeleton; or skip concat when intel is empty |
| `template render` p95 > 1ms | Use `JSON.stringify` shortcut (skip `canonicalJsonStringify` when inputs are pre-sorted); or precompute Block 1 (persona) outside the loop; or memoize `canonicalSha256()` |

---

## 3. Fast Agent Harness Design (R-05, R-06)

### 3.1 Real API Path (default)

When `MINIMAX_API_KEY` env var is set:

```javascript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: 'https://api.minimax.io/anthropic',
});
const response = await client.messages.create({
  model: 'MiniMax-M2.7-highspeed',
  max_tokens: 256,
  system: 'You are an intel-extraction agent. Output JSON matching { agentState: string, nextNeeds: string[], recentTopic: string }',
  messages: [{ role: 'user', content: STUB_R_N_TEXT }],
});
```

Latency measurement:
```javascript
const t0 = performance.now();
const response = await client.messages.create({...});
const t1 = performance.now();
fastAgentLatencies.push(t1 - t0);
```

**Gate:** `p95 < 3s` (ROADMAP §6a done #5)

**Excludes:** nothing — the API call IS the thing being measured.

### 3.2 Stub Fallback Path (when `MINIMAX_API_KEY` unset)

`scripts/stub-fast-agent.mjs` exposes:
- POST `/v1/messages` (Anthropic-compatible)
- Returns a deterministic `Intel` literal as JSON
- Configurable `SIMULATED_LATENCY_MS` (default 200ms — within highspeed <1s range)
- **Every log line marked `[STUB]`**

Wire shape (matches Anthropic Messages API):
```json
{
  "id": "msg_stub_001",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "{\"agentState\":\"...\", \"nextNeeds\":[...], \"recentTopic\":\"...\"}" }],
  "model": "MiniMax-M2.7-highspeed-stub",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 64, "output_tokens": 32 }
}
```

The harness MUST log:
```
[fast-agent] MODE=stub (MINIMAX_API_KEY not set); simulated_latency_ms=200
```

This is transparent: the Verifier can see at a glance whether the measurement is real or simulated.

### 3.3 10 amostras Protocol

```javascript
for (let i = 0; i < 10; i++) {
  const t0 = performance.now();
  const response = await callFastAgent(STUB_R_N_TEXT);  // or stub
  const t1 = performance.now();
  fastAgentLatencies.push(t1 - t0);
}
```

Same `STUB_R_N_TEXT` for all 10 amostras (deterministic; eliminates input variance). 1 second sleep between amostras (avoids rate-limit; matches Phase 5a.4 warmup pattern).

### 3.4 Output Format

```
[fast-agent] MODE=real|stub endpoint=<url> model=MiniMax-M2.7-highspeed median=<ms> p95=<ms> [PASS|FAIL]
```

### 3.5 Fast Agent Failure Decision Tree

| Failure mode | Recommended adjustment |
|---|---|
| p95 > 3s with real API | Try alternative highspeed variant (e.g., `MiniMax-M2.7-highspeed-mini` if available); or reduce `max_tokens` (256 → 128); or switch to async fire-and-forget (intel arrives later, Turn N+2 has it) |
| API key not provisioned | Configure `MINIMAX_API_KEY` in environment; stub is NOT a permanent substitute |
| Stub in use (no real API) | Manual human intervention: provision the API key, re-run POC |
| Network errors (DNS, timeout) | Add retry with exponential backoff (1s, 2s, 4s); or switch base URL |

---

## 4. Byte-String Determinism with Template (R-07)

### 4.1 Test Architecture

`test/poc/byte-string-equality.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../../src/server/augment/byte-string.ts';

const FIXTURE_INTEL = {
  agentState: 'poc-6a-fixture-agent-state',
  nextNeeds: ['fixture-need-a', 'fixture-need-b'],
  recentTopic: 'poc-6a-fixture-recent-topic',
};

const FIXTURE_PERSONA = 'persona-senior-engineer';
const FIXTURE_SKILLS = ['auth-jwt-validation', 'auth-oauth-handler', 'auth-session-cookie'];

function buildSystemMessageWithIntel(persona, skills, intel) {
  // Inline extension of Phase 5a.2 buildSystemMessage with intel appended to Block 2
  // (Phase 6b will add intel as a formal BuildOptions param)
  const block1 = { type: 'text', text: persona, cache_control: { type: 'ephemeral' } };
  const block2 = {
    type: 'text',
    text: `## Skills\n${skills.join('\n\n')}\n\n## Intel\n${JSON.stringify(intel)}`,
    cache_control: { type: 'ephemeral' },
  };
  return canonicalSha256([block1, block2]);
}

test('byte-string: 2 identical inputs → same SHA-256', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  assert.equal(sha1, sha2);
  assert.match(sha1, /^[0-9a-f]{64}$/);
});

test('byte-string: different intel → different SHA-256', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, FIXTURE_INTEL);
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, { ...FIXTURE_INTEL, recentTopic: 'different' });
  assert.notEqual(sha1, sha2);
});

test('byte-string: same intel + different ordering → same SHA-256 (canonical JSON)', () => {
  const sha1 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, {
    agentState: 'a', nextNeeds: ['x'], recentTopic: 'r',
  });
  const sha2 = buildSystemMessageWithIntel(FIXTURE_PERSONA, FIXTURE_SKILLS, {
    recentTopic: 'r', agentState: 'a', nextNeeds: ['x'],
  });
  assert.equal(sha1, sha2);  // canonicalJsonStringify sorts keys recursively
});
```

### 4.2 D-005 Schema Validation (additional test)

`test/poc/intel-schema.test.mjs`:
- Validates `Intel` shape literally matches SPEC §IMod-5
- Tests graceful degradation: `agentState: ''`, `nextNeeds: []`, `recentTopic: ''` all parse OK
- Tests writer-reader contract: `JSON.stringify(intel)` → `JSON.parse(intel)` round-trip preserves shape

### 4.3 Failure Decision Tree

| Failure mode | Recommended adjustment |
|---|---|
| 2 identical inputs → different SHA | `canonicalJsonStringify` is non-deterministic for the inputs; check for `Date.now()` or `Math.random()` leaks in the test fixture |
| Different intel → same SHA | Intel literal is being ignored in the byte-string; check the `buildSystemMessageWithIntel` helper includes the `## Intel` section |
| Order-dependent hash | `canonicalJsonStringify` is not sorting keys recursively; check `byte-string.ts:sortKeysDeep` (should already handle this — Phase 5a.2 invariant) |

---

## 5. Subchapter Breakdown

3 subchapters (one per POC target), each is a fresh Phase with its own Planner→Implementer→Verifier cycle.

### 5.1 6a.1 — Hot Path Overhead POC

**Goal:** measure `sqlite.get(intel)` + concat + template render and validate total <10ms (p95, 10 amostras).

**Tasks:** T-01..T-04 (4 tasks, 1 Implementer batch)

**Deliverables:**
- `scripts/poc-6a-hot-path.mjs` (the measurement script)
- Output: `[hot-path] PASS|FAIL median=<ms> p95=<ms> total-overhead=<ms> [sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]`

### 5.2 6a.2 — Fast Agent Latency POC

**Goal:** measure `MiniMax-M2.7-highspeed` API latency and validate p95 <3s (10 amostras). Falls back to stub when `MINIMAX_API_KEY` unset.

**Tasks:** T-05..T-08 (4 tasks, 1 Implementer batch)

**Deliverables:**
- `scripts/stub-fast-agent.mjs` (Anthropic-compatible stub fallback)
- `scripts/poc-6a-fast-agent.mjs` (the measurement script)
- Output: `[fast-agent] MODE=real|stub endpoint=<url> model=MiniMax-M2.7-highspeed median=<ms> p95=<ms> [PASS|FAIL]`

### 5.3 6a.3 — Byte-String Determinism + AD-006

**Goal:** prove template determinism with intel appended; record AD-006 decision.

**Tasks:** T-09..T-11 (3 tasks, 1 Implementer batch)

**Deliverables:**
- `test/poc/byte-string-equality.test.mjs` (template equality test)
- `test/poc/intel-schema.test.mjs` (SPEC §IMod-5 shape validation)
- `.specs/DISCOVERIES.md` AD-006 entry
- `.specs/features/phase-6a-poc-validation/poc-results.md` (consolidated report)

### 5.4 Total Phase 6a Batch Packing

| Batch | Subchapters | Tasks | Worker |
|---|---|---|---|
| **Batch 1** | 6a.1 + 6a.2 + 6a.3 | T-01..T-11 (11 tasks) | Worker A (Implementer sub-agent) |
| **Validation** | (all) | (all 11) | Worker B (Verifier sub-agent) — fresh, evidence-or-zero |

Single batch fits the ~7-task budget (11 tasks is acceptable per Phase 5b's 14-task single-batch precedent; the tasks are SHORT measurement scripts, not multi-file implementation).

---

## 6. Open Architectural Questions for Phase 6b

These are NOT POC blockers; they are flagged for the Phase 6b Planner to resolve:

1. **`BuildOptions.intel` formalization:** Phase 6a uses an inline helper (`buildSystemMessageWithIntel`); Phase 6b should add `intel?: Intel` to `BuildOptions` in `src/server/augment/augmenter.ts:51-70` and update `buildVariableSuffix` to emit the `## Intel` section.

2. **Intel store SQLite schema migration:** Phase 6a uses an inline DDL inside the harness. Phase 6b ships the formal `intel` table migration (`src/catalog/migrations/004_intel.sql`) with WAL mode + covering index.

3. **Fast agent module location:** Phase 6a uses inline Anthropic SDK calls inside the harness. Phase 6b should extract `src/server/fast-agent/{client,writer}.ts` for the in-process Haiku/MiniMax-M2.7-highspeed integration per PRD §16.4 resolution #1.

4. **Async vs sync intel write:** Phase 6a POC assumes sync write (latency is negligible per R-01 budget). Phase 6b may need async batching if write latency spikes (similar to D-007 CRITICAL audit async pattern).

---

## 7. Out of Design Scope

- `src/server/augment/**` modifications — Phase 6b (Phase 6a is read-only measurement).
- `src/search/**` modifications — REUSE-ONLY per CALIBRATION-RESIDUE.md.
- Anthropic API direct integration — `MiniMax-M2.7-highspeed` per ROADMAP Phase 6a note.
- Production intel store (WAL mode, schema versioning, covering indexes) — Phase 6b.
- Real Claude Code SDK integration test — Phase 6b (after POC validates architecture).
