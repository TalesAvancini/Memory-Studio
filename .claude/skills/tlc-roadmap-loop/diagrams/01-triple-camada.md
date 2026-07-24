---
date: 2026-07-24
version: 1
description: "Visão geral das 3 camadas: A (archify farol) ↔ B (orchestrator) ↔ C (sub-agents)."
explanation: "Estabelece que o sistema tem 3 camadas arquiteturais distintas, cada uma com responsabilidade clara. A Camada A é a referência arquitetural persistente (farol), B é o orchestrator que coordena, C é o trabalho executado. Setas mostram quem lê de quem e quem escreve em quem."
related:
  - ../README.md
  - ./03-skill-composition.md
  - ./06-discovery-surface.md
  - ./07-authority-boundaries.md
mermaid_count: 1
---

# 01 — Triple Camada (A / B / C)

## Resumo

O `tlc-roadmap-loop` opera em **3 camadas arquiteturais** com responsabilidades distintas:

- **Camada A — Farol arquitetural** (`archify` + `.specs/ARCHITECTURE.md`): referência persistente, texto legível por LLM, fonte de verdade para stable IDs. Re-renderizada quando há drift.
- **Camada B — Orchestrator** (esta skill): coordena. Lê ROADMAP, dispatcha sub-agents, gateia verdicts, atualiza STATE, decide strategy em FAIL.
- **Camada C — Sub-agents** (`Planner` / `Implementer` / `Verifier`): executam trabalho scoped em ciclos curtos. Fresh context por dispatch. Nunca se veem entre si.

## Diagrama

```mermaid
flowchart TB
    subgraph LAYER_A[Layer A — Architectural Farol]
        direction TB
        archify[archify<br/>renderer + validator]
        arch_md[".specs/ARCHITECTURE.md<br/>(textual, LLM-facing)"]
        arch_json[".specs/architecture.architecture.json<br/>(structured source)"]
        arch_html[".specs/architecture.html<br/>(rendered, human-facing)"]
        discoveries[".specs/DISCOVERIES.md<br/>(append-only drift log)"]
        archify --> arch_json
        arch_json --> arch_md
        arch_json --> arch_html
    end

    subgraph LAYER_B[Layer B — Orchestrator]
        direction TB
        orch[("tlc-roadmap-loop<br/>(this skill)")]
        roadmap[".specs/ROADMAP.md<br/>(phase source of truth)"]
        state[".specs/STATE.md<br/>## Decisions / ## Handoff"]
        lessons[".specs/LESSONS.md<br/>(confirmed only)"]
        orch -. reads .-> roadmap
        orch -. reads .-> state
        orch -. reads .-> lessons
        orch -. reads .-> arch_md
        orch -. reads .-> discoveries
        orch -. writes .-> state
        orch -. writes .-> roadmap
    end

    subgraph LAYER_C[Layer C — Sub-Agents]
        direction TB
        planner[Planner<br/>fresh sub-agent]
        implementer[Implementer<br/>fresh sub-agent]
        verifier[Verifier<br/>fresh sub-agent]
    end

    orch ==>|"dispatch + prompt template"| planner
    orch ==>|"dispatch + task list"| implementer
    orch ==>|"dispatch + diff range"| verifier

    planner -. writes .-> arch_md
    planner -. writes .-> discoveries
    implementer -. writes .-> arch_md
    implementer -. writes .-> discoveries
    verifier -. writes .-> discoveries
    verifier -. writes .-> state

    discoveries -. "step 8b surface" .-> orch
    orch -. "trigger re-render" .-> archify

    style LAYER_A fill:#e8f4f8,stroke:#1e88e5
    style LAYER_B fill:#fff3e0,stroke:#fb8c00
    style LAYER_C fill:#f3e5f5,stroke:#8e24aa
```

## Fluxos chave (PT-BR)

### Camada A — leitura

- Orchestrator (B) **lê** `ARCHITECTURE.md` (texto) como referência para stable IDs em prompts de Planner. **Não** abre o HTML.
- Sub-agents (C) recebem pointers para `ARCHITECTURE.md` no prompt — leem como texto.

### Camada A — escrita

- Apenas Orchestrator escreve `ARCHITECTURE.md` / `architecture.json` / `architecture.html`, **mediante trigger explícito** (step 8b, decisão humana).
- `archify` é invocado pelo orchestrator para validar + render.

### Camada B → Camada C

- Cada dispatch tem **prompt self-contained** (sub-agent não vê o chat pai).
- 3 roles sequenciais por phase: `Planner` → `Implementer` → `Verifier`.
- Sub-agents **não** se chamam entre si. Sequenciamento é 100% responsabilidade do orchestrator.

### Camada C → Camada A

- Sub-agents podem **append** em `.specs/DISCOVERIES.md` (severity: cosmetic / structural / critical) — **não bloqueiam** a phase se descobrirem componente novo.
- Surface ao orchestrator via step 8b, que então pergunta ao humano sobre re-render.

## Por que 3 camadas (e não 2 ou 4)?

| Tentativa | Falha |
|---|---|
| 2 camadas (orchestrator + sub-agents, sem farol) | Toda referência arquitetural vira "scroll-up no histórico" — caro, opaco. Verifier não tem ponto de verdade estável. |
| 4 camadas (separar farol renderizado e farol texto) | Renderização e fonte de verdade são a mesma Camada A. Separar duplica trabalho de sync sem ganho. |

3 camadas captura a separação real: **referência** (A) vs **coordenação** (B) vs **execução** (C).

## Ver também

- [03-skill-composition](03-skill-composition.md) — quais skills externas compõem cada camada.
- [06-discovery-surface](06-discovery-surface.md) — fluxo step 8b que liga Camada C → Camada A via orchestrator.
- [07-authority-boundaries](07-authority-boundaries.md) — quem pode escrever em cada camada.