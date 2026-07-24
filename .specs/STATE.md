# STATE

## Decisions
(vazio por enquanto — append-only a partir de agora)

## Handoff
- phase: `search` (Phase 4 do ROADMAP) — **PASS (recovery via brief-m3cli-phase4-recovery.md)**
- phase-slug: `search`
- previous-phase: Phase 2 (schema-and-crud) [x] — PASS
- previous-phase-2: Phase 3 (social-detector) [x] — PASS
- status: PASS — 185/185 tests green, Phase 4 flipped [x] in ROADMAP. T-ORCH-19b tightened to threshold 0.5 (boundary row at cosine 0.5 stays, cosine 0.4472 row is filtered) and T-VEC-08 added (3 skills with identical embeddings assert skill_id ASC tie-break).
- next-step: Sinal 3 strict closes (FAIL iter 0 → fix iter 2 recovery → PASS recovery). Sinal 1 (promote global) is the remaining manual decision for humano.
- repo: c:\Users\User\Desktop\AI-Project\Memory-Studio
- branch: main, head: see git log (post-recovery commit)
- uncommitted: nenhum (after recovery commit)
- skill-active: .claude/skills/tlc-roadmap-loop/SKILL.md (LOCAL, patched Turno 1)
- iter-log:
  - iter 0: Phase 4 Planner (DONE, 7 tasks) → Implementer (DONE, 7 commits, 179 tests) → Verifier (FAIL: 2 surviving mutants + 5 evidence gaps)
  - iter 1: Fix Implementer (DONE, 8 commits, 184 tests) → Re-verify (FAIL: T-ORCH-19b threshold too permissive + tie-break not committed)
  - iter 2: Fix Implementer (BLOCKED, runaway trigger; same T-ORCH-19b fixture kept failing)
  - iter 3 (recovery): brief-m3cli-phase4-recovery.md — 2 surgical fixes in test files (no src touched, no sub-agents run). T-ORCH-19b tightened to threshold 0.5 with boundary assertions + inline e_0 embedder (queryEmbedderE0 helper has pre-existing bug masked by threshold -1). T-VEC-08 added for tie-break. → 185/185 green.
- phase-2-observation: Verifier flagged commit d441e05 (brief-m3cli-phase3.md) as in-range but not by Phase 2 Implementer. M3E committed between phases. Not a code violation; documentation note only.
- runaway-triggers-fired: yes (iter 2, T-ORCH-19b fixture); orchestrator stopped per brief stop condition
- skill-readiness-assessment: Sinais 2 + 5 verdes (Phase 2 + 3 + 4 all cycle green); **Sinal 3 strict fecha** (Phase 4 iter 0 FAIL → iter 3 fix → recovery PASS); Sinal 4 not fired; Sinal 1 manual pending
- pre-existing-test-helper-bug: queryEmbedderE0() in search.test.mjs:671 returns constant 0 for any input (its inner map checks `idx === 0` against the query text, which is always a non-zero string). Bug was masked by the previous test's `minCosineSimilarity: -1` threshold. Recovery fix inlines a correct e_0 embedder inside T-ORCH-19b only (helper itself untouched — out of recovery scope).
