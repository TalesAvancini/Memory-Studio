---
date: 2026-08-01
version: 1
description: "Fluxo detalhado da Opção C — Dynamic Workflow + scratchpad + ScheduleWakeup. Mostra como o loop principal roda em background com zero holding, como o orquestrador acorda assincronamente para HITL, e como o scratchpad substitui context como meio de comunicação."
explanation: |
  Opção C é o modelo recomendado para próxima iteração da skill
  (`tlc-roadmap-loop` v0.3 ou v2). Resolve o problema de foreground wait
  do modelo atual combinando:

  1. **Dynamic Workflow** — script JS em background runtime, zero holding.
  2. **SCRATCHPAD.md** — arquivo shared state entre agentes, sobrevive
     crashes, substitui context como meio de comunicação.
  3. **ScheduleWakeup** — orquestrador thin que acorda a cada N minutos
     para HITL assíncrono.
  4. **Heartbeat no scratchpad** — cada agente escreve `last_heartbeat: <ISO>`
     no scratchpad, visível para o usuário em tempo real.

  Trade-offs:
  - ✅ Zero holding do loop principal
  - ✅ HITL preservado (com latência N min, configurável)
  - ✅ Resume trivial (script Dynamic Workflow resume; scratchpad persiste)
  - ✅ User visibility (tail no scratchpad = ver progresso real)
  - ❌ Latência de HITL (decisão do usuário demora até N min pra ser
    processada — default N=5min, ajustável)
  - ❌ Complexidade maior que v0.2 — precisa migration guide

  Diagramas companion:
  - `10-communication-models.md` — comparação dos 4 modelos.
related:
  - ../README.md
  - ../SKILL.md
  - ./10-communication-models.md
  - ./02-loop-flow.md
  - ./08-memory-architecture.md
mermaid_count: 4
---

# 11 — Dynamic Workflow Flow (Opção C)

## TL;DR

**Loop principal em background, orquestrador thin acorda por cron, scratchpad é a única fonte de verdade entre agentes.**

```
┌─────────────────────────────────────────────────────────┐
│  USER (chat normal)                                     │
└──────┬──────────────────────────────────────────┬───────┘
       │ /workflows tlc-roadmap-loop               │ SendMessage
       ▼                                          ▼
┌──────────────────────┐                ┌────────────────────┐
│  Workflow Script     │                │ Orchestrator Thin   │
│  (background runtime)│                │ (ScheduleWakeup     │
│  • agent() dispatches│                │  cron N=5min)       │
│  • pipeline() chain  │◀─── lê ────────│  • lê scratchpad    │
│  • retorna final     │                │  • decide HITL      │
└──────┬───────────────┘                │  • bloqueia user    │
       │                                │    se necessário    │
       │ spawn                          └────────┬───────────┘
       ▼                                         │
┌──────────────────────┐                         │
│  Planner/Impl/       │── escreve ──────────────┤
│  Verifier agents     │                         │
│  (fresh sub-agents)  │                         ▼
└──────┬───────────────┘                ┌────────────────────┐
       │                                │  .specs/SCRATCHPAD │
       └──── lê STATE.md, ROADMAP ─────▶│  • last_heartbeat  │
                                        │  • pending_decision│
                                        │  • lesson_signal   │
                                        │  • agent_progress  │
                                        └────────────────────┘
```

## Diagrama 1 — Sequence: um phase completo end-to-end

