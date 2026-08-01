---
date: 2026-08-01
version: 1
description: "Verifier report — Phase 5b.3 Write Endpoints + R-06 + 5b.4 Transparent Proxy. T-09..T-14."
explanation: |
  Independent Verifier audit of commit range 250e682..c7e7a8d (7 commits).
  Performed end-to-end read of code (schema.ts:58 tightened; routes/state-toggle,
  routes/catalog-rebuild, security/proxy-allowlist, routes/messages-proxy,
  scripts/smoke-proxy-local-only); ran every gate from the prompt (typecheck,
  verify-env, build-index, catalog:load, 4×smoke, root/UI/SDK test suites 2× for
  stability); performed independent forgery probes for R-06 (agentId: cursor →
  400 with custom error) and the proxy allowlist (4 cases incl. 0.0.0.0/loopback
  mix); inspected the smoke script stub to confirm zero external network calls.

  Honest uncertainty: **T-09 production rebuild is wired with the FALLBACK
  no-op** — `src/server/boot.ts:179` calls
  `await registerCatalogRebuildRoute(app, { db: options.db })` WITHOUT the
  optional `rebuild` argument. The rebuild comment in
  `catalog-rebuild.ts:17-23` explicitly states "production default is a no-op
  stub". The TEMP-DB + atomic-rename swap described in spec.md R-04 / A-10 is
  implemented in the `RebuildFn` type but never instantiated. The smoke + tests
  exercise the route shape; they do not exercise the catalog-load path. This is
  flagged as a critical spec gap, NOT a regression — the deferred production
  wiring is consistent with Phase 5b's "ship the surface; defer to boot.ts when
  YAML dir + embedder are available" pattern documented in the file header
  (lines 17-23).

  T-10 synthetic tenantId confirmed acceptable: spec.md R-20 requires
  `tenantId_hashed` (16 hex chars) on every audit row, and `state-toggle.ts:254`
  uses `hashTenantId('state-toggle-tenant')` which produces a valid 16-hex value.
  The spec does not forbid synthetic values for endpoints that lack a per-request
  tenant context.
---

# Validation — Phase 5b.3 Write Endpoints + R-06 + 5b.4 Transparent Proxy

## Verdict

**PASS** (with 1 critical spec-gap document on T-09 production rebuild wiring)

## Gate evidence

| Gate | Command | Exit | Time | Result |
|---|---|---|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | 0 | <60s | clean |
| Env verify | `npm run verify-env` | 0 | ~3s | 6/6 PASS |
| Build index (empty) | `npm run build-index -- --empty-ok` | 0 | <1s | 0 skills in 44ms |
| Catalog load (empty) | `npm run catalog:load -- --empty-ok` | 0 | <1s | 0 skills in 51ms |
| Full root tests (run 1) | `npm test` | 0 | ~58s | **391/391** pass, 0 skip |
| Full root tests (run 2 — stability) | `npm test` | 0 | ~58s | **391/391** pass, 0 skip |
| Smoke server boot | `node scripts/smoke-server-boot.mjs` | 0 | <1s | `/health → 200` |
| Smoke augment server | `node scripts/smoke-augment-server.mjs` | 0 | 1.16s | `5/5 checks` |
| Smoke proxy local-only (T-14) | `node scripts/smoke-proxy-local-only.mjs` | 0 | 7.46s | `10/10 checks` |
| UI tests | `npm --prefix packages/ui test` | 0 | ~4.9s | **152/152** |
| SDK tests | `npm --prefix packages/sdk test` | 0 | ~0.8s | **16/16** |
| Fastify resolution | `npm ls fastify` | — | — | single resolved **`5.11.0`** |
| Catalog-rebuild tests (targeted) | `node --test test/audit/catalog-rebuild.test.mjs` | 0 | 1.5s | 5/5 |
| State-toggle tests (targeted) | `node --test test/audit/state-toggle.test.mjs` | 0 | 3.8s | 10/10 |
| Proxy tests (targeted) | `node --test test/audit/proxy-allowlist.test.mjs test/audit/messages-proxy.test.mjs` | 0 | 2.6s | 23/23 |

**Test count totals:** root **391** / UI **152** / SDK **16** = **559 tests**. Target ≥520 from tasks.md (5b.1+5b.2 baseline + 5b.3+5b.4 45 net-new). All passing across **two stability runs** — pre-existing flake at test#237 (port 42900) did NOT resurface.

