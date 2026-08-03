---
date: 2026-08-02
version: 1
description: "Phase 7b — Empirical Tuning + Acceptance Gate tasks. Eight atomic tasks across three execution batches: six autonomous production/gate tasks, one explicit human seven-day evidence task, and one autonomous hydration closure."
explanation: |
  The task list remains below the eight-task subchapter threshold, so there is
  no SDD subchapter split. The execution is still intentionally interrupted:
  T-07 is a non-autonomous wall-clock gate and the orchestrator must not
  dispatch T-08 until the human returns complete real evidence.

  T-01 through T-04 make measurement valid before building report tooling.
  This ordering follows L-006 findings in actual code: state thresholds are
  currently unused, production boot can select stub context, proxy output is
  rebuilt empty, and streaming/provider usage is not handled. T-05/T-06 then
  build and smoke the deterministic evaluator. T-07 collects the irreducible
  real evidence. T-08 only renders/finalizes data that already passes.
related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../DISCOVERIES.md
  - ../phase-7a-metrics/tasks.md
  - ../phase-7a-metrics/validation-phase-7a.md
  - ../phase-6b-fast-agent-intel/validation-phase-6b.4.md
  - ../../../PRD.md
  - ../../../CLAUDE.md
---

# Phase 7b — Empirical Tuning + Acceptance Gate — Tasks

**Phase:** 7b  
**Slug:** `phase-7b-acceptance-gate`  
**Companions:** `spec.md`, `design.md`  
**Branch:** `loop/phase-0`  
**Total tasks:** 8 atomic tasks (T-01..T-08)  
**Subchapter breakdown:** **NO** — exactly eight tasks, within the delegation cap.  
**Execution batches:** **3** — Batch 1 T-01..T-06 (autonomous), Batch 2 T-07 (human ≥7 days), Batch 3 T-08 (autonomous closure).

---

## 0. Hard orchestration rule

```text
Dispatch T-01..T-06
        │
        ▼
Verifier may PASS 7b.1 scaffolding
        │
        ▼
ORCHESTRATOR PAUSES — Phase 7b remains [ ]
        │
        ▼
Human completes T-07 over ≥7 × 24h
        │
        ▼
Only if production acceptance gate exits 0:
Dispatch T-08
        │
        ▼
Independent final Verifier PASS
        │
        ▼
Phase 7b [x] / Memory Studio production declaration
```

T-07 is not a task an Implementer can simulate. If the human has not supplied valid evidence, the correct state is **OPEN / waiting**, not FAIL and not PASS.

---

## 1. Dependency graph

```text
T-01 Runtime state + production context
  │
  ▼
T-02 Exact proxy request/system/session path
  │
  ▼
T-03 Streaming proxy + response-first tail
  │
  ▼
T-04 Metrics v2 + Phase 7a contract resolutions
  │
  ▼
T-05 Acceptance evaluator + CLI gate
  │
  ▼
T-06 Snapshot tool + synthetic smoke + user runbook
  │
  ╞════════════ HARD HUMAN PAUSE ════════════╗
  ▼                                          ║
T-07 [USER-DRIVEN] seven-day real evidence  ║
  │                                          ║
  ▼                                          ║
T-08 Final hydration + state freeze ◀════════╝
```

---

# Batch 1 — Phase 7b.1 autonomous scaffolding

**Tasks:** T-01..T-06  
**Owner:** Implementer  
**Estimated runtime:** 5-7h  
**Batch verdict meaning:** proves production wiring and gate machinery. It does not satisfy the seven-day done criterion.

---

## T-01 — Runtime-state authority and production pipeline context

**Description:** Create the typed server-owned runtime-state adapter and production context factory. Wire `.memory-studio/state.json` active catalog and thresholds into the actual pipeline, and ensure direct server boot with an on-disk DB uses that DB, the real multilingual-e5-small embedder, canonical catalog directory, and intel hooks rather than the in-memory zero-vector provider. Preserve explicit fixture injection for tests/smokes. This task is the prerequisite for empirical tuning: without it, changing final state values has no runtime effect. Do not modify `src/search/**`; pass the resolved values through `PipelineContext` to the existing `applyThresholds` public seam.

