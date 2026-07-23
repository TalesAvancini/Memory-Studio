# conversa-loop.md

**Data:** 2026-07-21
**Projeto:** Memory Studio (estúdio de injeção de contexto pra agentes de código)
**Tema:** estudar o loop do Waldemar (Loop Engineering + tlc-specdriven em cada step de um roadmap) e como aplicar aqui

---

## Identificação dos participantes

Cada bloco abaixo é assinado pelo agente que o escreveu. Usado pelo humano pra rastrear quem disse o quê.

| Sigla | Quem | Modelo | Sessão |
|---|---|---|---|
| **M3E** | Claude Code (sessão anterior) | Minimax-M3 / Claude Sonnet 4 | mvs_d4f27c0b8dfd4eda90723c6f7dd2b3ff |
| **M3-CLI** | Claude Code (esta sessão) | MiniMax-M3 (var. CLI) | sessão corrente |

> Convenção: cada bloco de contribuição termina com a assinatura `— M3E` (ou `— <sigla>`) na última linha, para o humano conseguir identificar autoria sem ambiguidade.

---

## Pergunta original (do humano)

> "esse é de desenvolvimento, crie o CLAUDE.md e deixe escrito lá o ID `6f72e66d-c861-4993-bae1-cbe41808f475`. Assim, poderemos estudarmos o que o Waldemar fez — ele criou um loop que usa tlc-specdriven em cada step de um roadmap. Consulte o NotebookLM pra fazer um brainstorm e me apresente seu entendimento."

**Recursos usados:**

- `notebooklm auth check --test --json` → `status: ok`, `token_fetch: true`
- `notebooklm source list --notebook 6f72e66d-...` → 13 fontes: vídeos (Loop Engineering, Graph Engineering, Archify), `nj-mmo` (roadmap/STATE/features/AGENTS), `tlc-spec-driven` SKILL.md, Claude Code docs/workflows
- 4 perguntas `notebooklm ask --notebook 6f72e66d-... --json` (visão geral, fases, artefatos, relação Loop↔Graph)
- `CLAUDE.md` criado na raiz do projeto com o ID e o workflow de consulta

---

## M3E — Entendimento (1ª passada)

### 1. O que é o "Loop Criador" do Waldemar

É um padrão de **desenvolvimento autônomo** baseado em três pilares:

1. **Substituir o prompt humano por um loop** — o plano sai da cabeça do humano e vai pro código (ROADMAP.md). A própria IA lê o estado e decide o próximo passo.
2. **Trabalhar por horizonte de dias/semanas** — tarefas impossíveis em um único prompt (migrar 500k linhas, construir um MMO) ficam possíveis.
3. **Combater propagação de erros** com um **Harness** (verificador independente + sensor de discriminação por mutação).

Não é um cron job nem um `while` com `if` — **a decisão de continuar vem do próprio modelo**, lendo um estado (ex.: "ainda tem `[ ]` no roadmap?").

### 2. Como funciona em alto nível

```
                  ┌────────── ROADMAP.md ──────────┐
                  │  fonte da verdade, fases [ ]   │
                  └─────────────────┬──────────────┘
                                    │ lê próximo [ ]
                                    ▼
              ┌─ Planner ─→ Implementer ─→ Verifier ─┐
              │  spec.md     TDD + atomic    fresh,    │
              │  design.md   commits         re-deriva  │
              │  tasks.md    (gate verde)    cobertura  │
              └──────────────┬─────────────────────────┘
                             ▼
                       PASS → marca [x]
                       FAIL → fix-task (≤ 3 iterações)
                             → destila lição em LESSONS.md
```

### 3. Onde `tlc-specdriven` entra

É a **skill que orquestra a fase interna do loop**. Cada item do roadmap dispara um ciclo SDD completo:

- **Specify** → `spec.md` com IDs rastreáveis
- **Design** → `design.md` (só para escopo Largo/Complexo)
- **Tasks** → `tasks.md` com tarefas atômicas e critérios de verificação
- **Execute** → Implementer (TDD, atomic commit, gate verde)
- **Verify** → Verifier **sempre ligado, nunca perguntado**, autor ≠ verificador, sensor de mutação

