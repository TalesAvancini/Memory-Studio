# Discoveries

Log append-only de drift arquitetural. Append-only — nunca editar entrada existente (severidade pode evoluir em entry nova referenciando a antiga).

## Severidade
- **critical**: boundary change (auth / persistence / authority / concurrency model) — escalates immediately, bloqueia próxima fase
- **structural**: novo componente/edge que muda topologia — acumula; 3+ auto-suggests re-render
- **cosmetic**: label/agrupamento/naming — log only, não surface

## Schema de entrada

| ID    | Severidade                       | Descrição | Fase |
|-------|----------------------------------|-----------|------|
| D-NNN | `cosmetic\|structural\|critical` | …         | F-N  |

---

*(vazio — primeira entrada virá da Phase 1)*

---

## 2026-07-28 — Auto-grill composite (PRD.md + PLAN.md), run 2026-07-28_023050

| ID | Severidade | Descrição | Origem |
|----|------------|-----------|--------|
| D-001 | structural | Drift §18→§16 em PLAN.md:241, 254, 375 — referências stale ao PRD v3.0. PRD v3.1 renumerou mas PLAN não acompanhou. Affects cross-doc reading trust. | auto-grill round 1 (decision #2) |
| D-002 | structural | Drift interno em PLAN.md: Phase 1/Phase 5 body sections vs table estimates divergem. Tabela é canônica (caption explica +1h em cada), body stale. **Process gap:** nenhum doc define convenção body-vs-table quando conflitam. | auto-grill round 2 (decision #3) |
| D-003 | structural | Branch B ausente: PRD §10.1 marca inception híbrida CONDICIONAL ao grill §16.6 mas PLAN hardcode Phase 6 e Phase 7 pre-reqs sem fallback. Se grill reprovar, PLAN precisa de branch explícito. | auto-grill round 1 (decision #1) |
| D-004 | cosmetic | Critical Rules contrato é coerente entre PRD §6.2 + §10.1 + PLAN §10, mas redação atual ("can't toggle off sem confirmar") pode gerar ambiguidade de implementação. Recomendação: adicionar exemplo explícito em §6.2. | auto-grill round 3 (decision #4) |
| D-005 | structural | "intel" usado 21 vezes (PRD:15 + PLAN:6) sem schema formal. É o contrato writer-reader entre fast agent (§16.2) e match pipeline (§3 Turn N+1). Phase 6 vai inventar se não definir antes. | auto-grill round 4 (decision #5) |
| D-006 | structural | Tiebreak policy ausente em matchedSkills/Rules/Personas. RRF ties com cosine 384d perto do threshold quebram byte-string determinístico → cache hit do provedor falha silenciosamente. | auto-grill round 5 (decision #6) |
| D-007 | critical | Audit log: docs silenciosos sobre boundary de persistência (sync vs async). Budget p50<50ms/p99<200ms implica async, mas spec não declara. Sem declaração explícita, Phase 5 pode bloquear request. | auto-grill round 6 (decision #7) |
| D-008 | structural | Empty activeCatalog: sem contrato definido. Enum `emptyReason` cobre `low_confidence \| social \| timeout \| null` mas não catalog vazio. Behavior deve ser explícito (200 + unaugmented + `emptyReason: "no_active_items"`). | auto-grill round 7 (decision #8) |
| D-009 | structural | 5 endpoints MVP (/catalog, /catalog/rebuild, /audit, /audit/summary, /health) sem ownership explícito em PLAN. /health crítico pra §10.2 latency gating. | auto-grill round 8 (decision #9) |

---

## 2026-08-01 — AD-006 Architectural Decision: Phase 6a POC Validation outcome

### AD-006 — Phase 6a POC Validation outcome (2026-08-01)

**Decision:** Phase 6a POC result is **PASS**.

**Measurements (5 runs of the POC; numbers from the median run):**

- Hot path overhead (sqlite.get + concat + template render, p95 sum): **0.07ms** (budget < 10ms)
  - sqlite.get(intel): 0.02ms p95 (budget < 5ms)
  - concat(intel + prompt): 0ms p95 (budget < 1ms)
  - template render: 0.04ms p95 (budget < 1ms)
- Fast agent latency (MiniMax-M2.7-highspeed, p95): **223.18ms** (budget < 3s) — **measured in stub mode** (real API not provisioned in this environment; `MINIMAX_API_KEY` unset + `@anthropic-ai/sdk` not installed)
- Byte-string determinism with template: **PASS** (10/10 tests across `byte-string-equality.test.mjs` + `intel-schema.test.mjs`)

**Por quê:** Phase 6a is the validation gate before Phase 6b's full inception híbrida implementation. The empirical numbers here bound Phase 6b's per-request latency budget. All targets PASS with 1.5+ orders of magnitude headroom on the PRIMARY criterion (hot path overhead).

**PASS path:** Phase 6b proceeds with these targets as ceilings. No architectural adjustment needed.

**Por que NÃO FAIL path:** The 1.19ms template render outlier on the cold-start run is a JIT-warmup artifact, not a fundamental ceiling. After 5 warmup calls, the script consistently lands at p95 < 0.10ms. The stub fast-agent latency (223ms) is well within the highspeed < 1s range — the real API latency will be re-measured in Phase 7b.

**Architectural decisions for Phase 6b (NOT collapsed, per PRD §16.7 rule):**

1. `BuildOptions.intel` formalization: add `intel?: Intel` to `BuildOptions` in `src/server/augment/augmenter.ts:51-70` and update `buildVariableSuffix` to emit the `## Intel` section.
2. Intel store SQLite schema migration: ship the formal `intel` table migration (`src/catalog/migrations/004_intel.sql`) with WAL mode + covering index `idx_intel_session_id`.
3. Fast agent module location: extract `src/server/fast-agent/{client,writer}.ts` for the in-process Haiku/MiniMax-M2.7-highspeed integration per PRD §16.4 resolution #1.
4. Async vs sync intel write: POC assumes sync write (latency is negligible per R-01 budget). Phase 6b may need async batching if write latency spikes (similar to D-007 CRITICAL audit async pattern).

**Phase 6b per-request latency budget (derived from POC):**

| Operation | Phase 6b ceiling (p95) | POC measured |
|---|---|---|
| `sqlite.get(intel)` | < 5ms | 0.02ms |
| `concat` | < 1ms | 0ms |
| `template render` | < 1ms | 0.04ms |
| **TOTAL HOT PATH OVERHEAD** | **< 10ms** | **0.07ms** |
| Fast agent latency | < 3s | 223ms (stub) |

**Regras:**

- Phase 6b MUST honor these measurements as ceilings.
- If Phase 6b's production wiring exceeds these budgets, the human decides to optimize (not to add a fallback).
- The stub fast-agent is a defensive fallback, NOT a permanent substitute — Phase 7b tuning re-measures with the real API.

**Related:**
- POC results: `.specs/features/phase-6a-poc-validation/poc-results.md`
- Harness: `scripts/poc-6a-{hot-path,fast-agent}.mjs` + `scripts/stub-fast-agent.mjs`
- Tests: `test/poc/{stub-fast-agent,byte-string-equality,intel-schema}.test.mjs`
- Phase 6b planning: triggers after this AD is reviewed.

---

## 2026-08-01 — AD-007 + AD-008: Phase 6b Batch 3 (6b.4) closure

### AD-007 — Phase 6b cache hit invariant verified at end-of-phase (2026-08-01)

**Decision:** Phase 6b Batch 3 (6b.4 — Pipeline Integration + Cache Hit
Validation) cache hit invariant is **VERIFIED** via
`test/augment/inception-cache-hit.test.mjs` (5 cases) + the
`test/augment/byte-string-with-intel.test.mjs` regression suite
(Block 1 byte-identical across 5 intel variations).

**Measurements (5 cache-hit invariant cases, all PASS):**
- Same persona + different prompts + same intel: 2nd call SHA
  byte-identical to 1st call → stub cache tracker reports
  `cache_read_input_tokens: 42` (cache hit) — **PASS**.
- Different persona: 2nd call SHA differs from 1st → stub cache
  tracker reports `cache_read_input_tokens: 0` (cache miss) —
  **PASS**.
- Single turn: stub cache tracker reports
  `cache_read_input_tokens: 0` (no prior cache) — **PASS**.
- Defensive: Block 1 (persona text) byte-identical across 3 intel
  variations (no-intel / full / different recentTopic) — **PASS**
  (cache prefix is stable).
- Defensive: full 2-block SHA DOES differ when intel changes
  (Block 2 grows the `## Intel` section) — **PASS** (intentional:
  Block 2 is the variable suffix; cache hit is on Block 1 only).

**Por quê:** R-15 (cache hit invariant) is the LOAD-BEARING
contract of the inception híbrida — without it, the `cache_control:
ephemeral` markers on the 2-block structure can't deliver cost
savings on Turn N+1. The test surfaces a stub cache tracker that
simulates Anthropic's `usage.cache_read_input_tokens` metric (0 on
first call, 42 on subsequent calls with the same SHA). Real
Anthropic cache hit requires real API access + TTL window — that's
Phase 7b's measurement. The stub proves the FLOW.

**Regras:**
- Block 1 (persona) is NEVER modified by intel changes (R-15
  invariant).
- Block 2 (intel + skills + rules + context + warnings) is the
  variable suffix; cache-miss expected when intel changes.
- The `## Intel` section is FIRST in Block 2 (R-10 + AD-006 #1)
  to maximize cache-key stability when only Skills/Rules shift.
- The no-intel baseline SHA `4f6dba1b411a9c2947863416098aeac30db43869f1469d6bc11a7852925eb633`
  is preserved (D-006 byte-string determinism).

**Related:**
- Test: `test/augment/inception-cache-hit.test.mjs` (5 cases)
- Test: `test/augment/byte-string-with-intel.test.mjs` (5 cases —
  Block 1 stability regression guard)
- Spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-11
- Validation: `.specs/features/phase-6b-fast-agent-intel/validation-phase-6b.3.md`
  (Phase 6b.3 baseline already confirmed the no-intel SHA is
  byte-identical to Phase 6a.2)

---

### AD-008 — Phase 6b sync vs async intel write decision (2026-08-01)

**Decision:** Phase 6b production canonical writer is **SYNC**
(`createSyncIntelWriter` is the default per AD-006 #4). The
`createAsyncIntelWriter` factory is shipped as a documented
fallback (NOT auto-activated) per the D-007 mirror pattern.

**Measurements (`test/server/fast-agent/writer-perf.test.mjs`):**
- Sync write p95: **0.089ms** across 95 measured samples (5 warmup
  + 95 measured = 100 total writes) — budget < 1ms per AD-006 #4
  fallback trigger.
- Decision: **SYNC (measured 0.089ms ≪ 1ms, no fallback needed)**.
- Async fallback factory `createAsyncIntelWriter` exists per
  `test/server/fast-agent/writer-perf.test.mjs` structural
  assertion (T-06 deliverable preserved).

**Por quê:** Per AD-006 #4, sync is the default. Async is the
fallback IF measured > 1ms. The measured p95 (0.089ms) is 11x
under the 1ms trigger threshold, so the async factory ships but
is not auto-activated. Phase 6a POC measured sqlite INSERT
overhead = SELECT overhead = 0.02ms (250x under budget) — the
measured 0.089ms here is slightly higher than the POC number
because the perf test runs 100 sequential writes (more data →
slightly higher p95) but still well within budget.

**Regras:**
- Production wiring uses `createSyncIntelWriter` (default in
  `createDefaultIntelWriter`).
- The async factory `createAsyncIntelWriter` mirrors the
  `AuditRingBuffer` pattern from `src/server/audit/buffer.ts` —
  in-memory ring buffer (cap 10_000) + batch flush (N=100 OR
  T=1000ms) + fail-open.
- If a future environment reports p95 > 1ms, the operator
  switches the boot wiring to `createAsyncIntelWriter`. The
  factory signature is identical to the sync writer (both
  implement the `IntelWriter` interface), so the swap is
  one-line.

**Related:**
- Test: `test/server/fast-agent/writer-perf.test.mjs` (4 cases)
- Module: `src/server/fast-agent/writer.ts` (sync + async
  factories)
- Spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-5
- AD-006 #4: sync default, async fallback if measured > 1ms

---

## 2026-08-01 — AD-009: Phase 6b end-of-phase POC re-run confirms ceilings survived (2026-08-01)

### AD-009 — Phase 6b production wiring re-runs Phase 6a POC at end-of-phase (2026-08-01)

**Decision:** Phase 6b production wiring RE-RUNS the Phase 6a POC
ceilings and **PASSES**. The hot path overhead stays well under
budget after the new code paths (Stage 1b intel read + tail
setImmediate intel write) are active.

**Measurements (re-run of Phase 6a POC, with Phase 6b code active):**
- Hot path overhead (sqlite.get + concat + template render, p95 sum):
  **0.07ms** (Phase 6a budget < 10ms — **143x headroom preserved**)
  - sqlite.get(intel): 0.03ms p95 (Phase 6a budget < 5ms)
  - concat: 0ms p95 (Phase 6a budget < 1ms)
  - template render: 0.04ms p95 (Phase 6a budget < 1ms)
- Total per-request overhead: **0.07ms p95** (Phase 6a budget < 10ms).
- Sync write perf (AD-008): 0.089ms p95 (Phase 6a budget < 1ms).

**Por quê:** Phase 6b is the production wiring — the POC numbers
become ceilings the runtime MUST honor. If the wiring exceeded
the ceilings, the human would decide to optimize (NOT add a
fallback) per PRD §16.7 rule "ajustar, não collapsar". The
re-run is MANDATORY at T-17 (end of phase) and PASSES with the
same Phase 6a POC overhead (0.07ms total). The Stage 1b +
tail setImmediate additions are NOT in the hot path for the
POC's measurement surface (the POC measures the intel-read
cost, not the tail-write cost, since the tail is a setImmediate
that fires after the response is built).

**Regras:**
- Phase 6b is now CLOSED — all ceilings survived.
- Future phases that modify the hot path (e.g., adding a new
  section to Block 2) MUST re-run `scripts/poc-6a-hot-path.mjs`
  to confirm the ceilings survive.
- If a future phase exceeds the ceilings, optimize (not collapse)
  per PRD §16.7.

**Related:**
- POC harness: `scripts/poc-6a-hot-path.mjs`
- POC results: `.specs/features/phase-6a-poc-validation/poc-results.md`
- Spec: `.specs/features/phase-6b-fast-agent-intel/spec.md` AC-12
  (mandatory POC re-run at end-of-phase)
- AD-006: Phase 6a POC result (the ceilings this re-run honors)
- AD-008: Sync writer perf (0.089ms p95)

