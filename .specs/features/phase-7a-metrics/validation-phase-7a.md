---
date: 2026-08-02
version: 1
description: "Verifier report — Phase 7a Metrics Instrumentation. Independent audit of AC-1..AC-14, gates, forge checks, POC ceilings, scope, and PRD divergences."
explanation: |
  L-006 audit of the actual Phase 7a source at current HEAD, not only
  Implementer claims. All required forge checks were run independently;
  the temporary forge script was deleted after the final 8/8 pass.
  Current HEAD includes the post-Implementer collector mapping correction
  from 87c9c96, so this report audits that corrected source as well as the
  original 03cee68 implementation.
---

# Validation — Phase 7a Metrics Instrumentation

## Verdict

**PASS** — Phase 7a CLOSES

All 14 acceptance criteria have passing functional evidence, the independent forge suite passes 8/8, both root-suite stability runs are clean (478/478 each), the locked-layer scope guard is empty, and four POC runs keep total overhead at 0.14–0.21 ms p95 (ceiling 0.30 ms). There are non-blocking contract/documentation gaps below, chiefly around malformed successful proxy responses, fractional latency output, logging, and the spec/design disagreement about sliding windows. These should be resolved before or during Phase 7b; they do not invalidate the Phase 7a observability path for the stated MVP provider response shape.

## Gate evidence

| Gate | Command | Result | Time / evidence |
|---|---|---|---|
| `npm test` (run 1) | full root suite | **478/478 PASS, 0 fail** | 140.9 s |
| `npm test` (run 2) | full root suite | **478/478 PASS, 0 fail** | 125.2 s |
| `npm run typecheck` | `tsc --noEmit` | **PASS**, exit 0, no output | — |
| `npm run verify-env` | environment pre-flight | **6/6 PASS** | Node 22.22.2; ONNX/FTS5/sqlite-vec/384d/filesystem all green |
| `npm --prefix packages/ui test` | UI workspace | **152/152 PASS, 0 fail** | 23.7 s |
| `npm --prefix packages/sdk test` | SDK workspace | **16/16 PASS, 0 fail** | 3.7 s |
| `node --test test/server/metrics/` | exact requested directory form | **Runner invocation failed** with Node 22 `MODULE_NOT_FOUND` for a directory | Known Node 22 ESM directory-resolution quirk; not a code failure |
| `node --test 'test/server/metrics/*.test.mjs'` | corrected quoted-glob form | **19/19 PASS, 0 fail** | 2.9 s |
| `node scripts/smoke-metrics.mjs` | Phase 7a E2E smoke | **PASS** | 10 `/augment`, `/metrics` 200, RSS 84 MB |
| POC run 1 | `node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs` | **PASS**, total overhead p95 0.14 ms | ≤ 0.30 ms |
| POC run 2 | same | **PASS**, total overhead p95 0.21 ms | ≤ 0.30 ms |
| POC run 3 | same | **PASS**, total overhead p95 0.14 ms | ≤ 0.30 ms |
| POC run 4 | same | **PASS**, total overhead p95 0.16 ms | ≤ 0.30 ms |
| Process-restart forgery | fresh Node process drive, then fresh Node process read | **PASS**, 5 requests then 0 after restart | AC-9 independent evidence |
| Package dependency diff | `git diff --stat bc95558..HEAD -- package.json package-lock.json` | **PASS**, empty | No new dependencies |

The exact directory-form `node --test test/server/metrics/` failure is the repository's documented Node 22 ESM quirk (the same class recorded in project memory); the quoted-glob invocation is the valid independent gate and passed all 19 tests. Both full root runs were stable. Existing Fastify deprecation warnings and audit shutdown diagnostic lines appeared in logs but did not produce test failures.

### POC re-run table (AC-13 critical gate)

| Run | sqlite.get p95 | concat p95 | template p95 | total-overhead p95 | Verdict |
|---|---:|---:|---:|---:|---|
| 1 | 0.07 ms | 0 ms | 0.07 ms | **0.14 ms** | PASS |
| 2 | 0.04 ms | 0.01 ms | 0.16 ms | **0.21 ms** | PASS |
| 3 | 0.05 ms | 0.01 ms | 0.08 ms | **0.14 ms** | PASS |
| 4 | 0.07 ms | 0 ms | 0.08 ms | **0.16 ms** | PASS |