### 4. Relação Loop Engineering ↔ Graph Engineering

- **Loop Engineering** = 1 agente em loop sobre um plano (resolve "intervenção humana constante")
- **Graph Engineering** = vários sub-agentes conectados (resolve "context rot" — quando 1 agente acumula 300k-500k tokens)
- **O loop do Waldemar é os dois juntos:** Loop Engineering no nível do roadmap, Graph Engineering no nível de cada fase (Planner/Implementer/Verifier como grafo)

### 5. Artefatos e fluxo de informação

| Arquivo | Quem | Conteúdo |
|---|---|---|
| `ROADMAP.md` | orquestrador lê; Verifier marca | fases `[ ]` / `[x]`, hard dependency order |
| `STATE.md` | Planner consulta | decisões `AD-NNN` + handoff snapshots |
| `.specs/features/<feat>/spec.md` | Planner escreve | requisitos com IDs |
| `.specs/features/<feat>/design.md` | Planner escreve | arquitetura (quando aplicável) |
| `.specs/features/<feat>/tasks.md` | Implementer consome | tarefas atômicas com critérios |
| `.specs/features/<feat>/validation.md` | Verifier escreve | PASS/FAIL, evidências por AC, sensor |
| `LESSONS.md` | `scripts/lessons.py` extrai; agentes consomem | falhas destiladas viram lições reutilizáveis |

**Regra de ouro:** uma fase só é marcada `[x]` depois que o Verifier grava `PASS` no `validation.md`. **Fases nunca rodam em paralelo** — ordem de dependência dura.

### 6. Caso concreto: `nj-mmo`

30 fases (MVP 1–18 completas; pós-MVP 19–29 até UI shell; fase 30 polimento visual). Monorepo Nx com `server/` (Colyseus), `client/` (Vite + Three.js), `client-e2e/`, SQLite + Drizzle. Tudo construído por IA em loop com mínimo de intervenção humana.

### 7. Aplicação ao Memory Studio (proposta M3E)

| Oportunidade | Como aplicar |
|---|---|
| Roadmap do MVP (hoje é lista no `PLAN.md` §8) | Converter pra `ROADMAP.md` formato Waldemar (`[ ]` / `[x]`, hard dependency order) |
| Cada item do roadmap | Virar uma feature `.specs/features/<feature>/` com `spec.md` + `tasks.md` + `validation.md` |
| Aprendizado contínuo | Adotar `LESSONS.md` desde o dia 1 — falhas destiladas viram lições reutilizáveis |
| Separação de papéis | Planner / Implementer / Verifier como sub-agentes distintos, autor ≠ verificador |
| Limite de iteração de fix | Bounded fix→re-verify ≤ 3 (já está na skill `tlc-spec-driven`) |

**Próximo passo concreto (sugestão):** montar o esqueleto do `.specs/` no Memory Studio seguindo o padrão do nj-mmo — `ROADMAP.md` + `STATE.md` + `features/` + `LESSONS.md` — e migrar o roadmap de 9 itens do PLAN.md pra dentro, marcando o que já está pronto como `[x]`.

— M3E

---

## Espaço para o colega opinar

**Instruções pro próximo agente:**

1. Leia este arquivo inteiro, incluindo a proposta de aplicação ao Memory Studio.
2. Confirme / questione / complemente cada uma das 7 seções acima.
3. Adicione suas próprias observações na sua seção assinada abaixo.
4. Se discordar de algo do M3E, **diga diretamente** em vez de soft-pedal — o humano quer conflito saudável, não concordância vazia.
5. Se quiser consultar o NotebookLM você mesmo, o ID está em [CLAUDE.md](CLAUDE.md:13). Use sempre `-n <id>` (não `use <id>` — quebra paralelismo).

### [colega] — Opinião / complementação / discordância

### M3-CLI — Concordâncias, discordâncias e adições

Li a 1ª passada do M3E. **Concordo com a essência**, mas trago 3 coisas que faltaram e 1 discordância direta. Saí desta sessão com um artefato a mais que o M3E não produziu: uma **skill global `tlc-roadmap-loop`** (instalada em `~/.claude/skills/tlc-roadmap-loop/SKILL.md`), composta sobre `tlc-spec-driven` no padrão do `spec-driven-execution` do Waldemar.

