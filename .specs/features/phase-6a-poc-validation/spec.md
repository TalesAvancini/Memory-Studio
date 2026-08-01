---
date: 2026-08-01
version: 1
description: "Phase 6a — POC Validation (hot path + fast agent) spec. Validates inception híbrida architecture before Phase 6b implementation: hot path overhead <10ms (p95), fast agent (MiniMax-M2.7-highspeed) <3s, byte-string determinism with template. 10 amostras each, targets medidos não estimados."
explanation: |
  Phase 6a is the validation gate per ROADMAP meta-convention #8 (Phase 6
  mandatório, Phase 6a = validation empírica antes de Phase 6b implementation).
  Branch B removed 2026-07-28 — Phase 6b is mandatory, but the architecture
  MUST be validated empirically before any production wiring.

  Why this phase exists (and what it actually validates):
  Phase 6b introduces THREE novel pieces stacked on top of the existing
  hot path: (a) an intel SQLite read (`sqlite.get(intel)`) per Turn N+1,
  (b) fast-agent-over-response (default `MiniMax-M2.7-highspeed`, in-process,
  reads `R_N` in parallel with the human), and (c) a suffix-injection template
  with 2 blocks `cache_control: ephemeral` that incorporates intel. Each
  one is a synchronous hot-path addition. Without empirical evidence that
  the additions fit inside the p50<50ms budget (PRD §10.2), the architecture
  could silently break the latency promise.

  What this phase is NOT:
  - NOT implementation of Phase 6b. POC validation = measurement scripts +
    analysis. Real wiring lives in Phase 6b.
  - NOT a binary fork (Branch B removed). If POC reproves, human decides
    to adjust (swap model, optimize query, refactor template), NOT collapse.
  - NOT touching `src/search/**`, `src/catalog/**`, `src/social-detector/**`,
    `src/fingerprint/**`, `packages/sdk/**`, `packages/ui/**`. These are
    baselines / locked layers per CALIBRATION-RESIDUE.md + Phase 5 scope
    guard convention.

  Why hot path overhead is PRIMARY, latency trick is SECONDARY:
  The real bottleneck is what inception adds to the hot path on every
  Turn N+1 (synchronous, blocks the human's request). Fast-agent latency
  happens in parallel with human reading (5-30s budget). If inception
  overhead is <10ms, it is transparent — the latency trick becomes an
  architectural bonus, not a technical risk. POC focuses on the real
  bottleneck.

  Decision rule on failure (PRD §16.7):
  "se algum target falhar → ajustar (trocar modelo, otimizar query,
  refactor template), não collapsar." The decision is documented in
  `.specs/DISCOVERIES.md` as a discovery (AD-006+ territory) so the
  loop can re-plan Phase 6b with the adjusted targets.

  Hot path target methodology (per-task measurement):
  - Hot path overhead = `sqlite.get(intel)` p95 + concat p95 + template
    render p95. The Phase 5a.4 baseline (~1.91ms median) is the
    measurement reference: we subtract the baseline to isolate the
    incremental overhead of the three new operations.
  - `sqlite.get(intel)` is measured against a real `:memory:` SQLite
    database with the `intel` schema applied. No mocking of the
    SQLite layer itself (the read is the thing being measured).
  - Template render is measured against a stub `SystemBlock[]` shaped
    identically to the Phase 5a.2 augmenter output, with a fixed
    intel payload.
  - Intel store mock is in-memory keyed by `session_id` to eliminate
    cold-start variance (matches Phase 5a.4 perf harness pattern).

  Fast agent harness (real `MiniMax-M2.7-highspeed` API):
  Default = real Anthropic-compatible API at `https://api.minimax.io/anthropic`
  via the Anthropic SDK (`@anthropic-ai/sdk`). Falls back to a deterministic
  local stub (`scripts/stub-fast-agent.mjs`) ONLY when the API key env var
  is unset (per CLAUDE.md context: no direct Anthropic access guaranteed;
  but MiniMax is the verified POC endpoint per ROADMAP Phase 6a note).
  Latency is recorded per request (10 amostras).

  Intel pipeline POC (writer-reader contract end-to-end):
  - Writer = mini fast-agent stub that takes a fixed `R_N` text and emits
    a deterministic `Intel` literal matching SPEC §IMod-5 shape.
  - Reader = match pipeline stub that consumes the `Intel` literal and
    composes the 2-block system message.
  - Equality test: 2 inputs with same persona + same intel + same
    Skills → same SHA256(byte-string).

  Pre-grill checklist (PRD §16.7 — canonical, NOT §16.6 which is stale):
  Per the PRD §16.7 checklist the POC MUST verify:
  - [x] `sqlite.get(intel)` < 5ms (p95, 10 amostras)
  - [x] concat intel+prompt < 1ms (p95)
  - [x] template render 2 blocos < 1ms (p95)
  - [x] fast agent (`MiniMax-M2.7-highspeed`) < 3s (10 amostras)

  Resolved in §16.4 (NOT repeated as TODO):
  - Fast agent: in-process (not sidecar)
  - Intel store: SQLite WAL mode (not file/unix socket)
  - Match strategy: embedding pipeline existente (not regex novo)

