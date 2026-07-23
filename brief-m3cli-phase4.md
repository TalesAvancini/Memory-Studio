---
date: 2026-07-23
author: M3E (M3-Executor)
scope: Phase 4 (product) — Search / retrieval; segunda calibration run
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - .specs/ROADMAP.md (Phase 2 + Phase 4 — dependency chain)
  - .specs/features/social-detector/validation.md (Phase 3 PASS — referência)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL patcheada)
  - brief-m3cli-phase3.md (antecedente; lessons learned)
  - sub-agent-runaway-observation (memory — vide CRITICAL abaixo)
preceded_by: brief-m3cli-phase3.md
signals-alvo: 3 (recovery FAIL→pass), 4 (step 8b discovery surface)
---

# Brief — Phase 4 (product) / Segunda calibration run

## Goal duplo

1. **Implementar Phase 4 (Search / retrieval)** do ROADMAP via loop.
2. **Fechar sinais 3 + 4 da skill-readiness** que não dispararam na Phase 3 (recovery + discovery surface).

## Dependência declarada (CRÍTICO)

Phase 4 do ROADMAP tem **`Depends on: Phase 2 (Schema + CRUD de skill)`**. Phase 2 é `[ ]` ainda.

O orchestrator DEVE, no Passo 1 (ler ROADMAP/STATE):

1. Conferir status de Phase 2 no ROADMAP
2. Se `[ ]` → **rodar Phase 2 primeiro** (Planner → Impl → Verifier → flip [x])
3. Se `[x]` (improvável nessa janela) → pular direto pra Phase 4
4. Reportar **ambas** as phases no reporte final, mesmo que em iterações separadas

Brief cobre Phase 2 + Phase 4. Sub-agents tratam cada uma como ciclo independente (per skill rule: "single Implementer per phase").

## ⚠️ REGRA CRÍTICA — Runaway observation

Você (orquestrador) **observa iterações ativamente**. O cap de 3 iterações do skill é o chão, não o teto. Escale quando vir qualquer um destes sinais:

| Sinal durante iteração | Ação |
|---|---|
| Mesmo failing input dispatchado ≥ 3× sem resolution | **Parar. Escalar pro humano.** |
| Iteração fix→re-verify hit cap (3) sem progress real | **Parar. Escalação obrigatória.** |
| Implementer commita sem delta real (mesmo prefix, sem mudança de comportamento) | **Parar. Provavelmente travado.** |
| Verifier retorna "similar ao anterior" sem evidência nova | **Parar. Discrimination falhou.** |
| Sub-agent diz "vou tentar diferente" sem mudar nada | **Observar de perto; 1 tentativa, depois escalar.** |
| Plano novo não ataca root cause da falha anterior | **Parar. Escalar.** |

**Princípio: "melhor parar 1 min cedo do que gastar tokens em loop."** Quando qualquer sinal disparar: parar tudo, escrever STATUS em `.specs/STATE.md ## Handoff` com o que tá preso, escalar pro humano. **NÃO deixa o loop grindar.**

## Workflow (mesmo padrão Phase 3, agora 2 phases)

### Passo 1 — Carregar skill LOCAL

```
Ativar: .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL patcheada Turno 1)
```

### Passo 2 — Ler `.specs/STATE.md`

Handoff atual deve apontar Phase 3 (social-detector) como `[x]`. Phase 2 e Phase 4 são próximos.

### Passo 3 — Implementar Phase 2 (Schema + CRUD)

Phase slug: `schema-and-crud`

Sub-agent dispatch Planner com:
- Farol reference (`.specs/ARCHITECTURE.md`) para stable IDs
- ROADMAP excerpt da Phase 2 (lines 28-42)
- **Não inventar embedding model download se o brief não pede**; se Planner quiser incluir download do ONNX, justifica em spec.md (Assumptions) e submete discovery `cosmetic` se small, `structural` se substantivo

Acceptance de Phase 2:
- `npm run catalog:load <file.yaml>` lê YAML, persiste SQLite, gera embedding, retorna ID
- Testes ≥ 4, exit 0
- Coverage ≥ 80% em `src/catalog/`

