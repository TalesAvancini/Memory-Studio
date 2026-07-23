---
date: 2026-07-23
author: M3E (M3-Executor)
scope: Phase 3 (product) — Detector social; calibration run da skill `tlc-roadmap-loop` patcheada
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - .specs/ROADMAP.md (Phase 3 — Detector social, phase-slug `social-detector`)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL patcheada — esta é a versão a ativar)
  - brief-m3cli-phase0.md (✅ antecedente)
  - brief-m3cli-phase1.md (✅ antecedente)
  - brief-m3cli-phase2.md (✅ antecedente)
  - .specs/ARCHITECTURE.md (farol — stable IDs)
  - handoff-session.md (Turno 3+)
  - proposta-consolidada.md §5/§6
preceded_by: brief-m3cli-phase2.md (Phase 2 fechou pré-cond #3 do Waldemar)
purpose: calibration run — esta é a ÚNICA phase que roda nesta janela. Objetivo = fechar os 5 sinais de skill-readiness (ver [[skill-readiness-needs-evidence]])
---

# Brief — Phase 3 (product) / Calibration run da skill loop

## Goal duplo

1. **Implementar Phase 3 do ROADMAP (Detector social)** — código real do produto (`src/social-detector/` + `test/social-detector.test.mjs`)
2. **Fechar os 5 sinais de skill-readiness** via execução real (Planner → Implementer → Verifier → `validation.md` PASS)

Esta é a **primeira execução end-to-end** da skill patcheada. **Observação > entrega**: se aparecer bug na skill, melhor descobrir agora em escopo pequeno do que em Phase crítica.

## O que "sucesso" significa (5 sinais)

| # | Sinal | Onde procurar |
|---|---|---|
| 1 | Skill promovida pra global | `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (manual, NÃO automatizar) |
| 2 | Ciclo fim-a-fim Planner→Impl→Verifier→PASS | `git log` + `.specs/features/social-detector/validation.md` |
| 3 | Recovery de FAIL exercitada (oportunístico) | log de iterações mostrando fail→pass |
| 4 | Step 8b disparou ≥ 1 discovery | `.specs/DISCOVERIES.md` com entry nova |
| 5 | Verifier citou comandos/testes específicos em validation.md | grep `node --test` ou similar no validation.md |

Sinais 2 + 5 são obrigatórios. 1, 3, 4 são desejáveis.

## Workflow (orquestrador = você, M3-CLI)

### Passo 0 — Carregar skill LOCAL (não global)

```
Ativar: .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL, patched Turno 1)
NÃO ativar ~/.claude/skills/tlc-roadmap-loop/SKILL.md (essa é a global intocada)
```

Skill precedence: LOCAL > GLOBAL (verificado empiricamente nas Phase 0/1/2).

### Passo 1 — Orquestrador lê estado

Criar `.specs/STATE.md` se não existe:

```markdown
# STATE

## Decisions
(vazio por enquanto — append-only a partir de agora)

## Handoff
- phase: `social-detector` (Phase 3 do ROADMAP)
- phase-slug: `social-detector`
- previous-phase: Phase 1 (Setup) [x]
- next-step: dispatch Planner
- repo: c:\Users\User\Desktop\AI-Project\Memory-Studio
- branch: main, head: 146a451
- uncommitted: nenhum
```

### Passo 2 — Dispatch Planner (fresh sub-agent)

Prompt template do skill (Step 5 + Step 6 footnotes para Planner):

- Phase: 3 — Detector social
- Phase slug: `social-detector`
- Feature context: Roadmap entry do .specs/ROADMAP.md (lines 45-56), rola excerpt ao Planner
- Project glue pointers: ROADMAP, ARCHITECTURE.md, DISCOVERIES.md, CLAUDE.md
- **Reference explícita ao farol**: Planner DEVE ler `.specs/ARCHITECTURE.md` (texto) e abrir `design.md` com `## Architectural Reference` apontando o stable ID `social-detector`. Se precisar novo componente NÃO no farol, append em DISCOVERIES.md (severity `cosmetic | structural | critical`) e seguir.
- Output dir: `.specs/features/social-detector/`

Planner deve produzir:
- `spec.md` (AC + Assumptions)
- `design.md` (com `## Architectural Reference`)
- `tasks.md` (3-8 tasks atômicas com Test Coverage Matrix + Gate Check Commands)

Se Planner retornar `SUBCHAPTER_BREAKDOWN: [...]` → PARE e escale (Phase 3 é pequena, não deveria disparar).

### Passo 3 — Dispatch Implementer (fresh sub-agent)

Recebe paths Planner. Roda tasks.md em ordem, commit atômico por task.

**Tarefa por task inclui:**
- Implementar (`src/social-detector/` ou `test/social-detector.test.mjs` ou `package.json` se deps novas)
- Rodar gate (`npm test` ou `npx tsc --noEmit`)
- Conventional commit (`feat(social-detector): ...`)

**NÃO-spawnea sub-agentes.** **NÃO roda Verifier.**

### Passo 4 — Dispatch Verifier (fresh sub-agent, autor ≠ implementador)

Recebe:
- git diff/commit range da phase
- Implementer deviation summary (se houve)
- paths pra spec.md, design.md, tasks.md

Verifier roda:
- `npm test` (real elapsed + exit code)
- `npx tsc --noEmit` (sem erros)
- Spec-anchored check (cada AC da spec.md passa?)
- Discrimination sensor (output é behaviour, não implementation-mirror?)

Verifier escreve `.specs/features/social-detector/validation.md` com:
```
PASS | FAIL
[e evidência específica — cite test outputs, file:line, comandos]
```

Return: compact verdict + ranked gap list.

