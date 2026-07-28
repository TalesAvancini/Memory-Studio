---
date: 2026-07-26
version: 1
description: "Os 8 lenses do auto-grill — o que cada um caça, critério de exaustão, e como o Interrogator cicla entre eles."
explanation: "Cada lens é uma perspectiva de questionamento. O Interrogator cicla pelos 8 até cada um bater seu critério de exaustão. Lenses têm origem mista: Pocock (implícitos), NotebookLM brainstorm (Fog of War / Semantic Anchors / Tracer Bullets), Memory Studio PLAN §6 (Cache Determinism / Hot-Path Purity)."
related:
  - ../SKILL.md
  - ./02-flow.md
  - ./04-confidence.md
mermaid_count: 1
---

# 03 — Lenses

## Resumo

O Interrogator tem **8 lenses** que ele cicla durante a Phase 2 (INTERROGATION). Cada lens tem:

- **O que caça** — o tipo de gap/problema que a pergunta busca expor.
- **Critério de exaustão** — quando o orchestrator sabe que esse lens está "done" e pode passar pro próximo.
- **Origem** — de onde veio a ideia (Pocock / NotebookLM brainstorm / Memory Studio).

O Interrogator **NÃO** segue os lenses em ordem fixa; ele escolhe baseado no que sobrou da última round. Fog of War tem prioridade porque é o que detecta branches não-resolvidas.

## Diagrama

```mermaid
flowchart TB
    start([Phase 2 loop start]) --> pick_lens

    pick_lens{Pick lens<br/>priorities:<br/>Fog of War ><br/>Semantic Anchors ><br/>Tracer Bullets ><br/>others}

    pick_lens -->|remaining branches| fog[Fog of War<br/>unresolved branches,<br/>unsupported assumptions]
    pick_lens -->|terms not in glossary| sem[Semantic Anchors<br/>vocabulary hallucination risk]
    pick_lens -->|decisions w/o slice| trc[Tracer Bullets<br/>no demoable vertical slice]
    pick_lens -->|cache key concerns| cache[Cache Determinism<br/>byte-stable cache identity]
    pick_lens -->|IO/network concerns| hot[Latency / Hot-Path Purity<br/>fetch/await in hot path]
    pick_lens -->|boundary inputs| edge[Edge Cases<br/>empty, race, dedup]
    pick_lens -->|conflicting claims| ctr[Contradictions<br/>disagreement w/in doc]
    pick_lens -->|modals open| vag[Vague Decisions<br/>should/may/could]

    fog -->|exhausted:<br/>no unresolved branches| pick_lens
    sem -->|exhausted:<br/>all terms anchored| pick_lens
    trc -->|exhausted:<br/>all decisions have slice| pick_lens
    cache -->|exhausted:<br/>all cache inputs deterministic| pick_lens
    hot -->|exhausted:<br/>static guard passes| pick_lens
    edge -->|exhausted:<br/>WHEN/THEN per branch| pick_lens
    ctr -->|exhausted:<br/>no 2 sections disagree| pick_lens
    vag -->|exhausted:<br/>no modals left| pick_lens

    pick_lens -.->|"all 8 exhausted<br/>or --max-rounds"| end_loop([Phase 2 done])

    style fog fill:#ffebee,stroke:#c62828
    style sem fill:#fff3e0,stroke:#ef6c00
    style trc fill:#f3e5f5,stroke:#6a1b9a
    style cache fill:#e8f5e9,stroke:#2e7d32
    style hot fill:#e8f5e9,stroke:#2e7d32
    style edge fill:#e3f2fd,stroke:#1565c0
    style ctr fill:#fce4ec,stroke:#ad1457
    style vag fill:#fce4ec,stroke:#ad1457
```

## Os 8 lenses em detalhe

