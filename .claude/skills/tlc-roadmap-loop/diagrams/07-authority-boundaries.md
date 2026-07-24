---
date: 2026-07-24
version: 1
description: "Quem decide o quê: humano (PRD/decisions travadas/farol) / orchestrator (brief/dispatch/STATE) / sub-agents (scoped work)."
explanation: "Skill-level separation of concerns. Humano retém autoridade estratégica (PRD, decisions travadas, re-render). Orchestrator é autoridade operacional (dispatch, STATE updates, decision append). Sub-agents têm autoridade scoped (Planner/Implementer/Verifier，各自). Não menciona nomes específicos de role de orquestração deste projeto."
related:
  - ../README.md
  - ./01-triple-camada.md
  - ./04-subagent-contracts.md
  - ./08-memory-architecture.md
mermaid_count: 1
---

# 07 — Authority Boundaries

## Resumo

3 níveis de autoridade com separação clara. **Humano** retém decisões estratégicas (PRD, decisions travadas, farol re-render). **Orchestrator** é autoridade operacional (brief, dispatch, STATE updates, decisions append). **Sub-agents** têm autoridade scoped por role.

## Diagrama

```mermaid
flowchart TB
    subgraph HUMAN["HUMAN — strategic authority"]
        direction TB
        h_prd[PRD / product spec]
        h_decisions[Decisions travadas<br/>(ex: stack, models,<br/>authority boundaries)]
        h_farol[Farol re-render decision<br/>(step 8b user y/n)]
        h_escalation[Escalation response<br/>(3x FAIL, hard blocker)]
        h_stop[Loop pause/resume/stop]
    end

    subgraph ORCH["ORCHESTRATOR — operational authority"]
        direction TB
        o_brief[Brief parsing<br/>(triggers, scope)]
        o_dispatch[Sub-agent dispatch<br/>(prompt templates)]
        o_audit[Audit (validation.md,<br/>discrimination sensor)]
        o_state[STATE.md updates<br/>(## Decisions append,<br/>## Handoff overwrite)]
        o_loop[Loop control<br/>(pick phase, step 8a/8b,<br/>stop conditions)]
        o_commits[Phase-mark commits<br/>(flip [x])]
    end

    subgraph SUBAGENTS["SUB-AGENTS — scoped authority"]
        direction TB
        sa_planner[Planner<br/>spec.md / design.md<br/>tasks.md]
        sa_implementer[Implementer<br/>source code / tests<br/>atomic commits]
        sa_verifier[Verifier<br/>validation.md<br/>verdict + ranked gaps]
    end

    h_prd -. "shapes ROADMAP.md" .-> o_brief
    h_decisions -. "constrain dispatch<br/>(stack, scope-guard)" .-> o_dispatch
    h_farol -->|"y/n"| o_loop
    h_escalation -->|"decision"| o_loop
    h_stop -->|"interrupt"| o_loop

    o_brief --> o_dispatch
    o_dispatch --> sa_planner
    o_dispatch --> sa_implementer
    o_dispatch --> sa_verifier

    sa_planner -->|"output"| o_audit
    sa_implementer -->|"output"| o_audit
    sa_verifier -->|"output"| o_audit

    o_audit --> o_state
    o_audit --> o_commits
    o_state --> o_loop

    style HUMAN fill:#ffcdd2,stroke:#c62828
    style ORCH fill:#fff3e0,stroke:#fb8c00
    style SUBAGENTS fill:#e8f5e9,stroke:#43a047
```

## Tabela de autoridade

| Decisão | Humano | Orchestrator | Sub-agent |
|---|:---:|:---:|:---:|
| PRD / product spec | ✅ owner | | |
| Stack / models / authority boundaries (decisions travadas) | ✅ owner | | |
| Farol re-render decision (step 8b y/n) | ✅ owner | surfaces, executes on y | |
| Loop pause/resume/stop | ✅ owner | writes Handoff on stop | |
| Escalation response (3x FAIL, hard blocker) | ✅ owner | pages human | |
| Brief parsing | | ✅ owner | |
| Sub-agent dispatch (prompt template, sequencing) | | ✅ owner | |
| Audit (read validation.md, check discrimination) | | ✅ owner | |
| STATE.md updates (`## Decisions` append, `## Handoff` overwrite) | | ✅ owner | |
| Loop control (pick phase, step 8a/8b, stop conditions) | | ✅ owner | |
| Phase-mark commits (flip `[x]`) | | ✅ owner | |
| spec.md / design.md / tasks.md | | | ✅ Planner |
| Source code / tests / atomic commits | | | ✅ Implementer |
| validation.md / verdict / ranked gaps | | | ✅ Verifier |

## Regras de autoridade (PT-BR)

### Humano retém controle estratégico

- **Não** auto-renderizar farol. Step 8b pergunta primeiro.
- **Não** auto-promover patches da skill local → global. Humano decide.
- **Não** auto-mudar threshold ou schema. Humano via PR.
- **Não** auto-aceitar dependency nova. Humano via PR.

### Orchestrator é autoridade operacional

- Decide **como** dispatchar (sequência, retry, strategy shift) baseado em regras codified.
- Decide **quando** parar (stop conditions).
- Decide **o que** escrever em STATE (Decisions / Handoff).
- Decide **quando** commitar phase-mark.

### Sub-agents têm autoridade scoped

- Planner: escreve spec.md / design.md / tasks.md. **Não** commita código, **não** roda Implementer.
- Implementer: escreve source + tests + commits atômicos. **Não** roda Verifier, **não** spawna sub-agents.
- Verifier: escreve validation.md + verdict. **Não** fixa código.

## Boundaries críticas (NÃO cruzar)

| Boundary | Regra |
|---|---|
| Humano → Orchestrator | Humano passa brief, não implementação. Orchestrator não espera confirmação a cada step. |
| Orchestrator → Sub-agent | Sub-agent recebe prompt self-contained. Orchestrator não vaza chat pai. |
| Sub-agent → outro Sub-agent | **Nunca**. Sequenciamento é 100% orchestrator. |
| Sub-agent → STATE.md `## Decisions` | Append-only, **nunca** overwrite. Verifier pode appendar lesson signals. |
| Sub-agent → `architecture.html` | **Nunca**. Re-render é orchestrator (após decisão humana). |

## Por que separação clara?

Sem boundary clara:

- Sub-agents viram "mini-orchestrators" e quebram autoridade.
- Orchestrator vira "mini-implementer" e perde visão global.
- Humano vira gargalo (confirma cada step) e loop queima.

Com boundary clara:

- Cada nível tem **responsabilidade**, **autoridade**, **interface**.
- Loop pode rodar autonomamente entre decisões estratégicas humanas.
- Audit trail (STATE.md) torna-se ground truth compartilhado.

## Ver também

- [01-triple-camada](01-triple-camada.md) — Camada A/B/C topologia.
- [04-subagent-contracts](04-subagent-contracts.md) — contratos in/out de cada sub-agent.
- [08-memory-architecture](08-memory-architecture.md) — MEMORY.md é autoridade humana, não orchestrator.
- [SKILL.md §Sub-agent prompt template](../SKILL.md) — section 4 "Autonomous mode contract" + section 5 "Project glue".