# ECC skills backlog

Curated from affaan-m/ecc (MIT) audit 2026-07-30. Source: 281 skills in ECC, 67 agents in ECC. After agent audit, 13 agents selected for import; this is the skills-side follow-up.

**Selection rule:** a skill is added only if referenced by one of the 13 selected agents AND relevant to the Memory Studio stack (Node 22 + TypeScript + Fastify + SQLite + ONNX).

| skill | referenced by | relevant? | status |
|---|---|---|---|
| `tdd-workflow` | tdd-guide | yes (loop uses TDD) | **candidate install** |
| `agent-self-evaluation` | agent-evaluator | yes (meta-quality) | **candidate install** |
| `react-patterns` | react-reviewer | no (not React) | deferred |
| `react-testing` | react-reviewer | no (not React) | deferred |
| `frontend-patterns` | react-build-resolver | no | deferred |
| `accessibility` | react-reviewer | no | deferred |
| `flutter-dart-code-review` | dart-build-resolver | no | deferred |
| `marketing-campaign` | marketing-agent | no | deferred |
| `seo` | seo-specialist | no | deferred |
| `cpp-coding-standards` | cpp-reviewer, cpp-build-resolver | no (not C++) | deferred |
| `golang-patterns` | go-reviewer, go-build-resolver | no (not Go) | deferred |
| `rust-patterns` | rust-reviewer, rust-build-resolver | no (not Rust) | deferred |
| `kotlin-patterns` | kotlin-build-resolver | no (not Kotlin) | deferred |
| `vue-patterns` | vue-reviewer | no (not Vue) | deferred |
| `springboot-patterns` | java-reviewer, java-build-resolver | no (not Java) | deferred |
| `quarkus-patterns` | java-reviewer, java-build-resolver | no (not Java) | deferred |
| `django-patterns` | django-reviewer, django-build-resolver | no (not Django) | deferred |
| `django-security` | django-reviewer, django-build-resolver | no | deferred |
| `django-tdd` | django-reviewer | no | deferred |

**Install plan:**

1. **`tdd-workflow`** — install from `C:/Users/User/Desktop/ProjetosAntigravity/SKILLs_Colection/ecc/skills/tdd-workflow/`. Will need frontmatter normalization (add `date`/`version`/`explanation`).
2. **`agent-self-evaluation`** — install from same source. Same frontmatter treatment.

**Deferred (17 skills):** all language-specific (C++, Go, Rust, Kotlin, Vue, Spring, Quarkus, Django) or domain-specific (React, marketing, SEO). Memory Studio is single-stack (Node 22 + TS). Revisit if the tech stack expands.

**Excluded from audit (2):**

- `planner` agent — depends on `hooks/stripe/route.ts` (hook runtime, not adopted)
- `chief-of-staff` agent — depends on `PostToolUse` hook (not adopted)

**Provenance:** affaan-m/ecc, MIT, commit `e4e4163` (2026-07-29). 236k stars, 35k forks.

**Source of full corpus for future curation:** `C:/Users/User/Desktop/ProjetosAntigravity/SKILLs_Colection/ecc/` (skills/ + agents/, complete from upstream).
