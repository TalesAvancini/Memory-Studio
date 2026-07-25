---
session_end: 2026-07-23
author: M3E
audience: agentes futuros (sessões frescas, sem contexto prévio)
---

# Handoff de sessão — 2026-07-23 (skill v0.2 + Phase 5 ready)

## TL;DR

Skill `tlc-roadmap-loop` está em **v0.2** (promovida pra global). Calibration fechou com **4 dos 5 sinais de readiness verdes** (Sinal 4 ainda não disparou, mas é aceitável — farol cobre as components atuais). **Próximo passo: Phase 5 do ROADMAP (System message builder)** — primeira feature de produção usando a skill v0.2.

Histórico detalhado da calibração arquivado em [archive_handoff/handoff-session-2026-07-23.md](archive_handoff/handoff-session-2026-07-23.md).

---

## Onde estamos (estado consolidado)

| Phase | Status | Sinais fechados | Notas |
|---|---|---|---|
| Phase 1 — Scaffold | `[x]` PASS | Waldemar #1 (fast feedback <10s) | `package.json`, `tsconfig.json`, smoke test |
| Phase 2 — Schema + CRUD | `[x]` PASS | Sinais 2 + 5 | `src/catalog/` |
| Phase 3 — Social detector | `[x]` PASS | Sinais 2 + 5 (mais 4 não exercido) | `src/social-detector/` |
| Phase 4 — Search/retrieval | `[x]` PASS recovery | **Sinal 3 strict** | `src/search/` — iter 0 FAIL → iter 3 fix → PASS |
| Phase 5 — System message builder | `[ ]` pending | — | **próxima** |
| Phases 6-9 | `[ ]` pending | — | server, cache, agents, E2E |

5-sinal framework completo em `.specs/STATE.md ## Handoff` seção `skill-readiness-final`.

---

## O que é failure diagnostics (skill v0.2, step 8a)

**Problema resolvido:** loop re-rodando mesma fixture sem atacar root cause (Phase 4 iter 1→2 reproduziu T-ORCH-19b).

**Mecanismo:** antes de re-dispatch em `FAIL`, orchestrator compara Verifier FAIL atual vs anterior. Se mesma fixture/AC falhou em ambos, **NÃO** auto-retry. Em vez disso, surface 3 alternativas:

1. **Refine test design** — fixture é decorative (ex: threshold permissivo). Redesenhar como boundary assertion antes do próximo dispatch.
2. **Escalate to human** — escrever STATUS em `STATE.md ## Handoff` com pattern stuck + escalar.
3. **Skip signal** — aceitar failure como closure pragmático; registrar em lessons.

Após strategy shift, iter count reseta pra 0 (pre-flight não conta contra o cap de 3 iterações).

**Onde está documentado:** `.claude/skills/tlc-roadmap-loop/SKILL.md` (LOCAL + GLOBAL — parity confirmada 2026-07-23).

**Quando dispara:** mesma AC/test ID falhou em iters consecutivos, sem mudança de comportamento observada entre eles.

**Quem decide:** o próprio orchestrator (não é prompt ao humano). Humano só é pagerado se orchestrator escolhe opção 2.

---

## Por que outros 4 candidatos NÃO entraram em v0.2

Decisão registrada em `.specs/STATE.md ## Decisions` como **AD-001**. Resumo:

| Candidato | Status | Trigger pra reativar |
|---|---|---|
| B3 — Discovery contributions de todos sub-agents | deferred | Quando 5+ phases acumularem e quisermos retroativa estruturada |
| Sub-agent context awareness | deferred | Quando sub-agent falhar por mal-entendido de contexto (não técnico) |
| Sticky context entre phases | deferred | Quando brief > 300 linhas e sub-agent ignorar seções |
| Branch-aware fingerprinting (worktrees) | YAGNI | Quando 2+ phases paralelas |
| Handoff auto-generation | YAGNI | Quando phase cruzar sessão 2+ vezes consecutivas |

