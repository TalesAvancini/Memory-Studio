---
date: 2026-08-01
version: 1
description: "Phase 6a atomic tasks. 11 tasks across 3 subchapters (6a.1 hot path overhead POC, 6a.2 fast agent latency POC, 6a.3 byte-string determinism + AD-006). Each task is one measurement script or one analysis pass. Single Implementer batch; fresh Verifier at end."
explanation: |
  Phase 6a packs into 3 subchapters per SUBCHAPTER_BREAKDOWN trigger
  (11 atomic tasks, 1 Implementer batch of 11 tasks):

    - 6a.1 Hot Path Overhead POC: T-01 (harness scaffold + fixtures),
      T-02 (sqlite.get component), T-03 (concat + template render
      components), T-04 (consolidate + report)
    - 6a.2 Fast Agent Latency POC: T-05 (stub fast-agent server),
      T-06 (real API harness + 10 amostras), T-07 (stub fallback path),
      T-08 (consolidate + analysis)
    - 6a.3 Byte-String Determinism + AD-006: T-09 (template equality
      test), T-10 (Intel schema validation test), T-11 (AD-006 +
      poc-results.md)

  Subchapter boundaries are at genuine dependency seams:
    - 6a.1: hot path components (no external deps)
    - 6a.2: fast agent (depends on @anthropic-ai/sdk + MiniMax endpoint)
    - 6a.3: determinism + decision record (depends on 6a.1 + 6.2 findings)

  Single Implementer batch (11 tasks fits the budget — measurement
  scripts are SHORTER than multi-file implementation tasks; precedent:
  Phase 5b closed via 2 batches of 8+6 = 14 tasks).

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md

related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5a-api-retrieval/validation-phase-5a.4.md
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md
  - ../../../PRD.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../../test/augment/perf.test.mjs
  - ../../../scripts/smoke-{augment-server,proxy-local-only}.mjs
  - ../../../src/server/augment/{pipeline,augmenter,byte-string}.ts
  - ../../../CLAUDE.md
---

# Phase 6a — POC Validation (hot path + fast agent) — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `c7e7a8d` (Phase 5b.4 closure — 559 tests: 391 root + 152 UI + 16 SDK)
**Output deliverables:**
- `scripts/poc-6a-hot-path.mjs` (hot path measurement script — T-01..T-04)
- `scripts/poc-6a-fast-agent.mjs` (fast agent measurement script — T-05..T-08)
- `scripts/stub-fast-agent.mjs` (Anthropic-compatible stub fallback — T-05)
- `test/poc/byte-string-equality.test.mjs` (template equality test — T-09)
- `test/poc/intel-schema.test.mjs` (SPEC §IMod-5 shape validation — T-10)
- `.specs/features/phase-6a-poc-validation/poc-results.md` (consolidated report — T-11)
- `.specs/DISCOVERIES.md` AD-006 entry (T-11)
- NO changes to `src/server/**`, `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`, `packages/sdk/**`, `packages/ui/**`

---

## Test Coverage Matrix

> Generated from spec acceptance criteria + design test strategy + CLAUDE.md testing contract.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Hot path harness** (`poc-6a-hot-path.mjs`) | measurement script | N=10 amostras per component (sqlite.get, concat, template render); report min/median/p95/max; assert total <10ms | `scripts/poc-6a-hot-path.mjs` | `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` |
| **Fast agent harness** (`poc-6a-fast-agent.mjs`) | measurement script | N=10 amostras; real API when `MINIMAX_API_KEY` set, stub fallback otherwise; assert p95 <3s | `scripts/poc-6a-fast-agent.mjs` | `node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs` |
| **Stub fast agent** (`stub-fast-agent.mjs`) | unit + integration | Anthropic-compatible POST `/v1/messages`; deterministic `Intel` literal response; `[STUB]` in every log line | `scripts/stub-fast-agent.mjs` + `test/poc/stub-fast-agent.test.mjs` | `node --test test/poc/stub-fast-agent.test.mjs` |
| **Byte-string equality** (`byte-string-equality.test.mjs`) | unit | 2 identical inputs → same 64-char SHA-256 hex; different intel → different hash; canonical JSON key sort | `test/poc/byte-string-equality.test.mjs` | `node --test test/poc/byte-string-equality.test.mjs` |
| **Intel schema** (`intel-schema.test.mjs`) | unit | SPEC §IMod-5 shape literal match; graceful degradation on empty fields; round-trip JSON | `test/poc/intel-schema.test.mjs` | `node --test test/poc/intel-schema.test.mjs` |
| **POC consolidated report** (`poc-results.md`) | documentation | per-target measurements + PRIMARY verdict + fast agent verdict + byte-string verdict + decision | `.specs/features/phase-6a-poc-validation/poc-results.md` | (manual review) |
| **AD-006** (`.specs/DISCOVERIES.md`) | decision record | PASS or FAIL with specific adjustment recommendation per PRD §16.7 rule | `.specs/DISCOVERIES.md` | (manual review) |
| **TypeScript contract** | type gate only | All POC scripts TS-stripped; no new errors | All `scripts/poc-*.mjs`, `test/poc/*.test.mjs` | `npm run typecheck` |
| **Scope guard** | scope check | `git diff c7e7a8d..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ src/server/` returns empty | (git) | manual |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM) + Phase 5a/b measurement patterns (`test/augment/perf.test.mjs`, `scripts/smoke-augment-server.mjs`).