Maximum measured total overhead is 0.21 ms p95, below the Phase 7a ceiling of 0.30 ms and far below the inherited Phase 6b 10 ms invariant. No template spike exceeded the 1 ms component budget in these four runs.

## Per-task verification

### T-01 — `MetricsRingBuffer` (`src/server/metrics/ring-buffer.ts`)

**PASS.** The actual class at `src/server/metrics/ring-buffer.ts:101-365` implements counters, a 100-slot latency ring, nearest-rank p50/p99, RSS sampling, count/time triggers, cached snapshots, and test reset. The ring overflow and `[10,20,30]` percentile behaviors were independently forged (see Forge results). The implementation intentionally extends the task's original `recordAugment` shape with `outcome` so R-1 can distinguish measured retrieval from social/no-active/fail-open paths.

### T-02 — lifecycle singleton (`src/server/metrics/lifecycle.ts`)

**PASS.** `initMetricsBuffer`, `getMetricsBuffer`, start/stop, test injection, and reset are present at `src/server/metrics/lifecycle.ts:27-58`. Idempotent initialization and reset behavior are exercised by the metrics tests and the process-restart forgery.

### T-03 — collector and dashboard helper

**PASS with documented API evolution.** `collector.ts:41-107` is a fail-open write seam; it maps `emptyReason` to `AugmentOutcome` and correctly counts `low_confidence` as measured. `dashboard.ts:27-38` exposes force-recompute and cached-read seams. The current source includes the post-Implementer correction in `87c9c96`, changing unknown/`low_confidence` reasons to the measured bucket; this is required by spec R-1 and is verified by code inspection.

### T-04 — `/metrics` endpoint

**PASS.** `src/server/routes/metrics.ts:35-42` registers `GET /metrics` and returns the cached snapshot. `src/server/routes/index.ts:15` re-exports it. Route shape and always-200 behavior pass in `test/server/metrics/route.test.mjs:20-66`.

### T-05 — boot lifecycle wiring

**PASS.** `src/server/boot.ts:196-206` initializes, starts, and registers the metrics buffer/route; `src/server/boot.ts:243-251` stops the metrics timer before audit/app shutdown. Smoke and process-restart checks exercise real boot wiring.

### T-06 — production hooks

**PASS.** `pipeline.ts:252-264` records measured matched/no-match responses; `pipeline.ts:352-360` records persona-only paths; `pipeline.ts:395-402` records fail-open timeout paths. `messages-proxy.ts:176-183` captures proxy entry time and `:379-390` records only successful upstream responses. The independent cache forgery confirms a real two-call proxy flow and same-SHA cache hit.

### T-07 — tests and smoke

**PASS.** Four metric test files contain 19 tests, and `scripts/smoke-metrics.mjs:59-162` drives ten real requests, validates response shape/values, checks the 1500 MB ceiling, and exits with `[smoke-metrics] PASS`.

### T-08 — optional integration test

**Not implemented; optional per `tasks.md:633-651`.** Required unit + route + smoke evidence is present, and the independent proxy/process forgeries cover the missing high-fidelity surfaces.

## Independent forge tests

Temporary `scripts/verifier-7a-forgery.mjs` was written, executed, corrected only for its own fake-buffer cleanup method, rerun, and deleted. The initial harness run was 7/8 because the fake injected buffer omitted `resetForTests`; no implementation assertion failed. The final run was **8/8 PASS**:

| Forge | Independent assertion | Result |
|---|---|---|
| 1. Ring overflow | 105 samples retain the newest 100; p50=54 and p99=103 | **PASS** |
| 2. Percentile edge | `[10,20,30]` gives p50=20 and p99=30 | **PASS** |
| 3. Mixed paths | 4 matched + 3 measured no-match + 2 social + 1 timeout gives `request_hit_rate=4/7`; raw request count=10 | **PASS** |
| 4. Cache stub | Two proxy calls with same upstream system SHA; stub returns cache read 42 only on second; coverage=0.5 and proxy count=2 | **PASS** |
| 5. Proxy disabled | Unset base URL; `/metrics` gives `token_cache_coverage:null`, `proxy_enabled:false`, proxy count=0 | **PASS** |
| 6. Count trigger | A counting subclass sees exactly one recompute on request #10, none on #1–#9 | **PASS** |
| 7. Time trigger | Mocked `Date.now()` + captured 60-second timer callback advances timestamp exactly 60,000 ms | **PASS** |
| 8. Sentinel preservation | Canonical `EMPTY_INTEL` produces the same no-intel SHA as omitted intel, and `recordAugmentSample` still invokes the buffer for the no-intel/measured seam | **PASS** |

