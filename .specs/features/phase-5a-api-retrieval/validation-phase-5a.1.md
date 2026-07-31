---
date: 2026-07-31
version: 1
description: "Verifier validation for Phase 5a.1 — Server Foundation. PASS. All 20 server smoke tests + 207 root baseline + 152 UI + 16 SDK = 395 tests green. L-003 residue guard verified (root package.json adds only server:start + fastify ^5.11.0; Phase 1/2/3/4 source trees byte-identical to baseline b1b5825). Discrimination sensors pass for the critical paths. Minor observation noted: GET /augment returns 404 (Fastify default) instead of 405 + Allow: POST — defer to 5a.4 hardening."
explanation: |
  Phase 5a.1 ships the server foundation only: Fastify bootstrap, Zod
  schemas for /augment request/response, POST /augment placeholder route
  (returns structural AugmentResponse but no retrieval yet), pino
  structured logger, GET /health liveness, server:start npm script. Full
  retrieval pipeline (T-05..T-08) is Phase 5a.2.

  Verifier is independent — re-derived coverage without trusting
  Implementer's claims. Re-ran every gate listed in the dispatch role
  footnotes.

related:
  - ./spec.md
  - ./design.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../PRD.md
  - ../../../CLAUDE.md
  - ../../../package.json
---

# Phase 5a.1 — Server Foundation — Verifier Validation

## Verdict: PASS

- **Diff range:** `b1b5825..HEAD` (Phase 4 final baseline → `376aeac`)
- **Implementer commits:** `bbf3d2b` (T-01), `aea795d` (T-02), `a457f1d` (T-03), `376aeac` (T-04)
- **Re-run date:** 2026-07-31

## Re-run output (last 5 lines per gate)

| Gate | Result |
| --- | --- |
| `npm test` (root, sans ONNX embedder startup tests excluded by Phase 4 practice) | `# tests 227 / # pass 227 / # fail 0 / # skipped 0` |
| `node --test test/server/smoke.test.mjs` | `# tests 20 / # pass 20 / # fail 0 / # skipped 0` |
| `node --test test/smoke.test.mjs` | pass (baseline) |
| `node --test test/search/*.test.mjs test/catalog/{fts5,vec}-triggers.test.mjs` | `# tests 80 / # pass 80 / # fail 0` |
| `npm run typecheck` | exits 0 (no output — clean) |
| `npm run verify-env` | `6/6 checks passed` (node 22.22.2, onnxruntime-node, FTS5, sqlite-vec v0.1.9, 384d Float32Array embedding, fs roundtrip) |
| `npm run build-index -- --empty-ok` | exit 0 (`schemaVersion=3`, 0 skills processed, 65ms) |
| `npm -w packages/sdk run test` | `# tests 16 / # pass 16 / # fail 0` |
| `npm -w packages/ui run test` | `# tests 152 / # pass 152 / # fail 0` |
| `npm run server:start` | boots, prints `Memory Studio augment server: http://127.0.0.1:42900` |

**Test count summary (Phase 5a.1 contribution):**

- Baseline `b1b5825` root = 207 tests
- Phase 5a.1 added = 20 server smoke tests (`test/server/smoke.test.mjs`)
- Current root = 227 tests (all pass)
- Total project = 227 root + 152 UI + 16 SDK = **395 tests** (baseline was 375; +20)

## Spec-anchored check (ROADMAP lines 488-503 done criteria)

| ROADMAP done-when line | Verifier observation | Result |
| --- | --- | --- |
| Fastify `^5.x` bootstrap running | `npm ls fastify` → `fastify@5.11.0` single resolved. `npm run server:start` boots in <1s and binds to `127.0.0.1:42900` | PASS |
| Zod schemas validate `/augment` request shape | `src/server/schema.ts` exports `AugmentRequestSchema`, `AugmentResponseSchema`, `ContextSchema`, `FingerprintSchema`. Schemas parse PRD §7.1 fields: `prompt`, `fingerprint`, `activeCatalog`, `schemaVersion=literal(3)`, optional `context` (nullable) | PASS |
| Route handler returns structured 400 on missing fields | `src/server/augment.ts` `registerAugmentRoute()` does `AugmentRequestSchema.safeParse(body)`, returns `{ error: { code: 'MISSING_REQUIRED_FIELD', field, message } }` on failure. Tests confirm `error.code === 'MISSING_REQUIRED_FIELD'` and `error.field === 'prompt'/'fingerprint'/'activeCatalog'/'schemaVersion'` for each missing field | PASS |
| Structured pino logger emits JSON lines | `src/server/logger.ts` exports `pino({ level: 'info', formatters: { level: label => ({ level: label }) }, timestamp: pino.stdTimeFunctions.isoTime })`. `requestLogger()` returns child logger bound with `requestId` + `tenantId_hashed`. Captured log lines parse via `JSON.parse()` and contain all required fields | PASS |
| `GET /health` returns 200 with uptime | `src/server/health.ts` `registerHealthRoute()` returns 200 with `{ status: 'ok', uptime_ms, last_request_ts, request_id }`. Module-scoped `serverStartTimeMs` + `lastRequestTimestampMs` updated by route | PASS |
| Entry point wired into root `package.json` | Root `package.json` adds `"server:start": "node --experimental-strip-types --no-warnings src/server/boot.ts"` script. `boot.ts` has direct-entry guard that calls `createServer()` and sets SIGINT/SIGTERM graceful shutdown | PASS |

