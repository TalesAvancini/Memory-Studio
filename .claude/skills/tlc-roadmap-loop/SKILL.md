---
name: tlc-roadmap-loop
description: Orchestrate the tlc-spec-driven pipeline as an autonomous loop over a `.specs/ROADMAP.md`. Composes three sub-agents (Planner, Implementer, Verifier) per phase, gates on Verifier PASS, flips the phase checkbox, updates `STATE.md` Handoff, and loops until the roadmap is `[x]` end-to-end or escalation conditions trip. Do NOT plan, implement, or verify work yourself — that is what `tlc-spec-driven` and the sub-agents are for. Trigger on "advance the roadmap", "run the next phase", "loop the roadmap", "/loop roadmap", "build the next phase", "implement next feature". Do NOT use for single-feature SDD (use `tlc-spec-driven` directly) or for cross-stack architecture decomposition (use architecture skills).
license: CC-BY-4.0
metadata:
  author: M3-CLI
  composed_on: tlc-spec-driven v3.2.0
---

# Roadmap Loop (tlc-roadmap-loop)

**Driver only.** This skill orchestrates. All planning, task format, implementation rules, and validation live in `tlc-spec-driven`. Reference it by name; do not duplicate its rules.

## What this skill adds on top of `tlc-spec-driven`

| Delta | Meaning |
|---|---|
| **Three named sub-agent roles** | `Planner` → `Implementer` → `Verifier`, each dispatched as a fresh sub-agent in sequence. The orchestrator sequences them; never writes spec/code/tests itself. |
| **Single Implementer per phase** | One sub-agent runs every task in `tasks.md`. Skips `tlc-spec-driven`'s phase-batch worker offer — adds coordination cost, buys nothing in a long loop. |
| **Phase picker** | Reads `.specs/ROADMAP.md`, picks the first unchecked phase whose `Depends on:` list is all `[x]`. Resume is driven by `.specs/STATE.md` `## Handoff`. |
| **Auto-commit inside the loop** | Implementer commits per task without confirmation; orchestrator commits phase-mark on PASS. (Outside the loop: same SDD rules, no auto-commit.) |
| **Verdict gating** | Verifier `PASS` → flip `[x]` + advance. `FAIL` → fix task → re-dispatch Verifier. Bounded to **3 fix→re-verify iterations** before escalation (inherits the cap from `tlc-spec-driven`). |
| **Subchapter escape hatch** | If Planner or Implementer detects the phase is too big for one Implementer, it returns `SUBCHAPTER_BREAKDOWN: [subA, subB, ...]`. Orchestrator inserts the subchapters at the current position and the loop picks them up next iteration. |
| **Lessons as feedback signal** | Confirmed lessons from `.specs/LESSONS.md` are loaded before Planner dispatch; new grounded failures are appended after Verifier FAIL via `scripts/lessons.py`. |

## Preconditions — must hold before running this loop

Waldemar's four. If any is not satisfied, the loop will burn tokens and produce low-quality work:

1. **Fast feedback.** Tests + lint + build finish in seconds, not minutes. Slow gates stall the loop and explode cost.
2. **Reliable stop condition.** The Verifier's PASS/FAIL is the gate — binary, evidence-anchored, not vibes.
3. **Sufficient backlog.** At least ~5 phases in the roadmap. Below that, the orchestration overhead exceeds the manual cost.
4. **Clear project glue.** `AGENTS.md` (or equivalent) defines the testing contract, authority boundaries, and stack conventions. Sub-agents point at it — they do not restate it.

If a precondition fails, fix it before invoking the loop.

## Orchestrator flow

```
1. Load .specs/STATE.md (## Decisions + ## Handoff + ## Roadmap pointer if present).
2. Load .specs/LESSONS.md — confirmed only, never candidates or quarantined.
   (list via `python3 scripts/lessons.py list --status confirmed` if present.)
3. Pick next phase:
   - If ## Handoff has a `phase:`, resume it (continue from the recorded next-step).
   - Else, walk .specs/ROADMAP.md and pick the first `#### Phase N — ... [ ]`
     whose `**Depends on:**` list is all `[x]`.