related:
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5a-api-retrieval/validation-phase-5a.4.md
  - ../phase-5b-aux-endpoints/{spec,design,tasks}.md
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../architecture/memory-studio.architecture.json
  - ../../../src/server/boot.ts
  - ../../../src/server/index.ts
  - ../../../src/server/augment/{pipeline,augmenter,byte-string,top-k,thresholds}.ts
  - ../../../src/catalog/index.ts
  - ../../../src/search/{fts,rrf,vector}.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../test/augment/perf.test.mjs
  - ../../../scripts/smoke-{server-boot,augment-server,proxy-local-only}.mjs
  - ../../../CLAUDE.md
---

# Phase 6a — POC Validation (hot path + fast agent) — Spec

**Phase:** 6a
**Slug:** `phase-6a-poc-validation`
**Source:** `.specs/ROADMAP.md` lines 698-742 (Phase 6a entry)
**Goal:** validate empirically that inception híbrida adds <10ms to the hot path AND that fast-agentuality finishes in <3s. POC is NOT a binary fork (Branch B removed 2026-07-28). If POC reproves, human decides to adjust (model swap / query optimize / template refactor), not collapse.
**Estimate:** 2-3h (per ROADMAP, mostly measurement + analysis)

---

## Architectural Reference

> Farol nodes consumed by this spec (`.specs/architecture/memory-studio.architecture.json` — runtime-only farol per L-009 / `farol-runtime-only`):

> **Módulo 3 — Hot Path (síncrono, p50<50ms):**
> - `server` — `@memory-studio/server` (Fastify). Phase 5a.1 + 5a.2 + 5b.1-5b.4 closed. Phase 6a READS from the existing pipeline (`src/server/augment/pipeline.ts`) to subtract the Phase 5a.4 baseline (~1.91ms median). Phase 6a does NOT modify the route handler.
> - `sdk` — `@memory-studio/sdk` (Phase 3). NOT touched in Phase 6a.

> **Módulo 4 — Pipeline (retrieval core):**
> - `augmenter` — Augmenter (byte-string · 2-block). Phase 5a.2. Phase 6a MEASURES the template render cost of the existing `buildSystemMessage()` (`src/server/augment/augmenter.ts:151-172`) when the input includes an intel block.
> - `search` — Search (FTS5+vec+RRF D-006). REUSE-ONLY per CALIBRATION-RESIDUE.md. Phase 6a does NOT modify.
> - `social-detector` — Social Detector. REUSE-ONLY. Phase 6a does NOT modify.
> - `cache` — Cache (SHA256). Phase 5a.2 primitives (`src/server/augment/byte-string.ts`). Phase 6a uses `canonicalSha256()` for the byte-string equality test.

> **Módulo 5 — Storage:**
> - `sqlite` — SQLite (catalog + audit + intel). Phase 6a measures a `SELECT FROM intel WHERE session_id = ?` against a real `:memory:` SQLite DB with the `intel` schema applied. The schema is `intel(session_id TEXT PK, agent_state TEXT, next_needs TEXT, recent_topic TEXT, ts INTEGER)` per SPEC §IMod-5 + PRD §16.5.

> **Out of farol scope for Phase 6a (deliberately deferred to Phase 6b):**
> - `intel-store` SQLite WAL persistence (Phase 6b ships the production table + migration)
> - `fast-agent` in-process Haiku/MiniMax-M2.7-highspeed integration (Phase 6b)
> - `match-script` writer-reader contract runtime (Phase 6b)

