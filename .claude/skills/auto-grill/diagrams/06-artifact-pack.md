---
date: 2026-07-26
version: 1
description: "Os 4 artefatos do Artifact Pack — quando cada um é escrito, o que contém, e como o human gate usa cada um."
explanation: "Captura os outputs do auto-grill como 4 arquivos com propósitos distintos. Transcript = auditoria completa. Decisions = superfície humana. Loop-state = resume. Discoveries = integração com farol. Cada um tem schema fixo e momento de escrita bem definido."
related:
  - ../SKILL.md
  - ./02-flow.md
  - ./04-confidence.md
  - ./07-loop-state.md
mermaid_count: 1
---

# 06 — Artifact Pack

## Resumo

Ao final da Phase 4 (ARTIFACT PACK), o orchestrator escreve **4 arquivos** com propósitos distintos:

| Arquivo | Propósito | Quem lê |
|---------|-----------|---------|
| `<target>.auto-grill.transcript.md` | Log completo A2A, audit-grade | Auditoria, você quando quiser drill down |
| `<target>.auto-grill.decisions.md` | Tabela pergunta × decisão × confidence | **Você no human gate** |
| `<target>.auto-grill.loop-state.json` | Estado de resume | Próxima invocação (ou `--resume`) |

**Composite target:** nome do arquivo vira `<doc1>-<doc2>.auto-grill.*.md` (ex: `PRD-PLAN.auto-grill.transcript.md`). Interrogator/Proxy citam `path:line` em ambos docs.
| `.specs/DISCOVERIES.md` (append) | Gaps / contradições / termos fora do glossário | Farol (`tlc-roadmap-loop` step 8b) |

## Diagrama

```mermaid
flowchart TB
    subgraph IN[Inputs to the loop]
        target[Target doc]
        ctx[CONTEXT.md]
        adr[docs/adr/*.md]
        scr[".scratch/"]
        farol[".specs/ARCHITECTURE.md<br/>(stable IDs)"]
    end

    subgraph LOOP[Loop runs N rounds<br/>Phase 2 INTERROGATION]
        orch[Orchestrator]
    end

    subgraph OUT[Artifact Pack — written at Phase 4]
        direction TB
        T["<target>.auto-grill.transcript.md<br/>(or &lt;doc1&gt;-&lt;doc2&gt; slug if composite)<br/>━━━━━━━━━━━━━━━<br/>Full A2A log (round-by-round)<br/>+ lens tags + timestamps<br/>+ recommendation + answer<br/>+ confidence per round"]
        D["<target>.auto-grill.decisions.md<br/>(or &lt;doc1&gt;-&lt;doc2&gt; slug if composite)<br/>━━━━━━━━━━━━━━━<br/>TABLE: # × Lens × Q × Decision<br/>× Analogy × Tracer × Conf<br/>+ Rejected items list<br/>+ Research tickets (AFK)"]
        L["<target>.auto-grill.loop-state.json<br/>(or &lt;doc1&gt;-&lt;doc2&gt; slug if composite)<br/>━━━━━━━━━━━━━━━<br/>last_decision, current_lens<br/>transcript_size, rejected_branches<br/>decisions_count, confidence_floor"]
        DISC[".specs/DISCOVERIES.md (append)<br/>━━━━━━━━━━━━━━━<br/>Gaps found<br/>Contradictions w/in doc<br/>Terms not in glossary<br/>Farol stable ID mismatches"]
    end

    subgraph CONSUMERS[Who consumes each]
        direction TB
        you["Você<br/>(human gate)"]
        audit["Auditoria<br/>(futuro)"]
        resume["Próxima invocação<br/>(auto-grill --resume)"]
        farol_pipe["tlc-roadmap-loop<br/>step 8b (discovery surface)"]
    end

    IN --> LOOP
    LOOP --> T
    LOOP --> D
    LOOP --> L
    LOOP --> DISC

    D ==> you
    T ==> you
    T ==> audit
    L ==> resume
    DISC ==> farol_pipe

    style OUT fill:#e3f2fd,stroke:#1e88e5
    style CONSUMERS fill:#fff3e0,stroke:#fb8c00
```

