---
date: 2026-07-27
version: 1
type: ideas-backlog
status: active
description: "Backlog de ideias pós-MVP / não-atuais. Append-only. Captura ideias antes de virarem PRD/PLAN/ADR."
explanation: |
  Este arquivo NÃO é compromisso. É parking lot.

  Distinção canônica (regra de ouro):

  - **PRD.md** = O QUE vamos construir (MVP, com decisões justificadas).
  - **PLAN.md** = COMO e QUANDO construir.
  - **ADR (`docs/adr/`)** = decisão TRAVADA após análise.
  - **STATE.md / handoff** = estado atual executivo.
  - **BACKLOG.md (este)** = ideias que NÃO estão no MVP, v3.1+, ou roadmap atual.
    Capturadas pra não esquecer. Revisitadas quando relevante.

  Quem adicionar ideia aqui DEVE prefixar com "Por que NÃO MVP" — força
  honestidade sobre o motivo de não entrar no escopo.

  Quando uma ideia do BACKLOG virar compromisso:
  1. Mover entrada pro PRD (com decisão) ou PLAN (com fase)
  2. Marcar entrada no BACKLOG como `[promoted → PRD §X]` ou `[promoted → PLAN Phase Y]`
  3. NÃO deletar — append-only preserva histórico

  Append-only: entradas antigas NUNCA são removidas, mesmo que "viradas pra baixo".
  Marcar com `[archived]` se明确 explicitamente descartadas, mas manter no arquivo.
related:
  - PRD.md
  - PLAN.md
  - CLAUDE.md
  - handoff-session.md
---

# Backlog de ideias (pós-MVP)

> **Regra:** se a ideia tem justificativa madura pra entrar no escopo, vai pra PRD/PLAN/ADR, não aqui. Aqui é captura bruta.

---

## Como adicionar uma ideia

```markdown
## I-NNN — <título curto>

**Data:** YYYY-MM-DD
**Tags:** [processo] [feature] [meta] [auto-grill] [v4+] ... (opcional)

**Ideia:** <1-3 parágrafos. O que é, como funcionaria, pra que serve>

**Por que NÃO MVP:** <honesto. Sem justificativa = entrada rejeitada>

**Status:** [open] | [promoted → PRD §X] | [promoted → PLAN Phase Y] | [archived]
```

**Sem `Por que NÃO MVP` = entrada rejeitada.** Não dá pra capturar "ideia boa" sem explicar por que não entra agora.

---

## Entradas

### I-001 — Auto-discovery de personas/skills via hook de PRD

**Data:** 2026-07-27
**Tags:** [processo] [meta] [v4+]

**Ideia:** hook que sempre captura o PRD/PLAN/spec da sessão. Modelo leve (Haiku-class) pesquisa o MVP, extrai personas que podem ser aplicadas ao projeto, busca no catálogo skills associadas às personas + tech stack mencionada no PRD + arquitetura proposta. Resultado vira sugestão no painel UI (não auto-injeta — humano decide).

**Exemplo concreto:** humano abre projeto Node com PostgreSQL + JWT. Hook captura PRD. Modelo extrai `persona=engineer-pragmatic-01`, sugere skills `auth-jwt-01`, `postgres-migrations-01`, `node-async-patterns-01`. Painel mostra como cards "sugestões", humano aceita/recusa/edita.

**Por que NÃO MVP:** depende de (a) PRD/PLAN estáveis com schema parseável, (b) modelo leve integrado ao pipeline (orquestração de prompts), (c) UI com componente de sugestões, (d) pipeline de recomendação com qualidade mínima aceitável. Nenhuma dessas peças existe. Pode virar feature em v4, ou add-on separado, ou ficar como spec viva no `.specs/features/auto-discovery/`.

**Status:** [open]

---