**Edges measured (NOT built) by Phase 6a:**
- `augmenter → intel-store` — measured as `sqlite.get(intel)` latency; not wired
- `augmenter → fast-agent` — measured as fast-agent call latency; not wired
- `server → intel-store` — measured as hot path overhead; not wired

**Edges NOT touched by Phase 6a:**
- All production code paths in `src/server/**` (read-only measurement)
- `src/search/**` (calibration residue, quarantined)
- `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`
- `packages/sdk/**`, `packages/ui/**`

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | The POC harness (`scripts/poc-6a-hot-path.mjs`) measures `sqlite.get(intel)` latency (p95, 10 amostras) against a real `:memory:` SQLite DB with the `intel` schema applied. The measurement EXCLUDES ONNX runtime cost (per Phase 5a.4 T-12 pattern). Synthetic fixtures with deterministic `session_id` keys eliminate cold-start variance | ROADMAP §6a done #1 + PRD §16.7 |
| **R-02** | The POC harness measures concat (intel + prompt) latency (p95, 10 amostras). Input = 1 intel literal `{ agentState, nextNeeds, recentTopic }` + 1 prompt string (Phase 5a.4 fixture pattern). Measurement EXCLUDES SQLite read (R-01 measures that separately) | ROADMAP §6a done #1 + PRD §16.7 |
| **R-03** | The POC harness measures template render latency (p95, 10 amostras). Input = the 2-block `cache_control: ephemeral` structure from Phase 5a.2's `buildSystemMessage()`, with the `intel` literal inserted into Block 2's `## Intel` section. Measurement uses the existing `canonicalSha256()` and `JSON.stringify` primitives from `src/server/augment/byte-string.ts` | ROADMAP §6a done #1 + PRD §16.7 + PRD §8 invariante 11 |
| **R-04** | **PRIMARY criterion:** Hot path overhead total <10ms (p95, 10 amostras each component, summed at the report level). This is the per-request incremental cost of the three new operations (intel read + concat + template render) added to the existing Phase 5a.4 pipeline. Budget preserves p50<50ms (PRD §10.2) | PRD §10.1 item 12 + PRD §10.2 + PRD §16.7 + ROADMAP §6a done #4 |
| **R-05** | The POC harness measures fast-agent latency (10 amostras) calling `https://api.minimax.io/anthropic` (Anthropic-compatible) via `@anthropic-ai/sdk` with model = `MiniMax-M2.7-highspeed`. Latency recorded from `performance.now()` at request start to response received. **Latency budget <3s p95.** Highspeed variant tipicamente <1s per PRD §16.2 + SPEC §IMod-5 + USER STORY §E 37 | ROADMAP §6a done #5 + PRD §16.2 + PRD §16.7 |
| **R-06** | When the API key for `MiniMax-M2.7-highspeed` is unavailable (`MINIMAX_API_KEY` env var unset), the harness falls back to a deterministic local stub (`scripts/stub-fast-agent.mjs`). The stub returns a fixed `Intel` literal matching SPEC §IMod-5 shape after a configurable simulated latency (default 200ms — within the highspeed <1s range). The stub MUST be marked `[STUB]` in its log output so the Implementer cannot confuse it with the real API measurement | CLAUDE.md context (no direct Anthropic access guaranteed) + ROADMAP Phase 6a note |
| **R-07** | **Byte-string determinism with template:** 2 requests with identical input (same persona + same intel + same Skills ativas) produce the SAME `systemMessage` SHA-256 hex digest. The template is the 2-block structure from Phase 5a.2 with the `intel` literal added to Block 2's `## Intel` section. The test asserts byte-equality of the 64-char hex digest | ROADMAP §6a done #6 + SPEC §IMod-5 + PRD §16.5 |
| **R-08** | The POC harness excludes ONNX runtime from the measurement loop (per Phase 5a.4 R-13 / T-12 pattern). The embedder is stubbed with a cached 384d Float32Array. The intent is to measure SERVER overhead, not ONNX runtime noise | Phase 5a.4 T-12 pattern |
| **R-09** | The POC uses `app.inject()` (in-process Fastify) for all hot path measurements (per Phase 5a.4 T-12). No socket bind, no loopback TCP handshake. Eliminates kernel-level scheduling noise | Phase 5a.4 T-12 pattern |
| **R-10** | All measurements use N=10 amostras per target (per ROADMAP §6a + PRD §16.7). p95 is the gating metric. Statistics are reported as `min / median / p95 / max` for each measurement set. Outliers are flagged in the report but do not invalidate the p95 gate | ROADMAP §6a done + PRD §16.7 |
| **R-11** | Decision recorded in `.specs/DISCOVERIES.md` after POC runs. If PASS: AD-006 records "POC validates inception híbrida; Phase 6b proceeds with these targets as ceilings". If FAIL: AD-006 records the failed target + the specific adjustment recommended (model swap / query optimize / template refactor) | ROADMAP §6a "Decision recorded" + PRD §16.7 rule |
| **R-12** | POC report doc at `.specs/features/phase-6a-poc-validation/poc-results.md` (or analog) contains: (a) per-target measurements (R-01..R-03, R-05, R-07), (b) PRIMARY verdict (R-04 total <10ms), (c) fast agent verdict (R-05 <3s), (d) byte-string equality verdict (R-07), (e) decision (PASS/FAIL) + adjustment recommendation if FAIL | ROADMAP §6a "POC result doc" |
| **R-13** | **No production code touched.** The POC measurement scripts live under `scripts/poc-*.mjs` and `test/poc/*.test.mjs` (read-only measurement, not the production `src/server/**` graph). The existing `src/server/augment/{pipeline,augmenter,byte-string}.ts` modules are imported for their PURE helpers (`canonicalSha256`, `buildSystemMessage`) but NOT modified | Phase 5 scope guard convention + ROADMAP §6a scope |
| **R-14** | **No locked-layer touches:** `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/` returns empty after POC closes | CALIBRATION-RESIDUE.md + Phase 5 scope guard |
| **R-15** | Existing test baseline (559 tests: 391 root + 152 UI + 16 SDK from Phase 5b.4 closure at `c7e7a8d`) is PRESERVED. New POC tests live at `test/poc/*.test.mjs` and ADD to the count | CLAUDE.md testing contract + Phase 5b.4 baseline |
| **R-16** | `npm run typecheck` exits 0 with no new errors. POC scripts are TypeScript-stripped (matching Phase 5a/b pattern: `node --experimental-strip-types --no-warnings scripts/poc-*.mjs`) | CLAUDE.md testing contract |

