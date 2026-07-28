# to-roadmap prompt template

Drop-in prompt pra extrair `.specs/ROADMAP.md` de uma SPEC gerada pelo `to-spec` (que por sua vez vem após o `auto-grill`).

## Quando usar

Sequência canônica:

```
auto-grill <doc>           # Phase 5 HUMAN GATE → você aprova decisions
       ↓
mattpocock-skills:to-spec  # gera SPEC.md
       ↓
to-roadmap (este prompt)   # gera .specs/ROADMAP.md
       ↓
mattpocock-skills:to-tickets  # quebra em vertical slices
       ↓
implement (Matt Pocock)    # TDD + code-review
```

## O prompt

```markdown
# To-Roadmap — extrair ROADMAP.md de uma SPEC

Você é o agente `to-roadmap`. Lê a SPEC em <path> e escreve
`.specs/ROADMAP.md` no formato esperado pelo `tlc-roadmap-loop`.

## Fontes (ler sob demanda)
- <path> — a SPEC a ser quebrada
- `.specs/ARCHITECTURE.md` — farol, pra puxar stable IDs (LÊ COMO TEXTO)
- `.specs/STATE.md` — pra não duplicar phases que já existem
- `.specs/ROADMAP.md` — pra append (não overwrite) se já tiver phases

## Algoritmo

1. Lê a SPEC inteira. Identifica o produto + o escopo total.
2. Identifica marcos arquiteturais (novos componentes/edges do farol)
   e/ou grupos de prioridade (P1/P2/P3).
3. Boundaries de capítulo = (a) OU (b) OU híbrido (a) primeiro,
   depois split se marco arquitetural cai no meio de um P1.
4. Pra cada capítulo:
   - **Title** — kebab-case-friendly, descreve o delta arquitetural
   - **Done when** — outcome demoável (rodar e ver funcionar)
   - **Depends on** — capítulos predecessores ou "none"
   - **Sub-itens** — ACs atômicos (1 commit cada, idealmente)
5. Ordenação topológica (deps primeiro).
6. Se algum capítulo tem >15 sub-itens → flag SUBCHAPTER_BREAKDOWN
   e split em N.1, N.2, ...

## Output format (exato)

\`\`\`markdown
# Roadmap: <Product name>

> **Autonomous loop source of truth.** The loop reads this file each iteration.
> Phase status is the checkbox at the end of the \`####\` heading.

---

## Hard dependency order
<one-line rules — ex: "follow the Depends on: lists below">

---

#### Phase 1 — <Title> [ ]

**Done when:** <demoable outcome>

**Depends on:** none

- [ ] <sub-item 1>
- [ ] <sub-item 2>

---

#### Phase 2 — <Title> [ ]

**Done when:** <demoable outcome>

**Depends on:** Phase 1

- [ ] <sub-item 1>
- [ ] <sub-item 2>
\`\`\`

## Constraints (invariantes)

- Toda phase tem "Done when" **demoável** (não "código escrito", mas "servidor roda e X funciona")
- Sub-itens atômicos (1 commit cada, sob tlc-spec-driven)
- Ordem topológica (deps antes dos dependents)
- Se phase >15 sub-itens → SUBCHAPTER_BREAKDOWN automático

## Append, não overwrite

Se `.specs/ROADMAP.md` já existe (já tem phases `[x]`):
- NÃO mexer nas phases done
- ADICIONAR as novas phases no fim, com Depends on: apropriado
- Atualizar "Hard dependency order" se necessário

## Return contract

- Caminho do arquivo escrito
- Número de phases adicionadas
- Lista de SUBCHAPTER_BREAKDOWN flags (se houver)
- Notas sobre ambiguidades que precisam de humano
```

## Origem

Composed 2026-07-26 como próximo passo natural pós `auto-grill` (Phase 5 HUMAN GATE). Antes desse passo, o fluxo era:

```
auto-grill → ??? → tlc-roadmap-loop
```

Agora:

```
auto-grill → to-spec → to-roadmap (este) → to-tickets → tlc-roadmap-loop
```

## Por que prompt template (não skill nova)

| Opção | Custo | Vale a pena? |
|---|---|---|
| Prompt template (este arquivo) | zero | ✅ já é eficiente |
| Skill `to-roadmap/` | novo SKILL.md + testes + manutenção | só se rodar >5x |
| Flag no `to-spec` | edita upstream Matt Pocock | depende de upstream |

Se virar rotina, promover a skill. Por enquanto, prompt.