---
date: 2026-07-26
version: 1
description: "Pipeline de confidence scoring — como cada decisão recebe high/medium/low e a regra hard do floor 0.7."
explanation: "Captura o caminho que cada resposta do Proxy percorre até virar uma decisão com nível de confidence. Mostra que NO_EVIDENCE nunca vira alta confiança, e que o floor 0.7 é estrutural (não advisory) — decisões abaixo disparam escalate obrigatório, sem auto-resolução."
related:
  - ../SKILL.md
  - ./03-lenses.md
  - ./08-critical-rules.md
mermaid_count: 1
---

# 04 — Confidence Scoring

## Resumo

Cada resposta do Proxy vira uma **decisão** com um **nível de confidence** (high / medium / low). O nível é função de 4 critérios combinados: presença de evidência, cobertura do lens, contradições internas, e existência de tracer bullet concreto.

**Regra hard:** qualquer decisão com confidence < `confidence_floor` (default 0.7) → **ESCALATE obrigatório ao humano, sem auto-resolução**. Esse é o tripwire que ataca o "Risco de Autoconfirmação" flagado pelo NotebookLM brainstorm.

## Diagrama

```mermaid
flowchart LR
    Q["Question from<br/>Interrogator<br/>(round N)"] --> A["Proxy answer<br/>(round N)"]

    A --> E{Has evidence?<br/>cite path:line<br/>or CONTEXT.md}

    E -->|NO| NO["NO_EVIDENCE<br/>confidence = low<br/>+ research ticket"]
    E -->|YES| CITE["Cite evidence<br/>verbatim quote"]

    CITE --> L{Lens coverage<br/>complete?<br/>exhaustion criterion met}

    L -->|NO| LOW["Low confidence<br/>+ append research ticket"]
    L -->|YES| CTR{Any contradiction<br/>within doc?}

    CTR -->|YES| MED["Medium confidence<br/>with caveat<br/>'assumes X holds'"]
    CTR -->|NO| TRC{Tracer bullet<br/>concrete?<br/>→ slice: demo}

    TRC -->|NO| MED
    TRC -->|YES| HIGH["High confidence<br/>~0.9 - 1.0"]

    NO --> FLOOR{floor check<br/>default 0.7}
    LOW --> FLOOR
    MED --> FLOOR
    HIGH --> FLOOR

    FLOOR -->|"< 0.7"| ESC["ESCALATE to human<br/>no auto-resolve<br/>flag in decisions.md"]
    FLOOR -->|"≥ 0.7"| OK["Decision logged<br/>in decisions.md<br/>+ transcript.md"]

    style NO fill:#ffebee,stroke:#c62828
    style LOW fill:#ffebee,stroke:#c62828
    style MED fill:#fff3e0,stroke:#ef6c00
    style HIGH fill:#e8f5e9,stroke:#2e7d32
    style ESC fill:#fce4ec,stroke:#ad1457
    style OK fill:#e3f2fd,stroke:#1565c0
```

## Os 4 critérios (em ordem de avaliação)

| # | Critério | Se falha | Confidence |
|---|----------|----------|------------|
| 1 | **Has evidence** (cite verbatim) | NO_EVIDENCE → low | sempre low |
| 2 | **Lens coverage** (exaustão) | ainda há branches | low |
| 3 | **No contradiction** within doc | 2 seções discordam | medium (com caveat) |
| 4 | **Tracer bullet** concreto | decisão sem "→ slice" | medium (com caveat) |

Só passa pra "high" quem **passa nos 4**.

## Mapping nível → score numérico

| Nível | Faixa | Significado |
|-------|-------|-------------|
| **High** | 0.9 – 1.0 | Ancorado em CONTEXT.md/ADR + tracer bullet + zero contradições |
| **Medium** | 0.7 – 0.9 | Ancorado mas com caveat explícito |
| **Low** | < 0.7 | Branch não resolvida, termo fora do glossário, ou Dumb Zone |

**Floor padrão: 0.7.** Ajustável via `--confidence-floor`. Subir o floor (ex: 0.85) = mais escalações, menos auto-resolução. Baixar (ex: 0.5) = mais permissivo, mas perde a defesa contra autoconfirmação.

## Por que o floor é hard, não advisory?

| Tentativa | Falha |
|---|---|
| Advisory floor ("log but proceed") | O orchestrator vai proceder toda vez que a decisão "parecer" boa o suficiente. O floor vira teatro. |
| Confidence = média das 4 | Mascara problemas: 1 critério "high" + 3 "low" ainda daria uma média aceitável, mas a decisão não é ancorada. |

Hard floor = se **qualquer** dos 4 critérios falha abaixo do limite, ESCALATE. Não tem média, não tem compensação.

## O que o human gate vê

A tabela `decisions.md` mostra o nível por linha. Linhas com confidence < floor vêm flagged com `⚠ escalate`. Você pode:

- **Aprovar mesmo flagged** (override humano) — registra no `loop-state.json`.
- **Rejeitar flagged** — volta pro loop focado na branch.
- **Não ver flagged** (passar pelo gate sem notar) — você perdeu o jogo, conforme o SKILL.md §Why this matters.

## Ver também

- [03-lenses.md](03-lenses.md) — o que é "lens coverage complete".
- [08-critical-rules.md](08-critical-rules.md) — regra R4 (floor hard).
- [SKILL.md §Confidence scoring](../SKILL.md) — fonte canônica.