**Depends on:** none (Phase 7a + 6b are already DONE)

**Files to create:**

- `src/server/config/runtime-state.ts`
- `src/server/config/production-context.ts`
- `test/server/runtime-state.test.mjs`
- `test/augment/runtime-thresholds.test.mjs`
- `test/server/production-context.test.mjs`

**Files to modify:**

- `src/server/augment/pipeline.ts` — readonly threshold options; pass to `applyThresholds`
- `src/server/augment.ts` — consume the production provider supplied by boot; retain fixture/default behavior
- `src/server/boot.ts` — resolve state/catalog paths and real production context when DB path/options exist
- `src/server/index.ts` only if the new server-owned contracts need an existing barrel export

**Required behavior:**

1. State validation: cosine finite `0..1`, FTS positive integer within existing server bounds, active catalog string array.
2. Read one immutable state snapshot per request so active catalog + thresholds are coherent.
3. Production DB configured + invalid/missing state/model/catalog → startup error; no silent zero-vector fallback.
4. Test/dev mode remains injectable and does not load ONNX unless explicitly requested.
5. A near-boundary ranked fixture changes outcome when state changes `0.60/2 → 0.75/1` through the full state→pipeline seam.
6. Document in code/tests that configured initial values are `0.60/2`, while pre-7b effective defaults were `0.75/1`.

**Forbidden:**

- Any edit under `src/search/**`, `src/social-detector/**`, `src/fingerprint/**`, `packages/**`, or `CLAUDE.md`.
- New npm dependencies.
- Reading state independently twice in one request.
- Falling back to stub production behavior when an on-disk DB was explicitly configured.

**Targeted verification:**

```bash
node --test 'test/server/runtime-state.test.mjs' 'test/server/production-context.test.mjs' 'test/augment/runtime-thresholds.test.mjs'
npm run typecheck
```

**Pre-commit gates (all must pass):**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-1, AC-2, AC-18

**Atomic commit message:**

```text
feat(acceptance): wire runtime state thresholds and production pipeline (phase 7b T-01)
```

---

## T-02 — Exact transparent-proxy request, system, and session path

**Description:** Repair the non-streaming transparent proxy path so it uses runtime state, derives a per-session hash, calls an internal detailed pipeline seam, forwards the exact augmented system blocks whose SHA was audited, and preserves the caller's original system instructions. Broaden request compatibility by validating core fields while passing additional Anthropic Messages fields through, and forward only the credential/version/content-type header allowlist without logging values. The existing public `runAugment` return type must remain compatible. This task folds carry-forward item #5 and the adjacent L-006 findings; changing only `activeCatalog` would still discard matches through the current `{ matched: [] }` rebuild.

**Depends on:** T-01

**Files to create:**

- `test/server/proxy-production-request.test.mjs`
- `test/augment/detailed-pipeline-output.test.mjs`

**Files to modify:**

- `src/server/augment/augmenter.ts` — optional proxy-only original-system stable prefix; absent option preserves old byte baseline
- `src/server/augment/pipeline.ts` — detailed internal result `{response, system}` for every path; public wrapper unchanged
- `src/server/routes/messages-proxy.ts` — state-backed active catalog, hashed session identity, exact system forwarding, body passthrough, safe headers
- `src/server/boot.ts` — inject state/provider inputs required by proxy
- Existing proxy/byte-string tests where behavior is intentionally extended, not weakened

**Required behavior:**

1. `activeCatalog` comes from the same runtime state snapshot as thresholds.
2. Optional `x-memory-studio-session-id` is hashed; fallback is deterministic hash of stable original system + first user prompt. Raw value never persists.
3. Original system text/blocks remain before Memory Studio's dynamic suffix.
4. Matched fixture item text is present upstream.
5. `canonicalSha256(forwarded Memory Studio blocks) === audit/response SHA`.
6. The current proxy-only `buildSystemMessage(..., { matched: [] })` rebuild is removed.
7. `tools`, `tool_choice`, `metadata`, `stream: false`, and an unknown future body field pass through.
8. Only `x-api-key`, `authorization`, `anthropic-version`, `anthropic-beta`, and `content-type` pass through; their values never appear in logs/audit/errors.
9. Repeated stable inputs produce byte-identical stable blocks.

