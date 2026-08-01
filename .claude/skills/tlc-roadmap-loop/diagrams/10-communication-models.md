---
date: 2026-08-01
version: 1
description: "Comparação entre 4 modelos de comunicação/holding do orquestrador: atual (foreground wait) vs Dynamic Workflow wrap (A) vs skill com scratchpad (B) vs híbrido schedule+scratchpad (C)."
explanation: |
  O `tlc-roadmap-loop` v0.2 tem um problema estrutural documentado em
  `handoff-orchestrator.md` UPDATE 2026-08-01: o orquestrador fica em
  foreground esperando o sub-agent retornar. Isso consome tokens de holding
  e impede HITL mid-execution.

  Este diagrama compara 4 modelos para resolver isso, do mais simples
  (atual, sem mudança) ao mais robusto (C, híbrido).

  Modelos:
  - **ATUAL** — orquestrador em foreground, sub-agents retornam via prompt
    template, comunicação por arquivos `.specs/`. Problema: holding caro.
  - **A — Dynamic Workflow wrap** — script JS orquestra, orquestrador
    vira coordinator de script. Zero holding. Sem HITL mid-run.
  - **B — Skill com scratchpad + hook** — adiciona `.specs/SCRATCHPAD.md`
    com hook que acorda o orquestrador em cada escrita. Preserva HITL
    mas ainda tem holding.
  - **C — Híbrido (recomendado)** — Dynamic Workflow para o loop principal
    + scratchpad para cross-agent state + `ScheduleWakeup` para HITL
    assíncrono. Zero holding + HITL com latência N minutos.

  Diagramas companion:
  - `11-dynamic-workflow-flow.md` — fluxo detalhado da arquitetura C.
related:
  - ../README.md
  - ../SKILL.md
  - ./02-loop-flow.md
  - ./09-stop-conditions.md
  - ../../../handoff-orchestrator.md
mermaid_count: 1
---

# 10 — Communication Models

## TL;DR

| Modelo | Custo holding | HITL mid-run | Cache | Resume após crash | Quando usar |
|---|---|---|---|---|---|
| **ATUAL** (v0.2) | ❌ alto | ❌ foreground | ❌ orquestrador cresce | ⚠️ STATE.md só | já está em produção; refatorar para C quando possível |
| **A** Dynamic Workflow wrap | ✅ zero | ❌ "no mid-run input" | ✅ script cached | ✅ resume do mesmo script | scripts one-shot sem HITL |
| **B** Skill com scratchpad + hook | ⚠️ médio (acorda em write) | ⚠️ via SendMessage | ⚠️ melhor (scratchpad substitui context) | ✅ scratchpad persiste | quando HITL é crítico e LATÊNCIA não é |
| **C** Híbrido (recomendado) | ✅ zero | ⚠️ assíncrono via ScheduleWakeup (latência N min) | ✅ | ✅ | **próxima iteração da skill — alvo** |

## Diagrama

