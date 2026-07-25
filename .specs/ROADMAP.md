---
date: 2026-07-24
version: 1
description: "Roadmap placeholder. Roadmap real do Memory Studio só existe APÓS PRD fechado (via grill-with-docs)."
explanation: |
  ROADMAP.md antigo (9 phases Memory Studio) foi movido pra
  `.specs/archive/2026-07-calibration/ROADMAP.md`. Aquelas phases foram
  **exercício de calibração** da skill `tlc-roadmap-loop`, não entrega
  do produto.

  Roadmap real só existe após PRD fechado. Por enquanto: placeholder
  apontando pro próximo passo (grill-with-docs → PRD).
related:
  - ./archive/2026-07-calibration/ROADMAP.md
  - ./STATE.md
  - ../../PLAN.md
  - ../../History.md
---

# Roadmap: Memory Studio

> **Status:** placeholder. Roadmap real = pós-PRD (grill-with-docs).

## Próximo passo (única phase vigente)

#### Phase — PRD via grill-with-docs [ ]

**Phase slug:** `prd-via-grill-with-docs`
**Done when:** PRD final do MVP Memory Studio escrito, ambiguidades eliminadas, escopo/exclusões/critérios de done definidos. Documento commitado em `.specs/PRD.md` (ou similar — nome a decidir na execução).

**Depends on:** nenhum

- [ ] Instalar/verificar skill `grill-with-docs` (plugin `mattpocock/skills`)
- [ ] Rodar grill sobre: `PLAN.md`, `CLAUDE.md`, `archive_handoff/handoff-session-2026-07-23.md`, `History.md`
- [ ] Iterar até ambiguidades eliminadas
- [ ] Commitar PRD final
- [ ] Marcar nova era `2026-07-prd-ready/` com STATE.md atualizado

## Próxima era (após PRD)

Depois do PRD fechado, criar era `2026-07-prd-ready/` com:

- `STATE.md` novo (PRD fechado, autorizando produção do Memory Studio)
- `ROADMAP.md` novo (phases derivadas do PRD)
- Briefs de implementação por phase

## Era anterior (calibração)

Ver `.specs/archive/2026-07-calibration/ROADMAP.md` para histórico das 9 phases que serviram pra calibrar a skill `tlc-roadmap-loop`.
