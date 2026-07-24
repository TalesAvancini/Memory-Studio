---
date: 2026-07-24
author: M3E (M3-Executor)
scope: Phase 5 (product) — System message builder; primeira production work usando skill v0.2
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - .specs/ROADMAP.md (Phase 5 spec lines 79-91)
  - .specs/ARCHITECTURE.md (4 stable IDs: augmenter, cache, social-detector, search, catalog)
  - .specs/STATE.md ## Handoff (next-phase: Phase 5)
  - .specs/DISCOVERIES.md (Sinal 4 target — append se drift detectado)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (v0.2 — step 8a failure diagnostics ativo)
  - brief-m3cli-phase3.md (antecedente social-detector — pattern de referência)
  - brief-m3cli-phase4.md (antecedente search — pattern de referência)
  - brief-m3cli-phase4-recovery.md (antecedente focal recovery — T-ORCH-19b)
preceded_by: brief-m3cli-phase4.md (Phase 4 PASS)
signals-alvo: 4 (discovery surface — primeira phase que toca 4 components juntos)
---

# Brief — Phase 5 (product) / System message builder

## Goal único

**Implementar Phase 5 (System message builder)** do ROADMAP via loop. Primeira production work usando a skill v0.2 (failure diagnostics step 8a ativo). **Sinal 4 (discovery surface) é o sinal-alvo desta run** — Phase 5 toca 4 components do farol (`augmenter`, `cache`, `social-detector`, `search`/`catalog`), drift arquitetural é provável.

## Dependência declarada

Phase 5 depende de Phase 2 (schema-and-crud) + Phase 4 (search). Ambas `[x]`. OK rodar direto.

## Skill ativa (v0.2 — NOVO)

A skill foi bumped pra v0.2 com **step 8a — failure diagnostics pre-flight**. Antes de re-dispatch em FAIL, orchestrator compara failure atual vs anterior; se mesma fixture falhou 2x sem mudança de comportamento, surface 3 alternativas (refine test / escalate / skip signal) ao orchestrator ao invés de retry cego.

**Implicação para Phase 5:**
- Briefs de recovery ficam menores (orchestrator decide estratégia, M3E não precisa escrever brief focal).
- Step 8a não conta contra cap de 3 iterações.
- Iter count reseta após strategy shift.

## ⚠️ REGRA CRÍTICA — Runaway observation (mantida de Phase 4)

Você (orquestrador) **observa iterações ativamente**. O cap de 3 iterações do skill é o chão, não o teto. Escale quando:

| Sinal durante iteração | Ação |
|---|---|
| Mesmo failing input dispatchado ≥ 3× sem resolution | **Parar. Escalar pro humano.** |
| Implementer commita sem delta real (mesmo prefix, sem mudança de comportamento) | **Parar. Provavelmente travado.** |
| Verifier retorna "similar ao anterior" sem evidência nova | **Parar. Discrimination falhou.** |
| Plano novo não ataca root cause da falha anterior | **Parar. Escalar.** |
| Step 8a failure diagnostics disparou | **Strategy shift antes de re-dispatch, NÃO retry cego** |

**Princípio:** "melhor parar 1 min cedo do que gastar tokens em loop."

## Constraints arquiteturais (HARD)

### C1 — Provider cache preservation

`buildAugmentedMessage(...)` **DEVE** produzir byte-string determinístico:
- Mesmo input → **exatamente o mesmo** byte output
- Sem timestamps, sem randomness, sem timestamps de execução
- Hash do cache (`tenant_id` hasheado + sorted skill hashes + prompt kind) **deve** bater para inputs idênticos

**Teste obrigatório:** `test/augmenter/determinism.test.mjs` com 2 chamadas idênticas → assert byte-equal `===`.

### C2 — NO LLM no hot path

Phase 5 não pode chamar LLM. Toda lógica é determinística + local. (Mesmo se farol não proíbe explicitamente, é regra de architecture.)

**Teste de violação:** grep por `fetch(` ou `http.request` em `src/augmenter/` deve retornar 0 hits.

### C3 — Social bypass integration

Se `isSocial(prompt) === true`, `buildAugmentedMessage(...)` retorna system message **vazio** (sem skills injetadas). NÃO retorna erro.

**Teste:** "oi" + 5 skills rankeadas → output é system message base (persona + rules), sem bloco de skills.

### C4 — Threshold fail behavior

Se `rankedSkills.length === 0` (nenhum match acima do threshold), retorna system message **vazio** (sem bloco de skills injetadas). NÃO retorna erro.

**Por quê:** falha de retrieval ≠ erro (regra do PLAN.md §6).

## Workflow

### Passo 1 — Carregar skill v0.2

```
Ativar: .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL — promoted to GLOBAL 2026-07-23, parity confirmada)
```