**Forbidden:**

- Persisting raw session header/system/prompt.
- Forwarding arbitrary/hop-by-hop headers.
- Breaking existing `/augment` callers or baseline hashes when proxy-only original system is absent.
- New deps or locked-layer edits.

**Targeted verification:**

```bash
node --test 'test/server/proxy-production-request.test.mjs' 'test/augment/detailed-pipeline-output.test.mjs' 'test/audit/messages-proxy.test.mjs' 'test/augment/byte-string*.test.mjs'
npm run typecheck
```

**Pre-commit gates:**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-3, AC-4, AC-18

**Atomic commit message:**

```text
fix(proxy): forward exact augmented system and real session state (phase 7b T-02)
```

---

## T-03 — Streaming proxy usage capture and response-first fast-agent tail

**Description:** Add a bounded Node 22 SSE tee/parser that relays upstream streaming bytes immediately while extracting usage and assistant text, then wire response-first fast-agent scheduling after JSON or SSE completion. Turn N must return/stream before the fast agent and intel write finish; Turn N+1 must read the resulting intel under the hashed session. Handle fast-agent 429/errors fail-open using the existing bounded SDK behavior only—no custom unbounded retry. Preserve upstream status/content-type and audit incomplete/aborted streams without raw chunks. Update the existing latency-trick smoke so the proxy intel-write assertion becomes a hard gate rather than best-effort.

**Depends on:** T-02

**Files to create:**

- `src/server/proxy/sse-tee.ts` (or equivalently focused server-owned helper)
- `test/server/proxy-streaming.test.mjs`
- `test/server/proxy-fast-agent-tail.test.mjs`

**Files to modify:**

- `src/server/routes/messages-proxy.ts`
- `src/server/boot.ts` only if tail dependencies need route injection
- `scripts/smoke-latency-trick.mjs` — intel write becomes required; retain dedicated range and cleanup
- Existing Phase 6b proxy/intel integration tests as needed

**Required streaming cases:**

1. Delayed SSE: first downstream chunk observed before upstream completion.
2. Usage in message-start and/or terminal events captured once, latest defined non-negative values used.
3. Unknown events forwarded byte-for-byte.
4. Clean completion schedules fast agent with assistant response text.
5. Aborted/malformed stream does not report a hit or leak raw data.
6. JSON path uses the same tail scheduler.
7. Injected fast-agent 429/error: provider response succeeds, tail is bounded/fail-open, prior intel preserved.
8. Two turns: second turn reads first turn's response-derived intel and includes it in Block 2.

**Forbidden:**

- Buffering the entire SSE response before forwarding.
- Logging response chunks, prompts, credentials, or API keys.
- Awaiting fast-agent/write completion on the client-visible response path.
- Custom infinite/retry-until-success loops.
- New deps or locked-layer edits.

**Targeted verification:**

```bash
node --test 'test/server/proxy-streaming.test.mjs' 'test/server/proxy-fast-agent-tail.test.mjs'
node scripts/smoke-latency-trick.mjs
npm run typecheck
```

**Pre-commit gates:**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-5, AC-6, AC-18

**Atomic commit message:**

```text
feat(proxy): stream usage and schedule response-first intel tail (phase 7b T-03)
```

---

## T-04 — Metrics schema v2 and Phase 7a acceptance-contract cleanup

**Description:** Resolve the three Phase 7a metric gaps needed for empirical acceptance. Count every completed upstream 200 with missing cache usage as a zero-valued miss; formalize cumulative-per-process ratio counters and last-100 latency semantics; retain fractional milliseconds and correct stale integer comments. Extend `/metrics` to schema v2 with raw non-sensitive evidence counters and stable `process_started_at`, preserving all v1 fields. Update the closed Phase 7a spec/design wording with an explicit Phase 7b resolution note; do not rewrite its validation verdict. Explicitly document that the missing pino request log is deferred to v3.1+.

**Depends on:** T-03 (both JSON/SSE completion paths must feed the metric seam)