---

## Gate Check Commands

> Generated from `package.json` + `CLAUDE.md` testing contract.

| Gate Level | When to Use | Command |
|---|---|---|
| **Quick** | After unit-test-only tasks (T-05 stub, T-09, T-10) | `npm test -- test/poc/` |
| **Full** | After measurement-script tasks (T-01..T-08) | `npm test` (must remain ≥559 tests) |
| **Typecheck** | After any TS change | `npm run typecheck` |
| **Hot path POC** | After T-04 | `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` |
| **Fast agent POC** | After T-08 | `node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs` |
| **Build** | After phase completion (T-11) | `npm test && npm run typecheck && node scripts/poc-6a-hot-path.mjs && node scripts/poc-6a-fast-agent.mjs && npm test -- test/poc/` |
| **Scope guard** | After T-11 (end of phase) | `git diff c7e7a8d..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ src/server/` returns empty |

**Note:** POC scripts are NOT in `npm test` glob (they are measurement scripts, not unit tests). The new test files in `test/poc/*.test.mjs` ARE in the glob.

---

## Execution Plan

Three subchapters run sequentially. Whole Phase 6a = 1 Implementer batch.

```
Subchapter 6a.1 (Hot Path Overhead POC):  T-01 → T-02 → T-03 → T-04
                                                  ↓
Subchapter 6a.2 (Fast Agent Latency POC):        T-05 → T-06 → T-07 → T-08
                                                               ↓
Subchapter 6a.3 (Byte-String + AD-006):                  T-09 → T-10 → T-11
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 6a.1 + 6a.2 + 6a.3 | T-01..T-11 (11 tasks) | Worker A (Implementer sub-agent) |
| **Validation** | (all) | (all 11) | Worker B (Verifier sub-agent) — fresh, evidence-or-zero |

Single batch runs; Validation runs once after Batch 1 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 6a.1 — Hot Path Overhead POC

#### T-01: Hot path harness scaffold + fixtures

**File:** `scripts/poc-6a-hot-path.mjs` (new, ~150 lines)

**Implements:**
- ESM script with `node --experimental-strip-types` entry
- 3 measurement components: `measureSqliteGet()`, `measureConcat()`, `measureTemplateRender()` (stubs for T-02 + T-03 to fill in)
- Statistics helpers: `percentile(sorted, p)`, `summarizeRound(latencies)`, `aggregate(rounds)` (copy from `test/augment/perf.test.mjs:217-264`)
- Deterministic fixtures:
  - `FIXTURE_INTEL = { agentState: 'poc-6a-fixture-agent-state', nextNeeds: ['fixture-need-a', 'fixture-need-b'], recentTopic: 'poc-6a-fixture-recent-topic' }`
  - `FIXTURE_PROMPT = 'design a fastify endpoint that validates authentication tokens securely'` (matches Phase 5a.4 BASE_PROMPT)
  - `FIXTURE_SKILLS = ['auth-jwt-validation', 'auth-oauth-handler', 'auth-session-cookie']` (matches Phase 5a.4 fixture)
  - `FIXTURE_PERSONA = 'persona-senior-engineer'`
- Constants: `AMOSTRAS = 10`, `WARMUP_COUNT = 5`, `PORT_RANGE = [43_900, 43_999]` (matches Phase 5a.4)
- Output format (matches Phase 5a.4 `[perf]` line):
  ```
  [hot-path] PASS|FAIL median=<ms> p95=<ms> total-overhead=<ms> [sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]
  ```

**Depends on:** none (first task)

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` exits 0 (or non-zero with FAIL line — T-01 stubs return 0 for all measurements)
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): hot path harness scaffold + fixtures (phase 6a T-01)`

**Trace:** R-01..R-04 (scaffold + AC-1, AC-6)

---

#### T-02: `sqlite.get(intel)` measurement component

**File:** `scripts/poc-6a-hot-path.mjs` (extend T-01, ~60 net lines)

**Implements:**
- `freshSeededIntelDb()` helper:
  - Real `:memory:` SQLite via `better-sqlite3` (matches Phase 5a.4 `freshSeededDb()`)
  - DDL: `CREATE TABLE intel (session_id TEXT PRIMARY KEY, agent_state TEXT NOT NULL DEFAULT '', next_needs TEXT NOT NULL DEFAULT '[]', recent_topic TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)`
  - Seed 10 rows: `INSERT INTO intel VALUES (?, ?, ?, ?, ?)` with deterministic `Intel` literals (one per amostra)
- `measureSqliteGet()`:
  - 5 warmup `SELECT * FROM intel WHERE session_id = ?` calls (excluded from measurement)
  - 10 measurement calls: `const row = db.prepare('SELECT * FROM intel WHERE session_id = ?').get(sessionId)` + `JSON.parse(row.next_needs)` to deserialize the JSON array
  - Records latency as `performance.now()` deltas
- Returns `{ min, median, p95, max }` (calls `summarizeRound` from T-01)

**Depends on:** T-01

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` exits 0
- Output line contains `[sqlite.get p95=<ms>]` with a numeric value
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): sqlite.get(intel) measurement component (phase 6a T-02)`

**Trace:** R-01, R-08, R-10, AC-1, AC-2

---

#### T-03: `concat` + `template render` measurement components

**File:** `scripts/poc-6a-hot-path.mjs` (extend T-02, ~80 net lines)

**Implements:**
- `measureConcat()`:
  - 5 warmup calls + 10 measurement calls
  - Input: 1 `Intel` literal + 1 prompt string
  - Output: a single concatenated string (`## Intel\n...\n\n## Prompt\n...`)
  - Excludes sqlite.get (measured separately) and template render (measured separately)
