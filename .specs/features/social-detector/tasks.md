# Social Detector Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, adequacy review, atomic commit, and handoff to the independent Verifier).

**If the skill cannot be activated, STOP and tell the orchestrator — do not proceed without it.**

One atomic commit is required after each task's full gate passes. Do not batch commits, weaken tests, or defer a task's tests to another task. The dispatch scope guard permits product changes only in `src/social-detector/**` and `test/social-detector.test.mjs` for these tasks.

---

**Design**: `.specs/features/social-detector/design.md`  
**Status**: Approved for autonomous execution  
**Task count**: 3 — one execution batch; no subchapter breakdown

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — authoritative for Execute under the autonomous dispatch. Guidelines found: `CLAUDE.md` (native `node:test`, every exported function behavior-tested, ≥80% `src/` coverage, `npm test` <10s), `.specs/ROADMAP.md` (≥20 PT-BR/EN regex patterns plus edge cases), `package.json` (actual `test` and `typecheck` scripts), and `test/smoke.test.mjs` (existing framework/location/style sample). Baseline observed during planning: `npm test` passed 5/5 in ~0.43s; `npm run typecheck` exited 0. Native Node 22 coverage flags were also verified in the active runtime.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Social detector domain/business logic | unit | All public branches; 1:1 coverage of SD-01 through SD-08; all 30 positive, 12 false-positive, 9 normalization, 2 baseline technical, long-input and determinism fixtures; ≥80% line/branch/function coverage | `test/social-detector.test.mjs` for `src/social-detector/**/*.ts` | `npm test` plus native coverage command below |
| Public TypeScript contract | none — build/type gate only | Exact `isSocial(prompt: string): boolean` signature; strict mode; no cross-domain import or additional public export | `src/social-detector/is-social.ts` | `npm run typecheck` |
| SQLite / ONNX / HTTP / augmenter wiring | none in this phase | N/A — no such boundary is created or touched; Phase 5 owns caller wiring | — | — |

Tests must derive expected booleans from `spec.md`; they must not import, count, snapshot or otherwise mirror private regex collections. Each fixture must be registered as its own `node:test` test/subtest so TAP counts expose silent deletion.

## Gate Check Commands

> Generated from the repository and active Node 22 runtime. Run commands separately in the order shown and stop on the first non-zero exit; this avoids shell-specific chaining syntax.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | During each task after a test/code edit | `npm test` — must exit 0 and complete in <10s |
| Full | Before each task commit | 1. `npm test`  2. `npm run typecheck`  3. `node --test --experimental-test-coverage "--test-coverage-include=src/social-detector/**/*.ts" --test-coverage-lines=80 --test-coverage-functions=80 --test-coverage-branches=80` |
| Build | After T3 / before Implementer handoff | Run the Full gate again; no `build` or `lint` script currently exists in `package.json` |

---

## Tool Selection

Autonomous-mode resolution of the skill's tool question:

- **MCPs**: NONE — the feature is local TypeScript with no external API or research dependency.
- **Skill for every task**: `tlc-spec-driven` Execute flow.
- **Verification**: use the repository commands in Gate Check Commands; the orchestrator will dispatch a fresh independent Verifier after implementation.

---

## Execution Plan

Phases and tasks are strictly sequential. The complete feature fits one three-task execution batch.

### Phase 1: Pure Classifier

```text
T1 → T2
```

T1 establishes the public classifier and required positive behavior. T2 adds normalization and the side-effect-free caller contract on that working base.

### Phase 2: Technical-Context Hardening

```text
T2 → T3
```

T3 adds the explicit false-positive whitelist after normalization semantics are stable.

---

## Task Breakdown

### T1: Implement the core social-pattern classifier

**What**: Create the single public `isSocial` function, its private anchored social-pattern catalog, and co-located behavior tests for all exact positive fixtures plus the default technical path.  
**Where**: `src/social-detector/is-social.ts` (new), `test/social-detector.test.mjs` (new)  
**Depends on**: None  
**Reuses**: named ESM export style from `src/index.ts`; `node:test` and `node:assert/strict` style from `test/smoke.test.mjs`  
**Requirements**: SD-01, SD-02, SD-06 (unmatched technical path), SD-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] `src/social-detector/is-social.ts` exports `isSocial(prompt: string): boolean` and does not add a barrel file.
- [ ] A private immutable social catalog has at least 20 anchored, non-stateful regex entries and covers all POS-01 through POS-30 fixtures.
- [ ] Every POS-01 through POS-30 fixture is registered as a separate behavior test and returns `true`.
- [ ] `Implement JWT authentication in TypeScript` and `Explain why this SQL query is slow` are separate behavior tests and return `false`.
- [ ] Tests observe only the public return value; no private pattern array is exported or inspected.
- [ ] Positive regexes use no `g`/`y` state and no nested unbounded quantifier.
- [ ] Full gate passes; `npm test` reports at least **37 passed, 0 failed** (5 existing + 32 new) in <10s, typecheck exits 0, and native coverage thresholds pass.

**Tests**: unit — 32 new spec-driven behavior cases co-located with the function  
**Gate**: Full  
**Commit**: `feat(social-detector): add pure social classifier`

---

### T2: Normalize prompt variants and finalize the pure hook contract

