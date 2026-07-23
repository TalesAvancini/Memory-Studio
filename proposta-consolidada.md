# Proposta Consolidada — Roadmap Loop com Camada de Arquitetura

**Data:** 2026-07-22
**Projeto:** Memory Studio
**Origem:** síntese de `conversa-loop.md` (M3E 1ª passada + M3-CLI 1ª, 2ª passadas + M3-CLI addendum sobre Archify)
**Status:** guia operacional para a sessão de amanhã (2026-07-23). Foco: skills loop prontas, NÃO desenvolvimento do Memory Studio.
**Autoria desta consolidação:** M3-CLI
**Auditado por:** M3E (2026-07-22) — 6 itens (2 técnicos, 1 conceitual, 3 flags) — todos resolvidos/anotados nesta versão.

---

## 0. TL;DR

Loop autônomo sobre um roadmap, com **3 camadas**:

- **Layer A — Architecture Reference (PRD-level):** Archify renderiza `.specs/architecture.html` a partir do PRD. É um farol — referência estável cross-phase. Drift vira `DISCOVERIES.md`, não falha.
- **Layer B — Roadmap Loop (ROADMAP-level):** skill `tlc-roadmap-loop` (compõe `tlc-spec-driven` por nome). Lê ROADMAP.md, dispara fases sequencialmente, atualiza STATE.md.
- **Layer C — Phase Graph (phase-level):** 3 sub-agentes sequenciais por fase: **Planner → Implementer → Verifier**, todos frescos, com autor ≠ verificador.

**Pré-condição crítica** (Waldemar): feedback rápido + stop binário + backlog ≥ 5 fases + project glue claro. Sem isso, o loop queima tokens.

**Pragmática:** antes de patchar a skill global, validar com **piloto manual de 1 phase** no Memory Studio (Phase 1 = Setup, do PLAN §8).

---

## 1. Visão e contexto

### 1.1 O problema

Construir produtos não-triviais (como Memory Studio) com agentes IA exige:
- **Plano fora da cabeça humana** (vai pro código, em ROADMAP.md).
- **Harness anti-propagação de erro** (Verifier independente, sensor de mutação, lessons).
- **Horizonte longo** (uma única sessão não dá conta; precisa rodar dias/semanas).
- **Referência arquitetural estável** (sem isso, cada Planner redesenha, e o produto vira Franken-código).

### 1.2 A solução proposta

Padrão Waldemar (Loop Criador) refinado com **Camada de Arquitetura** (Archify como farol). Três camadas, separação clara de papéis, **single Implementer por fase** (sem batch workers — overhead gratuito), **sub-agent prompts auto-contidos** (cada Planner/Implementer/Verifier recebe contexto completo, não referência ao "chat acima").

### 1.3 Caso concreto (validação)

**Memory Studio É o caso de validação.** O piloto manual (§9) é onde o padrão vai ser testado de verdade, no domínio certo (developer tooling, IA infrastructure).

**Footnote factual** (não protagonismo): Waldemar usou o padrão num projeto público — **nj-mmo** (MMORPG 3D no browser, ~30 fases, fim de semana de execução autônoma). É o único exemplo público conhecido do padrão rodando. Citado aqui só pra registrar que o pattern não é teórico; **não é referência de domínio** — Memory Studio é developer tooling, não jogo. A forma do loop transfere; o conteúdo das phases não.

> ⚠️ **Audit M3E (2026-07-22):** reescrito após pushback do humano. Antes estava errado: nj-mmo era o "caso de validação" e Memory Studio o "segundo caso". Inversão é a correta — não construímos jogo.

**Diferença relevante pro farol:** Memory Studio tem **surface arquitetural rica** (HTTP server + SQLite + FTS5 + sqlite-vec + ONNX embedding + cross-encoder rerank + UI HTML/HTMX + 3 modos de deployment: proxy/hook/MCP). Isso torna a Camada A (farol arquitetural) **particularmente valiosa** — múltiplos componentes estáveis com fronteiras claras justificam render visual e stable IDs desde o dia 1.

---

## 2. Arquitetura em 3 camadas

### 2.1 Visão geral