- `measureTemplateRender()`:
  - 5 warmup calls + 10 measurement calls
  - Input: a stub `BuildOptions` object with `matched: FIXTURE_MATCHED`, `context: stubContext`, `warnings: []`, `intel: FIXTURE_INTEL`
  - Calls the existing `buildSystemMessage()` from `src/server/augment/augmenter.ts:151-172`
  - The `intel` is appended to Block 2's variable suffix via an INLINE helper `buildSystemMessageWithIntel()` (does NOT modify the existing `BuildOptions` interface — Phase 6b formalizes this)
  - Records latency as `performance.now()` deltas
- Returns `{ min, median, p95, max }` for each

**Depends on:** T-02

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` exits 0
- Output line contains `[sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]`
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): concat + template render measurement components (phase 6a T-03)`

**Trace:** R-02, R-03, R-07, R-08, R-10, AC-1, AC-2

---

#### T-04: Hot path consolidate + report

**File:** `scripts/poc-6a-hot-path.mjs` (extend T-03, ~30 net lines)

**Implements:**
- Main orchestrator:
  - Calls `measureSqliteGet()`, `measureConcat()`, `measureTemplateRender()` in sequence
  - Computes `totalP95 = sqliteGetP95 + concatP95 + templateP95`
  - Asserts: `pass = totalP95 < 10 && sqliteGetP95 < 5 && concatP95 < 1 && templateP95 < 1`
  - Prints `[hot-path] PASS|FAIL median=<ms> p95=<ms> total-overhead=<ms> [sqlite.get p95=<ms> concat p95=<ms> template p95=<ms>]`
  - Process exit code: `0` on PASS, `1` on FAIL
