---
date: 2026-08-01
version: 1
description: "Phase 5b atomic tasks. 14 tasks across 4 subchapters (5b.1 audit foundation, 5b.2 read endpoints, 5b.3 write endpoints + R-06, 5b.4 transparent proxy). Each task is one component/file with verification criteria, atomic commit, and traceable to spec R/AC IDs."
explanation: |
  Phase 5b packs into 4 subchapters per SUBCHAPTER_BREAKDOWN pattern
  (Phase 5a precedent; 14 atomic tasks, 2 Implementer batches of 8+6):

    - 5b.1 Audit Foundation: T-01 (audit types + buffer module), T-02
      (placeholder redact), T-03 (SQLite writer + lifecycle), T-04
      (security tenant-hash extraction + perf migration)
    - 5b.2 Read Endpoints: T-05 (GET /catalog), T-06 (GET /audit),
      T-07 (GET /audit/summary), T-08 (GET /health enhancement)
    - 5b.3 Write Endpoints + R-06: T-09 (POST /catalog/rebuild),
      T-10 (POST /state/toggle), T-11 (R-06 agentId schema tightening),
      T-12 (proxy allowlist security + boot wiring)
    - 5b.4 Transparent Proxy: T-13 (POST /v1/messages route),
      T-14 (smoke scripts + Claude Code guide update)

  Subchapter boundaries are at genuine dependency seams:
    - 5b.1: audit runtime bedrock (everything depends on this)
    - 5b.2: read endpoints (depend on 5b.1 for the /health enhancement)
    - 5b.3: write endpoints + R-06 schema tightening + proxy allowlist
    - 5b.4: transparent proxy (consumes 5b.1 audit buffer + 5b.3 allowlist)

  Two Implementer batches fit naturally:
    - Batch 1: subchapters 5b.1 + 5b.2 (T-01..T-08 = 8 tasks)
    - Batch 2: subchapters 5b.3 + 5b.4 (T-09..T-14 = 6 tasks)

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
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../architecture/memory-studio.architecture.json
  - ../../../src/server/{boot,index,schema,augment/{route,pipeline,response},health/route,logger}.ts
  - ../../../src/search/{fts,rrf,vector,search,types,schema,errors}.ts
  - ../../../src/catalog/{index,db/open,migrations/001_init,migrations/002_audit_events_tenant_id_rename}.ts
  - ../../../src/social-detector/index.ts
  - ../../../src/fingerprint/fingerprint.ts
  - ../../../packages/sdk/src/{memory-studio-client,types}.ts
  - ../../../scripts/{smoke-server-boot,smoke-augment-server,ui-server}.mjs
  - ../../../.memory-studio/state.json
  - ../../../CLAUDE.md
---