Versão atual: **v0.2**. Step 8a ativo. Step 8b (architectural drift surface) também ativo.

### Passo 2 — Ler `.specs/STATE.md ## Handoff`

Próxima phase é Phase 5 (`system-message-builder`), `[ ]`.

### Passo 3 — Implementar Phase 5

Phase slug: `system-message-builder`

Sub-agent dispatch Planner com:
- Farol reference (`.specs/ARCHITECTURE.md` texto)
- ROADMAP excerpt Phase 5 (lines 79-91)
- **Architectural Reference** deve citar stable IDs: `augmenter`, `cache`, `social-detector`, `search`, `catalog` (5 IDs)
- **4 constraints arquiteturais** (C1-C4 acima) — Planner escreve ACs a partir delas

**Resolver ambiguidade (preferência):**

Phase 5 do ROADMAP menciona `cache_control: ephemeral`. Em Anthropic API isso é uma marker no message structure. **Decisão preferida**: Phase 5 entrega o **byte-string determinístico** + um **marker field** `ephemeral: true` no output (interface contract). Renderização pra Anthropic cache_control fica pra Phase 6 (server). Se Planner quiser serializar o marker no output de Phase 5 (ex: JSON wrapper `{content: "...", ephemeral: true}`), documenta como discovery `cosmetic`.

Acceptance:
- `buildAugmentedMessage(prompt: string, rankedSkills: RankedSkill[], persona?: Persona, rules?: Rule[]): AugmentedMessage` em `src/augmenter/`
- `AugmentedMessage` type: `{content: string, ephemeral: true, cacheKey: string}` (ou shape análogo — Planner decide)
- Cache byte-string determinístico (C1)
- Social bypass (C3) + threshold fail (C4) integrados
- Testes: determinism + social bypass + threshold fail + persona/rules injection
- Coverage ≥ 80% em `src/augmenter/`

### Passo 4 — Step 8b (orquestrador)

Após cada Verifier, checar `.specs/DISCOVERIES.md`. Se append:

- `critical` → escalate IMEDIATAMENTE
- `structural` (3+ accumulated) → auto-suggest re-render
- `cosmetic` → log only

**Sinal 4 target:** Phase 5 tocando 5 stable IDs tem chance real de gerar ≥ 1 discovery (ex: persona injection precisar de novo component, cache key precisar de novo campo). Brief **ENCOURAGE** sub-agents a flagar drift quando virem — não bloquear.

### Passo 5 — Step 8a (failure diagnostics — NOVO)

Se Verifier FAIL com mesma fixture que iter anterior, **NÃO** auto-retry. Surface strategy alternatives ao orchestrator:
1. Refine test design (fixture decorativa)
2. Escalate to human
3. Skip signal

Iterations reset após strategy shift.

### Passo 6 — Verdict handling

PASS → flip `[ ]` → `[x]` em ROADMAP + STATE.md update + commit.

FAIL com gaps:
- Iter < 3 → re-dispatch Verifier (after Implementer runs the fix) — mas se step 8a disparou, strategy shift antes.
- Iter == 3 → ESCALAR (per runaway observation).

### Passo 7 — Stop & reporte final

## Scope-guard (HARD)

✅ Toca APENAS:

- `src/augmenter/**`
- `src/cache/**` (cache determinístico é dependencia de Phase 5)
- `test/augmenter*.test.mjs` (pode ser múltiplos arquivos)
- `test/cache*.test.mjs` (testes do cache determinístico)
- `.specs/features/system-message-builder/{spec,design,tasks,validation}.md`
- `.specs/STATE.md` (section-scoped, `## Handoff` body)
- `.specs/DISCOVERIES.md` (append-only, se aplicável)
- `.specs/ROADMAP.md` (SOMENTE pra flip Phase 5)
- `package.json` (deps novas explicitamente: nenhuma esperada, mas se Planner pedir crypto util lib justifica)
- `tsconfig.json` (se `src/augmenter/` ou `src/cache/` exigir ajuste)

❌ NÃO TOCA (mesmo que "veja oportunidade"):