**Files to modify:**

- `src/server/metrics/ring-buffer.ts`
- `src/server/metrics/collector.ts`
- `src/server/routes/metrics.ts` only if response typing/version needs update
- `src/server/routes/messages-proxy.ts` — normalize completed-200 absent usage to zero at one boundary
- `test/server/metrics/ring-buffer.test.mjs`
- `test/server/metrics/dashboard.test.mjs`
- `test/server/metrics/route.test.mjs`
- `test/server/metrics/reset.test.mjs`
- `.specs/features/phase-7a-metrics/spec.md` — cumulative/recompute + fractional resolution note
- `.specs/features/phase-7a-metrics/design.md` — matching resolved contract note

**Files to create:**

- `test/server/metrics/provider-denominator.test.mjs`

**Required v2 evidence:**

```text
matched_requests
attempted_requests
cache_hit_requests
proxy_requests
latency_sample_count
process_started_at
schema_version: 2
```

**Required cases:**

- JSON 200 without usage → proxy +1, hit +0, coverage 0.
- SSE completed 200 without usage → same.
- Non-200 → no proxy denominator.
- Rates equal evidence ratios.
- Counters stay cumulative across N=10/T=60 recomputes.
- Restart/test reset creates new process epoch.
- Fractional samples remain fractional; finite/non-negative contract.
- Last-100 percentile behavior remains unchanged.

**Forbidden:**

- Implementing true rolling counter eviction in this task.
- Rounding latency values.
- Adding token-weighted coverage.
- Editing `validation-phase-7a.md` evidence or hiding the original finding.
- New deps/locked-layer edits.

**Targeted verification:**

```bash
node --test 'test/server/metrics/*.test.mjs'
node scripts/smoke-metrics.mjs
npm run typecheck
```

**Pre-commit gates:**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-7, AC-8, AC-18

**Atomic commit message:**

```text
fix(metrics): count missing usage and expose acceptance evidence v2 (phase 7b T-04)
```

---

## T-05 — Typed acceptance evaluator and strict CLI gate

**Description:** Implement the deep acceptance evaluator in TypeScript and the thin `scripts/acceptance-gate.mjs` CLI. The evaluator validates snapshot schemas/modes/timestamps, separates process and threshold epochs, computes non-negative raw counter deltas, joins complete audit coverage, checks seven-day/five-session eligibility, applies all strict budget inequalities with AND cache semantics, emits one deterministic threshold recommendation, and renders the report model. Production mode must reject synthetic/stub/incomplete evidence; `--allow-synthetic` is test-only and can never report closure eligibility. This task builds the mechanism but does not create a fake final report.

**Depends on:** T-04

**Files to create:**

- `src/server/acceptance/acceptance-report.ts`
- `src/server/acceptance/index.ts` (only if a local barrel improves the module boundary)
- `scripts/acceptance-gate.mjs`
- `test/server/acceptance/report.test.mjs`
- `test/server/acceptance/gate.test.mjs`
- `test/server/acceptance/tuning.test.mjs`

**Core evaluator output:**

```typescript
interface AcceptanceEvaluation {
  readonly verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  readonly eligible_for_phase_closure: boolean;
  readonly criteria: readonly AcceptanceCriterionResult[];
  readonly sessionCoverage: unknown;
  readonly budgets: unknown;
  readonly thresholdEpochs: unknown;
  readonly finalThresholds: unknown;
  readonly ignoredSyntheticFiles: readonly string[];
  readonly evidenceHashes: readonly string[];
}
```

The exact internal types are Implementer-owned, but all fields must be readonly/typed and the CLI must consume this single evaluator rather than duplicate acceptance math.

**Required fixture matrix:**

- wall-clock `7d-1ms` fail and exact `7d` pass;
- four sessions fail, five pass;
- nine turns fail, ten pass;
- final epoch one session fail, two pass;
- process restart delta handling;
- counter regression fail;
- missing boundary snapshot fail;
- synthetic/default production reject;
- stub mode reject;
- incomplete audit reject;
- exact ratio/budget boundaries fail (`0.70`, `0.60`, `50`, `200`, `1500`);
- strict-inside values pass;
- null/NaN/Infinity/zero denominator fail;
- tuning branches: cosine dominant, FTS dominant, tie, floor reached, cache-only fail, perf fail, freeze/pass;
- same inputs render deterministic report body.

