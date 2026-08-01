---
date: 2026-08-01
version: 1
description: "Phase 6b — Fast Agent + Intel Pipeline spec. Implements inception híbrida: in-process MiniMax-M2.7-highspeed reads R_N parallel with human; Intel store in SQLite WAL; 2-block template extended with intel suffix; cache hit when persona stable. POC-verified budgets: hot path overhead < 10ms (0.07ms measured), fast agent < 3s (223ms stub). Mandatory per ROADMAP meta-convention #8."
explanation: |
  Phase 6b is the LARGEST phase yet (12-16h estimate per ROADMAP) — it
  ships the production wiring of inception híbrida that Phase 6a
  validated empirically. The architecture is NOVEL: a fast LLM
  reads the provider response in parallel with the human, extracts a
  3-field Intel literal, persists it in SQLite WAL, and Turn N+1
  augments with (intel + prompt + context + catalog). This enables
  cache hits on the Anthropic provider when the persona prefix is
  stable across turns (the architectural bonus of the 2-block
  cache_control layout shipped in Phase 5a.2).

  Four architectural decisions (AD-006) formalized in this spec:
  (1) BuildOptions.intel formalization at src/server/augment/augmenter.ts:51-70
  (2) Intel store SQLite schema migration 004_intel.sql with WAL mode + covering index
  (3) Fast agent module location at src/server/fast-agent/{client,writer}.ts
  (4) Default sync intel write with async batching fallback if measured > 1ms

  Why Phase 6b is mandatory (not a Phase 7 stretch): per ROADMAP
  meta-convention #8 + the Branch B collapse removed 2026-07-28, the
  inception híbrida is part of the MVP scope. PRD §10.1 item 12 +
  §14.7 + §16 anchor the decision. Phase 6a proved the ceilings;
  Phase 6b turns those ceilings into a production wired runtime.

  Latency trick rationale (PRD §16.2): the fast agent finishes in
  ~1s (highspeed variant tipicamente <1s), but the human reads R_N
  for 5-30s. Fast agent + human run in parallel — zero penalty
  perceived. Cache hit invariant (per AD-006 + this spec R-15):
  Block 1 (persona) is the stable prefix; Block 2 (intel + Skills)
  is the variable suffix. When both blocks are stable across two
  consecutive turns, Anthropic reports
  usage.cache_read_input_tokens > 0 on the second turn.

  Scope guard (extends Phase 6a): src/server/, src/catalog/,
  src/search/, packages/{sdk,ui}/ are NOT untouched anymore — this
  phase MODIFIES src/server/augment/* (BuildOptions.intel),
  src/catalog/index.ts (getIntel export), adds the new
  src/catalog/migrations/004_intel.sql, and creates a fresh
  src/server/fast-agent/ namespace. But MUST NOT touch
  src/search/**, src/social-detector/**, src/fingerprint/**,
  packages/sdk/**, packages/ui/**, CLAUDE.md.
related:
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md
  - ../phase-6a-poc-validation/{spec,design,tasks,poc-results}.md
  - ../phase-6a-poc-validation/validation-phase-6a.md
  - ../../../PRD.md (especially §16, §16.4, §16.5, §16.2, §14.7)
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../DISCOVERIES.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../architecture/memory-studio.architecture.json
  - ../../../src/server/{boot,index,augment/{pipeline,augmenter,byte-string,response,top-k,thresholds,retrieval}}.ts
  - ../../../src/catalog/{index,migrations/001_init,003_audit_events_ts_index}.{ts,sql}
  - ../../../src/search/{fts,rrf,vector,search,schema,types,errors}.ts
  - ../../../src/server/audit/{buffer,redact,writer,lifecycle,query,types,index}.ts
  - ../../../src/server/security/{tenant-hash,proxy-allowlist,index}.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../scripts/{stub-fast-agent,poc-6a-hot-path,poc-6a-fast-agent,poc-6a-byte-string,smoke-server-boot,smoke-augment-server,smoke-proxy-local-only}.mjs
  - ../../../test/augment/{perf,route-e2e,pipeline,byte-string-equality,byte-string-determinism,intel-schema,top-k,thresholds,retrieval,augmenter}.test.mjs
  - ../../../CLAUDE.md
---

# Phase 6b — Fast Agent + Intel Pipeline — Spec

**Phase:** 6b
**Slug:** `phase-6b-fast-agent-intel`
**Source:** `.specs/ROADMAP.md` lines 805-850 (Phase 6b entry)
**Branch:** `loop/phase-0`
**Baseline:** commit at end of Phase 6a (`84d70a1` per STATE.md Handoff — 578 tests: 391 root + 152 UI + 16 SDK + 19 POC)
**Goal:** ship production wiring of inception híbrida — in-process fast agent reads R_N in parallel with human, Intel store persists last-turn intel across restarts in SQLite WAL, 2-block template extended with intel suffix, cache hit when persona stable. Honor the POC-measured ceilings as hard budgets. **Mandatory per ROADMAP meta-convention #8 (Branch B removed 2026-07-28).**
**Estimate:** 12-16h (per ROADMAP; largest phase)

---

## Architectural Reference

> Farol nodes consumed by this spec (`.specs/architecture/memory-studio.architecture.json` — runtime-only farol per L-009 / `farol-runtime-only`). Meta-tools (tlc-roadmap-loop, auto-grill, archify, Planner/Implementer/Verifier) NEVER appear in the farol.

> **Módulo 3 — Hot Path (síncrono, p50<50ms):**
> - `server` — `@memory-studio/server` (Fastify, 7 endpoints). Phase 5a.1+5a.2+5b.1-5b.4 closed. Phase 6b wires the fast agent OVER the existing `/augment` pipeline. The route handler is unchanged (no new endpoint). The `/v1/messages` proxy (Phase 5b.4) ALSO triggers the fast agent when a real Anthropic response comes back — same code path, different caller.
> - `sdk` — `@memory-studio/sdk` (Phase 3). NOT touched in Phase 6b.

> **Módulo 4 — Pipeline (retrieval core):**
> - `augmenter` — Augmenter (byte-string · 2-block). Phase 5a.2. Phase 6b ADDS `intel?: Intel` to `BuildOptions` at `src/server/augment/augmenter.ts:51-70` (per AD-006 #1) and extends `buildVariableSuffix` (lines 114-135) to emit the `## Intel` section. **Block 1 (persona) unchanged** — cache hit invariant preserved.
> - `search` — Search (FTS5+vec+RRF D-006). REUSE-ONLY per CALIBRATION-RESIDUE.md + Phase 5 scope guard convention. Phase 6b does NOT modify. Intel IS the only NEW signal in the retrieval query — but it is NOT embedded; it lives in Block 2's text suffix only. The match script semantics = the existing prompt+context+catalog retrieval (per PRD §16.4 resolution #3 "match strategy: embedding pipeline existente").
> - `social-detector` — Social Detector. REUSE-ONLY. Phase 6b does NOT modify.
> - `cache` — Cache (SHA256). Phase 5a.2 primitives. Phase 6b reads `canonicalSha256()` to verify cache hit invariant (R-15).

> **Módulo 5 — Storage:**
> - `sqlite` — SQLite (catalog + audit + intel). Phase 1+5b.1 created `catalog`, `embeddings`, `audit_events`. Phase 6b adds the `intel` table via migration `004_intel.sql` (per AD-006 #2) with WAL mode + covering index `idx_intel_session_id`. The intel store lives in the SAME catalog DB (NOT a separate file) — schema co-location simplifies backup + portability.
> - `embed-model` — multilingual-e5-small ONNX 384d. NOT touched in Phase 6b.
> - `state-json` — `.memory-studio/state.json` (per-project). Phase 6b reads `fastAgent.model` from this file (configurable per ROADMAP Phase 6b done criterion).
> - `audit-buffer` — async+batch+fail-open (D-007). Phase 5b.1. Phase 6b MAY borrow the pattern for async intel write if measured > 1ms (per AD-006 #4). Default: sync write.

> **Edges built by Phase 6b (NEW):**
> - `augmenter → intel-store` — `buildVariableSuffix` reads intel via the `BuildOptions.intel` parameter (passed in by the pipeline)
> - `pipeline → intel-store` — `runAugment` reads intel from sqlite before Stage 4 (embed), passes to `buildSystemMessage` via `BuildOptions.intel`
> - `pipeline → fast-agent` — NEW: when a real response returns via `/v1/messages` OR `/augment`'s internal forward, the server schedules a fast-agent-over-response call (in-process, parallel with human's read)
> - `fast-agent → intel-store` — NEW: writer module persists the Intel literal to sqlite after fast agent returns (sync by default; async fallback)
> - `fast-agent → upstream-anthropic` — NEW: Anthropic SDK call to `https://api.minimax.io/anthropic` (`MiniMax-M2.7-highspeed` model, default `fastAgent.model = "MiniMax-M2.7-highspeed"`)
> - `fast-agent → stub-fast-agent` — NEW: Anthropic-compatible stub fallback (`scripts/stub-fast-agent.mjs` from Phase 6a T-05) when `MINIMAX_API_KEY` is unset

> **Edges NOT built by Phase 6b:**
> - Anything in `src/search/**` (REUSE-ONLY per CALIBRATION-RESIDUE.md)
> - Anything in `src/social-detector/**`, `src/fingerprint/**`, `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md`
> - Any new endpoint surface (Phase 5b closed the 7 endpoints; Phase 6b adds zero new routes)
> - Discovery signals + curator LLM (PRD §11 v3.2+)
> - Multi-tenant isolation (PRD §11 v4+)

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | Fast agent module lives at `src/server/fast-agent/{client,writer}.ts` (per AD-006 #3). The `client.ts` wraps the `@anthropic-ai/sdk` Anthropic-compatible client at `https://api.minimax.io/anthropic` with model `MiniMax-M2.7-highspeed`. The `writer.ts` encodes the `Intel` literal as the assistant text content + persists to the intel store. Module is in-process (NOT a daemon, NOT a sidecar) per PRD §16.4 resolution #1 | ROADMAP §6b done #1 + AD-006 #3 + PRD §16.4 #1 |
| **R-02** | Fast agent is configurable via `.memory-studio/state.json` `fastAgent.model` field. Default = `"MiniMax-M2.7-highspeed"`. When the env var `MINIMAX_API_KEY` is unset, the client falls back to a local stub (`scripts/stub-fast-agent.mjs` from Phase 6a T-05) marked `[STUB]` in every log line. The stub returns a deterministic `Intel` literal matching SPEC §IMod-5 shape after configurable `SIMULATED_LATENCY_MS` (default 200ms — within the highspeed < 1s range). Stub mode is a defensive fallback, NOT a permanent substitute (Phase 7b tuning re-measures with real API) | ROADMAP §6b done #1 + AD-006 #3 + Phase 6a A-2 |
| **R-03** | Intel schema is the SPEC §IMod-5 literal shape: `{ agentState: string, nextNeeds: string[], recentTopic: string }` (D-005). Empty values are GRACEFUL (e.g., `{ agentState: '', nextNeeds: [], recentTopic: '' }` parses OK and degrades to no-op — match pipeline does NOT crash). Writer output MUST round-trip via JSON.stringify → JSON.parse preserving shape (Phase 6a T-10 verified). Schema drift between writer (fast agent) and reader (match pipeline input) breaks inception silently — Phase 6b pins the shape via shared type at `src/server/fast-agent/intel-schema.ts` | PRD §16.5 + SPEC §IMod-5 + D-005 |
| **R-04** | **Intel store schema migration** ships at `src/catalog/migrations/004_intel.sql` (per AD-006 #2). The migration adds: (a) `intel` table with columns `session_id TEXT PRIMARY KEY, agent_state TEXT NOT NULL DEFAULT '', next_needs TEXT NOT NULL DEFAULT '[]', recent_topic TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL`; (b) `PRAGMA journal_mode=WAL` (so the main catalog DB becomes WAL-mode) — applied idempotently via `try { PRAGMA journal_mode=WAL } catch { ... ignore ... }` block; (c) `CREATE INDEX IF NOT EXISTS idx_intel_session_id ON intel(session_id)` covering index for the hot-path `WHERE session_id = ?` lookup (Phase 6a R-01 measured 0.02ms; budget < 5ms preserves 2 orders of magnitude headroom). Migration is forward-only (no DOWN); idempotency tested by running twice | ROADMAP §6b done #3 + AD-006 #2 + SPEC §IMod-5 + Phase 6a A-7 |
| **R-05** | **`src/catalog/index.ts` exposes a `getIntel(session_id: string): Intel | null` helper.** The helper opens (or reuses) the catalog DB, runs `SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?`, deserializes `next_needs` from JSON to `string[]`, and returns the Intel literal or `null` when no row exists. Hot-path budget < 5ms p95 (Phase 6a measured 0.02ms) | AD-006 #2 + Phase 6a R-01 |
| **R-06** | **`src/server/fast-agent/writer.ts` exposes `writeIntel(session_id: string, intel: Intel, db: Database): void`.** The helper runs `INSERT OR REPLACE INTO intel(session_id, agent_state, next_needs, recent_topic, ts) VALUES (?, ?, ?, ?, ?)`. TS wrapping uses `(new Date().getTime()) * 1000` for unix ms. Default = sync write. **Fallback trigger:** if measured write latency > 1ms (across 10 amostras), switch to async batching modeled on `src/server/audit/buffer.ts` (D-007 CRITICAL pattern: in-memory ring buffer + batch flush N=100 OR T=1000ms + fail-open + never block request) | AD-006 #4 + D-007 pattern |
| **R-07** | **BuildOptions.intel formalization at `src/server/augment/augmenter.ts:51-70`:** add `readonly intel?: Intel \| null` to the `BuildOptions` interface. Update `buildVariableSuffix` (lines 114-135) to emit a `## Intel` section in Block 2 — BEFORE the `## Skills` section when intel is non-null + non-empty. Format: `## Intel\nagentState: <text>\nnextNeeds: <list>\nrecentTopic: <text>` using `canonicalJsonStringify(intel)` for the values (preserves D-006 byte-string determinism). When intel is null or empty, the `## Intel` section is OMITTED (no empty header) | AD-006 #1 + Phase 6a R-03 + R-07 |
| **R-08** | **Byte-string determinism with intel suffix:** adding intel to Block 2 must NOT perturb Block 1's cache prefix. The 2-block structure remains: Block 1 = persona text, Block 2 = intel + Skills + Rules + context. SHA-256 of the canonical JSON serialization stays stable across 2 requests with identical inputs (same persona + same intel + same Skills ativas) — Phase 6a T-09 verified 10/10 of this | PRD §8 invariante 11 + D-006 + Phase 6a AC-5 |
| **R-09** | **Match script semantics:** Intel acts as **post-retrieval injection** (NOT query expansion). The match pipeline at `/augment` runs the existing prompt+context+catalog retrieval unchanged (Stage 4-7 of `runAugment`). Intel is injected ONLY into Block 2's suffix as additional context the LLM sees — it does NOT influence the embedding query, the FTS query, the thresholds, the top-K, or the tiebreak. This keeps D-006 byte-string determinism intact (RRF ties are still resolved by id.localeCompare) and avoids mutating `src/search/**` (CALIBRATION-RESIDUE + Phase 5 scope guard) | PRD §16.4 #3 + CALIBRATION-RESIDUE.md + Phase 6a A-3 |
| **R-10** | **Suffix injection order in Block 2:** intel FIRST (immediately after Block 1 boundary), THEN `## Skills`, THEN `## Rules`, THEN `## Context`, THEN `## Warnings`. Rationale: anthropic reads blocks top-down; intel is the most-recent signal, so putting it at the top of the variable suffix maximizes the prompt-cache key stability window when only Skills/Rules shift. The order matches Phase 6a POC `buildSystemMessageWithIntel()` helper contract | Phase 6a design.md §4.1 + R-03 + R-07 |
| **R-11** | **Fast agent call site:** when a real provider response returns via `/v1/messages` (Phase 5b.4 proxy) OR when `/augment` is called as the FIRST request of a session (Turn N — cold start), the server schedules a fast-agent-over-response call. The call passes `request.prompt` + `R_N` text + `request.context` as the user message; receives an `Intel` literal back. Scheduling is `setImmediate()` (NOT await) — the response (with the augmented system message already produced for THIS turn) returns to the client immediately. The intel arrives and is persisted BEFORE the next turn completes | PRD §3 flujo Turn N vs N+1 + §16.4 #1 |
| **R-12** | **Per-request latency budget (derived from Phase 6a POC, AD-006 — non-negotiable ceilings):** `sqlite.get(intel) < 5ms p95`, `concat < 1ms p95`, `template render < 1ms p95`, **TOTAL inception hot path overhead < 10ms p95**, fast agent latency `< 3s p95`. Phase 6b's production wiring MUST honor these as ceilings. If any budget is exceeded, the human decides to optimize (not to add a fallback) per PRD §16.7 rule | AD-006 + Phase 6a POC results §5 + PRD §16.7 |
| **R-13** | **Existing test baseline preservation:** the 578-test baseline (391 root + 152 UI + 16 SDK + 19 POC from Phase 6a closure at `84d70a1`) is preserved. New tests live at `test/server/fast-agent/*.test.mjs` and `test/augment/intel-injection.test.mjs`. The 19 POC tests at `test/poc/**.test.mjs` continue to pass without modification (Phase 6a is READ-ONLY territory outside its scope) | CLAUDE.md testing contract + Phase 6a A-1 + Phase 6a R-15 |
| **R-14** | **Scope guard (extends Phase 6a):** `git diff <phase-6a-baseline>..HEAD -- src/search/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty after Phase 6b closes. Phase 6b MAY add new files under `src/server/fast-agent/**`, new migration `src/catalog/migrations/004_intel.sql`, and modify `src/server/augment/{augmenter,pipeline}.ts` + `src/catalog/index.ts` + `package.json` (if `MINIMAX_API_KEY` env var wiring is added) | Phase 5 scope guard convention + CALIBRATION-RESIDUE.md + Phase 6a R-14 |
| **R-15** | **Cache hit invariant (production verification):** 2 turns with same persona + different prompts MUST produce `usage.cache_read_input_tokens > 0` on the 2nd turn when invoked via the `/v1/messages` proxy. Verified by an integration test that (a) sends Turn 1 with prompt A and persona X, (b) waits for the augmented response + the async fast-agent write, (c) sends Turn 2 with prompt B and persona X, (d) asserts `usage.cache_read_input_tokens > 0` from the upstream response (captured by the proxy per Phase 5b.4). Persona X = fixed `persona-senior-engineer` from fixture corpus | PRD §10.1 item 5 + PRD §8 invariante 11 + SPEC §IMod-9 |
| **R-16** | **Latency trick validation protocol:** a measurement harness scripts `scripts/smoke-latency-trick.mjs` measures: (a) fast-agent wall-clock latency from request start to intel persisted (10 amostras, p95 < 3s budget); (b) parallel human-read simulation with `setTimeout(() => console.log('human done'), 5000)` (5-30s human budget); (c) assert: `fastAgentLatency.p95 < 5000` (the 5s minimum human-read floor). The harness ALSO verifies the increment doesn't block the `/augment` response (response latency stays at the Phase 5a.4 baseline ~1.91ms median) | PRD §16.2 + §16.7 |
| **R-17** | **Fast agent model configurability:** the model is loaded at server boot from `.memory-studio/state.json` `fastAgent.model` field. Default = `"MiniMax-M2.7-highspeed"` (NOT "Haiku-class" — a concrete model per ROADMAP done #9). Changing the model requires a server restart. Invalid model → server boot continues with default + stderr warning (NOT a crash). Configuration is single-process, single-tenant (per PRD §11 multi-tenant is v4+) | ROADMAP §6b done #9 + PRD §14.4 |
| **R-18** | **Writer-reader contract validation:** an automated test `test/server/fast-agent/writer-reader-contract.test.mjs` serializes an Intel literal from the writer (via `writeIntel()` helper with a real `:memory:` SQLite), then deserializes via `getIntel()`, and asserts the round-trip preserves shape. Empty values (graceful degradation per D-005): `{ agentState: '', nextNeeds: [], recentTopic: '' }` → stored → read → unchanged. Type drift between writer output and reader schema → test FAILS | SPEC §IMod-5 + D-005 + Phase 6a T-10 |
| **R-19** | **No new heavy dependencies.** `@anthropic-ai/sdk` (already in `package.json` from Phase 5b.4) is the only new transitive. No retry libs, no circuit breakers, no telemetry libs. Any third call to `npm install <new-pkg>` is BLOCKED unless justified in `design.md` and approved | Phase 5b contract + CLAUDE.md testing contract + REUSE-ONLY principle |
| **R-20** | **In-process spawn pattern (NOT a daemon):** fast-agent-over-response is a `setImmediate`-scheduled call inside the same Node process as the `/augment` handler. No separate process, no Unix socket, no child process. The Anthropic SDK call is `await client.messages.create({...})` inside the scheduled microtask. This keeps cache hit invariant + zero extra service to manage (per PRD §16.4 #1) | PRD §16.4 #1 + PRD §3 |
| **R-21** | **Determinism preserved across server restart:** when the server is restarted, the intel store retains the last-turn intel (WAL mode persists to disk). On first request after restart, `getIntel(prevSessionId)` returns the persisted literal (NOT a fresh empty). This satisfies ROADMAP done #3 ("restart do server preserva intel do último turn") | ROADMAP §6b done #3 |
| **R-22** | **Phase 6a POC tests still pass:** the 19 POC tests at `test/poc/{byte-string-equality,intel-schema,stub-fast-agent}.test.mjs` continue to pass without modification. They are the regression gate for the byte-string determinism + Intel schema D-005 hardening | Phase 6a R-15 + Phase 6a T-09..T-10 |
| **R-23** | **AC-7 prev-CLI-style intel flow test (integration):** an in-process integration test `test/augment/inception-e2e.test.mjs` POSTs 2 consecutive `/augment` requests to a server that has been pre-loaded with an Intel literal for the session. Asserts: (a) the first response's `systemMessage` is the same byte-string as `buildSystemMessage` computed by the test (intel incorporated as `## Intel` section); (b) the second response uses the same intel (since session_id is the same). Per the byte-string equality test pattern from Phase 6a T-09 | PRD §14.7 + Phase 6a AC-5 |

### Out of scope (explicit non-goals)

- **Anything in `src/search/**`** — REUSE-ONLY per CALIBRATION-RESIDUE.md (Phase 6b intel is post-retrieval injection, NOT query expansion)
- **Anything in `src/social-detector/**`, `src/fingerprint/**`, `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md`** — untouched per Phase 5 scope guard
- **New endpoints** — Phase 5b closed the 7 endpoints; Phase 6b adds zero new routes
- **Multi-tenant** — v4+ per PRD §11
- **Adapter OpenAI↔Anthropic** — v3.1+ per PRD §11
- **Discovery signals + curator LLM** — v3.2+ per PRD §11
- **Phase 7b tuning** (real-API re-measurement) — Phase 7 ships `Phase 7b` after Phase 6b; Phase 6b's stub fallback is defensive
- **Long-term memory of user preferences** — v4+ separate schema
- **Cross-project catalog registry** — v4+
- **Semantic cache 2-tier** (fingerprint over augmented) — v3.1+ per PRD §17.1
- **Per-turn feedback vote persistent** — v3.1+
- **Attention tiers / relevance-decay / tier escalation** — v3.1+

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `src/catalog/migrations/004_intel.sql` applies cleanly to a fresh `:memory:` SQLite DB (via `applyMigrations` runner from `src/catalog/migrations/runner.ts`). After apply: `intel` table exists with the 5-column schema from R-04; `idx_intel_session_id` covering index exists; `PRAGMA journal_mode=WAL` reports `wal`. Migration applied twice → no error (idempotent). Verified by `test/catalog/migrations.test.mjs` extension + live `:memory:` test | R-04 |
| **AC-2** | `src/catalog/index.ts` exports `getIntel(session_id: string): Intel \| null`. Calling with an existing `session_id` returns the persisted Intel. Calling with an unknown `session_id` returns `null` (NOT throws). Verified by `test/catalog/intel-store.test.mjs` — 4+ cases | R-05 |
| **AC-3** | `src/server/fast-agent/intel-schema.ts` exports the `Intel` type (matching SPEC §IMod-5 shape literal) + a Zod schema `IntelSchema` for runtime validation. The Zod schema accepts `{ agentState: '', nextNeeds: [], recentTopic: '' }` as VALID (graceful degradation). Verified by `test/server/fast-agent/intel-schema-contract.test.mjs` — 6+ cases (Phase 6a T-10 pattern) | R-03 + SPEC §IMod-5 + D-005 |
| **AC-4** | `src/server/fast-agent/client.ts` exposes `callFastAgent(rNText: string, context: Context \| null, model: string): Promise<Intel>`. When `MINIMAX_API_KEY` is unset, the call routes to the local stub from `scripts/stub-fast-agent.mjs` (Phase 6a T-05). Stub output marked `[STUB]` in every log line. The function returns an `Intel` literal that parses via the `IntelSchema`. Latency (stub) ≤ 500ms (within highspeed < 1s range with `SIMULATED_LATENCY_MS=200` + ~20ms loopback). Verified by `test/server/fast-agent/client.test.mjs` — 4+ cases | R-01 + R-02 |
| **AC-5** | `src/server/fast-agent/writer.ts` exposes `writeIntel(session_id: string, intel: Intel, db: Database): void`. Default mode = sync write. Verified sync latency ≤ 1ms p95 (10 amostras with seeded db). When the measured write p95 > 1ms across 10 amostras, the writer logs a one-time warning recommending the D-007 async batching fallback (NOT auto-switch). Verified by `test/server/fast-agent/writer-perf.test.mjs` — 10 amostras + 5 warmup | R-06 |
| **AC-6** | Writer-reader contract end-to-end (R-18): an `Intel` literal written via `writeIntel()` is read back via `getIntel()` with the SAME shape (string equality for `agentState` + `recentTopic`, deep equality for `nextNeeds[]`). Empty values round-trip unchanged. Type drift (e.g., `nextNeeds: 'not-array'`) → write fails with schema error (defensive — IntelSchema is the SOLE shape validator). Verified by `test/server/fast-agent/writer-reader-contract.test.mjs` — 5+ cases | R-18 + R-03 |
| **AC-7** | **BuildOptions.intel formalization:** `src/server/augment/augmenter.ts:51-70` declares `readonly intel?: Intel \| null`. Calling `buildSystemMessage(req, { matched, context, warnings, intel: <IntelLiteral> })` produces a 2-block system message where Block 2 contains `## Intel\n<agentState>\n<nextNeeds joined as \n>\n<recentTopic>` (preceded by `## Skills` in the suffix when skills are matched; the `## Intel` section is the FIRST one after Block 1 boundary). When `intel` is null/undefined/empty, the `## Intel` section is OMITTED (no empty header). Verified by `test/augment/augmenter-intel.test.mjs` — 6+ cases (extending Phase 5a `augmenter.test.mjs` pattern) | R-07 + R-10 |
| **AC-8** | **Byte-string determinism with intel suffix (extending Phase 6a T-09):** 2 requests with identical (persona + intel + Skills ativas) produce identical 64-char SHA-256 hex digests of the system message. Different intel → different SHA. Empty intel + same persona + same Skills → same SHA as the no-intel baseline (proves the intel section is conditional + preserves the byte-string when no intel). Verified by `test/augment/intel-injection.test.mjs` — 5+ cases | R-08 + D-006 |
| **AC-9** | **Pipeline integration:** `src/server/augment/pipeline.ts` `runAugment()` calls `getIntel(request.context.sessionId ?? legacySessionId)` BEFORE Stage 4 (embed) and passes the result via `BuildOptions.intel` to `buildSystemMessage`. The intel read adds ≤ 5ms (p95 budget, Phase 6a POC measured 0.02ms). When `getIntel` returns `null`, `BuildOptions.intel` is `null` (no `## Intel` section). Verified by `test/augment/pipeline-intel.test.mjs` — 3+ cases (in-process Fastify inject, no real DB) | R-05 + R-09 |
| **AC-10** | **Fast-agent-over-response scheduling:** an integration test sends a `/v1/messages` request through the Phase 5b.4 proxy with a stub upstream provider that returns a fixed `R_N` text. The test asserts (a) `/v1/messages` returns 200 with the stub response; (b) within 5s after the response, the intel store contains an entry for `request.fingerprint.sessionId` matching SPEC §IMod-5 (via direct SQLite query). The intel-write happens async via `setImmediate` — the `/v1/messages` response latency is unaffected (Phase 5b.4 baseline preserved). Verified by `test/augment/fast-agent-scheduling.test.mjs` — 3+ cases | R-11 + R-20 |
| **AC-11** | **Cache hit invariant (AC-15 from ROADMAP):** an integration test sends 2 consecutive `/v1/messages` requests with the same `persona` + same `sessionId` + different `prompt`. After the test waits for the intel write (max 5s), the 2nd request is forwarded to the stub provider. The stub provider is configured to report `usage.cache_read_input_tokens: 42` on the 2nd call (when the system message SHA matches the previous turn's). The test asserts `response.usage.cache_read_input_tokens === 42`. **NOTE:** Real Anthropic cache hit requires (a) Anthropic's `cache_control: ephemeral` matching the prefix, (b) within TTL (5min). The stub verifies the FLOW; real cache hit is Phase 7b. Verified by `test/augment/inception-cache-hit.test.mjs` — 3+ cases | R-15 + ROADMAP §6b done #8 |
| **AC-12** | **Inception hot path overhead < 10ms (PRIMARY, non-negotiable):** the same `scripts/poc-6a-hot-path.mjs` from Phase 6a, executed AFTER Phase 6b's production wiring, reports `total-overhead < 10ms` (sqlite.get(intel) p95 + concat p95 + template render p95). Measured with 10 amostras + 5 warmup. **The Implementer must re-run the POC at end-of-phase and report numbers — NOT just trust unit tests.** POC result doc updated at `.specs/features/phase-6b-fast-agent-intel/poc-results-6b.md`. Verified by re-running the POC script end-to-end | R-12 + AD-006 + PRD §16.7 |
| **AC-13** | **Latency trick validated end-to-end:** `scripts/smoke-latency-trick.mjs` boots the augment server with the stub fast-agent (no API key), sends a `/v1/messages` request, measures (a) the `/v1/messages` response latency (must stay at the Phase 5b.4 baseline ~5-10ms median), (b) the wall-clock from request start to intel persisted (p95 ≤ 3s budget), (c) parallel "human read" simulated with `await new Promise(r => setTimeout(r, 5000))`. Asserts `fastAgentLatency.p95 < 5000` (strictly less than the 5s human floor) | R-16 + PRD §16.2 |
| **AC-14** | **Server restart preserves intel (R-21):** an integration test writes intel via `writeIntel()`, restarts the in-memory SQLite (close + reopen the DB handle, mirroring a process restart for the file-backed catalog), then reads via `getIntel()` and asserts the literal is unchanged. Verified by `test/catalog/intel-restart.test.mjs` — 3+ cases | R-21 |
| **AC-15** | **`MINIMAX_API_KEY` env var wiring:** `boot.ts` (or wherever the fast-agent client is constructed) reads `process.env.MINIMAX_API_KEY` at startup. When set, the client uses the real Anthropic-compatible API at `https://api.minimax.io/anthropic`. When unset, the client routes to the local stub. The MODE is logged at boot: `[fast-agent] MODE=real|stub endpoint=<url> model=MiniMax-M2.7-highspeed`. Verified by `test/server/fast-agent/client-mode.test.mjs` — 2+ cases (real/stub paths) | R-02 + R-17 |
| **AC-16** | **Fast agent model configurability (R-17):** a test loads `.memory-studio/state.json` with `fastAgent.model = "MiniMax-M2.7-highspeed-fast"` (a hypothetical alternative) and asserts the client uses that model string in its SDK call. When the file is missing or the field is absent, the default `"MiniMax-M2.7-highspeed"` is used. Invalid model string → stub fallback (NOT crash), with stderr warning. Verified by `test/server/fast-agent/model-config.test.mjs` — 3+ cases | R-17 |
| **AC-17** | **Existing test baseline preserved:** `npm test` at repo root reports ≥578 tests passing (391 root + 152 UI + 16 SDK + 19 POC from Phase 6a closure at `84d70a1`). New tests in `test/server/fast-agent/**.test.mjs` + `test/augment/{augmenter-intel,intel-injection,pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` + `test/catalog/{intel-store,intel-restart}.test.mjs` ADD to the count | R-13 |
| **AC-18** | **Scope guard:** `git diff <phase-6a-baseline>..HEAD -- src/search/ src/social-detector/ src/fingerprint/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty. New code lives in `src/server/fast-agent/**` (new dir) + `src/server/augment/{augmenter,pipeline}.ts` (modify) + `src/catalog/index.ts` (modify) + `src/catalog/migrations/004_intel.sql` (new file). The `package.json` MAY gain `@anthropic-ai/sdk` if not already installed (Phase 5b.4 added it; Phase 6b verifies install status) | R-14 + R-19 |
| **AC-19** | `npm run typecheck` exits 0 with no new errors. Phase 6b TS files use `strict` + `noUncheckedIndexedAccess` matching the Phase 1 baseline. The new `Intel` type is exported from both `src/server/fast-agent/intel-schema.ts` (owner) AND re-exported from `src/server/augment/augmenter.ts` for BuildOptions convenience | R-14 |
| **AC-20** | **No new heavy npm dependencies** beyond `@anthropic-ai/sdk` (which is already in `package.json` from Phase 5b.4). `npm ls @anthropic-ai/sdk` returns a single resolved version. No retry libs, no telemetry libs, no circuit breakers | R-19 |
| **AC-21** | **Writer-reader graceful degradation (D-005, R-03):** an `Intel` literal with empty `agentState: ''`, empty `nextNeeds: []`, empty `recentTopic: ''` (writer's "no intel extracted" output) is stored and read back unchanged. `buildSystemMessage` with this empty intel produces a byte-string identical to the no-intel baseline (the `## Intel` section is OMITTED). Verified by `test/server/fast-agent/empty-intel.test.mjs` — 3+ cases | R-03 + SPEC §IMod-5 |
| **AC-22** | **AC-23 Phase 6a POC tests still pass** — explicitly: `node --test test/poc/byte-string-equality.test.mjs` passes (4 cases), `node --test test/poc/intel-schema.test.mjs` passes (6 cases), `node --test test/poc/stub-fast-agent.test.mjs` passes (9 cases), `node --test test/poc/byte-string-determinism.test.mjs` passes (if Phase 6a added it). Total = 19 POC tests preserved | R-22 |
| **AC-23** | **E2E inception smoke (`scripts/smoke-inception-e2e.mjs`):** the script boots the augment server on a free port, sends 2 consecutive `/v1/messages` requests with the same `persona` + different prompts, waits up to 5s for the intel write, then queries the intel store directly via `:memory:` test DB to confirm the write. Asserts (a) both requests return 200, (b) the stub provider's `usage.cache_read_input_tokens` is reported on the 2nd request when the system message SHA matches the 1st, (c) the intel store contains the entry. Exits 0 with `[inception-e2e] PASS (N/N checks)` | R-15 + R-11 |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: Intel store location** | Reuse the existing catalog SQLite DB (the same file the `audit_events` table lives in). New table via migration `004_intel.sql`. **NOT a separate `intel.sqlite` file.** | Co-location simplifies backup + portable schema migration. Phase 6a POC measured `sqlite.get(intel)` at 0.02ms — same-DB is faster than a cross-file read (no open/close). Index `idx_intel_session_id` covers the hot path | yes (autonomous; faster + simpler) |
| **A-2: BuildOptions.intel placement** | Single new field `readonly intel?: Intel \| null` at line ~52 of `src/server/augment/augmenter.ts` (within the existing `BuildOptions` interface). Empty / null / undefined are all treated identically (intel section omitted) | Minimal change. Phase 6a spec design already fixed the field name + type (AD-006 #1). Re-export `Intel` type from `intel-schema.ts` for BuildOptions convenience | yes (AD-006 #1) |
| **A-3: Suffix injection order** | `## Intel` is the FIRST section in Block 2, immediately after Block 1 boundary. Then `## Skills`, `## Rules`, `## Context`, `## Warnings` (the existing Phase 5a.2 order) | Anthropic reads blocks top-down; intel is the most-recent turn signal. Top placement maximizes the cache-key stability window when only Skills/Rules shift. Matches Phase 6a POC `buildSystemMessageWithIntel()` helper contract (Phase 6a design.md §4.1) | yes (Phase 6a design choice) |
| **A-4: Match script semantics** | Intel is **POST-retrieval injection**, NOT query expansion. The match pipeline runs the existing prompt+context+catalog retrieval unchanged (Phase 5a.2 Stage 4-7). Intel is injected ONLY into Block 2's suffix text | Keeps D-006 byte-string determinism intact (RRF ties still resolved by id.localeCompare). Avoids mutating `src/search/**` (CALIBRATION-RESIDUE + Phase 5 scope guard). PRD §16.4 resolution #3 explicit: "match strategy: embedding pipeline existente" | yes (PRD §16.4 #3 explicit) |
| **A-5: Async vs sync intel write — default** | **Sync write** by default. Phase 6a POC measured sqlite.insert overhead equivalent to read = 0.02ms — well under the 1ms fallback trigger. The async pattern (D-007 audit buffer) is the FALLBACK if measured > 1ms | Matches AD-006 #4 verbatim ("POC assumes sync"). One new module (`writer.ts`) instead of two (`writer.ts` + `buffer.ts`). Phase 6a POC measured negligible write overhead | yes (AD-006 #4) |
| **A-6: Async vs sync intel write — fallback trigger** | If `test/server/fast-agent/writer-perf.test.mjs` reports `writer.p95 > 1ms` across 10 amostras with seeded catalog, the Implementer MUST add the async batching fallback (mirror `src/server/audit/buffer.ts`). The fallback is documented but NOT auto-activated. A finding goes into the validation report. **NOT a regression — a documented optimization.** | D-007 CRITICAL lesson: async is the safe fallback when sync overhead exceeds the budget. Manual approval keeps the architecture explicit | yes (D-007 pattern) |
| **A-7: Fast agent module location** | `src/server/fast-agent/{client,writer,intel-schema}.ts` per AD-006 #3. Single dir under `src/server/` | Mirrors Phase 5a's `src/server/augment/` pattern. Reuses `byte-string.ts`'s `canonicalJsonStringify` for intel serialization | yes (AD-006 #3) |
| **A-8: Fast agent — in-process call pattern** | `setImmediate(() => { callFastAgent(...).then(intel => writeIntel(...)) })` scheduled from `/v1/messages` proxy response OR `/augment` first-responder. NOT awaited. NOT a daemon. NOT a sidecar | PRD §16.4 #1 explicit. Single Node process. Zero extra service to manage | yes (PRD §16.4 #1) |
| **A-9: Fast agent model default** | `"MiniMax-M2.7-highspeed"` from `.memory-studio/state.json` `fastAgent.model` (default literal in fixture state.json — Phase 4.1 ships a default). NOT "Haiku-class" — a concrete model per ROADMAP done #9 | Matches `PRD §17.2 glossary` + `SPEC §IMod-2` nomenclature. v4+ may add model rotation | yes (ROADMAP done #9) |
| **A-10: Intel schema type validation** | Zod schema `IntelSchema` at `src/server/fast-agent/intel-schema.ts`. The Zod schema is the SOLE shape validator (writer + reader both call it). Type drift fails loudly via `parse()` throwing, NOT via silent crash | Zod is already in `package.json` (Phase 1 + Phase 5a). Single source of truth. Matches Phase 5a R-24 (`FingerprintSchema` pattern) | yes (autonomous; Zod reuse) |
| **A-11: Subchapter breakdown** | **YES — 4 subchapters** (6b.1 Intel Store Foundation, 6b.2 Fast Agent Module, 6b.3 BuildOptions.intel + Suffix Injection, 6b.4 Pipeline Integration + Cache Hit Validation). 16-20 atomic tasks across 4 subchapters. **This is the LARGEST phase yet** — dispatch SUBCHAPTER_BREAKDOWN trigger | The 4 architectural decisions (AD-006) + the 4 modules (intel-schema, client, writer, augmenter integration) + the end-to-end cache hit test (R-15) + the inception E2E smoke (AC-23) = 16-20 tasks naturally. Phase 5a precedent: 4 subchapters for 13 tasks. Phase 5b: 4 subchapters for 14 tasks. Phase 6b = 4 subchapters for 16-20 tasks | yes (autonomous; SUBCHAPTER_BREAKDOWN trigger) |
| **A-12: Implementation batches** | **3 Implementer batches** (Phase 6a's 11 tasks fit 1 batch; Phase 6b is larger at 16-20). Batch boundaries at subchapter seams: Batch 1 = 6b.1 + 6b.2 (T-01..T-08) = 8 tasks; Batch 2 = 6b.3 (T-09..T-12) = 4 tasks; Batch 3 = 6b.4 (T-13..T-16) = 4-6 tasks. Single Verifier at end | 8 + 4 + 4-6 = 16-18 tasks. Fits the 7-task-per-worker budget generously. Whole Phase 6b = 3 Implementer batches + 1 Verifier | yes (autonomous; standard packing) |
| **A-13: Tests location** | `test/server/fast-agent/**.test.mjs` for the new fast-agent module tests. `test/augment/{augmenter-intel,intel-injection,pipeline-intel,fast-agent-scheduling,inception-cache-hit,inception-e2e}.test.mjs` for the pipeline/cache-hit integration. `test/catalog/{intel-store,intel-restart,migrations-004}.test.mjs` for the intel store + migration tests. `scripts/smoke-{latency-trick,inception-e2e}.mjs` for the end-to-end smoke. New tests ADD to the 578 baseline — no replacements | Phase 5a/5b `test/augment/**` + `test/server/**` + `scripts/smoke-*.mjs` patterns. Mirrors Phase 5b task distribution | yes (autonomous; matches Phase 5a/5b layout) |
| **A-14: Block 1 stability guarantee** | The `## Intel` section lives ONLY in Block 2. Block 1 (persona) is NEVER modified by intel changes. The cache hit invariant holds ONLY when Block 1 is stable across turns | PRD §8 invariante 11 + SPEC §IMod-7. Phase 6a R-03 verified the 2-block structure; Phase 6b R-08 + AC-8 extend the verification to include intel | yes (PRD explicit) |
| **A-15: Cache hit test fixture provider** | Use a local stub provider that simulates Anthropic's response format. The stub reports `usage.cache_read_input_tokens: 42` when the incoming `system` message SHA-256 matches the previous turn's (proves the FLOW works). **Real Anthropic cache hit is Phase 7b's measurement target.** This is consistent with Phase 6a T-09 (which used 2 identical inputs as a byte-string equality proxy, not a real cache hit) | Real Anthropic cache metrics require (a) valid `cache_control: ephemeral` markers, (b) within TTL (5min), (c) Anthropic API access (NOT guaranteed per CLAUDE.md context). Phase 6b's stub proves the FLOW; Phase 7b tunes the REAL cache behavior | yes (autonomous; stub mirrors Phase 5b.4 / Phase 6a stub patterns) |
| **A-16: Fast agent error handling** | If the fast-agent call fails (network error, schema validation error, timeout), the next turn's request still returns 200 with empty intel (graceful degradation). The error is logged to stderr. Failed fast-agent calls NEVER block the `/augment` response (fire-and-forget) | Mirrors D-007 CRITICAL fail-open semantics. PRD §2 fail-open principle. Phase 5a.2 R-14 fail-open precedent | yes (PRD explicit) |
| **A-17: Determinism of fast agent** | The stub (`scripts/stub-fast-agent.mjs`) returns a DETERMINISTIC `Intel` literal (same input → same output byte-for-byte). This is required for the byte-string determinism + cache hit tests to be reproducible. **Real API determinism is NOT guaranteed** — Phase 7b will measure; Phase 6b only verifies the WIRING | Spec §IMod-2 + Phase 6a A-10. The stub is the unit-tested ground truth | yes (Phase 6a pattern) |
| **A-18: Session ID for intel key** | Intel is keyed by `request.context.sessionId ?? request.fingerprint.sessionId` (Phase 3 SDK hashes sessionId before sending per `SPEC §IMod-2 IMod-13`). The KEY is the hashed 16-hex-char form, not the raw UUID. This preserves privacy (PRD §10.3.2) | Phase 3 SDK contract. The same hashed sessionId reaches the audit log (`tenantId_hashed`) per Phase 5b.1 R-20 | yes (Phase 3 + Phase 5b.1 contract) |
| **A-19: WAL pragma handling** | `PRAGMA journal_mode=WAL` is idempotent in SQLite (returns the current mode on re-apply). Phase 6b's migration includes it as `journal_mode=WAL` PRAGMA after the `CREATE TABLE` statements. If WAL is already enabled (Phase 5b.1 may have set it for `audit_events`), the PRAGMA returns `wal` either way. Verified by `test/catalog/migrations-004.test.mjs` | SQLite PRAGMA semantics. Idempotency is a SQLite guarantee. The 1.91ms median Phase 5a.4 baseline already had WAL active for `audit_events` | yes (SQLite semantics) |
| **A-20: No regression to Phase 5a/5b test suites** | All 477 Phase 5a/5b tests + 19 Phase 6a tests continue to pass. The 41 POC tests at `test/poc/**.test.mjs` are explicitly preserved. Verifier confirms via `npm test` (must report ≥578 + Phase 6b new) | Phase 5a/b contract + Phase 6a R-15 | yes (autonomous; baseline preservation) |

**Open questions:** none — all 20 assumptions are explicit defaults grounded in AD-006 + SPEC §IMod-5 + Phase 5a/b patterns. The Phase 6b Planner resolves A-6 (async fallback) at validation time based on actual measurements, not at planning time.

---

## Files Referenced (absolute paths)

- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\boot.ts` — Fastify bootstrap (Phase 5a.1, MINIMAX_API_KEY env var wiring)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\index.ts` — server index (Phase 5a.1, `createServer` + `resetServerMetadataForTests`)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\pipeline.ts` — pipeline orchestrator (Phase 5a.2; Phase 6b adds intel injection before Stage 4)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\augmenter.ts` — `buildSystemMessage()` 2-block builder (Phase 5a.2; Phase 6b adds `intel?: Intel` to BuildOptions at line ~52 + emits `## Intel` section in `buildVariableSuffix` at line ~114)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\byte-string.ts` — `canonicalSha256()` primitives (Phase 5a.2; Phase 6b reuses for intel serialization)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\catalog\index.ts` — barrel (Phase 1.3; Phase 6b exports `getIntel` + intel type)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\catalog\migrations\runner.ts` — versioned migration runner (Phase 1.2; Phase 6b adds `004_intel.sql` to the runner's known migrations)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\catalog\migrations\001_init.sql` — original schema (Phase 1.2)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\catalog\migrations\003_audit_events_ts_index.sql` — index migration (Phase 5b.1; Phase 6b's `004_intel.sql` follows the same pattern)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\audit\buffer.ts` — D-007 async batching pattern (Phase 5b.1; Phase 6b MAY mirror this if writer sync latency exceeds 1ms)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\scripts\stub-fast-agent.mjs` — Anthropic-compatible stub (Phase 6a T-05; Phase 6b reuses as defensive fallback when MINIMAX_API_KEY is unset)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\scripts\poc-6a-hot-path.mjs` — hot-path POC (Phase 6a T-01..T-04; Phase 6b AC-12 re-runs it for the 10ms budget verification)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\augment\perf.test.mjs` — Phase 5a.4 perf harness (model for R-08/R-12 validation)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\ROADMAP.md` lines 805-850 — Phase 6b canonical scope
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\PRD.md` §3, §10.1 item 12, §14.7, §16, §16.2, §16.4, §16.5, §16.7 — inception híbrida + POC checklist + engineering decisions
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.scratch\memory-studio\spec.md` §IMod-5 — `Intel` shape (D-005)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\DISCOVERIES.md` — AD-006 4 architectural decisions
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\features\phase-6a-poc-validation\{spec,design,tasks,poc-results}.md` — POC artifacts and ceiling derivations
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\CLAUDE.md` `## Testing contract` — gates, scope guard, atomic commit discipline
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.memory-studio\state.json` — `fastAgent.model` configurability (default fixture from Phase 4.1)