The project source defines `EMPTY_INTEL` as the D-005 empty-field literal (`agentState:''`, `nextNeeds:[]`, `recentTopic:''`) at `src/server/fast-agent/intel-schema.ts:67-77`, not literally `{}`. The baseline-preservation assertion uses the repository's canonical sentinel, so the intended invariant is verified.

A separate malformed-success probe also ran independently: a stub upstream returned HTTP 200 with no `usage` object. The current result was `proxy_request_count:0`, `token_cache_coverage:null`; this is recorded as a ranked R-2 gap below because the spec defines the denominator as all 200 proxy responses.

## Spec-anchored requirements traceability

| AC | Evidence test/smoke | Actual implementation | Verdict |
|---|---|---|---|
| **AC-1** request hit rate | `test/server/metrics/dashboard.test.mjs:26-49`; independent mixed-path forge | `ring-buffer.ts:173-187`; `collector.ts:98-107`; pipeline hooks | **PASS** |
| **AC-2** proxy disabled | `dashboard.test.mjs:64-83`; independent boot-disabled forge | `ring-buffer.ts:281-287`; `messages-proxy.ts:185-192`; `boot.ts:228-234` | **PASS** |
| **AC-3** proxy enabled | `dashboard.test.mjs:85-109`; independent same-SHA stub forge | `messages-proxy.ts:321-390`; `collector.ts:66-83`; `ring-buffer.ts:201-205` | **PASS** for valid usage responses |
| **AC-4** p50 | `dashboard.test.mjs:111-124`; independent percentile forge | `ring-buffer.ts:289-300`, `:318-339` | **PASS** |
| **AC-5** p99 nearest-rank | `dashboard.test.mjs:126-154`; independent `[10,20,30]` forge | `ring-buffer.ts:336-354` | **PASS** |
| **AC-6** RSS sample | `dashboard.test.mjs:156-169`; smoke | `ring-buffer.ts:292-294` | **PASS** |
| **AC-7** count + time trigger | count: `dashboard.test.mjs:171-187`; time: independent mocked-timer forge | `ring-buffer.ts:135-143`, `:173-187` | **PASS** |
| **AC-8** endpoint shape/200 | `route.test.mjs:20-66`; smoke | `routes/metrics.ts:35-42`; barrel `routes/index.ts:15`; boot `boot.ts:204-206` | **PASS** for shape/status |
| **AC-9** transient restart | `reset.test.mjs:21-50`; independent fresh-process drive/read: 5 then 0 | `lifecycle.ts:53-58`; `ring-buffer.ts:239-256`; boot stop `boot.ts:243-251` | **PASS** for process restart |
| **AC-10** typecheck | `npm run typecheck`, exit 0 | all Phase 7a TypeScript | **PASS** |
| **AC-11** no dependencies | empty package dependency diff | no package manifest changes | **PASS** |
| **AC-12** locked-layer scope | `git diff --stat bc95558..HEAD -- src/search src/social-detector src/fingerprint packages/sdk packages/ui CLAUDE.md` empty | Phase 7a files only touch server metrics/wiring/tests/smoke; locked layers untouched | **PASS** |
| **AC-13** POC ceiling | four independent runs, total p95 0.14/0.21/0.14/0.16 ms | collector hook is fail-open and ring write is O(1); `pipeline.ts:252-264` | **PASS** |
| **AC-14** RSS under 1500 MB | smoke reports 84 MB after boot + ten `/augment` + `/metrics` | `ring-buffer.ts:292-294`; smoke `:131-139` | **PASS** |

### Requirements-level caveats behind otherwise passing ACs