### Out of scope (explicit non-goals)

- **Production wiring of inception híbrida** (in-process fast agent, SQLite WAL intel store, suffix injection runtime) — Phase 6b.
- **Real Anthropic API** for fast agent — POC uses `MiniMax-M2.7-highspeed` per ROADMAP note. Anthropic access is not guaranteed in this environment.
- **`Intel` writer (fast agent output) wired to intel store** — Phase 6b.
- **`Intel` reader (match pipeline) wired to `/augment`** — Phase 6b.
- **Cache hit measurement of the full Turn N+1 → cache write → Turn N+2** — Phase 7b (needs 1 week of real sessions).
- **Multi-tenant isolation** — v4+.
- **Adapter OpenAI↔Anthropic** — v3.1+.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `node scripts/poc-6a-hot-path.mjs` exits 0 and prints `[hot-path] PASS|FAIL median=<ms> p95=<ms> total-overhead=<ms>` with per-component breakdown (sqlite.get / concat / template render). The script uses N=10 amostras per component and reports `min / median / p95 / max` for each | R-01..R-04 |
| **AC-2** | Hot path total overhead (sum of 3 components, p95 each) **< 10ms**. If any single component fails its individual budget (`sqlite.get` <5ms, concat <1ms, template render <1ms) the harness reports the failing component FIRST so the Implementer can target the adjustment | R-04 |
| **AC-3** | `node scripts/poc-6a-fast-agent.mjs` exits 0 and prints `[fast-agent] PASS|FAIL median=<ms> p95=<ms> api-endpoint=<url> model=<name>`. The script tries `MiniMax-M2.7-highspeed` at `https://api.minimax.io/anthropic` first; falls back to local stub (`scripts/stub-fast-agent.mjs`) when `MINIMAX_API_KEY` is unset | R-05, R-06 |
| **AC-4** | Fast agent latency (10 amostras) **< 3s p95** when real API is used. When stub fallback is used, the script logs `[STUB]` clearly so the Verifier can distinguish. The script records which mode was used in its output | R-05, R-06 |
| **AC-5** | `node --test test/poc/byte-string-equality.test.mjs` passes with 2 `/augment`-shaped requests (same persona + same intel + same Skills ativas) producing identical 64-char SHA-256 hex digests | R-07 |
| **AC-6** | All 3 measurement scripts (`poc-6a-hot-path.mjs`, `poc-6a-fast-agent.mjs`, `byte-string-equality.test.mjs`) are runnable end-to-end and produce machine-readable output (JSON line + summary). The Verifier parses the output to verify the gate | R-12 |
| **AC-7** | POC results doc (`.specs/features/phase-6a-poc-validation/poc-results.md`) contains all required sections per R-12: per-target measurements + PRIMARY verdict + fast agent verdict + byte-string verdict + decision | R-12 |
| **AC-8** | AD-006 recorded in `.specs/DISCOVERIES.md` after POC closes (PASS or FAIL). The AD references the POC results doc and the specific decision rule applied (PRD §16.7) | R-11 |
| **AC-9** | Scope guard: `git diff <phase-5b.4-baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/` returns empty | R-14 |
| **AC-10** | Test baseline preserved: `npm test` at repo root reports ≥559 tests passing (391 root + 152 UI + 16 SDK from Phase 5b.4 closure at `c7e7a8d`). New POC tests ADD to the count | R-15 |
| **AC-11** | `npm run typecheck` exits 0. POC scripts use `node --experimental-strip-types --no-warnings scripts/poc-*.mjs` (matching Phase 5a.3 / 5a.4 pattern) | R-16 |
| **AC-12** | Decision rule on FAIL per PRD §16.7: if any target fails, the POC results doc + AD-006 record a SPECIFIC adjustment recommendation (e.g., "swap to `MiniMax-M2.7-highspeed` variant X", "add `idx_intel_session_id` covering index", "precompute template skeleton"). NO collapse-to-zero recommendation | R-11, PRD §16.7 |