# Phase 5b — Audit + Endpoints + Security — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `701a2f2` (Phase 5a.4 Verifier PASS — 477 tests: 309 root + 152 UI + 16 SDK)
**Output deliverables:**
- `src/server/audit/**` (new module: 6 files for buffer + writer + redact + query + types + lifecycle)
- `src/server/security/**` (new module: 3 files for tenant-hash + proxy-allowlist + barrel)
- `src/server/routes/**` (new module: 6 files for the 6 new endpoints)
- `src/server/health/route.ts` (MODIFIED: enhanced payload)
- `src/server/schema.ts` (MODIFIED: R-06 tightening)
- `src/server/boot.ts` (MODIFIED: register new routes + audit lifecycle)
- `src/server/index.ts` (MODIFIED: re-export new modules)
- `src/catalog/migrations/003_audit_events_ts_index.sql` (NEW: forward-only perf index)
- `scripts/{smoke-audit-failopen,smoke-proxy-local-only,smoke-redact}.mjs` (3 new smoke scripts)
- `test/server/{audit-buffer,redact,proxy-allowlist,catalog-route,audit-route,state-toggle,messages-proxy,catalog-rebuild-concurrency}.test.mjs` (8 new test files)
- `package.json` gains 3 new smoke scripts (no new deps)
- `docs/guides/claude-code-baseurl.md` MODIFIED (add Phase 5b transparent proxy section)
- NO changes to `src/catalog/{index,db,migrations/001,migrations/002}.ts`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`, `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md`, `tsconfig.json`

---

## Test Coverage Matrix

> Generated from spec acceptance criteria + design test strategy + CLAUDE.md testing contract.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Audit buffer** (`src/server/audit/buffer.ts`) | unit | enqueue, capacity overflow (RING_BUFFER_CAPACITY=10000), count trigger (N=100), time trigger (T=1000ms), fail-open on writer error, getDepth/getLastFlushTs | `test/server/audit-buffer.test.mjs` | `npm test -- test/server/audit-buffer.test.mjs` |
| **Audit redact** (`src/server/audit/redact.ts`) | unit | Placeholder patterns (`${SECRET_KEY}=abc123`, `password=...`, `token=...`, `api_key=...`, `sk-...`), no-placeholder passthrough, multiple placeholders, key overlap | `test/server/redact.test.mjs` | `npm test -- test/server/redact.test.mjs` |
| **Audit writer** (`src/server/audit/writer.ts`) | unit | Better-sqlite3 batch insert (transaction), error isolation, exact field set per R-02 | `test/server/audit-buffer.test.mjs` (writer subtest) | `npm test -- test/server/audit-buffer.test.mjs` |
| **Audit query** (`src/server/audit/query.ts`) | unit + integration | GET /audit payload (redacted only), GET /audit/summary rollups (GROUP BY date), range filter | `test/server/audit-route.test.mjs` | `npm test -- test/server/audit-route.test.mjs` |
| **Tenant hash** (`src/server/security/tenant-hash.ts`) | unit | sha256[0:16] truncation, null/undefined handling | `test/server/redact.test.mjs` (tenant-hash subtest) | `npm test -- test/server/redact.test.mjs` |
| **Proxy allowlist** (`src/server/security/proxy-allowlist.ts`) | unit | Loopback allow (127.0.0.1, localhost, ::1), reject non-loopback, wildcard rejection, CSV parsing, edge cases (invalid URL, port in URL) | `test/server/proxy-allowlist.test.mjs` | `npm test -- test/server/proxy-allowlist.test.mjs` |
| **GET /catalog** (`src/server/routes/catalog-list.ts`) | integration | Full catalog + embeddings metadata, empty catalog returns `[]`, no audit enqueue (read-only) | `test/server/catalog-route.test.mjs` | `npm test -- test/server/catalog-route.test.mjs` |
| **POST /catalog/rebuild** (`src/server/routes/catalog-rebuild.ts`) | integration | Idempotent rebuild, returns `{rebuilt, count, durationMs}`, audit event `catalog_rebuild` enqueued, concurrent safety (10× /augment during rebuild) | `test/server/catalog-route.test.mjs` + `test/server/catalog-rebuild-concurrency.test.mjs` | `npm test -- test/server/catalog-route.test.mjs` + `npm test -- test/server/catalog-rebuild-concurrency.test.mjs` |
| **GET /audit** (`src/server/routes/audit-list.ts`) | integration | Last N rows (default 50, max 500), redacted only (no `prompt` field), `?range=30days` filter, empty result, perf gate <100ms / 30days / 1000 rows | `test/server/audit-route.test.mjs` | `npm test -- test/server/audit-route.test.mjs` |
| **GET /audit/summary** (`src/server/routes/audit-summary.ts`) | integration | Daily rollups with shape `{date, count, avgLatencyMs, matchedItemsTotal, topPruningReason, topMatchedId}`, multi-day dataset, empty result | `test/server/audit-route.test.mjs` | `npm test -- test/server/audit-route.test.mjs` |
| **GET /health** (`src/server/health/route.ts` MODIFIED) | integration | Enhanced payload with `audit_buffer.{depth, capacity, last_flush_ts}` and `catalog.{count, last_rebuild_ts}`, always 200 | `test/augment/health.test.mjs` (MODIFIED) | `npm test -- test/augment/health.test.mjs` |
| **POST /state/toggle** (`src/server/routes/state-toggle.ts`) | integration | Critical rule without `critical_confirm` → 400, with `critical_confirm` → 200, non-critical rule → 200 immediately, unknown `itemId` → 404, atomic write, mutex serialization (10× concurrent → monotonic stateVersion) | `test/server/state-toggle.test.mjs` | `npm test -- test/server/state-toggle.test.mjs` |
| **POST /v1/messages** (`src/server/routes/messages-proxy.ts`) | integration | Forward to stub upstream, capture cache metrics in audit row, redact before audit, proxy-disabled 503, allowlist 502, malformed Anthropic request 400 | `test/server/messages-proxy.test.mjs` | `npm test -- test/server/messages-proxy.test.mjs` |
| **R-06 agentId** (`src/server/schema.ts` MODIFIED) | unit + integration | agentId: "claude-code" accepts, agentId: "cursor" rejects 400 with `"agentId must be one of: claude-code"`, missing agentId rejects, schema comment at lines 12-17 removed | `test/augment/schemas.test.mjs` (MODIFIED, replaces Phase 5a.4 substitute test) | `npm test -- test/augment/schemas.test.mjs` |
| **Audit async integration** | integration | Real server + 100 events → flush within 100ms; 50 events → flush after 1100ms (timer) | `test/server/audit-buffer.test.mjs` | `npm test -- test/server/audit-buffer.test.mjs` |
| **Audit fail-open** | integration | Stub writer throws → events dropped, stderr captured, enqueue after error succeeds | `test/server/audit-buffer.test.mjs` + `scripts/smoke-audit-failopen.mjs` | `npm test -- test/server/audit-buffer.test.mjs` + `node scripts/smoke-audit-failopen.mjs` |
| **Working set perf** | benchmark | 10000 requests over 60s, sample rss at t=0/30/60s, assert <1.5GB | `test/server/audit-buffer.test.mjs` (memory subtest) | `npm test -- test/server/audit-buffer.test.mjs` |
| **Smoke audit fail-open** | e2e | Boot server with stub writer, POST 5 /augment, assert all 200 + stderr captures dropped count | `scripts/smoke-audit-failopen.mjs` | `node scripts/smoke-audit-failopen.mjs` |
| **Smoke proxy local-only** | e2e | Boot with allowed URL → 200; boot with disallowed URL → 502 or startup error | `scripts/smoke-proxy-local-only.mjs` | `node scripts/smoke-proxy-local-only.mjs` |
| **Smoke redact** | e2e | POST /augment with placeholder, assert audit row has no `abc123` anywhere | `scripts/smoke-redact.mjs` | `node scripts/smoke-redact.mjs` |
| **TypeScript contract** | type gate only | All types strict + `noUncheckedIndexedAccess`; ESM exports; no `any` leaks | All `src/server/audit/**` + `src/server/security/**` + `src/server/routes/**` | `npm run typecheck` |
| **Scope guard** | scope check | `git diff 701a2f2..HEAD -- src/catalog/index.ts src/catalog/db/ src/catalog/migrations/001_init.sql src/catalog/migrations/002_audit_events_tenant_id_rename.sql src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty (the new migration `003_audit_events_ts_index.sql` is a NEW file, not a modification) | (git) | manual |
| **Test baseline preservation** | regression | `npm test` reports ≥477 + new tests passing (target ≥520). No skipped/pending tests | All `test/server/**` + `test/augment/**` | `npm test` |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM) + Phase 5a test patterns (`node --test`, ESM imports, `:memory:` better-sqlite3, Windows-safe taskkill pattern).

---

## Gate Check Commands

> Generated from `package.json` + `CLAUDE.md` testing contract.

| Gate Level | When to Use | Command |
|---|---|---|
| **Quick** | After tasks with unit tests only (T-01, T-02, T-04 partial, T-11) | `npm test -- test/server/` |
| **Full** | After tasks with integration/e2e tests (T-03, T-05..T-10, T-12..T-14) | `npm test` |
| **Typecheck** | After any TS change | `npm run typecheck` |
| **Smoke (audit fail-open)** | After T-13 (proxy done) | `node scripts/smoke-audit-failopen.mjs` |
| **Smoke (proxy local-only)** | After T-13 | `node scripts/smoke-proxy-local-only.mjs` |
| **Smoke (redact)** | After T-02 + T-03 | `node scripts/smoke-redact.mjs` |
| **Smoke (augment-server)** | After T-12 (regression check) | `node scripts/smoke-augment-server.mjs` |
| **Perf** | After T-03 (audit async) + T-06 (audit query) | `node --test test/server/audit-buffer.test.mjs test/server/audit-route.test.mjs` |
| **Build** | After phase completion (T-14, end of phase) | `npm test && npm run typecheck && npm run catalog:load && npm run augment-server &` + all 4 smoke scripts |
| **Scope guard** | After T-14 (end of phase) | `git diff 701a2f2..HEAD -- src/catalog/index.ts src/catalog/db/ src/catalog/migrations/001_init.sql src/catalog/migrations/002_audit_events_tenant_id_rename.sql src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty |

**Note:** Root `npm test` includes `test/server/**/*.test.mjs` (glob pattern matches). 477-test baseline preserved.

---

## Execution Plan

Four subchapters run sequentially. Each subchapter is ≤ 4 tasks. Whole Phase 5b = 2 Implementer batches.

```
Subchapter 5b.1 (Audit Foundation):       T-01 → T-02 → T-03 → T-04
                                                       ↓
Subchapter 5b.2 (Read Endpoints):                T-05 → T-06 → T-07 → T-08
                                                                              ↓
Subchapter 5b.3 (Write Endpoints + R-06):             T-09 → T-10 → T-11 → T-12
                                                                                            ↓
Subchapter 5b.4 (Transparent Proxy):                                              T-13 → T-14
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 5b.1 + 5b.2 | T-01..T-08 (8 tasks) | Worker A (Implementer sub-agent) |
| **Batch 2** | 5b.3 + 5b.4 | T-09..T-14 (6 tasks) | Worker B (Implementer sub-agent) |
| **Validation** | (all) | (all 14) | Worker C (Verifier sub-agent) — fresh, evidence-or-zero |

