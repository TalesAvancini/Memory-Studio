---
date: 2026-07-24
version: 2
description: "Spec state vigente — era pós-calibração. Skill foundation complete; Memory Studio produção NÃO autorizada."
explanation: |
  Substitui STATE.md da era de calibração (movido pra
  `.specs/archive/2026-07-calibration/STATE.md`).

  Estado vigente:
  - Skill `tlc-roadmap-loop` v0.2 calibrada (4/5 sinais verde)
  - README + 9 Mermaid diagrams criados (global + local)
  - Memory Studio: produção NÃO autorizada — PRD via `grill-with-docs` primeiro

  Para histórico da calibração, ver `archive/2026-07-calibration/`.
related:
  - ./archive/2026-07-calibration/STATE.md
  - ./archive/2026-07-calibration/ROADMAP.md
  - ../../History.md
  - ../../handoff-session.md
---

# STATE

> **Papel:** memória da spec **vigente**. `## Decisions` é append-only (AD-NNN). `## Handoff` é overwrite por sessão.
> **Lê quando:** for entender estado atual de spec/decisões/handoff.
> **Diferente de:**
> - `History.md` — passado cronológico (narrativa + marcos)
> - `handoff-session.md` — executivo de sessão (o que estamos fazendo AGORA)
> - `MEMORY.md` — patterns de processo (1 fato por arquivo, auto-injetado)
>
> **Docs auxiliares:** ver `CLAUDE.md ## Documentation lifecycle` para o mapa completo.

## Decisions

### AD-002 — Calibração fechada; próxima fase = grill-with-docs → PRD (2026-07-24)

**Decisão:** Calibração da skill `tlc-roadmap-loop` está **fechada** (4/5 sinais verde, Sinal 4 mechanism in place). Próximo passo da era atual: usar `grill-with-docs` (Matt Pocock, plugin `mattpocock/skills`) adaptada pra autonomous, pra interrogar `PLAN.md`/`CLAUDE.md`/`History.md`/`archive_handoff/` e chegar num **PRD final do MVP Memory Studio**.

**Por quê:** Skill é fundação; sem PRD fechado, Memory Studio é construído sem escopo claro. `grill-with-docs` é mecanismo estruturado pra eliminar ambiguidades sem depender de human-in-the-loop constante.

**Regras da era:**

- Decisões reversíveis (lib, naming, estrutura) → autonomous resolve
- Decisões irreversíveis (escopo MVP, exclusões, authority) → escala humano
- **Produção do produto Memory Studio SÓ após autorização humana explícita + PRD fechado**

**Trigger pra sair desta era:** PRD do MVP fechado. Aí criar nova era (`2026-07-prd-ready/`) com roadmap real derivado do PRD.

### AD-001 — Loop v2 escopo = failure diagnostics only (2026-07-23)

(Decisão histórica — preservada da era de calibração. Ver `.specs/archive/2026-07-calibration/STATE.md` para contexto completo.)

**Resumo:** Skill v0.2 inclui apenas `step 8a` (failure diagnostics pre-flight). Outros 4 candidatos a v2 (sub-agent awareness, sticky context, branch fingerprinting, handoff auto) deferidos com trigger explícito.

## Handoff

- **era:** `2026-07-foundation-complete` (skill v0.2 calibrada)
- **era-anterior:** `2026-07-calibration` (archived em `.specs/archive/2026-07-calibration/`)
- **next-epoch:** `2026-07-grill-with-docs` → PRD final
- **skill-version:** v0.2 (em `.claude/skills/tlc-roadmap-loop/SKILL.md` LOCAL + GLOBAL em parity)
- **autorização-produção-Memory-Studio:** ❌ NÃO (aguardando PRD)
- **próximo-step-concreto:** rodar `grill-with-docs` sobre docs existentes
- **working-tree:** clean (last commit `1fbd853`)
- **não-congela:** STATE.md `## Decisions` append-only; `## Handoff` overwrite por sessão
