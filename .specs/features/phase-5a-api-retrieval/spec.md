---
date: 2026-07-31
version: 1
description: "Phase 5a — API + Retrieval + Byte-string spec. Implements the server side of Memory Studio: Fastify `/augment` endpoint (request validation + retrieval pipeline + system message augmentation + SHA256 byte-string determinism + 2-block `cache_control: ephemeral`) backed by existing `src/search/*` calibration residue (FTS5 + sqlite-vec + RRF + tiebreak D-006) and Phase 1 catalog data."
explanation: |
  Phase 5a ships the FIRST server-side runtime of Memory Studio. The
  client side (Phase 3 SDK) is already shipping — `MemoryStudioClient.augment`
  POSTs to `/augment` and expects an `AugmentResponse`. This phase delivers
  the handler that produces that response.

  Architectural decisions locked in (PRD v3.4 + SPEC v2 + dispatch footnotes):
  - Server framework = **Fastify** (PRD §8 explicitly names it). Option (a)
    per dispatch footnote. Aligns with "Fastify, SQLite + FTS5 + sqlite-vec".
    Rejected `node:http` (option b) because Fastify gives schema validation,
    JSON serialization, and p50<50ms out of the box. Rejected hybrid (c)
    because Phase 1's 185-test + Phase 3's 16-test baseline prove Node
    ESM/strip-types handles the import graph without split-stacks.
  - Cache architecture = **provider cache ONLY** (MVP per IMod-9 + PRD §17.1).
    NO augmented cache. NO `cacheHit` field in response. The `cacheRead`
    metric is via structured log of `usage.cache_read_input_tokens`.
  - Cache block layout = **2 blocks** `cache_control: ephemeral` (PRD §8
    invariante 11 + SPEC §IMod-7). Block 1 = persona(s), stable across turns.
    Block 2 = Skills + Rules + context synthesis, variable per turn.
  - Tiebreak = `Array.sort((a,b) => a.id.localeCompare(b.id))` AFTER RRF +
    threshold + top-K, BEFORE byte-string serialization (D-006).
  - Threshold = **double gate** (PRD §8 invariante sólida 7):
    `min_cosine_similarity` AND `min_fts_hits` both must pass.
  - Retrieval implementation = **reuse calibration residue** in `src/search/*`
    (rrf.ts, fts.ts, vector.ts, search.ts, schema.ts, types.ts, errors.ts).
    Phase 1's `test/search/*` already proves the algorithm. Phase 5a
    wires it into the `/augment` request flow and adds the augment-specific
    surface (top-K cap, byte-string builder, structured logger).

  Smoke test strategy (the END-TO-END gate per dispatch):
  - Server boots on first free port (same pattern as Phase 4's
    `scripts/ui-server.mjs`).
  - Smoke script (`scripts/smoke-augment-server.mjs`) calls `/augment`
    twice with identical input → captures `systemMessage` from both
    responses → forwards BOTH to a real Anthropic API (or a test stub
    that simulates cache_read_input_tokens) → asserts 2nd call shows
    `cache_read_input_tokens > 0`.
  - Claude Code integration guide (`docs/guides/claude-code-baseurl.md`)
    documents `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` wiring. The
    actual `/v1/messages` proxy layer is Phase 5b (per dispatch
    "outros 5 endpoints (Phase 5b)"); Phase 5a provides the SDK-level
    smoke + a documented integration path that Phase 5b will implement.

  Test count discipline:
  - Root baseline = 375 tests (207 root + 152 UI + 16 SDK from Phase 3).
    Verifier checks floor is preserved.
  - New tests live at `test/augment/*.test.mjs` and `test/search/*`
    (existing) — Phase 5a ADDS retrieval integration tests but does not
    rewrite the existing search suite.

  Touch ONLY files under `.specs/features/phase-5a-api-retrieval/` for
  this planning artifact. Implementation tasks live in `tasks.md` and
  will be executed in a separate Planner→Implementer dispatch.

related:
  - ../../ROADMAP.md
  - ../../architecture/memory-studio.html
  - ../../architecture/memory-studio.architecture.json
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../../CLAUDE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../features/phase-1-catalog-schema-index/{spec,design,tasks}.md
  - ../../features/phase-3-sdk-client/{spec,design,tasks}.md
  - ../../../src/search/{rrf,fts,vector,search,types,errors,schema}.ts
  - ../../../src/catalog/index.ts
  - ../../../src/social-detector/index.ts
  - ../../../src/fingerprint/fingerprint.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../scripts/ui-server.mjs