- Per-component breakdown printed in additional lines (one per component):
  ```
  [hot-path]   sqlite.get: min=<ms> median=<ms> p95=<ms> max=<ms> [budget < 5ms] PASS|FAIL
  [hot-path]   concat:     min=<ms> median=<ms> p95=<ms> max=<ms> [budget < 1ms] PASS|FAIL
  [hot-path]   template:   min=<ms> median=<ms> p95=<ms> max=<ms> [budget < 1ms] PASS|FAIL
  ```

**Depends on:** T-03

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` exits 0 on PASS, 1 on FAIL
- Output line matches the format above
- On FAIL: identify the failing component by reading the `[FAIL]` line
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): hot path consolidate + report (phase 6a T-04)`

**Trace:** R-04, R-12, AC-1, AC-2, AC-12

---

### Subchapter 6a.2 — Fast Agent Latency POC

#### T-05: Stub fast-agent server (Anthropic-compatible)

**File:** `scripts/stub-fast-agent.mjs` (new, ~120 lines)

**Implements:**
- ESM script with `node --experimental-strip-types` entry
- HTTP server on `127.0.0.1:<port>` (default 47200, configurable via `STUB_PORT`)
- POST `/v1/messages`:
  - Accepts Anthropic Messages API request shape
  - Sleeps for `SIMULATED_LATENCY_MS` (default 200ms, configurable)
  - Returns a deterministic `Intel` literal as the assistant text content:
    ```json
    {
      "id": "msg_stub_001",
      "type": "message",
      "role": "assistant",
      "content": [{
        "type": "text",
        "text": "{\"agentState\":\"stub-agent-doing-things\",\"nextNeeds\":[\"stub-need-1\"],\"recentTopic\":\"stub-topic\"}"
      }],
      "model": "MiniMax-M2.7-highspeed-stub",
      "stop_reason": "end_turn",
      "usage": { "input_tokens": 64, "output_tokens": 32 }
    }
    ```
  - **Every console.log line prefixed with `[STUB]`**
- Graceful shutdown on SIGTERM/SIGINT (1s timeout, matches Phase 5a pattern)
- Test: `test/poc/stub-fast-agent.test.mjs` (8+ cases):
  - Stub boots on free port
  - POST `/v1/messages` returns 200 + Anthropic Messages API shape
  - Response `content[0].text` parses as `Intel` literal matching SPEC §IMod-5
  - 2 consecutive POSTs return identical `Intel` literal (deterministic)
  - `[STUB]` prefix appears in stderr/stdout
  - Stub respects `SIMULATED_LATENCY_MS` env var

**Depends on:** none (independent of hot path)

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/stub-fast-agent.mjs &` boots in <1s
- `curl -X POST http://127.0.0.1:47200/v1/messages -H "content-type: application/json" -d '{"model":"MiniMax-M2.7-highspeed","messages":[{"role":"user","content":"hi"}]}'` returns 200 + Anthropic shape
- `npm test -- test/poc/stub-fast-agent.test.mjs` — 8+ test cases pass
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): stub fast-agent server (Anthropic-compatible) (phase 6a T-05)`

**Trace:** R-06, R-10, AC-3, AC-4, AC-6

---

#### T-06: Fast agent real-API harness + 10 amostras

**File:** `scripts/poc-6a-fast-agent.mjs` (new, ~150 lines)

**Implements:**
- ESM script with `node --experimental-strip-types` entry
- Mode detection:
  - If `MINIMAX_API_KEY` env var is set: real API mode
  - Else: log `[fast-agent] MINIMAX_API_KEY not set; falling back to stub` and switch to stub mode (T-07)
- Real API path:
  - Import `@anthropic-ai/sdk` (already in `package.json` from Phase 5b.4)
  - Client: `new Anthropic({ apiKey: process.env.MINIMAX_API_KEY, baseURL: 'https://api.minimax.io/anthropic' })`
  - 10 amostras: `client.messages.create({ model: 'MiniMax-M2.7-highspeed', max_tokens: 256, system: '...', messages: [{ role: 'user', content: STUB_R_N_TEXT }] })`
  - Records `performance.now()` deltas
  - 1 second sleep between amostras (rate-limit hygiene)
- Statistics helpers (copy from T-01)
- Output format:
  ```
  [fast-agent] MODE=real endpoint=https://api.minimax.io/anthropic model=MiniMax-M2.7-highspeed median=<ms> p95=<ms> [PASS|FAIL]
  ```

**Depends on:** T-05 (for stub fallback contract; T-06 is primarily real API)

**Verification:**
- With `MINIMAX_API_KEY` set: `node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs` exits 0 (or 1 on FAIL), prints `[fast-agent] MODE=real`
- Without `MINIMAX_API_KEY`: prints `[fast-agent] MINIMAX_API_KEY not set; falling back to stub` (T-07 path takes over)
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): fast agent real-API harness + 10 amostras (phase 6a T-06)`

