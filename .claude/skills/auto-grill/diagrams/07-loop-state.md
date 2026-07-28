---
date: 2026-07-26
version: 1
description: "Outer state machine — ciclo de vida do auto-grill através de múltiplas invocações (resume, halt, done)."
explanation: "Diferente do 02-flow.md (5 phases dentro de UMA run), este diagrama mostra o ciclo de vida ATRAVÉS de múltiplas runs. Estado persistido em loop-state.json. Resume continua de onde parou; halt sempre grava estado pra próximo resume."
related:
  - ../SKILL.md
  - ./02-flow.md
  - ./06-artifact-pack.md
mermaid_count: 1
---

# 07 — Loop State Machine

## Resumo

O diagrama [02-flow.md](02-flow.md) mostra as **5 phases dentro de uma run**. Este mostra o **ciclo de vida da skill através de múltiplas runs**, com persistência em `loop-state.json`.

Estados outer: `idle → setup → running → gate → done | resuming | halted`.

**Regra fundamental:** qualquer transição pra halt grava `loop-state.json` antes de terminar. Nenhum halt é "perdido" — você sempre pode fazer `--resume`.

## Diagrama

```mermaid
stateDiagram-v2
    [*] --> idle

    idle: idle<br/>no loop-state.json present<br/>(or fresh directory)

    idle --> setup_first: auto-grill <path><br/>(no --resume flag)

    setup_first: SETUP (first)<br/>load target + CONTEXT.md<br/>+ ADRs + scratchpad<br/>build context fingerprint<br/>init loop-state.json

    setup_first --> halt_no_context: CONTEXT.md<br/>not found
    setup_first --> running

    halt_no_context: HALT_NO_CONTEXT<br/>STOP — no ubiquitous language<br/>no loop-state.json written<br/>(skill never started)

    halt_no_context --> [*]

    running: RUNNING<br/>Phase 2 loop active<br/>N rounds of Q/A<br/>append to transcript<br/>update loop-state.json<br/>append to decisions.md

    running --> gate: all lenses done<br/>or all decisions ≥ floor
    running --> halt_dumb: transcript > 100k tokens
    running --> halt_max: --max-rounds reached
    running --> halt_user: user says stop<br/>or Ctrl-C

    gate: GATE<br/>human reviewing decisions.md<br/>approve / reject / loop<br/>per row

    gate --> done_approved: all rows approved
    gate --> resuming_rejected: any row rejected
    gate --> halt_user: user says stop

    done_approved: DONE<br/>loop-state.json final<br/>artifact pack complete<br/>optional handoff to<br/>to-spec / to-tickets
    done_approved --> [*]

    resuming_rejected: RESUMING<br/>read loop-state.json<br/>load rejected_branches<br/>focus next round on them

    resuming_rejected --> setup_resume
    setup_resume: SETUP (resume)<br/>load loop-state.json<br/>merge rejected_branches<br/>continue from current_lens
    setup_resume --> running

    note_right of setup_resume
      loop-state.json is the contract:
      - last_round
      - current_lens
      - transcript_size_tokens
      - decisions[]
      - rejected_branches[]
      - halt_reason
    end note

    halt_dumb: HALT_DUMB_ZONE<br/>loop-state.json saved<br/>halt_reason: dumb_zone<br/>fresh session summary recommended
    halt_max: HALT_MAX_ROUNDS<br/>loop-state.json saved<br/>halt_reason: max_rounds<br/>partial artifact pack written
    halt_user: HALT_USER_STOP<br/>loop-state.json saved<br/>halt_reason: user_stop<br/>report summary in chat

    halt_dumb --> [*]
    halt_max --> [*]
    halt_user --> [*]
```

## Pontos chave (PT-BR)

### Diferença vs 02-flow.md

- **02-flow** = fases dentro de uma única run (interrupção rápida, escala menor).
- **07-loop-state** = vida da skill através de várias runs (pode durar horas ou dias com múltiplos resumes).

### Estados terminais (halt)

| Estado halt | halt_reason em loop-state.json | Resume possível? |
|---|---|---|
| `halt_no_context` | (não escreve) | não — skill nunca começou |
| `halt_dumb` | `dumb_zone` | sim — `--resume` continua |
| `halt_max` | `max_rounds` | sim — `--resume` continua (lens pode ter progredido) |
| `halt_user` | `user_stop` | sim — `--resume` continua |

### Resume — o que o orchestrator faz

1. Lê `loop-state.json` (deve existir).
2. Carrega `rejected_branches` (lista de branches onde o humano marcou reject).
3. Seta `current_lens` para o lens onde a run parou.
4. Recomeça Phase 2 com **foco nas rejected_branches primeiro**, depois cicla pros outros lenses.
5. Incrementa `last_round` a partir do valor salvo (não reseta).

### `done_approved` vs halt

- `done_approved` = você aprovou todas as decisões. Estado final feliz. Handoff opcional pra `to-spec`.
- Qualquer halt = você ainda tem trabalho pendente. Resume continua de onde parou.

### Loop-state.json é append-otimistic, overwrite-on-halt

- Durante RUNNING, é overwrite a cada round (rápido, evita perda).
- Em halt, é overwrite final com `halt_reason` preenchido.
- NUNCA overwrite de `done_approved` — só atualização de campos de status.

## Por que loop-state.json (e não memória do orchestrator)?

| Tentativa | Falha |
|---|---|
| Estado só na memória do orchestrator | Sessão morre, estado perdido. Você não pode voltar amanhã e retomar. |
| Estado em markdown | Parsing é frágil. JSON tem schema, types, e é parseável por qualquer ferramenta. |
| Estado num único arquivo grande | Mistura decisions, transcript, e machine state. Loop-state precisa ser leve e rápido. |

JSON dedicado ao machine state + markdown separado pra humano = separação clara.

## Ver também

- [02-flow.md](02-flow.md) — 5 phases internas de uma run.
- [06-artifact-pack.md](06-artifact-pack.md) — schema completo do `loop-state.json`.
- [SKILL.md §Critical rules](../SKILL.md) — regra R8 (loop state persistido).