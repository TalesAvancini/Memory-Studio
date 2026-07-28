---
date: 2026-07-26
version: 1
description: "Sequence diagram end-to-end da perspectiva do usuário: 'eu invoquei auto-grill, o que acontece até o gate aparecer?'."
explanation: "Resolve a dúvida 'CLI invocation → output'. Mostra usuário como observador externo; orquestrador e sub-agentes como caixas-pretas. Diferente do 12-orchestrator-handoff (zoom-in em 1 round) — este é o panorama full-lifecycle, do CLI até o gate. Útil pra quem vai rodar pela primeira vez e quer saber 'quando eu volto a interagir?'."
related:
  - ../SKILL.md
  - ./11-round-protocol.md
  - ./12-orchestrator-handoff.md
  - ./06-artifact-pack.md
mermaid_count: 1
---

# 13 — Quickstart Procedural (perspectiva do usuário)

## Resumo

Este é o **panorama do início ao fim**, da perspectiva de quem rodou `auto-grill <target>` na CLI. Mostra:

- Você (humano) vê 2-3 interações: invocação, espera, gate.
- Orquestrador + sub-agentes fazem todo o trabalho entre invocação e gate.
- Total: **2 turn-points humanos** (start + gate). O resto é loop interno.

Resolve a pergunta: **"quando eu volto a interagir com o sistema?"**

## Diagrama

```mermaid
sequenceDiagram
    autonumber
    participant U as Você (humano)
    participant CLI as CLI / entrypoint
    participant Orq as Orchestrator
    participant Int as Interrogator<br/>(FRESH por round)
    participant Pro as Stakeholder Proxy<br/>(FRESH por round)
    participant FS as Repo files
    participant FS_DISC as .specs/<br/>DISCOVERIES.md
    participant FO as Artifact Pack<br/>(4 files)

    rect rgb(245, 245, 245)
        note over U,CLI: TURN-POINT 1: invocação
        U->>CLI: auto-grill <target><br/>[OR auto-grill <D1> <D2> ...]<br/>[--lenses] [--confidence-floor]<br/>[--max-rounds] [--resume]
        CLI->>Orq: setup_loop(target_path, flags)
    end

    rect rgb(255, 248, 230)
        note over Orq,FS: SETUP (síncrono, ~1-5s)
        Orq->>FS: read target doc(s) (full)
        Orq->>FS: scan CONTEXT.md + ADRs<br/>+ farol stable IDs (if exists)
        FS-->>Orq: context fingerprint
        alt CONTEXT.md ausente
            Orq-->>U: ABORT —<br/>"CONTEXT.md is mandatory (rule 9)"
        end
        Orq->>Orq: build initial transcript
    end

    rect rgb(230, 245, 255)
        note over Orq,FO: LOOP (assíncrono, usuário livre)

        loop rounds 1..N (default N ≤ 50)
            Orq->>Int: dispatch<br/>{[Doc1, Doc2?], lens,<br/>transcript[N-1], floor}
            Int-->>Orq: emit Q<br/>{LENS, QUESTION, RECOMMENDATION,<br/>EVIDENCE_REQUESTED, WHY_NOW}

            Orq->>Pro: dispatch<br/>{Q above, sources list}
            Pro->>FS: read on demand
            FS-->>Pro: cited excerpts
            Pro-->>Orq: emit A<br/>{ANSWER, CONFIDENCE, cite}<br/>OR NO_EVIDENCE + gap

            Orq->>Orq: route outcome (accept/<br/>escalate/ticket)
            alt outcome = NO_EVIDENCE
                Orq->>FS_DISC: append Research Ticket
            end
            Orq->>Orq: log transcript[N]
            Orq->>Orq: check caps<br/>(rounds, tokens)

            alt cap estourado
                Orq-->>U: halt DUMB_ZONE<br/>+ resumo de 1 página
            end
        end
    end

    rect rgb(232, 245, 233)
        note over Orq,FO: ARTIFACT PACK (escrita única ao fim do loop)
        Orq->>FO: write 4 outputs
        FO->>FS: <target>.auto-grill.transcript.md<br/>(or <D1>-<D2> slug if composite)
        FO->>FS: <target>.auto-grill.decisions.md<br/>(or <D1>-<D2> slug if composite)
        FO->>FS: <target>.auto-grill.loop-state.json<br/>(or <D1>-<D2> slug if composite)
        FO->>FS_DISC: append final gaps
    end

    rect rgb(255, 243, 224)
        note over U,FO: TURN-POINT 2: human gate
        Orq-->>U: gate signal<br/>"Artifact Pack ready at <paths>"
        U->>U: open Artifact Pack
        alt usuário aprova via UI HTML
            U->>U: open assets/decisions-ui.html<br/>paste decisions.md table<br/>mark approve/reject/loop<br/>export decisions.respondido.md
        end
        U->>U: read transcript.md se quiser auditar
        U->>U: substitui decisions.md<br/>pelo .respondido.md
    end

    rect rgb(245, 245, 245)
        note over U: PRÓXIMO PASSO (downstream chain, manual)
        alt decide seguir
            U->>U: carregar transcript.md<br/>na mesma sessão
            U->>U: invocar /to-spec<br/>(Matt Pocock skill)
            U->>U: spec publicada no issue tracker
            U->>U: invocar prompts/to-roadmap<br/>(auto-grill project-local)
            U->>U: .specs/ROADMAP.md emitido
            U->>U: invocar /to-tickets
            U->>U: tickets verticais emitidos
            U->>U: invocar /implement (TDD + review)
        else decide reiniciar loop
            U->>CLI: auto-grill <target> --resume<br/>(lê loop-state.json, retoma rejected)
        end
    end
```

