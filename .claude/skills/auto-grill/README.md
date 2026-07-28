# auto-grill

Autonomous variant of `mattpocock-skills:grill-with-docs`. Runs the same relentless interview loop without burning your synchronous attention.

## TL;DR

```bash
# Single target
auto-grill .specs/archive/2026-07-calibration/features/system-message-builder/spec.md
# → writes <spec>.auto-grill.{transcript,decisions,loop-state}.md (next to target)
# → appends to .specs/DISCOVERIES.md
# → surfaces a decisions table for you to approve/reject/loop

# Composite target (multiple docs treated as ONE spec)
auto-grill PRD.md PLAN.md
# → writes PRD-PLAN.auto-grill.{transcript,decisions,loop-state}.md
# → Interrogator cross-references both docs in each question
```

Use `--output-dir <path>` to redirect the 3 sibling files. `DISCOVERIES.md` always lands in `.specs/DISCOVERIES.md` (not configurable).

When the loop ends, you see a table like:

| # | Lens | Pergunta | Decisão | Analogia | Tracer Bullet | Confiança |
|---|------|----------|---------|----------|---------------|-----------|
| 1 | Fog of War | "Como o augmenter se comporta com `prompt = ''`?" | Empty input é non-error; persona+rules só. | "É como um formulário que ignora campos vazios." | → slice: AUG-E1 (deterministic empty) | alta |
| 2 | Cache Determinism | "Cache key inclui `persona.content`?" | Não — só `tenantId + sortedHashes + promptKind`. | "A chave é a identidade do pedido, não o texto decorativo." | → slice: AUG-C1 (byte-identical) | alta |
| 3 | Semantic Anchors | "O que é 'ephemeral: true'?" | Literal type narrowing (não boolean). | "É uma etiqueta que diz 'isto é temporário' e o tipo impede confusão." | — | média |

Reject any row → the loop restarts focused on that branch.

## After the gate — pipeline

Auto-grill **para no gate**. Você dirige o resto. Sequência canônica:

```
auto-grill <doc>                   # Phase 5 HUMAN GATE → você aprova decisions.md
        ↓
# IMPORTANTE: `to-spec` NÃO lê `decisions.md`. Ele lê o `conversation context`.
# O `transcript.md` produzido pelo auto-grill é o surrogate dessa conversa.
# Antes de invocar `/to-spec`, carregue o transcript.md na mesma sessão
# (Read tool, ou cole no chat).
        ↓
mattpocock-skills:to-spec          # (você invoca) → SPEC publicada no issue tracker
        ↓
prompts/to-roadmap (project-local) # (você invoca) → .specs/ROADMAP.md
        ↓
mattpocock-skills:to-tickets       # (você invoca) → vertical slices
        ↓
mattpocock-skills:implement        # (você invoca) → TDD + code-review por ticket
        ↓
Verifier PASS → ticket done
```

Cada seta é uma decisão sua de continuar. **Auto-grill não auto-avança** — gate é portão, não rampa.

**Detalhe:** `to-spec` produz uma SPEC publicada no issue tracker (GitHub / Linear / local MD files). Ele sintetiza a conversation context — não faz entrevista. `to-tickets` produz vertical slices (não tarefas pra criar a spec). Detalhes em [diagrams/09-companion-skills.md](./diagrams/09-companion-skills.md).

## Where the artifacts land

| Arquivo | Local | Override? |
|---|---|---|
| `<target>.auto-grill.transcript.md` | next to target | `--output-dir <path>` |
| `<target>.auto-grill.decisions.md` | next to target | `--output-dir <path>` |
| `<target>.auto-grill.loop-state.json` | next to target | `--output-dir <path>` |
| `.specs/DISCOVERIES.md` (append) | repo `.specs/` | **não** — fixo |
| `prompts/to-roadmap.md` | (skill asset, não output) | — |

## When to use vs the originals

| | `grill-me` | `grill-with-docs` | **auto-grill** |
|---|---|---|---|
| Sync HITL | yes | yes | **no — gate only** |
| You babysit | yes | yes | **no** |
| Updates `CONTEXT.md` / ADRs | yes | yes | **no (read-only)** |
| Confidence gate | implicit | implicit | **explicit 0.7 floor** |
| Output | conversation history | conversation + docs | **Artifact Pack (4 files)** |

Pick auto-grill when you have the doc, you have the context, and you want a batch review you can read async. Pick `grill-me` when the design tension is the point.

## Files

```
.claude/skills/auto-grill/
├── SKILL.md                       # the contract
├── README.md                      # this file
├── diagrams/                      # 14 diagramas modulares
│   ├── 01-architecture.md         # orchestrator + 2 sub-agents + human gate
│   ├── 02-flow.md                 # 5-phase flow (stateDiagram-v2)
│   ├── 03-lenses.md               # 8 lenses cycling + exhaustion
│   ├── 04-confidence.md           # scoring pipeline + hard floor
│   ├── 05-subagent-contracts.md   # Interrogator + Proxy prompt shapes
│   ├── 06-artifact-pack.md        # 4 output files + schemas
│   ├── 07-loop-state.md           # outer state machine across runs
│   ├── 08-critical-rules.md       # 10 rules mapped to risks
│   ├── 09-companion-skills.md     # relationship to siblings + downstream
│   ├── 10-decisions-ui.md         # fluxo do gate com UI opcional pra batches
│   ├── 11-round-protocol.md       # state machine do loop (macro-states)
│   ├── 12-orchestrator-handoff.md # decision tree do orquestrador por round
│   ├── 13-quickstart-procedural.md# sequenceDiagram CLI → gate (user-perspective)
│   └── 14-fresh-subagent-invariant.md # regra 7 visualizada (2 fresh sub-agents/round)
├── prompts/
│   └── to-roadmap.md              # extrai .specs/ROADMAP.md da SPEC (próximo passo pós-gate)
└── assets/
    └── decisions-ui.html          # standalone browser UI pro gate (cards, filtros, export)
```

## Bonus UI pra batches grandes

Quando o `decisions.md` passa de ~40 linhas, ler a tabela markdown vira cansativo. `assets/decisions-ui.html` é uma página standalone (abre via `file://`, zero deps, zero build) que:

- renderiza cada decisão como um **card** com confidence colorida (verde / amarelo / vermelho)
- filtra por **lens** (tabs), **confiança** e **status** (checkboxes)
- tem 3 botões por card: **✅ Aprovar**, **❌ Rejeitar** (com motivo opcional), **🔁 Loop-branch**
- salva estado em `localStorage` (F5 não perde trabalho)
- exporta `<target>.auto-grill.decisions.respondido.md` no mesmo schema que o LLM espera ler

**Não muda o fluxo**: você ainda cola o `decisions.md`, decide, exporta, e o LLM lê o `.respondido.md` na próxima invocação. É só um front-end confortável pro gate — não substitui nada.

## Origin

- Brainstormed in NotebookLM notebook `f235cc21-b876-483e-b8a7-20d6234fa35c` on 2026-07-26 (full Portuguese + English discussion of A2A grilling loop).
- Composed on top of Matt Pocock's `grill-with-docs` v1.1 (LICENSE: CC-BY-4.0).
- First target test (deferred per `feedback-no-random-invocation`): `.specs/archive/2026-07-calibration/features/system-message-builder/spec.md` (Phase 5 of Memory Studio — calibration artifact, archived).
- Composite target support added 2026-07-27 — official v0.2 of the skill. See [SKILL.md §SETUP pre-flight](../../SKILL.md) for composite invocation contract.