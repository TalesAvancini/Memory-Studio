---
date: 2026-07-24
version: 1
description: "README principal da skill tlc-roadmap-loop v0.2 — entrada para novos agentes e humanos."
explanation: "Documentação arquitetural canônica. Substitui a necessidade de ler histórico de conversa para entender a stack. README indexa os 9 diagramas modulares em diagrams/."
---

# tlc-roadmap-loop v0.2 — Architecture Map

## TL;DR

Skill **orchestradora** que compõe `tlc-spec-driven` + `archify` + três sub-agents (`Planner` → `Implementer` → `Verifier`) por phase. Lê `.specs/ROADMAP.md`, dispatcha sub-agents em sequência, gateia no verdict do Verifier, loopa até todas as phases estarem `[x]` ou condição de escalation trip. Tudo via interface self-contained (sub-agents não veem o chat pai). Drift arquitetural detectado em runtime é surfaced via `.specs/DISCOVERIES.md` (Camada 0 → re-render do farol via `archify`).

## Quando usar

Triggers (extraídos de `SKILL.md`):

- "advance the roadmap"
- "run the next phase"
- "loop the roadmap" / "/loop roadmap"
- "build the next phase"
- "implement next feature"
- "resume the loop" / "continue the roadmap"
- "where is the loop?"

## Quando NÃO usar

- **Feature única sem loop** → invocar `tlc-spec-driven` direto ("specify feature X").
- **Decomposição cross-stack / análise arquitetural broad** → usar `archify` sozinho.
- **Code review de diff** → usar `code-review` ou `simplify`.
- **Multi-agent fan-out paralelo** → phases são sequenciais por design (rule "Never parallel phases"). Paralelismo é outro padrão.
- **Lançar testes pontuais ou implementar um fix isolado** → trabalho manual, sem orquestração.

## Arquitetura (índice dos 9 diagramas)

| # | Diagrama | Tipo Mermaid | Foco |
|---|---|---|---|
| 1 | [01-triple-camada](diagrams/01-triple-camada.md) | `flowchart TB` | Camada A (archify farol) ↔ Camada B (orchestrator) ↔ Camada C (sub-agents). Quem lê de quem, quem escreve em quem. |
| 2 | [02-loop-flow](diagrams/02-loop-flow.md) | `stateDiagram-v2` | Ciclo principal: `load_state` → `pick_phase` → `dispatch_planner` → `dispatch_implementer` → `dispatch_verifier` → `verdict` → loop ou stop. |
| 3 | [03-skill-composition](diagrams/03-skill-composition.md) | `flowchart LR` | Composição com `tlc-spec-driven` (base SDD) + `archify` (farol) + `notebooklm` (lessons externas). O que cada um faz vs delega. |
| 4 | [04-subagent-contracts](diagrams/04-subagent-contracts.md) | `sequenceDiagram` | Contratos in/out por sub-agent role. Planner lê ROADMAP excerpt + farol ref → escreve spec/design/tasks. Implementer lê tasks → escreve commits. Verifier lê commits + spec → escreve validation.md + verdict. |
| 5 | [05-verdict-handling](diagrams/05-verdict-handling.md) | `stateDiagram-v2` | v0.2 com step 8a (failure diagnostics pre-flight): PASS → flip [x]; FAIL → compare com iter anterior → same-fixture-fail-2x → 3 strategy alternatives (refine test / escalate / skip signal). |
| 6 | [06-discovery-surface](diagrams/06-discovery-surface.md) | `flowchart` | step 8b: Verifier/Implementer detectam drift → append `.specs/DISCOVERIES.md` → orchestrator surface to user → re-render farol decision (y/n) → `archify` regenera HTML. |
| 7 | [07-authority-boundaries](diagrams/07-authority-boundaries.md) | `flowchart` + tabela | Quem decide o quê: humano (PRD, decisions travadas, farol re-render), orchestrator (brief, dispatch, audit, STATE updates, decisions append), sub-agents (scoped work). |
| 8 | [08-memory-architecture](diagrams/08-memory-architecture.md) | `flowchart` | MEMORY.md como índice + arquivos `.md` individuais (1 fato por arquivo). Tipos: user, feedback, project, reference. Quando escrever vs quando ler. |
| 9 | [09-stop-conditions](diagrams/09-stop-conditions.md) | `flowchart` | Escape hatches: 3× FAIL consecutivo, hard blocker, user interrupt, SUBCHAPTER_BREAKDOWN, step 8a failure diagnostics. Cada um → ação concreta. |