4. Clean env if needed (free ports, kill stale processes — repo-specific).
5. Dispatch Planner sub-agent. (See prompt template below.)
   - If Planner returns SUBCHAPTER_BREAKDOWN, insert subchapters at the current
     position in ROADMAP.md, persist, log, and skip to step 3 for the next iteration.
   - Else Planner writes `.specs/features/<phase-slug>/{spec.md, design.md?, tasks.md}`.
6. Dispatch Implementer sub-agent. (See prompt template.)
   - Runs the entire tasks.md in order, per-task: implement → gate → atomic commit.
   - Never spawns further sub-agents.
   - If Implementer returns SUBCHAPTER_BREAKDOWN (phase too big), split & re-loop.
7. Dispatch Verifier sub-agent. (See prompt template.)
   - Independent fresh sub-agent. Author ≠ verifier.
   - Runs: spec-anchored outcome check + discrimination sensor + writes
     `.specs/features/<phase-slug>/validation.md` (PASS/FAIL).
   - Returns compact verdict + ranked gap list to the orchestrator.
8. Verdict handling:
   - PASS
     - Edit `.specs/ROADMAP.md` — flip `[ ]` → `[x]` on the phase heading.
     - Update `.specs/STATE.md` `## Handoff` (section-scoped write — never touch Decisions).
     - Commit: `docs(spec): mark phase <N> complete in ROADMAP and STATE`.
     - If lessons signal: run `python3 scripts/lessons.py add ...` for each grounded failure.
     - Loop back to step 1.
   - FAIL with gaps
     - Append fix tasks to `tasks.md` (or queue a new fix-tasks file in the feature dir).
     - If iteration count < 3 → re-dispatch Verifier (after Implementer runs the fix).
     - If iteration count == 3 → escalate to user (see Stop conditions).
8b. Architectural drift surface (after Verifier, regardless of PASS/FAIL):
   - If `.specs/DISCOVERIES.md` was appended this phase, surface to user:
     "Phase N introduced D-NNN architectural discovery: <title>.
      Severity: <cosmetic | structural | critical>.
      Suggest reviewing the farol. Re-render? (y/n)"
   - User y → orchestrator runs the full re-render sequence (orchestrator owns this, not sub-agents):
     1. Update `.specs/ARCHITECTURE.md` to reflect the discovery (text + stable IDs).
     2. Regenerate `.specs/architecture.architecture.json` from the updated ARCHITECTURE.md (orchestrator may dispatch a fresh sub-agent for this single task if schema fidelity matters).
     3. Validate: `node .agents/skills/archify/bin/archify.mjs validate architecture .specs/architecture.architecture.json`
     4. Render HTML: `node .agents/skills/archify/bin/archify.mjs render architecture .specs/architecture.architecture.json .specs/architecture.html`
     5. Surface final paths (`ARCHITECTURE.md`, `architecture.html`) to user.
   - User n → leave `.specs/DISCOVERIES.md` entry as `proposed`; human reviews later.
   - Severity handling:
     - `critical` → escalate immediately, regardless of user choice; block next phase until decision.
     - `structural` (3+ accumulated without review) → auto-suggest y without waiting for trigger.
     - `cosmetic` → log only; do not surface.
9. Stop conditions (any one):
   - All phases `[x]` → loop done. Emit final report.
   - 3× consecutive Verifier FAIL on the same phase → escalate.
   - Planner/Implementer/Verifier report a hard blocker (missing tool, ambiguous AC at phase level, dep on a phase not yet `[x]`) → escalate.
   - User interruption (Ctrl-C, explicit "stop loop") → write Handoff, stop.
```

## Sub-agent prompt template

**Sub-agents cannot see this chat.** Each prompt must be self-contained. Append project glue as pointers, not as content.

```
=== ROADMAP LOOP — <ROLE> DISPATCH ===

ROLE: <Planner | Implementer | Verifier>

# 1. Activate the base skill
Activate `tlc-spec-driven` by name and follow it for the assigned role:
- Planner → Specify + (Design if Large/Complex) + Tasks
- Implementer → Execute (one task at a time, full cycle, never spawns sub-agents)
- Verifier → Validate (spec-anchored check + discrimination sensor + write validation.md)
If the skill cannot be activated, STOP and report the blocker.

