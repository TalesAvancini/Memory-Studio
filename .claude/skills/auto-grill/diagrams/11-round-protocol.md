---
date: 2026-07-26
version: 1
description: "State machine do loop do auto-grill — estados, transições, e invariantes de saída. Resposta à pergunta 'como saímos do estado X?'."
explanation: "Diagrama cobre estados macro (Idle, Setup, Interrogate, Receive_Answer, Check_Confidence, Research_Ticket, Escalate, Artifact_Pack) e o que dispara cada transição. **Only DumbZone is fully terminal**; Escalate → Idle (human decide) e Artifact_Pack → Idle (rejeitado) têm transição de volta. Resume em uma imagem o comportamento canônico sem precisar ler SKILL.md."
related:
  - ../SKILL.md
  - ./02-flow.md
  - ./12-orchestrator-handoff.md
  - ./14-fresh-subagent-invariant.md
mermaid_count: 1
---

# 11 — Round Protocol (state machine)

## Resumo

Este é o **mapa de estados canônico** do loop. Resolve a pergunta "_em que momento exato eu estou, e o que dispara a transição?_".

- **Estados ativos**: Idle, Setup, Interrogate (asking), Receive_Answer, Check_Confidence
- **Estados de desvio**: Research_Ticket (Fog of War mode), Escalate (confidence < floor)
- **Estados terminais**: Artifact_Pack (sucesso), Escalate (humano no loop), DumbZone (halt)

## Diagrama

```mermaid
stateDiagram-v2
    direction TB
    [*] --> Idle

    Idle --> Setup: user invokes `auto-grill <target>`

    Setup --> Interrogate: context fingerprint emitido
    note right of Setup
        SETUP carrega target doc(s)
        + scan CONTEXT.md / ADRs / farol
        + emite context fingerprint
        Composite target → carrega TODOS os docs listados
        Farol ausente → skip (regra 10); orphan IDs → DISCOVERIES conf=medium
        CONTEXT.md ausente → ABORT (regra 9)
        workaround = build temp from CLAUDE.md §Glossary + product glossary
        Ver SKILL.md §SETUP pre-flight checklist
    end note

    Interrogate --> Receive_Answer: Q emitido (com lens + recommend)
    note right of Interrogate
        ORCHESTRATOR dispatcha FRESH Interrogator
        Interrogator emite:
        {LENS, QUESTION, RECOMMENDATION,
         EVIDENCE_REQUESTED, WHY_NOW}
        1 pergunta por round (invariante Pocock)
    end note

    Receive_Answer --> Check_Confidence: A emitido (com cite)
    note right of Receive_Answer
        ORCHESTRATOR dispatcha FRESH Proxy
        Proxy emite:
        {ANSWER, CONFIDENCE, EVIDENCE cite}
        OU
        NO_EVIDENCE + gap
    end note

    Check_Confidence --> Research_Ticket: NO_EVIDENCE no Fog of War mode
    Check_Confidence --> Escalate: conf < floor (default 0.7)
    Check_Confidence --> Interrogate: conf ≥ floor
    Check_Confidence --> Artifact_Pack: lenses exhausted

    Research_Ticket --> Interrogate: ticket logged, re-loop

    Escalate --> Idle: humano decide (resume ou desistir)
    Escalate --> [*]: halt explícito
    note left of Escalate
        ESCAPE HATCH
        Floor é hard, não advisory
        Artigo "Auto-confirmação"
        cobre por quê isto existe
    end note

    Artifact_Pack --> Idle: rejeitado → restart focado
    Artifact_Pack --> [*]: aprovado (sucesso, gate passa)
    note right of Artifact_Pack
        SUCESSO TERMINAL
        4 artefatos:
        transcript + decisions +
        loop-state + DISCOVERIES append
        HUMAN GATE é aqui
    end note

    Interrogate --> DumbZone: rounds >= 50 OR transcript > 100k
    Receive_Answer --> DumbZone: rounds >= 50 OR transcript > 100k
    Check_Confidence --> DumbZone: rounds >= 50 OR transcript > 100k

    DumbZone --> [*]: halt + resumo pra fresh session

    note left of DumbZone
        HALT HARD
        Nunca autosolver DumbZone
        Resumo curto pra humano,
        nova sessão recomeça o trabalho
    end note
```

## Invariantes (numeradas conforme SKILL.md §Critical rules)

| # | Invariante | Onde aplica |
|---|---|---|
| 1 | One question per Interrogate round | `Interrogate → Receive_Answer` |
| 2 | Every question carries a recommendation | dentro de `Interrogate` |
| 3 | Proxy answers with evidence only (sem = NO_EVIDENCE) | dentro de `Receive_Answer`, transição pra `Research_Ticket` |
| 4 | Hard floor at `confidence_floor` | `Check_Confidence → Escalate` é única saída quando < floor |
| 5 | Dumb Zone guard (100k tokens OR 50 rounds) | transições FORA pra `DumbZone` |
| 6 | Never edit target doc | (cross-cutting, fora da máquina) |
| 7 | Two sub-agents, fresh each round | ver Diagram 14 |
| 8 | Loop state persisted (resume suportado) | `Artifact_Pack → Idle (rejeitado) → resume via loop-state.json` |
| 9 | CONTEXT.md mandatory | falha em `Setup` aborta tudo |
| 10 | Farol stable IDs cross-checked | dentro de `Setup` e `Check_Confidence` |

## Por que esta máquina é como é

- **`Interrogate` e `Receive_Answer` são separados** (não fundidos) pra refletir os **dois sub-agentes distintos**. Fundir implicaria 1 agente fazendo pergunta E resposta = autoconfirmação garantida.
- **`Check_Confidence` é um gate entre Proxy e orquestrador** porque o orquestrador é o único autorizado a tomar decisões baseado em confidence. O Proxy reporta; o orquestrador decide.
- **`DumbZone` é inalcançável de forma "elegante"** — qualquer estado pode cair nele se as caps baterem. É o equivalente de "pânico suave": nunca autosoluciona, sempre para.
- **Não há estado de "backtrack"** do Artifact_Pack: rejeição = restart do zero via `Idle`, não edição retroativa. Isso força clareza de decisão.

## Ver também

- [SKILL.md §5-phase flow](../SKILL.md) — descrição linear complementar.
- [02-flow.md](02-flow.md) — diagrama mais alto-nível (overview de phases, não de estados dentro de phases).
- [12-orchestrator-handoff.md](12-orchestrator-handoff.md) — close-up do que o orquestrador faz entre `Interrogate` e `Receive_Answer`.
- [14-fresh-subagent-invariant.md](14-fresh-subagent-invariant.md) — visualização da regra 7 (2 sub-agentes fresh por round).