Two batches run sequentially; Validation runs once after Batch 2 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 5b.1 — Audit Foundation

#### T-01: Audit types module + AuditRingBuffer (in-memory buffer + batch flush trigger)

**Files:** `src/server/audit/types.ts` (new), `src/server/audit/buffer.ts` (new)

**Implements:**
- `src/server/audit/types.ts`:
  - `AuditEvent` interface matching the audit row schema (R-02): `{ts, tenantIdHashed, redactedPromptHash, matchedIds, pruningReasons, latencyMs, fingerprint, payload, eventType}` where `eventType` is `'augment' | 'messages_proxy' | 'catalog_rebuild' | 'state_toggle'`.
  - `AuditRow` interface mirroring the SQLite column shape for type-safety in `writer.ts`.
  - `AuditWriter` interface: `writeBatch(events: ReadonlyArray<AuditEvent>): Promise<void>`.
- `src/server/audit/buffer.ts`:
  - Module-scoped singleton `AuditRingBuffer` class.
  - Constants: `FLUSH_COUNT_TRIGGER = 100`, `FLUSH_TIME_MS = 1000`, `RING_BUFFER_CAPACITY = 10000`.
  - `enqueue(event: AuditEvent): void` — pushes to the buffer; if buffer reaches `FLUSH_COUNT_TRIGGER`, calls `flush('count-trigger')`; if no timer is running, starts a `setTimeout(flush, FLUSH_TIME_MS)`.
  - `flush(reason: 'count-trigger' | 'time-trigger' | 'shutdown'): Promise<void>` — atomically splices the current buffer into a batch, clears the timer, calls `this.writer.writeBatch(batch)` in a try/catch. On error: `console.error('[audit] write failed...')` with the dropped count; sets `lastFlushTs = null` to signal stuck.
  - `getDepth(): number` returns the current buffer depth.
  - `getLastFlushTs(): number | null` returns the last successful flush epoch ms (or null if a flush has failed).
  - **Safety valve:** if `buffer.length >= RING_BUFFER_CAPACITY`, shift the oldest event and log `[audit] buffer at capacity (10000); oldest event dropped` to stderr.
  - Constructor takes `AuditWriter` as injected dependency (test-friendly).

**Depends on:** none (first task)

**Verification:**
- `npm test -- test/server/audit-buffer.test.mjs` — 8+ test cases:
  - Empty buffer → `getDepth() === 0`
  - Single enqueue → `getDepth() === 1`, no immediate flush (count not reached)
  - 100 enqueues → flush fires within 100ms (count trigger)
  - 50 enqueues → no immediate flush, flush after ~1100ms (time trigger)
  - Writer throws → events dropped, error in stderr, `enqueue()` after error still succeeds
  - 10001 enqueues → oldest event dropped (capacity safety valve)
  - `getLastFlushTs()` returns epoch ms after success, null after failure
  - Concurrent enqueue during flush → no events lost (splice is the sync primitive)
- `npm run typecheck` exits 0.
- Buffer module re-exported from `src/server/index.ts` (additive export; existing exports preserved).

**Commit:** `feat(audit): ring buffer + batch flush trigger (N=100 OR T=1000ms) + fail-open (phase 5b T-01)`

**Trace:** R-01, R-13, AC-16, AC-17

---

#### T-02: Placeholder secret redaction (§10.3.3) + redact unit tests

**Files:** `src/server/audit/redact.ts` (new), `test/server/redact.test.mjs` (new)

**Implements:**
- `src/server/audit/redact.ts`:
  - `PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp>` constant with 4 patterns:
    1. `/\$\{[A-Z_][A-Z0-9_]*\}=[^\s]+/g` — `${SECRET_KEY}=abc123`
    2. `/\b(password|token|api_key|secret_key)\s*=\s*[^\s]+/gi` — `password=...`
    3. `/sk-[A-Za-z0-9_-]{20,}/g` — `sk-ant-...` Anthropic API key format
    4. `/\bBearer\s+[A-Za-z0-9._-]{20,}/g` — `Bearer eyJ...` JWT/HTTP bearer
  - `redactPlaceholders(text: string): string` — applies each pattern in sequence, replacing matches with the literal `<REDACTED>`.
  - `redactObjectRecursive(obj: unknown): unknown` — recursively walks an object's string leaves and redacts them. Used for `fingerprint.payload` JSON fields.
  - **Critical invariant:** the function returns a NEW string/object (no mutation of input).
- `test/server/redact.test.mjs`:
  - 10+ test cases:
    - `${SECRET_KEY}=abc123` → `<REDACTED>`
    - `password=hunter2` → `<REDACTED>`
    - `api_key=sk-1234567890abcdef1234` → `<REDACTED>`
    - `sk-ant-abcdefghijklmnop1234567890` → `<REDACTED>`
    - `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0` → `<REDACTED>`
    - Plain text with no placeholders → unchanged
    - Multiple placeholders in one string → all replaced
    - Key overlap (`SECRET_KEY` vs `KEY`) → both replaced correctly
    - Empty string → empty string
    - Recursive object: `{a: "password=x", b: {c: "sk-..."}}` → both leaves redacted

**Depends on:** none (pure module)

**Verification:**
- `npm test -- test/server/redact.test.mjs` — 10+ cases, all pass.
- `npm run typecheck` exits 0.
- Module re-exported from `src/server/audit/index.ts` (new barrel) or directly from `src/server/index.ts`.

**Commit:** `feat(security): placeholder secret redaction (§10.3.3) + recursive object walker (phase 5b T-02)`

**Trace:** R-11, AC-21, AC-25

---

#### T-03: Audit SQLite batch writer + lifecycle (start/stop) + perf index migration

**Files:** `src/server/audit/writer.ts` (new), `src/server/audit/lifecycle.ts` (new), `src/catalog/migrations/003_audit_events_ts_index.sql` (new), `src/server/boot.ts` (MODIFIED)

**Implements:**
- `src/server/audit/writer.ts`:
  - `createBetterSqliteAuditWriter(db: Database): AuditWriter` — creates a prepared statement `INSERT INTO audit_events (ts, "tenantId_hashed", event_type, payload, fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` and wraps it in a `db.transaction()` for atomicity.
  - `writeBatch(events)` — runs the transaction. On any error, the transaction rolls back and the error propagates to the caller's catch (fail-open).