**Princípio:** "implementar quando evidência aparecer, não quando hipótese surgir". Failure diagnostics ganhou v0.2 porque tinha failure concreto (T-ORCH-19b). Os outros não têm.

---

## Caminho concreto pra Phase 5 (próxima sessão)

**Objetivo:** implementar `src/augmenter/` — função que pega um prompt + matched skills do catálogo e constrói o augmented system message (injetar sem quebrar cache do provedor).

**Brief template** (a ser criado: `brief-m3cli-phase5.md` na raiz):
- **Phase slug:** `system-message-builder` ou `augmenter`
- **Depends on:** Phase 2 (schema) + Phase 4 (search) — ambos `[x]`, OK
- **Scope:** `src/augmenter/**`, `test/augmenter*.test.mjs`
- **Architecture ref:** `augmenter`, `cache`, `catalog`, `search` (4 stable IDs do farol)
- **Key constraint:** preservar provider cache — byte-string determinístico do augmented message (mesmo input → mesmo byte). Validar com teste explícito de determinismo.
- **Sinais-alvo:** Sinal 4 (discovery surface fires) tem chance real de disparar aqui — Phase 5 é a primeira a tocar 4 components do farol juntos, drift é provável.

**Stop conditions** (além das padrão do skill):
- Implementer/Verifier tentar usar LLM no hot path (PROIBIDO — `tenant_id` hasheado sha256[0:16], sem chamada externa no MVP)
- Cache determinístico falhar (mesmo input → byte diferente)

**Estimate:** 30-60 min se tudo correr limpo. Mais se Sinal 4 dispara e força re-render do farol.

---

## Decisões abertas (low priority, podem esperar)

### P3 — Hygiene dos arquivos de nota do humano
Arquivos não-rastreados na raiz:
- `Memory-Studio-Discuss.md`
- `interrogado-content.txt`
- `proposal-memory-studio-v2.md`

**Decisão do humano pendente:** rastrear (commit) ou deixar untracked? Não bloqueia Phase 5.

### P4 — Memory entries adicionais
Candidatos a registrar em `MEMORY.md`:
- `phase4-search-blocked-pattern.md` (T-ORCH-19b como exemplo de fixture decorativa)
- `loop-v2-failure-diagnostics.md` (mecanismo v0.2)

Não bloqueia Phase 5.

---

## Cross-references

- [CLAUDE.md](../CLAUDE.md) — convenções de stack, authority boundaries, testing contract
- [PLAN.md](../PLAN.md) — product spec (decisões travadas §6)
- [.specs/ROADMAP.md](ROADMAP.md) — phase ordering + dependency chain
- [.specs/STATE.md](STATE.md) — current state + decisions append-only
- [.specs/ARCHITECTURE.md](ARCHITECTURE.md) — farol em texto (LLM-facing)
- [.specs/architecture.html](architecture.html) — farol renderizado (human-facing)
- [.specs/DISCOVERIES.md](DISCOVERIES.md) — append-only log de drift arquitetural
- [.claude/skills/tlc-roadmap-loop/SKILL.md](../.claude/skills/tlc-roadmap-loop/SKILL.md) — skill v0.2 (LOCAL + GLOBAL em parity)
- [archive_handoff/handoff-session-2026-07-23.md](archive_handoff/handoff-session-2026-07-23.md) — histórico da calibração completa

---

## Lição consolidada (pra agente futuro)

**Quando uma phase trava em FAIL repetido sem atacar root cause, failure diagnostics (step 8a) deve disparar antes do cap de 3 iterações.** Não confiar no cap sozinho — pre-flight explícito > retry cego.

Mais: skill-readiness precisa de **evidência fim-a-fim**, não declaração. "Skill ready" só é ready quando sinais 2 + 5 verdes + pelo menos 1 de (3 OU 4) disparou em phase real. Phase 5+ deve mirar Sinal 4 explicitamente (recomendar sub-agents a notar drift arquitetural).