## v0.2 delta (mudou de v0.1)

- **Step 8a — failure diagnostics pre-flight**: antes de re-dispatch em FAIL, compara Verifier FAIL atual vs imediatamente anterior para aquela phase. Se **mesma fixture falhou 2× sem mudança de comportamento** (same root cause), **NÃO** auto-retry. Surface 3 strategy alternatives ao orchestrator:
  1. **Refine test design** — fixture é decorative (ex: threshold permissivo); redesenhar como boundary assertion antes do próximo dispatch.
  2. **Escalate to human** — escrever STATUS em `.specs/STATE.md ## Handoff` com o stuck pattern e paginar user.
  3. **Skip signal** — aceitar a falha como pragmatic closure (ex: Sinal X partial); registrar em lessons via `scripts/lessons.py add`.
- O 3-iteration cap (step 8, FAIL branch) é o **floor**, não o ceiling. Pre-flight fires BEFORE counting toward the cap. Iter count **reseta para 0** após strategy shift chosen.
- **Por quê**: sem isso, o loop queima tokens re-rodando o mesmo gate. Phase 4 (search) iter 1→2 reproduziu T-ORCH-19b sem atacar root cause (decorative test fixture). Pre-flight catches "same shape" failures e força decisão de estratégia mais cedo.

## Companion skills

| Skill | Papel |
|---|---|
| [`tlc-spec-driven`](https://github.com/) | Base SDD — Specify → Design → Tasks → Execute → Verify. Toda semântica de planning/implementation/validation vive aqui. **NÃO duplicar** essas regras; referenciar por nome. |
| `archify` | Renderer do farol arquitetural (Camada A). Valida `.specs/architecture.architecture.json` e gera `.specs/architecture.html`. |
| `find-skills` | Descobrir companion skills adicionais sob demanda. |
| `notebooklm` | Opcional — seed de lessons de research externo antes do loop rodar. |

## Arquivos relacionados

- `SKILL.md` — definição da skill em si (v0.2, 17.675 bytes). **NÃO TOCAR** — esta documentação é co-localizada, não substituta.
- `diagrams/*.md` — os 9 diagramas modulares.
- `../specs/ARCHITECTURE.md` — farol textual (LLM-facing; ler como texto, NÃO abrir HTML).
- `../specs/architecture.architecture.json` — farol estruturado (fonte de verdade).
- `../specs/architecture.html` — farol renderizado (humano-facing).
- `../specs/DISCOVERIES.md` — log append-only de drift arquitetural.
- `../specs/STATE.md` — `## Decisions` (append-only) + `## Handoff` (overwrite).
- `../specs/ROADMAP.md` — source of truth das phases.
- `../specs/LESSONS.md` — lessons confirmadas (lidas antes de Planner dispatch).

## Contribuindo

- Adicionar diagramas novos sob `diagrams/NN-<slug>.md` com frontmatter completo (ver `diagrams/01-triple-camada.md` como template).
- Indexar todo diagrama novo no README (seção "Arquitetura").
- Cross-references entre diagramas via `related:` no frontmatter.
- Versionar atomicamente — 1 commit por round de documentação.
- SKILL.md é intocado a menos que mudança comportamental real seja introduzida.

## Lições aplicadas (referências)

Lessons que motivaram decisões de design documentadas aqui:

- **`memory/skill-readiness-needs-evidence.md`** — Sinal 3 strict (FAIL → fix → PASS observado) é o que diferencia "ready" real de "ready" performático. Diagram #5 (verdict-handling) codifica essa disciplina via step 8a.
- **`memory/sub-agent-runaway-observation.md`** — sub-agent loop é por observer + escalate; cap não basta. Diagrams #2 (loop-flow) + #9 (stop-conditions) explicitam os escape hatches.
- **`memory/bicycle-vs-training-wheels.md`** — humano prefere versão completa a MVP parcial quando arquitetura está clara. Diagram #1 (triple-camada) mostra a arquitetura completa antes de qualquer phase rodar.

## Licença

CC-BY-4.0 (mesma da `SKILL.md`).