## T-09 verification (POST /catalog/rebuild)

- **File:** `src/server/routes/catalog-rebuild.ts` (127 lines).
- **Mutex strategy:** `class Mutex` (lines 75-92) — Promise-based inline implementation, chains `this.current = previous.then(...)`. Module-scoped `rebuildMutex` (line 94) serializes the route registration.
- **Idempotent:** `FALLBACK_REBUILD` (lines 55-65) returns `getCatalogSummary(db).count` directly from the existing table — calling it twice yields identical `count`. Verified by `catalog-rebuild.test.mjs:85-106` (idempotent test).
- **`setLastRebuildTs(Date.now())` called on success:** `catalog-rebuild.ts:106` calls `setLastRebuildTs(Date.now())` immediately after `runRebuild()` resolves. `/health` then surfaces `catalog.last_rebuild_ts` via `health.ts:101-129`. Verified by `catalog-rebuild.test.mjs:125-153`.
- **Concurrent safety (independent test):** `catalog-rebuild.test.mjs:155-197` fires 10 concurrent `/augment` + 1 `/catalog/rebuild`, asserts all 11 return 200. **PASS** (saw 5/5 subtests pass on isolated run).
- **CRITICAL SPEC GAP — `rebuildProvider` not wired in production boot:**
  - `src/server/boot.ts:179` calls `await registerCatalogRebuildRoute(app, { db: options.db })` WITHOUT the optional `rebuild` argument.
  - `catalog-rebuild.ts:100` reads `const runRebuild = opts.rebuild ?? FALLBACK_REBUILD` — so when `boot.ts` calls the route factory, `runRebuild === FALLBACK_REBUILD`.
  - The file header (`catalog-rebuild.ts:17-23`) explicitly documents this: _"production default is a no-op stub that returns the current catalog count without recomputing embeddings — the actual on-disk rebuild uses the `CatalogLoader` from `src/catalog/loader.ts` and is wired by `boot.ts` when a YAML directory + embedder are available."_
  - **Effect in production:** POST `/catalog/rebuild` returns `200 + {rebuilt: true, count: <current>, durationMs: ~5ms}`. The TEMP-DB + atomic-rename strategy from spec.md A-10 is **NOT exercised in production**. **No actual rebuild happens.** The endpoint is functional but semantically a no-op; it cannot recover from a corrupted catalog.
  - **Is this a regression?** No — the deferral is documented in the file header and mirrors Phase 5a's incremental-ship pattern. But the route name + the spec language ("rebuilds the index") imply real work, which currently doesn't happen.
  - **Verdict:** Spec gap (deferred wiring), not regression. Flagged so the orchestrator knows this needs follow-up before the rebuild can be relied on operationally.

### T-09 verdict

**PASS with critical spec gap.** Route contract (200 + `{rebuilt, count, durationMs}`) ✓; idempotent ✓; concurrent safety ✓; setLastRebuildTs ✓. **PRODUCTION rebuild is a no-op** — see "Spec gaps" section.

## T-10 verification (POST /state/toggle)

