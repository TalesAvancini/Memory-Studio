---
date: 2026-07-26
version: 2
description: "Relacionamento do auto-grill com skills companheiras — quando usar qual, e como downstream elas se integram (incluindo to-roadmap)."
explanation: "Mapa de skills vizinhas: variantes síncronas (grill-me, grill-with-docs, grilling) que o auto-grill substitui async; downstream (to-spec, to-roadmap, to-tickets, implement) que recebem as decisões aprovadas; siblings (code-review, simplify) que cobrem superfícies diferentes (código, não docs); base SDD (tlc-spec-driven) que vem depois."
related:
  - ../SKILL.md
  - ./02-flow.md
  - ./06-artifact-pack.md
  - ../prompts/to-roadmap.md
mermaid_count: 1
---

# 09 — Companion Skills

## Resumo

O auto-grill **não opera sozinho**. Tem 4 tipos de skills vizinhas:

1. **Variantes síncronas** que ele substitui (grill-me, grill-with-docs, grilling) — use quando quiser estar no loop.
2. **Downstream** que recebem o Artifact Pack aprovado em cadeia (to-spec → **to-roadmap** → to-tickets → implement) — após você aprovar no gate.
3. **Sibling/base** que cobrem superfícies diferentes (code-review, simplify, domain-modeling).
4. **Base SDD** (tlc-spec-driven) que executa após o chain downstream.

A escolha principal é: **você quer estar na linha de frente ou revisar async?**

## Diagrama

```mermaid
flowchart TB
    subgraph CORE[Você está aqui]
        autogrill["auto-grill<br/>━━━━━━━━<br/>autonomous doc review<br/>2 sub-agents + human gate<br/>Artifact Pack async"]
    end

    subgraph SYNC[Variantes síncronas — você no loop]
        direction TB
        grillme["mattpocock-skills:grill-me<br/>━━━━━━━━<br/>user-invoked HITL<br/>40-100 perguntas uma-a-uma<br/>output: conversation history"]
        grillwd["mattpocock-skills:grill-with-docs<br/>━━━━━━━━<br/>user-invoked HITL<br/>+ atualiza CONTEXT.md / ADRs<br/>output: conversation + docs"]
        grilling["mattpocock-skills:grilling<br/>━━━━━━━━<br/>model-invoked loop<br/>description no context<br/>output: shared understanding"]
    end

    subgraph DOWN[Downstream — após gate aprovado]
        direction TB
        tospec["mattpocock-skills:to-spec<br/>━━━━━━━━<br/>sintetiza Artifact Pack<br/>em spec formal<br/>(NÃO PRD estrito)"]
        toroadmap["prompts/to-roadmap<br/>(project-local)<br/>━━━━━━━━<br/>extrai .specs/ROADMAP.md<br/>da SPEC"]
        totickets["mattpocock-skills:to-tickets<br/>━━━━━━━━<br/>quebra spec em<br/>vertical slices (tickets)"]
        implement["mattpocock-skills:implement<br/>━━━━━━━━<br/>TDD + code-review<br/>ticket por ticket"]
    end

    subgraph BASE[Base / Sibling — superfícies diferentes]
        direction TB
        tlc["tlc-spec-driven<br/>━━━━━━━━<br/>SDD feature planning<br/>(Planner/Impl/Verifier)<br/>executa o roadmap"]
        review["mattpocock-skills:code-review<br/>━━━━━━━━<br/>revisão de DIFF, não doc<br/>2 eixos: Standards + Spec"]
        simplify["simplify<br/>━━━━━━━━<br/>reuso + simplificação<br/>de código, não docs"]
        dm["mattpocock-skills:domain-modeling<br/>━━━━━━━━<br/>mantém CONTEXT.md / ADRs<br/>fresh entre runs"]
    end

    autogrill -. "substitui async" .-> grillme
    autogrill -. "substitui async" .-> grillwd
    grilling -. "lighter weight<br/>model-invoked" .-> autogrill

    autogrill ==>|"transcript.md<br/>(load antes<br/>de to-spec)"| tospec
    tospec ==>|"spec no<br/>issue tracker"| toroadmap
    toroadmap ==>|"ROADMAP.md"| totickets
    totickets ==>|"tickets.md"| implement

    dm -. "alimenta CONTEXT.md<br/>(pré-requisito)" .-> autogrill
    review -. "para código, não docs" .-> autogrill
    simplify -. "para código, não docs" .-> autogrill

    style autogrill fill:#fff3e0,stroke:#fb8c00
    style SYNC fill:#f3e5f5,stroke:#8e24aa
    style DOWN fill:#e3f2fd,stroke:#1e88e5
    style BASE fill:#f5f5f5,stroke:#616161
```