```mermaid
sequenceDiagram
    autonumber
    participant U as User (chat)
    participant W as Workflow Script<br/>(background)
    participant A1 as Planner<br/>(fresh agent)
    participant A2 as Implementer<br/>(fresh agent)
    participant A3 as Verifier<br/>(fresh agent)
    participant SP as SCRATCHPAD.md
    participant CRON as ScheduleWakeup<br/>(N=5min)
    participant O as Orchestrator Thin

    U->>W: ultracode: run tlc-roadmap-loop<br/>on .specs/ROADMAP.md
    W->>W: parse script<br/>phase = ROADMAP[0].unchecked
    W->>SP: write {phase: "7a", started_at: ISO, status: "dispatching_planner"}
    W->>A1: dispatch Planner (prompt template)
    A1->>SP: write {planner_progress: "writing spec.md"}
    A1->>SP: write {spec.md: complete, design.md: needed, tasks.md: needed}
    W->>A2: dispatch Implementer (after Planner return)
    A2->>SP: write {impl_progress: "T-03/07 done, commit abc123"}
    Note over A2: atomic commits per task<br/>heartbeat a cada 30s
    A2->>SP: write {impl_done: true, commits: [abc, def, ghi]}
    W->>A3: dispatch Verifier (after Implementer return)
    A3->>SP: write {verifier_progress: "running spec-anchored check"}
    A3->>SP: write {verdict: PASS, gaps: []}

    par Heartbeat paralelo
        loop a cada N minutos
            CRON->>O: wake (lê scratchpad)
            O->>SP: read latest
            O->>SP: write {orchestrator_seen_at: ISO}
            opt HITL necessário
                O->>U: SendMessage "Phase 7a Verifier PASS.<br/>Flip [x] + commit? (y/n)"
                U->>O: "y"
                O->>SP: write {human_decision: "flip", decided_at: ISO}
            end
        end
    and User visibility
        U->>SP: tail -f (a qualquer momento)
        SP-->>U: last_heartbeat: 2026-08-01T14:23:00Z<br/>phase: 7a, impl: T-05/07
    end

    W->>W: verdict=PASS → flip [x] in ROADMAP
    W->>SP: write {phase_done: "7a", next_phase: "7b"}
    W->>A1: dispatch Planner for phase 7b
    Note over W,A3: loop continua até todas phases [x]
```

## Diagrama 2 — State machine do SCRATCHPAD.md

```mermaid
stateDiagram-v2
    [*] --> empty

    empty: scratchpad.md<br/>(não existe)
    dispatching_planner: phase=7a<br/>status=dispatching_planner<br/>started_at=ISO
    planner_active: phase=7a<br/>planner_progress=writing spec.md
    dispatching_implementer: phase=7a<br/>planner_done=true<br/>impl_pending=dispatch
    impl_active: phase=7a<br/>impl_progress=T-NN/TT<br/>last_commit=hash
    dispatching_verifier: phase=7a<br/>impl_done=true<br/>verifier_pending=dispatch
    verifier_active: phase=7a<br/>verifier_progress=running checks
    verdict_pass: phase=7a<br/>verdict=PASS<br/>gaps=[]
    verdict_fail: phase=7a<br/>verdict=FAIL<br/>gaps=[G1, G2, G3]
    human_decision_pending: phase=7a<br/>human_decision=ask<br/>asked_at=ISO
    phase_done: phase=7a<br/>[x]=true<br/>next_phase=7b

    empty --> dispatching_planner: W spawn Planner
    dispatching_planner --> planner_active: P write heartbeat
    planner_active --> planner_active: P heartbeat (30s)
    planner_active --> dispatching_implementer: P write spec/design/tasks done

    dispatching_implementer --> impl_active: I write heartbeat
    impl_active --> impl_active: I commit + heartbeat
    impl_active --> dispatching_verifier: I write impl_done=true

    dispatching_verifier --> verifier_active: V write heartbeat
    verifier_active --> verdict_pass: V write verdict=PASS
    verifier_active --> verdict_fail: V write verdict=FAIL

    verdict_pass --> phase_done: W flip [x] + commit
    verdict_fail --> dispatching_implementer: iter<3, fix tasks
    verdict_fail --> human_decision_pending: iter=3, escalate

    human_decision_pending --> phase_done: user said "skip + accept"
    human_decision_pending --> dispatching_implementer: user said "refine test"
    human_decision_pending --> [*]: user said "stop loop"

    phase_done --> dispatching_planner: next phase loop
```

## Diagrama 3 — Decisão: HITL ou autônomo?