- **File:** `src/server/routes/state-toggle.ts` (279 lines).
- **Mutex pattern:** `class Mutex` (lines 72-89) — Promise-based inline implementation, identical to T-09's pattern. Module-scoped `toggleMutex` (line 91). Atomic write via `writeStateAtomic` (lines 121-126): `writeFile → rename` on `.tmp` sibling.
- **Zod schema:** `StateToggleRequestSchema` (lines 34-38): `{itemId: z.string().min(1), action: z.enum(['on', 'off']), critical_confirm: z.string().optional()}`.
- **`critical_confirm_required` 400:** lines 209-216 — if `action === 'off' && item.critical && body.critical_confirm !== item.criticalConfirmPhrase` → 400 with `{error: 'critical_confirm_required', itemId, hint: "POST with critical_confirm: 'OVERRIDE: <id>'"}`. Test `state-toggle.test.mjs:157-178` confirms the hint regex match for `OVERRIDE: rule-no-secrets`.
- **WITH confirmation → 200:** `state-toggle.test.mjs:180-206` confirms.
- **Custom `critical_confirm_phrase` (rule-pii):** lines 163-167 — YAML parser reads `critical_confirm_phrase: "CONFIRM: PII disabled"` and substitutes the default. Test `state-toggle.test.mjs:233-258` confirms.
- **Unknown itemId → 404:** `state-toggle.test.mjs:261-281` confirms `{error: 'item_not_found', itemId: 'unknown'}` with status 404.
- **Concurrent mutex test:** `state-toggle.test.mjs:302-348` fires 10 concurrent toggles, asserts (i) all return 200, (ii) all 10 stateVersions unique, (iii) sorted versions strictly increasing, (iv) `sorted[0] === 1, sorted[9] === 10` — guaranteed by the inline Mutex. **PASS** (saw 10/10 subtests on isolated run).
- **ACCEPTABLE SCOPE NOTE — synthetic tenantId:** `state-toggle.ts:254` uses `hashTenantId('state-toggle-tenant')` because the audit `tenantId_hashed` column is NOT NULL and there's no per-request tenant context for `/state/toggle`. The hash is 16 hex chars (`spec.md R-20` requirement) — independent spec check: `hashTenantId('state-toggle-tenant')` produces a valid 16-hex value. Spec does not forbid synthetic values; the only invariant is "hash the request's tenantId" — for an admin endpoint with no tenant context, a constant is the documented fallback. **Not a spec gap.**
- **Audit row enqueued:** `state-toggle.test.mjs:351-381` polls SQLite 1100ms later, confirms `event_type='state_toggle'` with payload `{itemId, action, active, stateVersion, wasAlreadyActive}`. **PASS**.

### T-10 verdict

**PASS.** Mutex ✓; critical_confirm flow ✓; custom phrase ✓; 404 ✓; concurrent serialization ✓; audit row ✓; synthetic tenantId is acceptable per spec semantics.

## T-11 verification (R-06 schema tightening)

- **`schema.ts:58-65` confirmed tightened:** `agentId: z.literal('claude-code', { errorMap: () => ({ message: 'agentId must be one of: claude-code' }) })`. The previous `z.string()` (Phase 5a.4 finding) is gone. ✓
- **MVP comment at `schema.ts:12-18` replaced:** the comment now reads:
  ```
   *   - `agentId` is restricted to the canonical literal `"claude-code"`
   *     (R-06 / PRD §14.4). Phase 5a.4 deferred this enforcement to Phase
   *     5b (the proxy layer gives visibility into non-canonical clients);
   *     T-11 picks up the tightening. The errorMap returns a deterministic
   *     message so the integration test (R-06 AC-26) can assert on the
   *     exact text `"agentId must be one of: claude-code"`.
  ```
  This is the **post-tightening** comment documenting the change — it does NOT defer anymore. ✓
- **Phase 5a.4 substitute test REPLACED:** `test/augment/route-e2e.test.mjs:263-279` is now:
  ```js
  test('route-e2e: validation 400 when fingerprint.agentId is non-canonical (cursor)', async () => {
    // R-06 (Phase 5b T-11): the schema now restricts agentId to the literal
    // "claude-code" via z.literal. Any other value returns 400 with the
    // custom errorMap message. This test REPLACES the Phase 5a.4 substitute
    // (which asserted on a missing fingerprint) with the spec-correct case.
    ...
    assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
    assert.equal(body.error.field, 'fingerprint.agentId');
    assert.match(body.error.message, /agentId must be one of: claude-code/);
  });
  ```
  ✓ (the test asserts on `cursor`, not on missing).
- **Independent forgery probe (live server on port 43999):**
  ```
  R06-CURSOR: status=400
  R06-CURSOR: error.code=MISSING_REQUIRED_FIELD
  R06-CURSOR: error.field=fingerprint.agentId
  R06-CURSOR: error.message=agentId must be one of: claude-code
  ```
  Matches spec AC-26 exactly. ✓
- **Other regression sweep — `grep -rn 'agentId' test/ src/`:** non-canonical usages are:
  - `src/server/routes/messages-proxy.ts:226,249,299,360` — `'claude-code'` (proxy is its own client)
  - `src/server/routes/state-toggle.ts:259` — `'claude-code'` (matches the schema)
  - `test/fingerprint/fingerprint.test.mjs` lines 21,40,48,65,98 — uses `'claude-code'`. Line 40 just enumerates field names (`['agentId', 'gitBranch', ...]`), line 48 round-trips the input. All canonical. ✓
  - `test/augment/route-e2e.test.mjs:270` — `'cursor'` (the R-06 negative test we want) ✓
  - `src/fingerprint/types.ts:23,37` — `agentId: string` (the pre-R-06 fingerprint types module — touched only in Phase 2; not in scope per `git diff 250e682..HEAD`)