---

# Phase 5a — API + Retrieval + Byte-string — Spec

**Phase:** 5a
**Slug:** `phase-5a-api-retrieval`
**Source:** `.specs/ROADMAP.md` lines 426-462 (Phase 5a entry)
**Goal:** ship the server-side `/augment` endpoint that receives the SDK's POST, runs retrieval against the Phase 1 catalog, builds a deterministic byte-string system message with 2 blocks of `cache_control: ephemeral`, and verifies provider cache hits in the structured log.
**Estimate:** 3-4h (per ROADMAP)

---

## Architectural Reference

> Farol nodes consumed by this spec (`.specs/architecture/memory-studio.architecture.json` — Módulos 3 + 4 + 5):

> **Módulo 3 — Hot Path (síncrono, p50<50ms):**
> - `server` — `@memory-studio/server` (Fastify · 7 endpoints). Phase 5a IMPLEMENTS the `/augment` handler. The remaining 6 endpoints (`/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`, `/state/toggle`) are Phase 5b. A minimal `/health` liveness handler ships with the server bootstrap in Phase 5a to support the smoke test.
> - `sdk` — `@memory-studio/sdk` (TS · ~50KB · zero deps). Phase 3 already implemented. Phase 5a is the SERVER side that receives the SDK's POST.

> **Módulo 4 — Pipeline (retrieval core):**
> - `augmenter` — Augmenter (byte-string · 2-block). Phase 5a IMPLEMENTS this node: builds the 2-block `cache_control: ephemeral` system message and computes SHA256(byte-string) as the provider cache key.
> - `search` — Search (FTS5+vec+RRF D-006). Phase 5a WIRES the existing calibration residue in `src/search/*` into the `/augment` pipeline. The `fuseRrf`, `searchFts`, `searchVector`, `applyThresholds` functions already exist; Phase 5a orchestrates them.
> - `social-detector` — Social Detector (regex bypass). Phase 2 already implemented. Phase 5a calls `isSocial(prompt)` BEFORE retrieval — if social, skip retrieval and forward prompt unchanged (per PRD §8 invariante sólida 6).
> - `cache` — Cache (SHA256(byte-string)). Phase 5a implements the **provider cache pass-through only** (no augmented cache, per PRD §17.1 MVP scope). The cache LOOKUP is on the Anthropic server; Memory Studio's role is to compute SHA256 for log correlation.

> **Módulo 5 — Storage:**
> - `sqlite` — SQLite (catalog + audit + intel). Phase 1 created `catalog`, `embeddings`, `audit_events`. Phase 5a READS from `catalog_fts` + `catalog_vec` (Phase 1 triggers).
> - `fts5-vec` — FTS5+vec (search engine). Phase 1 created virtual tables + triggers. Phase 5a queries them.
> - `embed-model` — multilingual-e5-small ONNX 384d. Phase 1 wired. Phase 5a calls `Embedder.encode(prompt)` for the query embedding.
> - `state-json` — `.memory-studio/state.json` (per-project, git-tracked). Phase 5a reads `activeCatalog` from request body (already populated by SDK from state.json), validates against filesystem before serving.

> **Out of farol scope for Phase 5a** (deliberately):
> - `audit-buffer` async+batch+fail-open runtime — Phase 5b (audit write runtime is explicitly out per dispatch).
> - `intel-store` + `fast-agent` + `match-script` — Phase 6 (inception híbrida).
> - `/v1/messages` proxy — Phase 5b (Claude Code transparent proxy).
> - `ui-panel` — Phase 4 already shipped.