---

## Pre-grill Checklist (PRD §16.7 — canonical)

Per PRD §16.7 the POC MUST verify:

- [x] **Overhead da inception no hot path < 10ms total:** `sqlite.get(intel)` < 5ms (p95, 10 amostras) + concat intel+prompt < 1ms (p95) + template render 2 blocos < 1ms (p95)
- [x] **Latência do fast agent (default `MiniMax-M2.7-highspeed`) < 3s em 10 amostras**

Resolved in §16.4 (NOT repeated as POC TODO):

- [x] Fast agent: in-process (não sidecar)
- [x] Intel store: SQLite WAL mode (não file/unix socket)
- [x] Match strategy: embedding pipeline existente (FTS5 + sqlite-vec + RRF), não regex novo

Decision rule (PRD §16.7): "se algum target falhar → ajustar (trocar modelo, otimizar query, refactor template), não collapsar."

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: POC scope** | Measurement scripts + analysis, NOT production code. Phase 6b ships the wiring | Phase 5a.4 established the perf harness pattern; Phase 6a follows it but for the 3 NEW hot path operations | yes (dispatch) |
| **A-2: MiniMax API key availability** | POC defaults to REAL API when `MINIMAX_API_KEY` is set, falls back to stub when unset. The stub is marked `[STUB]` in output | CLAUDE.md context (no direct Anthropic access guaranteed). ROADMAP Phase 6a note explicitly names `MiniMax-M2.7-highspeed` as the model. The stub is a fallback, not a default | yes (autonomous; ROADMAP + CLAUDE.md context) |
| **A-3: Intel schema (writer-reader contract)** | `Intel = { agentState: string, nextNeeds: string[], recentTopic: string }` per SPEC §IMod-5. The POC uses this EXACT shape for the stub fast agent output AND the reader input | SPEC §IMod-5 explicit + PRD §16.5 canonical. Phase 6b must implement this shape literally — POC validates the shape contract | yes (SPEC explicit) |
| **A-4: Measurement pattern (in-process app.inject)** | Same as Phase 5a.4 T-12 — `app.inject()` (no socket), deterministic fixtures, N=10 amostras | Phase 5a.4 pattern proven; reproducer-friendly; eliminates kernel noise | yes (autonomous; matches Phase 5a.4) |
| **A-5: ONNX exclusion** | Embedder stubbed with cached 384d Float32Array (per Phase 5a.4 T-12) | Spec R-08 explicit. ONNX runtime noise is highly variable; excluding it isolates server overhead | yes (Phase 5a.4 pattern) |
| **A-6: Hot path baseline subtraction** | Phase 6a does NOT subtract the Phase 5a.4 baseline (~1.91ms median). The measured overhead IS the incremental cost of the 3 new operations. The 3 operations are run as an additive wrapper around an empty `buildSystemMessage()` baseline so the result is the NEW cost | Phase 5a.4 baseline is for the FULL pipeline (including embedding, retrieval, etc.). The 3 new operations are layered on top; measuring them in isolation against a no-op baseline gives the incremental cost the Implementer needs to budget against | yes (autonomous; matches spec R-04 "incremental cost") |
| **A-7: SQLite schema for intel POC** | `intel(session_id TEXT PRIMARY KEY, agent_state TEXT NOT NULL DEFAULT '', next_needs TEXT NOT NULL DEFAULT '[]', recent_topic TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL)` | SPEC §IMod-5 shape + PRD §16.4 resolution #2 ("intel: SQLite WAL mode"). Default values match §16.5 degradation rules ("se field vazio/fora de ordem, match pipeline não crasha") | yes (autonomous; SPEC + PRD explicit) |
| **A-8: Subchapter breakdown** | YES — 3 subchapters (6a.1 hot path, 6a.2 fast agent, 6a.3 byte-string determinism + AD-006). Each ≤ 4 tasks. Whole Phase 6a = 1 Implementer batch (≤ 12 tasks) | dispatch SUBCHAPTER_BREAKDOWN trigger; 3 measurement scripts × ~3 tasks = 9-12 tasks fits one batch | yes (autonomous; matches Phase 5a pattern) |
| **A-9: API client for MiniMax** | `@anthropic-ai/sdk` (existing in `package.json` per Phase 5b.4 proxy work) at `https://api.minimax.io/anthropic` baseURL. No new dependency | Phase 5b.4 already uses `@anthropic-ai/sdk` for the transparent proxy. Same SDK, different baseURL | yes (autonomous; reuses Phase 5b.4 dependency) |
| **A-10: Stub fast agent contract** | `scripts/stub-fast-agent.mjs` exposes POST `/v1/messages` (Anthropic-compatible) with the system+user→`Intel` response shape. Returns a deterministic `Intel` literal after a configurable `SIMULATED_LATENCY_MS` (default 200ms). Marked `[STUB]` in every log line | CLAUDE.md context (no direct API guaranteed). Stub MUST be a usable fallback that exercises the same wire shape as the real API so the Verifier can swap modes without changing the harness | yes (autonomous; defensive per CLAUDE.md context) |
| **A-11: POC results doc location** | `.specs/features/phase-6a-poc-validation/poc-results.md` | Pattern matches Phase 5a.3 + 5a.4 validation reports (`validation-phase-5a.{1,2,3,4}.md`). Keeps all Phase 6a artifacts together | yes (autonomous; matches Phase 5a pattern) |
| **A-12: AD-006 numbering** | Next available ID in `.specs/DISCOVERIES.md`. Phase 5b saved L-008 + AD-005; Phase 6a adds AD-006 | ADs are append-only; Phase 6a POC decision is a state-level record (PASS = proceed, FAIL = adjust) | yes (autonomous; matches AD convention) |

---

## Files Referenced (absolute paths)

- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\boot.ts` — Fastify bootstrap (Phase 5a.1, referenced for `createServer({ portRange })`)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\index.ts` — server index (Phase 5a.1, `createServer` + `resetServerMetadataForTests`)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\pipeline.ts` — pipeline orchestrator (Phase 5a.2)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\augmenter.ts` — `buildSystemMessage()` 2-block builder (Phase 5a.2)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\src\server\augment\byte-string.ts` — `canonicalSha256()` primitives (Phase 5a.2)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\test\augment\perf.test.mjs` — Phase 5a.4 T-12 perf harness (model for R-08..R-10)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\scripts\smoke-augment-server.mjs` — Phase 5a.3 smoke harness (model for stub server pattern + cache_hit forwarding)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\scripts\smoke-proxy-local-only.mjs` — Phase 5b.4 stub proxy (model for stub provider pattern)
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.specs\ROADMAP.md` lines 698-742 — Phase 6a canonical scope
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\PRD.md` §16, §16.2, §16.7 — inception híbrida + POC checklist
- `C:\Users\User\Desktop\AI-Project\Memory-Studio\.scratch\memory-studio\spec.md` §IMod-5 — `Intel` shape