## Onde cada turn-point acontece

| Turn-point | Quando | Você vê o quê |
|---|---|---|
| **#1 Invocação** | T=0 | Você digita `auto-grill <target>`. UI/terminal mostra "loop started" e retorna o controle. |
| **(sem interaction)** | T=0..N | Você é **livre**. Pode fazer outra coisa, fechar terminal, voltar depois. |
| **#1.5 Setup error** | T=0..5s | Se `CONTEXT.md` faltar: erro imediato, loop abortado, sem trabalho desperdiçado. |
| **#1.6 Dumb Zone** | T=variável | Se transcript estourar 100k tokens OU 50 rounds: halt + 1-página resumo. **Você decide se reabre sessão ou não.** |
| **#2 Gate signal** | T=fim do loop | Orquestrador mostra os 4 caminhos dos arquivos. **Você lê.** |
| **#3 (opcional) UI workflow** | T=gateway | Se preferir, abre `assets/decisions-ui.html`, cola, marca, exporta. Senão edita o `decisions.md` direto. |
| **#4 (opcional) Downstream** | T=após gate aprovado | Você invoca `to-spec`, `to-roadmap`, `to-tickets`, `implement` **manualmente**. Auto-grill não auto-avança. |

## Quantos turn-points SÍNCRONOS no mínimo?

**2** (invocação + gate). No mais, se a UI HTML for usada, mais 1 turn-point opcional (UI workflow). Se rejeitar decisões, mais turn-points (auto-grill `--resume`).

Demais turn-points são **opcionais** e disparados por edge cases (CONTEXT.md ausente, Dumb Zone, rejeição).

## Erros comuns a evitar (do "cinzento" do Diagram 12)

- **Invocar `to-spec` antes do transcript.md estar carregado** — `to-spec` ignora `decisions.md`. Ele lê o que está na janela. Se você rodou auto-grill em sub-agente separado, **carregue o transcript.md explicitamente** antes de invocar `/to-spec`.
- **Esperar auto-grill auto-invocar `to-spec`** — não acontece. O gate é portão, não rampa.
- **Reusar mesma instância de Proxy/Interrogator entre rounds** — viola regra 7. Sempre fresh sub-agents (Diagram 14).
- **"Aprovar tudo sem ler o transcript"** — Mata a utilidade do gate. O skill vira teatro.

## Como ler este diagrama

- **Cinza escuro** = turn-points humanos (você para, age)
- **Azul claro** = loop interno (você não acompanha)
- **Amarelo claro** = Setup (você não acompanha)
- **Verde claro** = sucesso / saída feliz
- **Laranja claro** = human gate (você age)

## Ver também

- [SKILL.md §Quickstart](../SKILL.md) — versão em prosa canônica (referência primária).
- [02-flow.md](02-flow.md) — flow mais abstrato (5 phases, sem turn-points).
- [06-artifact-pack.md](06-artifact-pack.md) — o que está nos 4 outputs.
- [11-round-protocol.md](11-round-protocol.md) — macro-states (este é user-facing, 11 é interno).
