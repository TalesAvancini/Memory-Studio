---
date: 2026-08-01
version: 1
description: "Verifier report — Phase 5b.1 (Audit Foundation) + 5b.2 (Read Endpoints). T-01..T-08."
explanation: |
  Independent Verifier audit of commit range b3fbf4d..351ca9e (8 commits).
  Performed end-to-end read of code, ran every gate from the prompt,
  reproduced the audit fail-open path on a fresh throw-stub writer, and
  measured perf gate independently. The audit buffer, redact layer,
  tenant hash, perf index, read endpoints, and enhanced /health all
  pass. Honest uncertainty: the pre-existing port-contention flake at
  test#285 surfaced once (recovered on next run) — not a Phase 5b
  regression.
---

# Validation — Phase 5b.1 Audit Foundation + 5b.2 Read Endpoints

## Verdict
**PASS**

## Gate evidence

| Gate | Command | Exit | Time | Result |
|---|---|---|---|---|
| Full tests (run 1) | `npm test` | 1 | ~54s | 351 pass / 1 fail (test#285 — pre-existing EADDRINUSE flake on port 42900) |
| Full tests (run 2 — stability check) | `npm test` | 0 | ~54s | 352 pass / 0 fail |
| Audit buffer tests | `npm test -- test/audit/buffer.test.mjs` | 0 | — | 352/352 (full suite — npm flag is advisory on Windows glob) |
| Redact tests | `npm test -- test/audit/redact.test.mjs` | 0 | — | 352/352 |
| Audit row tests | `npm test -- test/audit/audit-row.test.mjs` | 0 | — | 352/352 |
| Endpoints tests | `npm test -- test/audit/endpoints.test.mjs` | 0 | — | 352/352 (incl. perf gate) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | 0 | — | clean |
| Env verify | `npm run verify-env` | 0 | — | 6/6 PASS |
| Build index (empty) | `npm run build-index -- --empty-ok` | 0 | — | 45ms, 0 skills |
| Catalog load (empty) | `npm run catalog:load -- --empty-ok` | 0 | — | 37ms, 0 skills |
| Smoke server boot | `node scripts/smoke-server-boot.mjs` | 0 | ~300ms | `/health → 200, status=ok, uptime_ms=96` |
| Smoke augment server | `node scripts/smoke-augment-server.mjs` | 0 | ~1.2s | `PASS (5/5 checks, 1169ms)` |
| Smoke augment server (npm) | `npm run smoke:augment-server` | 0 | ~1.2s | `PASS (5/5 checks)` |
| UI tests | `npm --prefix packages/ui test` | 0 | ~6s | **152/152** |
| SDK tests | `npm --prefix packages/sdk test` | 0 | ~0.7s | **16/16** |
| Fastify resolution | `npm ls fastify` | — | — | single resolved version **`5.11.0`** |

**Test count totals:** root **352** / UI **152** / SDK **16** = **520 tests** (target ≥520 from tasks.md). The 5b batch 1 adds 43 tests (per commit `351ca9e` message + 4 new files in `test/audit/**`).

**2x stability:** run 1 surfaced a port-contention flake on `not ok 285 - augment: POST /augment missing activeCatalog → 400` (`EADDRINUSE 127.0.0.1:42900`). Run 2 (immediately after, no port-released delay) **fully recovered** with 352/352 passing. This is the documented pre-existing flake in the prompt's "test#237 in `[42900, 43000]`" — not a regression introduced by Phase 5b (the test lives in `test/server/smoke.test.mjs`, untouched by this PR per the scope diff).

## T-01..T-04 verification (Audit Foundation)

### T-01 — ring buffer + batch flush trigger

**Files:** `src/server/audit/buffer.ts` (183 lines), `src/server/audit/types.ts` (65 lines), `src/server/audit/index.ts` (23 lines).

Read end-to-end. Confirmed:

- `RING_BUFFER_CAPACITY = 10_000` (line 48) — ring buffer cap ✓
- `FLUSH_COUNT_TRIGGER = 100` (line 46) and `FLUSH_TIME_MS = 1000` (line 47) ✓
- **Count trigger:** `enqueue()` checks `if (this.buffer.length >= FLUSH_COUNT_TRIGGER) void this.flush('count-trigger')` (line 106-109) ✓
- **Time trigger:** `else if (this.flushTimer === null)` starts a `setTimeout(flush, FLUSH_TIME_MS)` and `.unref?.()`s it so tests can stop cleanly (lines 110-117) ✓
- **Safety valve:** lines 98-103: when `buffer.length >= RING_BUFFER_CAPACITY`, `shift()` the oldest event and log `[audit] buffer at capacity (10000); oldest event dropped` ✓
- **Fail-open:** lines 139-148 `try/await writer.writeBatch / catch { stderr; lastFlushTs = null }` — the buffer is NOT poisoned ✓
- **`splice(0, length)`** at line 132 atomically takes ownership — concurrent `enqueue()` during `flush()` waits for next round ✓

### T-03 — SQLite batch writer + lifecycle

**Files:** `src/server/audit/writer.ts` (52 lines), `src/server/audit/lifecycle.ts` (67 lines), `src/catalog/migrations/003_audit_events_ts_index.sql` (NEW 12 lines).

- `writer.ts:24-29` prepared statement matches `001_init.sql:49-60` columns exactly (ts, `tenantId_hashed`, event_type, payload, fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash) ✓
- `db.transaction()` wrapper (line 33) — atomic per batch ✓
- `lifecycle.ts:24-29` `initAuditBuffer(db)` — module-scoped singleton, idempotent ✓
- `lifecycle.ts:51-54` `stopAuditBuffer()` — calls `await buffer.stop()` which calls `flush('shutdown')` ✓
- **Migration `003_audit_events_ts_index.sql`:** single `CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts)` (line 12) — additive, no table rewrite ✓
- **Scope guard:** `git diff b3fbf4d..HEAD -- src/catalog/migrations/001_init.sql src/catalog/migrations/002_*` returns empty; only `003_*.sql` is ADDED (new file). `git diff` confirmed zero modifications to 001/002 ✓
- **`boot.ts` SIGTERM wiring:** `handle.close()` does `await stopAuditBuffer()` BEFORE `await app.close()` (lines 174-177) ✓
- **`augment.ts` enqueue path:** `enqueueAudit()`-equivalent is inline (lines 321-353) inside the `/augment` handler in a `try { ... } catch { /* never block */ }` guard. Audit is best-effort, never throws into request path ✓

### T-01/T-03 fail-open — INDEPENDENT REPRODUCTION

Constructed a fresh buffer with a stub writer that always throws, enqueued 5 events, waited 1100ms (time trigger), observed:

```
depth after 5 enqueues: 5
[audit] write failed (time-trigger); dropped 5 events: simulated sqlite write failure
lastFlushTs after fail flush (should be null): null
depth after 6th enqueue (buffer should accept): 1
FAIL-OPEN-OK
```

- 5 events accepted ✓
- Stderr captured with reason + count ✓
- `lastFlushTs` → `null` (stuck-buffer signal) ✓
- 6th enqueue accepted (buffer NOT poisoned) ✓
- Method inspected independently (not via own tests).

### Audit row schema (PRD §10.3.1) — INDEPENDENT CHECK

Read `types.ts:28-38`:
- Fields: `ts, tenantIdHashed, redactedPromptHash, matchedIds, pruningReasons, latencyMs, fingerprint, payload, eventType` ✓
- **ZERO raw `prompt`, `context`, `tenantId`, `sessionId`** — confirmed by absence in shape ✓
- `audit-row.test.mjs:34-95` reads the row back via SQLite and asserts: row exists, 9 expected columns present, `tenantId_hashed !== RAW_TENANT_ID`, raw prompt content never appears in any column. **PASS** ✓
- **`redacted_prompt_hash` over ORIGINAL prompt** — confirmed at `augment.ts:324-326`: `createHash('sha256').update(parsed.data.prompt, 'utf8').digest('hex')` — hash is over raw bytes BEFORE any redaction (re-redaction-of-the-hash is impossible by construction) ✓

### T-02 — Placeholder redaction

**File:** `src/server/audit/redact.ts` (72 lines). Read end-to-end.

- 4 patterns (lines 22-31): `${VAR}=value` / `(password|token|api_key|secret_key)=\s*value` / `sk-[A-Za-z0-9_-]{20,}` / `Bearer\s+[A-Za-z0-9._-]{20,}` ✓ (SPEC lists these 4 — A-19 / spec.md line 213-217)
- `redactPlaceholders()` (lines 39-45) returns NEW string (input untouched) ✓
- `redactObjectRecursive()` (lines 57-71) walks objects/arrays, preserves keys (only values that may contain placeholders are redacted), non-string primitives passthrough ✓
- **21 redact tests** in `test/audit/redact.test.mjs` — all pass ✓
- **Independent forgery probe:**
  - `TOKEN:secret` (colon, no `=`) → unchanged (`TOKEN:secret`) — correctly NOT redacted (the spec requires `=`)
  - `password = hunter2` (with spaces) → `<REDACTED>` — `\s*=\s*` allows surrounding whitespace ✓
  - `mypasswordless` → unchanged — word boundary works ✓
  - `sk-12345678901234567890` → matches ✓
  - `Bearer eyJabcdefghijklmnopqrst` → matches ✓
- **Spec gap (documented):** `TOKEN:secret` (key:value format) without `=` is not matched. This matches spec.md A-19 (the patterns specify `=`) — not a regression.

### T-04 — TenantId hashing

**File:** `src/server/security/tenant-hash.ts` (33 lines).

- `hashTenantId(tenantId)` at line 25-29: `createHash('sha256').update(tenantId, 'utf8').digest('hex').slice(0, 16)` ✓
- **Returns `null` for `null/undefined/empty`** (line 28) ✓
- **Independent verify:** `hashTenantId('tenant-acme-12345')` = `fb6f35b5767b65db` (16 chars), matches `crypto.createHash('sha256').update('tenant-acme-12345', 'utf8').digest('hex').slice(0,16)` exactly ✓

**Spot check — raw tenantId in audit/log paths:**
- `src/server/audit/types.ts` — only accepts `tenantIdHashed`, never raw ✓
- `src/server/logger.ts` — only signature is `(options: { requestId, tenantIdHashed })`, logs `tenantId_hashed` ✓
- `src/server/augment.ts:90, 219-223, 259, 291` — every tenant-id-touching path goes through `hashTenantId()` ✓
- Re-export from `augment.ts:59` preserves the Phase 5a call sites ✓

### Perf index migration (T-04)

`003_audit_events_ts_index.sql` — additive `CREATE INDEX IF NOT EXISTS`. `git diff` confirms 001_init.sql + 002_* are UNTOUCHED. The new file applies cleanly via `npm run build-index` (15ms wall) ✓

## T-05..T-08 verification (Read Endpoints + Tests)

### T-05 — `GET /catalog` (88 lines)

- `routes/catalog.ts:42-95` registers `GET /catalog` — LEFT JOIN `catalog` + `embeddings` ✓
- Returns `[{id, type, title, text, critical, is_default, content_hash, created_at, updated_at, embedding_model_version, embedding_dimensions, has_embedding}, ...]` ✓
- Empty catalog → `[]` (test `GET /catalog: empty catalog returns []` line 99 PASSES) ✓
- **No audit enqueue** — no call to `getAuditBuffer()` in this file ✓
- `ORDER BY c.id ASC` (line 60) — sorted deterministically ✓
- `has_embedding: row.has_embedding === 1 ? 384 : null` — surfaces dimension only when embedding exists ✓

### T-06 — `GET /audit` + T-07 `GET /audit/summary` (114 lines)

- `routes/audit.ts:32-35` — `DEFAULT_LIMIT=50`, `MAX_LIMIT=500`, `DEFAULT_RANGE_DAYS=30`, `MAX_RANGE_DAYS=365` ✓
- `clampLimit()` (lines 49-53) — invalid → 50, valid → `min(n, 500)` ✓ — so `?limit=600` clamps to 500 ✓
- **Response shape (lines 70-90):** `{ts, tenantId_hashed, eventType, latencyMs, matchedIds, pruningReasons, redactedPromptHash, fingerprint, payload}` — no `prompt`, no `context`, no raw `tenantId`, no raw `sessionId` ✓
- `parseJsonOrNull()` for fingerprint/payload — safe JSON parsing of audit columns ✓
- `query.ts:51-78` uses `idx_audit_events_ts` for `WHERE ts >= ? ORDER BY ts DESC LIMIT ?` ✓
- **No audit enqueue** — read-only endpoints ✓
- Tests: empty → `[]`, rows → no-prompt-field (line 151), `?limit=600` clamps to 500 (line 182), `/audit/summary` empty + 3-date rollups (lines 200, 212), `/health` enhanced blocks (lines 239, 266) — all PASS ✓

### T-07 — enhanced `/health` (71 lines)

- `health.ts:101-129` — payload now includes `audit_buffer.{depth, capacity, last_flush_ts}` + `catalog.{count, last_rebuild_ts}` ✓
- **Backward-compat preserved:** `status`, `uptime_ms`, `last_request_ts`, `request_id`, `schema_version: 3` all intact ✓
- `setHealthDb(db)` and `setLastRebuildTs(ts)` exports present (lines 69-79) for Phase 5b.3 (`/catalog/rebuild` T-09) ✓
- **Independent /health live probe (port 43300):**
  ```json
  {
    "status": "ok",
    "uptime_ms": 56,
    "last_request_ts": 0,
    "request_id": "a8e3ef78-b479-40ea-8abd-73e1e1c13978",
    "schema_version": 3,
    "audit_buffer": { "depth": 0, "capacity": 10000, "last_flush_ts": null },
    "catalog": { "count": 0, "last_rebuild_ts": null }
  }
  ```
  All 7 fields present and shape matches spec R-07 ✓

### T-08 — 43 tests across `test/audit/**`

| File | Test count | Coverage |
|---|---|---|
| `test/audit/buffer.test.mjs` | 10 (visible) + extras | enqueue/depth/count-trigger/time-trigger/fail-open/capacity-overflow/lastFlushTs/concurrent/no-event-loss/stop-lifecycle/snapshot |
| `test/audit/redact.test.mjs` | 21 (17 redact + 4 hashTenantId subtests) | 4 patterns + recursive + no-mutation + hash determinism + null handling |
| `test/audit/audit-row.test.mjs` | 2 | zero-raw-text + e2e via `createServer + POST /augment` |
| `test/audit/endpoints.test.mjs` | 9 | empty / shape / limit-clamp / summary / health / depth-after-enqueue |
| `test/audit/perf-100ms.test.mjs` | 1 (perf gate) | seeds 1000 rows, fires 10 requests, max <100ms |

**Independent perf measurement** (separate from in-suite, fresh server on port 43400):

```
[perf] max: 10.70 ms  median: 5.65 ms
samples: 10.65, 10.70, 3.85, 4.65, 4.99, 5.65, 6.07, 6.28, 6.58, 8.25
PERF-OK
```

Max 10.70ms — **9.3x** headroom under the 100ms gate ✓

## Spec-anchored requirements

| Req | Statement | Verified by |
|---|---|---|
| **R-01** | Audit async + fail-open (N=100 OR T=1000ms) | `buffer.ts:46-47, 98-117, 142-148` + independent repro above |
| **R-02** | Audit row ZERO raw text | `types.ts:28-38` (no raw fields) + `audit-row.test.mjs:34-95` |
| **R-03** | `GET /catalog` returns array | `routes/catalog.ts:42-95` + `endpoints.test.mjs:99-138` |
| **R-05** | `GET /audit` returns N rows redacted, no raw | `routes/audit.ts:70-90` + `endpoints.test.mjs:151-199` |
| **R-06** | `GET /audit/summary` daily rollups | `routes/audit.ts:105-113` + `query.ts:81-143` + `endpoints.test.mjs:200-238` |
| **R-07** | `GET /health` audit_buffer + catalog blocks, backward-compat | `health.ts:101-129` + live probe above + `endpoints.test.mjs:239-296` |
| **R-13** | Audit `enqueue/flush/start/stop` lifecycle | `buffer.ts:74-86, 93-118, 127-149` + `lifecycle.ts:24-54` |
| **R-14** | Audit fail-open test surface | `buffer.test.mjs:106-167` (writer throws → dropped → enqueue still works) + independent repro |
| **R-15** | Perf gate `GET /audit?range=30days` <100ms / 1000 rows | `perf-100ms.test.mjs` (max <100ms) + independent measurement max=10.70ms |
| **R-20** | `tenantId_hashed` populated, raw never logged | `tenant-hash.ts:25-29` + augment.ts grep + audit-row.test.mjs |
| **AC-16, AC-17** | Async + batch trigger semantics | buffer.test.mjs:71-114 (count at 100, time at 1100ms) |
| **AC-18** | Fail-open with stderr, enqueue still works | buffer.test.mjs:106-167 |
| **AC-19** | Row schema 9 columns | audit-row.test.mjs:69-77 |
| **AC-20** | tenantId 16 hex chars, sha256[0:16] | redact.test.mjs:127-150 + independent crypto verify |
| **AC-21, AC-25** | No `abc123` anywhere in audit row | audit-row.test.mjs:80-95 + live logic via augment.ts:95 |
| **AC-27** | Perf gate verified | max=10.70ms (own measurement) |

(Out-of-scope for Batch 1: R-04, R-08, R-09, R-10, R-11 (intent), R-12, R-17, R-18, R-19 → these map to 5b.3 + 5b.4 — **correctly deferred**.)

## Scope and regression audit

```
git diff b3fbf4d..HEAD --stat

 .specs/ROADMAP.md                                  |  66 ++
 .specs/STATE.md                                    |   5 +-
 .specs/features/phase-5b-aux-endpoints/design.md   | 637 ++++
 .specs/features/phase-5b-aux-endpoints/spec.md     | 289 +++
 .specs/features/phase-5b-aux-endpoints/tasks.md    | 728 +++
 src/catalog/migrations/003_audit_events_ts_index.sql |  12 +
 src/server/audit/buffer.ts                         | 183 +
 src/server/audit/index.ts                          |  23 +
 src/server/audit/lifecycle.ts                      |  67 +
 src/server/audit/query.ts                          | 154 +
 src/server/audit/redact.ts                         |  72 +
 src/server/audit/types.ts                          |  65 +
 src/server/audit/writer.ts                         |  52 +
 src/server/augment.ts                              |  94 ++-
 src/server/boot.ts                                 |  41 +-
 src/server/health.ts                               |  71 +-
 src/server/index.ts                                |  42 +-
 src/server/routes/audit.ts                         | 114 +
 src/server/routes/catalog.ts                       |  96 +
 src/server/routes/index.ts                         |  12 +
 src/server/security/index.ts                       |   9 +
 src/server/security/tenant-hash.ts                 |  30 +
 test/audit/audit-row.test.mjs                      | 147 +
 test/audit/buffer.test.mjs                         | 245 +
 test/audit/endpoints.test.mjs                      | 290 +
 test/audit/perf-100ms.test.mjs                     |  76 +
 test/audit/redact.test.mjs                         | 156 +
 test/catalog/migrations-phase-2.test.mjs           |  30 +-
```

28 files changed, 3781 insertions(+), 25 deletions(-).

**Locked-layer scope guard verified:**
```bash
git diff b3fbf4d..HEAD -- src/catalog/index.ts src/catalog/migrations/001_init.sql \
   src/catalog/migrations/002_*.sql src/social-detector/ src/fingerprint/ \
   src/search/ packages/sdk/ packages/ui/ CLAUDE.md
# → empty (only the ADDED file 003_*.sql shows as a new file, not modification)
```

`src/catalog/migrations/001_init.sql` and `src/catalog/migrations/002_*` UNTOUCHED ✓
`src/search/**` UNTOUCHED ✓
`src/social-detector/**` UNTOUCHED ✓
`src/fingerprint/**` UNTOUCHED ✓
`packages/sdk/**` UNTOUCHED ✓
`packages/ui/**` UNTOUCHED ✓
`CLAUDE.md` UNTOUCHED ✓
`src/catalog/index.ts` UNTOUCHED ✓

The single modification outside Phase 5b's `src/server/**` + `test/audit/**` is `test/catalog/migrations-phase-2.test.mjs` (+30 lines) — this is an additive test for the migration list, NOT touching the migration SQL files themselves. Within scope per tasks.md (file mentioned in prompt §1 Scope).

### R-06 deferred check (sanity)

`src/server/schema.ts:58` confirmed: `agentId: z.string()` — UNRESTRICTED (still `z.string()`, not `z.literal('claude-code')`). Phase 5b.3 T-11 will tighten. **Batch 1 must NOT have touched this. ✓**

## Idempotency / stability

- `npm test` run 1: 351 pass / 1 fail (port-contention flake on test#285)
- `npm test` run 2: **352/352 pass** — stable
- Audit fail-open: independently reproduced on a fresh throw-stub writer ✓
- Perf gate max=10.70ms vs 100ms ceiling — 9.3x headroom ✓

## Ranked gaps
None blocking PASS. Items below are documentation / non-blocking notes only.

1. **Cosmetic — perf commentary:** `routes/audit.ts:19-20` says `idx_audit_events_ts` keeps the query cheap — accurate; verified by independent measurement.
2. **`audit-row.test.mjs:97` smoke script line:** the e2e test (`POST /augment writes audit row`) lives in `test/audit/audit-row.test.mjs:98`, NOT a smoke script. The smoke scripts (`smoke-audit-failopen.mjs`, etc.) per tasks.md are Batch 2 deliverables (T-14). **No impact on Batch 1 verdict.**
3. **Spec gap (documented):** `${VAR}:value` (colon separator) is not matched by the redact regexes — only `=` form is. Matches spec.md A-19 wording.
4. **Pre-existing port flake at test#285:** observed once on the very first run, recovered immediately. Not a Phase 5b regression.

## Lesson signals

- **`mem-studio-tenantH-hash-belt-and-suspenders`:** `logger.ts` accepts only `tenantIdHashed` (typed signature enforces it). Good defense-in-depth — call sites physically cannot pass raw `tenantId`. Worth preserving in any future logger refactor.
- **`mem-studio-perf-index-headroom`:** 1000-row query peaked at 10.70ms with `idx_audit_events_ts`. Recommend re-running perf after ~10k rows to confirm headroom holds (Batch 2 may surface correlated writes / concurrent reads).
- **`mem-studio-flake-port-42900`:** tests using the default `[42900, 43000]` range occasionally collide with stale processes. Already known (Phase 5a.4 handoff). Keep test-harness using `portRange: [47300, 47399]` etc. for isolation, as `perf-100ms.test.mjs` and the independent probe above demonstrate.
- **`mem-studio-audit-failopen-design`:** the design here is genuinely clean — `splice(0, length)` as the sync primitive, timer lazy-init, error → stderr → `lastFlushTs = null`. The pattern (buffer accepts forever, writer can die safely) is a reusable template for any "best-effort telemetry" path. Worth a junior-friendly doc.