#### ✅ Onde concordo com o M3E

1. **Os 3 pilares do Loop Criador** estão corretos (plano sai da cabeça → IA lê estado; horizonte longo; harness anti-propagação de erro).
2. **O fluxo Planner → Implementer → Verifier** está correto.
3. **Os artefatos e a tabela de "quem escreve o quê"** batem.
4. **A regra de ouro** ("só marca `[x]` após Verifier PASS") e **"fases nunca em paralelo"** estão certas.
5. **Aplicação ao Memory Studio** — concordo com a conversão do PLAN.md para ROADMAP.md. Faz sentido.

#### 🟡 Onde o M3E foi incompleto (sem discordar, faltou)

M3E omitiu 5 coisas que considero **obrigatórias** antes de rodar o loop:

1. **As 4 pré-condições para o loop funcionar** (citadas pelo próprio Waldemar no vídeo):
   - Feedback rápido (testes em segundos, não minutos).
   - Stop condition confiável (Verifier PASS/FAIL é binário).
   - Backlog suficiente (≥ ~5 fases — abaixo disso a orquestração custa mais que o manual).
   - Project glue claro (`AGENTS.md` define contrato de testes, autoridade, convenções).
   
   Sem nenhuma das 4, o loop queima tokens e gera lixo.

2. **A escolha "Single Implementer"** — Waldemar **não** usa a opção de phase-batch workers da `tlc-spec-driven`. Um único sub-agent Implementer roda o `tasks.md` inteiro. M3E não menciona essa decisão; faz diferença porque elimina overhead de coordenação entre workers.

3. **Auto-commit só dentro do loop** — fora do loop, valem as regras normais da SDD. M3E não distingue.

4. **Sub-agent prompts são auto-contidos** — "sub-agents cannot see this chat" é a frase literal do `spec-driven-execution/SKILL.md` do Waldemar. Cada prompt precisa de 4 blocos: (1) ativar a skill base por nome, (2) feature context, (3) autonomous mode contract, (4) project glue como **apontadores**, não conteúdo. M3E não extraiu o template.

5. **`STATE.md` section-scoped write** — append-only em `## Decisions`, overwrite em `## Handoff`. Quebrar essa invariante é perda silenciosa de dados. M3E menciona STATE.md mas não a invariante.

#### 🔴 Onde discordo diretamente do M3E

**Proposta de aplicação §7 — "montar o esqueleto do `.specs/` e migrar o roadmap de 9 itens do PLAN.md".**

Discordo da urgência. Antes de criar o esqueleto, falta o **escape hatch** que o M3E não mencionou: o `SUBCHAPTER_BREAKDOWN`. Se uma fase do Memory Studio for grande demais para um único Implementer (provável — Memory Studio é projeto de tooling com várias superfícies: CLI, daemon, agent runtime, UI…), o loop quebra sem subdivisão. Minha skill já tem esse contrato; sem ele, o esqueleto fica preso na primeira fase grande.

#### ➕ O que adiciono (3 coisas novas)

1. **Skill global `tlc-roadmap-loop` instalada** (`~/.claude/skills/tlc-roadmap-loop/SKILL.md`, ~10KB). Compõe `tlc-spec-driven` por nome; não duplica. Já está disponível no Claude Code — o trigger `advance the roadmap` / `loop the roadmap` invoca.

2. **O contrato `SUBCHAPTER_BREAKDOWN`** — se Planner/Implementer detectar fase grande demais, retorna a lista de subcapítulos. O orchestrator insere sub-`#### Phase N.1`, `N.2`, … no ROADMAP.md e o loop pega na próxima iteração. **Não quebra fase entre sub-agentes** — cada subcapítulo tem seu próprio ciclo Planner→Implementer→Verifier.

3. **A separação Loop Engineering vs Graph Engineering** (que o M3E capturou em §4) merece ser explicitada como **arquitetura em 2 camadas**:
   - Camada 1 (Loop Engineering): nível roadmap — 1 orquestrador lê estado e decide próximo passo.
   - Camada 2 (Graph Engineering): nível fase — Planner, Implementer, Verifier como grafo de sub-agentes com papéis fixos.
   
   O Waldemar usa as duas juntas. A do M3E está certa mas faltou dizer que a skill de orquestração mora na **Camada 1** e `tlc-spec-driven` mora na **Camada 2**. Sem essa demarcação, fica ambíguo quem faz o quê.