```mermaid
flowchart TB
    subgraph ATUAL["ATUAL — v0.2 (foreground wait)"]
        direction TB
        H1[User prompt]
        O1[Orchestrator session<br/>foreground, holding tokens]
        S1[STATE.md / .specs/<br/>arquivos lidos no próximo dispatch]
        H1 -->|"dispara"| O1
        O1 -->|"dispatch"| SUB1[Implementer / Verifier<br/>sub-agent em foreground]
        SUB1 -->|"retorna output grande"| O1
        O1 -->|"engole output no context"| O1
        O1 -->|"lê/grava"| S1
        S1 -.->|"próximo sub-agent<br/>lê no início"| SUB1

        O1 -.- PROB1["❌ Problema:<br/>orquestrador consome tokens<br/>enquanto espera<br/>❌ Sem HITL<br/>❌ Sem heartbeat visível"]
    end

    subgraph A["A — Dynamic Workflow wrap"]
        direction TB
        H2[User prompt<br/>opt-in 'ultracode' ou /workflows]
        S2[Workflow script JS<br/>em background runtime]
        A1[agent Planner]
        A2[agent Implementer]
        A3[agent Verifier]
        V[Variable<br/>intermediate results]
        H2 -->|"Claude escreve script"| S2
        S2 -->|"spawn"| A1
        A1 -->|"retorna pra var"| V
        V -->|"pipeline"| A2
        A2 -->|"retorna pra var"| V
        V -->|"pipeline"| A3
        A3 -->|"retorna final"| S2
        S2 -->|"report final<br/>cai na session"| H2

        S2 -.- PROB2["✅ Zero holding<br/>✅ Cached<br/>✅ Resume do script<br/>❌ Sem HITL mid-run<br/>❌ Caps: 16 concurrent, 1000 total"]
    end

    subgraph B["B — Skill com scratchpad + hook"]
        direction TB
        H3[User prompt]
        O3[Orchestrator session<br/>foreground MAS scratchpad substitui context]
        SC[SCRATCHPAD.md<br/>shared file + PostToolUse hook]
        SUB3[Implementer / Verifier]
        H3 -->|"dispara"| O3
        O3 -->|"dispatch"| SUB3
        SUB3 -->|"escreve em SCRATCHPAD.md"| SC
        SC -->|"hook acorda orquestrador"| O3
        O3 -->|"lê SCRATCHPAD<br/>em vez de engolir output"| O3
        O3 -->|"decide próximo passo"| SUB3

        SC -.- PROB3["⚠️ Holding médio<br/>(hook acorda cedo mas sessão fica aberta)<br/>✅ HITL via SendMessage teammate<br/>✅ Scratchpad persiste pós-crash<br/>✅ Heartbeat via write events"]
    end

    subgraph C["C — Híbrido (RECOMENDADO)"]
        direction TB
        H4[User prompt]
        W4[Dynamic Workflow<br/>em background]
        SC4[SCRATCHPAD.md<br/>compartilhado]
        CRON[ScheduleWakeup / Cron<br/>acorda orchestrator<br/>a cada N min]
        O4[Orchestrator thin<br/>lê scratchpad + STATE<br/>só quando acordado]
        H4 -->|"ultracode"| W4
        W4 -->|"spawn agents"| A4[Planner/Impl/Verifier]
        A4 -->|"escreve"| SC4
        SC4 -->|"watch"| CRON
        CRON -->|"wake"| O4
        O4 -->|"lê scratchpad<br/>+ decide HITL"| SC4
        O4 -->|"se HITL necessário:<br/>bloqueia user<br/>via chat normal"| H4

        W4 -.- PROB4["✅ Zero holding do loop<br/>✅ HITL assíncrono (latência N min)<br/>✅ Scratchpad sobrevive crash<br/>✅ Heartbeat via cron<br/>✅ User pode 'matar' via /workflows p/x"]
    end

    style ATUAL fill:#fee,stroke:#c33
    style A fill:#efe,stroke:#3a3
    style B fill:#ffd,stroke:#ca3
    style C fill:#cef,stroke:#39c
    style PROB1 fill:#fee,stroke:#c33,stroke-dasharray: 3 3
    style PROB2 fill:#efe,stroke:#3a3,stroke-dasharray: 3 3
    style PROB3 fill:#ffd,stroke:#ca3,stroke-dasharray: 3 3
    style PROB4 fill:#cef,stroke:#39c,stroke-dasharray: 3 3
```

## Por que essas 4 opções e não outras?

- **ATUAL** continua existindo — refatorar tudo para C é caro e arriscado mid-Phase-7a. Documentamos o trade-off mas não forçamos migração.
- **A** é o que a Anthropic recomenda em `code.claude.com/docs/en/workflows`. Resolve o problema de custo mas joga fora HITL.
- **B** é o que cabe **dentro da skill existente** com mudança mínima: adiciona SCRATCHPAD.md e um hook PostToolUse. Preserva HITL mas ainda tem holding.
- **C** é o que a **próxima versão da skill** (v0.3 ou v2) deveria mirar: combina zero holding de A com HITL assíncrono de B, com latência aceitável.

## Recomendação operacional

1. **AGORA (Phase 7a → 7b):** manter ATUAL. Já está rodando, refatorar mid-flight é maior risco que benefício.
2. **APÓS 7b (loop fechado):** rascunhar Opção A como POC — embrulha as últimas 5 phases do roadmap num script Dynamic Workflow. Medir custo.
3. **Próxima iteração da skill:** promover C. SCRATCHPAD.md + hook PostToolUse + ScheduleWakeup. Não é trabalho de uma sessão.

Ver diagrama `11-dynamic-workflow-flow.md` para a sequência de passos da opção C.