**Edges built by Phase 5a (Implementer's TODO list):**
- `server → augmenter` — server invokes augmenter to build systemMessage
- `augmenter → search` — augmenter calls search for retrieval
- `search → fts5-vec` — search queries FTS5 + sqlite-vec virtual tables
- `search → embed-model` — search calls Embedder.encode(prompt) for query vector
- `augmenter → cache` — augmenter computes SHA256(byte-string) for log
- `server → state-json` — server validates `activeCatalog` against state.json (filesystem read)
- `server → audit-buffer` — server emits structured log line with `usage.cache_read_input_tokens` field (read-only stub; Phase 5b wires the async buffer)

**Edges NOT built by Phase 5a (consumers in later phases):**
- `audit-buffer → sqlite` — Phase 5b (audit write runtime, fail-open).
- `sdk → server` — already exists (Phase 3); Phase 5a is the receiver.
- `agents → server` (via /v1/messages proxy) — Phase 5b.

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | The server process is a Fastify app bound to the first free port in `MEMORY_STUDIO_AUGMENT_PORT_RANGE` (default `[4200, 4299]`). On boot it logs `Memory Studio augment server: http://127.0.0.1:<port>`. Graceful shutdown on SIGINT/SIGTERM. Pattern matches `scripts/ui-server.mjs` (Phase 4) | PRD §14.2 + ROADMAP done #1 + Phase 4 pattern |
| **R-02** | `POST /augment` accepts a JSON body matching PRD §7.1 `AugmentRequest`: `{ prompt: string (required), context?: Context \| null, fingerprint: { projectPath, agentId, sessionId, gitBranch }, activeCatalog: string[], tenantId: string, schemaVersion: 3 }`. Validation via Zod; invalid request → 400 with `{ error: "validation_error", details: ZodError[] }` | PRD §7.1 + ROADMAP done #1 + SPEC §IMod-3 |
| **R-03** | `context: null` is the canonical prompt-only signal (NOT omitted). Server treats `context: null` OR `context` absent identically: retrieval runs on `prompt` alone; `context-derived` fields are empty | PRD §7.1 + SPEC §IMod-3 + SPEC User Story §C 23 |
| **R-04** | `activeCatalog: []` triggers the D-008 contract: HTTP 200, `systemMessage` is persona-only (no Skills/Rules/Personas blocks), `matchedSkills/Rules/Personas` are empty arrays, `emptyReason: "no_active_items"`, `warnings: ["activeCatalog is empty — proceeding with persona only"]`, `pruningDecisions` all empty arrays. Forward unchanged (no inject defaults, no reject) | PRD §7.1 + SPEC §IMod-12 + ROADMAP done #4 (AC-7) |
| **R-05** | `schemaVersion` MUST equal `3` (integer literal). Anything else → 400 `validation_error` | PRD §7.1 + Phase 1 baseline `getCatalogSchemaVersion() === 3` |
| **R-06** | `fingerprint.agentId` MUST equal `"claude-code"` (MVP canonical list per PRD §14.4). Anything else → 400 `validation_error`. v3.1+ may widen the list | PRD §14.4 + SPEC §C 24 |
| **R-07** | Retrieval runs FTS5 + sqlite-vec + RRF fusion per SPEC §IMod-7. The implementation reuses `src/search/{rrf,fts,vector,search}.ts` (calibration residue, already covered by `test/search/*.test.mjs`). Phase 5a does NOT rewrite these modules — it composes them | SPEC §IMod-7 + CALIBRATION-RESIDUE policy + Phase 1 baseline |
| **R-08** | **Double threshold** (PRD §8 invariante sólida 7): a candidate item passes ONLY if `cosine_similarity >= min_cosine_similarity` (default `0.75`) AND `bm25_hits >= min_fts_hits` (default `1`). Items failing either gate → `pruningDecisions.rejectedByFloor[]` with reason `"below_threshold"` | PRD §8 invariante 7 + SPEC §IMod-7 + `src/search/types.ts` exports `DEFAULT_MIN_COSINE_SIMILARITY=0.75` and `DEFAULT_MIN_FTS_HITS=1` (verified by `test/search/contracts.test.mjs` T-CONTRACTS-01) |
| **R-09** | **Top-K = 3-5 items** (PRD §10.1 item 2): after threshold filtering, the matched array MUST contain ≥3 AND ≤5 items. If fewer than 3 pass the threshold, return what passes with `emptyReason: "low_confidence"`. If more than 5 pass, take top-5 by RRF score (descending), then tiebreak | PRD §10.1 item 2 + ROADMAP done #2 + SPEC §IMod-7 step 5 |
| **R-10** | **Tiebreak ordering (D-006):** after RRF + threshold + top-K, `matched.sort((a,b) => a.id.localeCompare(b.id))` is applied BEFORE byte-string serialization. Same item set in different RRF order → same byte-string. Same item set with different scores → same byte-string (score is not in the byte-string) | PRD §8 + SPEC §IMod-7 step 6 + DISCOVERIES D-006 |
| **R-11** | **System message augmenter** builds the 2-block `cache_control: ephemeral` system message per PRD §8 invariante 11 + SPEC §IMod-7. Block 1 = persona(s) text, stable prefix. Block 2 = Skills + Rules + matched items + context synthesis, variable suffix. Each block is a separate `cache_control: { type: "ephemeral" }` marker in the Anthropic request | PRD §8 invariante 11 + PRD §10.1 item 4 + SPEC §IMod-7 + SPEC User Story §D 30 |
| **R-12** | **Byte-string determinism:** the `systemMessage` field in the response is the SHA-256 hex digest of the EXACT byte-string that would be sent to Anthropic (with both `cache_control: ephemeral` markers). Same logical input → same `systemMessage` (D-006 done criterion). The hash is included in the response for client-side verification | SPEC §IMod-7 step 8 + DISCOVERIES D-006 + ROADMAP done #3 |
| **R-13** | **Active catalog validation:** `activeCatalog` IDs are validated against `config/catalog/<id>.yaml` on the filesystem. Missing IDs (not in catalog) → dropped from matched array + added to `pruningDecisions.rejectedByFloor[]` with reason `"id_not_in_catalog"`. Server NEVER injects defaults; only matches valid IDs | PRD §7.1 + PRD §4 + SPEC §IMod-7 |
| **R-14** | **Social detector gate:** `isSocial(prompt)` (Phase 2) runs BEFORE retrieval. If social → bypass retrieval entirely; matched arrays empty; `emptyReason: "social"`; forward unchanged to provider with persona-only prefix | PRD §8 invariante sólida 6 + SPEC §IMod-7 + ROADMAP scope (excluded: audit write runtime; included: social bypass) |
| **R-15** | **Structured JSON logger** (per PRD §14.6): every `/augment` request emits a single-line JSON log to stdout with fields: `{ ts, requestId, tenantId_hashed, latencyMs: { embedding, retrieval, rerank: 0, total }, matchedIds: string[], systemMessageSha256, usage: { cache_read_input_tokens: number \| null, cache_creation_input_tokens: number \| null } }`. The `usage` fields are populated when the response is forwarded to a real Anthropic API; in MVP smoke they are `null` unless the test fixture injects them | PRD §14.6 + PRD §17.1 + ROADMAP done #6 |
| **R-16** | **Cache hit verification** (PRD §10.1 item 5): the smoke test forwards the same `systemMessage` twice to a real (or stubbed) Anthropic API; on the 2nd call, `usage.cache_read_input_tokens > 0`. The server log captures this field. Server does NOT interpret the value; it only logs it | PRD §10.1 item 5 + PRD §14.6 + SPEC §IMod-9 + ROADMAP done #6 |
| **R-17** | **Prompt-only mode:** `context: null` → 200, matched arrays may be empty, `emptyReason` is `"low_confidence"` if retrieval yields no results OR `null` if at least the persona matches | PRD §7.1 + PRD §10.1 item 9 + SPEC User Story §C 23 |
| **R-18** | **Latency budget:** p50 < 50ms (no embedding cache miss) + p99 < 200ms (with embedding), measured with 1000 synthetic requests each, reported as `min/median/p95` across N≥3 runs (per Phase 4.4 Verifier feedback on perf drift) | PRD §10.2 + SPEC §IMod-16 + Phase 4.4 Verifier feedback |
| **R-19** | **Tiebreak stress test (D-006 done criterion):** a generator script produces 1000 `/augment` requests whose cosine similarity scores cluster near the threshold boundary (in `[threshold-eps, threshold+eps]`). For each request, the same logical set of items matches after threshold + tiebreak. The script asserts all 1000 responses have the SAME `systemMessage` SHA256. This proves: (a) score values do NOT leak into byte-string; (b) tiebreak is the only ordering signal | DISCOVERIES D-006 + ROADMAP done #5 |
| **R-20** | **Minimal `/health` endpoint** for the smoke test: `GET /health` returns 200 `{ status: "ok", uptime, version }`. This is a thin liveness handler; the full readiness check (catalog DB, ONNX model, FTS5/vec extensions) is Phase 5b | dispatch footnote "outros 5 endpoints (Phase 5b)" + smoke test requirement |
| **R-21** | **Claude Code integration guide:** `docs/guides/claude-code-baseurl.md` documents how to wire `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` in `.claude/settings.json` or env var. The guide explains that Phase 5a provides the SDK-level smoke; Phase 5b adds the transparent `/v1/messages` proxy that makes Claude Code speak directly to the server without SDK instrumentation | dispatch done #8 + PRD §14.3 |
| **R-22** | **No farol/server references outside scope:** Phase 5a does NOT touch `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**` (these are Phase 1 + Phase 2 territory; Verifier checks `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/` returns empty). The existing `src/search/**` is reused as-is (calibration residue, marked `quarantined` per CALIBRATION-RESIDUE.md policy) | dispatch "Touch scope" + AD-002 calibration residue rule |
| **R-23** | **Test baseline preservation:** the 375-test baseline (207 root + 152 UI + 16 SDK) is preserved. New tests live at `test/augment/*.test.mjs`. The `test/search/*` suite (existing) continues to pass without modification | CLAUDE.md testing contract + Phase 3 baseline |

### Out of scope (explicit non-goals)

- **Audit write runtime** (async buffer + batch flush + fail-open) — Phase 5b per dispatch "Não inclui: audit write runtime (Phase 5b)".
- **Other 6 endpoints** (`/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, full `/state/toggle`, full `/health` readiness) — Phase 5b per dispatch "outros 5 endpoints (Phase 5b)".
- **`/v1/messages` transparent proxy** for Claude Code baseURL — Phase 5b. Phase 5a ships the SDK-level smoke + a documented integration guide.
- **Inception híbrida** (fast agent + intel store + match-script) — Phase 6 per dispatch.
- **Cache de augmented (fingerprint semântico)** — v3.1+ per PRD §17.1.
- **Multi-tenant support** — v4+ per PRD §11.
- **Adapter OpenAI↔Anthropic** — v3.1+ per PRD §11.
- **Discovery signals / curator LLM** — v3.2+ per PRD §11.
- **Retry / backoff / circuit breaker on `/augment`** — server is fail-open; transient errors return 200 with empty matched arrays + warning (matches D-008 pattern). External retry is caller's responsibility.
- **TLS / custom certificates** — server is HTTP-only on localhost; production deployment is out of scope.
- **Auth / rate limiting** — server is local-only MVP; no auth.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `npm run augment-server` (new script in root `package.json`) starts a Fastify server on the first free port in `MEMORY_STUDIO_AUGMENT_PORT_RANGE` (default `[4200, 4299]`). Logs `Memory Studio augment server: http://127.0.0.1:<port>`. Pressing Ctrl-C stops the process within 1s |
| **AC-2** | `POST /augment` with valid body returns 200 + `AugmentResponse` JSON. The response shape matches PRD §7.1 exactly: `{ systemMessage, matchedSkills, matchedRules, matchedPersonas, pruningDecisions, latencyMs, decisionTraceId, warnings, emptyReason?, schemaVersion: 3 }`. The `cacheHit` field is OMITTED (v3.1+) |
| **AC-3** | `POST /augment` with a body missing `prompt`, `fingerprint`, `activeCatalog`, `tenantId`, or `schemaVersion` returns 400 with `{ error: "validation_error", details: <ZodError issues array> }`. Each missing field is named in the details |
| **AC-4** | `POST /augment` with `schemaVersion: 4` (or any value ≠ 3) returns 400 `validation_error` with detail message `"schemaVersion must be 3"` |
| **AC-5** | `POST /augment` with `fingerprint.agentId: "cursor"` (or any non-canonical value) returns 400 `validation_error` with detail message `"agentId must be one of: claude-code"` (MVP canonical list) |
| **AC-6** | Retrieval returns **≥3 AND ≤5 items** in `matchedSkills/Rules/Personas` combined when the catalog has enough items above the threshold. Verified by integration test that loads a fixture catalog with 20 items + a query that matches 5, asserts `matched.length >= 3 && matched.length <= 5` |
| **AC-7** | Threshold duplo: a candidate passes ONLY if `cosine_similarity >= 0.75` AND `bm25_hits >= 1`. Verified by integration test with controlled embeddings + BM25 fixtures. Items below either gate land in `pruningDecisions.rejectedByFloor[]` with reason `"below_threshold"` |
| **AC-8** | Tiebreak ordering: `matched.sort((a,b) => a.id.localeCompare(b.id))` runs AFTER threshold + top-K, BEFORE byte-string serialization. Verified by unit test on `tiebreak()` helper with 4 items in reverse order → output sorted alphabetically |
| **AC-9** | SHA256 byte-string equality test: two `/augment` requests with identical logical input (same prompt, same context, same activeCatalog, same persona IDs) produce IDENTICAL `systemMessage` field. Verified by integration test that POSTs twice and asserts byte equality. The test uses a fixed catalog fixture to eliminate embedding drift |
| **AC-10** | Tiebreak stress test: a generator script (`test/augment/tiebreak-stress.test.mjs`) generates 1000 `/augment` requests with random cosine scores in `[threshold-eps, threshold+eps]` for the same fixed set of items. Asserts ALL 1000 responses have the SAME `systemMessage` SHA256. Generator runs against an in-process server (or test-double of retrieval) to avoid network overhead |
| **AC-11** | System message structure: the `systemMessage` field is the SHA-256 hex digest of the EXACT 2-block structure that would be sent to Anthropic: `[block1_persona] <cache_control_break> [block2_skills_rules_context]`. Block 1 contains persona(s) text only; Block 2 contains Skills + Rules + context synthesis. Both blocks are marked `cache_control: { type: "ephemeral" }` in the Anthropic request payload (verified by unit test on `buildSystemMessage()` that asserts the structure) |
| **AC-12** | Cache hit verification: the smoke script (`scripts/smoke-augment-server.mjs`) POSTs the same `/augment` request twice. The script then forwards BOTH `systemMessage`s to a real Anthropic API (or a stub that simulates the response with `usage.cache_read_input_tokens`). Asserts the 2nd call's log line shows `usage.cache_read_input_tokens > 0`. The test fixture uses `MiniMax` Anthropic-compatible API (per CLAUDE.md context: no direct Anthropic access; test against the same MiniMax-compatible API or a deterministic stub) |
| **AC-13** | Prompt-only mode: `POST /augment` with `context: null` returns 200. Retrieval runs on `prompt` alone. Matched arrays may be empty (`emptyReason: "low_confidence"` if no matches, `null` if persona matches). Verified by integration test |
| **AC-14** | Active catalog vazio (D-008): `POST /augment` with `activeCatalog: []` returns 200, `systemMessage` is persona-only, `matchedSkills/Rules/Personas: []`, `emptyReason: "no_active_items"`, `warnings: ["activeCatalog is empty — proceeding with persona only"]`. Verified by integration test |
| **AC-15** | Social bypass: `POST /augment` with a social prompt (e.g., "hello, how are you?") returns 200 with `emptyReason: "social"`, all matched arrays empty. Verified by integration test using `isSocial` fixture (Phase 2) |
| **AC-16** | Structured logger: every `/augment` request emits a single-line JSON log with `ts, requestId, tenantId_hashed, latencyMs.{embedding, retrieval, rerank, total}, matchedIds[], systemMessageSha256, usage.{cache_read_input_tokens, cache_creation_input_tokens}`. The log line is parseable by `JSON.parse()`. Verified by integration test that captures stdout and parses the log line |
| **AC-17** | Latency budget: a perf script (`test/augment/perf.test.mjs`) sends 1000 synthetic `/augment` requests and reports `min/median/p95/p99` latency across N≥3 runs. Asserts `median(p50) < 50ms` (no embedding miss) and `p99 < 200ms` (with embedding). The script uses an in-process server with a stubbed retrieval pipeline to isolate server overhead |
| **AC-18** | `/health` endpoint: `GET /health` returns 200 `{ status: "ok", uptime: <seconds>, version: "<pkg version>" }`. Verified by integration test |
| **AC-19** | Claude Code integration guide: `docs/guides/claude-code-baseurl.md` exists with sections: (a) wire `ANTHROPIC_BASE_URL` env var or `.claude/settings.json` override, (b) explain SDK-level smoke (Phase 5a) vs transparent proxy (Phase 5b), (c) example baseURL `http://127.0.0.1:4200`, (d) troubleshooting (`port conflict`, `server not reachable`). Total < 100 lines |
| **AC-20** | Scope guard: `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/` returns empty. The Verifier confirms Phase 1 + Phase 2 source files are byte-identical to baseline. Existing `src/search/**` MAY be touched only for additive bug fixes (e.g., exposing a new helper); rewrites require Verifier approval |
| **AC-21** | Test baseline preservation: `npm test` at repo root reports ≥375 tests passing (207 + 152 + 16 baseline preserved). New tests in `test/augment/*.test.mjs` add to the count (NOT replace) |
| **AC-22** | `npm run typecheck` exits 0 with no new errors. Phase 5a TS files use `strict` + `noUncheckedIndexedAccess` matching Phase 1 baseline |
| **AC-23** | Fastify version is captured in `package.json` `dependencies`. Version is pinned to a recent LTS-grade release (e.g., `^5.x` or `^4.x`). The Verifier checks `npm ls fastify` returns a single resolved version |
| **AC-24** | `Zod` validation schemas live at `src/server/augment/schemas.ts` and are imported by the route handler. The schemas mirror PRD §7.1 shapes exactly (verified by side-by-side comparison) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: Server framework** | **Fastify (option a)** | PRD §8 table explicitly says "Fastify". Phase 1 chose `node:http` for the UI; Phase 5a needs schema validation + JSON perf + plug-in ecosystem for `/augment`. Rejected `node:http` (no validation, manual JSON). Rejected hybrid (Phase 1's 185-test + Phase 3's 16-test baseline prove Node ESM/strip-types handles the import graph without split-stacks) | yes (PRD explicit + dispatch footnote) |
| **A-2: Server package location** | `src/server/**` (NOT a workspace package) | Phase 1 (`src/catalog/**`), Phase 2 (`src/social-detector/**`, `src/fingerprint/**`) all live at root `src/`. Phase 5a reuses `src/search/*` via direct import — `packages/server/` would require either relative imports (`../../src/search/...`) or duplicating the search code. Keeping at root src preserves the import graph | yes (autonomous; matches existing pattern) |
| **A-3: Reuse `src/search/*` calibration residue** | YES, reuse as-is. Add `src/server/augment/pipeline.ts` to orchestrate | `test/search/*` (existing) proves RRF + threshold + tiebreak correctness. Phase 5a wires `fuseRrf`, `searchFts`, `searchVector` into the augment flow. Per CALIBRATION-RESIDUE.md policy, drift findings marked `quarantined` — not rewritten | yes (autonomous; CALIBRATION-RESIDUE policy) |
| **A-4: Fastify version** | `^5.x` (current LTS-grade) | `npm ls fastify` resolution is straightforward; 5.x has the plugin ecosystem Phase 5b needs (`@fastify/cors`, etc.) | yes (autonomous) |
| **A-5: Zod version** | `^3.x` (already in root `package.json` v3.25.76) | No new dep. Reuse existing Zod from Phase 1 | yes (autonomous) |
| **A-6: pino version** | `^9.x` (already in root `package.json` v9.5.0) | No new dep. Use existing pino from root. The server emits structured JSON via `pino()` | yes (autonomous) |
| **A-7: Cache block layout** | Block 1 = `persona(s).text` joined by `\n\n` (stable prefix). Block 2 = `Skills[i].text + Rules[i].text + matchedItems + contextSynthesis` joined by `\n\n` (variable suffix). Each block is a separate element in the `system` array of the Anthropic request payload, marked `cache_control: { type: "ephemeral" }` | PRD §8 invariante 11 mandates 2 blocks. SPEC §IMod-7 + dispatch footnote confirm: persona stable, Skills variable. The `systemMessage` SHA256 is computed over the FULL serialized 2-block structure (both blocks) | yes (PRD explicit + SPEC §IMod-7) |
| **A-8: SystemMessage SHA256 scope** | The `systemMessage` field in `/augment` response = SHA-256 hex of the EXACT JSON-serialized 2-block structure (both blocks). Same input → same hash (D-006 done criterion) | D-006 + ROADMAP done #3. The hash is the cache key for the provider (computed by Anthropic server-side, but Memory Studio logs it for verification) | yes (autonomous; D-006 explicit) |
| **A-9: Social bypass applies to /augment** | YES. `isSocial(prompt)` runs first; if true, skip retrieval, return 200 with persona-only system message + `emptyReason: "social"` | PRD §8 invariante sólida 6 + SPEC §IMod-7. Phase 2's `isSocial` is the gate | yes (PRD explicit) |
| **A-10: Tenant ID hashing** | Server does NOT hash tenantId (SDK already does per Phase 3 R-08). Server receives the hashed `tenantId` and passes it through to the log | Phase 3 SDK applies `hashSha256_16(tenantId)` before sending. Server logs the hash as `tenantId_hashed` | yes (autonomous; Phase 3 contract) |
| **A-11: Anthropic API for cache hit verification** | The smoke test uses the MiniMax Anthropic-compatible API (per CLAUDE.md: no direct Anthropic access in this environment). The API supports `cache_control: ephemeral` and returns `usage.cache_read_input_tokens`. If MiniMax does not surface cache metrics, the test stubs the response with a deterministic `cache_read_input_tokens` value to prove the wiring | CLAUDE.md context + PRD §14.6. The test goal is to verify the WIRING (server logs the field) not the Anthropic-side behavior | yes (autonomous; CLAUDE.md context) |
| **A-12: Active catalog filesystem validation** | Server reads `config/catalog/<id>.yaml` for each ID in `activeCatalog`. Missing files → ID dropped from matched array + `pruningDecisions.rejectedByFloor[]` reason `"id_not_in_catalog"`. The server uses `fs.existsSync()` synchronously (catalog dir is small, <1ms) | PRD §7.1 ("server valida contra filesystem"). Catalog dir is hot in OS page cache after Phase 1's `npm run build-index` | yes (PRD explicit) |
| **A-13: Embedding cache** | The query embedding is computed on every request. Caching query embeddings is deferred to v3.1+ (no PRD/SPEC mandate). For Phase 5a perf, the embedder's ONNX session is reused across requests (warm cache) | Phase 1's `MultilingualE5SmallEmbedder` already keeps the ONNX session warm. No additional caching layer in Phase 5a | yes (autonomous) |
| **A-14: Error handling (fail-open semantics)** | Retrieval failures (FTS5 syntax error, sqlite-vec load failure) → log warning + return 200 with `emptyReason: "timeout"` + persona-only system message. The server NEVER returns 500 for retrieval errors. Validation errors (Zod) → 400 | PRD §2 fail-open principle + SPEC §IMod-8 spirit. Audit write is Phase 5b; in Phase 5a the only "audit" is the structured log line | yes (PRD explicit) |
| **A-15: `requestId` generation** | UUID v4 via `crypto.randomUUID()` (Node 22 built-in). Echoed in response `decisionTraceId` and in the log line | PRD §7.1 (`decisionTraceId`). UUID v4 is collision-free at MVP scale | yes (autonomous) |
| **A-16: Top-K algorithm** | After RRF + threshold, sort by RRF score DESC. Take top-5. Apply tiebreak (id.localeCompare ASC). Truncate to 5 if more than 5. If fewer than 3 pass the threshold, return what passes (with `emptyReason: "low_confidence"`); the assertion `matched.length >= 3 && <= 5` is verified when the catalog has enough above-threshold items | PRD §10.1 item 2 + SPEC §IMod-7 step 5. The 3-5 cap is enforced when the corpus allows it | yes (PRD + SPEC explicit) |
| **A-17: Subchapter breakdown** | YES — 4 subchapters (5a.1 server foundation, 5a.2 retrieval pipeline, 5a.3 tests + smoke, 5a.4 perf + hardening). 13 atomic tasks across 4 subchapters | dispatch footnote "If design yields >15 atomic tasks, return SUBCHAPTER_BREAKDOWN". 13 tasks fits the pattern. Phase 1 used 4 subchapters for 16 tasks; Phase 5a uses 4 for 13 | yes (autonomous; matches Phase 1 pattern) |
| **A-18: Tests location** | `test/augment/*.test.mjs` for new tests. `test/search/*` (existing) is preserved. Root `npm test` globs both. New tests ADD to the 375 baseline; do not replace | CLAUDE.md testing contract + Phase 3 baseline (375 tests) | yes (autonomous; CLAUDE.md explicit) |
| **A-19: Server entry point** | `scripts/augment-server.ts` (mirrors `scripts/ui-server.mjs` pattern). Wired as `npm run augment-server` in root `package.json` | Phase 4 pattern (`scripts/ui-server.mjs`) | yes (autonomous) |
| **A-20: Doc location for integration guide** | `docs/guides/claude-code-baseurl.md` | Standard `docs/guides/` convention for HOWTO docs. Existing repo doesn't have a `docs/` dir yet; this is the first entry | yes (autonomous) |