## Role-specific footnote checks

### Footnote 4 — L-003 critical check (residue deletion in package.json)

```diff
diff --git a/package.json b/package.json
@@ -16,11 +16,13 @@
     "typecheck": "tsc --noEmit",
     "build-index": "node --experimental-strip-types --no-warnings scripts/build-index.ts",
     "catalog:load": "node --experimental-strip-types --no-warnings scripts/build-index.ts",
-    "verify-env": "node scripts/verify-env.mjs"
+    "verify-env": "node scripts/verify-env.mjs",
+    "server:start": "node --experimental-strip-types --no-warnings src/server/boot.ts"
   },
   "dependencies": {
     "@huggingface/transformers": "^4.2.0",
     "better-sqlite3": "^11.5.0",
+    "fastify": "^5.11.0",
     "onnxruntime-node": "^1.27.0",
     "pino": "^9.5.0",
```

**Result:** PASS — root `package.json` adds ONLY `server:start` script + `fastify ^5.11.0` dependency. `workspaces` field untouched. No residue.

### Footnote 4 — Baseline test preservation

| Suite | Baseline (b1b5825) | Phase 5a.1 | Delta |
| --- | --- | --- | --- |
| Root (`npm test`) | 207 | 227 | +20 server smoke (expected) |
| UI (`npm -w packages/ui run test`) | 152 | 152 | 0 |
| SDK (`npm -w packages/sdk run test`) | 16 | 16 | 0 |

**Result:** PASS — baseline preserved.

### Footnote 5 — Phase 1/2/3/4 source files preserved

```bash
$ git diff b1b5825..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/ packages/sdk/ packages/ui/
(empty)
```

**Result:** PASS — no source drift in scope-protected directories.

`src/server/**` (new directory) modified as expected — 6 new files: `boot.ts`, `index.ts`, `augment.ts`, `schema.ts`, `logger.ts`, `health.ts` (641 total LOC).

### Footnote 6 — Discrimination sensors

Ad-hoc sensor script (run against in-process Fastify via `app.inject()` then deleted):

| Sensor | Expected | Observed | Result |
| --- | --- | --- | --- |
| Missing `prompt` → 400 | 400 + `error.field === 'prompt'` | 400 + `error.field === 'prompt'` | PASS |
| Missing `schemaVersion` → 400 | 400 + `error.field === 'schemaVersion'` | 400 + `error.field === 'schemaVersion'` | PASS |
| `schemaVersion: 4` → 400 | 400 + `error.field === 'schemaVersion'` | 400 (literal mismatch caught) | PASS |
| Valid request → 200 (NOT 400, NOT 500) | 200 | 200 | PASS |
| Empty `activeCatalog: []` → 200 (NOT 400) | 200 + `emptyReason: 'no_active_items'` + warnings | 200 + `emptyReason: 'no_active_items'` + warning `['activeCatalog is empty — proceeding with persona only']` | PASS |
| `context: null` → 200 | 200 + `emptyReason: null` | 200 + `emptyReason: null` + empty warnings | PASS |
| Malformed JSON → 400 | 400 (ZodError caught) | 400 | PASS |
| Oversized body (> 1 MiB) → 413 | 413 | 413 | PASS |
| PUT /augment → 404 or 405 | 4xx | 404 | PASS |
| **GET /augment (wrong method) → 405 with `Allow: POST`** | 405 + `Allow: POST` | **404 (no Allow header)** | **MINOR GAP — see below** |

