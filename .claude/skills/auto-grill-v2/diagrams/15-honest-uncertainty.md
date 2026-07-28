---
date: 2026-07-28
version: 1
description: "Diagrama do caminho Honest Uncertainty (R11) do auto-grill v2 — quando Proxy retorna low/medium, decision tree mostra: dispatch Insight Researcher (1-shot, bounded) → append research note → escalate to gate com ambos visíveis."
explanation: |
  Mostra o caminho NOVO que o v2 adiciona ao v0.2. Diferença-chave: research é
  insight, não fix. Confidence original NÃO é inflada. Human gate vê finding +
  research note + ambas confidences — sem hidden work.

  Estrutura:
  - Top: state machine do loop (herdado de v0.2)
  - Middle: decision tree no nó Check_Confidence (extensão v2)
  - Bottom: exemplo concreto de saída do gate (finding + research note)

  Resolve: "como o v2 lida com baixa confiança SEM virar theater?".
related:
  - ../SKILL.md
  - ./11-round-protocol.md
  - ./12-orchestrator-handoff.md
  - ./08-critical-rules.md
mermaid_count: 3
---

# 15 — Honest Uncertainty path (R11) — auto-grill v2

## Resumo

Este diagrama é a **única adição comportamental** do auto-grill v2 em relação ao v0.2. Tudo o mais (lenses, SETUP, sub-agent discrimination, gate contract) é herdado. O que muda é o que o orchestrator faz quando o Stakeholder Proxy retorna `low` ou `medium` confidence.

**v0.2 (sem flag):** `conf < floor` → escalate to human (blind).
**v2 (com `--auto-research-insight`):** `conf < floor` → dispatch Insight Researcher (1-shot) → append research note → escalate to human WITH context.

**Invariante crítica:** research NÃO modifica o confidence original. Human gate vê `conf=low` + research note (com seu próprio `INSIGHT_CONFIDENCE`) lado a lado. Sem inflation, sem hidden work.

---

## Diagrama 1: State machine com Honest Uncertainty path

```mermaid
stateDiagram-v2
    [*] --> SETUP
    SETUP --> Round : pre-flight OK
    SETUP --> [*] : CONTEXT.md missing (R9 abort)

    state Round {
        [*] --> DispatchInterrogator
        DispatchInterrogator --> EmitQuestion
        EmitQuestion --> DispatchProxy
        DispatchProxy --> CheckConfidence

        state CheckConfidence <<choice>>
        CheckConfidence --> Accept : conf >= floor
        CheckConfidence --> DispatchResearcher : conf < floor<br/>(+ --auto-research-insight)
        CheckConfidence --> EscalateDirect : conf < floor<br/>(flag OFF)

        DispatchResearcher --> CheckResearchConfidence
        CheckResearchConfidence --> AppendNote : any insight
        CheckResearchConfidence --> RecordUncertainty : NO_EVIDENCE
        AppendNote --> EscalateWithContext
        RecordUncertainty --> EscalateWithContext

        EscalateDirect --> [*]
        EscalateWithContext --> [*]
        Accept --> [*]
    }

    Round --> Round : lens not exhausted
    Round --> ArtifactPack : lens exhausted
    Round --> DumbZone : tokens >= 100k OR rounds >= --max-rounds

    ArtifactPack --> Gate
    DumbZone --> [*] : halt + summary

    Gate --> [*] : human approves / rejects
```

**Leitura:** o nó `CheckConfidence` tem 3 saídas no v2 (vs 2 no v0.2). A saída do meio (DispatchResearcher) só é tomada quando o flag está ON. Caso contrário, cai direto em `EscalateDirect` (comportamento v0.2).

---

## Diagrama 2: Decision tree no CheckConfidence (v2)

```mermaid
flowchart TB
    Start[Proxy returned<br/>conf &lt; floor]

    FlagCheck{--auto-research-insight<br/>flag ON?}
    FlagCheck -->|No| EscalateDirect[Escalate to human<br/>v0.2 behavior]
    FlagCheck -->|Yes| CapCheck

    CapCheck{research count for<br/>this finding &lt;<br/>--max-research-per-finding?}
    CapCheck -->|No| EscalateDirect
    CapCheck -->|Yes| Dispatch[Dispatch Insight Researcher<br/>1-shot, informational]

    Dispatch --> Research{Researcher<br/>returned?}

    Research -->|Insight found| AppendNote[Append to decisions.md:<br/>finding + research note<br/>+ both confidences]
    Research -->|NO_EVIDENCE| RecordGap[Record gap:<br/>finding + 'could not find Z'<br/>+ both confidences low]

    AppendNote --> Gate[Escalate to human gate<br/>WITH research context]
    RecordGap --> Gate

    EscalateDirect --> GateBlind[Escalate to human gate<br/>WITHOUT research context]

    style Dispatch fill:#e3f2fd,stroke:#1976d2
    style AppendNote fill:#e8f5e9,stroke:#388e3c
    style RecordGap fill:#fff3e0,stroke:#f57c00
    style EscalateDirect fill:#ffebee,stroke:#c62828
    style Gate fill:#e8f5e9,stroke:#388e3c
    style GateBlind fill:#ffebee,stroke:#c62828
```