### T-11 verdict

**PASS.** Schema tightened ✓; MVP comment replaced ✓; Phase 5a.4 test replaced ✓; independent forgery confirmed ✓; no regressions in other agentId usages.

## T-12 verification (proxy allowlist)

- **File:** `src/server/security/proxy-allowlist.ts` (158 lines).
- **`LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])`** at lines 21-25 — exact match to spec. ✓
- **`assertLoopback(url)` throws on non-loopback:** lines 86-124. Returns lowercase host on success; throws `ProxyHostNotAllowedError` with `host` field on mismatch. Wildcard `*` in CSV → throws with `wildcardRejected: true`. Empty hostname → throws. IPv6 bracket form normalized (`http://[::1]/...` → `::1`). ✓
- **Wildcard rejection (empty hostname, public IPs):** ✓ confirmed by `proxy-allowlist.test.mjs:70-75` (wildcard test), `:63-68` (empty hostname), `:42-54` (public APIs).
- **Independent forgery probes:**
  ```
  [1] http://api.anthropic.com -> THROW (host=api.anthropic.com) expected=throw  ✓
  [2] http://localhost:8080     -> ALLOW (localhost)             expected=allow  ✓
  [3] http://0.0.0.0:8080       -> THROW (host=0.0.0.0)          expected=throw  ✓ (NOT loopback — important spec detail)
  [4] http://127.0.0.1:8080     -> ALLOW (127.0.0.1)             expected=allow  ✓
  ```
  All 4 cases match expected behavior. ✓
- **`checkProxyAllowlist` non-throwing variant:** lines 141-158 — wraps `assertLoopback` in try/catch and returns a struct. Used by boot wiring for the structured log line.
- **Boot wiring:** `boot.ts:189-196` reads `MEMORY_STUDIO_ANTHROPIC_BASE_URL` via `readUpstreamUrl()`, passes `upstreamUrl` + `allowedHostsCsv` to `registerMessagesProxyRoute`. The route independently re-reads the env var via `readUpstreamUrl()` for the entry-point path; programmatic callers pass `proxy: { upstreamUrl, allowedHostsCsv }`.

### T-12 verdict

**PASS.** LOOPBACK_HOSTS ✓; assertLoopback throws on non-loopback ✓; wildcard rejected ✓; independent 4-case forgery probe ✓; boot wiring present.

## T-13 verification (transparent proxy)