**CLI contract:**

```bash
node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
```

Optional `--allow-synthetic` is only for tests/smoke. `--out <path>` writes a report only from the evaluator model and must refuse a PASS/closure report when `eligible_for_phase_closure` is false.

**Forbidden:**

- Averaging ratios instead of raw counters.
- Accepting equality at strict thresholds.
- Treating missing evidence as zero/pass.
- Embedding real API calls or credentials in the evaluator.
- New deps or locked-layer edits.

**Targeted verification:**

```bash
node --test 'test/server/acceptance/*.test.mjs'
npm run typecheck
```

**Pre-commit gates:**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-10, AC-11, AC-12, AC-17 (renderer substrate), AC-18

**Atomic commit message:**

```text
feat(acceptance): deterministic seven-day evaluator and strict gate (phase 7b T-05)
```

---

## T-06 — Snapshot collector, integrated synthetic smoke, and operator runbook

**Description:** Create the immutable snapshot collector, full synthetic acceptance smoke, and the human operator runbook. The collector reads `/metrics` v2, state, and complete SQLite audit evidence; writes a redacted temp+rename JSON snapshot; and requires explicit real/synthetic/provider/runtime mode flags. The smoke boots the actual server/proxy with fixture DB/state/embedder and local JSON/SSE upstream, drives ten turns, validates non-empty augmentation + cache metrics + response-first intel, then exercises seven-day/five-session temporal fixtures in `--allow-synthetic` while proving production mode rejects them. The runbook describes exact prerequisites, environment setup without secrets in files, per-session capture cadence, threshold-boundary protocol, recovery, and final handoff.

**Depends on:** T-05

**Files to create:**

- `scripts/snapshot-metrics.mjs`
- `scripts/smoke-acceptance-gate.mjs`
- `test/server/acceptance/snapshot.test.mjs`
- `.specs/features/phase-7b-acceptance-gate/runbook.md` (with required YAML frontmatter)
- `.specs/features/phase-7b-acceptance-gate/threshold-tuning.md` (frontmatter + empty empirical table/scaffold; no invented final values)

**Files to modify:**

- `scripts/smoke-latency-trick.mjs` only if T-03 did not already make all intel assertions hard gates

**Snapshot CLI contract:**

```bash
node scripts/snapshot-metrics.mjs \
  --url http://127.0.0.1:<port> \
  --state .memory-studio/state.json \
  --db data/memory-studio.sqlite \
  --source real \
  --provider-mode anthropic-real \
  --fast-agent-mode real \
  --runtime-mode production \
  --out-dir .specs/acceptance/snapshots
```

No real-mode flag defaults. The script must never print or persist provider credentials.

**Smoke requirements:**

1. Dedicated Memory Studio port range `[48900,48999]` (or another documented unused range), plus distinct stub range.
2. At least 10 proxy turns; stable prefix produces first miss then hits in stub.
3. JSON and SSE request paths.
4. Non-empty original + matched augmented system captured upstream.
5. Response returns before tail; intel visible on next turn.
6. Metrics v2 counters internally consistent.
7. Synthetic snapshot envelope + hashes + redaction.
8. Synthetic seven-day/five-session fixtures pass only with `--allow-synthetic` and return `eligible_for_phase_closure:false`.
9. Default production gate rejects same fixtures.
10. Windows/POSIX child cleanup and temp artifact cleanup.

**Runbook must state explicitly:**

- T-01..T-06 completion does not close Phase 7b.
- Actual wait is at least 604,800,000ms.
- ≥5 distinct sessions, ≥10 completed turns each, ≥50 turns total.
- Snapshot after every qualifying session and immediately before a threshold change.
- One threshold change per epoch, deterministic algorithm/floors from spec R-11.
- Use `npm run build-index` + controlled restart; `/catalog/rebuild` fallback limitation.
- Real provider/fast agent/runtime required; no stub evidence.
- How to stop safely on 429, transport failure, ambiguous epoch, or lower-bound exhaustion.
- What files to return to the orchestrator; secrets/raw data never included.