### Passo 4 — Implementar Phase 4 (Search / retrieval)

Phase slug: `search`

**Só rodar** após Phase 2 ser `[x]`.

Sub-agent dispatch Planner com:
- Farol reference (mesmo)
- ROADMAP excerpt Phase 4 (lines 45-56)
- **Architectural Reference** deve citar stable IDs `search`, `sqlite`, `sqlite-fts5`, `sqlite-vec`

**Resolver ambiguidade arquitetural (preferência):**

Phase 4 do ROADMAP menciona `POST /search {q, k}`. Isso SUGERE server HTTP. Mas Phase 4 não depende de Phase 6 (server) no DAG.

**Default**: Phase 4 entrega `search(q, k): RankedSkill[]` como **library function** em `src/search/`. Endpoints HTTP ficam pra Phase 6. Se Planner quiser introduzir server stub, documenta em discovery `cosmetic` no `## Architectural Reference` e prossegue — não bloqueia.

Acceptance:
- `search(query: string, k: number): RankedSkill[]` retorna skills rankeadas por RRF
- Threshold duplo respeitado (`min_cosine_similarity` + `min_fts_hits`)
- Testes com corpus seed ≥ 10 skills
- Coverage ≥ 80% em `src/search/`

### Passo 5 — Step 8b (orquestrador)

Após cada Verifier, checar `.specs/DISCOVERIES.md`. Se append:

- `critical` → escalate IMEDIATAMENTE (independente de y/n), bloqueia próxima phase
- `structural` (3+ accumulated) → auto-suggest
- `cosmetic` → log only

**Sinal 4 target**: idealmente Phase 4 vai gerar ≥ 1 discovery (é maior, mais chance de drift vs farol). Step 8b deve exercitar.

### Passo 6 — Verdict handling

PASS → flip `[ ]` → `[x]` em ROADMAP + STATE.md update + commit.

FAIL com gaps:
- Iter < 3 → re-dispatch Verifier (after Implementer runs the fix)
- Iter == 3 → ESCALAR (per runaway observation, não continuar)

### Passo 7 — Stop & reporte final

## Scope-guard (HARD)

✅ Toca APENAS:

- `src/catalog/**` (Phase 2)
- `src/search/**` (Phase 4)
- `test/catalog*.test.mjs`, `test/search*.test.mjs` (pode ser múltiplos arquivos de teste)
- `scripts/catalog*.ts`, `scripts/search*.ts` se Planner pedir (CLI scripts pra embedding/download)
- `data/skills.sqlite` (gitignored — pode popular com test corpus)
- `models/*.onnx` (gitignored — Phase 2 pode baixar multilingual-e5-small)
- `.specs/features/{schema-and-crud,search}/{spec,design,tasks,validation}.md`
- `.specs/STATE.md` (section-scoped, `## Handoff` body)
- `.specs/DISCOVERIES.md` (append-only, se aplicável)
- `.specs/ROADMAP.md` (SOMENTE pra flip Phase 2 + Phase 4)
- `package.json` (deps novas explicitamente: ONNX runtime, sqlite-vec binary, etc)
- `tsconfig.json` (se `src/catalog/` ou `src/search/` exigir ajuste)
- `git index` (commits são permitidos dentro do loop)

❌ NÃO TOCA (mesmo que "veja oportunidade"):

