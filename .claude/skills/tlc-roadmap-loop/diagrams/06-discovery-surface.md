---
date: 2026-07-24
version: 1
description: "Step 8b — Verifier/Implementer detectam drift → DISCOVERIES.md → orchestrator surface → re-render farol."
explanation: "Camada C → Camada A via orchestrator. Sub-agents appendam em DISCOVERIES.md (severity: cosmetic/structural/critical) sem bloquear a phase. Orchestrator surface ao humano após Verifier. Re-render é decisão humana."
related:
  - ../README.md
  - ./01-triple-camada.md
  - ./02-loop-flow.md
  - ./07-authority-boundaries.md
mermaid_count: 1
---

# 06 — Discovery Surface (step 8b)

## Resumo

Step 8b dispara **sempre** após Verifier (independente de PASS/FAIL). Se `DISCOVERIES.md` foi appended nesta phase, orchestrator surface ao humano. Re-render do farol é decisão humana — orchestrator não auto-renderiza.

## Diagrama

```mermaid
flowchart TB
    start([Verifier returns<br/>PASS or FAIL]) --> check_discoveries

    check_discoveries{DISCOVERIES.md<br/>appended this phase?}

    check_discoveries -->|NO| end_loop([back to loop flow<br/>step 1])
    check_discoveries -->|YES| severity_check

    severity_check{Severity?}

    severity_check -->|cosmetic| log_only[log only<br/>do not surface<br/>to human]
    severity_check -->|structural| count_check
    severity_check -->|critical| escalate_immediately

    count_check{>=3 structural<br/>accumulated<br/>without review?}
    count_check -->|NO| surface_decision
    count_check -->|YES| auto_suggest_y[auto-suggest y<br/>to user<br/>no waiting for trigger]

    escalate_immediately[escalate immediately<br/>regardless of user choice<br/>block next phase<br/>until decision]

    surface_decision[surface to human:<br/>'Phase N introduced D-NNN<br/>architectural discovery: title.<br/>Severity: structural.<br/>Suggest reviewing the farol.<br/>Re-render? y/n']

    surface_decision --> user_yes[user y]
    surface_decision --> user_no[user n]

    user_yes --> rerender_sequence
    user_no --> leave_proposed[leave DISCOVERIES.md entry<br/>as 'proposed'<br/>human reviews later]

    rerender_sequence[orchestrator runs<br/>full re-render sequence]
    rerender_sequence --> step1[1. update .specs/ARCHITECTURE.md<br/>reflect discovery<br/>text + stable IDs]
    step1 --> step2[2. regenerate .specs/architecture.architecture.json<br/>from updated ARCHITECTURE.md]
    step2 --> step3[3. validate:<br/>archify validate]
    step3 --> step4[4. render HTML:<br/>archify render]
    step4 --> step5[5. surface final paths<br/>to user]

    log_only --> end_loop
    auto_suggest_y --> surface_decision
    leave_proposed --> end_loop
    step5 --> end_loop
    escalate_immediately --> end_loop

    style escalate_immediately fill:#ffcdd2,stroke:#c62828
    style surface_decision fill:#fff3e0,stroke:#fb8c00
    style rerender_sequence fill:#e8f4f8,stroke:#1e88e5
```

## Quem pode escrever em DISCOVERIES.md

| Role | Quando | Severities |
|---|---|---|
| **Planner** | Design.md requer componente/edge novo não-mapeado no farol | cosmetic / structural / critical |
| **Implementer** | Mid-phase descobre scope blow-up ou boundary não-mapeada | cosmetic / structural |
| **Verifier** | Observa drift arquitetural durante check | cosmetic / structural / critical |

**Regra**: append **não bloqueia** a phase. Sub-agent segue. Orchestrator surface no step 8b.

## Severities

| Severity | Significado | Comportamento |
|---|---|---|
| `cosmetic` | Renaming, relabeling, internal restructuring | Log only. NÃO surface. |
| `structural` | New edge, new component, refactor de boundary | Surface ao humano. Se >=3 acumulados sem review → auto-suggest y. |
| `critical` | Architectural boundary change (auth, persistence, authority, concurrency) | **Escalate immediately**. Block next phase até decisão. |

## Re-render sequence (orchestrator owns)

```bash
# Step 1: update .specs/ARCHITECTURE.md (text + stable IDs)
# (manual edit by orchestrator or fresh sub-agent for schema fidelity)

# Step 2: regenerate .specs/architecture.architecture.json
# (from updated ARCHITECTURE.md)

# Step 3: validate
node .agents/skills/archify/bin/archify.mjs validate architecture \
  .specs/architecture.architecture.json

# Step 4: render HTML
node .agents/skills/archify/bin/archify.mjs render architecture \
  .specs/architecture.architecture.json \
  .specs/architecture.html

# Step 5: surface paths
echo "Updated: .specs/ARCHITECTURE.md"
echo "Updated: .specs/architecture.html"
```

**Por que orchestrator owns (não sub-agent)?** Renderização é side-effect arquitetural — deve ser orquestrado, não delegado. Sub-agents podem escrever em `.specs/DISCOVERIES.md` mas não re-renderizar.

## Pre-bootstrap fallback

Se `.specs/ARCHITECTURE.md` não existe ainda (pre-bootstrap):

- Sub-agents ainda podem appendar em `DISCOVERIES.md` (criar o arquivo se missing).
- Re-render sequence fica bloqueada até farol existir.
- Orchestrator surface ao humano: "DISCOVERIES.md has N entries but no farol yet. Bootstrap farol first?"

## Ver também

- [01-triple-camada](01-triple-camada.md) — Camada A (farol) ↔ Camada B (orchestrator) ↔ Camada C (sub-agents).
- [07-authority-boundaries](07-authority-boundaries.md) — quem autoriza re-render (humano).
- [SKILL.md §Orchestrator flow step 8b](../SKILL.md) — fonte canônica.