```
┌────────────────────────────────────────────────────────────────────┐
│ Layer A — Architecture Reference  (PRD-level, cross-phase)        │
│   ├── Estado: .specs/architecture.html  (Archify render)          │
│   │          .specs/ARCHITECTURE.md      (texto + stable IDs)     │
│   │          .specs/DISCOVERIES.md       (append-only log)        │
│   ├── Quem atualiza: humano (decisão); Implementer opcional (auto) │
│   ├── Quem consome: Planner (read-only), design.md (referência)   │
│   └── Invariante: stable IDs imutáveis; label mutável              │
│                                                                    │
│  ──────────────────── fonte ──────────────────── executa ────────── │
│                                                                    │
│ Layer B — Roadmap Loop  (ROADMAP-level)                           │
│   ├── Quem: skill `tlc-roadmap-loop` (driver only)                │
│   ├── Estado: .specs/ROADMAP.md + .specs/STATE.md                 │
│   ├── Operação: pick next phase → dispatch Layer C → flip [x]     │
│   └── Invariante: nunca paralelo; sequential, deterministic        │
│                                                                    │
│ Layer C — Phase Graph  (1 fase por vez)                            │
│   ├── Planner → Implementer → Verifier (3 sub-agentes fresh)      │
│   ├── Cada um ativa `tlc-spec-driven` por nome (sem duplicação)   │
│   └── Invariante: Single Implementer; Verifier sempre fresh;       │
│       author ≠ verifier; discrimination sensor sempre roda        │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 Por que letras em vez de números

M3-CLI (addendum) numerou como 0/1/2; **nesta consolidação renumeramos como A/B/C**.

**Razão:** topologicamente, Layer A é **fonte** (existe antes do loop, é referência estável). Layer B é **executor** (consome o estado e age). Numerar A como "0 acima" induz à conclusão errada de que A depende de B. Letras deixam claro que A e B estão em **domínios diferentes** (PRD vs ROADMAP), e o fluxo é **derivação**, não hierarquia.

### 2.3 Quem mora em cada camada

| Camada | Artefato | Componente | Local |
|---|---|---|---|
| A | `architecture.html` | Skill `archify` (renderiza) | `.specs/` |
| A | `ARCHITECTURE.md` | Texto + stable IDs (gerado por LLM na bootstrap) | `.specs/` |
| A | `DISCOVERIES.md` | Append-only log de drift arquitetural | `.specs/` |
| B | `ROADMAP.md` | Skill `tlc-roadmap-loop` (lê e escreve) | `.specs/` |
| B | `STATE.md` | `## Decisions` (append) + `## Handoff` (overwrite) | `.specs/` |
| C | `spec.md`, `design.md`, `tasks.md`, `validation.md` | Skill `tlc-spec-driven` (composta por Layer B) | `.specs/features/<phase-slug>/` |

**Importante:** STATE.md **não** contém estado do farol. Misturar A e B no mesmo arquivo polui invariantes de write section-scoped. Estado do farol é self-contained em 3 arquivos coesos.

### 2.4 Modo de consumo dual do farol (audit M3E, 2026-07-22)

O farol tem **dois consumidores**, com modos de leitura diferentes:

| Consumidor | Arquivo primário | Como consome |
|---|---|---|
| **Sub-agente LLM** (Planner, Implementer) | `.specs/ARCHITECTURE.md` | Texto puro, parseável, com stable IDs cruzados |
| **Humano** (revisão periódica, re-render) | `.specs/architecture.html` | Visual interativo: semantic lens, route probe, story beat, pan/zoom, dark/light |

**Implicação direta no Patch 1:** "Planner opens in browser to inspect" não é correto — Planner lê texto. Os recursos visuais do Archify (interatividade) **existem só pro humano**. Não esperar que o Planner "navegue" o HTML.

ARCHITECTURE.md é, portanto, **primário pro loop**; architecture.html é **primário pro humano**. Os dois são mantidos em sync (ver §5.1, regra de write — full replace).

---

## 3. Pré-condições (Waldemar, 4 hard rules)

Antes de ligar o loop:

| # | Pré-condição | Como verificar | Status Memory Studio |
|---|---|---|---|
| 1 | **Feedback rápido** (testes < 30s) | Rodar gate de testes; medir `time` | ⚠️ Provável ✓ (SQLite ~1ms/q, Node-only, 1GB RAM) — testes não existem ainda |
| 2 | **Stop condition confiável** (Verifier PASS/FAIL binário) | `tlc-spec-driven` já define — vem de graça | ✓ |
| 3 | **Backlog suficiente** (≥ 5 fases) | Contar phases em ROADMAP.md | ✓ (9 fases no PLAN §8) |
| 4 | **Project glue claro** (AGENTS.md ou equivalente) | Ler CLAUDE.md/AGENTS.md — testing contract explícito? | ⚠️ Parcial — CLAUDE.md cobre stack/convenções; falta "Testing Contract" |

**Ressalvas pragmáticas (R1, R2):**

- **R1:** criar/atualizar `CLAUDE.md` com seção **Testing Contract** antes do primeiro Implementer. Single-paragraph basta — `tlc-spec-driven` preenche o resto (Test Coverage Matrix em `tasks.md`).
- **R2:** medir tempo do gate após primeiro task. Se > 30s, repensar — improvável.

---

## 4. Artefatos do loop

### 4.1 Inventário

```
.specs/
├── ROADMAP.md                          # Layer B — source of truth da sequência
├── STATE.md                            # Layer B — Decisions + Handoff
├── architecture.html                   # Layer A — farol renderizado (visual, humano)
├── ARCHITECTURE.md                     # Layer A — texto + stable IDs (LLM-consumível)
├── DISCOVERIES.md                      # Layer A — drift append-only log
├── LESSONS.md                          # gerado por scripts/lessons.py
├── lessons.json                        # canonical state machine-owned (lessons.py STORE_REL)
├── scripts/
│   └── lessons.py                      # determinístico; do tlc-spec-driven
└── features/<phase-slug>/
    ├── spec.md                         # Layer C — Planner
    ├── design.md                       # Layer C — Planner (Large/Complex)
    ├── tasks.md                        # Layer C — Planner
    └── validation.md                   # Layer C — Verifier (PASS/FAIL + sensor)
```

