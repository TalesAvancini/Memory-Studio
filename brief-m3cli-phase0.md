---
date: 2026-07-22
author: M3E (M3-Executor)
scope: Phase 0 — Bootstrap do farol (Camada A)
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - proposta-consolidada.md §2 (3 camadas) e §3 (consumo dual)
  - PLAN.md §5 (stack) e §6 (decisões travadas)
  - CLAUDE.md (testing contract, autoridade, convenções)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (Turno 1 patcheada — congelada)
  - .agents/skills/archify/SKILL.md (CLI de render do farol)
  - handoff-session.md (Turno 3 do M3E)
next_step_brief: brief-m3cli-phase1.md (a criar após Phase 0 fechar)
---

# Brief — Fase 0 / Bootstrap do farol (Camada A)

## Contexto

- **Working dir:** `c:\Users\User\Desktop\AI-Project\Memory-Studio`
- **Skill loop** patcheada em `.claude/skills/tlc-roadmap-loop/SKILL.md` (Turno 1 ✅)
- **Seu job:** produzir os 4 artefatos da Camada A. **NÃO** começar Phase 1 do Memory Studio.
- **Quem audita depois:** M3E (M3-Executor, sessão atual).
- Bootstrap valida o loop end-to-end (lifecycle do farol); Phase 1 só vem depois.

## Pré-leitura (não restate, só aponte)

- `.agents/skills/archify/schemas/architecture.schema.json` — formato JSON obrigatório
- `.agents/skills/archify/SKILL.md` — comandos CLI
- `proposta-consolidada.md` §2 (3 camadas) e §3 (consumo dual)
- `PLAN.md` §5 (stack) e §6 (decisões travadas)
- `CLAUDE.md` — convenções (naming, sem LLM no hot path, decisão de multilingual-e5-small)

## Tarefa (8 passos — parar e reportar em qualquer erro, não improvisar)

### Passo 1 — Criar diretório `.specs/` na raiz do projeto

### Passo 2 — Gerar `.specs/architecture.architecture.json`

**Camada produto (Memory Studio):**

- `server` (Fastify HTTP)
- `augmenter` (prompt → augmented system message)
- `search` (FTS5 + sqlite-vec + reranker)
- `cache` (byte-string determinístico + sha256 hash)
- `social-detector` (regex de bypass)
- `agents` (proxy / hook / MCP adapters)
- `catalog` (YAML loader + SQLite writer + embedder)
- `embedding-model` (multilingual-e5-small, ONNX local, ~1GB)
- `catalog-yaml-files` (`config/skills/*.yaml`, versionado em git)
- `sqlite` (in-process)

**Camada orquestração:**

- `tlc-roadmap-loop`
- `tlc-spec-driven`
- `planner-subagent`
- `implementer-subagent`
- `verifier-subagent`
- `discoveries-log` (`.specs/DISCOVERIES.md`)
- `architecture-md` (`.specs/ARCHITECTURE.md` — farol em texto)

**Camada externa (renderer + integração com mundo):**

- `archify` (`.agents/skills/archify/`)
- `llm-provider` (Claude Code / Cursor / Aider / etc — alvo da injeção)
- `sqlite-fts5`
- `sqlite-vec`

**Edges (mínimas mas óbvias):**

- `server → augmenter`
- `augmenter → search`
- `augmenter → cache`
- `augmenter → social-detector`
- `agents → server`
- `catalog → catalog-yaml-files`
- `catalog → embedding-model`
- `search → sqlite-fts5`
- `search → sqlite-vec`
- `catalog → sqlite`
- `tlc-roadmap-loop → tlc-spec-driven`
- `tlc-roadmap-loop → planner-subagent`
- `tlc-roadmap-loop → implementer-subagent`
- `tlc-roadmap-loop → verifier-subagent`
- `tlc-roadmap-loop → discoveries-log`
- `planner-subagent → architecture-md` (lê farol)
- `archify → architecture-architecture-json` (renderer)
- `agents ← llm-provider`

**Convenção de IDs:** kebab-case, **IMUTÁVEL**. Labels mutáveis.

**Layers/agrupamento visual:** separar em `product` / `orchestration` / `external` se o schema permitir (consulte `architecture.schema.json`).

### Passo 3 — Validar JSON

```bash
node .agents/skills/archify/bin/archify.mjs validate architecture .specs/architecture.architecture.json
```