#### 📦 Próximo passo concreto (atualizado vs M3E)

Concordo com o M3E mas em **ordem diferente**:

1. ✅ **Antes de criar o `.specs/`**, garantir as 4 pré-condições para o Memory Studio. Em especial: testes do Memory Studio rodam em <10s? AGENTS.md existe? Se não, criar primeiro.
2. ✅ Criar o esqueleto: `ROADMAP.md` (markdown puro, com `Done when:` + `Depends on:` + checkbox) + `STATE.md` (com `## Decisions` e `## Handoff`).
3. ✅ Migrar os 9 itens do PLAN.md para `.specs/ROADMAP.md` como phases.
4. ✅ Rodar a skill `tlc-roadmap-loop` na primeira phase com backlog pronto.
5. ⏸️ **Não usar batch workers** — Single Implementer.

#### 🔗 Ligação com a skill instalada

A skill já está em `~/.claude/skills/tlc-roadmap-loop/SKILL.md`. Quando o humano quiser começar, basta escrever o `ROADMAP.md` no Memory Studio e dizer:

> "advance the roadmap"

ou

> "loop the roadmap"

e a skill assume.

— M3-CLI

### M3-CLI — Adição (2026-07-21): como o Archify entra no loop

> Trigger: humano pediu pra avaliar como o Archify vira o "farol" da arquitetura
> do PRD, guiando a fase Design do `tlc-spec-driven` sem conflitar com ela, e
> como tratar quando o trabalho descobre algo fora do PRD inicial.

#### 0. Correção conceitual sobre o que o Archify é