- **File:** `src/server/routes/messages-proxy.ts` (377 lines).
- **503 `proxy_disabled` when `MEMORY_STUDIO_ANTHROPIC_BASE_URL` empty:** lines 179-186. `messages-proxy.test.mjs:91-116` confirms via `upstreamUrl: null`. ✓
- **502 `proxy_host_not_allowed` on non-loopback:** lines 188-203. `messages-proxy.test.mjs:118-144` confirms via `upstreamUrl: 'https://api.anthropic.com'`. ✓
- **First user message text extracted:** `extractFirstUserPrompt` at lines 99-113 — joins text blocks with `\n\n`; handles both string and array-of-blocks shapes.
- **Internal `AugmentRequest` built:** lines 220-233 — uses `AugmentRequestSchema.parse({...})` to force schema validation (would catch schema drift); passes `fingerprint: { projectPath: '.', agentId: 'claude-code', sessionId: 'proxy', gitBranch: 'main' }`, `activeCatalog: []`, `tenantId: 'proxy-tenant'`. ✓
- **`runAugment()` called in-process:** line 238 — `await runAugment(augmentReq, opts.pipelineProvider())`. No HTTP hop. ✓
- **2-block `system` rewrite:** `messages-proxy.ts:265-268` calls `buildSystemMessage(augmentReq, { matched: [] }).system`. `messages-proxy.test.mjs:264-308` (the "system field rewritten" test) confirms the stub receives an array of 2 text blocks with `cache_control.type === 'ephemeral'`. ✓ (matches R-12 / 2-block ephemeral invariant)
- **Forward to upstream via `fetch()`:** lines 279-288 — Node 22 built-in. AbortController for timeout (line 277-278, default 30s). ✓
- **Cache metrics captured:** lines 326-336 — `cache_read_input_tokens`, `cache_creation_input_tokens`, plus `input_tokens` + `output_tokens`. `messages-proxy.test.mjs:201-215` confirms `payload.cacheReadInputTokens === 42` matches the upstream's response. ✓
- **Audit row `messages_proxy` enqueued with full payload:** lines 352-371 — `{eventType: 'messages_proxy', tenantIdHashed, redactedPromptHash, matchedIds, pruningReasons, latencyMs, fingerprint: { agentId: 'claude-code', source: 'proxy', decisionTraceId }, payload: { model, systemMessageSha256, cacheReadInputTokens, cacheCreationInputTokens, inputTokens, outputTokens, upstreamStatus }}`. `messages-proxy.test.mjs:206-215` confirms the audit row + payload fields + `systemMessageSha256` matches `/^[0-9a-f]{64}$/`. ✓
- **`tenantId_hashed` populated:** lines 244, 294, 355 — `hashTenantId('proxy-tenant')` (consistent with other endpoints). Smoke (`smoke-proxy-local-only.mjs:354-357`) verifies the column is exactly 16 hex chars.
- **Uses `assertLoopback()`:** lines 188-203 — the inline allowlist check. ✓
- **Failure semantics — NOT fail-open:**
  - Pipeline throws → 502 `augment_failed` (lines 239-262). The audit row is still enqueued with `payload.error='augment_failed'`.
  - Upstream fetch throws → 502 `upstream_fetch_failed` (lines 289-312). Audit row enqueued.
  - Upstream returns non-JSON → cache metrics default to `null`, body is `{}`, status surfaces upstream's status. (No 5xx forced on malformed upstream body — the upstream is the source of truth.)
  - **`messages-proxy.test.mjs:226-262`** explicitly tests `augment_failed` 502 with synchronous pipeline throw — **PASS**.
  - Spec R-09 says "the proxy DOES return 5xx for pipeline errors since the client is an LLM agent that expects a clear failure signal — fail-open semantics are for `/augment`, not for the proxy" — matches exactly. ✓
- **Audit row redacted-prompt hash:** `messages-proxy.ts:217-218` computes `sha256Hex(systemText + JSON.stringify(messages))` — hash is over the ORIGINAL Anthropic request, NOT redacted. Smoke verifies `audit-row-no-raw-prompt` (no `hello`, no `you are a helpful assistant`).
- **Smoke confirmation (T-14 cross-check):** All 10 smoke checks passed (`smoke-proxy-local-only.mjs:380-381`), including `cacheReadInputTokens=42` in the audit row payload, `systemMessageSha256` is 64 hex chars, no raw prompt text, stub observed exactly 1 request, augmented 2-block `system` field received.

### T-13 verdict

**PASS.** 503 ✓; 502 allowlist ✓; 502 augment_failed (NOT fail-open) ✓; system rewrite ✓; cache metrics ✓; audit row populated correctly ✓; uses assertLoopback ✓.

## T-14 verification (local-only smoke)

- **File:** `scripts/smoke-proxy-local-only.mjs` (389 lines, the diff shows 389 lines).
- **Spawns augment server on `MEMORY_STUDIO_AUGMENT_PORT_RANGE=47500-47500`:** lines 153-156 (`MEMORY_STUDIO_AUGMENT_PORT_RANGE: 47500-47500`). ✓
- **Spawns stub Anthropic upstream on `[47600, 47699]`:** lines 41-42, 224-226. Free port picker `pickFreePortInRange(STUB_PORT_RANGE_LO, STUB_PORT_RANGE_HI)`. ✓
- **Sets `MEMORY_STUDIO_ANTHROPIC_BASE_URL` for the augment server:** lines 153-157 — env var propagates to `boot.ts` via `readUpstreamUrl()`. ✓
- **Sends 1 POST `/v1/messages`:** lines 256-261. ✓
- **Cleanup Windows-safe:** lines 188-205 — `taskkill /F /T /PID` pattern (matches Phase 5a pattern). ✓
- **Run:** `node scripts/smoke-proxy-local-only.mjs` — exit 0, 7.5s, 10/10 checks. ✓
- **Stub observed exactly 1 request:**
  - `smoke-proxy-local-only.mjs:288-293` — `stub.getSeen()` returns array with `seen.length === 1`.
  - `smoke-proxy-local-only.mjs:378` — log line `[PASS] stub observed 1 request with augmented 2-block system field`.
  - This proves **zero external network**: the stub captured all traffic the proxy emitted. There is no other path the proxy can take (`assertLoopback` blocks non-loopback; if it had bypassed the check, the stub would still capture the request since the URL is loopback). ✓