**Forbidden:**

- Backdating snapshots outside synthetic fixture temp directories.
- Defaulting snapshot source/modes to real.
- Writing synthetic fixtures into `.specs/acceptance/snapshots` used by production gate.
- Modifying global default port range/test#366 as part of this task.
- New deps or locked-layer edits.

**Targeted verification:**

```bash
node --test 'test/server/acceptance/*.test.mjs'
node scripts/smoke-acceptance-gate.mjs
node scripts/smoke-latency-trick.mjs
npm run typecheck
```

Expected smoke outcome: command exits 0, but its evaluator output says `eligible_for_phase_closure=false`; a production-mode invocation against its fixtures exits non-zero.

**Pre-commit gates:**

```bash
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-9, AC-13, AC-18

**Atomic commit message:**

```text
test(acceptance): snapshot collector, synthetic gate smoke, and runbook (phase 7b T-06)
```

---

# Batch 2 — Phase 7b.2 user-driven wall-clock gate

**Task:** T-07  
**Owner:** Human operator, with orchestrator waiting  
**Estimated runtime:** at least 7 × 24h wall-clock; approximately 10-15 minutes of evidence capture/review per qualifying session in addition to ordinary coding work.

---

## T-07 — [USER-DRIVEN — NON-AUTONOMOUS WALL-CLOCK GATE] Seven-day real-session evidence

**Description:** The human runs Memory Studio in the actual Claude Code/Mavis/Cursor workflow against a real Anthropic provider and real MiniMax fast agent for at least seven elapsed days, completing at least five distinct sessions with at least ten turns each. After every qualifying session, the human runs the snapshot collector, reviews the deterministic threshold recommendation, and—only when recommended—changes one threshold between sessions with a boundary snapshot. This task is explicitly deferred to the user by L-008; the Implementer/orchestrator MUST NOT synthesize it, idle-loop for a week, backdate artifacts, or reinterpret synthetic smoke as real evidence.

**Depends on:** T-06 committed and independently verified

**Files created during operation:**

- `.specs/acceptance/snapshots/<timestamp>.json` — immutable real snapshots

**Files updated during operation:**

- `.memory-studio/state.json` — at most one deterministic threshold change between epochs
- `.specs/features/phase-7b-acceptance-gate/threshold-tuning.md` — empirical rows only, with snapshot hashes and exact rationale

**Required human preflight:**

1. Build/open the on-disk catalog DB and non-empty active catalog.
2. Configure real provider access and allowlisted upstream without writing keys to the repo.
3. Set real `MINIMAX_API_KEY`; boot log confirms fast-agent real mode.
4. Boot production runtime; `/metrics` reports schema v2 and production modes are supplied to snapshot CLI.
5. Run one real non-acceptance spot-check to verify system preservation, streaming, audit, and cache usage fields before starting the seven-day clock.
6. Record the first real snapshot; this anchors the evidence timeline.

**Required collection protocol:**

- Use ordinary coding work, not a canned synthetic benchmark presented as real.
- Maintain one stable session identity for each session; start a distinct identity for each new session.
- Complete ≥10 audited turns per qualifying session.
- Capture a real snapshot after every qualifying session.
- Capture a boundary snapshot immediately before changing state.
- Follow the R-11 recommendation exactly: change one field only; floors cosine 0.50, FTS 1.
- If cache coverage alone fails, do not lower relevance thresholds; inspect system bytes/cache eligibility/TTL/transport.
- Continue until audit span is ≥604,800,000ms and final epoch has ≥2 qualifying sessions/20 turns.

**Mechanical completion command:**

```bash
node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json
```

The command must exit 0 **without** `--allow-synthetic` and report `eligible_for_phase_closure=true` before T-07 is considered complete.

**Evidence safety check:**

- Review the snapshot collector's redaction summary.
- Confirm no API key, authorization header, raw prompt/response/context, or raw session ID appears in staged files.
- If any appears, remove the affected artifact, rotate the exposed credential, fix the collector, and recapture; never commit the leak.

**Failure/stop conditions:**

- Seven days not elapsed → WAIT.
- Fewer than five qualifying sessions or 50 turns → CONTINUE COLLECTION.
- Lower bounds reached with hit rate failing → ESCALATE; do not waive.
- Real provider/fast-agent unavailable → PAUSE; do not switch to stub.
- Ambiguous threshold epoch → recapture a clean future epoch; do not hand-edit counters.
- Production transport/system bug found → stop affected evidence, fix/reverify, and restart the affected collection interval honestly.

**Pre-commit gates after evidence is complete:**

```bash
node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs --snapshots .specs/acceptance/snapshots --state .memory-studio/state.json
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
```

**AC-NN traceability:** AC-14, AC-15 (evidence prerequisite), AC-16 (final epoch prerequisite), AC-18

**Atomic commit message (only after real gate exits 0):**

```text
chore(acceptance): capture seven-day real-session evidence (phase 7b T-07)
```

**Orchestrator instruction:** after T-06, report “waiting for human T-07 evidence” and stop. Do not dispatch T-08 early.

---

# Batch 3 — Phase 7b.3 autonomous hydration closure

**Task:** T-08  
**Owner:** Implementer  
**Estimated runtime:** 0.5-1.5h  
**Entry gate:** T-07 real evidence committed and production acceptance CLI exits 0.

---

## T-08 — Final acceptance report hydration and threshold freeze

**Description:** Run the deterministic evaluator against the committed real snapshots, generate the dated final Markdown acceptance report, verify the current `.memory-studio/state.json` pair exactly matches the evaluator-selected final threshold epoch, complete the empirical tuning log, and run every final regression/scope gate. This task does not manually repair failing numbers. If the evaluator fails, return to the relevant implementation/evidence task; never edit the report verdict, counters, timestamps, or threshold rationale by hand. The final report must include evidence hashes and no placeholders.

**Depends on:** T-07 complete; production acceptance gate exit 0

**Files to create:**

- `.specs/features/phase-7b-acceptance-gate/acceptance-YYYY-MM-DD.md` — generated, YAML frontmatter, `verdict: PASS`

**Files to modify:**

- `.memory-studio/state.json` — only if necessary to make it equal the already-evidenced final pair; no new unmeasured pair
- `.specs/features/phase-7b-acceptance-gate/threshold-tuning.md` — final row/summary generated from evidence, no subjective values

**Generation command:**

```bash
node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json \
  --out .specs/features/phase-7b-acceptance-gate/acceptance-YYYY-MM-DD.md