## Schema do `decisions.md` (o que você vê no gate)

```markdown
# Auto-Grill Decisions — <target path>

**Date:** <ISO>
**Confidence floor:** <0.7>
**Rounds run:** <N>
**Outcome:** <approved | pending-human | halted-dumb-zone>

| # | Lens | Pergunta | Decisão | Analogia (não-especialista) | Tracer Bullet | Confiança |
|---|------|----------|---------|----------------------------|---------------|-----------|
| 1 | Fog of War | <pergunta> | <resposta do Proxy> | <analogia em 1 frase> | → slice: <demo> | alta |
| 2 | Tracer Bullets | ... | ... | ... | ... | média |
| 3 | Semantic Anchors | ... | ... | ... | ... | baixa ⚠ escalate |

## Rejected items (restart loop with focus)
- <#5 — Vague Decisions: "should consider cache" → force explicit choice>

## Research tickets (AFK)
- <RT-1: confirm whether hot-path allows fetch() in error path>
```

## Schema do `loop-state.json`

```json
{
  "target": "<absolute path>",
  "started_at": "<ISO>",
  "last_round": 7,
  "current_lens": "Semantic Anchors",
  "transcript_size_tokens": 4321,
  "confidence_floor": 0.7,
  "decisions_count": 7,
  "decisions": [
    { "round": 1, "lens": "Fog of War", "question": "...", "answer": "...", "confidence": "high" },
    ...
  ],
  "rejected_branches": [],
  "halt_reason": null
}
```

## Schema do `transcript.md` (resumido)

Cada round vira uma seção:

```markdown
## Round N — <Lens>

**Question:** <pergunta>
**Recommendation:** <recomendação do Interrogator>
**Answer:** <resposta do Proxy>
**Evidence:** <path:line OR CONTEXT.md entry>
**Confidence:** <high | medium | low>
**Confidence numeric:** <0.0 - 1.0>
**Floor check:** <pass | escalate>
```

## Schema do `DISCOVERIES.md` (append)

```markdown
## <ISO> — <lens or agent> — <severity>

**Title:** <short title>
**Location:** <target doc section or stable ID>
**Detail:** <what's missing / contradicting / out-of-glossary>
**Suggested action:** <research ticket OR human review>
```

## Quando cada arquivo é escrito

| Momento | Arquivo |
|---------|---------|
| A cada round (incremental) | `transcript.md` (append), `loop-state.json` (overwrite) |
| A cada decisão (incremental) | `decisions.md` (append row) |
| Phase 4 (final) | Todos consolidados; `DISCOVERIES.md` append (se houver) |
| Antes de qualquer halt | `loop-state.json` (overwrite, halt_reason preenchido) |

## Por que 4 arquivos (e não 1)?

| Tentativa | Falha |
|---|---|
| 1 arquivo (transcript = decisions = state) | Você não consegue ler só as decisões sem abrir o transcript inteiro; resume precisa parsear o mesmo arquivo. |
| 6 arquivos (separar rejected, research tickets, etc.) | Granularidade excessiva. Os rejeitados e tickets vivem dentro de `decisions.md` como seções. |

4 arquivos captura a separação real: **humano-facing** (decisions) vs **audit-grade** (transcript) vs **machine-facing** (loop-state) vs **farol-facing** (discoveries).

## Ver também

- [02-flow.md](02-flow.md) — Phase 4 é onde o pack é escrito.
- [04-confidence.md](04-confidence.md) — schema do `decisions.md` deriva do scoring.
- [07-loop-state.md](07-loop-state.md) — o contrato do `loop-state.json`.
- [SKILL.md §Outputs](../SKILL.md) — fonte canônica.