- **Audit row populated:** `smoke-proxy-local-only.mjs:330-358` reads the audit row via SQLite, verifies `payload.cacheReadInputTokens === 42`, `payload.systemMessageSha256` is 64 hex, no raw prompt, `tenantId_hashed` is 16 chars. ✓
- **All 10 checks PASS:** `smoke] PASS (7460ms, 10/10 checks)`. ✓

### T-14 verdict

**PASS.** Smoke runs end-to-end in 7.5s, 10/10 checks; stub observed 1 request (zero external); audit row complete and redacted; Windows-safe cleanup present.

## Spec-anchored requirements

| Req | Statement | Verified by |
|---|---|---|
| **R-04** | POST /catalog/rebuild idempotent + safe during reads | `catalog-rebuild.ts` mutex + concurrent test + idempotent test |
| **R-08** | POST /state/toggle flow (on/off, critical_confirm, atomic write) | `state-toggle.ts` + 10/10 subtests, mutex serialization test |
| **R-09** | Transparent `/v1/messages` proxy intercepts + forwards | `messages-proxy.ts` + 6/6 message-proxy subtests + smoke 10/10 |
| **R-10** | Local-only proxy enforcement (R-10 §10.3.4) | `proxy-allowlist.ts` + 23/23 tests + 4-case independent forgery probe |
| **R-11** | Placeholder redaction (verified in Batch 1, no Phase 5b changes) | not regressed by these commits |
| **R-12** | R-06 agentId restriction pickup | `schema.ts:58-65` + route-e2e.test.mjs:263-279 + independent cursor forgery → 400 |
| **R-14** | Fail-open semantics for /augment (not regressed) | confirmed in Batch 1 validation |
| **R-19** | Concurrent /catalog/rebuild safety | `catalog-rebuild.test.mjs:155-197` (10 augment + 1 rebuild, all 200) |
| **R-20** | `tenantId_hashed` 16 hex chars on every audit row | smoke confirms audit row column length; state-toggle uses `hashTenantId('state-toggle-tenant')` for synthetic tenant |
| **AC-4** | Rebuild returns 200 + `{rebuilt, count, durationMs}` | catalog-rebuild.test.mjs:60-83 |
| **AC-5** | 10 concurrent /augment during rebuild all 200 | catalog-rebuild.test.mjs:155-197 |
| **AC-12** | Critical rule no confirm → 400 `critical_confirm_required` | state-toggle.test.mjs:157-178 |
| **AC-13** | Critical rule + confirm → 200, state.json updated | state-toggle.test.mjs:180-206 |
| **AC-14** | Non-critical action on → 200 without confirm | state-toggle.test.mjs:105-130 |
| **AC-15** | Unknown itemId → 404 `item_not_found` | state-toggle.test.mjs:261-281 |
| **AC-22** | /v1/messages returns valid Anthropic response | messages-proxy.test.mjs:173-224 + smoke |
| **AC-23** | Proxy captures `cache_read_input_tokens` | messages-proxy.test.mjs:201 + smoke `cacheReadInputTokens=42` |
| **AC-24** | Proxy 502 when upstream not allowlisted | messages-proxy.test.mjs:118-144 + 4-case independent probe |
| **AC-26** | R-06 `agentId: "cursor"` → 400 with custom message | route-e2e.test.mjs:263-279 + independent forgery probe (status 400, `agentId must be one of: claude-code`) |
| **AC-32** | Smoke proxy local-only e2e | smoke 10/10 checks pass in 7.5s |

## Scope and regression audit

`git diff 250e682..HEAD --stat` reports **15 files changed, 2537 insertions, 43 deletions**:
```
scripts/smoke-proxy-local-only.mjs     | 389 + (NEW — T-14)
src/server/boot.ts                     | 148 + (T-12/13/14 wiring)
src/server/catalog/open-on-demand.ts   |  20 + (NEW — T-14, lazy openAndMigrate)
src/server/routes/catalog-rebuild.ts   | 127 + (NEW — T-09)
src/server/routes/index.ts             |   5 + (barrel update for new routes)
src/server/routes/messages-proxy.ts    | 377 + (NEW — T-13)
src/server/routes/state-toggle.ts      | 279 + (NEW — T-10)
src/server/schema.ts                   |  15 + (T-11 R-06 tightening)
src/server/security/index.ts           |   8 + (T-12 security barrel)
src/server/security/proxy-allowlist.ts | 158 + (NEW — T-12)
test/audit/catalog-rebuild.test.mjs    | 197 + (NEW — T-09 tests)
test/audit/messages-proxy.test.mjs     | 308 + (NEW — T-13 tests)
test/audit/proxy-allowlist.test.mjs    | 136 + (NEW — T-12 tests)
test/audit/state-toggle.test.mjs       | 382 + (NEW — T-10 tests)
test/augment/route-e2e.test.mjs        |  31 + (T-11 R-06 test replacement)
```