1. **R-2 successful response without `usage.cache_read_input_tokens`.** `messages-proxy.ts:385-390` calls the collector for every 200 response, but `collector.ts:73-75` drops `null`, so a 200 response with no usage field is omitted from the denominator. R-2 says every 200 proxy response belongs in `proxy_requests`; the malformed-success probe demonstrated the mismatch. Normal Anthropic responses used by AC-3 include the usage field, so AC-3 remains green, but the R-2 edge should be fixed or explicitly narrowed in the spec.
2. **R-7 latency type.** The response contract comments `p50_latency_ms`/`p99_latency_ms` as integer ms (`spec.md:257-261`), but `ring-buffer.ts:295-300` returns raw `performance.now()` floats. Smoke output confirms `p50_latency_ms:0.0707...`. The percentile algorithm is correct; either round at the dashboard boundary or change the contract to permit fractional milliseconds.
3. **R-7 logging.** `routes/metrics.ts:35-42` contains no `request.log.info`/pino call, and `boot.ts:159-162` configures `logger:false`. The endpoint remains operational and always 200, but the explicit info-level logging requirement is not implemented in this phase.
4. **Window semantics.** `spec.md R-1/R-2` describes a last-N/last-60s sliding window, while `design.md §2.1/§4` explicitly chooses cumulative counters since reset and the implementation keeps `matchedRequests`, `attemptedRequests`, and proxy counters cumulative. `window.request_count` is intentionally raw total augment volume, as the Implementer flagged. This is a spec/design conflict, not an accidental regression; the AC fixtures only exercise one ten-request cycle. Phase 7b should decide whether true rolling eviction is required.
5. **Direct class signature.** `tasks.md:97` specifies `recordAugment({ matched, latencyMs })`, while the production class requires `outcome` (`ring-buffer.ts:173-177`). The additional field is the mechanism that makes R-1 exclusions correct; it is an internal API evolution, not a runtime failure. The collector is the intended public seam.

## PRD divergences

### R-1 naming divergence — verified and distinct from R-2

Phase 7a's `request_hit_rate` is the operational match-pipeline ratio: matched requests divided by measured retrieval attempts. `spec.md:118-148` documents that PRD §14.6 uses “request hit rate” for provider cache reads. The mixed-path forge proves R-1 independently as 4/7, while the proxy forge proves R-2 independently as 1/2. They are not duplicate metrics: R-1 measures retrieval success; R-2 measures Anthropic provider cache reads.

### R-2 formula simplification — verified

Phase 7a computes request-weighted `cache_hit_requests / proxy_requests` (`ring-buffer.ts:281-287`), while PRD §14.6 specifies token-weighted `Σ cache_read_input_tokens / Σ total_prompt_tokens`. The current proxy records cache-read presence/count, not token totals. This is the intentional Phase 7a simplification documented in `spec.md:150-173`; token-weighted coverage is a v3.1+ candidate.

### Other validated deviations

- `outcome` is added to `recordAugment` to represent denominator exclusions correctly.
- `low_confidence` is counted in the R-1 denominator, confirmed by the current `87c9c96` collector correction; this follows the spec even though it was not in the original implementer test fixture.
- `readProxyEnabled()` reads the environment at recompute time (`ring-buffer.ts:281-287`, `:357-365`), so runtime env changes are visible; this is correct per task note.
- `window.request_count` is total augment volume (`ring-buffer.ts:302-304`), not a rolling count; this follows the design's cumulative-counter choice but conflicts with the literal sliding-window wording, as documented above.

## Scope and regression audit

### Phase 6b baseline scope

Baseline requested by the phase is `bc95558`. The locked-layer command was empty:

```text
git diff --stat bc95558..HEAD -- src/search src/social-detector src/fingerprint packages/sdk packages/ui CLAUDE.md
# no output
```

No package dependency diff was present. The Phase 7a product/runtime files in the range are the expected set:

- `src/server/metrics/{ring-buffer,lifecycle,collector,dashboard}.ts`
- `src/server/routes/metrics.ts`
- `src/server/routes/index.ts`
- `src/server/boot.ts`
- `src/server/augment/pipeline.ts`
- `src/server/routes/messages-proxy.ts`
- `test/server/metrics/{ring-buffer,dashboard,route,reset}.test.mjs`
- `scripts/smoke-metrics.mjs`

The current branch is not literally at the Implementer's reported `03cee68`: `HEAD` is `ca3b22c`. Post-Implementer source delta is limited to the `low_confidence`/unknown outcome correction in `src/server/metrics/collector.ts` from `87c9c96`; that correction is spec-aligned and included in this audit. Additional post-target commits `81b7099` and `ca3b22c` are handoff/skill documentation only. The full `bc95558..HEAD` range also includes the phase planner/spec artifacts and Phase 6b validation docs that predate implementation. None touch locked product layers.

### Regression result