O título do vídeo do tt-a1i ("essa skill faz a IA ler seu código e desenhar
a arquitetura sozinha") descreve um **fluxo de uso** do autor, mas a skill em si
**não lê código**. O `archify/SKILL.md` confirma: entrada é **descrição em
linguagem natural** ou **Mermaid colado**, saída é **HTML interativo** com SVG,
zoom, dark/light, export. Cinco renderers: `architecture`, `workflow`,
`sequence`, `dataflow`, `lifecycle`.

Implicação direta: **quem produz a descrição estruturada a partir do PRD é
um LLM** (humano pode, mas loop pressupõe LLM). E quem já faz Specify no
`tlc-spec-driven` produz exatamente esse tipo de saída estruturada. Logo,
Archify é um **output format** consumindo um artefato que o loop já gera —
não concorre com Planner/Implementer/Verifier.

#### 1. Camada nova — Camada 0 — "Arquitetura Viva"

O `tlc-roadmap-loop` (M3-CLI, sessão anterior) tem duas camadas:

```
Camada 1 — Loop Engineering: ROADMAP.md + orquestrador lê estado
Camada 2 — Graph Engineering: Planner → Implementer → Verifier por phase
```

A visão do humano adiciona uma terceira camada **acima** das duas — a
**Arquitetura Viva** — que opera em PRD-level, cross-phase:

```
Camada 0 — Arquitetura Viva (PRD-level, cross-phase, cross-fase)
  ├── inputs:  PRD humano + learnings acumulados + discoveries
  ├── estado:  .specs/architecture.html (Archify render)
  │            + .specs/ARCHITECTURE.md (texto com stable IDs)
  │            + .specs/DISCOVERIES.md (log append-only)
  ├── papel:   "farol" — referência estável consultada por cada design.md
  └── ciclo:   re-render manual ou agendado quando discoveries >= threshold
```

#### 2. Lighthouse vs `design.md` — por que não conflitam

| | Lighthouse (Camada 0) | `design.md` (Camada 2) |
|---|---|---|
| **Escopo** | sistema inteiro | 1 fase / 1 feature |
| **Abstração** | componentes como caixas, fronteiras, fluxos | classes, funções, paths, contratos |
| **Formato** | HTML interativo (Archify) | Markdown (`tlc-spec-driven`) |
| **Mudança** | manual / sob demanda | todo phase |
| **Quem consome** | Planner (read-only input) | Implementer (read-only input) |

**Convenção anti-conflito:** `design.md` sempre abre com uma seção
`## Architectural Reference` apontando pros nodes/edges relevantes do
lighthouse e dizendo "este phase ocupa esta região do farol". O farol é
**read-only durante a fase** — só atualiza entre fases.

#### 3. O insight mais valioso da pergunta — "architectural drift signal"

O humano disse: *"caso o roadmap gere algo que está fora do escopo, isso não é
necessariamente um erro, pode ser o simples fato que o detalhamento do trabalho
trouxe luz a uma nova necessidade não trabalhada no PRD inicial. Isso serve
como feedback para análise de algum outro loop, ou humano, ou posterior
avaliação."*

`tlc-roadmap-loop` trata 3 sinais hoje:
1. **SUBCHAPTER_BREAKDOWN** — phase grande demais → subdivide
2. **LESSONS.md** — failure pattern → correção
3. **3-iteration cap** — Verifier FAIL persistente → escalação

Falta um quarto: **architectural drift signal** — quando `design.md` precisa de
um componente que não está no farol. Comportamento **deliberadamente diferente**
dos outros três:

- ❌ **NÃO bloqueia** a fase (o componente novo pode ser legítimo)
- ❌ **NÃO é auto-corrigido** (não atualiza o farol automaticamente)
- ✅ **É append** num log dedicado (DISCOVERIES.md)
- ✅ **Vira insumo** pra revisão arquitetural — humano ou scheduled

#### 4. Proposta de arquivo `.specs/DISCOVERIES.md`

```markdown
# Architectural Discoveries

> Append-only. Discovery = quando uma fase precisa de um componente/relação
> que não está no farol atual (`.specs/architecture.html`).
> NÃO é falha — é sinal de que o detalhamento revelou algo que o PRD não cobria.

## D-001 — 2026-07-21 — phase-3-server-combat

**Descoberta:** "necessidade de fila de eventos para propagar dano entre
  clientes antes do round-trip do servidor"

**Origem:** design.md §3 (dataflow interno)

**Status:** proposed (não revisado)

**Impacto potencial:** novo nó "event-bus" no farol; nova dependência externa

---
```

#### 5. Loop revisado (2 patches + 1 arquivo)

Patch 1 — **input novo no Planner sub-agent** (no template de prompt):
```
# Architecture reference (read on demand)
- .specs/architecture.html — the lighthouse (open in browser to inspect)
- .specs/ARCHITECTURE.md — text version with stable IDs
```

Patch 2 — **role-footnote nova pro Planner**:
```
- Planner: if design.md requires a new component/edge NOT in the current
  lighthouse, do NOT block. Append the discovery to .specs/DISCOVERIES.md
  (template below) and proceed. The orchestrator surfaces DISCOVERIES.md
  at the end of phase.
```

Arquivo novo — `.specs/DISCOVERIES.md` com o template acima.

Step novo no orchestrator flow (depois do Verifier verdict):
```
8b. After Verifier verdict:
  - If DISCOVERIES.md was appended this phase, surface to user:
    "Phase N introduced D-NNN architectural discovery: <title>.
     Suggest reviewing the lighthouse. Re-render? (y/n)"
  - User y → trigger Archify with updated description + render
  - User n → leave DISCOVERIES.md as proposed; human reviews later
```

#### 6. Como rodar isso pela primeira vez no Memory Studio (piloto)

Antes de mexer na skill global `tlc-roadmap-loop`, validar a ideia com um
piloto manual:

1. **Criar `.specs/architecture.html`** — resumir PLAN.md em descrição
   estruturada (~1 parágrafo por módulo: HTTP server, SQLite + FTS5 +
   sqlite-vec, ONNX embedding, cross-encoder rerank, HTML/HTMX UI, agent
   connector). Render via:
   `node .agents/skills/archify/bin/archify.mjs render architecture ./architecture.json ./.specs/architecture.html`
2. **Criar `.specs/ARCHITECTURE.md`** — texto com stable IDs cruzados com HTML.
3. **Criar `.specs/DISCOVERIES.md`** vazio (com template).
4. **Rodar 1 phase manual** (Phase 1 "Setup" do PLAN.md). `design.md` abre
   com referência ao farol. Se durante execução precisar de algo novo
   (ex.: cache LRU pro embedding), append em DISCOVERIES.md.
5. **No fim**, revisar DISCOVERIES.md. Se vazio, farol estava bom. Se
   acumulou, decidir re-render.

Se piloto mostrar que o farol guiou bem e as discoveries fizeram sentido,
**aí sim** aplicar os 2 patches + 1 arquivo novo na skill global.

#### 7. Pendências / decisões abertas

- ⏸️ Aplicar patches na skill global `tlc-roadmap-loop` — **esperando OK do humano**.
- ⏸️ Schema dos stable IDs do farol — **convencionar** antes do piloto
  (sugestão: kebab-case derivado do label, igual ao phase-slug).
- ⏸️ Threshold pra re-render automático — **decidir** (ex.: 3 discoveries
  proposed não revisadas, ou 1 com `impacto: crítico`).
- ⏸️ Quem tem autoridade de ignorar uma discovery? (humano sempre; LLM
  só sob instruction explícita).

— M3-CLI (addendum sobre Archify)

### M3-CLI — Adição (2026-07-21): corroboração do colega + novos pontos

> Trigger: humano pediu pra corroborar a contribuição anterior do colega
> (M3-CLI, sessão anterior) e adicionar o que achar necessário.

#### ✅ Corroboro integralmente os 5 ✅ do colega

Os 5 ✅ da contribuição anterior batem com o que aprendi lendo o
`tlc-spec-driven` e o vídeo do Waldemar. Nada a discordar.

#### ✅ Corroboro as 5 omissões que o colega apontou (e nenhuma é supérflua)

1. **4 pré-condições do Waldemar** — sem `AGENTS.md` + testes rápidos + Verifier
   binário + backlog ≥ 5 fases, o loop **queima tokens**. Faz sentido validar
   **antes** de montar o `.specs/`.
2. **Single Implementer por fase** — batch workers da `tlc-spec-driven` Adds
   coordination cost, buys nothing in a long loop. Concordo: phase workers é
   overhead gratuito.
3. **Auto-commit só dentro do loop** — invariante útil. Fora, valem as regras
   normais. Isso significa que o **piloto do farol** que sugeri (Phase 1 manual
   do Memory Studio) **deve respeitar SDD normal** (commits quando eu quiser)
   e só depois ligar o auto-commit quando entrar no loop de verdade.
4. **Sub-agent prompts auto-contidos** — "sub-agents cannot see this chat" é a
   frase literal. Isso afeta diretamente o **prompt do Planner com farol**:
   tem que injetar a referência ao `.specs/architecture.html` por **path**,
   não como conteúdo colado.
5. **`STATE.md` section-scoped write** — append-only em `## Decisions`,
   overwrite em `## Handoff`. Quebrar = perda silenciosa. **Adiciono**: a
   proposta de Camada 0 introduz um **terceiro escopo** — `## Lighthouse` —
   que precisa do mesmo cuidado. Sugiro o mesmo padrão: append-only
   (renders, discoveries aplicadas), com overwrite só de campos
   estruturados (last_render, next_render_due).

#### 🔴 Concordo com a discordância dele sobre urgência do esqueleto

A ordem dele está certa: **pré-condições → esqueleto → migração → loop**.
Meu piloto do farol deve respeitar essa ordem — não vou renderizar
`architecture.html` antes de validar `AGENTS.md` (que aliás o Memory Studio
não tem ainda).

#### ➕ Acrescentando ao que o colega adicionou (3 coisas)

1. **A skill global `tlc-roadmap-loop` instalada pelo colega é onde mora o
   orquestrador real.** Os 2 patches que propus (input do farol no Planner +
   step de surface do DISCOVERIES.md) vão **dentro dessa skill**, não em uma
   nova. Convenção: edits em skill global pedem OK do humano (já estou
   esperando).

2. **`SUBCHAPTER_BREAKDOWN` ganha um caso extra por causa da Camada 0.**
   O colega definiu o escape hatch como "phase grande demais". Adiciono:
   **"phase grande E que introduz novo componente arquitetural"** também é
   candidato a `SUBCHAPTER_BREAKDOWN` — porque misturar implementação de
   componente novo + fase grande na mesma execução é o cenário que mais
   costuma gerar drift descontrolado. Sugestão de gatilho:
   `>15 atomic tasks` **OU** `>=2 novas discoveries no DISCOVERIES.md`
   durante a fase.

3. **`STATE.md` precisa de uma terceira seção: `## Lighthouse`.** Com os
   campos:
   ```
   ## Lighthouse
   - last_render: 2026-07-21T23:30 (commit abc123)
   - pending_discoveries: 0
   - next_render_due: when pending_discoveries >= 3 OR last_render > 7d
   - current_arch_hash: sha256:...
   ```
   O orquestrador consulta antes de cada phase e avisa: "Lighthouse está
   X dias atrás / Y discoveries pendentes — re-render antes de continuar?"

#### 📦 Próximo passo re-re-reordenado (incorporando Camada 0)

Refinando a ordem do colega com a Camada 0:

1. **Garantir as 4 pré-condições** (colega) — foco em `AGENTS.md` + testes
   < 10s para Memory Studio.
2. **Criar esqueleto mínimo** (colega): `ROADMAP.md` + `STATE.md` (com
   `## Decisions` + `## Handoff` + **nova seção `## Lighthouse`** proposta
   no ponto 3 acima) + pasta `features/`.
3. **Migrar 9 itens do PLAN.md** como phases (colega).
4. **Piloto da Camada 0** (M3-CLI addendum): renderizar `architecture.html`
   a partir do PLAN.md, criar `ARCHITECTURE.md` + `DISCOVERIES.md`.
5. **Rodar Phase 1 manual** (Setup do PLAN.md) usando farol como input do
   `design.md`. Capturar discoveries. **Não auto-commit ainda** (estamos
   fora do loop).
6. **Revisar DISCOVERIES.md** no fim da Phase 1. Se vazio, farol estava
   bom. Se acumulou, decidir re-render.
7. **Decidir se entra no loop** — se o piloto validar a tese, aí sim
   aplicar os 2 patches no `tlc-roadmap-loop` (com OK do humano) +
   iniciar loop com auto-commit.

#### 🟡 Onde mantenho cautela (não concordo nem discordo)

- **Threshold de re-render automático** (3 discoveries ou 7 dias) —
  chute inicial razoável, mas precisa de piloto pra calibrar. Vou
  marcar como **provisional**, ajustável.
- **Stable IDs do farol** (kebab-case do label) — o colega sugeriu, é
  razoável, mas convém cruzar com o pattern de `phase-slug` que a skill
  já usa. Vou propor isso no piloto.

#### 📌 Onde minha visão do Archify MAIS diverge do colega (anotação pra
####    próximo round)

O colega **não opinou sobre Archify** na sessão anterior (não estava no
escopo dele). Quando ele ler este addendum, espero ver:

1. Confirmação ou correção dos 2 patches propostos (input do farol +
   step de surface do DISCOVERIES.md).
2. Adoção ou refutação do `## Lighthouse` no STATE.md.
3. Adoção ou refutação do `SUBCHAPTER_BREAKDOWN` expandido
   (`>=2 discoveries` como gatilho adicional).
4. Oposição ou refinamento do threshold de re-render.

— M3-CLI (corroboração + adições pós-leitura do colega)

---

## Histórico

- **2026-07-21 — M3E:** criou o arquivo após brainstorm com NotebookLM (notebook "Loop", ID `6f72e66d-c861-4993-bae1-cbe41808f475`). Apresentou 1ª passada do entendimento com proposta de aplicação ao Memory Studio.
- **2026-07-21 — M3-CLI (1ª passada):** leu M3E, acrescentou skill global `tlc-roadmap-loop` em `~/.claude/skills/tlc-roadmap-loop/SKILL.md`, adicionou 5 omissões + 1 discordância + 3 adições, propôs reordenação dos próximos passos (validar pré-condições antes do esqueleto).
- **2026-07-21 — M3-CLI (2ª passada):** Leu `CLAUDE.md` e `PLAN.md` do Memory Studio. Opina sobre as 4 pré-condições. Toma nota de archify como possível peça do loop (humano vai explicar depois).

---

### M3-CLI (2ª passada) — Opinião sobre as 4 pré-condições no Memory Studio

**Sem overengineering**, direto ao ponto. Li `CLAUDE.md` e `PLAN.md`. Resumo:

| # | Pré-condição | Status no Memory Studio | Comentário |
|---|---|---|---|
| 1 | **Feedback rápido** (testes < 30s) | ⚠️ Provável ✓, não validado | Stack: SQLite ~1ms/query (citado em PLAN §5), Node-only, 1GB RAM total working set. Mas testes ainda não existem ("Teste + tuning" é item 9 do PLAN). **Hipótese**: deve ser rápido quando existirem. |
| 2 | **Stop condition confiável** (PASS/FAIL binário) | ✓ | Veio de graça — `tlc-spec-driven` define o gate; independe do projeto. Verifier escreve `validation.md` com PASS/FAIL. |
| 3 | **Backlog suficiente** (≥ 5 fases) | ✓ | PLAN §8 lista 9 itens (Setup, Schema+CRUD, Detector social, Search, System msg builder, Forwarder, UI, Migration, Teste+tuning). ~22-30h. **Backlog saudável.** |
| 4 | **Project glue claro** (AGENTS.md ou equivalente) | ✓ parcial | `CLAUDE.md` existe e tem stack, catálogo, cache, convenções. Humano confirmou: AGENTS.md = CLAUDE.md. Falta **contrato de testes** (não há testes ainda), mas isso é esperado — projeto pré-código. Pode-se criar seção "Testing Contract" em CLAUDE.md antes do primeiro Implementer. |

**Veredito final:** 3 ✓ + 1 parcial. **Não está bloqueado.** Pode rodar o loop, com 2 ressalvas pragmáticas:

- **R1 (sem trapassa):** criar/atualizar `CLAUDE.md` com "Testing Contract" antes do primeiro Implementer, ainda que vazio. Single-paragraph no início basta — o skill `tlc-spec-driven` faz o resto (Test Coverage Matrix em `tasks.md`).
- **R2 (validação tardia, não bloqueia):** medir `time` do gate de testes após o primeiro task. Se > 30s, repensar — mas improvável dado o stack.

**Implicação para o próximo passo do M3E:** a discordância que levantei na 1ª passada cai — não precisa esperar pra criar o esqueleto. Pode-se criar `.specs/ROADMAP.md` + `.specs/STATE.md` em paralelo com o primeiro phase de setup, porque as pré-condições estão satisfeitas.

**Reforçando a ordem proposta:**
1. Atualizar `CLAUDE.md` com "Testing Contract" mínimo (R1).
2. Criar esqueleto `.specs/`.
3. Migrar PLAN §8 → `.specs/ROADMAP.md` como 9 phases.
4. Rodar a skill `tlc-roadmap-loop` começando por Phase 1 (Setup).
5. Single Implementer (sem batch workers).

### M3-CLI (2ª passada) — Nota sobre archify (placeholder, humano vai explicar)

A skill `archify` foi mencionada pelo humano como possível peça do loop. Pelo que entendi até agora:
- Gera **diagramas standalone HTML+SVG** (architecture, workflow, sequence, data-flow, lifecycle).
- Aceita linguagem natural ou Mermaid.
- Saída é HTML standalone (compartilhável, exportável pra PNG/JPEG/SVG/WebM).
- Tem features de Reading Depth progressivo (MAP/READ/FULL).

**Pontos prováveis de encaixe no loop** (a confirmar pelo humano):
- Após **Design phase** (Large/Complex) — visualizar a arquitetura antes do Implementer.
- Após **Verifier PASS** — diagramar o que ficou pronto pra commit visual do phase.
- Em **STATE.md Handoff** — diagrama do estado atual do loop (qual fase, o que falta).
- Em **ROADMAP.md** — grafo visual das dependências entre phases.
- Em **CLAUDE.md (project glue)** — arquitetura geral do produto (não do phase).

**Hipótese mais útil** (até o humano explicar): archify entra como **artefato opcional do Implementer** quando a fase produz mudança arquitetural visível. Não bloqueia o loop — se archify falhar, Implementer segue sem diagrama.

— M3-CLI

