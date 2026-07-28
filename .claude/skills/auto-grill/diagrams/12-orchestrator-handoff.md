---
date: 2026-07-26
version: 1
description: "Decision tree do orquestrador dentro de 1 round — close-up de 'o que ele faz entre dispatchar Interrogator e dispatchar Proxy'."
explanation: "Estado 11 mostra os macro-states. Este diagrama mostra a sequência interna do orquestrador em cada round: como ele escolhe lens, dispatcha Interrogator, captura Q, dispatcha Proxy, captura A, decide. Resolve dúvida recorrente: 'o orquestrador faz o quê mesmo, exatamente, em cada round?'."
related:
  - ../SKILL.md
  - ./11-round-protocol.md
  - ./14-fresh-subagent-invariant.md
  - ./04-confidence.md
mermaid_count: 2
---

# 12 — Orchestrator Handoff (decision tree per round)

## Resumo

Zoom-in no estado `Interrogate → Receive_Answer` do Diagram 11. Mostra:

1. **Como o orquestrador escolhe lens** (lens-cycle strategy).
2. **Como ele dispatcha FRESH sub-agentes** (regra 7).
3. **Como ele decide se A é aceitável** (no-confidence routing).
4. **Como ele decide próximo passo** (next round / Artifact Pack / halt).

## Diagrama 1: fluxo principal

```mermaid
flowchart TB
    START([Início do round N])
    START --> PICK_LENS

    PICK_LENS{{Escolher lens}}
    PICK_LENS -->|"round 1: fog-of-war"| FOG
    PICK_LENS -->|"mais rounds: cycle strategy"| CYCLE
    PICK_LENS -->|"lens do round anterior exhausted"| NEXT_LENS

    subgraph SETUP_CONTEXT["(herdado do Setup global)"]
        direction TB
        ctx_facts["transcript até N-1"]
        ctx_meta["fingerprint: glossary, ADRs, farol"]
        ctx_cap["caps: rounds<50, tokens<100k"]
    end

    subgraph FRESH_A["FRESH SUB-AGENT 1/2"]
        direction TB
        disp_i["dispatch Interrogator<br/>prompt := {<br/>  target doc(s) [composite?],<br/>  lens ativo,<br/>  transcript[N-1],<br/>  floor,<br/>  '1 pergunta, com recomendação'<br/>}"]
        recv_i["recebe Q"]
        Q_fmt["{LENS, QUESTION, RECOMMENDATION,<br/>EVIDENCE_REQUESTED, WHY_NOW}"]
        disp_i --> recv_i --> Q_fmt
    end

    subgraph FRESH_B["FRESH SUB-AGENT 2/2"]
        direction TB
        disp_p["dispatch Proxy<br/>prompt := {<br/>  Q acima,<br/>  sources list (CONTEXT.md, ADRs,<br/>  farol?, ALL target docs [composite],<br/>  src/),<br/>  'cite ou NO_EVIDENCE'<br/>}"]
        recv_p["recebe A"]
        A_fmt["{ANSWER, EVIDENCE cite, CONFIDENCE}<br/>OU<br/>NO_EVIDENCE + gap"]
        disp_p --> recv_p --> A_fmt
    end

    SETUP_CONTEXT --> FRESH_A
    Q_fmt -->|"hand-off: orq passa Q"| FRESH_B

    A_fmt --> ROUTE

    ROUTE{{Roteamento por outcome}}
    ROUTE -->|"NO_EVIDENCE +<br/>lens=Fog of War"| TICKET
    ROUTE -->|"conf < floor<br/>(default 0.7)"| ESCALATE
    ROUTE -->|"conf ≥ floor"| ACCEPT

    TICKET["emit Research Ticket<br/>(.specs/DISCOVERIES.md append)"]
    TICKET --> LOG_TRANSCRIPT

    ESCALATE["escalate to human<br/>log no transcript como unresolved"]
    ESCALATE --> LOG_TRANSCRIPT

    ACCEPT["update transcript[N]<br/>log A com conf + cite"]
    ACCEPT --> LOG_TRANSCRIPT

    LOG_TRANSCRIPT["log round N (Q + A + outcome)"]
    LOG_TRANSCRIPT --> CHECK_LENS

    CHECK_LENS{{Lens exhausted?}}

    CHECK_LENS -->|"não"| CHECK_ROUND
    CHECK_LENS -->|"sim"| CHECK_CYCLE

    CHECK_ROUND{{rounds < --max-rounds?<br/>AND<br/>tokens < 100k?}}
    CHECK_ROUND -->|"sim"| NEXT_ROUND
    CHECK_ROUND -->|"não"| DUMB_ZONE

    NEXT_ROUND["increment N → round N+1"]
    NEXT_ROUND --> START

    CHECK_CYCLE{{Todas as 8 lenses<br/>já rodaram?}}
    CHECK_CYCLE -->|"não"| NEXT_LENS
    CHECK_CYCLE -->|"sim"| ARTIFACT_PACK

    NEXT_LENS["pula pra proxima lens na fila"]
    NEXT_LENS --> START

    DUMB_ZONE["halt DUMB_ZONE<br/>resume summary to fresh session<br/>NÃO autosoluciona"]
    DUMB_ZONE --> END([halt explícito])

    ARTIFACT_PACK["escreve 4 artefatos:<br/>transcript + decisions + loop-state<br/>+ DISCOVERIES append"]
    ARTIFACT_PACK --> GATE

    GATE([HUMAN GATE])

    style FRESH_A fill:#e3f2fd,stroke:#1e88e5
    style FRESH_B fill:#e3f2fd,stroke:#1e88e5
    style SETUP_CONTEXT fill:#f5f5f5,stroke:#616161
    style DUMB_ZONE fill:#ffcdd2,stroke:#c62828
    style ARTIFACT_PACK fill:#c8e6c9,stroke:#2e7d32
    style GATE fill:#fff3e0,stroke:#fb8c00
```

