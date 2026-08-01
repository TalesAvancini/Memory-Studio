---
date: 2026-07-30
version: 3
description: "Spec state vigente — era `2026-08-prd-v3-ready`. PRD v3.4 + PLAN v3 + SPEC v2 + ROADMAP v5. Loop ready, awaiting first invocation."
explanation: |
  Substitui STATE.md v2 (2026-07-24, era `2026-07-foundation-complete`).

  Mudanças desta versão:
  - `## Handoff` ganha `phase: "Phase 0 — Environment Validation"` para o
    `tlc-roadmap-loop` retomar no step 1 (v6 Marco 27).
  - Decisão AD-002 atualizada: PRD fechado em 2026-07-26 (v3.0 → v3.4),
    `grill-with-docs` não é mais o próximo passo. Próximo passo é a
    primeira invocação do loop em `.specs/ROADMAP.md`.
  - Calibration residue (`src/`) marcada como esperada até Phase 1
    reescrever — ver `.specs/CALIBRATION-RESIDUE.md`.
  - `.memory-studio/` materializado (PRD §14.5): `setup.md` +
    `state.json` default.

  Estado vigente:
  - Skill `tlc-roadmap-loop` v0.2 (4/5 Waldemar sinais verde)
  - PRD v3.4 + PLAN v3 + SPEC v2 + ROADMAP v5 (reformatado v6)
  - BACKLOG 13 entries (I-001 a I-013)
  - LESSONS store: 0 lessons, store inicializado
  - Farol: runtime-only (5 módulos, 25 componentes, 26 conexões)
  - Testing contract em CLAUDE.md
  - 185/185 testes verde, `tsc --noEmit` clean

  Próximo passo: invocar `tlc-roadmap-loop` em `.specs/ROADMAP.md` →
  Phase 0 (`scripts/verify-env.mjs`).
related:
  - ./archive/2026-07-calibration/STATE.md
  - ./CALIBRATION-RESIDUE.md
  - ../scratch/memory-studio/spec.md
  - ../../PRD.md
  - ../../PLAN.md
  - ../../.specs/ROADMAP.md
  - ../../CLAUDE.md
  - ../../handoff-session.md
  - ../../History.md
---

# STATE

> **Papel:** memória da spec **vigente**. `## Decisions` é append-only (AD-NNN). `## Handoff` é overwrite por sessão.
> **Lê quando:** for entender estado atual de spec/decisões/handoff.
> **Diferente de:**
> - `History.md` — passado cronológico (narrativa + marcos)
> - `handoff-session.md` — executivo de sessão (o que estamos fazendo AGORA)
> - `MEMORY.md` — patterns de processo (1 fato por arquivo, auto-injetado)
>
> **Docs auxiliares:** ver `CLAUDE.md ## Documentation lifecycle` para o mapa completo.

## Decisions

### AD-002 — Calibração fechada; PRD fechado em 2026-07-26; loop pronto (2026-07-30)

**Decisão:** Calibração da skill `tlc-roadmap-loop` está **fechada** (4/5 sinais verde, Sinal 4 mechanism in place). PRD v3.4 está **fechado** (2026-07-26 → v3.4 com inception híbrida mandatory). `grill-with-docs` foi superado por `auto-grill` v0.2 (executado 1× em produção, 9/9 decisions aprovadas). Próximo passo: invocar `tlc-roadmap-loop` em `.specs/ROADMAP.md` → Phase 0.

**Por quê:** Skill é fundação. PRD é fonte de decisões. `auto-grill` resolveu ambiguidades restantes (D-001 a D-009). Loop pode agora rodar.

**Regras da era (vigentes):**

- Decisões reversíveis (lib, naming, estrutura) → autonomous resolve (Implementer + Verifier)
- Decisões irreversíveis (escopo MVP, exclusões, authority) → escala humano
- **Calibration residue (`src/`) é esperado até Phase 1 reescrever** — Verifier marca drift findings em `src/**/*.ts` como `quarantined` nas primeiras 2-3 phases (ver `.specs/CALIBRATION-RESIDUE.md`)

**Trigger pra sair desta era:** ROADMAP v5 todas as phases `[x]` (Phase 0 → 7b). Aí declarar Memory Studio em produção.

### AD-001 — Loop v2 escopo = failure diagnostics only (2026-07-23)

(Decisão histórica — preservada da era de calibração. Ver `.specs/archive/2026-07-calibration/STATE.md` para contexto completo.)

**Resumo:** Skill v0.2 inclui apenas `step 8a` (failure diagnostics pre-flight). Outros 4 candidatos a v2 (sub-agent awareness, sticky context, branch fingerprinting, handoff auto) deferidos com trigger explícito.