**Trace:** R-05, R-10, AC-3, AC-4, AC-6

---

#### T-07: Fast agent stub fallback path

**File:** `scripts/poc-6a-fast-agent.mjs` (extend T-06, ~50 net lines)

**Implements:**
- Stub mode (when `MINIMAX_API_KEY` unset):
  - Spawn `scripts/stub-fast-agent.mjs` as a child process (mirror Phase 5a.3 `bootAugmentServer` pattern at `scripts/smoke-augment-server.mjs:170-201`)
  - Wait for stub to be ready (poll `/v1/messages` or parse stdout for `[STUB] listening on http://127.0.0.1:<port>`)
  - Use Node 22 `fetch()` to POST to `http://127.0.0.1:47200/v1/messages`
  - 10 amostras with 1s sleep between
  - On completion: kill stub child process (mirror `killChild` at `scripts/smoke-augment-server.mjs:203-219` with Windows `taskkill /F /T /PID` pattern)
- Output format:
  ```
  [fast-agent] MODE=stub endpoint=http://127.0.0.1:47200/v1/messages model=MiniMax-M2.7-highspeed-stub median=<ms> p95=<ms> [PASS|FAIL]
  ```

**Depends on:** T-05, T-06

**Verification:**
- Without `MINIMAX_API_KEY`: `node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs` exits 0 (or 1 on FAIL), prints `[fast-agent] MODE=stub`
- Stub is killed cleanly after run (no orphan process: `netstat -ano | findstr :472` shows no LISTENING)
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): fast agent stub fallback path (phase 6a T-07)`

**Trace:** R-05, R-06, AC-3, AC-4, AC-6

---

#### T-08: Fast agent consolidate + analysis

**File:** `scripts/poc-6a-fast-agent.mjs` (extend T-07, ~20 net lines)

**Implements:**
- Gate: `pass = p95 < 3000` (3s budget)
- Per-component breakdown:
  ```
  [fast-agent]   fast-agent: min=<ms> median=<ms> p95=<ms> max=<ms> [budget < 3000ms] PASS|FAIL
  ```
- On FAIL: print adjustment recommendation from `design.md §3.5`
  - `p95 > 3s with real API → try alternative highspeed variant`
  - `API key not provisioned → configure MINIMAX_API_KEY`
  - `Stub in use → manual intervention required`
- Process exit code: `0` on PASS, `1` on FAIL

**Depends on:** T-07

**Verification:**
- `node --experimental-strip-types --no-warnings scripts/poc-6a-fast-agent.mjs` exits 0 on PASS, 1 on FAIL
- Output line matches the format above
- On FAIL: adjustment recommendation is printed
- `npm run typecheck` exits 0

**Commit:** `chore(poc-6a): fast agent consolidate + analysis (phase 6a T-08)`

**Trace:** R-05, R-12, AC-3, AC-4, AC-6, AC-12

---

### Subchapter 6a.3 — Byte-String Determinism + AD-006

#### T-09: Template byte-string equality test

**File:** `test/poc/byte-string-equality.test.mjs` (new, ~100 lines)

**Implements:**
- Import `canonicalSha256` from `src/server/augment/byte-string.ts`
- Inline helper `buildSystemMessageWithIntel(persona, skills, intel)`:
  - Builds the 2-block `cache_control: ephemeral` structure with `intel` appended to Block 2's `## Intel` section
  - Returns `canonicalSha256([block1, block2])` (uses existing Phase 5a.2 primitive)
