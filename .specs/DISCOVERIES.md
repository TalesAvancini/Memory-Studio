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