```

Use the actual UTC closure date in the filename. If an explicit evaluator timestamp is needed for deterministic tests, it must be supplied as a CLI argument and recorded in frontmatter.

**Required report sections:**

1. Verdict.
2. Evidence eligibility (real/provider/fast-agent/runtime modes).
3. Wall-clock/session/turn coverage.
4. Budget table with raw numerators/denominators and strict comparisons.
5. Worst observed + latest latency/memory values.
6. Threshold baselines (configured `0.60/2`, pre-7b effective `0.75/1`) and all empirical epochs.
7. Final state/runtime threshold match.
8. Snapshot/input hashes.
9. Gate commands/results.
10. Folded/deferred carry-forward items.
11. Conclusion stating Phase 7b may close only after independent Verifier PASS.

**Final budget assertions:**

```text
request_hit_rate > 0.70
AND token_cache_coverage > 0.60
AND worst_p50_latency_ms < 50
AND worst_p99_latency_ms < 200
AND max_working_set_mb < 1500
AND audit_span_ms >= 604800000
AND qualifying_sessions >= 5
AND every counted session turns >= 10
AND final_epoch_sessions >= 2
AND final_epoch_turns >= 20
```

**Final verification commands:**

```bash
# Production acceptance — MUST exit 0, no synthetic flag
node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
  --snapshots .specs/acceptance/snapshots \
  --state .memory-studio/state.json \
  --out .specs/features/phase-7b-acceptance-gate/acceptance-YYYY-MM-DD.md