- Fixtures:
  - `FIXTURE_INTEL = { agentState: 'poc-6a-fixture-agent-state', nextNeeds: ['fixture-need-a', 'fixture-need-b'], recentTopic: 'poc-6a-fixture-recent-topic' }`
  - `FIXTURE_PERSONA = 'persona-senior-engineer'`
  - `FIXTURE_SKILLS = ['auth-jwt-validation', 'auth-oauth-handler', 'auth-session-cookie']`
- Test cases (3-4):
  - `byte-string: 2 identical inputs → same SHA-256` (R-07 AC-5)
  - `byte-string: different intel → different SHA-256`
  - `byte-string: same intel + different key ordering → same SHA-256` (canonical JSON)
  - `byte-string: SHA-256 is 64 hex chars` (regex `/^[0-9a-f]{64}$/`)

**Depends on:** none (uses Phase 5a.2 primitives)

**Verification:**
- `node --test test/poc/byte-string-equality.test.mjs` — 3-4 cases pass
- `npm run typecheck` exits 0
- `npm test` reports ≥563 tests (559 baseline + 4 new)

**Commit:** `test(poc-6a): template byte-string equality (phase 6a T-09)`

**Trace:** R-07, AC-5, AC-6, AC-10

---

#### T-10: Intel schema validation test (D-005 hardening)

**File:** `test/poc/intel-schema.test.mjs` (new, ~80 lines)

**Implements:**
- Inline Zod schema (or hand-rolled type guard) matching SPEC §IMod-5:
  ```typescript
  const IntelSchema = z.object({
    agentState: z.string(),
    nextNeeds: z.array(z.string()),
    recentTopic: z.string(),
  });
  ```
- Fixtures:
  - `VALID_INTEL = { agentState: '...', nextNeeds: ['x', 'y'], recentTopic: '...' }`
  - `EMPTY_INTEL = { agentState: '', nextNeeds: [], recentTopic: '' }` (D-005 graceful degradation)
  - `INVALID_INTEL_MISSING_FIELD = { agentState: '', recentTopic: '' }` (nextNeeds missing)
  - `INVALID_INTEL_WRONG_TYPE = { agentState: 123, nextNeeds: 'not-array', recentTopic: null }`
- Test cases (5-6):
  - `Intel: valid literal parses OK`
  - `Intel: empty fields parse OK (graceful degradation)`
  - `Intel: missing nextNeeds fails`
  - `Intel: wrong type on agentState fails`
  - `Intel: JSON.stringify → JSON.parse round-trip preserves shape`
  - `Intel: writer-reader contract (output of fast agent matches reader schema)`

**Depends on:** none (independent test)

**Verification:**
- `node --test test/poc/intel-schema.test.mjs` — 5-6 cases pass
- `npm run typecheck` exits 0
- `npm test` reports ≥569 tests (559 + 4 from T-09 + 6 from T-10)

**Commit:** `test(poc-6a): Intel schema validation (D-005 hardening) (phase 6a T-10)`

**Trace:** R-07 (writer-reader contract), SPEC §IMod-5, D-005, AC-5, AC-10

---

#### T-11: AD-006 + poc-results.md (decision record)

**Files:**
- `.specs/DISCOVERIES.md` (append AD-006 entry)
- `.specs/features/phase-6a-poc-validation/poc-results.md` (new, ~150 lines)

**Implements:**

**T-11a: `.specs/DISCOVERIES.md` AD-006 entry:**

```markdown
### AD-006 — Phase 6a POC Validation outcome (2026-08-01)

**Decision:** Phase 6a POC result is **<PASS|FAIL>**.

**Measurements:**
- Hot path overhead (sqlite.get + concat + template render, p95): <ms> (budget <10ms)
- Fast agent latency (MiniMax-M2.7-highspeed, p95): <ms> (budget <3s)
- Byte-string determinism with template: <PASS|FAIL>

**PASS path:** Phase 6b proceeds with these targets as ceilings. No architectural adjustment needed.

**FAIL path:** Per PRD §16.7 rule ("ajustar, não collapsar"), the following SPECIFIC adjustments are recommended (NOT collapse-to-zero):
- <list specific adjustment per failing target from design.md §2.6 / §3.5 / §4.3>

**Por quê:** Phase 6a is the validation gate before Phase 6b's full inception híbrida implementation. The empirical numbers here bound Phase 6b's per-request latency budget.

**Regras:**
- Phase 6b MUST honor these measurements as ceilings
- If Phase 6b's production wiring exceeds these budgets, human decides to optimize (not to add a fallback)
```

