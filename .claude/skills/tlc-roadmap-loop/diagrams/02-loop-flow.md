---
date: 2026-07-24
version: 1
description: "Ciclo principal do orchestrator em stateDiagram-v2 — load → pick → dispatch × 3 → verdict → loop."
explanation: "Captura o coração do loop como máquina de estados. Estados são os passos numerados do SKILL.md §Orchestrator flow; transições mostram onde loop volta (PASS ou step 3 re-pick) e onde para (stop conditions). Self-loops marcam re-tentativas internas."
related:
  - ../README.md
  - ./05-verdict-handling.md
  - ./09-stop-conditions.md
mermaid_count: 1
---

# 02 — Loop Flow

## Resumo

Ciclo principal do orchestrator. Sequência numerada conforme `SKILL.md` §Orchestrator flow (passos 1–9 + sub-passos 8a/8b). Cada estado é uma operação discreta; transições mostram **para onde o controle vai depois** (e.g., PASS → flip `[x]` + commit → volta a `load_state`; FAIL → step 8a ou re-dispatch).

## Diagrama

```mermaid
stateDiagram-v2
    [*] --> load_state

    load_state: 1. load_state<br/>read STATE.md, ROADMAP.md, LESSONS.md, ARCHITECTURE.md
    pick_phase: 3. pick_phase<br/>first unchecked phase whose deps are [x]
    clean_env: 4. clean_env<br/>free ports, kill stale procs
    dispatch_planner: 5. dispatch_planner<br/>fresh sub-agent, prompt template
    dispatch_implementer: 6. dispatch_implementer<br/>per-task: implement → gate → atomic commit
    dispatch_verifier: 7. dispatch_verifier<br/>spec-anchored check + discrimination sensor

    load_state --> pick_phase
    pick_phase --> clean_env
    clean_env --> dispatch_planner
    dispatch_planner --> subchapter_breakdown: SUBCHAPTER_BREAKDOWN<br/>(phase too big)
    dispatch_planner --> dispatch_implementer
    subchapter_breakdown --> pick_phase: insert subchapters<br/>next iter picks them up

    dispatch_implementer --> subchapter_breakdown_impl: SUBCHAPTER_BREAKDOWN
    subchapter_breakdown_impl --> pick_phase
    dispatch_implementer --> dispatch_verifier

    dispatch_verifier --> verdict_handle: validation.md<br/>+ verdict returned

    verdict_handle: 8. verdict_handle<br/>(see diagram 05)

    verdict_handle --> handle_pass: PASS
    verdict_handle --> step8a_preflight: FAIL
    verdict_handle --> stop_all: 3x FAIL consecutive

    handle_pass: 8a. handle_pass<br/>flip [x] + commit + STATE update
    step8a_preflight: 8a. failure_diagnostics<br/>compare current vs previous FAIL

    handle_pass --> load_state: loop
    step8a_preflight --> dispatch_verifier: same-fixture-fail-1x<br/>(normal retry)
    step8a_preflight --> strategy_shift: same-fixture-fail-2x<br/>or no behavior change
    step8a_preflight --> stop_escalate: 3-iter cap reached<br/>(post strategy shift)

    strategy_shift: strategy_shift<br/>3 alternatives: refine test / escalate / skip signal
    strategy_shift --> dispatch_verifier: iter count resets to 0
    strategy_shift --> stop_escalate: human decides to stop

    stop_all: 9. stop_all<br/>emit final report
    stop_escalate: 9. stop_escalate<br/>paginar user

    handle_pass --> discovery_surface: 8b. discovery_surface<br/>(if DISCOVERIES.md appended)
    discovery_surface --> load_state: user n<br/>(leave as proposed)
    discovery_surface --> rerender_farol: user y<br/>(re-render architecture.html)
    rerender_farol --> load_state

    stop_all --> [*]
    stop_escalate --> [*]
```

## Pontos chave (PT-BR)

### Self-loops e re-entrada

- `pick_phase` é re-entrante: pode ser visitado múltiplas vezes (após cada PASS ou após SUBCHAPTER_BREAKDOWN).
- `dispatch_verifier` pode ser re-visitado: 1 retry normal + retries após strategy shift (com iter count resetado).

### Saídas (terminators)

- `[*] → load_state`: entrada (loop start).
- `stop_all → [*]`: quando todas as phases estão `[x]` (loop done com sucesso) ou quando stop conditions trip.
- `stop_escalate → [*]`: quando escalado para humano (3× FAIL consecutivo, hard blocker, user interrupt).

### Step 8b (architectural drift surface)

- Dispara **sempre** após Verifier, independente de PASS/FAIL.
- Se `DISCOVERIES.md` foi appended esta phase, orchestrator pergunta ao humano sobre re-render do farol.
- Detalhes em [06-discovery-surface](06-discovery-surface.md).

### Step 8a (failure diagnostics pre-flight) — v0.2

- Dispara **antes** do retry em FAIL.
- Compara FAIL atual vs FAIL anterior (track em `validation.md` iter history).
- Same-fixture-fail-2x → strategy_shift (não auto-retry).
- Detalhes em [05-verdict-handling](05-verdict-handling.md).

## Comportamentos críticos

- **Nunca paralelo**: phases são sequenciais. Não há spawn paralelo de sub-agents.
- **Sempre fresh sub-agent**: cada dispatch é context limpo. Sem carry-over entre dispatches.
- **Auto-commit só dentro do loop**: Implementer commita per-task sem confirmação. Fora do loop, mesmas regras SDD, sem auto-commit.

## Ver também

- [05-verdict-handling](05-verdict-handling.md) — detalhe do `verdict_handle` state + step 8a.
- [09-stop-conditions](09-stop-conditions.md) — detalhe de cada escape hatch.
- [SKILL.md §Orchestrator flow](../SKILL.md) — fonte canônica (passos 1–9).