# 2. Feature context
- Phase: <N> — <title>
- Phase slug: <kebab-case-slug>
- Output dir: .specs/features/<phase-slug>/
- Repo path: <absolute path>
- ROADMAP excerpt: <the 5-30 lines of the phase heading + Done when + Depends on + sub-items>

# 3. Confirmed lessons (feed-forward from prior phases)
<one line per confirmed lesson, e.g. "L-002: server is the test boundary, never trust client">
<empty if no store yet>

# 4. Autonomous mode contract
- Resolve ambiguities as spec assumptions logged in spec.md (Assumptions & Open Questions table).
- No user confirmation gates.
- One atomic commit per task; conventional commits.
- Touch ONLY the files required for the assigned role.

# 5. Project glue (read on demand, do not restate)
- .specs/ROADMAP.md — phase scope + dependencies
- .specs/STATE.md — ## Decisions (AD-NNN), ## Handoff
- AGENTS.md — testing contract for this repo
- .specs/ARCHITECTURE.md — farol em texto com stable IDs (LLM-facing; **ler como texto**, NÃO abrir HTML)
- .specs/DISCOVERIES.md — log append-only de drift arquitetural (ler pra ver o que já foi descoberto)
- .specs/architecture.html — farol renderizado (humano-facing; interatividade é só pro humano, sub-agent ignora)
- <repo-specific references, e.g. "L2J Classic: parse XML, never depend">

# 6. Role-specific footnotes
- Planner: write spec.md + (design.md if needed) + tasks.md under .specs/features/<slug>/.
  Include Test Coverage Matrix and Gate Check Commands in tasks.md.
  Architectural reference: design.md MUST open with `## Architectural Reference`
  pointing to the relevant nodes/edges of the farol by stable ID
  (cross-reference .specs/ARCHITECTURE.md — read text, never "open in browser").
  If `.specs/ARCHITECTURE.md` does not exist yet (pre-bootstrap), fall back to
  `PLAN.md` and/or `AGENTS.md` as proxy — extract component names and surface
  them as candidate stable IDs in `## Architectural Reference`. Still proceed;
  never block the phase on missing farol.
  If design.md requires a new component/edge NOT in the current farol,
  DO NOT block — append the discovery to .specs/DISCOVERIES.md
  (create the file if missing; append-only log; severity: cosmetic | structural | critical)
  and proceed. The orchestrator surfaces DISCOVERIES.md at end of phase (step 8b).
  If the phase is too big for one Implementer, RETURN: SUBCHAPTER_BREAKDOWN: [subA, subB, ...]
- Implementer: paths to existing spec/design/tasks; authorized to commit per task;
  do NOT run Verifier; do NOT spawn sub-agents.
  If mid-phase you discover scope blow-up, RETURN: SUBCHAPTER_BREAKDOWN: [subA, subB, ...]
- Verifier: git diff/commit range for the phase; Implementer deviation summary if any;
  write .specs/features/<slug>/validation.md; return compact verdict + ranked gap list.
  Do NOT fix code.

# 7. Return contract (always)
Compact summary in chat:
- <ROLE> (<phase>): <DONE | BLOCKED | SUBCHAPTER_BREAKDOWN>
- Tasks done: [list with commit hashes] (Implementer only)
- Tests: [N passed, 0 failed]
- Deviations/blockers: [none | description]
- Verdict: [PASS | FAIL] + ranked gaps (Verifier only)
- Lesson signals: [list of grounded failures, if any] (Verifier only)
```

## State writes — section-scoped (CRITICAL)

`STATE.md` is append-only on `## Decisions` and overwrite on `## Handoff`. Treat them as **separate files with different lifecycles** even though they live in the same `.md`:

- Decisions append → never touch Handoff.
- Handoff overwrite → replace only the body between `## Handoff` and the next `##` or EOF.
- Pause/resume: write Handoff on stop, read Handoff on start.

Violating this is silent data loss. Mirror the rule from `tlc-spec-driven/references/memory.md`.

## ROADMAP.md format expected by this loop

```markdown
# Roadmap: <Product>

> **Autonomous loop source of truth.** The loop reads this file each iteration.
> Phase status is the checkbox at the end of the `####` heading.