- 478 root tests pass twice.
- 19 metrics tests pass with the valid Node 22 quoted-glob invocation.
- 152 UI and 16 SDK tests pass.
- POC hot-path measurements remain below both the Phase 7a 0.30 ms ceiling and Phase 6b's 10 ms invariant.
- Smoke uses the dedicated `[48300,48399]` range and passes.
- No test#366 `[42900,43000]` port-exhaustion flake occurred in either root run.

## Idempotency / stability

- `npm test` run 1: 478/478.
- `npm test` run 2: 478/478.
- Metrics directory: 19/19.
- Independent forge: final 8/8.
- POC: 4/4, max total p95 0.21 ms.
- Fresh process restart: first process count 5; second process count 0.
- Lifecycle reset clears counters, latency ring, cached snapshot, timer, and singleton pointer (`lifecycle.ts:53-58`; `ring-buffer.ts:239-256`).

One boundary worth preserving in future tests: `createServer().close()` stops the timer but intentionally does not clear the singleton's counters (`ring-buffer.ts:146-155`). The fresh-process restart check passes because process memory disappears on actual restart; an in-process stop/recreate is not treated as a process restart by the current lifecycle design.

## Ranked gaps (none critical)

1. **Medium — R-2 denominator on a 200 response with missing usage.** The independent probe produced `proxy_request_count=0` for a 200 response with no usage object, although R-2 defines the denominator as all 200 proxy responses. Fix by recording a zero-valued cache miss for every 200, or explicitly constrain the provider response contract and add a test. Recommended before relying on coverage from partially populated upstream responses.
2. **Low/Medium — sliding-window wording vs cumulative counters.** Rates and proxy counts accumulate since reset, while the spec calls the window sliding. Design.md intentionally selected cumulative counters and raw volume. Resolve the doc/design contract before Phase 7b; implementing true eviction would be a larger metrics semantics change.
3. **Low — fractional p50/p99 vs integer response comments.** Raw monotonic-clock samples produce fractions (for example p50=0.0707 ms). Either round or update the response contract; retaining fractions is useful for measurement precision.
4. **Low — `/metrics` info-level logging absent.** Add an explicit pino/info call only if the operational logging requirement remains mandatory; current boot deliberately uses `logger:false`.
5. **Low — direct `MetricsRingBuffer.recordAugment` task signature drift.** Keep the richer `outcome` field internally, but document the collector as the supported seam or expose a compatibility overload if external callers are expected.

None of these gaps is a critical hot-path, locked-layer, persistence, or endpoint-availability failure. The first item is the only observed behavior that can change a non-happy-path R-2 ratio; it is not exercised by Anthropic-shaped AC-3 fixtures.

## Lesson signals

1. **L-006 reinforced:** Reading the real source caught the post-Implementer `collector.ts` correction, confirmed that `low_confidence` is measured rather than excluded, and exposed the missing-usage denominator behavior that the Implementer summary did not mention.
2. **L-005 reinforced:** The report separates valid-provider AC-3 PASS from the malformed-success R-2 caveat instead of claiming all proxy responses are covered. It also records the exact Node 22 directory-test invocation failure and the corrected command.
3. **POC invariant survived:** Four fresh runs show 0.14–0.21 ms p95 total overhead; no “collapse the hook” action is warranted under AD-009.
4. **Forge discipline:** An initial forge harness cleanup mistake was corrected and rerun; the final result is 8/8, with the harness issue not misreported as an implementation failure.
5. **Spec/design drift should be resolved before rolling metrics:** cumulative counters plus a 100-sample latency ring are not equivalent to a strict last-10/last-60s sliding dashboard. The current implementation follows design.md, while spec.md's literal window wording remains unresolved.

## Conclusion

**Phase 7a is verified and should be closed.** The operational path is wired end to end: augment and proxy hooks feed a fail-open in-process ring buffer; count and time triggers refresh a cached dashboard; `/metrics` is registered and always returns the required shape; process restart is transient; no new dependencies or locked-layer changes were introduced; and the Phase 6b hot-path invariant survives with substantial headroom.

Recommended follow-up before Phase 7b empirical interpretation:

- Decide/fix the R-2 treatment of HTTP 200 responses without a usage field.
- Resolve whether the dashboard is cumulative or truly rolling.
- Decide whether p50/p99 should be integer-rounded or contractually fractional.
- Add `/metrics` info logging if the R-7 logging clause remains in scope.

**Closure recommendation: APPROVE Phase 7a; dispatch the ranked follow-ups as non-blocking Phase 7b/v3.1 cleanup rather than iter-2 fix tasks.**