- `src/server/audit/lifecycle.ts`:
  - `initAuditBuffer(db: Database): AuditBuffer` — module-scoped singleton initialization. Creates the writer, wraps it in the buffer, starts the lifecycle hooks.
  - `getAuditBuffer(): AuditBuffer | null` — returns the singleton (or null if not initialized).
  - `startAuditBuffer(): void` — placeholder for now (the buffer's timer is lazy; no startup needed).
  - `stopAuditBuffer(): Promise<void>` — calls `buffer.flush('shutdown')` to drain remaining events on graceful shutdown.
- `src/catalog/migrations/003_audit_events_ts_index.sql` (NEW forward-only):
  ```sql
  -- Phase 5b — 003_audit_events_ts_index.sql
  --
  -- Adds a B-tree index on audit_events.ts to make the §10.4.3 perf
  -- gate (audit query <100ms / 30 days) achievable at scale. The index
  -- is small (~24 bytes per row on a single INTEGER column) and
  -- negligible compared to the audit_events payload.
  --
  -- This migration is forward-only (no DOWN script) per Phase 1.2
  -- policy: the catalog has no rollback mechanism. The index is
  -- additive; existing queries are unaffected.
  
  CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts);
  ```
- `src/server/boot.ts` MODIFIED:
  - Imports `getAuditBuffer`, `initAuditBuffer`, `stopAuditBuffer`.
  - In `createServer()`: calls `initAuditBuffer(db)` BEFORE `app.listen()`.
  - In the `SIGINT`/`SIGTERM` handlers (lines 207-212): calls `await stopAuditBuffer()` BEFORE `handle.close()`.

**Depends on:** T-01 (writer uses AuditBuffer pattern)

**Verification:**
- `npm test -- test/server/audit-buffer.test.mjs` — extended with writer subtests:
  - Writer inserts exactly 9 columns per row (matching `001_init.sql:49-60`)
  - Transaction rolls back on partial failure (verified by stub-throw + assert rollback)
  - 100 inserts complete in <50ms (perf check)
- `npm run typecheck` exits 0.
- Manual smoke: `node --experimental-strip-types --no-warnings src/server/boot.ts`, send `/augment` 3 times, then `sqlite3 .memory-studio/catalog.db 'SELECT count(*) FROM audit_events'` → returns 3.
- Scope guard check: `git diff 701a2f2..HEAD -- src/catalog/migrations/001_init.sql src/catalog/migrations/002_audit_events_tenant_id_rename.sql` returns empty (the new file `003_audit_events_ts_index.sql` is a NEW file, not a modification).

**Commit:** `feat(audit): SQLite batch writer + lifecycle hooks + perf index migration (phase 5b T-03)`

**Trace:** R-01, R-13, R-15, AC-18, AC-19

---

#### T-04: Tenant-hash extraction + security barrel + audit query helpers (read-side scaffolding)

**Files:** `src/server/security/tenant-hash.ts` (new), `src/server/security/index.ts` (new), `src/server/audit/query.ts` (new)

**Implements:**
- `src/server/security/tenant-hash.ts`:
  - `hashTenantId(tenantId: string | undefined | null): string | null` — extracted verbatim from `src/server/augment.ts:51-54` (sha256[0:16] truncation).
  - **Re-exported** from `src/server/augment.ts` for backward compat (the existing call site stays green).
- `src/server/security/index.ts`:
  - Barrel: re-exports `hashTenantId` from `./tenant-hash.ts` and (in T-12) `checkProxyAllowlist` from `./proxy-allowlist.ts`.
- `src/server/audit/query.ts`:
  - `queryAuditEvents(db: Database, opts: { limit?: number, rangeDays?: number }): ReadonlyArray<AuditRow>` — reads from `audit_events` ordered by `ts DESC` (uses `idx_audit_events_ts`), filters by `ts >= now - rangeDays*86400_000` if `rangeDays` is set. Default `limit=50`, `rangeDays=undefined` (all time).
  - `queryAuditSummary(db: Database, opts: { rangeDays?: number }): ReadonlyArray<DailyRollup>` — `SELECT date(ts/1000, 'unixepoch') as date, COUNT(*) as count, AVG(latency_ms) as avgLatencyMs, SUM(json_array_length(matched_ids)) as matchedItemsTotal FROM audit_events WHERE ts >= ? GROUP BY date ORDER BY date DESC`. The `topPruningReason` and `topMatchedId` are computed via subqueries (one per row in the OUTER loop) — verified to stay <100ms for 30 days / 1000 rows.

**Depends on:** T-01 (query uses AuditRow type)

**Verification:**
- `npm test -- test/server/redact.test.mjs` — extended with tenant-hash subtest:
  - `hashTenantId("tenant-acme-12345")` returns 16 hex chars
  - `hashTenantId(undefined)` returns `null`
  - `hashTenantId(null)` returns `null`
  - `hashTenantId("")` returns `null`
  - Same input → same output (determinism)
- `npm test -- test/server/audit-route.test.mjs` — extended with query subtests:
  - Empty DB → `queryAuditEvents` returns `[]`
  - 100 rows seeded → `queryAuditEvents({limit: 50})` returns 50 most recent
  - 100 rows with varied timestamps → `queryAuditEvents({rangeDays: 30})` returns rows in last 30 days
  - `queryAuditSummary` returns rollups grouped by date with correct counts
- `npm run typecheck` exits 0.

**Commit:** `feat(security): tenantId hash extraction + audit query helpers (read-side scaffolding) (phase 5b T-04)`

**Trace:** R-05, R-06, R-15, R-20, AC-6, AC-7, AC-9, AC-20

---

### Subchapter 5b.2 — Read Endpoints

#### T-05: `GET /catalog` endpoint handler

**File:** `src/server/routes/catalog-list.ts` (new), `test/server/catalog-route.test.mjs` (new, partial)

**Implements:**
- `src/server/routes/catalog-list.ts`:
  - `registerCatalogListRoute(app: FastifyInstance, opts: { db: Database }): Promise<void>`
  - Route `GET /catalog` returns 200 + JSON array of catalog items with the shape from R-03: `[{id, type, title, text, critical?, is_default?, content_hash, created_at, updated_at, embedding_model_version?, embedding_dimensions?, has_embedding: true|false}, ...]`.
  - Joins `catalog` + `embeddings` tables (LEFT JOIN to include items without embeddings).
  - Returns `[]` (not an error) when the catalog is empty.
  - **No audit enqueue** (read-only endpoint).
- `src/server/boot.ts` MODIFIED (minor): adds `await registerCatalogListRoute(app, { db })` after `registerHealthRoute`.

**Depends on:** T-04 (uses `db: Database` from the boot wiring pattern)

**Verification:**
- `npm test -- test/server/catalog-route.test.mjs` — 4+ cases:
  - Empty catalog → 200 + `[]`
  - Catalog with 5 items → 200 + 5 items, each with the spec fields
  - Items without embeddings → `has_embedding: false`, `embedding_dimensions: null`
  - Catalog sorted by `id ASC` (deterministic)
- `npm run typecheck` exits 0.
- Manual: `curl http://127.0.0.1:<port>/catalog` returns the array.

**Commit:** `feat(route): GET /catalog endpoint (read-only, full catalog + embeddings metadata) (phase 5b T-05)`

**Trace:** R-03, AC-2, AC-3

---

#### T-06: `GET /audit` endpoint handler + perf gate verification

**File:** `src/server/routes/audit-list.ts` (new), `test/server/audit-route.test.mjs` (extended)

**Implements:**
- `src/server/routes/audit-list.ts`:
  - `registerAuditListRoute(app: FastifyInstance, opts: { db: Database }): Promise<void>`
  - Route `GET /audit` accepts `?limit=N` (default 50, max 500) and `?range=Ndays` (default 30, max 365).
  - Calls `queryAuditEvents(db, { limit, rangeDays })`.
  - Returns 200 + JSON array. **CRITICAL:** the response shape MUST NOT include any raw `prompt` / `context` / raw `tenantId` field. The `tenantId_hashed` column is the ONLY tenant identifier.
  - Maps `AuditRow` to the public response: `{ts, tenantId_hashed, agentId (from fingerprint JSON), sessionId_hashed (from fingerprint JSON), matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash, systemMessageSha256? (from payload JSON)}`.
  - **No audit enqueue** (read-only endpoint).
- `test/server/audit-route.test.mjs` extended:
  - **Perf subtest:** seed 1000 rows, fire 10 GET /audit?range=30days requests, assert max wall-clock <100ms.

**Depends on:** T-04 (uses `queryAuditEvents`)

**Verification:**
- `npm test -- test/server/audit-route.test.mjs` — 6+ cases:
  - Empty audit table → 200 + `[]`
  - 5 rows seeded → 200 + 5 rows, NO `prompt` field anywhere
  - `?limit=2` → 2 most recent rows
  - `?limit=600` → clamped to 500
  - `?range=7days` with rows from various dates → only rows in last 7 days
  - **Perf gate:** 1000 rows seeded, 10 requests, max wall-clock <100ms
- `npm run typecheck` exits 0.

**Commit:** `feat(route): GET /audit endpoint (last N augmentations, redacted, perf <100ms) (phase 5b T-06)`

**Trace:** R-02, R-05, R-15, AC-6, AC-7, AC-8, AC-27

---

#### T-07: `GET /audit/summary` endpoint handler (daily rollups)

**File:** `src/server/routes/audit-summary.ts` (new), `test/server/audit-route.test.mjs` (extended)

**Implements:**
- `src/server/routes/audit-summary.ts`:
  - `registerAuditSummaryRoute(app: FastifyInstance, opts: { db: Database }): Promise<void>`
  - Route `GET /audit/summary` accepts `?range=Ndays` (default 30, max 365).
  - Calls `queryAuditSummary(db, { rangeDays })`.
  - Returns 200 + JSON array. Shape per R-06: `[{date: "YYYY-MM-DD", count, avgLatencyMs, matchedItemsTotal, topPruningReason, topMatchedId}, ...]`.
  - **No audit enqueue** (read-only endpoint).
- `test/server/audit-route.test.mjs` extended:
  - **Empty result case:** fresh DB → 200 + `[]`
  - **Multi-day rollup case:** seed 100 rows across 3 dates → response has 3 rollups with correct counts
  - **Range filter:** rows outside the range are excluded

**Depends on:** T-04 (uses `queryAuditSummary`)

**Verification:**
- `npm test -- test/server/audit-route.test.mjs` — 3+ new cases (above).
- `npm run typecheck` exits 0.

**Commit:** `feat(route): GET /audit/summary endpoint (daily rollups, Phase 7a consumption) (phase 5b T-07)`

**Trace:** R-06, AC-9, AC-10

---

#### T-08: `GET /health` enhancement (audit_buffer + catalog blocks)

**File:** `src/server/health/route.ts` (MODIFIED), `test/augment/health.test.mjs` (MODIFIED)

**Implements:**
- `src/server/health/route.ts`:
  - Imports `getAuditBuffer` from `../audit/lifecycle.ts`.
  - Imports `queryAuditEvents` (or a new lightweight helper `getCatalogSummary`) for the catalog block.
  - The new `HealthResponse` shape (R-07): `{status: 'ok', uptime_ms, last_request_ts, request_id, schema_version: 3, audit_buffer: {depth, capacity: 100, last_flush_ts: <epoch_ms|null>}, catalog: {count, last_rebuild_ts: <epoch_ms|null>}}`.
  - The `last_rebuild_ts` is sourced from a small `state` table OR a `.memory-studio/rebuild-timestamp` file. **For MVP simplicity:** store the last rebuild timestamp in module-scoped state in `src/server/routes/catalog-rebuild.ts` and read it from there. (No new DB column needed.)
- `test/augment/health.test.mjs` extended:
  - Existing cases (status: 'ok', uptime > 0) still pass.
  - New case: response includes `audit_buffer.depth` (numeric), `audit_buffer.capacity` (100), `catalog.count` (numeric).
  - New case: after `auditBuffer.enqueue()` is called directly (test-only hook), `audit_buffer.depth` reflects the change.

**Depends on:** T-03 (uses `initAuditBuffer` from boot wiring), T-09 (`last_rebuild_ts` set by `/catalog/rebuild`)

**Verification:**
- `npm test -- test/augment/health.test.mjs` — extended cases pass.
- `npm run typecheck` exits 0.

**Commit:** `feat(health): enhanced GET /health payload (audit_buffer + catalog blocks per D-009) (phase 5b T-08)`

**Trace:** R-07, R-16, AC-11

---

### Subchapter 5b.3 — Write Endpoints + R-06

#### T-09: `POST /catalog/rebuild` endpoint handler (TEMP DB + atomic rename + concurrent safety)

**File:** `src/server/routes/catalog-rebuild.ts` (new), `test/server/catalog-route.test.mjs` (extended), `test/server/catalog-rebuild-concurrency.test.mjs` (new)

**Implements:**
- `src/server/routes/catalog-rebuild.ts`:
  - `registerCatalogRebuildRoute(app: FastifyInstance, opts: { db: Database, catalogDir: string }): Promise<void>`
  - Route `POST /catalog/rebuild` rebuilds the index:
    1. Acquires a rebuild mutex (Promise-based, module-scoped).
    2. Reads `config/catalog/*.yaml`, computes embeddings via `MultilingualE5SmallEmbedder.encode()`.
    3. Writes to TEMP DB `config/catalog.db.tmp` (open + populate + close).
    4. On success: atomic rename `config/catalog.db.tmp → config/catalog.db` (POSIX `rename`, Windows `fs.renameSync`).
    5. Records `last_rebuild_ts = Date.now()` in module-scoped state (consumed by `/health`).
    6. Enqueues audit event `{eventType: 'catalog_rebuild', payload: {itemCount, durationMs}}`.
    7. Releases the mutex.
    8. Returns 200 + `{rebuilt: true, count: itemCount, durationMs}`.
  - **Concurrent safety:** while the rebuild is in progress, `/augment` reads from the OLD `config/catalog.db`. The atomic rename is fast (~10ms for 100 items). After the rename, NEW `/augment` requests hit the rebuilt DB. There is a tiny window where a request might hit the OLD DB just before the rename — that's acceptable (the old DB is still valid; requests return the pre-rebuild state).
- `src/server/boot.ts` MODIFIED (minor): adds `await registerCatalogRebuildRoute(app, { db, catalogDir })` after T-05's registration.
- `test/server/catalog-rebuild-concurrency.test.mjs` (new):
  - Boots the server with a fixture catalog.
  - Spawns 10 simultaneous `/augment` requests (`Promise.all`).
  - In parallel, fires `POST /catalog/rebuild`.
  - Asserts: all 10 `/augment` requests return 200; rebuild returns 200 with `count === fixtureCount`.
  - Cleans up child processes (Windows-safe `taskkill /F /T /PID` pattern, mirroring `scripts/smoke-server-boot.mjs:125-148`).

**Depends on:** T-05 (uses the catalog DB the same way)

**Verification:**
- `npm test -- test/server/catalog-route.test.mjs` — extended with rebuild cases:
  - First rebuild → 200 + `{rebuilt: true, count: 5, durationMs: <N>}`
  - Second rebuild (immediately after) → 200 + same `count: 5` (idempotent)
  - Empty catalog → rebuild returns `count: 0`
- `npm test -- test/server/catalog-rebuild-concurrency.test.mjs` — concurrent safety verified.
- `npm run typecheck` exits 0.

**Commit:** `feat(route): POST /catalog/rebuild endpoint (idempotent + concurrent-safe via TEMP DB + atomic rename) (phase 5b T-09)`

**Trace:** R-04, R-19, AC-4, AC-5, AC-29

---

#### T-10: `POST /state/toggle` endpoint handler (critical_confirm flow + mutex + atomic write)

**File:** `src/server/routes/state-toggle.ts` (new), `test/server/state-toggle.test.mjs` (new)

**Implements:**
- `src/server/routes/state-toggle.ts`:
  - `registerStateToggleRoute(app: FastifyInstance, opts: { stateJsonPath: string, catalogDir: string }): Promise<void>`
  - Module-scoped `Mutex` (Promise-based, from a small inline `class Mutex` — no new dep).
  - Zod schema `StateToggleRequestSchema = z.object({itemId: z.string(), action: z.enum(['on', 'off']), critical_confirm: z.string().optional()})`.
  - Route `POST /state/toggle` flow:
    1. Zod validate body. Invalid → 400.
    2. Acquire mutex.
    3. Read `.memory-studio/state.json` (or initialize with default if missing).
    4. Resolve `itemId` against the on-disk catalog YAML (`config/catalog/<itemId>.yaml`). Unknown → 404.
    5. If `action === 'off'` AND item type is `rule` AND `critical === true`:
       - If `critical_confirm` is missing OR doesn't equal `"OVERRIDE: <itemId>"` (or the YAML's `critical_confirm_phrase` if defined) → 400 with `{error: 'critical_confirm_required', itemId, hint: "POST with critical_confirm: 'OVERRIDE: <itemId>'"}`.
       - Otherwise → continue.
    6. Toggle `activeCatalog` in the in-memory state (add if `action === 'on'` and not present; remove if `action === 'off'` and present; no-op if state already matches).
    7. Atomic write: write to `.memory-studio/state.json.tmp` then rename to `.memory-studio/state.json`.
    8. Release mutex.
    9. Enqueue audit event `{eventType: 'state_toggle', payload: {itemId, action, active, stateVersion}}`.
    10. Return 200 + `{itemId, action, active: <bool>, stateVersion: <n>}`.