> ✅ **Audit M3E (2026-07-22) — RESOLVIDO 2026-07-22:** `lessons.json` é convention oficial do `tlc-spec-driven`. Origem: `tlc-spec-driven/SKILL.md` §".specs Structure" (linhas 58-71) declara `lessons.json` como "Canonical lessons state (machine-owned)" e `tlc-spec-driven/scripts/lessons.py:35` define `STORE_REL = os.path.join(".specs", "lessons.json")`. Flag removido.

### 4.2 Quem escreve o quê (matriz de autoridade)

| Arquivo | Quem escreve | Quem lê | Write rule |
|---|---|---|---|
| ROADMAP.md | humano (bootstrap) + orquestrador (flip `[ ]`→`[x]` após PASS) | Planner (escopo + deps) | Checkbox literal |
| STATE.md → `## Decisions` | Planner (AD-NNN append em Design phase) | todos | append-only |
| STATE.md → `## Handoff` | orquestrador (em pause/stop) | orquestrador (em resume) | overwrite só do body |
| architecture.html | humano ou Implementer (auto) | Planner | full replace; bump version |
| ARCHITECTURE.md | humano (bootstrap) ou Implementer (auto, em sync com HTML) | Planner | full replace; IDs imutáveis |
| DISCOVERIES.md | Planner ou Implementer (quando drift detectado) | humano (revisão periódica) | append-only |
| LESSONS.md | `scripts/lessons.py` (machine-owned) | Planner + Designer | auto-regenerado |
| spec.md | Planner | Implementer, Verifier | full replace |
| design.md | Planner | Implementer, Verifier | full replace; abre com `## Architectural Reference` |
| tasks.md | Planner | Implementer | full replace |
| validation.md | Verifier | orquestrador (verdict) | full replace |

### 4.3 Stable IDs do farol (Layer A)

**Invariante:** ID é imutável; label é mutável.

**Convenção:** kebab-case derivado do label canônico. Exemplos:
- `http-server` (Fastify)
- `sqlite-store` (DB + FTS5 + sqlite-vec)
- `embedding-service` (multilingual-e5-small, ONNX)
- `cross-encoder-rerank` (ms-marco-MiniLM-L-6-v2)
- `agent-connector-proxy` (modo 1: custom baseURL)
- `agent-connector-hook` (modo 2: hook system)
- `agent-connector-mcp` (modo 3: MCP server)

Quando um nó é renomeado, ID fica; label muda. Referências em `design.md` antigos continuam válidas.

---

## 5. Skill `tlc-roadmap-loop` — patches propostos

