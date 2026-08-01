---
date: 2026-08-01
version: 1
description: "Phase 5b — Audit + Endpoints + Security spec. Ships 6 auxiliary endpoints (`/catalog` GET, `/catalog/rebuild` POST, `/audit` GET, `/audit/summary` GET, `/health` enhancement, `/state/toggle` POST) + transparent `/v1/messages` proxy layer for `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` + audit async/fail-open write runtime (D-007 CRITICAL) + empty catalog contract (D-008) hardening + security invariants PRD §10.3.1-4 + R-06 `agentId` restriction pickup (Phase 5a.4 discovery)."
explanation: |
  Phase 5a shipped the FIRST server-side runtime of Memory Studio
  (`/augment` + minimal `/health`). Phase 5b widens the endpoint surface
  from 2 to 7 endpoints (D-009) and wires the runtime pieces that
  Phase 5a deferred: the audit write runtime (D-007), the security
  redaction layer (§10.3.1-4), and the transparent `/v1/messages` proxy
  that lets Claude Code speak directly to Memory Studio via
  `ANTHROPIC_BASE_URL`. Phase 5a.4 flagged a real spec gap
  (`src/server/schema.ts:56-62` had `agentId: z.string()` unrestricted
  despite R-06 requiring `z.literal("claude-code")`); Phase 5b picks up
  that enforcement now that the proxy layer gives Phase 5b visibility
  into non-canonical clients.

  Architectural decisions locked in (PRD v3.4 + SPEC v2 + dispatch):
  - **Audit write runtime (D-007 CRITICAL):** in-memory ring buffer +
    SQLite batch flush (N=100 events OR T=1000ms, whichever first) +
    fail-open on write error (request continues 200, error → stderr,
    event dropped). The buffer module is the only piece that touches
    `audit_events`; the route handlers emit events into it and return.
    SQLite write failures NEVER block request flow (PRD §8 invariante
    nova 15 + §10.2 p50<50ms budget).
  - **Audit row schema (PRD §10.3.1):** the audit event row contains
    ONLY `prompt_hash` (sha256 hex), `matched_ids` (JSON array),
    `pruning_reasons` (JSON typed enum array), `latency_ms` (integer).
    Zero raw prompt/context text. Zero raw `tenantId`. The existing
    `audit_events` table from Phase 1
    (`src/catalog/migrations/001_init.sql:49-60`) already provides the
    Phase-5-ready columns (`fingerprint`, `matched_ids`,
    `pruning_reasons`, `latency_ms`, `redacted_prompt_hash`) — Phase 5b
    wires the writer; the table does NOT need migration.
  - **TenantId hashing (§10.3.2):** the existing
    `hashTenantId()` helper at `src/server/augment.ts:51-54`
    (sha256[0:16]) is the canonical implementation; Phase 5b extracts
    it to `src/server/security/tenant-hash.ts` and re-uses it across
    all 7 endpoints (audit, logs, `/audit` response).
  - **Placeholder redaction (§10.3.3):** a small regex layer in
    `src/server/security/redact.ts` that masks `${SECRET_KEY}=abc123`-
    style placeholders BEFORE the audit pipeline sees them. The test
    suite includes a placeholder-secret injection test (AC-25).
  - **Local-only proxy (§10.3.4):** the `/v1/messages` route forwards
    to the upstream provider URL in `MEMORY_STUDIO_ANTHROPIC_BASE_URL`
    (env var). The server's outbound HTTP client has a strict
    `127.0.0.1`-only check OR allowlist driven by env var; outbound to
    any other host raises a hard error. Verified by tcpdump-style mock
    + a test that asserts zero non-allowlist outbound calls.
  - **Transparent proxy design (Phase 5a.4 T-11 guide evolution):**
    `/v1/messages` accepts the Anthropic Messages API request shape,
    intercepts the `system` field, rewrites it to Memory Studio's
    augmented 2-block structure (calls `/augment` internally — same
    process, no extra hop), forwards to the upstream provider, and
    returns the response with `usage.cache_read_input_tokens`
    captured into the audit event. The proxy is the FIRST consumer of
    the audit buffer (D-007) and the FIRST client of
    `hashTenantId()` in the request path.
  - **R-06 agentId restriction pickup:** tighten `FingerprintSchema`
    at `src/server/schema.ts:56-62` from `agentId: z.string()` to
    `agentId: z.literal("claude-code")`. The schema comment at
    `src/server/schema.ts:12-17` explicitly defers this to Phase 5b —
    the deferral ends here.
  - **Empty catalog contract (D-008) hardening:** the
    `personaOnlyResponse()` helper at `src/server/augment/pipeline.ts:172-203`
    already implements D-008 for the social + activeCatalog vazio
    paths. Phase 5b adds the `critical_confirm` flow for
    `/state/toggle` and verifies the contract end-to-end via
    integration tests (the audit row is the proxy for "forward
    unchanged").

  Subchapter breakdown rationale (4 subchapters, 14 atomic tasks):
    - 5b.1 Audit Foundation: SQLite batch writer + in-memory buffer +
      fail-open (the bedrock; everything else depends on it)
    - 5b.2 Read Endpoints: GET /catalog, GET /audit, GET /audit/summary,
      GET /health enhancement
    - 5b.3 Write Endpoints: POST /catalog/rebuild, POST /state/toggle,
      R-06 agentId restriction
    - 5b.4 Transparent Proxy: /v1/messages route + upstream forwarding
      + cache metric capture + local-only enforcement

  Smoke test strategy:
    - Audit fail-open smoke (`scripts/smoke-audit-failopen.mjs`):
      inject a temporary write error → assert `/augment` returns 200
      with `emptyReason` unchanged and stderr captures the dropped
      event count. Verifies D-007 CRITICAL end-to-end.
    - Proxy local-only smoke (`scripts/smoke-proxy-local-only.mjs`):
      send `/v1/messages` with `MEMORY_STUDIO_ANTHROPIC_BASE_URL`
      pointing at the stub from Phase 5a.3 (in-process, 127.0.0.1);
      assert server rejects any other upstream URL.
    - Placeholder redaction smoke (`scripts/smoke-redact.mjs`):
      POST `/augment` with `prompt = "deploy ${SECRET_KEY}=abc123"` →
      audit row contains `prompt_hash` only, never `abc123` anywhere.

  Test count discipline:
    - Baseline 477 (309 root + 152 UI + 16 SDK from Phase 5a.4).
    - Phase 5b ADDS ~40-60 tests across `test/augment/`,
      `test/server/`, and `scripts/smoke-*.mjs`.
    - All existing tests preserved.
    - `audit_events` table is reused (Phase 1 migration 001) — no DB
      migration in Phase 5b.

  Touch ONLY files under `.specs/features/phase-5b-aux-endpoints/` for
  this planning artifact. Implementation tasks live in `tasks.md` and
  will be executed in a separate Planner→Implementer dispatch.

related:
  - ../../ROADMAP.md
  - ../phase-5a-api-retrieval/{spec,design,tasks}.md
  - ../phase-5a-api-retrieval/validation-phase-5a.4.md
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../architecture/memory-studio.architecture.json
  - ../../../src/server/{boot,index,schema,augment/{route,pipeline,response},health/route}.ts
  - ../../../src/search/{fts,rrf,vector,search,types}.ts
  - ../../../src/catalog/{index,migrations/001_init,db/open}.ts
  - ../../../src/social-detector/index.ts
  - ../../../src/fingerprint/fingerprint.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../scripts/{smoke-server-boot,smoke-augment-server,ui-server}.mjs
  - ../../../test/augment/{schemas,route,route-e2e,pipeline,perf,byte-string-equality,byte-string-determinism,top-k,thresholds,retrieval,augmenter}.test.mjs
  - ../../../.memory-studio/state.json
  - ../../../CLAUDE.md
---

# Phase 5b — Audit + Endpoints + Security — Spec

**Phase:** 5b
**Slug:** `phase-5b-aux-endpoints`
**Source:** `.specs/ROADMAP.md` lines 563-619 (Phase 5b entry)
**Goal:** Ship the auxiliary endpoint surface (D-009: 7 endpoints total) + audit async/fail-open write runtime (D-007 CRITICAL) + empty catalog contract (D-008) hardening + security invariants (PRD §10.3.1-4) + R-06 `agentId` restriction pickup (Phase 5a.4 discovery).
**Estimate:** 3-4h (per ROADMAP)

---

## Architectural Reference

> Farol nodes consumed by this spec (`.specs/architecture/memory-studio.architecture.json` — Módulos 3 + 5):

> **Módulo 3 — Hot Path (síncrono, p50<50ms):**
> - `server` — `@memory-studio/server` (Fastify · 7 endpoints). Phase 5a IMPLEMENTED `/augment` + minimal `/health`. Phase 5b ADDS `/catalog` (GET), `/catalog/rebuild` (POST), `/audit` (GET), `/audit/summary` (GET), `/state/toggle` (POST), `/health` enhancement, and the transparent `/v1/messages` proxy layer. Total endpoints after Phase 5b: **7** (`/augment` + 6 auxiliary).
> - `sdk` — `@memory-studio/sdk` (TS · ~50KB · zero deps). Phase 3 already shipped. Phase 5b is server-side only; the SDK gains no new methods.
> - `audit-buffer` — async+batch+fail-open write runtime. Phase 5b IMPLEMENTS this node. Reads from the in-memory ring buffer, writes batched inserts to `audit_events` (SQLite), drops events on write error (never blocks the request). This is the **runtime** piece Phase 5a deferred — Phase 5a emitted structured pino log lines; Phase 5b adds the SQLite write side.

> **Módulo 5 — Storage:**
> - `sqlite` — SQLite (catalog + audit + intel). Phase 1 created `audit_events` (`src/catalog/migrations/001_init.sql:49-60`) with the Phase-5-ready columns (`fingerprint`, `matched_ids`, `pruning_reasons`, `latency_ms`, `redacted_prompt_hash`). Phase 5b WRITES to this table via the `audit-buffer`. **No new migration needed.**
> - `state-json` — `.memory-studio/state.json` (per-project, git-tracked). Phase 5b WRITES via `/state/toggle`. The toggle handler reads+validates+atomic-writes — concurrent `/state/toggle` calls are serialized by a per-file mutex (or `proper-lockfile`-style pattern).

> **Módulo 4 — Pipeline (cross-reference):**
> - `cache` — provider cache pass-through (SHA256 byte-string → Anthropic cache metrics). Phase 5b's transparent proxy CAPTURES `usage.cache_read_input_tokens` from the upstream response and feeds it to the audit buffer as part of the audit row's `latency_ms` enrichment. No semantic change to the byte-string.

> **Out of farol scope for Phase 5b** (deliberately):
> - `inception` + `fast-agent` + `match-script` — Phase 6.
> - `intel-store` — Phase 6.
> - UI panels (`/audit` panel, `/settings` panel) — Phase 4 already shipped UI; Phase 5b is server-only. The UI consumes the new endpoints.
> - `cacheHit` field in `/augment` response — v3.1+ (PRD §17.1).
> - `feedback`, `discoveries`, `handoff` endpoints — v3.1+.

**Edges built by Phase 5b (Implementer's TODO list):**
- `server → audit-buffer` — `/augment` (and `/v1/messages`) emit audit events into the in-memory buffer
- `audit-buffer → sqlite` — batch flush writes to `audit_events` table
- `server → state-json` — `/state/toggle` reads+validates+atomic-writes the project state file
- `server → catalog (filesystem)` — `/catalog` and `/catalog/rebuild` read/write the YAML catalog dir + `config/catalog.db`
- `server → upstream-anthropic` — `/v1/messages` forwards to `MEMORY_STUDIO_ANTHROPIC_BASE_URL`
- `server → security` — every endpoint passes through `hashTenantId()` + `redactSecrets()` before logging/audit

**Edges NOT built by Phase 5b:**
- `agents → server` via SDK (Phase 3) — already exists
- `agents → server` via hook (v3.1+) — out of scope
- `agents → server` via MCP (v3.1+) — out of scope
- Phase 6 fast-agent fan-in — out of scope

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | **Audit async + fail-open (D-007 CRITICAL):** every `/augment` request enqueues an audit event into an in-memory ring buffer and returns 200 immediately. The buffer flushes to `audit_events` (SQLite) in batches. **Buffer flush trigger: N=100 events OR T=1000ms (whichever first).** SQLite write error during flush → error → stderr, batch dropped, request **NEVER** blocked (PRD §8 invariante nova 15) | PRD §10.3.1 + SPEC §IMod-8 + ROADMAP done #8 (D-007 CRITICAL) |
| **R-02** | **Audit row contains ZERO raw text:** the `audit_events` row for an `/augment` request contains ONLY `redacted_prompt_hash` (sha256 hex of the prompt, 64 chars), `matched_ids` (JSON-encoded string array), `pruning_reasons` (JSON-encoded typed enum array), `latency_ms` (integer). NO `prompt` field, NO `context` field, NO raw `tenantId`. Existing Phase 1 columns (`fingerprint`, `payload`) are populated with metadata only (e.g., `{agentId:"claude-code",sessionId:"hash..."}`) — never with raw text | PRD §10.3.1 + SPEC §IMod-8 + ROADMAP done #9 (zero raw persistence) |
| **R-03** | **`GET /catalog`** returns the full catalog as JSON: `[{id, type, title, text, critical?, is_default?, content_hash, created_at, updated_at, embedding_model_version, embedding_dimensions, has_embedding: true|false}, ...]`. Read-only. Returns 200 with the array. Returns 200 with `[]` when catalog is empty (no error). Bypasses audit (read endpoint) | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #1 |
| **R-04** | **`POST /catalog/rebuild`** is **idempotent** and **safe during concurrent requests**. Idempotency: re-running rebuild produces the same catalog state. Concurrency safety: rebuilding the index while `/augment` reads from `catalog_fts` + `catalog_vec` MUST NOT corrupt the index. Strategy: rebuild writes to a TEMP DB, then renames the DB file (SQLite online backup is the canonical pattern; for sqlite-vec the rebuild swap is a catalog-DB swap with retry on lock). Returns 200 + `{rebuilt: true, count: <N>, durationMs: <ms>}`. Bypasses audit (admin endpoint) | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #2 |
| **R-05** | **`GET /audit`** returns the last N (default 50, max 500) augmentations as redacted JSON: `[{ts, tenantId_hashed, agentId, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash, systemMessageSha256?}, ...]`. **No raw prompt/context text.** Supports `?range=30days` query param. Returns 200 + array | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #3 |
| **R-06** | **`GET /audit/summary`** returns daily rollups: `[{date: "YYYY-MM-DD", count: <N>, avgLatencyMs: <float>, matchedItemsTotal: <N>, topPruningReason: <enum|null>, topMatchedId: <id|null>}, ...]`. The rollups cover the last 30 days by default. Designed for Phase 7a consumption. Returns 200 + array | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #4 (Phase 7a will consume) |
| **R-07** | **`GET /health`** ships an enhancement: returns `{status: "ok", uptime_ms, last_request_ts, request_id, schema_version: 3, audit_buffer: {depth: <N>, capacity: 100, last_flush_ts: <epoch_ms|null>}, catalog: {count: <N>, last_rebuild_ts: <epoch_ms|null>}}`. The `audit_buffer` block surfaces the audit buffer's current depth (how many events pending flush) and last flush timestamp so an operator can spot a stuck buffer. Always 200 (liveness) | PRD §10.4.4 + SPEC §IMod-10 + Phase 5a R-20 + ROADMAP done #5 |
| **R-08** | **`POST /state/toggle`** accepts `{itemId: string, action: "on"|"off", critical_confirm?: string}`. Behavior: (a) read current `.memory-studio/state.json`; (b) resolve `itemId` against the on-disk catalog; (c) if `action === "off"` AND the item is a Rule with `critical=true` AND `critical_confirm` is missing or doesn't equal the item's `critical_confirm_phrase` (loaded from the catalog YAML, default `"OVERRIDE: <id>"`), return **400** with `{error: "critical_confirm_required", itemId, hint: "POST with critical_confirm: 'OVERRIDE: <id>'"}`; (d) otherwise toggle the item on/off in `state.json.activeCatalog`; (e) atomic write (write-temp + rename) so concurrent toggles don't corrupt the file. Returns 200 + `{itemId, action, active: <bool>, stateVersion: <n>}` | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #6 + SPEC User Story §B 14 |
| **R-09** | **Transparent proxy `/v1/messages`:** the server accepts POST `/v1/messages` with the Anthropic Messages API request shape (`{model, max_tokens, system: <string|array>, messages, ...}`). The route handler intercepts the `system` field, builds a `/augment` request internally (same process, sharing the pipeline + audit buffer), rewrites the `system` field to Memory Studio's augmented 2-block structure, forwards to `MEMORY_STUDIO_ANTHROPIC_BASE_URL`, captures `usage.cache_read_input_tokens` from the response, feeds it to the audit buffer, returns the response body. **Upstream URL is sourced EXCLUSIVELY from `MEMORY_STUDIO_ANTHROPIC_BASE_URL` env var** (default: `http://127.0.0.1:<self-port>` to make accidental non-local default impossible) | PRD §3 + SPEC §IMod-17 + Phase 5a R-21 + ROADMAP done #7 (transparent proxy layer) |
| **R-10** | **Local-only proxy enforcement (§10.3.4):** the proxy's outbound HTTP client **rejects** any URL whose host is not `127.0.0.1` / `localhost` / `::1` / an explicit `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` allowlist (comma-separated). The check happens BEFORE the outbound request is constructed. The error is logged to stderr + 502 returned to the client. Verified by integration test that injects a non-allowlisted `MEMORY_STUDIO_ANTHROPIC_BASE_URL` and asserts the 502 response | PRD §10.3.4 + SPEC §IMod-17 + ROADMAP done #10 |
| **R-11** | **Placeholder secret redaction (§10.3.3):** before the audit pipeline computes `redacted_prompt_hash`, a regex layer in `src/server/security/redact.ts` matches placeholder patterns (`${SECRET_KEY}=value`, `password=...`, `token=...`, `api_key=...`) and replaces them with the literal token `<REDACTED>`. The replacement is INVISIBLE to the audit hash computation (the hash is computed over the ORIGINAL prompt — redaction happens for log/storage only). **Verified by AC-25:** a test that POSTs `/augment` with `prompt = "deploy ${SECRET_KEY}=abc123 to prod"` and asserts the audit row contains `prompt_hash` only, never `abc123`, in any column or log line | PRD §10.3.3 + SPEC §IMod-13 invariante 13 + ROADMAP done #9 |
| **R-12** | **R-06 agentId restriction pickup:** tighten `FingerprintSchema.agentId` at `src/server/schema.ts:56-62` from `agentId: z.string()` to `agentId: z.literal("claude-code")`. Any other value (including `null`, missing, or `"cursor"`) returns 400 `validation_error` with detail message `"agentId must be one of: claude-code"`. **The schema comment at `src/server/schema.ts:12-17` documenting the MVP exception is REMOVED** since Phase 5b picks up the enforcement. The Phase 5a.4 test that substituted `missing fingerprint → 400` is REPLACED with `agentId: "cursor" → 400` | PRD §14.4 + SPEC §IMod-13 invariante 13 + Phase 5a R-06 + Phase 5a.4 R-06 DRIFT discovery |
| **R-13** | **Audit async + batch flush (D-007 specifics):** the audit module exposes (a) `enqueue(event)` — push to ring buffer; (b) `flush()` — write pending batch to SQLite, drop on error; (c) `start()` — begin the T=1000ms flush timer; (d) `stop()` — flush remaining + close timer (called from `boot.ts` graceful shutdown). The module is module-scoped (single buffer per server process); multi-process is out of scope (MVP is single-process) | SPEC §IMod-8 + PRD §8 invariante nova 15 |
| **R-14** | **Audit fail-open test surface:** a test fixture at `test/server/audit-failopen.test.mjs` (a) enqueues a batch of audit events; (b) intercepts the SQLite writer with a stub that throws; (c) calls `flush()`; (d) asserts (i) the error propagates to stderr, (ii) the events are DROPPED (not re-tried, not buffered indefinitely), (iii) `enqueue()` continues to accept new events (the buffer is not poisoned) | SPEC §IMod-8 + Phase 5a R-14 fail-open precedent |
| **R-15** | **Performance gate — audit query <100ms / 30 dias (PRD §10.4.3):** `GET /audit?range=30days` returns in <100ms with a dataset of 1000+ rows. Verified by a perf test that seeds 1000 audit rows, queries `?range=30days`, asserts wall-clock <100ms | PRD §10.4.3 + ROADMAP done #11 |
| **R-16** | **Performance gate — `/health` returns 200 (PRD §10.4.4):** already shipped in Phase 5a.1 R-20. Phase 5b verifies the enhancement (audit_buffer + catalog blocks) doesn't regress. Verified by integration test that asserts `status: "ok"` + the new blocks present | PRD §10.4.4 + Phase 5a R-20 + ROADMAP done #5 |
| **R-17** | **Performance gate — Working set <1.5GB / 1h operation (PRD §10.2.3):** measured by a long-running perf test that POSTs 10000 `/augment` requests over 60s, samples `process.memoryUsage().rss` at t=0/30s/60s, asserts rss < 1.5GB at every checkpoint | PRD §10.2.3 + ROADMAP done #12 |
| **R-18** | **Empty catalog contract (D-008) hardening — already implemented in Phase 5a.2:** `/augment` with `activeCatalog: []` returns 200 with persona-only `systemMessage`, `matchedSkills/Rules/Personas: []`, `emptyReason: "no_active_items"`, `warnings: ["activeCatalog is empty — proceeding with persona only"]`, `pruningDecisions` all empty arrays, forward unchanged. **Phase 5b verifies the audit row IS written for the empty-catalog path** (the audit is part of the contract — even empty-catalog requests are recorded). Verified by integration test | PRD §10.1.11 + SPEC §IMod-12 + Phase 5a R-04 + ROADMAP done #7 |
| **R-19** | **Concurrent `/catalog/rebuild` safety:** a load test fires 10 simultaneous `/augment` requests while `/catalog/rebuild` runs in the background. Asserts: (a) all 10 `/augment` requests return 200; (b) the rebuild completes without error; (c) the rebuilt catalog has the same item count as before. Verified by `test/server/catalog-rebuild-concurrency.test.mjs` | PRD §7.2 + SPEC §IMod-10 + ROADMAP done #2 (concurrent request não corrompe index) |
| **R-20** | **`tenantId_hashed` field in audit row + every log line (PRD §10.3.2):** the `audit_events.tenantId_hashed` column (renamed in Phase 2 migration 002 to camelCase) is populated with `sha256(tenantId).slice(0, 16)` for every audit event. Every pino log line that touches `tenantId` uses the SAME hash via the extracted `hashTenantId()` helper (now in `src/server/security/tenant-hash.ts`). Verified by integration test that asserts the audit row's `tenantId_hashed` is exactly 16 hex chars and matches the hash of the request's `tenantId` | PRD §10.3.2 + SPEC §IMod-13 invariante sólida 5 + Phase 2 R-08 |
| **R-21** | **Scope guard — no Phase 1/2/3/4/5a territory touches:** `git diff <baseline>..HEAD -- src/catalog/** src/social-detector/** src/fingerprint/** src/search/** packages/sdk/** packages/ui/**` returns empty. Phase 5b ONLY adds `src/server/**` modules + `scripts/smoke-*.mjs` + `test/server/**` + `test/augment/**` + `docs/guides/**` files | CLAUDE.md testing contract + Phase 5a R-22 + ROADMAP Phase 5b scope |
| **R-22** | **Test baseline preservation:** the 477-test baseline (309 root + 152 UI + 16 SDK from Phase 5a.4) is preserved. New tests live at `test/augment/*.test.mjs` and `test/server/*.test.mjs`. The `test/search/*` suite (existing) continues to pass without modification | CLAUDE.md testing contract + Phase 5a R-23 |

### Out of scope (explicit non-goals)

- **`/feedback`, `/discoveries`, `/handoff`** — v3.1+ (per PRD §7.2 trailing note)
- **`/augment` retrieval algorithm changes** — Phase 5a R-07..R-12 stay unchanged
- **UI panel changes** — Phase 4 already shipped; Phase 5b is server-only
- **Inception híbrida** — Phase 6
- **`cacheHit` field in `/augment` response** — v3.1+ (PRD §17.1)
- **Auth / rate limiting / TLS** — local-only MVP; PRD §11 deferral
- **Multi-tenant** — v4+
- **Adapter OpenAI↔Anthropic** — v3.1+
- **Hook + MCP integration modes** — v3.1+
- **Semantic cache 2-tier** — v3.1+
- **Discovery signals / curator LLM** — v3.2+
- **Long-term memory** — v4+
- **Audit query by `agentId` / `sessionId`** — the `?agentId=` and `?sessionId=` query params are NOT exposed in MVP. Phase 7a can add filters behind a flag (deferral). The raw data IS in the `fingerprint` column (JSON-encoded metadata) — queryable via direct SQL for admin tools.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `npm run augment-server` (already in Phase 5a.1) boots a Fastify server with 7 endpoints registered: `GET /health`, `POST /augment`, `GET /catalog`, `POST /catalog/rebuild`, `GET /audit`, `GET /audit/summary`, `POST /state/toggle`, `POST /v1/messages`. Verified by a unit test on `registerAuditRoute/registerCatalogRoute/registerStateToggleRoute/registerProxyRoute` that asserts all 7 paths are mounted |
| **AC-2** | `GET /catalog` returns 200 + JSON array of catalog items. Each item matches the shape in R-03. Verified by integration test that loads a fixture catalog (3-5 items) and asserts the response is byte-identical to the catalog + embeddings metadata |
| **AC-3** | `GET /catalog` with an empty catalog returns 200 + `[]`. Verified by integration test that clears the catalog and asserts `[]` |
| **AC-4** | `POST /catalog/rebuild` returns 200 + `{rebuilt: true, count: <N>, durationMs: <ms>}`. Re-running rebuild returns 200 with the same `count`. Verified by integration test that fires rebuild twice and asserts both succeed with equal counts |
| **AC-5** | `POST /catalog/rebuild` while `/augment` requests are in flight is safe: 10 simultaneous `/augment` requests during rebuild all return 200; rebuild completes without error. Verified by `test/server/catalog-rebuild-concurrency.test.mjs` (R-19) |
| **AC-6** | `GET /audit` returns 200 + JSON array of last N augmentations. Each row contains ONLY the fields from R-05; no `prompt` field anywhere. Verified by integration test that POSTs 3 `/augment` requests, then asserts `GET /audit` returns 3 rows with no `prompt` key |
| **AC-7** | `GET /audit?range=30days` returns rows from the last 30 days. Verified by integration test that seeds audit rows with varied timestamps |
| **AC-8** | `GET /audit` with no audit events returns 200 + `[]`. Verified by integration test on a fresh DB |
| **AC-9** | `GET /audit/summary` returns 200 + JSON array of daily rollups. Each rollup has the shape from R-06. Verified by integration test that seeds 100 audit rows across 3 dates and asserts the response has 3 rollups with correct counts |
| **AC-10** | `GET /audit/summary` with no data returns 200 + `[]`. Verified by integration test on a fresh DB |
| **AC-11** | `GET /health` (enhanced) returns 200 + `{status: "ok", uptime_ms, last_request_ts, request_id, schema_version: 3, audit_buffer: {depth: 0, capacity: 100, last_flush_ts: <number>}, catalog: {count: <N>, last_rebuild_ts: <number>}}`. Verified by integration test |
| **AC-12** | `POST /state/toggle` with `{itemId: "rule-no-secrets", action: "off"}` (critical rule, no confirmation) returns 400 with `{error: "critical_confirm_required", itemId: "rule-no-secrets", hint: "POST with critical_confirm: 'OVERRIDE: rule-no-secrets'"}`. Verified by integration test |
| **AC-13** | `POST /state/toggle` with `{itemId: "rule-no-secrets", action: "off", critical_confirm: "OVERRIDE: rule-no-secrets"}` returns 200 + `{itemId, action: "off", active: false, stateVersion: <N>}`. The state.json file is updated atomically. Verified by integration test that reads `.memory-studio/state.json` after the toggle |
| **AC-14** | `POST /state/toggle` with `{itemId: "skill-auth-jwt", action: "on"}` (non-critical) returns 200 immediately without `critical_confirm`. Verified by integration test |
| **AC-15** | `POST /state/toggle` with an unknown `itemId` returns 404 with `{error: "item_not_found", itemId}`. Verified by integration test |
| **AC-16** | **Audit async (R-01, D-007):** the `auditBuffer` module is in-memory (no synchronous SQLite write in the `/augment` request path). Verified by a unit test that calls `enqueue()` 100 times, asserts `buffer.depth === 100` BEFORE the timer fires, asserts `buffer.depth === 0` AFTER the timer fires (1000ms wall-clock) |
| **AC-17** | **Audit batch flush (R-13):** the flush trigger fires at N=100 events OR T=1000ms, whichever first. Verified by (a) a unit test that enqueues 100 events, asserts flush within 100ms (whichever fires first); (b) a unit test that enqueues 50 events, waits 1100ms, asserts flush within 100ms (timer fires) |
| **AC-18** | **Audit fail-open (R-01, D-007 CRITICAL):** when the SQLite writer throws (simulated), the events are dropped and the error goes to stderr. The request that triggered the failed enqueue STILL returns 200. Verified by `test/server/audit-failopen.test.mjs` (R-14) that stubs the writer, triggers an error, asserts (a) stderr captures the error message, (b) `enqueue()` after the error still succeeds, (c) no events are buffered indefinitely |
| **AC-19** | **Audit row schema (R-02):** an `/augment` request writes an audit row containing exactly these fields: `ts` (epoch ms), `tenantId_hashed` (16 hex chars), `redacted_prompt_hash` (64 hex chars), `matched_ids` (JSON array string), `pruning_reasons` (JSON array string), `latency_ms` (integer), `fingerprint` (JSON metadata object — agentId/sessionId hashes), `event_type` ("augment"), `payload` (JSON metadata — `systemMessageSha256`, `emptyReason`, `decisionTraceId`). Verified by integration test that reads the audit row via direct SQLite query and asserts the exact field set |
| **AC-20** | **TenantId hashing (R-20, §10.3.2):** the `tenantId_hashed` column in audit_events is exactly 16 hex characters (sha256[0:16] truncation). Verified by integration test that POSTs `/augment` with `tenantId: "tenant-acme-12345"` and asserts `tenantId_hashed === sha256("tenant-acme-12345").slice(0, 16)` |
| **AC-21** | **Placeholder redaction (R-11, §10.3.3):** a prompt containing `${SECRET_KEY}=abc123` produces an audit row where NO column contains the string `abc123` (the hash is over the original prompt, but no field holds `abc123` verbatim). Verified by integration test that POSTs `/augment` with `prompt: "deploy ${SECRET_KEY}=abc123 to prod"` and asserts (a) the audit row exists, (b) `redacted_prompt_hash` is the sha256 of the ORIGINAL prompt (NOT the redacted one — the hash is over the raw bytes), (c) `fingerprint.payload` and `payload` JSON fields do NOT contain `abc123` anywhere |
| **AC-22** | **Transparent proxy `/v1/messages` (R-09):** the route accepts an Anthropic Messages API request, returns a valid response. Verified by integration test that POSTs a fixture request and asserts the response shape matches Anthropic's Messages API (`{id, type, content: [...], model, stop_reason, usage}`) |
| **AC-23** | **Proxy captures `usage.cache_read_input_tokens` (R-09):** when the upstream response includes `usage.cache_read_input_tokens`, the audit row's `fingerprint.payload` (or a dedicated `cache_metrics` column — implementation choice) records the value. Verified by integration test with a stub upstream that returns `cache_read_input_tokens: 42` |
| **AC-24** | **Local-only proxy enforcement (R-10, §10.3.4):** when `MEMORY_STUDIO_ANTHROPIC_BASE_URL` is set to a non-allowlisted host (e.g., `https://api.anthropic.com`), the server refuses to start OR the `/v1/messages` route returns 502. Verified by integration test that starts the server with a non-allowlisted URL and asserts a 502 OR a startup error |
| **AC-25** | **Placeholder redaction test (PRD §10.3.3):** AC-21 covers the prompt-side redaction; AC-25 verifies the SAME redaction applies to `context.scratch` and `lastEvent.payload` (any user-controlled string). Verified by integration test that POSTs `/augment` with `context.scratch: "set ${API_TOKEN}=sk-xxx"` and asserts no `sk-xxx` anywhere in the audit row |
| **AC-26** | **R-06 agentId restriction (R-12):** `POST /augment` with `fingerprint.agentId: "cursor"` returns 400 with `{error: "MISSING_REQUIRED_FIELD", field: "fingerprint.agentId", message: "agentId must be one of: claude-code"}`. The existing Phase 5a.4 substitute test (`missing fingerprint → 400`) is REPLACED with this stricter case. Verified by integration test that exercises both `agentId: "cursor"` (reject) and `agentId: "claude-code"` (accept) |
| **AC-27** | **Audit query perf (R-15, §10.4.3):** `GET /audit?range=30days` returns in <100ms wall-clock with 1000+ rows seeded. Verified by perf test that seeds 1000 rows, fires 10 requests, asserts max wall-clock <100ms |
| **AC-28** | **Working set perf (R-17, §10.2.3):** `process.memoryUsage().rss` stays <1.5GB during 60s of `/augment` load (10000 requests). Verified by perf test that samples rss at t=0/30/60s |
| **AC-29** | **Concurrent rebuild safety (R-19):** `/catalog/rebuild` succeeds while 10 simultaneous `/augment` requests are in flight. Verified by `test/server/catalog-rebuild-concurrency.test.mjs` |
| **AC-30** | **D-008 empty catalog audit row (R-18):** `/augment` with `activeCatalog: []` STILL writes an audit row (the audit is part of the contract). Verified by integration test that POSTs an empty-catalog request, then queries `GET /audit` and asserts the row is present |
| **AC-31** | **Smoke script — audit fail-open (`scripts/smoke-audit-failopen.mjs`):** the script boots the server with a stub SQLite writer that throws on every write, then POSTs 5 `/augment` requests. Asserts: (a) all 5 return 200, (b) stderr captures 5 dropped-event messages, (c) the script exits 0 with `[smoke] PASS (5/5 checks)` |
| **AC-32** | **Smoke script — proxy local-only (`scripts/smoke-proxy-local-only.mjs`):** the script starts the server with `MEMORY_STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:<stub-port>` (stub from Phase 5a.3). Asserts: (a) POST `/v1/messages` with valid request returns the stub's response (cache metric surfaced), (b) restart the server with `MEMORY_STUDIO_ANTHROPIC_BASE_URL=https://api.anthropic.com` and assert the server refuses to start OR `/v1/messages` returns 502 |
| **AC-33** | **Smoke script — placeholder redaction (`scripts/smoke-redact.mjs`):** the script POSTs `/augment` with `prompt: "deploy ${SECRET_KEY}=abc123 to prod"`, then queries `GET /audit` and asserts the response body and the log line do NOT contain `abc123`. Script exits 0 with `[smoke] PASS (3/3 checks)` |
| **AC-34** | **Scope guard (R-21):** `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty. The Verifier confirms Phase 1+2+3+4+5a source files are byte-identical to baseline |
| **AC-35** | **Test baseline preservation (R-22):** `npm test` at repo root reports ≥477 tests passing (309 + 152 + 16 baseline preserved). New tests in `test/augment/*.test.mjs` and `test/server/*.test.mjs` add to the count |
| **AC-36** | `npm run typecheck` exits 0 with no new errors. Phase 5b TS files use `strict` + `noUncheckedIndexedAccess` matching Phase 1 baseline |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: Audit buffer capacity** | 10000 events (the N=100 flush trigger fires on every 100th enqueue; the capacity is a separate, larger ceiling) | 10000 is well above any realistic per-second request rate; the flush timer (T=1000ms) prevents unbounded growth | yes (autonomous; matches D-007 wording) |
| **A-2: Audit flush cadence** | N=100 events OR T=1000ms (whichever first) | ROADMAP done #8 + SPEC §IMod-8 literal wording. The timer starts at server boot, not at first enqueue | yes (ROADMAP explicit) |
| **A-3: Audit row payload column** | The existing `payload` column is JSON-encoded metadata (`{systemMessageSha256, emptyReason, decisionTraceId}`). The `fingerprint` column is JSON-encoded `{agentId, sessionId_hashed, projectPath, gitBranch}`. Both are redacted-only (no raw text) | Matches Phase 1 baseline (`001_init.sql:49-60`) + PRD §10.3.1 zero-raw invariant | yes (PRD explicit) |
| **A-4: Audit `prompt_hash` over original or redacted prompt** | **Original prompt** (no redaction before hash). Redaction is for STORAGE only — the hash is computed over the raw bytes the user sent, so the hash is deterministic regardless of which placeholders the user included | Matches D-007 invariant (hash is the canonical identifier). The redaction test (AC-21, AC-25) checks storage fields, not the hash value | yes (autonomous; matches D-007 done criterion) |
| **A-5: `MEMORY_STUDIO_ANTHROPIC_BASE_URL` default** | **Empty string (proxy disabled by default).** The server boots fine without a proxy; `/v1/messages` returns 503 with `{error: "proxy_disabled", hint: "Set MEMORY_STUDIO_ANTHROPIC_BASE_URL to enable"}` when called without the env var set | Safe default — local-only MVP. Operators opt in to proxy mode by setting the env var | yes (autonomous; conservative) |
| **A-6: `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` default** | `127.0.0.1,localhost,::1` (loopback only) | §10.3.4 hardens proxy to local-only by default. Operators can extend the allowlist with a comma-separated env var | yes (PRD explicit §10.3.4) |
| **A-7: `/v1/messages` upstream protocol** | **Anthropic Messages API** (POST `/v1/messages`). The proxy intercepts the `system` field, builds an internal `/augment` request, rewrites the field, forwards to upstream, returns the response. The `model` field is passed through unchanged | Matches PRD §3 + Phase 5a.4 smoke stub pattern | yes (autonomous; matches Phase 5a.3 stub) |
| **A-8: `/state/toggle` mutex strategy** | A single in-process `Mutex` (Promise-based) serializes writes to `.memory-studio/state.json`. The mutex is module-scoped (single server per process). Multi-process / cluster-safe locking is out of MVP scope (deferred) | MVP is single-process per PRD §11. Phase 7a can introduce `proper-lockfile` if needed | yes (autonomous; matches MVP scope) |
| **A-9: `/state/toggle` `critical_confirm` phrase** | Loaded from the catalog YAML's `critical_confirm_phrase` field if present, else defaults to `"OVERRIDE: <id>"`. The default is stable across runs (deterministic) | Spec §IMod-2 + Phase 1 catalog YAML schema. The default phrase is human-readable and grep-friendly | yes (autonomous; deterministic) |
| **A-10: `/catalog/rebuild` strategy** | **TEMP DB + rename swap.** Rebuild reads `config/catalog/*.yaml`, recomputes embeddings (ONNX), inserts into a TEMP SQLite DB (`config/catalog.db.tmp`), then renames to `config/catalog.db` (atomic on POSIX, near-atomic on Windows). Concurrent `/augment` reads from the OLD DB until the rename completes — the swap is fast (<1s for 100 items) and reads are never blocked. A mutex around the SWAP (not the rebuild) ensures only one rebuild at a time | Standard SQLite online-backup pattern. The mutex scope is the file rename, not the rebuild, so reads stay unblocked | yes (autonomous; standard SQLite pattern) |
| **A-11: `/audit/summary` rollup strategy** | Computed on-demand at request time via SQL aggregation: `SELECT date(ts/1000, 'unixepoch') as date, COUNT(*) as count, AVG(latency_ms) as avgLatencyMs, ... GROUP BY date`. No precomputed rollup table. The query hits `audit_events.ts` (indexed? no — Phase 5b adds an index `idx_audit_events_ts` for the query to stay <100ms) | Simpler than precomputed rollups; the index makes the query fast enough for the §10.4.3 gate. Phase 7a can add materialized rollups if the dataset grows | yes (autonomous; matches PRD §10.4.3) |
| **A-12: Audit index for perf gate** | Phase 5b adds `CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts)` via `src/catalog/migrations/003_audit_events_ts_index.sql` (forward-only, no DOWN) | Matches §10.4.3 perf gate. The index is small (B-tree on a single INTEGER column) | yes (autonomous; standard SQLite perf pattern) |
| **A-13: `/v1/messages` `system` field handling** | If `system` is a string, wrap to `[{type:'text', text: <system>, cache_control:{type:'ephemeral'}}]` for the upstream request (Anthropic accepts both). If `system` is an array, pass through. Memory Studio's interception: always extract the `system` text, build an `/augment` request, rewrite the `system` field to the augmented 2-block structure | Matches Phase 5a.3 stub pattern + Anthropic Messages API spec | yes (autonomous; standard Anthropic API) |
| **A-14: `/v1/messages` audit row** | The proxy writes an audit event identical to `/augment`'s: `{event_type: "messages_proxy", prompt_hash, matched_ids, pruning_reasons, latency_ms, fingerprint, payload}` with `payload.cache_read_input_tokens` populated from the upstream response. The audit buffer is the SINGLE write path for both endpoints | D-007 CRITICAL invariant: every request is audited, regardless of endpoint | yes (autonomous; consistent with §10.3.1) |
| **A-15: Concurrent `/state/toggle` test** | The mutex prevents corruption; the test fires 10 simultaneous toggles and asserts all 10 succeed with monotonic `stateVersion` values | Tests the mutex, not the file system. The mutex is in-process | yes (autonomous; standard concurrent-write test) |
| **A-16: Subchapter breakdown** | YES — 4 subchapters (5b.1 audit foundation, 5b.2 read endpoints, 5b.3 write endpoints + R-06, 5b.4 transparent proxy). 14 atomic tasks across 4 subchapters, 2 Implementer batches of 8+6 | Matches Phase 5a's subchapter pattern (4 subchapters for 13 tasks). Dispatch footnote "If design yields >15 atomic tasks, return SUBCHAPTER_BREAKDOWN" — 14 is borderline; subchapter breakdown chosen for cleaner dependency seams | yes (autonomous; matches Phase 5a pattern) |
| **A-17: Test location** | `test/augment/*.test.mjs` for new audit + proxy tests (consistency with Phase 5a). `test/server/*.test.mjs` for new endpoint integration tests (consistency with Phase 5a.4's `test/server/env-var.test.mjs` + `test/server/smoke-boot.test.mjs`). New tests ADD to the 477 baseline | CLAUDE.md testing contract + Phase 5a baseline | yes (autonomous) |
| **A-18: Smoke script location** | `scripts/smoke-audit-failopen.mjs`, `scripts/smoke-proxy-local-only.mjs`, `scripts/smoke-redact.mjs`. Mirrors Phase 5a.3's `scripts/smoke-augment-server.mjs` structure (boot server on free port, exercise behavior, cleanup with Windows-safe taskkill) | Phase 5a pattern | yes (autonomous) |
| **A-19: `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` parsing** | Comma-separated. Whitespace stripped. Empty entries skipped. Default is `127.0.0.1,localhost,::1`. Validation: each entry is either a hostname (DNS-resolved? no — host literal comparison) or an IPv4/IPv6 literal. Wildcard `*` is REJECTED (security: §10.3.4 forbids any-host allow) | §10.3.4 explicit "nenhum dado sai da máquina do usuário" | yes (autonomous; conservative) |
| **A-20: Audit buffer overflow** | If the ring buffer hits `capacity` (10000), the oldest events are evicted to make room. This is a SAFETY VALVE — the buffer should NEVER hit capacity in normal operation (the flush timer + N-trigger keep it bounded). Verified by a unit test that enqueues 10001 events and asserts the buffer depth stays at ≤capacity | Defensive; fail-open semantics prefer dropping old events to blocking requests | yes (autonomous; defensive) |
