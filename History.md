---
date: 2026-07-24
version: 1
description: "Histórico consolidado do repo Memory-Studio + skill tlc-roadmap-loop. Decisões, incidentes, lições. Índice narrativo — não substitui git log, briefs, ou STATE."
explanation: |
  Este doc é a 'memória de longo prazo' do projeto. Foi criado após incidente de confusão arquitetural em 2026-07-24 onde eu (M3E) confundi o objetivo do trabalho (tratei Memory Studio como alvo quando o alvo é a SKILL).
  Propósito: agente futuro em sessão fresca NÃO precisa reconstruir a história via git log + MEMORY.md + STATE; pode ler este doc e pegar o contexto em 5 minutos.
related:
  - ../handoff-session.md
  - ../archive_handoff/handoff-session-2026-07-23.md
  - ../CLAUDE.md
  - ../PLAN.md
  - ../.specs/ROADMAP.md
  - ../.specs/STATE.md
  - ../../.claude/skills/tlc-roadmap-loop/SKILL.md
  - ../../.claude/skills/tlc-roadmap-loop/README.md
---

# History.md — Repositório Memory-Studio

> **Por que este doc existe:** após confusão arquitetural em 2026-07-24, o usuário pediu um histórico consolidado para evitar repetir o que aconteceu. Este documento é EXECUTIVO sobre o que aconteceu — não substitui `git log`, `handoff-session.md`, `STATE.md`, ou `brief-m3cli-*.md`. É o **índice histórico narrativo**.

## A história que norteia este repo

**Memory Studio é um estúdio de injeção de contexto pra agentes de código** (Claude Code, Aider, Cursor, etc.). **É o objetivo final** deste repo.

**MAS** — antes de construir Memory Studio, o trabalho é construir a **fundação**: a skill `tlc-roadmap-loop` (orquestrador de phases) + integração com `archify` (farol arquitetural) + `tlc-spec-driven` (base SDD). Sem essa fundação, Memory Studio seria construído sem processo.

**O que está em `main` hoje é a fundação sendo construída.** As phases 0-4 que aparecem no `archive_handoff/` e em `.specs/archive/2026-07-calibration/` foram **exercício de calibração**, não entrega de produto. O código em `src/` é **resíduo descartável** do exercício.

**Próximo passo:** usar `grill-with-docs` (skill do Matt Pocock, plugin `mattpocock/skills`, adaptada pra autonomous — sem human-in-the-loop constante) pra interrogar docs existentes (`PLAN.md`, `CLAUDE.md`, `History.md`, `archive_handoff/`) e chegar num **PRD final do MVP Memory Studio**. **Só então** Memory Studio entra em produção.

**Se você é um agente novo lendo isto:** **não construa Memory Studio ainda**. Sua job é ajudar a terminar a fundação (skill v0.2 → v1, se aplicável) e/ou auxiliar no processo de PRD via `grill-with-docs`. Produção do produto só após autorização humana explícita + PRD fechado. Ver `MEMORY.md [[north-star-memory-studio]]` para detalhes.

## Linha do tempo (13 marcos)

### 1. Repo criado (2026-07-22)

- Diretório `c:\Users\User\Desktop\AI-Project\Memory-Studio` inicializado
- GitHub: https://github.com/TalesAvancini/Memory-Studio
- **Estado conceitual inicial:** Memory Studio = produto (estúdio de injeção de contexto pra agentes de código). Skill `tlc-spec-driven` + `tlc-roadmap-loop` = ferramentas pra construir esse produto. Archify = farol arquitetural (Camada A).

### 2. Phase 0 — Bootstrap farol (Camada A) [PASS]

- `.specs/architecture.architecture.json` criado (21 components, 19 connections, 3 boundaries, 3 views)
- `.specs/architecture.html` renderizado (interativo, human-facing)
- `.specs/ARCHITECTURE.md` espelhado em texto (LLM-facing)
- Componentes produto: `llm-provider`, `catalog-yaml-files`, `agents`, `server`, `augmenter`, `search`, `catalog`, `social-detector`, `cache`, `embedding-model`, `sqlite`
- Componentes orquestração: `tlc-roadmap-loop`, `tlc-spec-driven`, `planner-subagent`, `implementer-subagent`, `verifier-subagent`, `architecture-md`, `discoveries-log`