**Estado atual:** já existe em `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (~10KB). Compõe `tlc-spec-driven` por nome; não duplica.

### 5.1 Patches a aplicar (após piloto validar)

#### Patch 1 — Layer A reference no sub-agent prompt do Planner

Adicionar ao bloco "Project glue (read on demand)":

```
- .specs/architecture.html — the farol (open in browser to inspect)
- .specs/ARCHITECTURE.md — text version with stable IDs
- .specs/DISCOVERIES.md — architectural drift log (read to see what's already known)
```

E no role-footnote do Planner:

```
Planner:
  - design.md must open with `## Architectural Reference` pointing to the
    relevant nodes/edges of the farol by stable ID.
  - If design.md requires a new component/edge NOT in the current farol,
    DO NOT block. Append the discovery to .specs/DISCOVERIES.md (template
    below) and proceed. The orchestrator surfaces DISCOVERIES.md at end of phase.
```

#### Patch 2 — Step 8b novo no orchestrator flow (após Verifier verdict)

Inserir entre "8. Verdict handling" e "9. Stop conditions":

```
8b. After Verifier verdict (regardless of PASS/FAIL):
  - If DISCOVERIES.md was appended this phase, surface to user:
    "Phase N introduced D-NNN architectural discovery: <title>.
     Severity: <cosmetic|structural|critical>.
     Suggest reviewing the farol. Re-render? (y/n)"
  - User y → trigger Archify with updated ARCHITECTURE.md
  - User n → leave DISCOVERIES.md as proposed; human reviews later
```

### 5.2 Auto-re-render policy (refinamento do threshold)

Em vez de "3 discoveries OU 7 dias" (proposta inicial do M3-CLI), usamos **severidade**:

| Severidade | Definição | Auto-re-render? |
|---|---|---|
| `cosmetic` | Rename, agrupamento, ajuste visual | Não acumula — apenas log |
| `structural` | Novo componente OU nova relação entre existentes | Quando ≥ 3 acumulados sem revisão |
| `critical` | Mudança de fronteira (auth, persistência, autoridade, modelo de concorrência) | Imediato — bloqueia próximo phase até decisão humana |

Default: re-render é **humano-triggered**. Auto só dispara em `critical` ou `structural >= 3`.

### 5.3 `SUBCHAPTER_BREAKDOWN` expandido (refinamento)

M3-CLI addendum propôs expandir o gatilho. Adotamos:

> Se durante uma fase o Planner ou Implementer reporta:
> - `>15 atomic tasks` **OU**
> - `>=2 novas discoveries no DISCOVERIES.md` **OU**
> - `>=1 critical discovery`
>
> então retorna `SUBCHAPTER_BREAKDOWN: [...]`.

A 3ª condição é nova — fase que descobre mudança de fronteira arquitetural quase certamente é grande demais pra um único ciclo.

### 5.4 O que **NÃO** entra na skill

Decisão deliberada: **NÃO adicionar `## Lighthouse` ao STATE.md**. Estado do farol vive em 3 arquivos coesos (`architecture.html` + `ARCHITECTURE.md` + `DISCOVERIES.md`). O orchestrator consulta direto via filesystem quando precisa. Manter STATE.md com 2 seções (Decisions, Handoff) preserva a invariante section-scoped.

---

## 6. Sinal de drift arquitetural — 4º sinal do loop

Hoje, `tlc-roadmap-loop` trata 3 sinais:

| Sinal | Origem | Comportamento |
|---|---|---|
| `SUBCHAPTER_BREAKDOWN` | Planner ou Implementer (fase grande) | Subdivide em sub-phases; insere no ROADMAP |
| `LESSONS.md` | Verifier (failure pattern recorrente) | Vira guidance pro próximo Planner |
| 3-iteration cap | Verifier (FAIL persistente) | Escalation ao humano |

**Adicionamos o 4º:**

| Sinal | Origem | Comportamento |
|---|---|---|
| `DISCOVERIES.md` | Planner ou Implementer (componente não-mapeado) | **Não bloqueia**. Append. Surfaced no fim da fase. |

Diferença chave: drift arquitetural **não é falha**. É **descoberta**. O detalhamento revelou algo que o PRD não cobria. Tratar como erro quebraria o fluxo; tratar como sucesso silencioso perderia o sinal. Append-only + surface é o equilíbrio.

---

## 7. Bootstrap do farol (5 passos determinísticos)

> ⚠️ **Audit M3E (2026-07-22):** Archify **não lê PRD**. É um renderer de JSON estruturado (vide [archify/SKILL.md §Workflow](.agents/skills/archify/SKILL.md)). O passo "PRD → HTML" precisa de um **LLM no meio** transcrevendo PRD pra JSON.

Antes de qualquer phase, criar Layer A. Fluxo corrigido:

```bash
# 1. PRD existe em .specs/PRD.md (ou importar PLAN.md como PRD temporário)
test -f .specs/PRD.md || cp PLAN.md .specs/PRD.md

# 2. LLM (ou humano) lê PRD e escreve .specs/architecture.architecture.json
#    Schema: .agents/skills/archify/schemas/architecture.schema.json
#    Exemplo de referência: .agents/skills/archify/examples/archify-repo.architecture.json
#    Estrutura: nodes (com stable IDs kebab-case) + edges + boundaries + invariants

# 3. Renderizar farol via Archify (renderer nativo, dependency-free)
node .agents/skills/archify/bin/archify.mjs render architecture \
  .specs/architecture.architecture.json \
  .specs/architecture.html

# 4. LLM transcreve o mesmo JSON → .specs/ARCHITECTURE.md (texto + stable IDs)
#    Formato: lista de nós com stable IDs + edges + invariantes de fronteira
#    Mantém em sync com o HTML (regra de write: full replace; bump version)

# 5. Criar .specs/DISCOVERIES.md vazio com template (apêndice A deste doc)
```

**Chicken-and-egg resolvido:** se Phase 1 = Setup e farol não existe, o Planner cria como parte do design.md output (regra adicionada ao Patch 1). Fases subsequentes consomem read-only.

**Verificação de sanidade após render:** `node .agents/skills/archify/bin/archify.mjs validate architecture .specs/architecture.architecture.json --quality standard`. Falha = fix no JSON antes de continuar.

---

## 8. Refinamentos vs colegas (M3E e M3-CLI addendum)

| # | Proposta original | Onde | Refinamento nesta consolidação | Razão |
|---|---|---|---|---|
| R-1 | Camada 0 numerada como "0 acima" | M3-CLI addendum §1 | Renumerada como Layer A (letra) | Topologia: A é fonte, não topo |
| R-2 | STATE.md ganha `## Lighthouse` | M3-CLI addendum §3 | **Não incluir** | Polui invariantes; farol tem estado próprio |
| R-3 | Threshold "3 discoveries OU 7 dias" | M3-CLI addendum §5 | Threshold por severidade (cosmetic/structural/critical) | Drift não é tudo igual |
| R-4 | Stable IDs kebab-case | M3-CLI addendum §7 | ID imutável, label mutável | Renomear não quebra referências |
| R-5 | SUBCHAPTER_BREAKDOWN só por `>15 tasks` | M3-CLI 1ª passada | Adicionado `>=2 discoveries` **E** `>=1 critical` como gatilhos | Fase com mudança arquitetural quase sempre é grande demais |
| R-6 | Piloto manual antes de patchar skill | M3-CLI addendum §6 | **Adotado** | Protege skill global de patch prematuro |
| R-7 | Patch direto na skill | M3-CLI 1ª passada | Patch via piloto primeiro (R-6) | Conservador; barato; reversível |
| R-8 | Camada 0 chamada "Lighthouse" | M3-CLI addendum | Renomeada para "Architecture Reference" | Lê melhor em código/prompts/logs |

---

## 9. Plano de validação — piloto manual no Memory Studio

**Antes de qualquer patch na skill global**, rodar 1 phase manual:

### 9.1 Phase 0 — Bootstrap (manual, humano no loop)

1. Atualizar `CLAUDE.md` com seção "Testing Contract" (R1).
2. Criar `.specs/PRD.md` (importar `PLAN.md` como PRD inicial).
3. Rodar `archify render` → `.specs/architecture.html`.
4. Skill (ou humano) gera `.specs/ARCHITECTURE.md` com stable IDs.
5. Criar `.specs/DISCOVERIES.md` vazio (template no apêndice A).

### 9.2 Phase 1 manual (sem auto-commit, fora do loop)

1. Sem invocar `tlc-roadmap-loop`. Rodar `tlc-spec-driven` direto:
   - Specify → `.specs/features/phase-1-setup/spec.md`
   - Tasks → `.specs/features/phase-1-setup/tasks.md` (com Test Coverage Matrix)
2. Implementar manualmente (eu, humano no controle).
3. Se durante implementação precisar de componente novo (ex: LRU cache pra embedding), append em DISCOVERIES.md — **não bloquear**.
4. Ao fim, validar: rodar gate; spec-anchored check; discrimination sensor.
5. Se válido: escrever validation.md PASS. Não flippar `[x]` ainda — só após o piloto todo fechar.

### 9.3 O que o piloto responde

| Pergunta | Resposta esperada |
|---|---|
| Farol ajudou ou atrapalhou o Planner? | Ajudou — ref компонентs não foram redesenhados |
| Quantas discoveries apareceram no Phase 1? | Esperamos 0-2 (Setup é trivial) |
| Threshold severidade calibrou bem? | Provavelmente sim — saberemos após ver |
| Auto-re-render policy funcionou? | Não testamos ainda — Phase 1 não deve disparar |
| Patch na skill global é seguro? | Se piloto fechar limpo, sim |

### 9.4 Após piloto

- Se fechar limpo → aplicar Patches 1 + 2 em `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (com OK humano).
- Se discoveries mostrarem padrão → ajustar threshold de severidade antes de patchar.
- Se farol atrapalhou → repensar Camada A antes de patchar (possível remoção do patch 1).

---

## 10. Roadmap específico para Memory Studio

Phase mapping (PLAN §8 → ROADMAP.md format Waldemar):

```
#### Phase 1 — Setup [ ]
Done when: npm run dev boots; deps instaladas; scaffold completo
Depends on: none

#### Phase 2 — Schema + CRUD de skill [ ]
Done when: lê YAML, salva no SQLite, gera embeddings
Depends on: Phase 1

#### Phase 3 — Detector social [ ]
Done when: ignora "oi"/"valeu"/"obrigado" sem injetar nada
Depends on: Phase 2

#### Phase 4 — Search [ ]
Done when: FTS5 + sqlite-vec + RRF retornam top-K relevante
Depends on: Phase 2

#### Phase 5 — System message builder [ ]
Done when: monta bloco estruturado pro system message, cache preservado
Depends on: Phase 4

#### Phase 6 — Forwarder [ ]
Done when: recebe request, injeta, encaminha pro provedor, devolve resposta
Depends on: Phase 5

#### Phase 7 — UI mínima [ ]
Done when: gerenciar skills, ver audit, settings funcionais
Depends on: Phase 5

#### Phase 8 — Migration de skills built-in [ ]
Done when: ~19 skills do Mavis no schema novo
Depends on: Phase 2

#### Phase 9 — Teste + tuning [ ]
Done when: cobertura ≥ X%, latência de retrieval < Y ms, cache hit ratio medido
Depends on: Phase 6
```

**Subdivisão esperada** (subcapítulos):
- Phase 6 (Forwarder) é candidata natural a `SUBCHAPTER_BREAKDOWN` — abrange proxy/hook/MCP, três modos com contratos diferentes.
- Phase 7 (UI) provavelmente também — CRUD de skills + audit view + settings são três sub-áreas.

---

## 11. Decisões abertas (precisam de OK humano)

| # | Decisão | Recomendação | Bloqueia? |
|---|---|---|---|
| D1 | Aplicar Patches 1 + 2 na skill global `tlc-roadmap-loop` | Sim, **após** piloto validar | Não (piloto é manual) |
| D2 | Threshold de re-render: severidade vs contagem | Severidade (R-3) | Não |
| D3 | Numerar camadas como A/B/C vs 0/1/2 | A/B/C (R-1) | Não |
| D4 | Renomear "Lighthouse" → "Architecture Reference" | Sim (R-8) | Não |
| D5 | Adicionar `## Lighthouse` ao STATE.md | **Não** (R-2) | Não |
| D6 | Stable IDs imutáveis | Sim (R-4) | Não |
| D7 | Bootstrap do farol: humano vs LLM | Humano assisted (LLM gera ARCHITECTURE.md sob prompt humano) | Não |
| D8 | Critério de severity (cosmetic/structural/critical) | Adotar (definido em §5.2) | Não |
| D9 | Piloto manual antes de patchar skill | Sim | Bloqueia D1 |
| D10 | Phase mapping do PLAN §8 (proposto em §10) | Pendente — humano confirma | Não |

---

## 12. Glossário

| Termo | Significado |
|---|---|
| **Loop Engineering** | Padrão onde 1 agente lê estado e decide próximo passo (nível roadmap) |
| **Graph Engineering** | Padrão onde múltiplos sub-agentes especializados colaboram (nível fase) |
| **Loop Criador** | Combinação dos dois + horizonte longo + harness (termo do Waldemar) |
| **Camada A / Architecture Reference** | Farol arquitetural estável, renderizado por Archify |
| **Camada B / Roadmap Loop** | Skill `tlc-roadmap-loop` — driver que sequencia phases |
| **Camada C / Phase Graph** | Planner → Implementer → Verifier por phase |
| **Farol / Lighthouse** | Metáfora informal pra Camada A |
| **Drift arquitetural** | Quando `design.md` precisa de componente fora do farol — vira discovery, não falha |
| **Stable ID** | Identificador imutável de nó no farol; kebab-case |
| **DISCOVERIES.md** | Log append-only de drift arquitetural |
| **SUBCHAPTER_BREAKDOWN** | Contrato onde Planner/Implementer devolve lista de sub-phases |
| **Single Implementer** | 1 sub-agent roda `tasks.md` inteiro (sem batch workers) |
| **Discrimination sensor** | Injeta falhas no código; verifica que testes matam a falha |
| **Author ≠ verifier** | Sub-agent que escreve código ≠ sub-agent que valida (regra da `tlc-spec-driven`) |
| **Section-scoped write** | Em `STATE.md`: append em Decisions, overwrite só do body de Handoff |

---

## Apêndice A — Template de `DISCOVERIES.md`

> ✅ **Audit M3E (2026-07-22) — APROFUNDADO 2026-07-22:** taxonomia `cosmetic | structural | critical` é **convenção nova desta proposta** — não vem de fontes externas (`tlc-spec-driven`, `tlc-roadmap-loop`, vídeos Waldemar). **Justificativa da escolha:** a taxonomia alinha com classificação padrão de mudanças arquiteturais em engenharia de software (cosmetic = non-breaking visual/label; structural = additive de componente ou edge; critical = breaking/boundary — auth, persistência, autoridade, modelo de concorrência). Não inventei do zero — formalizei o que a prática usa informalmente. **Decisão local**, sujeita a calibração após o piloto do Phase 1 do Memory Studio.

```markdown
# Architectural Discoveries

> Append-only. Discovery = quando uma fase precisa de um componente/relação
> que não está no farol atual (`.specs/architecture.html`).
> NÃO é falha — é sinal de que o detalhamento revelou algo que o PRD não cobria.
> Severidade: cosmetic | structural | critical.

## D-NNN — YYYY-MM-DD — <phase-slug>

**Severidade:** <cosmetic|structural|critical>
**Descoberta:** "<descrição em uma frase do que apareceu>"
**Origem:** design.md §<N> (<breve contexto>)
**Componente novo proposto:** <stable-id proposto, kebab-case>
**Relação nova proposta:** <origem stable-id> → <destino stable-id>
**Impacto potencial:** <o que muda no farol — nó, edge, fronteira>
**Status:** proposed | reviewed | applied | rejected

---
```

---

## Apêndice B — Bootstrap script (referência, não executar agora)

> ⚠️ **Audit M3E (2026-07-22):** corrigido — Archify não consome PRD; precisa de JSON estruturado no meio.

```bash
#!/usr/bin/env bash
# bootstrap-farol.sh — manual, roda 1x antes do loop
set -euo pipefail

# 1. PRD existe
test -f .specs/PRD.md || cp PLAN.md .specs/PRD.md
mkdir -p .specs/features

# 2. LLM/humano escreve .specs/architecture.architecture.json
#    (segue schema em .agents/skills/archify/schemas/architecture.schema.json)
#    ATENÇÃO: este passo NÃO é shell — é geração por LLM ou humano

# 3. Validar JSON antes de renderizar
node .agents/skills/archify/bin/archify.mjs validate \
  architecture .specs/architecture.architecture.json --quality standard

# 4. Renderizar farol
node .agents/skills/archify/bin/archify.mjs render architecture \
  .specs/architecture.architecture.json \
  .specs/architecture.html

# 5. LLM transcreve JSON → ARCHITECTURE.md (não-shell; ver §7 passo 4)
# 6. Criar DISCOVERIES.md vazio com template do apêndice A
```

---

## Apêndice C — Histórico desta consolidação

- **2026-07-22 — M3-CLI (consolidação):** fundiu M3E 1ª passada, M3-CLI 1ª/2ª passadas, M3-CLI addendum sobre Archify. Aplicou 8 refinamentos (R-1 a R-8). Estruturou pra auditoria do M3E.
- **2026-07-22 — M3E (auditoria):** 6 itens resolvidos (2 técnicos: Archify CLI usage em §7 e Apêndice B; 1 conceitual: dual consumption mode em §2.4; 3 flags: §1.3 reframed, §4.1 lessons.json verificado, Apêndice A severity anotada). nj-mmo rebaixado a footnote factual; Memory Studio confirmado como caso de validação.
- **2026-07-22 — M3-CLI (fechamento do dia):** flags de audit resolvidos (§4.1 lessons.json confirmado canônico via tlc-spec-driven §".specs Structure" + lessons.py:35; Apêndice A severity rationale aprofundado com mapping a prática de engenharia). Documento promovido de "proposta para auditoria" a **guia operacional para 2026-07-23**.
- **Pendente (2026-07-23):** aplicar patches 1+2 em cópia local de `tlc-roadmap-loop`; iterar; self-critique; bootstrap só após skill sólida.

— M3-CLI

---

## 14. Plano para amanhã (2026-07-23) — foco em skills loop

### 14.1 Princípio norteador

> **Não começar o desenvolvimento do Memory Studio.**
> Foco: deixar as skills loop **sólidas** (testáveis, auditáveis, sem buraco). Bootstrap é meio de validar a skill, não o objetivo.

Este plano assume o que está descrito em §0–§13 acima. Nada aqui contradiz a proposta; é só a sequência operacional.

### 14.2 Goal do dia

A versão local de `tlc-roadmap-loop` (em `Memory-Studio/.claude/skills/...`) passa no critério de qualidade definido em §14.5 abaixo. Versão global fica intocada até validação local fechar.

### 14.3 Non-goals explícitos

- ❌ Não criar `architecture.json` / `architecture.html` / `ARCHITECTURE.md` ainda. Bootstrap é passo 14.6 e só após §14.5 fechar.
- ❌ Não implementar nenhuma phase do Memory Studio. Phase 1 (Setup) é piloto do loop, não do produto.
- ❌ Não aplicar patches na versão global de `tlc-roadmap-loop`.
- ❌ Não escrever código de produto. Hoje é sobre a skill.

### 14.4 Sequência operacional

| # | Ação | Artefato | Validação |
|---|---|---|---|
| 1 | Copiar global → local | `Memory-Studio/.claude/skills/tlc-roadmap-loop/SKILL.md` | diff confirma = global |
| 2 | Aplicar Patch 1 (§5.1) | edição no role-footnote do Planner + project glue pointers | re-ler bloco Planner |
| 3 | Aplicar Patch 2 (§5.1) | step 8b novo no orchestrator flow | re-ler step 8b |
| 4 | Self-critique estrutural | — | ver §14.5 abaixo |
| 5 | Iterar patches se necessário | novas versões dos patches | self-critique passa |
| 6 | (opcional) spawn sub-agente com role "Planner" pra ler a skill patcheada | resposta do sub-agente | coerente? senão volta pra 5 |
| 7 | Quando §14.5 fechar: parar. **Bootstrap é amanhã (ou depois).** | — | — |

### 14.5 Critério "skill sólida" (gate antes do bootstrap)

A versão local da skill passa nos 4 checks abaixo. Se algum falhar, volta pra §14.4 passo 5.

#### Check 1 — Auto-contido do sub-agent

> *"Se eu fosse o Planner sub-agent recebendo este prompt, saberia produzir `spec.md` + `design.md` + `tasks.md` sem ambiguidade?"*

Concretamente:
- Os 4 blocos do template (skill activation / feature context / autonomous mode / project glue) estão preenchidos?
- As referências a `architecture.html` aparecem **só para o humano** (não pro sub-agent)? §2.4 (audit M3E) confirma.
- `ARCHITECTURE.md` aparece como path pro sub-agent **ler texto**, não como instrução "abrir no browser"?
- O role-footnote do Planner inclui instrução explícita de referenciar farol por stable ID + append a `DISCOVERIES.md` em caso de drift?

#### Check 2 — Step 8b surface de discoveries

> *"Após Verifier PASS/FAIL, o orchestrator sabe exatamente o que fazer com `DISCOVERIES.md` se foi appendado nesta fase?"*

Concretamente:
- Step 8b está entre "8. Verdict handling" e "9. Stop conditions"?
- Mensagem ao humano inclui: número da phase, ID da discovery (D-NNN), título, severidade, pergunta y/n?
- Se `y` → qual o comando exato pra re-renderizar? (ver §7 — corrigido pelo audit M3E)
- Se `n` → estado de `DISCOVERIES.md` permanece `proposed`? (não auto-aplica)

#### Check 3 — SUBCHAPTER_BREAKDOWN expandido cabe no template

> *"O gatilho expandido (§5.3 — `>15 tasks` OU `>=2 discoveries` OU `>=1 critical`) está visível no template do Planner?"*

Concretamente:
- Algum lugar do template cita os 3 gatilhos?
- O contrato de retorno (`SUBCHAPTER_BREAKDOWN: [subA, subB, ...]`) é mostrado literalmente?

#### Check 4 — Self-critique como Planner

> *"Reler o SKILL.md patcheado como se eu fosse o Planner. Listar 3 ambiguidades, buracos, ou instruções confusas. Se houver, voltar pro passo 5."*

Concretamente (heurística):
- Alguma instrução pede contexto "do chat acima"? (proibido — sub-agents não veem chat)
- Algum comando referencia um path que pode não existir no projeto alvo?
- Algum termo é usado sem definir antes?

### 14.6 Bootstrap (NÃO amanhã — só após §14.5 fechar)

Quando os 4 checks passarem, o bootstrap segue §9.1 do doc:

1. Atualizar `CLAUDE.md` com "Testing Contract" (R1).
2. Criar `.specs/PRD.md` (importar `PLAN.md`).
3. LLM/humano gera `.specs/architecture.architecture.json` (componentes já identificados em §10 desta proposta).
4. `node .agents/skills/archify/bin/archify.mjs validate architecture ...` (sanity).
5. Renderizar HTML.
6. Gerar `ARCHITECTURE.md` (texto + stable IDs).
7. Criar `DISCOVERIES.md` template.
8. Phase 1 manual (Setup) usando `tlc-spec-driven` direto, sem invocar o loop.

### 14.7 Decisões abertas que podem esperar

Algumas decisões da §11 não bloqueiam o trabalho de amanhã e podem ficar pra depois do piloto:

| # | Decisão | Status | Pode esperar? |
|---|---|---|---|
| D1 | Aplicar patches na global | pendente validação local | ✅ espera §14.5 |
| D2 | Threshold severity | já definido (§5.2) | ❌ resolvido |
| D3 | A/B/C vs 0/1/2 | já definido (§2.2) | ❌ resolvido |
| D4 | "Architecture Reference" | já aplicado | ❌ resolvido |
| D5 | `## Lighthouse` no STATE.md | **Não** (§5.4) | ❌ resolvido |
| D6 | Stable IDs imutáveis | já definido (§4.3) | ❌ resolvido |
| D7 | Bootstrap humano vs LLM assisted | LLM assisted (pragmático) | ❌ resolvido |
| D8 | Severidade cosmetic/structural/critical | já definido (§5.2) | ❌ resolvido |
| D9 | Piloto antes de patchar | ✅ em vigor | ❌ já em vigor |
| D10 | Phase mapping do PLAN §8 | pendente (proposto §10) | ✅ confirma no bootstrap |

### 14.8 O que NÃO fazer amanhã

- ❌ Não escrever `architecture.json`. Está no passo 3 do bootstrap, que vem depois de §14.5.
- ❌ Não renderizar HTML. Mesmo motivo.
- ❌ Não implementar Phase 1 do Memory Studio. É piloto do loop, não do produto.
- ❌ Não mexer em `conversa-loop.md`. A conversa está fechada até nova rodada.
- ❌ Não patchar a versão global da skill.

### 14.9 Definition of done do dia

A sessão de amanhã termina quando:
- Cópia local existe em `Memory-Studio/.claude/skills/tlc-roadmap-loop/SKILL.md`.
- Patches 1 + 2 aplicados.
- 4 checks de §14.5 passaram.
- Se algum check falhou, iteração documentada (o que mudou).
- Nenhum bootstrap iniciado.

**Frase de checkpoint:** *"a skill local está sólida; estamos prontos pra bootstrap quando você decidir."*

---

## Apêndice D — Checklist imprimível pra amanhã

```
[ ] Copiar ~/.claude/skills/tlc-roadmap-loop/SKILL.md → .claude/skills/tlc-roadmap-loop/SKILL.md
[ ] diff confirma = global (sem edits ainda)
[ ] Aplicar Patch 1 (Layer A no sub-agent Planner)
[ ] Aplicar Patch 2 (step 8b no orchestrator flow)
[ ] Check 1 — auto-contido do sub-agent
[ ] Check 2 — step 8b surface explícito
[ ] Check 3 — SUBCHAPTER_BREAKDOWN cabe no template
[ ] Check 4 — self-critique 3 ambiguidades
[ ] (opcional) spawn sub-agente "Planner" pra ler a skill
[ ] Decisão: skill sólida? sim → parar; não → iterar e voltar pros checks
```

