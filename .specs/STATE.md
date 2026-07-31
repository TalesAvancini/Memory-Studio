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

- **phase:** "Phase 1 — Catalog + Schema + Index"
- **phase-previous:** "Phase 0 — Environment Validation" (DONE 2026-07-30, 6/6 checks PASS, sha256 stable)
- **era:** `2026-08-prd-v3-ready`
- **era-anterior:** `2026-07-foundation-complete` (skill calibrada, archived em `archive_handoff/`)
- **next-epoch:** PRD-driven product build (Phases 0-7b de `.specs/ROADMAP.md`)
- **skill-version:** v0.2 (LOCAL + GLOBAL em parity)
- **produção-Memory-Studio:** autorizada via PRD fechado; execução via loop
- **branch-ativa:** `loop/phase-0` (contém phases concluídas; PR ao fim do loop)
- **próximo-step-concreto:** dispatch Planner para Phase 1 — Catalog + Schema + Index (PRD §6, SPEC §IMod-6/13/14/15)
- **working-tree:** working (`loop/phase-0` em `218dad1`; novos arquivos untracked: `.specs/architecture/custom-farol.html.bak`, `old_arquive-miscelanea/`, `.specs/archive/architeture/`, `.specs/archive/auto-grill-output/`)
- **phase-0-feature-dir:** `.specs/features/phase-0-environment-validation/{spec.md, tasks.md, validation.md}` (Verifier PASS commit `218dad1`)
- **não-congela:** STATE.md `## Decisions` append-only; `## Handoff` overwrite por sessão
- **calibration residue:** `src/` é esperado até Phase 1 reescrever (ver `.specs/CALIBRATION-RESIDUE.md`)
- **discoveries:** 0 entries em Phase 0 (Phase 0 não toca `src/`)