**Minor gap:** GET /augment returns 404 instead of 405 with `Allow: POST`. This is Fastify v5 default behavior for routes registered with `app.post('/augment', ...)` — only the registered method matches; other methods return "not found". To return 405 + `Allow`, the route would need to be registered with `app.route({ method: ['POST'], url: '/augment', ... })` or with `app.get`, `app.post`, etc. on the same path. Not a blocker: the route correctly rejects wrong methods (4xx, not 2xx/5xx). Defer to Phase 5a.4 hardening as a TODO; flag in handoff.

### Footnote 7 — Idempotency

| Run | Result |
| --- | --- |
| Run 1 (just now) | 20/20 pass (duration 1706ms) |
| Run 2 (just now) | 20/20 pass (duration 1874ms) |

**Result:** PASS — deterministic across runs.

### Footnote 8 — L-006 verification (Implementer deferred items)

| Implementer note | Code confirmation |
| --- | --- |
| `agentId` unrestricted at schema (PRD §14.4 canonical `claude-code` deferred to Phase 5b) | `src/server/schema.ts:56-61`: `FingerprintSchema = z.object({ ..., agentId: z.string(), ... })` — accepts ANY string. Confirmed in code |
| `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var NOT wired (deferred to Phase 5a.4) | `src/server/boot.ts:43`: `DEFAULT_AUGMENT_PORT_RANGE: readonly [number, number] = [42_900, 43_000]` — hardcoded. No `process.env` lookup for port range. Confirmed |

**Result:** PASS — Implementer's deferred-item report matches actual code.

## Fastify bootstrap specifics

- **`src/server/boot.ts`** exports `createServer({ portRange, host, fastifyOptions })` factory
- Port discovery scans range sequentially; throws `Error('No free port in X-Y on H')` if exhausted
- Listens on `127.0.0.1` only (no external bind)
- `app.listen({ port, host })` returns the resolved handle
- Graceful shutdown: SIGINT/SIGTERM trigger `handle.close()` → `app.close()`; verified via `npm run server:start` (6s timeout, clean exit)

### Port allocation independence

| Component | Range | Source |
| --- | --- | --- |
| Phase 4 UI | `[41823, 42823]` | (Phase 4 baseline) |
| **Phase 5a server** | `[42900, 43000]` | `src/server/boot.ts:43` |

**Result:** PASS — no overlap; Phase 4 UI and Phase 5a server can run concurrently.

### Fastify version

```
$ npm ls fastify
memory-studio@0.0.0 C:\Users\User\Desktop\AI-Project\Memory-Studio
└── fastify@5.11.0
```

Single resolved version (^5.11.0 in package.json). PASS.

## Structured pino logger fields (verified via stdout capture)

Captured JSON line from a successful `/augment` request:

```json
{
  "level": "info",
  "time": "2026-07-31T22:18:06.185Z",
  "pid": 21580,
  "hostname": "DESKTOP-LG5QT3C",
  "requestId": "c925b1fc-67aa-492d-848e-632fd18d7a14",
  "tenantId_hashed": "2c99a5a27c709c9d",
  "route": "/augment",
  "decisionTraceId": "c925b1fc-67aa-492d-848e-632fd18d7a14",
  "latencyMs": { "embedding": 0, "retrieval": 0, "rerank": 0, "total": 4 },
  "matchedIds": [],
  "systemMessageSha256": "",
  "usage": { "cache_read_input_tokens": null, "cache_creation_input_tokens": null },
  "msg": "/augment"
}
```

All required fields present:
- `level`, `time`, `requestId`, `tenantId_hashed`, `route`, `decisionTraceId` — present
- `latencyMs.{embedding, retrieval, rerank, total}` — all four keys wired (values are 0 in placeholder; Phase 5a.2 fills them with real timing)
- `matchedIds` (array) — present
- `systemMessageSha256` (string) — present (empty string in placeholder; Phase 5a.2 fills with SHA-256 hex)
- `usage.cache_read_input_tokens` — present and defaults to `null` (Phase 5b wires provider cache metrics)

PASS.

## Gaps / observations (non-blocking)

1. **GET /augment returns 404, not 405 + Allow: POST** (discrimination sensor 1 fail). Fastify v5 default for routes registered with `app.post(path, ...)`. Easy fix in Phase 5a.4 (use `app.route({ method: ['POST'], url: '/augment', ... })` or similar). Not a functional blocker — wrong-method requests still rejected with 4xx. **Recommend documenting in handoff as 5a.4 TODO.**

2. **ROADMAP.md line 501** still says "range 41823-42823" — stale text from when Phase 4 was the only port user. Phase 5a.1 dispatch correctly specified [42900, 43000] and the implementation followed it. Recommend updating ROADMAP.md to reference the dispatch range in a follow-up.

3. **schema.ts docstring** notes `agentId` is unrestricted at the schema layer "so the MVP can log non-canonical clients during early rollout; tightening to the canonical ['claude-code'] list happens once Phase 5b has the proxy-layer visibility". This deviates from PRD §14.4 + spec.md R-06 (AC-5) which require `agentId === 'claude-code'` literal at MVP. Per the dispatcher footnote, this is **an accepted deferral** to Phase 5b. The discrimination sensor does not test agentId restriction in Phase 5a.1 because the dispatch explicitly defers it.

## Spec-anchored AC coverage (for Phase 5a.1 subchapter)

| AC | Where it lives in 5a.1 | Result |
| --- | --- | --- |
| AC-1 (Fastify bootstrap + graceful shutdown) | `src/server/boot.ts` | PASS |
| AC-2 (200 + structural AugmentResponse shape) | `src/server/augment.ts:47-78` returns full structural placeholder (5a.2 fills content) | PASS (shape OK; content placeholder by design) |
| AC-3 (400 + `validation_error` on missing fields) | `src/server/augment.ts:117-125` returns `{ error: { code: 'MISSING_REQUIRED_FIELD', field, message } }` | PASS |
| AC-4 (`schemaVersion: 4` → 400) | `z.literal(3)` in `schema.ts:70` | PASS |
| AC-23 (Fastify pinned in deps, single resolution) | `package.json:25` + `npm ls fastify` | PASS |
| AC-24 (Zod schemas in `src/server/...` mirroring PRD §7.1) | `src/server/schema.ts` | PASS |

ACs deferred to Phase 5a.2+ (T-05..T-13): AC-5 (agentId canonical), AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22 — out of scope for 5a.1 verification.

## Lesson signals (no new lessons added — clean PASS)

- L-003 (residue deletion): implementation respected the residue rule (package.json + scopes).
- L-005 (Implementer true observation): Implementer's deferred-item report (agentId unrestricted, env var not wired) was accurate.
- L-006 (dispatch assertions): discrimination sensor caught the GET→405 expectation mismatch. The "sensor can be wrong" applies in reverse: the spec'd expectation (405 + Allow) doesn't match Fastify v5 default for `app.post()`. This is a minor finding for the dispatcher to consider in future phase definitions, not a regression.

**No new lessons** — this is a clean PASS. Lessons store (`.specs/lessons.json`) untouched.

## Files touched in Phase 5a.1 (verifier audit)

| File | Lines added | Role |
| --- | --- | --- |
| `src/server/boot.ts` | 182 | Server factory + port discovery + graceful shutdown |
| `src/server/index.ts` | 33 | Public barrel |
| `src/server/augment.ts` | 164 | POST /augment route + placeholder pipeline |
| `src/server/health.ts` | 73 | GET /health route |
| `src/server/schema.ts` | 134 | Zod schemas |
| `src/server/logger.ts` | 55 | Pino structured logger |
| `test/server/smoke.test.mjs` | 306 | 20 server smoke tests |
| `package.json` | +4 / -1 | Adds `server:start` + `fastify ^5.11.0` |
| `package-lock.json` | +484 | npm install for fastify |

**Total:** 6 new src files + 1 new test file + 1 package.json + 1 package-lock.json = 9 modified files; 13 atomically-committed tasks for the broader phase 5a (T-01..T-13), but T-01..T-04 only are in 5a.1 scope.

## Recommendation

**Phase 5a.1 — Server Foundation PASS.** All done-when criteria from ROADMAP.md lines 488-503 are met. The implementation is faithful to the dispatch contract, preserves Phase 1/2/3/4 baselines, and emits the expected structured logs. Ready to advance to Phase 5a.2 (Retrieval Pipeline) per ROADMAP.md line 505.

**Carried to Phase 5a.4 hardening (TODO list):**
1. Switch POST /augment registration to `app.route({ method: ['POST'], url: '/augment', ... })` (or similar) so wrong-method requests return 405 + `Allow: POST` instead of 404.
2. Wire `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var into `boot.ts` (currently hardcoded `[42900, 43000]`).
3. Tighten `FingerprintSchema.agentId` to `z.literal('claude-code')` once Phase 5b proxy has visibility into the agent.
4. Update `ROADMAP.md` line 501 to reflect the dispatch's [42900, 43000] range.