# Functional + environment gates
npm test
npm run typecheck
npm run catalog:load -- --empty-ok
npm run verify-env
npm --prefix packages/ui test
npm --prefix packages/sdk test

# End-to-end/POC gates
node scripts/smoke-acceptance-gate.mjs
node scripts/smoke-latency-trick.mjs
node scripts/smoke-metrics.mjs
node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs

# Locked layers and dependency manifests MUST be unchanged from Phase 7a baseline
# Use the actual T-01 baseline commit in place of <phase-7b-base>.
git diff --stat <phase-7b-base>..HEAD -- \
  src/search src/social-detector src/fingerprint packages/sdk packages/ui CLAUDE.md package.json package-lock.json
```

Expected locked/dependency diff output: empty.

**Forbidden:**

- Hand-editing evaluator-produced metric values/verdict.
- Selecting a threshold pair not evidenced by the final epoch.
- Deleting failing snapshots to improve the result; invalid artifacts must remain explained or be replaced only through a documented recapture protocol.
- Marking ROADMAP complete before independent Verifier PASS.
- New code scope unless a real gate bug is fixed in a separate atomic task/iteration and all evidence remains valid.

**AC-NN traceability:** AC-15, AC-16, AC-17, AC-18

**Atomic commit message:**

```text
docs(acceptance): hydrate seven-day report and freeze final thresholds (phase 7b T-08)
```

---

## 2. Per-batch exit gates

### Batch 1 (T-01..T-06)

Batch 1 may be handed to a Verifier when:

- AC-1..AC-13 and autonomous portions of AC-18 pass.
- Synthetic smoke exits 0 but says closure false.
- Production gate rejects synthetic evidence.
- All root/typecheck/catalog gates pass.
- No locked/dependency diff exists.

**Verifier verdict wording:** `PASS — 7b.1 scaffolding; PHASE 7b REMAINS OPEN pending user T-07`.

### Batch 2 (T-07)

Batch 2 completes only when the no-synthetic production gate exits 0 on real evidence. Elapsed time and session count are data, not human attestation alone.

### Batch 3 (T-08)

Batch 3 completes only when final report/state/full gates pass and a fresh independent Verifier re-evaluates the real evidence.

---

## 3. Carry-forward traceability by task

| Carry-forward item | Task | Result |
|---|---|---|
| 1. 200 missing usage denominator | T-04 | Folded, tested as counted miss. |
| 2. Sliding wording vs cumulative | T-04 | Folded, cumulative-per-process contract. |
| 3. Fractional p50/p99 comments | T-04 | Folded, fractional retained. |
| 4. `/metrics` pino info logging | — | Deferred v3.1+; documented in spec/design/report. |
| 5. Proxy activeCatalog/T-14 fast-agent path | T-02 + T-03 | Folded and completed coherently through exact system/session/stream/tail path. |
| 6. `/catalog/rebuild` fallback no-op | — | Deferred v3.1+; runbook uses build-index + restart. |
| 7. Test#366 port exhaustion | — | Deferred v3.1+; T-06 uses dedicated range + cleanup. |

Additional L-006 production blockers are covered by T-01..T-03.

---

## 4. Verifier handoff checklist

The final Verifier should independently:

1. Confirm T-01 state values affect actual pipeline behavior and locked search is untouched.
2. Capture proxy upstream bytes and verify original system + real matched text + exact SHA.
3. Prove stream first-byte timing and usage extraction with an independent SSE fixture.
4. Inject fast-agent 429 and verify bounded fail-open response-side behavior.
5. Forge the missing-usage 200 and verify denominator increment.
6. Recompute metrics v2 ratios from raw counters.
7. Forge every strict gate boundary and synthetic rejection.
8. Hash/re-evaluate T-07 real snapshots; verify seven days, five × ten, modes, final threshold epoch, and all budgets.
9. Confirm final state equals evidenced pair and runtime consumed it.
10. Run all final commands twice where stability matters; report real flakes honestly.
11. Verify no raw content/credential/session ID appears in snapshots/report.
12. Verify locked layers/dependency manifests are unchanged.

Only the final post-T-08 Verifier may recommend checking Phase 7b `[x]`.