- `src/social-detector/**` (Phase 3 intacto — só importa a função `isSocial`)
- `src/search/**` (Phase 4 intacto — só importa o tipo `RankedSkill`)
- `src/catalog/**` (Phase 2 intacto)
- `src/agents/`, `src/server/`, `src/shared/` (outras phases — Phase 6 e Phase 9)
- `.claude/**` (LOCAL skill intocada — só leitura)
- `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (NÃO promover — já está em v0.2 promoted)
- `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json` (farol intocado)
- `test/search*.test.mjs`, `test/catalog*.test.mjs`, `test/social-detector*.test.mjs` (testes de outras phases)

### Boundary check

Se Implementer/Verifier retornar diff tocando arquivo fora do ✅:
1. Reportar violação na hora
2. NÃO commitar
3. NÃO considerar phase como PASS
4. Escalar pro humano

## Output expectations

### Phase 5 (System message builder)
- `src/augmenter/` (buildAugmentedMessage, types, social-bypass integration, threshold-fail handling)
- `src/cache/` (byte-string determinístico + sha256 hashing)
- `test/augmenter/{determinism,social-bypass,threshold-fail,persona-injection}.test.mjs` (≥ 4 testes)
- `test/cache/determinism.test.mjs` (cache hit/miss/byte-equal)
- Coverage ≥ 80% em `src/augmenter/` E `src/cache/`
- Maybe: append `.specs/DISCOVERIES.md` se drift detectado (Sinal 4 target)

## Reporte final (formato Phase 3/4 + extensão)

**Para Phase 5:**
- ✅ Lista artefatos produzidos (paths + tamanhos)
- ✅ Gates: `npm test` exit + real elapsed, `tsc --noEmit` exit, coverage
- ✅ Atomic commits (`git log --oneline <prev>..HEAD`)
- ✅ Spec-anchored check (todos ACs met — C1-C4 + ROADMAP Phase 5 sub-items)
- ✅ Discrimination sensor (mutações killed)
- ✅ Step 8b output se houve (Sinal 4 target)
- ✅ Step 8a output se houve (failure diagnostics)
- ✅ Scope-guard compliance explícito

**Sinais fechados por esta run:**

| Sinal | Status | Evidência |
|---|---|---|
| 2 (cycle fim-a-fim) | ✅ or ❌ | `npm test` exit 0 |
| 3 (recovery FAIL→PASS) | ✅ or ❌ or "not exercised" | — |
| 4 (discovery surface) | ✅ or ❌ | append em DISCOVERIES.md (target) |
| 5 (binary verifier) | ✅ or ❌ | Verifier validation.md PASS |

**Sinais consolidados (Phase 1+2+3+4+5):**

| Sinal | P1 | P2 | P3 | P4 | P5 | Total |
|---|---|---|---|---|---|---|
| 1 Promote | — | — | — | ✅ | — | ✅ done |
| 2 Cycle | ✅ | ✅ | ✅ | ✅ | ? | ⏸️ until P5 green |
| 3 Recovery | — | — | — | ✅ | ? | ⏸️ |
| 4 Discovery | — | — | — | ❌ | ? (target) | ⏸️ |
| 5 Binary | — | ✅ | ✅ | ✅ | ? | ⏸️ |

## Stop conditions (qualquer um dispara)

- 3× FAIL consecutivo em Phase 5
- Qualquer trigger da tabela **Runaway observation** acima
- Step 8a failure diagnostics dispara → strategy shift antes de re-dispatch (NÃO retry cego)
- Phase atinge limite razoável de scope (Planner sinaliza com SUBCHAPTER_BREAKDOWN)
- Skill v0.2 não carrega / prompt template não bate
- DISCOVERIES.md entry `critical`
- Implementer/Verifier toca arquivo fora do scope-guard
- HARD BLOCKER no Verifier (missing tool, ambiguous AC)
- **C1 violated** (cache determinístico falhando) → BLOCK, escalate
- **C2 violated** (LLM no hot path detectado) → BLOCK, escalate
- **C3 violated** (social bypass retornando erro ao invés de vazio) → BLOCK
- **C4 violated** (threshold fail retornando erro ao invés de vazio) → BLOCK

Quando qualquer um dispara:
1. Parar TUDO
2. Update `.specs/STATE.md ## Handoff` com status atual
3. Reportar pro humano com: qual sinal/stop condition disparou, tasks completas vs pendentes, artifacts em working tree, recomendação

## Gate M3E (auditoria)

Critérios pra validar:
1. Phase 5 implementado com `validation.md` PASS
2. Cada commit atômico, conventional (`feat(augmenter): ...`, `feat(cache): ...`, `test(augmenter): ...`)
3. Coverage ≥ 80% em `src/augmenter/` E `src/cache/`
4. `npm test` < 10s (Waldemar pré-cond #1 mantida)
5. C1-C4 todos verificados via testes
6. Sinal 4 fired (preferred) ou justificativa pra não ter disparado
7. Scope-guard zero side-effects em arquivos protegidos
8. Runaway observation RESPEITADA + step 8a exercitado se aplicável

**Sinal 4 mira disparar.** Se não disparar, documenta o porquê em validation.md (pode ser: "drift não materializou porque arquitetura já cobria").

---

**M3-CLI ativa skill v0.2, roda Phase 5 com constraints C1-C4, mira Sinal 4, e reporta. M3E audita ao final.**