**T-11b: `.specs/features/phase-6a-poc-validation/poc-results.md`:**

Required sections (per R-12 + AC-7):
1. **Hot path overhead POC:** measurements table (sqlite.get / concat / template render / total), PRIMARY verdict
2. **Fast agent latency POC:** measurements table, mode (real/stub), verdict
3. **Byte-string determinism POC:** equality test result + Intel schema validation result
4. **Decision:** PASS / FAIL + adjustment recommendation per PRD §16.7
5. **Methodology notes:** port range, fixtures, statistical discipline
6. **Architectural notes for Phase 6b:** any open questions flagged in `design.md §6`

**Depends on:** T-04, T-08, T-09, T-10 (all measurements must be complete)

**Verification:**
- AD-006 entry exists in `.specs/DISCOVERIES.md`
- `poc-results.md` exists with all 6 required sections
- All measurements quoted in AD-006 match the actual harness outputs
- On FAIL: specific adjustment recommendations from `design.md §2.6 / §3.5 / §4.3` are quoted
- `npm test` reports ≥569 tests (preserved baseline)
- `npm run typecheck` exits 0
- Scope guard: `git diff c7e7a8d..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ src/server/` returns empty

**Commit:** `docs(poc-6a): AD-006 + poc-results.md (decision record) (phase 6a T-11)`

**Trace:** R-11, R-12, AC-7, AC-8, AC-9, AC-10, AC-12

---

## Execution Notes for the Implementer

1. **Order matters for fixture consistency.** T-01 establishes the fixtures (FIXTURE_INTEL, FIXTURE_PROMPT, FIXTURE_SKILLS, FIXTURE_PERSONA). T-02..T-04 reuse them. T-09..T-10 may define their own scoped fixtures (test isolation).

2. **Stub vs real API for fast agent.** If `MINIMAX_API_KEY` is NOT set, T-07 fallback kicks in. The Verifier will check the `[fast-agent] MODE=real|stub` line. **Stub mode means "API not provisioned in this environment" — NOT "API works."** The Phase 7b tuning phase is the proper real-world gate.

3. **No scope creep into Phase 6b.** Phase 6a is measurement. Resist any temptation to add `intel` to `BuildOptions`, ship the `intel` table migration, or wire the fast agent module to `/augment`. Those are Phase 6b.

4. **On FAIL, the AD-006 entry is mandatory.** Do NOT skip the decision record. The whole point of the POC is to give Phase 6b a ceiling; failing to record the ceiling defeats the validation gate.

5. **Pre-grill checklist (PRD §16.7).** All 5 checkboxes are completed by T-04 (hot path) + T-08 (fast agent). The pre-grill checklist in `.specs/features/phase-6a-poc-validation/poc-results.md` should explicitly mark them done with the measurement values.

6. **Windows-specific child cleanup.** T-07 spawns the stub fast-agent as a child process. Use the Phase 5a.3 `killChild` pattern (`scripts/smoke-augment-server.mjs:203-219`) with `taskkill /F /T /PID` for Windows hard-kill. Verify no orphan process: `netstat -ano | findstr :472` shows no LISTENING after run.

---

## Cross-references

- [PRD.md §16, §16.2, §16.7](../../../PRD.md) — inception híbrida + POC checklist
- [PLAN.md](../../../PLAN.md) — Phase 6b reference (NOT this phase)
- [.scratch/memory-studio/spec.md §IMod-5](../../../.scratch/memory-studio/spec.md) — `Intel` shape literal
- [.specs/ROADMAP.md](../../ROADMAP.md) lines 698-742 — Phase 6a canonical scope
- [.specs/DISCOVERIES.md](../../DISCOVERIES.md) — AD-006 entry appended in T-11
- [Phase 5a.4 validation](../phase-5a-api-retrieval/validation-phase-5a.4.md) — perf harness model (T-12)
- [Phase 5b spec](../phase-5b-aux-endpoints/spec.md) — endpoint surface context
- [CLAUDE.md](../../../CLAUDE.md) ## Testing contract — gates, scope guard, atomic commit discipline