**What**: Add the private normalization pipeline and boundary behavior so presentation-only variants classify consistently while the exported hook remains deterministic and side-effect-free.  
**Where**: `src/social-detector/is-social.ts` (modify), `test/social-detector.test.mjs` (modify)  
**Depends on**: T1  
**Reuses**: T1 public function and social pattern catalog; native string/Unicode operations only  
**Requirements**: SD-03, SD-06, SD-07, SD-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] Private normalization applies NFC, outer trim, whitespace collapse, lowercase conversion, and removal of terminal `.`, `!`, `?`, `…` runs in the design's order.
- [ ] Normalization preserves commas, quotes, backticks, internal apostrophes and emoji rather than deleting technical/metalinguistic signals.
- [ ] NORM-01 through NORM-09 are each registered as a separate behavior test with the exact boolean from `spec.md`.
- [ ] One separate test proves repeated equal input returns the same primitive boolean.
- [ ] One separate test passes 100,000 repeated `x` characters and observes `false` without an exception.
- [ ] The module exports only the synchronous `isSocial` hook and contains no I/O, logging, mutable shared state, or imports from another product domain.
- [ ] Full gate passes; `npm test` reports at least **48 passed, 0 failed** (37 prior + 11 new) in <10s, typecheck exits 0, and native coverage thresholds pass.

**Tests**: unit — 11 new normalization, boundary and contract behavior cases  
**Gate**: Full  
**Commit**: `feat(social-detector): normalize prompt variants`

---

### T3: Add the technical-context false-positive whitelist

**What**: Add an ordered private false-positive regex catalog and behavior tests that preserve retrieval for causal, metalinguistic, identifier, prefix-collision and mixed technical prompts.  
**Where**: `src/social-detector/is-social.ts` (modify), `test/social-detector.test.mjs` (modify)  
**Depends on**: T2  
**Reuses**: T2 normalized prompt and default-false decision flow  
**Requirements**: SD-04, SD-05, SD-08

**Tools**:

- MCP: NONE
- Skill: `tlc-spec-driven`

**Done when**:

- [ ] A private immutable false-positive catalog is evaluated after normalization and before the positive social catalog.
- [ ] The catalog covers causal `thanks to`, verb/token/identifier/translation uses, actionable social prefixes, and the three specified prefix-collision families.
- [ ] FP-01 through FP-12 are each registered as a separate behavior test and return `false`.
- [ ] All 30 positive pattern tests remain `true`; no existing smoke, normalization, technical-default or contract test is removed or weakened.
- [ ] False-positive regexes use no stateful `g`/`y` flag, dynamic construction, or nested unbounded quantifier.
- [ ] Full gate passes; `npm test` reports at least **60 passed, 0 failed** (48 prior + 12 new) in <10s, typecheck exits 0, and native coverage reports ≥80% for lines, functions and branches.
- [ ] Scope check shows changes only under `src/social-detector/**` and `test/social-detector.test.mjs` for implementation commits.

**Tests**: unit — 12 new spec-defined false-positive/mixed-intent cases  
**Gate**: Full, then Build at phase completion  
**Commit**: `fix(social-detector): preserve technical prompt retrieval`

---

## Phase Execution Map

```text
Phase 1 → Phase 2

Phase 1:  T1 ──→ T2
Phase 2:          T2 ──→ T3

Effective task chain: T1 ──→ T2 ──→ T3
```

Execution is strictly sequential. Each task completes its tests, full gate and atomic commit before the next begins.

---

## Requirement Coverage

| Requirement | Planned task(s) | Outcome evidence |
| --- | --- | --- |
| SD-01 | T1 | Five mandatory roadmap examples among POS fixtures |
| SD-02 | T1 | POS-01 through POS-30 behavior tests |
| SD-03 | T2 | NORM-01 through NORM-09 behavior tests |
| SD-04 | T3 | FP-01 through FP-12 + precedence inspection |
| SD-05 | T3 | Mixed-task and prefix-collision false outcomes |
| SD-06 | T1, T2 | Technical defaults, empty/punctuation and 100k input |
| SD-07 | T2 | Direct import, determinism, primitive boolean, static boundary check |
| SD-08 | T1-T3 | Visible counts, <10s unit gate, typecheck and ≥80% native coverage |

**Coverage:** 8 requirements mapped, 0 unmapped.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Core social-pattern classifier | One public function/catalog behavior plus mandatory co-located tests | PASS — cohesive function deliverable |
| T2: Prompt normalization and hook contract | One private normalization/boundary behavior added to that function plus co-located tests | PASS — cohesive hardening deliverable |
| T3: False-positive whitelist | One ordered private catalog behavior plus co-located tests | PASS — cohesive hardening deliverable |

T1-T3 each touch a source file and its required test file because test co-location is mandatory; no task combines separate product components.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | Chain starts at T1 | PASS — match |
| T2 | T1 | T1 → T2 | PASS — match |
| T3 | T2 | T2 → T3 | PASS — match |

No dependency points to a later phase, and every diagram arrow has one corresponding task-body dependency.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Social detector domain logic | unit | unit, 32 co-located behavior cases | PASS |
| T2 | Social detector domain logic/public contract | unit + type gate | unit, 11 co-located cases + type gate | PASS |
| T3 | Social detector domain logic | unit | unit, 12 co-located behavior cases | PASS |

All production behavior is tested in the same task that creates or changes it. No test-only follow-up task or deferred coverage exists.