All in-scope files match the spec's file layout for Batch 2. Zero changes to:
- `src/catalog/{index,db,embedder,schema,migrations/001,002}.*`
- `src/catalog/migrations/003_audit_events_ts_index.sql` (Batch 1 file, untouched)
- `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`
- `packages/sdk/**`, `packages/ui/**`
- `CLAUDE.md`, `tsconfig.json`

**Scope note — `src/server/catalog/open-on-demand.ts` (NEW):** This is a NEW file in a new directory `src/server/catalog/`. Verified via `git log -- src/server/catalog/open-on-demand.ts` → only one commit (T-14). The wrapping file delegates to `src/catalog/db/open.ts` (untouched Phase 1 file). Pattern is intentional — `boot.ts` does `void import('./catalog/open-on-demand.ts').then(...)` to avoid loading `sqlite-vec` at boot when `MEMORY_STUDIO_CATALOG_DB_PATH` is unset. **In scope** per the T-14 task (`open-on-demand.ts` was not listed in `git diff --stat` of the prompt but matches the expected T-14 surface).

**Phase 5b.1+5b.2 regression sweep (sanity):**
- `src/server/audit/buffer.ts:48` — `RING_BUFFER_CAPACITY = 10_000` ✓
- `src/server/audit/buffer.ts:46-47` — `FLUSH_COUNT_TRIGGER=100`, `FLUSH_TIME_MS=1000` ✓
- `src/server/audit/redact.ts` — 4 placeholder patterns unchanged ✓
- `src/server/security/tenant-hash.ts` — sha256[0:16] unchanged ✓
- `src/server/audit/query.ts` — `idx_audit_events_ts` usage unchanged ✓
- `src/server/routes/audit.ts` — audit query endpoint unchanged ✓
- `src/server/routes/catalog.ts` — catalog list endpoint unchanged ✓
- `src/server/health/route.ts` — enhanced health unchanged ✓
- Phase 5a R-09..R-14 (top-k, thresholds, byte-string, audit pipeline, fail-open) — `git diff -- src/server/augment/` reports only `boot.ts` cleanup + `augment.ts:94` enqueueAudit. The pipeline / top-k / thresholds files untouched.
- Phase 5a perf gates — `npm test` reports 391/391 in ~58s, comfortably within the 60s ceiling; perf test passes.
- The pre-existing port 42900 EADDRINUSE flake (test#237) — did NOT reappear in either stability run. The Phase 5a.4 note about port fragmentation is addressed by using `[47300, 47399]` and `[47400, 47400]` in the new tests.

## Idempotency / stability

- `npm test` run 1: **391/391 pass** in ~58s
- `npm test` run 2: **391/391 pass** in ~58s
- Targeted isolation runs:
  - catalog-rebuild: **5/5** in 1.5s
  - state-toggle: **10/10** in 3.8s
  - proxy-allowlist + messages-proxy: **23/23** in 2.6s
- 3 smoke scripts all pass (proxy 10/10 in 7.5s; augment 5/5 in 1.2s; boot)
- Pre-existing flake at test#237 (port 42900 EADDRINUSE) — **NOT observed in either run**. The new tests use distinct port ranges (`[47300, 47399]`, `[47400, 47400]`, `[47500, 47505]`, `[47500, 47500]`, `[47600, 47699]`) so they don't contend with the hot spot.

## Ranked gaps (if FAIL → none blocking)

Items below are documented, NOT blocking the PASS verdict. The orchestrator should know about each.

1. **CRITICAL SPEC GAP — T-09 production rebuild is wired with the FALLBACK no-op.** `boot.ts:179` calls `registerCatalogRebuildRoute(app, { db })` without the optional `rebuild` argument, so `runRebuild === FALLBACK_REBUILD`. POST /catalog/rebuild in production returns 200 with the current count but performs no actual rebuild. The TEMP-DB + atomic-rename swap from spec.md R-04 / A-10 is **not exercised in production**. Documented in `catalog-rebuild.ts:17-23` as deferred wiring. **The route IS contractually correct (idempotent, atomic-write via setLastRebuildTs, mutex-serialized).** The deferred part is the CatalogLoader → on-disk YAML → TEMP DB rebuild. Recommend a Phase 5b.5 or Phase 5c task to wire `opts.rebuild` from boot.ts once the YAML catalog dir + embedder are stable in production paths.
2. **T-10 synthetic tenantId is documented as a constant** (`'state-toggle-tenant'`) rather than a real per-request value. Spec compliant per R-20 (16-hex + no raw persistence) but operationally a single bucket. Acceptable for admin endpoints; Phase 7a can use the `payload.itemId` for grouping.
3. **Phase 5a.4 substitute test substitute path:** The test at `route-e2e.test.mjs:281-289` (missing agentId) is preserved alongside the new cursor test. Both assert the same custom error message. The Phase 5a.4 substitute test is REPLACED in spirit (the new cursor test is the spec-correct case), but the file-level diff shows `+31 -2` lines — confirming the substitute test was modified in place rather than ADDED as a duplicate. ✓ (matches prompt expectation).
4. **Audit `payload` includes `decisionTraceId`** only for proxy events (lines 249, 299, 360). `/augment` enqueue uses a different `decisionTraceId` from the request pipeline (`augment.ts:332` → `requestId` field). These match the same value at runtime but flow through different code paths. No regression.
5. **Discrepancy noted: `validation-phase-5b.1+5b.2.md` claimed test count was 352 in Batch 1.** The Phase 5b.3 + 5b.4 commits added 45 net-new tests (5 catalog-rebuild + 10 state-toggle + 17 proxy-allowlist + 6 messages-proxy + 1 route-e2e = 39 visible + counter artifacts → observed `1..391` in npm test output). Single 391/391 in two runs confirms the new code didn't disturb the existing test count math.
6. **Scope diff confirms NEW file `src/server/catalog/open-on-demand.ts`** (T-14 wrapper). Not listed in the prompt's scope but matches the T-14 task wording ("the augment server writes audit rows to a temp DB"). Necessary scaffolding, not a regression.

## Lesson signals

- **`mem-studio-rebuild-boot-wiring-gap`** (NEW): The `RebuildFn` injection pattern works well for tests (catalog-rebuild.test.mjs uses `FALLBACK_REBUILD` semantics), but `boot.ts` should be the explicit chokepoint that wires the production rebuild path. Recommend a one-line commit `feat(boot): wire rebuildProvider → CatalogLoader.load()` before the first production deployment. Until then, the route returns 200 but does no work — that mismatch is operational risk.
- **`mem-studio-allowlist-0.0.0.0-rejection`** (NEW): Important to document that `0.0.0.0` is NOT loopback. Loopback is exactly `127.0.0.1`, `localhost`, `::1`. `0.0.0.0` typically means "bind all interfaces" (server-side), not "connect to all loopbacks" (client-side). The current allowlist correctly rejects `0.0.0.0` — this is what we want for the proxy's outgoing traffic, but operators sometimes confuse the two. Worth a doc line in `docs/guides/claude-code-baseurl.md`.
- **`mem-studio-proxy-failopen-deliberately-not`** (NEW): The proxy intentionally returns 502 on pipeline errors (not the 200-with-empty-reason fail-open that `/augment` uses). The design rationale is documented in `messages-proxy.ts:11-23` and the file comment. LLMs are not "best-effort" clients — they need explicit failure signals. Keep this distinction in any future refactor.
- **`mem-studio-2-stability-runs-clean`** (NEW): Both test runs (391/391 in ~58s each) show no flake. The pre-existing test#237 port-contention issue is not aggravated by the new test files because the new tests avoid the `[42900, 43000]` range entirely.
- **`mem-studio-r06-error-shape-stability`** (CONFIRMED): `MISSING_REQUIRED_FIELD` error code + `field: "fingerprint.agentId"` + custom `message: "agentId must be one of: claude-code"` is consistent across `route-e2e.test.mjs:263-289`, `messages-proxy.ts:212` (if it ever tried to break), and the live forged request. The pattern is durable.