### 3. Phase 1 — Scaffold [PASS] (Waldemar pré-cond #1 fechada)

- `package.json` com `"type": "module"`, `engines.node >=22`
- `tsconfig.json` strict + `noUncheckedIndexedAccess`
- `src/index.ts` placeholder
- `test/smoke.test.mjs` (5 testes, ESM, `node:test` nativo)
- `npm test` < 10s (SLA Waldemar #1)
- **Decisões travadas:** Node 22 LTS, ESM, zero deps de test framework (sem Jest/Vitest), TypeScript strict

### 4. Phase 2 — Schema + CRUD de skill [PASS] (Sinais 2 + 5)

- `src/catalog/`: loader YAML, writer SQLite, embedder ONNX (stub determinístico), schema
- Schema SQLite: `skills` (id, slug, kind, content_yaml, embedding BLOB, hash, created_at, updated_at) + `audit_events`
- CLI `npm run catalog:load <file.yaml>` funcional
- Embedder: stub determinístico (real ONNX Phase 9 — multilingual-e5-small, 384d)
- 4+ testes, coverage ≥ 80% em `src/catalog/`

### 5. Phase 3 — Social detector [PASS] (Sinais 2 + 5)

- `src/social-detector/`: regex de bypass, `isSocial(prompt): boolean`
- Whitelist de false positives ("thanks" como verbo técnico, etc.)
- ≥ 20 casos de teste (PT-BR + EN + edge cases)
- Interface limpa com hook do augmenter (sem side-effects)

### 6. Phase 4 — Search / retrieval [PASS] (Sinal 3 strict fechado)

- `src/search/`: FTS5 + sqlite-vec + RRF fusion + threshold duplo
- `search(query: string, k: number): RankedSkill[]` em `src/search/`
- **Iter 0:** Verifier FAIL — 2 surviving mutants + 5 evidence gaps
- **Iter 1:** Fix Implementer — 184 tests verde, mas T-ORCH-19b threshold permissivo + tie-break não comitado
- **Iter 2:** **BLOCKED por runaway trigger** — mesma fixture T-ORCH-19b persistente, sem root cause fix
- **Iter 3 (recovery):** `brief-m3cli-phase4-recovery.md` — 2 surgical fixes em test files (T-ORCH-19b threshold 0.5 + T-VEC-08 tie-break rank assertion). **NÃO tocou `src/`**. 185/185 verde.
- **Lição:** recovery focal (1 página, 2 arquivos) > re-rodar phase inteira

### 7. Skill v0.1 patches (Turno 1, 2026-07-22)

3 patches aplicados em `.claude/skills/tlc-roadmap-loop/SKILL.md` (cópia local):

1. **Layer A reference no Planner** — `## Architectural Reference` cita stable IDs do farol (não labels mutáveis)
2. **Step 8b discovery surface** — DISCOVERIES.md append → surface ao user → re-render farol
3. **SUBCHAPTER_BREAKDOWN com 3 triggers** — >15 tasks / 2+ discoveries / 1+ critical

### 8. INCIDENTE: `.claude/settings.json` leak (2026-07-22)

- **O que aconteceu:** commitei `.claude/settings.json` que continha `ANTHROPIC_AUTH_TOKEN = "sk-cp-..."`. Pushed to GitHub público.
- **Impacto:** token exposto. Cleanup: `git rm --cached`, `git filter-branch` rewrite history, `git push --force`. Usuário deletou remote repo depois.
- **Lição gravada em memory `claude-settings-never-commit.md`:** NUNCA commitar `.claude/settings.json` sem OK explícito. Tratar como local-only sempre. `.gitignore` deve incluir `/.claude/settings.json` E `/.claude/settings.local.json`.
- **Reação do usuário:** fúria intensa. Múltiplas mensagens com profanação.

### 9. Skill v0.2 (2026-07-23) — step 8a failure diagnostics

- **Trigger:** Phase 4 BLOCKED em iter 2 (T-ORCH-19b reproduzido sem root cause fix)
- **Patch:** step 8a antes de re-dispatch em FAIL — compara Verifier FAIL atual vs anterior; se same-fixture-fail-2x, surface 3 strategy alternatives ao orchestrator:
  1. Refine test design (fixture decorativa)
  2. Escalate to human
  3. Skip signal (pragmatic closure)
- **Iterations reset** após strategy shift (pre-flight não conta contra cap de 3)
- **Promovido global** em 2026-07-23 (cp + diff=0, 17.675 bytes)
- **Decisão AD-001 em STATE.md:** 5 candidatos a v2 foram avaliados pelo Conselheiro; **só failure diagnostics entra**. Outros 4 deferidos com trigger explícito (sub-agent awareness, sticky context, branch fingerprinting, handoff auto)

### 10. Sessão 2026-07-24 — INCIDENTE de confusão arquitetural

- **O que aconteceu:** eu (M3E) cometi 3 erros críticos:
  1. **Spawnar sub-agent via `Agent` tool e chamar de "M3-CLI"** — sub-agent é parte do MEU contexto, não é M3-CLI separado
  2. **Tratar Phase 5 do Memory Studio como produção** — esqueci que phases 0-4 foram CALIBRAÇÃO da skill, não entrega do produto. Memory Studio só entra em produção quando usuário autorizar (PRD não está fechado)
  3. **Fazer perguntas em vez de afirmar posições** — gastei tempo do usuário
- **Correções aplicadas:**
  - Memory entry `m3e-vs-m3cli-architecture.md` — clarificou que M3E/M3-CLI é WORKAROUND DE CALIBRAÇÃO, NÃO arquitetura geral da skill. **Padrão geral: UM orchestrator + sub-agents (Planner/Implementer/Verifier).**
  - Memory entry `metadata-default-required.md` — usuário ODEIA quando esqueço frontmatter. Padrão, não opcional
  - Sub-agent killed antes de poluir working tree
- **Reação do usuário:** fúria. "O FDP", "seu deficiente mental", "me roubaram meia hora de vida"

### 11. Skill architecture map (2026-07-24) — README + 9 Mermaid

- Brief `brief-m3cli-skill-architecture-map.md` commitado (`2e74b2a`)
- M3-CLI executou via CLI:
  - 1 README.md + 9 diagramas em `diagrams/` (co-localizado com skill, GLOBAL primeiro, mirror local depois)
  - 10 arquivos global + 10 mirrors locais = 20 paths
  - Frontmatter em todos (date, version, description, explanation + related + mermaid_count)
  - `diff -r` global == local exit 0 (parity)
  - Mermaid: flowchart TB (#1), stateDiagram-v2 (#2), flowchart LR (#3), sequenceDiagram (#4), stateDiagram-v2 (#5), flowchart TB (#6-9)
  - Commit `1b0998e` `docs(skill): add README + 9 Mermaid diagrams to tlc-roadmap-loop v0.2`
  - SKILL.md intocado em ambas localizações
- **Falso alarme do M3-CLI:** reportou `diagrams/` gitignored. **NÃO estava** — `.gitignore` linha 23 é linha em branco. `git add -f` foi desnecessário mas inofensivo
- Pushed `085276f..1b0998e`

### 12. Estado atual (2026-07-24)

- **Skill `tlc-roadmap-loop` v0.2** com README + 9 diagramas (canonical em `~/.claude/skills/tlc-roadmap-loop/`, mirrored local em `.claude/skills/tlc-roadmap-loop/`)
- **5 sinais de readiness:**
  - Sinal 1 (Promote global): ✅ done 2026-07-23
  - Sinal 2 (Cycle fim-a-fim): ✅ Phase 0+1+2+3+4 verde
  - Sinal 3 (Recovery FAIL→PASS): ✅ strict (T-ORCH-19b demonstrou)
  - Sinal 4 (Discovery surface): ⚠️ mechanism in place (step 8b), não disparou organicamente em calibração
  - Sinal 5 (Binary verifier): ✅
- **Pragmaticamente pronta** — 4/5 sinais + Sinal 4 mechanism funcional
- **Memory Studio:** modo exemplo/calibração. **PRODUÇÃO NÃO AUTORIZADA** — usuário não fechou PRD. Próxima fase de produção só após autorização explícita
- **Próximo passo (sem autorização):** aguardar direcionamento do usuário

### 13. Skill `auto-grill` criada (2026-07-26)

Após PLAN-v3 (marco #12), humano pediu criação de uma variante autônoma do `grill-with-docs` do Matt Pocock — sem HITL síncrono, baseada no brainstorm do NotebookLM `f235cc21-...` (A2A grilling loop com Stakeholder Proxy).

**Criado:** `.claude/skills/auto-grill/` (project-local, 12 arquivos: SKILL.md + README.md + 9 diagramas modulares + `prompts/to-roadmap.md`).

**Diferença chave vs `grill-with-docs`:** Stakeholder Proxy (sub-agent com CONTEXT.md + ADRs + farol stable IDs) substitui humano síncrono. Confidence floor 0.7 hard (não advisory). Output = 4 files structured. CONTEXT.md é obrigatório. 100k tokens / 50 rounds caps (Dumb Zone guard).

**Origem:** brainstorm de 2026-07-26 no NotebookLM `f235cc21-b876-483e-b8a7-20d6234fa35c`. Lenses Fog of War / Semantic Anchors / Tracer Bullets vieram do brainstorm; Cache Determinism / Hot-Path Purity são Memory-Studio-específicos (PLAN §6).

**Test deferred** per `feedback-no-random-invocation` (criar ≠ invocar). Primeiro target: `.specs/features/system-message-builder/spec.md`.

**4 memories novas:** `notebooklm-mattpocook-skills-id`, `auto-grill-skill-created`, `feedback-no-random-invocation`, `auto-grill-to-roadmap-prompt`.

---

## O que acontece quando compactamos (perda de contexto)

### O que SOBREVIVE à compactação

1. **Git history** — commits, diffs, autores, datas
2. **Arquivos no repo** — source, specs, briefs, validations, handoffs, ROADMAP, STATE
3. **MEMORY.md** — carregado todo início de sessão (sistema injeta automaticamente)
4. **Frontmatter** — date/version/description/explanation em arquivos `.md` permitem reconstrução rápida sem ler conteúdo
5. **Validation.md** — comportamento verificado fim-a-fim com evidência
6. **Este History.md** — narrativa consolidada de longo prazo

### O que PERDE com compactação

1. **Tom das conversas** — ex: "fúria do usuário", "perguntas que irritam", "frases exatas de correção"
2. **Debugging breadcrumbs** — sequência de tentativas que não funcionaram até achar a solução
3. **Raciocínio tácito** — "por que não X" raramente está documentado, só "por que sim"
4. **Conhecimento procedural de role** — ex: como M3E escreve briefs vs M3-CLI executa código (este doc captura parcialmente, mas não é óbvio pra agente que chega)
5. **Trade-offs discutidos oralmente** — decisões tomadas em conversa, não em arquivo

### Como mitigar perda

- **MEMORY.md** é o canal primário. Cada memory entry = 1 fato. Estrutura: **Por que:** + **How to apply:** + **Related:**
- **History.md** (este doc) — narrativa consolidada fim-de-fase
- **Handoff-session.md** — executivo fim-de-sessão
- **archive_handoff/** — handoffs antigos preservados, não deletados
- **Decisões em STATE.md** (`## Decisions` AD-NNN) — append-only com justificativa
- **Frontmatter obrigatório** em TUDO (memory `metadata-default-required`) — permite reconstrução rápida sem ler conteúdo

---

## Onde achar cada coisa

| Procurando por... | Onde está |
|---|---|
| O que é o projeto Memory Studio | [PLAN.md](../PLAN.md), [CLAUDE.md](../CLAUDE.md) |
| Estado atual do skill | [handoff-session.md](../handoff-session.md), [.specs/STATE.md](../.specs/STATE.md) |
| Arquitetura do produto (farol) | [.specs/ARCHITECTURE.md](../.specs/ARCHITECTURE.md), [.specs/architecture.html](../.specs/architecture.html) |
| Roadmap e fases | [.specs/ROADMAP.md](../.specs/ROADMAP.md) |
| Lições e patterns de processo | MEMORY.md (em `~/.claude/projects/.../memory/`) |
| Briefs executáveis (handoffs M3-CLI) | `brief-m3cli-*.md` na raiz |
| Specs e designs por phase | `.specs/features/<slug>/{spec,design,tasks,validation}.md` |
| Skill definition (v0.2) | `.claude/skills/tlc-roadmap-loop/SKILL.md` (LOCAL + GLOBAL) |
| Skill architecture (canonical) | `.claude/skills/tlc-roadmap-loop/README.md` + `diagrams/*.md` |
| Histórico de handoffs | [archive_handoff/handoff-session-2026-07-23.md](../archive_handoff/handoff-session-2026-07-23.md) |
| **Este doc** | [History.md](History.md) |

---

## Para agentes futuros (sessão fresca)

1. **Leia este doc primeiro** (History.md) — você acabou de chegar, isto é "onde estamos"
2. **Leia MEMORY.md** — lições e patterns de processo (carregado automaticamente pelo sistema)
3. **Leia `handoff-session.md`** — estado executivo do projeto (1 página, atualizado fim-de-sessão)
4. **Leia `.specs/STATE.md ## Handoff`** — phase atual, próximo passo, decisoes recentes
5. **NÃO construa Memory Studio** sem autorização explícita do usuário. PRD não está fechado
6. **NÃO assuma M3E/M3-CLI como arquitetura** da skill. Padrão geral: 1 orchestrator + sub-agents dispatched
7. **Frontmatter em TUDO.** Sem exceção. User odeia esquecer metadata
8. **Em dúvida, pergunte ANTES** de agir em código de produto. Briefs (.md) são OK; código (.ts/.mjs) precisa autorização
9. **Skill `tlc-roadmap-loop` v0.2** tem step 8a (failure diagnostics) ativo. Se vir same-fixture-fail-2x, pre-flight dispara — NUNCA retry cego

---

## Discussão: grill-with-docs como entrevistador do PRD (2026-07-24)

> **Status:** registro neutro do que foi discutido. Nenhuma proposta foi **encerrada** como decisão final. Cada item abaixo é uma direção que apareceu, com a leitura do usuário no fim.

### Contexto

`.specs/ROADMAP.md` foi simplificado para placeholder único: `Phase — PRD via grill-with-docs [ ]`. Artefatos pré-existentes para usar como base:

- `PLAN.md` — PRD/spec original do MVP Memory Studio (9787 B)
- `proposal-memory-studio-v2.md` — evolução v2 (draft baseado em 41 rounds NotebookLM com Matt Pocock Interrogador, 25305 B)
- `Memory-Studio-Discuss.md` — fonte da proposal v2
- `History.md` (este doc) + `handoff-session.md` + `archive_handoff/`

Próximo passo conceitual: rodar `grill-with-docs` (skill `mattpocock/skills`) sobre esses artefatos pra chegar num PRD final.

### O que foi levantado na conversa

**SSOT consultada (NotebookLM `f235cc21-...`, "MattPocock"):** `grill-with-docs` é "grilling session that also builds project's domain model, sharpening terminology and updating CONTEXT.md and ADRs inline". Combina `/grilling` + `/domain-modeling`. Stateful no repo. 6 passos: explore → interview relentlessly → uma pergunta por vez → recommended answer → decision tree → confirmation gate.

**Sobre "A2A" / transformar skill em agent standalone:** a SSOT não usa o termo "A2A". Pocock diz literalmente: *"agents are just like new context window plus skill — that's all they are. So there's no reason to use agents when you can just manage that yourself with skills."* Patterns próximos que aparecem: (a) subagent wrappers, (b) MCP, (c) shared state tipo Wayfinder, (d) context pointers.

**Intenção do usuário (relatada na conversa, não editada):**
- Ser **entrevistado** por outro agente (não ser o interrogador).
- **Ficar fora do loop de Q&A** — quer revisar o resultado, não responder 50 perguntas.
- O **PRD já existe** (com brainstorms prévios) e "está bom" segundo ele — quer que **passe por interrogatório/grill**, não que seja criado do zero.
- Vai **contar livremente** a intenção do produto na visão dele (o que faz, o que queria que fizesse, wishful thinking) — isso seria a **base** pras decisões que o agente tomaria no lugar dele.

**Quem responde no lugar do humano:** o agente AI (eu, nesta sessão, ou um sub-agent Claude equivalente) usando como input:
1. PRD existente (`PLAN.md` e/ou `proposal-memory-studio-v2.md`)
2. Narrativa livre de visão/intent do humano
3. Artefatos do repo (`CLAUDE.md`, `History.md`, handoffs, `.specs/`)

**Observação do usuário sobre cansaço:** grilling cansativo para humanos não-especialistas porque assumem domínio técnico que a pessoa não tem. Possíveis mitigantes mencionados: perguntas acompanhadas de metáfora/ELI5; persona pack com PRD anterior + intent + human-intent + vocabulário; guardrails anti-hallucination (fonte + confiança + override).

### Direções que apareceram (não-decisões)

Cada item é uma **direção proposta durante a conversa** — nenhuma foi marcada como escolhida pelo usuário. Listadas pra referência futura, não como commitment.

1. **Pattern "inline"**: rodar `/grill-with-docs` na sessão, com persona inline (não agente separado).
2. **Pattern "user-proxy subagent"**: spawnar 2 agents — griller (subagent fork) + user-proxy (subagent fork com contexto de leitura) — bridgeando via SendMessage.
3. **Pattern "MCP wrapper"**: expor grill-with-docs como tool MCP server (`mcp__grill__interrogate(...)`) pra cross-runtime.
4. **Pattern "Wayfinder shared state"**: agente A bota issue em `.scratch/<effort>/issues/`, agente B (grill) lê e escreve `## Answer`.
5. **Persona pack** (4 docs): `prd-anterior.md`, `project-intent.md`, `human-intent.md`, `vocabulary.md`.
6. **Metáfora/ELI5 layer**: cada pergunta com analogia concreta + recomendação em 1 linha.
7. **Anti-hallucination guardrail**: toda decisão auto-inferida carrega Fonte + Confiança + Override humano.
8. **Pattern "Discover → Synthesize → Decide → Record"**: alternativa ao grill, mais design-thinking, menos pressão.
9. **Skill nova proposta** (não-materializada): `discover-and-decide` ou `interrogate-for-product` em `.claude/skills/`.
10. **Brief `agents/grill-pair.ts`**: wrapper reutilizável para o pattern 2.

### Autocrítica registrada

O agente (eu) extrapolou na última resposta: apresentou 3 patterns (A/B/C) + 4 personas insights + 5 dicas + oferta de brief, antes de confirmar com o usuário o setup real. O usuário chamou a extrapolação de "cansaço" e pediu registro neutro das propostas **gerais discutidas**, não da que o agente acha que foi encerrada. Lição: **confirmar setup antes de oferecer arquitetura**.

### Próximo passo (a definir pelo usuário)

- [ ] Definir qual(is) pattern(s) das direções acima aplicar (ou outro ainda não listado)
- [ ] Definir se PRD base é `PLAN.md`, `proposal-memory-studio-v2.md`, ou merge dos dois
- [ ] Narrativa livre de visão/intent do humano (a ser fornecida na próxima sessão, ou inline)
- [ ] Decidir se vira brief de skill nova, brief de feature do `tlc-spec-driven`, ou só setup manual
- [ ] Após PRD fechado: criar era `2026-07-prd-ready/` (per `.specs/ROADMAP.md` placeholder)