## Quando usar qual — árvore de decisão

```
Você tem um doc pra revisar?
│
├─ Quer estar no loop (sentir cada branch)?
│  └─ SIM → mattpocock-skills:grill-me
│           (síncrono, 40-100 perguntas)
│
└─ NÃO → Quer batch async + Artifact Pack?
    │
    ├─ SIM, e doc é técnico (precisa CONTEXT.md/ADRs)
    │  └─ mattpocock-skills:grill-with-docs
    │       (HITL mas mantém docs vivos)
    │
    └─ SIM, e tá OK ler decisions.md em vez de transcript
       └─ auto-grill ← VOCÊ ESTÁ AQUI
           (zero HITL, gate só no fim)
```

## Integração downstream (5 passos)

```
auto-grill (decisions.md aprovado)
        │
        ▼
mattpocock-skills:to-spec
        │  sintetiza decisões em spec formal
        │  (NÃO PRD estrito — spec é mais amplo)
        ▼
prompts/to-roadmap (project-local)
        │  extrai .specs/ROADMAP.md da SPEC
        │  append, não overwrite; SUBCHAPTER_BREAKDOWN se >15 sub-itens
        ▼
mattpocock-skills:to-tickets
        │  quebra spec em vertical slices (NÃO tarefas pra criar a spec)
        ▼
mattpocock-skills:implement
        │  TDD + code-review por ticket
        ▼
Verifier PASS → ticket done
```

Auto-grill **NÃO** faz nenhuma transição sozinho. Após aprovar todas as decisões no gate, você (humano) invoca `to-spec` → `to-roadmap` → `to-tickets` → `implement` **manualmente**. Isso é intencional — o gate é o portão, não uma rampa automática.

**Detalhe de nomenclatura (Matt Pocock v1.1):**
- `to-prd` foi renomeado → `to-spec` (PRD era restritivo demais; spec cobre técnico + não-técnico + blend).
- `to-issues` foi renomeado → `to-tickets` (issues era GitHub/Linear-bias; tickets é genérico).

## Relação com `tlc-spec-driven`

São complementares, não sobrepostos:

| Skill | Quando |
|---|---|
| `auto-grill` | **Antes** de uma phase começar — você grila o spec.md / design.md antes de commitar |
| `prompts/to-roadmap` | **Depois** de `to-spec`, antes de `to-tickets` — gera o roadmap canônico |
| `tlc-spec-driven` | **Durante** a phase — Planner/Implementer/Verifier executam o trabalho |

Regra prática: rode `auto-grill` no `spec.md` da próxima phase antes de invocar o loop. Se a phase já está `[ ]` no roadmap, é tarde — rode retroativamente pra cobrir lacunas.

## Relação com `code-review`

São de superfícies diferentes:

| Skill | Lê | Saída |
|---|---|---|
| `auto-grill` | doc (spec, design, plan) | decisions table |
| `code-review` | diff (commit range) | 2-axis review (Standards + Spec) |

Use `auto-grill` quando você quer revisar **o que foi decidido**. Use `code-review` quando você quer revisar **o que foi implementado**.

## Por que auto-grill não substitui `grill-with-docs` completamente?

| Auto-grill | grill-with-docs |
|---|---|
| Gate só no fim (você aprova async) | HITL síncrono (você responde cada pergunta) |
| Lê CONTEXT.md, **não atualiza** | Lê E atualiza CONTEXT.md / ADRs inline |
| Stack: zero attention cost | Stack: 40-100 attention turns |
| Output: 4 files structured | Output: conversation + updated docs |

`grill-with-docs` ainda é melhor quando:
- O design tension é o ponto (você QUER sentir cada branch)
- O doc precisa ser editado durante a sessão (CONTEXT.md ganha termos novos)
- A interação é rápida (você responde em < 5s por pergunta)

Auto-grill ganha quando você tem 3-4 docs pra revisar antes de um phase, e não pode sincronamente atender 300+ perguntas.

## Ver também

- [SKILL.md §Companion skills](../SKILL.md) — lista canônica.
- [02-flow.md](02-flow.md) — Phase 5 (HUMAN GATE) é onde você decide se vai pra `to-spec`.
- [06-artifact-pack.md](06-artifact-pack.md) — `decisions.md` é o input do `to-spec`.
- [../prompts/to-roadmap.md](../prompts/to-roadmap.md) — prompt template que preenche o gap entre `to-spec` e `to-tickets`.
- [../assets/decisions-ui.html](../assets/decisions-ui.html) — UI standalone pro gate (batches com 40+ decisões).