- `src/server/boot.ts` MODIFIED (minor): adds `await registerStateToggleRoute(app, { stateJsonPath, catalogDir })` after T-09's registration.

**Depends on:** T-09 (state.json path is the same convention)

**Verification:**
- `npm test -- test/server/state-toggle.test.mjs` — 8+ cases:
  - Non-critical item, `action: 'on'` → 200, `active: true`
  - Non-critical item, `action: 'off'` → 200, `active: false`
  - Critical rule, `action: 'off'`, no `critical_confirm` → 400 with `critical_confirm_required`
  - Critical rule, `action: 'off'`, `critical_confirm: 'OVERRIDE: rule-no-secrets'` → 200
  - Critical rule, `action: 'off'`, `critical_confirm: 'wrong-phrase'` → 400
  - Unknown itemId → 404 with `item_not_found`
  - Invalid body (missing itemId) → 400
  - 10 simultaneous toggles → all 200, monotonic `stateVersion` (mutex serialization)
- `npm run typecheck` exits 0.

**Commit:** `feat(route): POST /state/toggle endpoint (critical_confirm flow + mutex + atomic write) (phase 5b T-10)`

**Trace:** R-08, AC-12, AC-13, AC-14, AC-15

---

#### T-11: R-06 agentId schema tightening (pickup from Phase 5a.4)