## Handoff

- **phase:** "Phase 7a — Metrics Instrumentation"
- **phase-previous:** "Phase 6b — Fast Agent + Intel Pipeline (mandatory)" (DONE 2026-08-01 via subchapters 6b.1, 6b.2, 6b.3, 6b.4. 17 atomic tasks across 3 Implementer batches. 459 root + 152 UI + 16 SDK = 627 tests. All gates green. POC re-run at end-of-phase: TOTAL overhead max=2.15ms ≪ 10ms budget (5× headroom) — Phase 6a POC ceilings survived per PRD §16.7. R-15 cache hit invariant validated. AD-006 + AD-007 + AD-008 + AD-009 in `.specs/DISCOVERIES.md`. Final HEAD at `bc95558`. Known scope gap: proxy T-14 fast-agent scheduling deferred to Phase 7b per AD-009)
- **phase-6a-status:** "Phase 6a — POC Validation" (DONE 2026-08-01 via subchapters 6a.1, 6a.2, 6a.3. 6 atomic commits. 391 root + 152 UI + 16 SDK + 19 POC = 578 tests. POC verdict: PASS on all 3 targets)
- **phase-5a-status:** "Phase 5a — API + Retrieval + Byte-string" (DONE 2026-08-01 via subchapters 5a.1, 5a.2, 5a.3, 5a.4. 13 atomic commits. 309 root + 152 UI + 16 SDK = 477 tests. All gates green. Final HEAD at `701a2f2`)
- **phase-5a.2:** "Phase 5a.2 — Retrieval Pipeline" (DONE 2026-08-01, 3 iterations — iter 1 FAIL on G1 CRITICAL tiebreak, iter 2 Implementer died API 429 with FT-01/02 committed, iter 3 Windows cleanup + R-14 fail-open. Verifier iter 3 PASS. ~443 tests: 275 root + 152 UI + 16 SDK. Commits `fe07efa`, `526ddf5`, `23f6242`, `17a0d32`, `3fe84ba`)
- **phase-5a.1:** "Phase 5a.1 — Server Foundation" (DONE 2026-07-31, 1 iteration, Verifier PASS commit `5cf6894`, ~395 tests: 227 root + 152 UI + 16 SDK)
- **phase-4-status:** "Phase 4 (UI Panel) entire phase DONE via subchapters 4.1, 4.2, 4.3, 4.4 — all `[x]`. 375 tests total."
- **phase-3:** "Phase 3 — SDK Cliente" (DONE 2026-07-31, 1 iteration)
- **phase-2:** "Phase 2 — Detector + Fingerprint" (DONE 2026-07-31, 1 iteration)
- **phase-1-status:** "Phase 1 (Catalog + Schema + Index) entire phase DONE via subchapters 1.1, 1.2, 1.3, 1.4 — all `[x]`"
- **phase-zero:** "Phase 0 — Environment Validation" (DONE 2026-07-30, 6/6 checks PASS)
- **era:** `2026-08-prd-v3-ready`
- **era-anterior:** `2026-07-foundation-complete` (skill calibrada, archived em `archive_handoff/`)
- **next-epoch:** PRD-driven product build (Phases 0-7b de `.specs/ROADMAP.md`)
- **skill-version:** v0.2 (LOCAL + GLOBAL em parity)
- **produção-Memory-Studio:** autorizada via PRD fechado; execução via loop
- **branch-ativa:** `loop/phase-0`
- **próximo-step-concreto:** dispatch Implementer Phase 7a single batch (7 atomic tasks: T-01 metrics ring buffer + T-02 lifecycle + T-03 collector/dashboard + T-04 GET /metrics route + T-05 boot wiring + T-06 hook sites + T-07 tests + smoke). NEW endpoint 8th, NOT extension of /health
- **phase-7a-plan:** Planner artifacts at `.specs/features/phase-7a-metrics/{spec.md, design.md, tasks.md}` (commit `49183cc`). 7 atomic tasks single batch. 5 metrics (request_hit_rate + token_cache_coverage + p50/p99_latency_ms + working_set_mb). Refresh trigger: N=10 OR T=60s. PRD divergences documented in spec.md §5.
- **phase-6b.4-status:** "Phase 6b.4 — Pipeline Integration + Cache Hit Validation" (DONE 2026-08-01, 1 iteration, Verifier PASS at `bc95558`. runAugment Stage 1b + tail setImmediate + 11 inception tests + latency trick smoke + AD-007/008/009. POC re-run: TOTAL max=2.15ms ≪ 10ms. 459 root + 152 UI + 16 SDK = 627 tests. Commits `f7965c9`, `1d865a7`, `a1b867d`, `94bf85c`, `bc95558`)
- **phase-6b.1-status:** "Phase 6b.1 — Intel Store Foundation" (DONE 2026-08-01, 1 iteration, Verifier PASS at `fbc6c47`. 004_intel.sql + WAL + index + getIntel + writeIntelRow + Intel type + Zod schema + 11 catalog tests. Commits `584fe60`, `b4a5d2f`, `37f9b70`)
- **phase-6b.2-status:** "Phase 6b.2 — Fast Agent Module" (DONE 2026-08-01, 1 iteration, Verifier PASS at `fbc6c47`. client.ts + writer.ts + boot.ts env wiring + SDK install verified. AD-008 SYNC decision (writer-perf p95 = 0.108ms). 17 fast-agent tests. Commits `cdacf70`, `d96d6e6`, `51ef228`, `21d5887`, `fbc6c47`)
- **phase-6a-plan:** Planner artifacts at `.specs/features/phase-6a-poc-validation/{spec.md, design.md, tasks.md, poc-results.md}` (commits `ddc7c0c` + `84d70a1`). 11 atomic POC tasks closed. Verifier PASS at `84d70a1` with re-measurement within 1.6% of Implementer's numbers. AD-006 in `.specs/DISCOVERIES.md` records 4 architectural decisions for Phase 6b.
- **phase-6b-plan:** Planner artifacts at `.specs/features/phase-6b-fast-agent-intel/{spec.md, design.md, tasks.md}` (commit `3838214`). 17 atomic tasks across 4 sub-chapters (6b.1 intel store, 6b.2 fast agent, 6b.3 BuildOptions.intel, 6b.4 pipeline + cache hit). 3 Implementer batches of 8+4+5. POC ceilings are Phase 6b per-request latency budgets (T-17 re-runs POC at end-of-phase).
- **working-tree:** working (`loop/phase-0` em `c7e7a8d`)
- **lessons-store:** L-001..L-006 (Phase 1+3) + L-007 (Phase 5a.2: API 429 mid-task recovery) + L-008 (Phase 5b.3: deferred-wiring pattern for contractually-correct no-op fallback)
- **working-tree:** working (`loop/phase-0` em `b6ced99`)
- **phase-5b-plan:** Planner artifacts at `.specs/features/phase-5b-aux-endpoints/{spec.md, design.md, tasks.md}` (commit `b6ced99`). 14 atomic tasks across 4 sub-chapters (5b.1 audit foundation, 5b.2 read endpoints, 5b.3 write endpoints + R-06, 5b.4 transparent proxy). 2 Implementer batches of 8+6.
- **lessons-store:** L-001..L-004 (Phase 1) + L-005/L-006 (Phase 3) + L-007 (Phase 5a.2: API 429 mid-task recovery pattern)
- **next-pending-action:** save L-007 lesson (recurrence=2), then dispatch Implementer Phase 5a.3 (T-09 byte-string equality + T-10 tiebreak stress [already done as byte-string-determinism.test.mjs] + T-11 end-to-end smoke + Claude Code integration guide)
- **phase-3-feature-dir:** `.specs/features/phase-3-sdk-client/{spec.md, design.md, tasks.md, validation.md}` (commit `fe20a66`)
- **phase-2-feature-dir:** `.specs/features/phase-2-detector-fingerprint/{spec.md, tasks.md, validation.md}` (commit `74b4cdc`)
- **phase-1.4-feature-dir:** `.specs/features/phase-1-catalog-schema-index/validation-phase-1.4.md` (commit `4de0632`)
- **phase-1.3-feature-dir:** `.specs/features/phase-1-catalog-schema-index/validation-phase-1.3.md` (commit `635778e`)
- **phase-1.2-feature-dir:** `.specs/features/phase-1-catalog-schema-index/validation-phase-1.2.md` (commit `b49ae4f`)
- **phase-1.1-feature-dir:** `.specs/features/phase-1-catalog-schema-index/{spec.md, design.md, tasks.md, validation.md, fix-tasks.md}` (commit `ea4bc54`)
- **phase-0-feature-dir:** `.specs/features/phase-0-environment-validation/{spec.md, tasks.md, validation.md}` (Verifier PASS commit `218dad1`)
- **não-congela:** STATE.md `## Decisions` append-only; `## Handoff` overwrite por sessão
- **calibration residue:** `src/catalog/**` (Phase 1) + `src/social-detector/**` (Phase 2) + `packages/sdk/` (Phase 3 greenfield). Próximo: `src/ui/**` (Phase 4 HTMX+Alpine, zero build step).