---

## Hard dependency order
<one-line rules or "follow the Depends on: lists below">

---

#### Phase 1 — Foundation [ ]

**Done when:** <demoable outcome — server boots, client connects, seed populates DB>

**Depends on:** none

- [ ] Sub-item 1
- [ ] Sub-item 2
- [ ] Sub-item N

---

#### Phase 2 — Authoritative server + multiplayer [ ]

**Done when:** <client input is validated server-side, room broadcast works>

**Depends on:** Phase 1

- [ ] ...

---

#### Phase N — <Name> [ ]

**Done when:** ...

**Depends on:** Phase X, Phase Y

- [ ] ...
```

**Status legend:** `[ ]` pending · `[~]` in progress · `[x]` done.

## Subchapter breakdown contract

If a phase is too big for one Implementer, return `SUBCHAPTER_BREAKDOWN: [...]`.

**Triggers** (any one is sufficient — Planner or Implementer reports):
- `>15 atomic tasks` in `tasks.md`, OR
- `>=2 new discoveries` appended to `.specs/DISCOVERIES.md` during this phase, OR
- `>=1 critical discovery` (architectural boundary change — auth, persistence, authority, concurrency model).

Return shape (verbatim):

```
SUBCHAPTER_BREAKDOWN:
- <subA-slug>: <one-line scope>
- <subB-slug>: <one-line scope>
- ...
```

The orchestrator will:
1. Create new `#### Phase N.1`, `#### Phase N.2`, ... entries in `ROADMAP.md` (all `[ ]`, depending on the parent phase).
2. Move the parent's sub-items into the appropriate subchapters.
3. Insert the new phases at the **current position** so the loop picks them up next iteration.

**Do not split a phase across sub-agents.** Each subchapter is a fresh phase with its own Planner → Implementer → Verifier cycle.

## Critical rules

- **Never parallel phases.** Sequential. Sequential. Sequential.
- **Always fresh sub-agents.** Planner, Implementer, Verifier each get a clean context.
- **Single Implementer per phase.** No batch workers.
- **Auto-commit only inside the loop.** Outside: same SDD rules, no auto-commit.
- **Section-scoped writes** to `STATE.md`. Never overwrite the whole file.
- **Confirmed lessons only.** Never load candidates or quarantined lessons as guidance.
- **Discrimination sensor is mandatory.** Verifier always runs it.
- **3-iteration cap** on fix→re-verify per phase. Escalate on the third FAIL.
- **Sub-agent prompts are self-contained.** No references to "the chat above".

## Stop / pause behavior

When stopping (intentional or interrupted):
1. Update `.specs/STATE.md` `## Handoff` with: feature, phase/task, completed, in-progress (file:line), next step, blockers, uncommitted files, branch.
2. If mid-phase with uncommitted work, commit or stash — never leave the tree dirty.
3. Emit a compact chat summary of where the loop stopped and what's next.

Resume: load Handoff → propose next step to user before writing any code.

## Triggers

| Phrase | Action |
|---|---|
| "advance the roadmap", "run the next phase" | Loop: pick next phase, run full cycle. |
| "loop the roadmap", "/loop roadmap" | Loop: same, but assume autonomous mode until explicit stop. |
| "build the next phase", "implement next feature" | Loop: same. |
| "resume the loop", "continue the roadmap" | Loop: read Handoff, resume. |
| "stop the loop", "pause the loop" | Write Handoff, stop, report summary. |
| "where is the loop?" | Report current phase + progress + next step. |

## What this skill is NOT

- **Not a single-feature SDD driver.** For one feature, invoke `tlc-spec-driven` directly with "specify feature X" — no need for the orchestration layer.
- **Not an architecture decomposer.** For cross-stack architecture analysis, use architecture skills.
- **Not a code reviewer.** For diff review, use `code-review` or `simplify`.
- **Not a multi-agent fan-out tool.** Phases run sequentially. If you want parallelism, that is a different pattern.

## Companion skills

- `tlc-spec-driven` — the base skill this composes on. All planning/implementation/validation semantics live there.
- `find-skills` — discover companion skills if you need them.
- `notebooklm` — optional: if you want to seed lessons from external research before the loop runs.