**Files:** `src/server/schema.ts` (MODIFIED), `test/augment/schemas.test.mjs` (MODIFIED)

**Implements:**
- `src/server/schema.ts` line 58:
  - **BEFORE:** `agentId: z.string(),`
  - **AFTER:** `agentId: z.literal('claude-code', { errorMap: () => ({ message: 'agentId must be one of: claude-code' }) }),`
- `src/server/schema.ts` lines 12-17:
  - **REMOVE** the comment documenting the MVP exception (the deferral ends here).
- `test/augment/schemas.test.mjs`:
  - **REPLACE** the Phase 5a.4 substitute test (`missing fingerprint → 400`) with the spec-correct test:
    - `agentId: "claude-code"` → parses (200 in integration test)
    - `agentId: "cursor"` → ZodError with message `"agentId must be one of: claude-code"`
    - `agentId: "Claude-Code"` (case mismatch) → ZodError (literal is case-sensitive)
    - `agentId: undefined` (missing) → ZodError
- Audit any other test files in `test/augment/*.test.mjs` and `test/server/*.test.mjs` for `agentId` usages. Replace non-canonical values with `'claude-code'`. (Likely zero changes needed since Phase 5a baseline used `'claude-code'` throughout, but the audit is required.)

**Depends on:** none (schema-only change)

**Verification:**
- `npm test -- test/augment/schemas.test.mjs` — new tests pass.
- `npm test` — full suite passes (no regressions from other tests that may have used non-canonical agentIds).
- `npm run typecheck` exits 0.
- Manual grep: `grep -rn "agentId" test/ | grep -v "claude-code"` returns nothing (or only intentional cases like the new R-06 test that USES non-canonical to verify rejection).

**Commit:** `fix(schema): tighten agentId to z.literal('claude-code') — pickup R-06 enforcement from Phase 5a.4 (phase 5b T-11)`

**Trace:** R-12, AC-26

---

#### T-12: Proxy allowlist security module + boot wiring of all new routes

**Files:** `src/server/security/proxy-allowlist.ts` (new), `src/server/boot.ts` (MODIFIED)