### Passo 5 — Step 8b (orquestrador)

Se Implementer/Verifier append em `.specs/DISCOVERIES.md`:

```
Phase 3 introduziu D-NNN discovery: <title>.
Severity: <sev>.
Sugerir re-render do farol? (y/n)
```

**Pare e reporte ao humano; não auto-responda.**

Severity handling:
- `critical` → escalate imediatamente (independente de y/n); bloqueia próxima phase
- `structural` (3+ accumulated) → auto-suggest
- `cosmetic` → log only (não surface)

### Passo 6 — Verdict handling

- **PASS**:
  - Flip `[ ]` → `[x]` em `.specs/ROADMAP.md` (Phase 3)
  - Update `.specs/STATE.md` ## Handoff (section-scoped — NÃO mexe em ## Decisions)
  - Commit: `docs(spec): mark phase 3 complete in ROADMAP and STATE`
  - Reporte ao humano com 5-sinais
- **FAIL com gaps**:
  - Append fix tasks em `tasks.md`
  - Re-run Implementer (re-dispatch)
  - Re-run Verifier
  - Iter cap: **3 iters**. Na 3ª FAIL → escale, PARE.

## Stop conditions (qualquer um)

Pare e reporte ao humano se:

- 3× FAIL consecutivo no Verifier
- Planner retorna SUBCHAPTER_BREAKDOWN (Phase 3 é pequena, indicador de skill issue)
- Skill patcheada não carrega ou prompt template não bate (orchestrator não consegue parsear)
- DISCOVERIES.md entry com `severity = critical`
- Implementer/Verifier tenta tocar arquivo fora da scope-guard abaixo
- HARD BLOCKER no Verifier (missing tool, ambiguous AC)

## Scope-guard (HARD)

✅ Toca APENAS:

- `src/social-detector/**`
- `test/social-detector.test.mjs` (ou `test/social-detector/*.test.mjs` se múltiplos arquivos)
- `package.json` (SOMENTE se precisar de dep nova explicitamente declarada)
- `tsconfig.json` (SOMENTE se precisar de include/exclude paths)
- `.specs/features/social-detector/{spec.md, design.md, tasks.md, validation.md}`
- `.specs/STATE.md` (section-scoped, append-only em Decisions)
- `.specs/DISCOVERIES.md` (append-only, se aplicável)
- `.specs/ROADMAP.md` (SOMENTE pra flip `[ ]` → `[x]` no verdict PASS)
- `git index` (commits são permitidos DENTRO do loop; fora, NÃO)

❌ NÃO TOCA (mesmo se "veja oportunidade"):

- `.claude/**` (LOCAL skill intocada — só leitura)
- `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (NÃO promover — user decide)
- `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json` (farol intocado)
- Qualquer outro `src/<domain>/` além de `social-detector` (server, augmenter, catalog, search, cache, agents)
- Qualquer outro test file de outra phase
- `CLAUDE.md`, `proposta-consolidada.md`, `conversa-loop.md`, `handoff-session.md`, `PLAN.md`
- Briefs: `brief-m3cli-phase0.md`, `brief-m3cli-phase1.md`, `brief-m3cli-phase2.md`, **NEM este `brief-m3cli-phase3.md`**
- The tlc-roadmap-loop skill itself

### Boundary check — se Implementer/Verifier retornar com diff que toca arquivo fora do ✅:

1. Reportar violação na hora
2. NÃO commitar
3. NÃO considerar a phase como PASS mesmo se tests passam
4. Escale ao humano

## Reporte final

Incluir:

1. **Lista dos 5 (ou 7) artefatos produzidos**, com paths e tamanhos:
   - `spec.md`, `design.md`, `tasks.md`, código, `test/social-detector.test.mjs`, `validation.md`, `STATE.md`, `ROADMAP.md` (flip), `git log` entries
2. **5 sinais checklist** (mesmo formato do brief):
   - Sinal 1 (promote): ❌ não automatizou (correto)
   - Sinal 2 (cycle fim-a-fim): ✅ ou ❌ com evidência
   - Sinal 3 (recovery): ✅ ou ❌ ou "não exercitado"
   - Sinal 4 (discovery): ✅ ou ❌ com path pra D-NNN se aplicável
   - Sinal 5 (binary verdict): ✅ ou ❌ com commands citados
3. **`npm test` exit code + real elapsed** (precisa ser < 10s)
4. **`git log --oneline 146a451..HEAD`** (mostra commits atômicos por task)
5. **Step 8b output** se houve
6. **Scope-guard compliance** explícito: listei os arquivos tocados; confirmou zero side-effects?
7. **Qualquer desvio do brief** com rationale

---

## Gate M3E (auditoria dos 5 sinais)

1. **Sinal 1 (promote)** — fora do escopo do M3-CLI; user action
2. **Sinal 2** — se `validation.md` diz PASS com evidência específica + log mostra Planner→Impl→Verifier sequence limpa
3. **Sinal 3** — se houve ao menos um ciclo fail→pass durante implementação (oportunístico, sem forçar)
4. **Sinal 4** — se `DISCOVERIES.md` foi appendado pelo menos uma vez durante esta phase
5. **Sinal 5** — se `validation.md` cita comandos exatos (ex: `npm test`, `npx tsc --noEmit`) e counts (ex: "20 passed, 0 failed")

**Declaração de skill-ready só após Sinais 2 + 5 verdes + Sinal 1 (promote manual do user)**. Antes disso, qualquer statement de "pronto" é besteira.

## Memo (opcional, se M3-CLI tiver espaço)

M3-CLI pode append em `.specs/LESSONS.md` ao final se houver grounded failure durante a run. O skill automaticamente carrega confirmed lessons no próximo Planner dispatch.