| # | Lens | O que caça | Critério de exaustão | Origem |
|---|------|------------|----------------------|--------|
| 1 | **Fog of War** | Branches sem resposta, premissas sem suporte | 0 unresolved branches | NotebookLM brainstorm 2026-07-26 |
| 2 | **Semantic Anchors** | Termos não presentes em `CONTEXT.md` | Todos os termos do target são glossary-backed OU flagged | NotebookLM brainstorm 2026-07-26 |
| 3 | **Tracer Bullets** | Decisões que não traçam a uma vertical slice demoável | Toda decisão tem "→ slice: <demo>" | NotebookLM brainstorm + Waldemar |
| 4 | **Cache Determinism** | Decisões que quebram byte-stable cache identity (Memory Studio hot path) | Todos os inputs do cache key são determinísticos + sortáveis | Memory Studio PLAN §6 |
| 5 | **Latency / Hot-Path Purity** | Qualquer coisa que adicione `fetch()` / `await` / IO no hot path | Static guard test passa nos arquivos tocados | Memory Studio PLAN §6 |
| 6 | **Edge Cases** | Empty inputs, boundaries, races, dedup | Cada branch tem "WHEN X é edge, THEN Y" explícito | `tlc-spec-driven` discipline |
| 7 | **Contradictions** | Claims conflitantes dentro do doc | Nenhuma 2 seções discordam do mesmo fato | Pocock (implícito) |
| 8 | **Vague Decisions** | "should/may/could" sem commitment | Todos os modais viraram escolha explícita ou foram removidos | Pocock "fechar todos os ramos" |

## Fluxos chave (PT-BR)

### Priorização

O orchestrator **não** visita os lenses em ordem 1→8. A cada round, ele pergunta:

1. Fog of War tem branches abertas? → perguntar sobre isso
2. Senão, Semantic Anchors tem termos não-flagged? → perguntar
3. Senão, Tracer Bullets tem decisão sem slice? → perguntar
4. Senão, cicla pelos outros 5 lenses

Isso garante que **risco estrutural** (Fog of War) é tratado antes de **risco cosmético** (Vague Decisions).

### O que cada lens NÃO faz

- Fog of War NÃO inventa respostas — só detecta gaps e gera research tickets.
- Semantic Anchors NÃO adiciona termos ao glossário — só flagga os ausentes.
- Tracer Bullets NÃO cria slices — só verifica se as decisões existentes traçam.
- Cache Determinism NÃO roda o cache — só raciocina sobre o formato da chave.
- Hot-Path Purity NÃO executa o guard — só checa estaticamente o que o guard cobriria.
- Edge Cases NÃO escreve testes — só verifica que as branches estão documentadas.
- Contradictions NÃO edita o doc — só flagga conflitos pra você resolver.
- Vague Decisions NÃO escolhe entre opções — só flagga modais abertos.

### Quando parar de ciclar

- Todos os 8 lenses bateram seu critério de exaustão → Phase 2 done.
- `--max-rounds` cap atingido (default 50) → halt Dumb Zone.
- Transcript >100k tokens → halt Dumb Zone (mesmo tratamento).

## Por que 8 lenses (e não menos)?

| Tentativa | Risco |
|---|---|
| 3 lenses (Fog/Contradictions/Vague) | Cobre gaps textuais mas ignora semântica (Anchors), demoability (Tracer), e hot-path (Cache/IO). Auto-grill vira "grill-with-docs sem HITL". |
| 12 lenses | Lens creep. Cada lens novo adiciona rounds; lenses redundantes entre si (ex: Vague Decisions ⊂ Contradictions em alguns casos). |

8 cobre os 4 eixos: **texto** (Fog, Contradictions, Vague), **semântica** (Anchors), **execucionabilidade** (Tracer, Edge), **domínio Memory Studio** (Cache, Hot-Path).

## Ver também

- [02-flow.md](02-flow.md) — onde os lenses vivem no flow geral.
- [04-confidence.md](04-confidence.md) — como exaustão incompleta afeta o confidence de uma decisão.
- [08-critical-rules.md](08-critical-rules.md) — regra 7 (lens exhaustion ≠ permission to skip).
- [SKILL.md §Lenses](../SKILL.md) — fonte canônica.