**Implements:**
- `src/server/security/proxy-allowlist.ts`:
  - `LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])` constant.
  - `checkProxyAllowlist(urlString: string, allowedHostsCsv?: string): {allowed: boolean, host: string | null}`:
    1. Parse `urlString` via `new URL()`. On error → `{allowed: false, host: null}`.
    2. Extract `hostname` (lowercase).
    3. Compute `allowedSet`: if `allowedHostsCsv` is provided, parse CSV (strip whitespace, skip empty, lowercase); else default to `[...LOOPBACK_HOSTS]`.
    4. If `allowedSet` contains `'*'` → reject (`{allowed: false, host}`) with security log.
    5. If `LOOPBACK_HOSTS.has(host)` OR `allowedSet.includes(host)` → `{allowed: true, host}`.
    6. Else → `{allowed: false, host}`.
- `test/server/proxy-allowlist.test.mjs`:
  - 10+ cases:
    - `http://127.0.0.1:1234/v1/messages` → allowed
    - `http://localhost:1234/v1/messages` → allowed
    - `http://[::1]:1234/v1/messages` → allowed
    - `https://api.anthropic.com/v1/messages` → rejected
    - `http://example.com:8080/v1/messages` → rejected
    - `http://127.0.0.1:1234` with `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS=example.com` → rejected (the CSV REPLACES the default loopback set, doesn't append)
    - `http://example.com` with `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS=example.com,127.0.0.1` → allowed
    - `*` in CSV → rejected (wildcard forbidden)
    - `not-a-url` → rejected
    - `http://127.0.0.1:99999/v1/messages` (invalid port) → rejected
- `src/server/boot.ts` MODIFIED:
  - Reads `MEMORY_STUDIO_ANTHROPIC_BASE_URL` and `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` env vars (parsed via `parsePortRangeEnv`-style helper, but simpler — just check if env var is set).
  - The `upstreamUrl` is passed to T-13's `registerMessagesProxyRoute`.
  - On startup, if `upstreamUrl` is set, the server logs `[boot] transparent proxy enabled: <upstreamUrl>` to stdout.

**Depends on:** T-04 (security barrel already exports `hashTenantId`; `proxy-allowlist` joins the barrel here)

**Verification:**
- `npm test -- test/server/proxy-allowlist.test.mjs` — 10+ cases, all pass.
- `npm run typecheck` exits 0.

**Commit:** `feat(security): proxy allowlist (§10.3.4 local-only enforcement) + boot wiring scaffolding (phase 5b T-12)`

**Trace:** R-10, AC-24

---

### Subchapter 5b.4 — Transparent Proxy

#### T-13: `POST /v1/messages` transparent proxy (intercept + internal /augment + forward + capture cache metrics)

**Files:** `src/server/routes/messages-proxy.ts` (new), `test/server/messages-proxy.test.mjs` (new), `src/server/boot.ts` (MODIFIED)

**Implements:**
- `src/server/routes/messages-proxy.ts`:
  - `registerMessagesProxyRoute(app: FastifyInstance, opts: { upstreamUrl: string | null, pipelineProvider: () => PipelineContext, allowedHostsCsv?: string }): Promise<void>`
  - Route `POST /v1/messages` flow:
    1. **Proxy enabled check:** if `opts.upstreamUrl === null`, return 503 `{error: 'proxy_disabled', hint: 'Set MEMORY_STUDIO_ANTHROPIC_BASE_URL to enable'}`.
    2. **Allowlist check:** call `checkProxyAllowlist(opts.upstreamUrl, opts.allowedHostsCsv)`. If not allowed → return 502 `{error: 'proxy_host_not_allowed', host, hint: 'Add to MEMORY_STUDIO_PROXY_ALLOWED_HOSTS or use loopback'}`.
    3. **Anthropic request validation:** validate the body shape `{model, max_tokens, system, messages}`. Invalid → 400.
    4. **Extract `system` text:** handle both string and array-of-blocks shapes. If absent, use empty string.
    5. **Build internal `/augment` request:** construct from the Anthropic request. `prompt = extractFirstUserPrompt(anthropicReq.messages)` (concatenate text content from user-role messages). `context = null`. `fingerprint = {projectPath: '.', agentId: 'claude-code', sessionId: 'proxy', gitBranch: 'main'}`. `activeCatalog = readActiveCatalogFromStateJson()`. `tenantId = 'proxy-tenant'`. `schemaVersion = 3`.
    6. **Run pipeline:** `const augmentResponse = await runAugment(augmentReq, opts.pipelineProvider())`. Catch errors → return 502 `{error: 'augment_failed', message}` (the proxy DOES return 5xx for pipeline errors since the client is an LLM agent that expects a clear failure signal — fail-open semantics are for `/augment`, not for the proxy).
    7. **Augment system field:** rebuild the `system` to Memory Studio's 2-block structure via `buildSystemMessage(augmentReq, ...).system`.
    8. **Forward to upstream:** `fetch(opts.upstreamUrl + '/v1/messages', {method: 'POST', headers: {'content-type': 'application/json', 'anthropic-version': '2023-06-01'}, body: JSON.stringify(proxiedReq)})` with a 30s timeout (configurable via `MEMORY_STUDIO_PROXY_TIMEOUT_MS`).
    9. **Capture cache metrics:** from the upstream response body's `usage.{cache_read_input_tokens, cache_creation_input_tokens}`.
    10. **Audit row:** enqueue `{eventType: 'messages_proxy', tenantIdHashed: hashTenantId('proxy-tenant'), redactedPromptHash: sha256(systemText + JSON.stringify(messages)), matchedIds: [...all matched items' ids], pruningReasons: [...all rejected reasons], latencyMs, fingerprint: {agentId: 'claude-code', source: 'proxy'}, payload: {systemMessageSha256, cacheReadInputTokens, cacheCreationInputTokens, model}}`.
    11. **Return response:** status = upstream status; body = upstream body.
- `src/server/boot.ts` MODIFIED:
  - Adds `await registerMessagesProxyRoute(app, { upstreamUrl, pipelineProvider: () => pipelineContext, allowedHostsCsv })` after T-10's registration.
  - The `upstreamUrl` is sourced from `process.env.MEMORY_STUDIO_ANTHROPIC_BASE_URL`. Empty/missing → `null` (proxy disabled).
- `test/server/messages-proxy.test.mjs`:
  - 8+ cases:
    - **Stub Anthropic server:** spawns a local HTTP server that mimics the Anthropic Messages API response shape (mirror of `scripts/smoke-augment-server.mjs:74-151`).
    - **Forward + capture:** POST `/v1/messages` with valid Anthropic request → returns the stub response, audit row is written with `cacheReadInputTokens`.
    - **Proxy disabled:** boot server without `MEMORY_STUDIO_ANTHROPIC_BASE_URL` → POST `/v1/messages` returns 503 with `proxy_disabled`.
    - **Allowlist 502:** boot server with `MEMORY_STUDIO_ANTHROPIC_BASE_URL=https://api.anthropic.com` → POST `/v1/messages` returns 502 with `proxy_host_not_allowed`.
    - **Malformed Anthropic request:** POST `/v1/messages` without `model` → 400.
    - **System field as string:** forwarded as-is to upstream.
    - **System field as array:** blocks are concatenated into a single text for the internal `/augment` call.
    - **Upstream timeout:** stub Anthropic server hangs → proxy returns 504 after 30s.

**Depends on:** T-12 (proxy allowlist + boot wiring), T-03 (audit buffer), T-08 (uses pipeline from augment pipeline)

**Verification:**
- `npm test -- test/server/messages-proxy.test.mjs` — 8+ cases, all pass.
- `npm run typecheck` exits 0.
- Manual smoke: with the Phase 5a.3 stub on a free port, set `MEMORY_STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:<stub-port>` and POST `/v1/messages` → assert the stub's cache metric is captured.

**Commit:** `feat(route): POST /v1/messages transparent proxy (intercept + internal /augment + forward + capture cache metrics) (phase 5b T-13)`

**Trace:** R-09, R-14, AC-22, AC-23

---

#### T-14: Phase 5b smoke scripts (3 scripts) + Claude Code guide update + final closeout

**Files:** `scripts/smoke-audit-failopen.mjs` (new), `scripts/smoke-proxy-local-only.mjs` (new), `scripts/smoke-redact.mjs` (new), `docs/guides/claude-code-baseurl.md` (MODIFIED), `package.json` (MODIFIED, 3 smoke scripts)

**Implements:**
- `scripts/smoke-audit-failopen.mjs`:
  - Boots the server on a pinned port (47100).
  - **Mocks the audit writer** to always throw (uses an env var or a debug flag in `auditBuffer` that swaps the writer — added in T-01's test-only hook surface).
  - POSTs 5 `/augment` requests. Asserts all 5 return 200.
  - Captures stderr. Asserts stderr contains `[audit] write failed...` lines (count ≥ 1).
  - Asserts the script exits 0 with `[smoke] PASS (5/5 checks)`.
  - Mirrors `scripts/smoke-server-boot.mjs:125-148` Windows cleanup pattern.
- `scripts/smoke-proxy-local-only.mjs`:
  - **Sub-test 1:** Boot server with `MEMORY_STUDIO_ANTHROPIC_BASE_URL=http://127.0.0.1:<stub-port>` (stub Anthropic server on another port). POST `/v1/messages` with a fixture request. Asserts 200 + the stub's response.
  - **Sub-test 2:** Kill the server. Reboot with `MEMORY_STUDIO_ANTHROPIC_BASE_URL=https://api.anthropic.com` (NOT allowed by default loopback allowlist). Asserts the server EITHER refuses to start (boot fails with an error) OR POST `/v1/messages` returns 502 with `proxy_host_not_allowed`.
  - Asserts `[smoke] PASS (2/2 sub-tests)`.
- `scripts/smoke-redact.mjs`:
  - Boot server on a pinned port.
  - POST `/augment` with `prompt: "deploy ${SECRET_KEY}=abc123 to prod"` + a non-empty `context.scratch: "set ${API_TOKEN}=sk-ant-abcdef1234567890"`.
  - Wait for the audit flush (1100ms).
  - Query `GET /audit` and assert NO row contains `abc123` OR `sk-ant-abcdef1234567890` in ANY field.
  - Asserts `[smoke] PASS (3/3 checks)`.
- `docs/guides/claude-code-baseurl.md` MODIFIED:
  - Adds a new section **"Transparent Proxy (Phase 5b — current)"** that supersedes the Phase 5a "transparent proxy (Phase 5b future)" teaser. Documents:
    - `ANTHROPIC_BASE_URL=http://127.0.0.1:<port>` wiring
    - The proxy's local-only enforcement (§10.3.4)
    - How cache metrics surface in the audit log
    - Troubleshooting (`MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` extension for non-localhost dev setups)
- `package.json` MODIFIED (additive):
  - Adds 3 scripts: `"smoke:audit-failopen"`, `"smoke:proxy-local-only"`, `"smoke:redact"`.
  - Each script mirrors the Phase 5a.4 `smoke:augment-server` pattern (script wraps `node scripts/smoke-*.mjs`).
- **Final closeout:**
  - Run full gate suite (`npm test`, `npm run typecheck`, all 4 smoke scripts).
  - Verify `npm run audit-server` (or `npm run augment-server`) boots with the new 7-endpoint surface.
  - Verify `git diff 701a2f2..HEAD -- src/catalog/index.ts src/catalog/db/ src/catalog/migrations/001_init.sql src/catalog/migrations/002_audit_events_tenant_id_rename.sql src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/ CLAUDE.md` returns empty.
  - Verify `npm ls` reports no new dependencies (Phase 5b uses only pino + zod already in deps).
  - Verify `npm test` reports ≥477 + new tests passing (target ≥520).

**Depends on:** T-01..T-13 (entire phase)

**Verification:**
- `node scripts/smoke-audit-failopen.mjs` exits 0.
- `node scripts/smoke-proxy-local-only.mjs` exits 0.
- `node scripts/smoke-redact.mjs` exits 0.
- `node scripts/smoke-augment-server.mjs` (Phase 5a regression check) exits 0.
- `npm test` exits 0 with ≥477 + new tests passing.
- `npm run typecheck` exits 0.
- Scope guard empty (the new migration file is a NEW file, not a modification of an existing file).

**Commit:** `feat(phase-5b): 3 smoke scripts + Claude Code guide update + final closeout (phase 5b T-14)`

**Trace:** R-09 (proxy section), R-10 (allowlist section), R-11 (redact section), AC-19 (audit row schema), AC-31 (smoke audit fail-open), AC-32 (smoke proxy local-only), AC-33 (smoke redact), AC-34 (scope guard), AC-35 (test baseline)

---

## Summary

| Subchapter | Tasks | Files (new) | Files (modify) | Atomic commits |
|---|---|---|---|---|
| **5b.1 Audit Foundation** | T-01..T-04 | 5 (`src/server/audit/{types,buffer,writer,lifecycle,query}.ts`, `src/server/security/{tenant-hash,index}.ts`, `src/catalog/migrations/003_audit_events_ts_index.sql`) | 1 (`src/server/boot.ts`) | 4 |
| **5b.2 Read Endpoints** | T-05..T-08 | 3 (`src/server/routes/{catalog-list,audit-list,audit-summary}.ts`) | 2 (`src/server/boot.ts`, `src/server/health/route.ts`, `test/augment/health.test.mjs`) | 4 |
| **5b.3 Write Endpoints + R-06** | T-09..T-12 | 2 (`src/server/routes/{catalog-rebuild,state-toggle}.ts`, `src/server/security/proxy-allowlist.ts`) | 2 (`src/server/schema.ts`, `src/server/boot.ts`, `test/augment/schemas.test.mjs`) | 4 |
| **5b.4 Transparent Proxy** | T-13..T-14 | 4 (`src/server/routes/messages-proxy.ts`, `scripts/{smoke-audit-failopen,smoke-proxy-local-only,smoke-redact}.mjs`, 8 test files in `test/server/`) | 3 (`src/server/boot.ts`, `docs/guides/claude-code-baseurl.md`, `package.json`) | 2 |
| **Total** | **14** | **~22 new files** | **~5 files** | **14 atomic commits** |

**Test count target:** baseline 477 + new tests (~40-60) = target ≥520.