**Leitura:**

- **Azul:** o novo caminho (Insight Researcher dispatch).
- **Verde:** chegada bem-sucedida ao gate COM contexto.
- **Laranja:** gap honesto (research também não achou).
- **Vermelho:** comportamento herdado do v0.2 (escalation cega).

**Invariante:** o nó final é sempre `Gate` (humano decide). O que muda é **com quanto contexto** o humano chega ao gate.

---

## Diagrama 3: Saída do gate — finding + research note lado a lado

```mermaid
flowchart LR
    subgraph DecisionsRow[decisions.md row #N]
        direction LR
        Col1["#: 7"]
        Col2["Lens: Cache Determinism"]
        Col3["Decision: spec missing<br/>tiebreak for RRF ties"]
        Col4["Conf: baixa ⚠"]
        Col5["Research Note:<br/>'WebSearch no canonical<br/>guidance; 3 secondary<br/>sources; spec gap real'"]
        Col6["Insight Conf: low"]
    end

    subgraph ResearchFile[research.md section #N]
        direction TB
        Original["Original finding (conf: baixa):<br/>spec missing tiebreak"]
        Insight["Insight Researcher note (conf: low):<br/>NO_EVIDENCE for canonical RRF tiebreak.<br/>WebSearch 'RRF tiebreak':<br/>- Source A: blog post (secondary)<br/>- Source B: blog post (secondary)<br/>- Source C: blog post (secondary)<br/>No official doc / RFC / paper found."]
        Sources["Sources cited:<br/>(none primary)"]
    end

    subgraph Gate[Human gate sees]
        direction TB
        Both[Finding + Research + Both confidences<br/>= full epistemic context]
        DecisionPath{Human decides}
        DecisionPath --> Approve[Approve<br/>'accept gap as known limitation'"]
        DecisionPath --> Reject[Reject<br/>'spec must add tiebreak<br/>before any implementation'"]
        DecisionPath --> Loop[Loop branch<br/>'more rounds on cache lens'"]
    end

    DecisionsRow --> Gate
    ResearchFile --> Gate

    style Col4 fill:#ffebee,stroke:#c62828
    style Col6 fill:#ffebee,stroke:#c62828
    style Insight fill:#fff3e0,stroke:#f57c00
    style Both fill:#e8f5e9,stroke:#388e3c
```

**Leitura:** o gate recebe **dois sinais** (decisions.md row + research.md section), ambos com suas próprias confidences. Nenhum é escondido. Nenhum é inflado. O humano decide com base em **evidência visível**, não em signal artificial de confidence.

---

## Por que isso NÃO é theater

| Theater mode | Honest Uncertainty mode |
|---|---|
| Research tenta resolver → confidence sobe → find "fechado" | Research documenta o gap → confidence fica low → find fica low + note |
| Research loopa até cap tentando ficar "certo" | Research é 1-shot bounded; researcher também pode retornar `NO_EVIDENCE` |
| Human gate vê "conf=high, all green" | Human gate vê `conf=low + research: "couldn't find X"` lado a lado |
| Verifier que "sabe tudo" via back-channel | Verifier que admite o que não sabe; traz contexto sem fingir |

A diferença é **epistemológica**, não procedural. O diagrama é o mesmo (decision tree), o que muda é a **atitude do verifier**: admitir em vez de resolver.

---

## Ver também

- [SKILL.md §Round Protocol — Honest Uncertainty path](../SKILL.md) — prosa canônica.
- [SKILL.md §Critical rules — R11](../SKILL.md) — regra estrutural.
- [prompts/insight-researcher.md](../prompts/insight-researcher.md) — sub-agent prompt template.
- [diagrams/08-critical-rules.md](./08-critical-rules.md) — diagram de risks/defenses (R11 entra aqui quando v0.2 virar default).
- [diagrams/11-round-protocol.md](./11-round-protocol.md) — round protocol herdado de v0.2.