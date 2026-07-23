---
date: 2026-07-22
author: M3E (M3-Executor)
scope: Phase 2 — Create `.specs/ROADMAP.md` (fecha pré-condição #3 do Waldemar)
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - brief-m3cli-phase0.md (✅ — bootstrap farol)
  - brief-m3cli-phase1.md (✅ — scaffold npm test < 10s)
  - .specs/ARCHITECTURE.md (Camada A — stable IDs pra naming)
  - PLAN.md (§8 — fases MVP candidatas)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL patcheada — formato canônico)
  - handoff-session.md (Turno 3+ — sequência canônica)
preceded_by: brief-m3cli-phase1.md
next_step_brief: brief-m3cli-phase3.md (a criar após pré-cond #3 fechar)
---

# Brief — Phase 2 / ROADMAP do produto (pré-condição #3 do Waldemar)

## Contexto

- **Working dir:** `c:\Users\User\Desktop\AI-Project\Memory-Studio`
- **Objetivo:** fechar a pré-condição #3 do Waldemar (`≥ 5 phases backlog` materializado em `.specs/ROADMAP.md`).
- **Por que essa fase:** o orchestrator `tlc-roadmap-loop` lê `.specs/ROADMAP.md` a cada iteração pra escolher a próxima phase. Sem isso, o loop não roda.
- **Quem audita:** M3E.
- **Manual:** Phase 2 também é **fora do loop**, sem auto-commit, igual Phase 1.

## Pré-leitura (apontar, não restatar)

- [`.claude/skills/tlc-roadmap-loop/SKILL.md`](../.claude/skills/tlc-roadmap-loop/SKILL.md) — seção **"ROADMAP.md format expected by this loop"** (formato canônico obrigatório)
- [.specs/ARCHITECTURE.md](../.specs/ARCHITECTURE.md) — stable IDs (kebab-case) pra nomear phases/edges consistente
- [PLAN.md](../PLAN.md) **§8** — fases MVP candidatas (principal fonte)
- [brief-m3cli-phase0.md](brief-m3cli-phase0.md) e [brief-m3cli-phase1.md](brief-m3cli-phase1.md) — antecedentes

## Restrição herdada

⚠️ **JAMAIS tocar `.claude/settings.json` nem `.claude/settings.local.json`** — locais por convenção. Read-only se precisar olhar.

## Tarefa — 1 arquivo + 5 passos

### Passo 1 — Validar forma canônica

Reler a seção "ROADMAP.md format expected by this loop" no skill local `.claude/skills/tlc-roadmap-loop/SKILL.md`. Estrutura obrigatória:

- `# Roadmap: <Product>` (h1)
- Bloco `>` com nota: source of truth do loop, status = checkbox no fim do `####`
- `## Hard dependency order` (uma linha de regra, ou "follow the Depends on: lists below")
- ≥ 5 fases numeradas com `#### Phase N — <Title> [ ]` / `[~]` / `[x]`
- Cada phase: `**Done when:** <demoável>`, `**Depends on:** <lista>`, lista de sub-items `- [ ] ...`
- **Status legend** ao final: `[ ] pending · [~] in progress · [x] done`

### Passo 2 — Selecionar ≥ 5 fases

**Fonte primária:** [PLAN.md](../PLAN.md) §8. Use o que está lá se já houver lista estruturada.

**Fallback (só se PLAN §8 estiver esparso):** derivar ≥ 5 fases alinhadas aos componentes do farol:

1. Foundation (scaffold) — server Fastify boot [✅ já]
2. Catalog loader — YAML → SQLite + embeddings
3. Search / retrieval — FTS5 + sqlite-vec + rerank
4. Augmenter core — orquestração query (search + cache + social-detector)
5. Cache determinístico — byte-string + sha256
6. Social detector — regex de bypass
7. Agent adapters — proxy / hook / MCP integration
8. End-to-end smoke — fluxo LLM provider → server → resposta
9. Hardening + coverage ≥ 80% — testes, docs, exemplos

**Critérios de qualidade por phase:**

- **Done when:** tem que ser **demoável** — request/response HTTP, arquivo SQLite populado, embed gerado, query retorna K items, etc. NÃO "código escrito".
- **Depends on:** faz sentido em DAG (sem ciclos). Planner depende de catalog; augmenter depende de search + cache, etc.
- **Sub-items:** 3-8 por phase, granularidade de tasks atômicas (cada uma cabe num commit).

### Passo 3 — Escrever `.specs/ROADMAP.md`

Marque **Phase 1 como `[x]`** (já entregue no brief-m3cli-phase1.md). Marque **Phase 2** como `[ ]` e preencha com a próxima entrega real (provavelmente algo da arquitetura — catalog ou search).

**Não invente** phases que misturem domínios. Cada phase = uma área coerente.

### Passo 4 — Verificar (4 checks automatizados)

```bash
cd "c:\Users\User\Desktop\AI-Project\Memory-Studio"

# Check 1: ≥ 5 phases
grep -c "^#### Phase " .specs/ROADMAP.md         # esperado: ≥ 5

# Check 2: ≥ 5 campos "Depends on:"
grep -c "Depends on:" .specs/ROADMAP.md            # esperado: ≥ 5

# Check 3: Phase 1 está [x]
grep "^#### Phase 1 — " .specs/ROADMAP.md | grep -c "\[x\]"   # esperado: 1

# Check 4: status legend presente
grep -F "[ ] pending" .specs/ROADMAP.md | grep -c "."          # esperado: ≥ 1
```

Todos os 4 devem retornar valores esperados antes de declarar pronto.

### Passo 5 — Reporte

Incluir:

- ✅ Path + tamanho do `.specs/ROADMAP.md`
- ✅ Contagem de phases (esperado ≥ 5)
- ✅ Lista numerada das fases com 1 linha de "Done when" cada
- ✅ Resultado dos 4 checks do Passo 4
- ✅ Decisões de ordering/dependência que precisou tomar (pra eu auditar)

## Restrições CRÍTICAS

- ❌ **NÃO** implementar feature nenhuma — só escrever o `.specs/ROADMAP.md`
- ❌ **NÃO** tocar `.claude/settings*.json`, `.claude/skills/*`, `.agents/*`
- ❌ **NÃO** tocar `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/DISCOVERIES.md`, `.specs/architecture.architecture.json`
- ❌ **NÃO** tocar `package.json`, `tsconfig.json`, `src/`, `test/` (já entregues na Phase 1)
- ❌ **NÃO** tocar `CLAUDE.md`, `proposta-consolidada.md`, `conversa-loop.md`, `handoff-session.md`, briefs anteriores
- ❌ **NÃO** rodar `npm test` / `npm install` / `tsc` (Phase 1 já fechou)
- ❌ **NÃO** rodar `git add` / `git commit` / `git push` (Phase 2 manual)
- ❌ **NÃO** promover nada a global

Se travar: parar e reportar com erro literal + hipótese de causa. Não improvisar.

---

## Gate de auditoria M3E (6 critérios)

1. Arquivo `.specs/ROADMAP.md` criado
2. **≥ 5 phases** numeradas (com `#### Phase N —`)
3. Phase 1 marcada como `[x]` (escopo do brief-m3cli-phase1.md)
4. Cada phase tem **Done when demoável** + **Depends on** + **3-8 sub-items**
5. Status legend explícito no fim (`[ ] pending · [~] in progress · [x] done`)
6. Zero side-effects em arquivos protegidos

Fecha pré-cond #3 do Waldemar. Pós-PASS: 3/4 pré-cond fechadas; só falta promover patches pra skill global (decisão humana, não automatizável).