- `src/social-detector/**` (Phase 3 intacto — é o sinal 2 + 5 que provaram a skill)
- `src/augmenter/`, `src/cache/`, `src/agents/`, `src/server/`, `src/shared/` (outras 5 phases)
- `.claude/**` (LOCAL skill intocada — só leitura)
- `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (NÃO promover — user decide)
- `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json` (farol intocado)
- Qualquer arquivo fora do escopo ✅ durante as phases

### Boundary check (per Phase 3 brief)

Se Implementer/Verifier retornar diff tocando arquivo fora do ✅:

1. Reportar violação na hora
2. NÃO commitar
3. NÃO considerar phase como PASS
4. Escalar pro humano

## Output expectations

### Phase 2 (Schema + CRUD)
- `src/catalog/` (loader YAML, writer SQLite, embedder, schema)
- `test/catalog*.test.mjs` (≥ 4 tests)
- `npm run catalog:load <path>` funcional
- Coverage ≥ 80% em `src/catalog/`
- Maybe: `data/skills.sqlite` populado com fixtures

### Phase 4 (Search)
- `src/search/` (FTS5 query, sqlite-vec wrapper, RRF fusion, threshold gates)
- `test/search*.test.mjs` (corpus seed ≥ 10 skills, asserts de ranking + threshold)
- `search(q, k)` como library function
- Coverage ≥ 80% em `src/search/`
- Maybe: cross-encoder local opcional (v0 MVP)

## Reporte final (formato Phase 3 + extensão)

Incluir por phase:

**Para cada Phase (2 + 4):**

- ✅ Lista artefatos produzidos (paths + tamanhos)
- ✅ Gates: `npm test` exit + real elapsed, `tsc --noEmit` exit, coverage
- ✅ Atomic commits (`git log --oneline d441e05..HEAD`)
- ✅ Spec-anchored check (todos os ACs met)
- ✅ Discrimination sensor (mutações killed)
- ✅ Step 8b output se houve
- ✅ Scope-guard compliance explícito

**Sinais fechados por phase:**

| Phase | Sinal 2 (cycle) | Sinal 3 (recovery) | Sinal 4 (discovery) | Sinal 5 (binary) |
|---|---|---|---|---|
| Phase 2 | ✅ or ❌ | ✅ or ❌ or "not exercised" | ✅ or ❌ | ✅ or ❌ |
| Phase 4 | ✅ or ❌ | ✅ or ❌ or "not exercised" | ✅ or ❌ | ✅ or ❌ |

**Sinais consolidados (Phase 2 + Phase 4 + Phase 3 anterior):**

| Sinal | Phase 3 | Phase 2 | Phase 4 | Total |
|---|---|---|---|---|
| 1 Promote | — | — | — | ⏸️ manual |
| 2 Cycle | ✅ | ? | ? | ⏸️ until both green |
| 3 Recovery | ❌ not exercised | ? | ? | ⏸️ |
| 4 Discovery | ❌ not fired | ? | ? | ⏸️ |
| 5 Binary | ✅ | ? | ? | ⏸️ |

**Skill-ready declarado se:** 2 verde em pelo menos 1 phase + 5 verde + 1 sinal 3 ou 4 fired em qualquer phase.

## Stop conditions (qualquer um dispara)

- 3× FAIL consecutivo em qualquer phase (Phase 2 OU Phase 4)
- Qualquer trigger da tabela **Runaway observation** acima
- Phase atinge limite razoável de scope (Planner sinaliza com SUBCHAPTER_BREAKDOWN)
- Skill patcheada não carrega / prompt template não bate
- DISCOVERIES.md entry `critical`
- Implementer/Verifier toca arquivo fora do scope-guard
- HARD BLOCKER no Verifier (missing tool, ambiguous AC)

Quando qualquer um dispara:

1. Parar TUDO
2. Update `.specs/STATE.md ## Handoff` com status atual (qual phase parou, qual task, qual erro)
3. Reportar pro humano com:
   - Qual sinal/stop condition disparou
   - Quais tasks foram completas vs pendentes
   - Quais artifacts estão em working tree (não commitados)
   - Recomendação: o que fazer a seguir

---

## Gate M3E (auditoria)

Critérios pra validar:

1. Phase 2 e/ou Phase 4 implementados com `validation.md` PASS
2. Cada commit atômico, conventional
3. Coverage ≥ 80% em `src/catalog/` e/ou `src/search/`
4. `npm test` < 10s (Waldemar pré-cond #1 mantida)
5. Sinal 3 OU 4 fire em alguma das phases (target principal desta run)
6. Scope-guard zero side-effects em arquivos protegidos
7. Runaway observation RESPEITADA (não houve loop infinito, escalation triggers funcionando)

**Skill-ready** declarado IFF Sinal 1 (promote manual user) + Sinais 2 + 5 verdes + pelo menos 1 de (Sinal 3 OU Sinal 4) fired em qualquer phase.

Antes disso, "skill ready" NÃO é dito.
