---
date: 2026-07-24
version: 1
description: "Escape hatches do loop — 3× FAIL consecutivo, hard blocker, user interrupt, SUBCHAPTER_BREAKDOWN, step 8a strategy shift."
explanation: "Cada condição de parada tem ação concreta. Nenhuma é silenciosa — sempre emite STATE.md update + report. Diferencia hard stops (escalate) de soft stops (strategy shift)."
related:
  - ../README.md
  - ./02-loop-flow.md
  - ./05-verdict-handling.md
mermaid_count: 1
---

# 09 — Stop Conditions

## Resumo

5 escape hatches que tiram o loop do estado "running". Cada um tem **trigger explícito** + **ação concreta**. Diferencia hard stops (escalate to human) de soft stops (strategy shift interno).

## Diagrama

```mermaid
flowchart TB
    running([Loop running]) --> trigger_check{Trigger?}

    trigger_check -->|all phases [x]| stop_success
    trigger_check -->|3x FAIL consecutive<br/>on same phase| stop_3x_fail
    trigger_check -->|hard blocker<br/>(missing tool,<br/>ambiguous AC,<br/>unmet dep)| stop_hard_blocker
    trigger_check -->|user interrupt<br/>(Ctrl-C,<br/>explicit stop)| stop_user_interrupt
    trigger_check -->|phase too big<br/>(Planner or Implementer<br/>returns SUBCHAPTER_BREAKDOWN)| soft_subchapter
    trigger_check -->|same-fixture-fail-2x<br/>(step 8a v0.2)| soft_strategy_shift
    trigger_check -->|no trigger| continue_loop([continue loop])

    stop_success[STOP: loop done<br/>Emit final report<br/>all phases [x]]
    stop_success --> action_success[action:<br/>1. commit final state<br/>2. emit summary<br/>3. exit]

    stop_3x_fail[STOP: 3x FAIL cap<br/>Escalate to human]
    stop_3x_fail --> action_3x_fail[action:<br/>1. write STATUS to STATE.md ## Handoff<br/>2. list ranked gaps<br/>3. page user<br/>4. wait for decision]

    stop_hard_blocker[STOP: hard blocker<br/>Escalate to human]
    stop_hard_blocker --> action_hard_blocker[action:<br/>1. write STATUS to STATE.md ## Handoff<br/>2. describe blocker concretely<br/>3. propose resolution<br/>4. page user]

    stop_user_interrupt[STOP: user interrupt<br/>Graceful pause]
    stop_user_interrupt --> action_user_interrupt[action:<br/>1. write Handoff to STATE.md<br/>2. commit or stash in-progress<br/>3. emit summary<br/>4. exit (resumable)]

    soft_subchapter[SOFT: phase too big<br/>SUBCHAPTER_BREAKDOWN]
    soft_subchapter --> action_subchapter[action:<br/>1. orchestrator inserts<br/>Phase N.1, N.2, ...<br/>2. all [ ], depend on parent<br/>3. move parent's sub-items<br/>4. re-loop (next iter picks up)]

    soft_strategy_shift[SOFT: same-fixture-fail-2x<br/>Strategy shift]
    soft_strategy_shift --> action_strategy_shift[action:<br/>1. surface 3 alternatives<br/>2. orchestrator picks one<br/>3. iter count resets to 0<br/>4. execute chosen strategy]

    style stop_success fill:#c8e6c9,stroke:#43a047
    style stop_3x_fail fill:#ffcdd2,stroke:#c62828
    style stop_hard_blocker fill:#ffcdd2,stroke:#c62828
    style stop_user_interrupt fill:#fff3e0,stroke:#fb8c00
    style soft_subchapter fill:#e1f5fe,stroke:#1e88e5
    style soft_strategy_shift fill:#e1f5fe,stroke:#1e88e5
```

## Hard stops (escalate to human)

### 1. 3× FAIL consecutivo (mesma phase)

| | |
|---|---|
| **Trigger** | Verifier FAIL × 3 iters na mesma phase (pós-strategy-shift) |
| **Ação** | 1. write STATUS to `.specs/STATE.md ## Handoff`<br/>2. list ranked gaps (do último validation.md)<br/>3. page user<br/>4. wait for decision (stop / continue / re-spec) |
| **Por que hard** | Token burn linear. Sem intervenção, repete. |

