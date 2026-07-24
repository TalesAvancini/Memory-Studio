# STATE

## Decisions

### AD-001 — Loop v2 escopo = failure diagnostics only (2026-07-23)

**Decisão:** A skill `tlc-roadmap-loop` evolui para v0.2 com **apenas 1 mecanismo novo** (failure diagnostics pre-flight, step 8a). Os outros 5 candidatos do Conselheiro (B3 + 4 especulativos) ficam em backlog com trigger explícito.

**Por quê:** Failure diagnostics tem evidência empírica direta (Phase 4 iter 1→2 reproduziu T-ORCH-19b sem atacar root cause). Os outros 4 (sub-agent awareness, sticky context, branch fingerprinting, handoff auto) não têm failure concreto observado que justifiquem implementação.

**Critério de trigger pra reativar candidatos:**

| Candidato | Implementar quando |
|---|---|
| B3 (Discovery contributions todos sub-agents) | Quando 5+ phases acumularem e quisermos retroativa estruturada |
| Sub-agent context awareness | Quando sub-agent falhar por mal-entendido de contexto (não técnico) |
| Sticky context | Quando brief ultrapassar 300 linhas e sub-agent ignorar seções |
| Branch fingerprinting | Quando tivermos 2+ phases paralelas |
| Handoff auto-generation | Quando phase cruzar sessão 2+ vezes consecutivas |

**Por que não houve outras decisões (escopo Loop v2, etc):** Loop v2 vira patch da skill. Outras decisões (P3 hygiene, P4 memories) seguem em handoff-session.md na raiz.

## Handoff
- phase: `search` (Phase 4 do ROADMAP) — **PASS** (recovery via brief-m3cli-phase4-recovery.md)
- skill-version: **v0.2** (added step 8a — failure diagnostics pre-flight, 2026-07-23)
- skill-active: .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL, promoted to GLOBAL via cp 2026-07-23)
- repo: c:\Users\User\Desktop\AI-Project\Memory-Studio
- branch: main, head: see git log
- uncommitted: nenhum (after skill patch + handoff rewrite commits)
- next-phase: **Phase 5 — System message builder** (primeira production work usando a skill v0.2)
- iter-log-completo-calibration:
  - Phase 1: PASS (scaffold + smoke test, Waldemar #1)
  - Phase 2: PASS (schema-and-crud, Sinais 2 + 5)
  - Phase 3: PASS (social-detector, Sinais 2 + 5)
  - Phase 4: PASS recovery (search, Sinal 3 strict fecha — Phase 4 iter 0 FAIL → iter 3 fix → recovery PASS)
- skill-readiness-final:
  - Sinal 1 (Promote global): ✅ done 2026-07-23 (cp + diff=0)
  - Sinal 2 (Cycle fim-a-fim): ✅ Phase 1+2+3+4 verde
  - Sinal 3 (Recovery FAIL→PASS): ✅ strict
  - Sinal 4 (Discovery surface): not yet fired (acceptable — farol cobre as components atuais)
  - Sinal 5 (Binary verifier c/ evidência): ✅
- v0.2 delta: step 8a pre-flight — antes de re-dispatch em FAIL, compara failure atual vs anterior; se same-fixture-fail-2x, surface strategy alternatives (refine test design / escalate / skip signal) ao orchestrator. Iterations reset após strategy shift.
- v0.2 archive: handoff-session.md antigo → archive_handoff/handoff-session-2026-07-23.md

