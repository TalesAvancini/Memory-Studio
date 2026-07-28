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
