---
date: 2026-07-23
author: M3E (M3-Executor)
scope: Phase 4 (product) — recovery test focal nos 2 problemas pendentes (T-ORCH-19b + tie-break)
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - .specs/features/search/validation.md (Phase 4 iter 0 + iter 1 — tem evidência do FAIL)
  - .specs/STATE.md (iter-log linha por linha)
  - git fa66766 (commit que adicionou T-ORCH-19b fixture)
  - git 54f40b1 (commit tie-break fix no src/)
  - brief-m3cli-phase4.md (antecedente — Phase 4 BLOCKED)
---

# Brief — Phase 4 recovery (focal, ~10 min)

## Goal único

**Fechar Sinal 3 strict da skill-readiness: FAIL → fix → PASS observado.**

Phase 4 iter 0 = **FAIL** (já documentado em validation.md + STATE.md iter-log). Iter 2 = BLOCKED por runaway trigger (T-ORCH-19b persistent-failing).

**O loop NÃO roda.** M3-CLI age manualmente como Implementer + Verifier, produzindo evidência nova de **PASS** num único ciclo.

## Work scope (microscópico)

**Apenas 2 test files** + 1 comando de teste:

| Arquivo | Issue | Fix cirúrgica (M3-CLI decide a linha exata) |
|---|---|---|
| `test/search/search.test.mjs` | T-ORCH-19b threshold permissivo (commits `fa66766` introduziu o fixture mas ainda não discrimina o bastante) | Tighten threshold-boundary fixture — assertion rigorosa que NÃO sobreviva a um filter que renumera ranks |
| `test/search/vector.test.mjs` | Tie-break determinism test missing rank assertion (`54f40b1` fixou o código, mas o test só checava id/slug, não a ordem/rank) | Adicionar assertion de **vectorRank/score em tie-break** (ex: 2 rows com cosine idêntico — o test deve validar ordem estável) |

**Implementation files NÃO TOCAR** (`src/search/*.ts` intocados). Os fixes são **só nos tests**.

### Diagnóstico adicional (pode ajudar)

Problema 1 (T-ORCH-19b) é tipicamente:
- Assertion `assert.equal(score, X)` muito largo (X ± 0.3 ao invés de `=== X`)
- Fixture com scores artificiais que batem sem discriminar (ex: 5 rows com scores 0.99, 0.98, 0.97, 0.96, 0.95 — threshold de 0.1 deixa tudo passar)

Problema 2 (tie-break) é tipicamente:
- Test só checa `result.length === N` ou `result.includes(id)` — sem check de ordem
- Falta assertion tipo `assert.equal(result[0].vectorRank < result[1].vectorRank)` ou `result[i].score === result[i+1].score` quando são iguais

Mas M3-CLI conhece os arquivos melhor que M3E — decides the exact line.

## Comando

```bash
cd "c:\Users\User\Desktop\AI-Project\Memory-Studio"
npm test test/search/
# ou equivalente
node --test test/search/
```

**Sinal esperado:**
- **Antes das fixes:** pelo menos 1 failure (T-ORCH-19b) e possivelmente 1 more (tie-break). Counts concretos no reporte.
- **Depois das fixes:** 0 failures, all tests discriminative.

## Reporte (curto, 7 itens)

1. ✅ Diff resumido dos 2 arquivos (quais linhas mudaram — não precisa do diff completo)
2. ✅ `npm test test/search/` exit code (0 = verde, 1 = vermelho)
3. ✅ Tempo elapsed
4. ✅ Counts: `X passed, Y failed` ANTES e DEPOIS das fixes (mostra o delta)
5. ✅ Se verde: marcar Phase 4 como PASS em `.specs/ROADMAP.md` (flip Phase 4 → `[x]`) + atualizar `.specs/STATE.md ## Handoff` indicando sinal 3 strict fecha
6. ✅ Conventional commit: `test(search): fix T-ORCH-19b fixture + add rank assertion to tie-break` (NÃO scope: `fix(search): ...` porque src/ não muda)
7. ✅ Push to origin

## Se VERDE (PASS) — entregável final do brief

A checagem completa dos 5 sinais vira:

| Sinal | Estado |
|---|---|
| 1 — Promote global | ⏸️ manual humano |
| 2 — Cycle fim-a-fim | ✅ Phase 2 + 3 + 4 (três evidências) |
| 3 — Recovery FAIL→PASS | ✅ **strict** (Phase 4 iter 0 FAIL + iter 2 fix = PASS) |
| 4 — Discovery surface | ❌ não disparou (não bloqueia — arquitetura do farol já cobriu) |
| 5 — Binary verifier c/ evidência | ✅ |

Com 2 + 3 + 5 verdes, **critério pragmático atence**: 1 (promote) é decisão humana final, mas tudo o resto está sob evidência.

M3E audita e (se aprovado) emite sentence explícita: "skill ready, awaiting your OK on Sinal 1 promote".

## Se VERMELHO (FAIL persistente)

Reportar:
- Quais fixtures ainda falham
- Exit code + output resumido
- Hipótese de M3-CLI sobre por que T-ORCH-19b resiste (apêndice do STATE.md)

M3E aceita Sinal 3 partial e segue com a opção (b) do handoff: promote com critério pragmático **apesar de** Sinal 3 não ser strict. Não insiste mais.

## Restrições (HARD)

- ❌ **NÃO** tocar `src/search/**` (implementação tá ok; só tests)
- ❌ **NÃO** rodar sub-agents fresh (Implementer/Verifier/etc) — M3-CLI age manualmente
- ❌ **NÃO** modificar `.claude/**` (skills intocadas)
- ❌ **NÃO** modificar `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json`
- ❌ **NÃO** adicionar deps novas
- ❌ **NÃO** promover global
- ❌ **NÃO** modificar outros `src/*` ou `test/*`
- ❌ **NÃO** modificar briefs anteriores, proposta, conversa-loop, handoff, CLAUDE.md
- ⚠️ **PODE** editar `.specs/ROADMAP.md` (flip Phase 4) e `.specs/STATE.md` (Handoff body) — só se verde

## Stop conditions

| Condição | Ação |
|---|---|
| Verde (PASS) | Reportar, commit, push. M3E audita + emite "skill ready" se tudo bate |
| Vermelho (FAIL persistente) | Reportar com hypothesis. M3E aceita Sinal 3 partial + segue pragmático |
| Erro de import/syntax (test não roda) | Reportar literal + número da linha. Sem improvisar |

**Tempo alvo:** 10-15 min total. Se chegar a 20 min sem clear signal, parar e reportar.