**Esperado:** exit 0, mensagem "✓ valid". Se falhar, ajustar JSON e re-validar. **Não prosseguir sem validação verde.**

### Passo 4 — Renderizar HTML

```bash
node .agents/skills/archify/bin/archify.mjs render architecture .specs/architecture.architecture.json .specs/architecture.html
```

**Esperado:** `.specs/architecture.html` criado, exit 0.

### Passo 5 — Gerar `.specs/ARCHITECTURE.md` (LLM-facing, texto)

- Espelho do JSON em prosa, com stable IDs em headings ou inline
- Marque **explicitamente** no topo: *"ESTE ARQUIVO É LIDO COMO TEXTO. NÃO abrir `architecture.html` no contexto do sub-agent."*
- Seção **"Dual consumption"**: humano lê `architecture.html` (visual, interativo); LLM/sub-agent lê ESTE `.md` (texto, stable IDs)
- Apontar caminhos de todos os artefatos da Camada A ao final: `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/DISCOVERIES.md`, `.specs/architecture.architecture.json`

### Passo 6 — Criar `.specs/DISCOVERIES.md` vazio com header

```markdown
# Discoveries

Log append-only de drift arquitetural. Append-only — nunca editar entrada existente (severidade pode evoluir em entry nova referenciando a antiga).

## Severidade
- **critical**: boundary change (auth / persistence / authority / concurrency model) — escalates immediately, bloqueia próxima fase
- **structural**: novo componente/edge que muda topologia — acumula; 3+ auto-suggests re-render
- **cosmetic**: label/agrupamento/naming — log only, não surface

## Schema de entrada

| ID    | Severidade                       | Descrição | Fase |
|-------|----------------------------------|-----------|------|
| D-NNN | `cosmetic\|structural\|critical` | …         | F-N  |

---

*(vazio — primeira entrada virá da Phase 1)*
```

### Passo 7 — Verificar pré-condições de Waldemar

- `npm test` < 10s? — `package.json` **NÃO existe ainda** (CLAUDE.md §Quick reference é placeholder). **NÃO rodar npm.** Reportar essa condição como *"pré-condição #1 do Waldemar ainda não satisfeita; prevista pra Phase 1 quando bootstrap entrar"*.
- Outras 3 (verifier binário, ≥5 phases backlog, project glue): reportar status presumido (provavelmente OK em tese).

### Passo 8 — Reporte final

Incluir no retorno:

- Lista dos 4 paths criados com tamanho em bytes
- Exit codes dos 2 comandos archify (Passo 3 e Passo 4)
- Contagem de nodes/edges no JSON
- Decisões de naming/labels que precisou tomar (pra M3E auditar labeling)
- Status da pré-condição #1 do Waldemar
- Hash do commit se fizer conventional commit

## Restrições CRÍTICAS

- **NÃO** tocar `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (global preservada — intocada até validação final)
- **NÃO** tocar `.claude/skills/tlc-roadmap-loop/SKILL.md` (skill local já está patcheada, congelada)
- **NÃO** rodar `npm install` nem `npm test` (package.json não existe)
- **NÃO** criar Phase 1 do Memory Studio
- **NÃO** promover nada a global
- **NÃO** editar `proposta-consolidada.md`, `conversa-loop.md`, `CLAUDE.md`, `handoff-session.md`, nem `brief-m3cli-phase0.md` (este arquivo)
- Conventional commits permitidos pra registrar o bootstrap (git está disponível, package.json não é pré-requisito)

Se travar em qualquer passo: **parar e reportar** com o erro literal + sua hipótese de causa. Não improvisar correções estruturais.

---

## Gate de auditoria M3E (será aplicado após seu retorno)

M3E audita contra estes critérios antes de declarar PASS:

1. JSON válido contra schema archify
2. Todos os nodes batem com `PLAN.md §5` + `proposta-consolidada.md §2` (cruzamento um-por-um)
3. HTML renderizou, exit codes 0 nos 2 comandos archify
4. `.specs/ARCHITECTURE.md` espelha o JSON, marca consumo dual, stable IDs consistentes
5. `.specs/DISCOVERIES.md` header tem regra de severidade explícita (3 níveis com definição)
6. Zero side-effects em arquivos pré-existentes (git status limpo do que já existia)
7. `package.json` continua não existindo (não rodou npm por engano)

Qualquer divergência vira issue rankeada (cosmetic / structural / critical) segundo a taxonomia do `.specs/DISCOVERIES.md`.