```mermaid
flowchart TD
    START[Orchestrator acorda<br/>lê scratchpad] --> READ{scratchpad<br/>tem human_decision<br/>= ask?}
    READ -- não --> IDLE{phase_done<br/>= true?}
    READ -- sim --> BLOCK[Bloqueia user<br/>via SendMessage<br/>aguarda resposta]

    IDLE -- sim --> NEXT[Próxima phase<br/>loop volta ao workflow]
    IDLE -- não --> HEARTBEAT[Escreve orchestrator_seen_at<br/>no scratchpad<br/>dorme N minutos]

    BLOCK --> WAIT[aguarda user]
    WAIT --> RESP{user respondeu?}
    RESP -- sim --> WRITE[Escreve human_decision<br/>no scratchpad]
    RESP -- timeout 30min --> ESCALATE[Escreve timeout<br/>no scratchpad<br/>aguarda próxima wakeup]

    WRITE --> HEARTBEAT
    ESCALATE --> HEARTBEAT

    HEARTBEAT --> START

    style BLOCK fill:#ffd,stroke:#ca3
    style ESCALATE fill:#fee,stroke:#c33
    style WRITE fill:#cef,stroke:#39c
```

## Diagrama 4 — Crash recovery

```mermaid
sequenceDiagram
    participant U as User
    participant W as Workflow Script
    participant A as Sub-agent<br/>(em crash)
    participant SP as SCRATCHPAD.md

    Note over W,A: cenário: Implementer mid-task crash (API 429, OOM, etc)

    A->>SP: write {impl_progress: "T-03/07, commit abc,<br/>uncommitted: pipeline.ts:42-80,<br/>crashed_at: ISO}
    A-->>W: dies (returns error to script)
    W->>SP: read latest
    W->>SP: write {status: "implementer_crashed",<br/>last_good_commit: abc,<br/>uncommitted_paths: [pipeline.ts]}
    W->>U: SendMessage "Phase 7a crashed mid-T-03.<br/>Uncommitted: pipeline.ts:42-80.<br/>Resume? (y/n)"

    alt user resume
        U->>W: "resume"
        W->>W: re-dispatch Implementer<br/>prompt includes:<br/>"resume from T-03, last good = abc,<br/>uncommitted edits in pipeline.ts:42-80"
        Note over W: Implementer reads scratchpad,<br/>sees uncommitted state,<br/>git diff shows in-flight edit
    else user abort
        U->>W: "abort phase 7a"
        W->>SP: write {phase: "7a", status: "aborted",<br/>last_good: abc}
        W->>W: move to next phase (7b) or stop
    end
```

## Estrutura do SCRATCHPAD.md

```markdown
---
schema_version: 1
last_heartbeat: 2026-08-01T14:23:00Z
active_workflow: wf_abc123
---

# Roadmap loop state

## Current phase
- phase: 7a
- status: impl_active
- subchapter: null

## Sub-agent progress
- planner:
    dispatched: true
    completed: true
    spec_md: .specs/features/phase-7a-metrics/spec.md
    design_md: .specs/features/phase-7a-metrics/design.md
    tasks_md: .specs/features/phase-7a-metrics/tasks.md
    returned_at: 2026-08-01T14:10:00Z
- implementer:
    dispatched: true
    completed: false
    progress: "T-05/07 done, T-06 in flight"
    commits: [abc123, def456, ghi789]
    last_commit_at: 2026-08-01T14:22:30Z
- verifier:
    dispatched: false
    pending: true

## Verdicts
- last_verdict: null
- last_passed: phase_6b_4
- consecutive_fails: 0

## Pending decisions
- human_decision: null  # or "ask"
- human_asked_at: null
- human_decided_at: null

## Orchestrator heartbeat
- orchestrator_seen_at: 2026-08-01T14:23:00Z
- next_wakeup_at: 2026-08-01T14:28:00Z

## Lessons (last 5 confirmed)
- L-001: vec0 ≠ FTS5 trigger syntax
- L-002: Windows EBUSY retry
- ...

## Crash recovery
- last_crash: null
- last_good_commit: bc95558 (phase 6b.4 end)
- uncommitted_paths: []
```

## Trigger pra migrar ATUAL → C

Quando **qualquer uma** dessas virar verdade:

1. Custo de holding > 30% do budget da sessão do orquestrador
2. HITL mid-run virar requirement explícito do usuário
3. Crash mid-phase com trabalho não-commitado > 1x por sprint
4. Múltiplas workflows Memory Studio rodando em paralelo (precisa de coordenação)

Hoje: **Nenhuma** das 4 está ativa. Mas a primeira (1) já é borderline — Phase 7a teve 4h 30m de foreground wait.