## Diagrama 2: sequenceDiagram do round (close-up temporal)

```mermaid
sequenceDiagram
    autonumber
    participant Orq as Orchestrator
    participant Int as Interrogator<br/>(FRESH)
    participant Pro as Stakeholder Proxy<br/>(FRESH)
    participant FS as Repo files<br/>(CONTEXT.md, ADRs,<br/>.specs/ARCHITECTURE.md,<br/>src/)

    Orq->>Orq: pick_lens(N)
    Orq->>Int: dispatch<br/>{[Doc1, Doc2?], lens,<br/>transcript[N-1], floor}
    activate Int
    Int->>Int: read target doc section<br/>relevant to lens
    Int->>Orq: emit Q<br/>{LENS, QUESTION, RECOMMENDATION,<br/>EVIDENCE_REQUESTED, WHY_NOW}
    deactivate Int
    Note over Orq,Int: Interrogator descartável.<br/>Não acumula estado entre rounds.

    Orq->>Pro: dispatch<br/>{Q acima, sources list}
    activate Pro
    Pro->>FS: read CONTEXT.md + ADRs<br/>+ ALL target docs (composite)<br/>(on demand, never invent)
    FS-->>Pro: trechos citados
    Pro->>Pro: match Q vs context<br/>build ANSWER + EVIDENCE cite
    Pro->>Orq: emit A<br/>{ANSWER, CONFIDENCE, cite}<br/>OR NO_EVIDENCE + gap
    deactivate Pro
    Note over Orq,Pro: Proxy descartável.<br/>Só lê FS, não acumula.

    Orq->>Orq: route outcome<br/>(escalate / accept / ticket)
    Orq->>Orq: log transcript[N]
    Orq->>Orq: check caps + lens exhaustion
```

## Decisões de design importantes

| Decisão | Por quê | Trade-off |
|---|---|---|
| Orquestrador centraliza tudo (ele dispatcha, ele roteia) | Única entidade com visão completa do transcript + caps | Se orquestrador errar, loop inteiro trava — mas Dumb Zone cap pega |
| `Q_fmt` é formato fixo (LENS, QUESTION, RECOMMENDATION, EVIDENCE_REQUESTED, WHY_NOW) | Permite parsing determinístico no orquestrador; reduz chance de "pergunta vaga" | Restringe criatividade do Interrogator — mas é a invariante Pocock |
| ROUTE separado (orquestrador decide, Proxy só reporta) | Evita "Proxy decide se conf é alta" = autoconfirmação | Mais 1 hop; mais tokens |
| Dumb Zone = halt, não autosolução | Halts silenciosos são piores que halts explícitos | Você precisa reabrir sessão se bater |
| Lens cycle strategy explícita (Fog of War primeiro) | Fog of War é a mais barata e previne Football de "no" branches; outras lenses vêm depois | Pode ser tunado depois (opção CLI `--lens-strategy`) |

## O que ainda é "cinzento" (não documentado visualmente em nenhum lugar)

- **Lens cycle strategy** (a ordem específica de lenses) está descrita como "Fog of War primeiro" mas as 7 outras lenses estão sem ordem canônica. Hoje é manual via `--lenses` flag ou ordem do loop.
- **Lógica de "lens exhausted"** — critério é "no remaining ? branches" (Fog of War) ou "every term glossary-backed" (Semantic Anchors), etc., mas cada lens tem critério diferente. Diagram 03 lista os critérios.
- **Concurrent vs sequential rounds** — o estado atual é sequential (1 round por vez). Multi-Interrogator em paralelo reduziria wall-clock mas complicaria roteamento. Fora de escopo.

## Ver também

- [11-round-protocol.md](11-round-protocol.md) — macro-states (este é zoom-in).
- [14-fresh-subagent-invariant.md](14-fresh-subagent-invariant.md) — focus na regra 7.
- [04-confidence.md](04-confidence.md) — detalhe do critério de confidence floor.
- [../SKILL.md §Critical rules](../SKILL.md) — 10 invariantes escritas.