### 2. Hard blocker

| | |
|---|---|
| **Trigger** | Planner/Implementer/Verifier reporta blocker que **não pode resolver sozinho**:<br/>• missing tool (ex: required dep não instalada)<br/>• ambiguous AC a phase-level (não é detalhe de task)<br/>• dependency on phase not yet `[x]` |
| **Ação** | 1. write STATUS to `.specs/STATE.md ## Handoff`<br/>2. describe blocker concretamente (com command output / AC text / phase ref)<br/>3. propose resolution<br/>4. page user |
| **Por que hard** | Sub-agent não tem autoridade pra resolver. Tem que escalonar. |

### 3. User interrupt (Ctrl-C, "stop loop")

| | |
|---|---|
| **Trigger** | User signaliza parar (Ctrl-C, "stop the loop", "pause the loop") |
| **Ação** | 1. write Handoff to `.specs/STATE.md`<br/>2. commit or stash in-progress (nunca dirty tree)<br/>3. emit summary<br/>4. exit (resumable via Handoff) |
| **Por que hard** | User pediu. Sempre honrar. |

## Soft stops (strategy shift interno)

### 4. SUBCHAPTER_BREAKDOWN (phase too big)

| | |
|---|---|
| **Trigger** | Planner **ou** Implementer retorna `SUBCHAPTER_BREAKDOWN: [subA, subB, ...]`<br/>Triggers (qualquer um):<br/>• `>15 atomic tasks` em tasks.md<br/>• `>=2 new discoveries` em `.specs/DISCOVERIES.md` durante esta phase<br/>• `>=1 critical discovery` |
| **Ação** | 1. orchestrator insere `Phase N.1`, `Phase N.2`, ... em ROADMAP.md<br/>2. todos `[ ]`, dependendo da parent phase<br/>3. move parent sub-items apropriados<br/>4. re-loop (next iter picks up new phases) |
| **Por que soft** | Não é falha. É reconhecimento de escopo. Loop continua. |

### 5. Step 8a — Strategy shift (v0.2 only)

| | |
|---|---|
| **Trigger** | Same-fixture-fail-2x em mesma phase (same AC/test, no behavior change entre iters) |
| **Ação** | 1. surface 3 alternatives:<br/>   • refine test design<br/>   • escalate to human<br/>   • skip signal<br/>2. orchestrator picks one<br/>3. iter count resets to 0<br/>4. execute chosen strategy |
| **Por que soft** | Decisão interna do orchestrator. Loop continua (ou escala, se human pick). |

## Stop com sucesso (não falha)

### 6. All phases `[x]`

| | |
|---|---|
| **Trigger** | `.specs/ROADMAP.md` tem todas phases com `[x]` |
| **Ação** | 1. commit final state<br/>2. emit summary (phases done, total iterations, lessons confirmadas)<br/>3. exit |
| **Por que não-falha** | Loop completou o trabalho. Próxima invocação começa do zero (novo brief). |

## Pre-flight em todos os stops

Antes de qualquer stop:

1. **STATE.md ## Handoff** atualizado com: phase, status, completed, in-progress (file:line), next step, blockers, uncommitted files, branch.
2. **Working tree limpo** — commit or stash, never dirty.
3. **Compact summary** emitido ao humano (chat ou log).

## Por que 6 condições?

| Tentativa | Falha |
|---|---|
| 1 condição "if anything goes wrong" | Ambígua. Sem ação diferenciada. |
| 10 condições granulares | Burocracia. Sub-agents não conseguem classificar. |

6 captura os escape hatches reais observados em calibration (Phase 1–4): hard cap, blocker, user, scope blow-up, strategy shift, success.

## Ver também

- [02-loop-flow](02-loop-flow.md) — onde esses stops aparecem no state machine.
- [05-verdict-handling](05-verdict-handling.md) — step 8a strategy shift (v0.2).
- [SKILL.md §Stop conditions](../SKILL.md) — fonte canônica.
- [SKILL.md §Stop / pause behavior](../SKILL.md) — STATE.md write + tree clean discipline.