---
name: auto-grill
description: Adversarial doc-review loop that interrogates a target document or composite (PRD + PLAN, spec + design, multiple plans) without synchronous human input. Combines the grilling engine (one-question-at-a-time, fact-vs-decision split, recommendation per question) with a Stakeholder Proxy sub-agent holding project context (CONTEXT.md, ADRs, scratchpad, farol stable IDs). Produces an Artifact Pack (transcript + decisions + loop-state + discoveries) and gates on human approval at the end — rejected items restart the loop on the affected branches. Use when you want to stress-test a spec/PRD before committing, without burning synchronous attention on every question. Triggers on "auto-grill <path>", "auto-grill <path1> <path2>", "interrogate <doc>", "grill this PRD", "stress-test this spec". Do NOT use for code review (use code-review), for live interactive planning (use grill-me), or for SDD feature planning (use tlc-spec-driven).
license: CC-BY-4.0
metadata:
  author: Memory-Studio
  composed_on: mattpocock-skills/grill-with-docs v1.1
  inspired_by: Matt Pocock (grilling, grill-me, grill-with-docs, domain-modeling)
  variant: autonomous (no synchronous HITL)
---

# Auto-Grill (autonomous grill-with-docs variant)

**What this skill is.** A drop-in replacement for `mattpocock-skills:grill-with-docs` that runs the same relentless interview loop **without burning your synchronous attention**. Two sub-agents in conversation: an **Interrogator** (adversarial reviewer) and a **Stakeholder Proxy** (answers from project context). You rejoin only at the human gate.

**Why it exists.** The Pocock originals are HITL-by-design: 40–100 questions, one at a time, with confirmation at the end. That's expensive in attention (the operator is captive) and in tokens (the operator's context stays warm). Auto-grill replaces the operator with a Proxy that holds the same context you would, surfaces only the decisions that actually need you, and stops the loop the moment anything goes unresolved.

---

## When to use

- You have a PRD / `spec.md` / `design.md` / plan / long diff and want to stress-test it before committing.
- You can't sit through 40–100 questions synchronously.
- You have rich project context (`CONTEXT.md`, `docs/adr/*.md`, scratchpad, farol stable IDs) that an agent can use to answer on your behalf.
- You want the output as a **structured artifact pack** you can review async (transcript + decisions table + confidence + tracer bullets).

## When NOT to use

- **Live design conversations** where you want to feel each branch — use `mattpocock-skills:grill-me` synchronously.
- **Code review** (a diff, not a doc) — use `mattpocock-skills:code-review` or `simplify`.
- **Single-feature SDD** (Specify → Design → Tasks → Execute) — use `tlc-spec-driven`.
- **Interactive clarification** of a vague request — use `mattpocock-skills:grilling` (model-invoked, lighter weight).
- **Anything that needs the operator's taste to be felt live.** Auto-grill is for the batches; not for the moments where taste matters.

---

## How it works

```
┌──────────────────────────────────────────────────────────────┐
│                ORCHESTRATOR (this skill)                       │
│  - Loads target doc + project context                        │
│  - Sets up loop with confidence_floor                        │
│  - Dispatches sub-agents in sequence per round               │
│  - Synthesizes Artifact Pack at the end                      │
│  - Gates on human approval; rejected items restart loop      │
└──────────────────────────────────────────────────────────────┘
            │                                    │
            ▼                                    ▼
   ┌─────────────────┐                 ┌──────────────────────┐
   │  Interrogator   │  ◄─── Q/R ───►  │  Stakeholder Proxy   │
   │  (skeptical)    │                 │  (answers w/ context)│
   │  - one Q/turn   │                 │  - CONTEXT.md/ADRs   │
   │  - w/ recommend │                 │  - scratchpad        │
   │  - 8 lenses     │                 │  - flag NO_EVIDENCE  │
   └─────────────────┘                 └──────────────────────┘
```

## SETUP — Pre-flight Checklist

**Run BEFORE round 1.** Any failure → STOP and fix; the loop without these is theater (regra 9).

- [ ] **CONTEXT.md exists OR build temp.** If absent, build from `CLAUDE.md §Glossary` + any product-specific glossary section in target docs (e.g., `PRD.md §17`, `PLAN.md §<X>`). Without ubiquitous language, two agents agree on confidently-wrong answers.
- [ ] **`.specs/ARCHITECTURE.md` exists?** If yes, load stable IDs into fingerprint. If no, skip farol (regra 10) — orphan IDs surface in `.specs/DISCOVERIES.md` with `conf=medium`.
- [ ] **Target identified.**
  - Single: `auto-grill <path>` → treats one doc as the spec.
  - Composite: `auto-grill <path1> <path2> ...` → treated as ONE spec; questions cross-reference both docs.
- [ ] **Output dir ready.** Default: next to target. For composite / long runs (>30 rounds): use `.specs/auto-grill-output/<timestamp>/`.
- [ ] **`--confidence-floor` set.** Default `0.7` (hard). Raise for high-stakes specs.
- [ ] **`--max-rounds` set.** Default `50`.
- [ ] **Decisions UI path noted.** For >40 decisions, hand off `assets/decisions-ui.html` at gate.
- [ ] **Read-only contract acknowledged.** Auto-grill NEVER edits PRD/PLAN/spec/target. Output = `transcript.md` + `decisions.md` + `loop-state.json` + `DISCOVERIES.md` (append). All target-doc changes are manual, post-gate.
- [ ] **Gate contract acknowledged.** Auto-grill NEVER invokes `to-spec` / `to-roadmap` / `to-tickets` / `implement`. Gate is portão — orchestrator stops, surfaces `decisions.md`, waits.

**For composite targets specifically:**

- [ ] All listed docs loaded in orchestrator context (Read tool) before round 1.
- [ ] Interrogator sub-agent prompt lists all docs in `# 2. Target (composite)`.
- [ ] Proxy sub-agent prompt lists all docs in `# 1. Sources of truth`.
- [ ] Output filename slug: `<doc1>-<doc2>.auto-grill.*.md` (e.g., `PRD-PLAN.auto-grill.transcript.md`).
- [ ] Transcript + decisions tables reference both docs in `path:line` citations.

---

### 5-phase flow

1. **SETUP.** Run the [pre-flight checklist](#setup--pre-flight-checklist) above. Load target doc(s) + `CONTEXT.md` + `docs/adr/*.md` + `.scratch/` + `.specs/ARCHITECTURE.md` (if exists). Build context fingerprint: terms in glossary, decisions logged, farol nodes cited. If `CONTEXT.md` cannot be sourced, STOP (regra 9 — no ubiquitous language = autoconfirmation risk).

2. **INTERROGATION** (the loop). Interrogator emits ONE question per round (Pocock invariant). Each question carries: the lens, the question, a recommendation, the evidence requested, and why-now. Stakeholder Proxy answers with evidence (cite `CONTEXT.md` / ADR / `path:line`). If no evidence, Proxy returns `NO_EVIDENCE` and the orchestrator downgrades the decision's confidence.

3. **FOG-OF-WAR DETECTION.** After each round, the orchestrator checks: any branch unresolved? any decision still open? any "should/may/could" without commitment? If yes, generates a "research ticket" entry instead of guessing. No hallucinated answers.

4. **ARTIFACT PACK.** When all lenses exhausted OR confidence floor hit, write the four artifacts (see Outputs). Append to `.specs/DISCOVERIES.md` if any architectural gap, contradiction, or out-of-glossary term surfaced.

5. **HUMAN GATE.** Surface the decisions table. For each row: approve / reject / loop-branch. Rejected items restart the loop with branch focus. Approved items can optionally handoff to `mattpocock-skills:to-spec` / `to-tickets` — but **this skill NEVER modifies the target doc itself**.

    **Bonus UI.** For 40+ decisions, the markdown table gets unwieldy. Use `assets/decisions-ui.html` — a zero-deps browser UI (cards por linha, filtros por lens/confiança/status, exporta `decisions.respondido.md` no mesmo schema). Standalone, file://, localStorage pra F5 não perder trabalho. Não substitui o gate — só dá respiração visual pra batches grandes.

---

## Quickstart (1 round trip anatomy)

**A perspectiva do usuário (turn-points humanos):**

1. **Invoke**: `auto-grill <target>`. CLI retorna controle imediatamente.
2. **(Livre)** Orchestrator faz SETUP e roda N rounds. Você não acompanha — pode fechar o terminal.
3. **Rejoin at gate**: orchestrator emite o Artifact Pack. Você lê.

**Total de turn-points síncronos: 2** (invocação + gate). Resto é loop interno.

**Por round (orchestrator faz, user não vê):**

1. **Dispatch FRESH Interrogator** com `{target, lens, transcript[N-1], floor}` → emite `{LENS, QUESTION, RECOMMENDATION, EVIDENCE_REQUESTED, WHY_NOW}`.
2. **Dispatch FRESH Stakeholder Proxy** com `{Q acima, sources list}` → emite `{ANSWER, CONFIDENCE, EVIDENCE cite}` OU `NO_EVIDENCE + gap`.
3. Orquestrador **rotea** outcome (accept / escalate / research ticket) baseado no `confidence_floor`.
4. **Update transcript[N]**.
5. Decide próximo passo: novo round (lens diferente) OU Artifact Pack.

**Invariante crítica (regra 7):** cada round usa 2 sub-agentes **fresh**. Author(Interrogator) ≠ Author(Proxy). Os sub-agentes são **descartáveis** — só o Orchestrator mantém estado via `transcript[N-1]`. Isso quebra a armadilha "two AIs agreeing with each other" (slop / auto-confirmação).

**Edge cases que você verá no gate:**

- **CONTEXT.md ausente** → ABORT imediato no SETUP (regra 9). Sem trabalho desperdiçado.
- **Transcript > 100k tokens OU rounds >= 50** → halt DUMB_ZONE + 1-página resumo. Reabre sessão.
- **Rejeição de decisions** → reinvoca `auto-grill <target> --resume`. Estado vem de `loop-state.json`, não de sub-agentes.

**Diagramas complementares:**

- [diagrams/13-quickstart-procedural.md](./diagrams/13-quickstart-procedural.md) — sequenceDiagram end-to-end (CLI → gate).
- [diagrams/11-round-protocol.md](./diagrams/11-round-protocol.md) — state machine do loop.
- [diagrams/12-orchestrator-handoff.md](./diagrams/12-orchestrator-handoff.md) — decision tree do orquestrador por round.
- [diagrams/14-fresh-subagent-invariant.md](./diagrams/14-fresh-subagent-invariant.md) — visualização da regra 7.

---

## Round Protocol (resumo)

Loop canônico. Três propriedades:

1. **One question per Interrogator round.** Nunca bundle. (regra 1)
2. **Every question carries a recommendation.** (regra 2)
3. **Proxy answers with evidence only.** Sem evidence → `NO_EVIDENCE` → confiança automática = `low` → escalate. (regra 3)

Caminhos de saída do estado `Check_Confidence`:

| Outcome | Próximo estado | Por quê |
|---|---|---|
| `conf >= floor` AND lens not exhausted | Novo round (lens diferente) | Continua interrogando |
| `conf >= floor` AND lens exhausted | Artifact Pack | Sucesso terminal |
| `conf < floor` | Escalate to human | Floor é hard |
| `NO_EVIDENCE` no Fog of War mode | Research Ticket | Melhor que chute |
| Rounds >= 50 OR tokens >= 100k | Halt DUMB_ZONE | Nunca autosoluciona |

**Decisão de design crítica:** Orquestrador é o **único** que rotea outcomes. Proxy só reporta confiança — não decide o que fazer com ela. Se o Proxy decidisse, voltamos ao problema da auto-confirmação.

Detalhe visual em [diagrams/11-round-protocol.md](./diagrams/11-round-protocol.md) e [diagrams/12-orchestrator-handoff.md](./diagrams/12-orchestrator-handoff.md).

---

## Lenses

The Interrogator cycles through these, one question per round. Each lens has its own exhaustion criterion.

| Lens | What it hunts | Exhaustion criterion |
|------|---------------|---------------------|
| **Fog of War** | Branches without answers, unsupported assumptions | No remaining "?" branches |
| **Semantic Anchors** | Terms not in `CONTEXT.md` (hallucinated vocabulary risk) | Every term in target is glossary-backed OR flagged |
| **Tracer Bullets** | Decisions that don't trace to a demoable vertical slice | Every decision has a "→ slice: <demo>" line |
| **Cache Determinism** | Decisions that break byte-stable cache identity (Memory Studio hot path) | All inputs to cache key are deterministic + sortable |
| **Latency / Hot-Path Purity** | Anything that adds `fetch()` / `await` / IO to hot path | Static guard test passes on touched files |
| **Edge Cases** | Empty inputs, boundaries, races, dedup | Each branch has an explicit "WHEN X is empty/edge, THEN Y" |
| **Contradictions** | Conflicting claims within the doc | No two sections disagree on the same fact |
| **Vague Decisions** | "should/may/could" without commitment | All modal verbs replaced with explicit choice or removed |

**Origin notes:** Fog of War, Semantic Anchors, Tracer Bullets from the NotebookLM brainstorm on 2026-07-26 (NotebookLM SSOT notebook `f235cc21-...`). Cache Determinism and Hot-Path Purity are Memory-Studio-specific (PLAN §6). Edge Cases mirrors `tlc-spec-driven` discipline. Contradictions and Vague Decisions inherit from Pocock's "fechar todos os ramos" rule.

---

## Confidence scoring

| Level | Criterion |
|-------|-----------|
| **High** | Anchored in `CONTEXT.md` / ADR + concrete tracer bullet + zero contradictions |
| **Medium** | Anchored with explicit caveat (e.g., "assumes X holds") |
| **Low** | Unresolved branch, term not in glossary, or transcript >100k tokens (Dumb Zone) |

**Hard rule.** Any decision below `confidence_floor` (default **0.7**) → **mandatory escalation to the human, no auto-resolution**. This is the rule that attacks the **Risco de Autoconfirmação** the NotebookLM brainstorm flagged: an Interrogator + Proxy pair can converge on a confidently-wrong answer if no human breaks the tie. The floor is the tripwire.

**Mapping to levels:** High ≈ 0.9–1.0; Medium ≈ 0.7–0.9; Low < 0.7 (always escalates).

---

## Sub-agent prompt templates

Each round is two fresh sub-agent dispatches. Author of Interrogator ≠ author of Proxy (discrimination discipline, mirrors `tlc-spec-driven` Verifier rule).

### Interrogator

```
=== AUTO-GRILL — INTERROGATOR (round <N>) ===

ROLE: Skeptical reviewer. Question the target doc relentlessly.

# 1. Base engine
You are the Interrogator from `mattpocock-skills:grilling`. Apply:
- ONE question per turn (NEVER bundle — Pocock invariant).
- Every question carries a RECOMMENDATION.
- Facts vs Decisions split (facts you find in files; decisions belong to the Proxy or the human at the gate).

# 2. Target (single OR composite — read ALL listed before questioning)
- Doc 1: <absolute path>                    # required
- Doc 2: <absolute path>                    # only if composite; add Doc 3, 4 if more
- Treat as ONE spec. Cross-reference decisions across all listed docs.
- Lenses to cover this round: <list or "all remaining">
- Round: <N of N>
- Confidence floor: <0.7 default>

# 3. Question shape (always)
- LENS: <which lens>
- QUESTION: <one question, ≤ 30 words>
- RECOMMENDATION: <your best guess with rationale>
- EVIDENCE_REQUESTED: <what would make you confident — CONTEXT.md? ADR? code:line?>
- WHY_NOW: <why this branch matters; what risk it carries>

# 4. Stop conditions (per-lens)
Refer to the lens table in the SKILL.md. Switch lenses when current one is exhausted.

# 5. Global halt
- Transcript > 100k tokens → return HALT_DUMB_ZONE; orchestrator hands to fresh session.

# 6. Return contract
- Per round: all 5 fields — `{LENS, QUESTION, RECOMMENDATION, EVIDENCE_REQUESTED, WHY_NOW}`. Match the question shape in §3.
- At loop end: list of all questions asked, grouped by lens.
```

### Stakeholder Proxy

```
=== AUTO-GRILL — STAKEHOLDER PROXY (round <N>) ===

ROLE: Answer the Interrogator on behalf of the human. You hold the project context.

# 1. Sources of truth (read on demand, NEVER fabricate)
- CONTEXT.md (ubiquitous language glossary — built per SETUP pre-flight if missing)
- docs/adr/*.md (architectural decisions)
- .scratch/ (working notes)
- .specs/ARCHITECTURE.md (farol stable IDs, if exists)
- <Doc 1 path>                             # required
- <Doc 2 path>                             # only if composite; add Doc 3, 4 if more
- code under src/

# 2. Answer shape (always)
- ANSWER: <the answer, ≤ 50 words>
- EVIDENCE: <path:line OR CONTEXT.md entry — verbatim quote, never paraphrase>
- CONFIDENCE: <high | medium | low>
- IF LOW: <what's missing — what research ticket or escalation would unblock?>

# 3. Hard rules
- NEVER answer without evidence. If you can't find it, return NO_EVIDENCE.
- If you must invent, set confidence = low and the orchestrator will escalate.
- Do NOT edit the target doc. You are a reader, not a writer.
- If the question is a Decision (not a Fact), still answer — but cite which ADR or CONTEXT.md term it leans on. Pure inventions are forbidden.

# 4. Return contract
- "{ANSWER} [{confidence}] (evidence: <cite>)" OR
- "NO_EVIDENCE — <what's missing, what would unblock>"
```

---

## Inputs (CLI invocation)

```bash
# From project root
# Single target
auto-grill .specs/features/system-message-builder/spec.md
auto-grill PLAN.md --lenses fog-of-war,tracer-bullets --confidence-floor 0.8
auto-grill design.md --context-dir . --output-dir .specs/auto-grill-output/

# Composite target (treated as ONE spec; questions cross-reference all listed)
auto-grill PRD.md PLAN.md
auto-grill spec.md design.md --lenses contradictions,edge-cases
auto-grill PRD.md PLAN.md architecture.md --output-dir .specs/auto-grill-output/2026-07-27/
```

**Flags:**

| Flag | Default | Purpose |
|------|---------|---------|
| `--lenses <list>` | all | Comma-separated subset of lens names |
| `--confidence-floor <0..1>` | 0.7 | Below this → escalate, never auto-resolve |
| `--context-dir <path>` | repo root | Where to find CONTEXT.md, docs/adr/, .scratch/ |
| `--output-dir <path>` | next to target | Where to write the Artifact Pack |
| `--max-rounds <N>` | 50 | Hard cap on Interrogator rounds (Dumb Zone guard) |
| `--resume` | false | Read `loop-state.json` and continue from last rejected branch |
| `--no-farol` | false | Skip the `.specs/ARCHITECTURE.md` stable-ID check |

---

## Outputs

For target `<path>` (single) or `<doc1>-<doc2>` slug (composite):

```
<path>.auto-grill.transcript.md    # full A2A log, audit-grade
<path>.auto-grill.decisions.md     # tabela pergunta × decisão × analogia × confidence × tracer
<path>.auto-grill.loop-state.json  # resume state; rejected items restart loop
.specs/DISCOVERIES.md              # appended (gaps, contradictions, terms-not-in-glossary)
```

**Composite naming example:** grilling `PRD.md` + `PLAN.md` produces:

```
PRD-PLAN.auto-grill.transcript.md
PRD-PLAN.auto-grill.decisions.md
PRD-PLAN.auto-grill.loop-state.json
```

### `decisions.md` schema (the human-facing summary)

```markdown
# Auto-Grill Decisions — <target path>

**Date:** <ISO>
**Confidence floor:** <0.7>
**Rounds run:** <N>
**Outcome:** <approved | pending-human | halted-dumb-zone>

| # | Lens | Pergunta | Decisão | Analogia (não-especialista) | Tracer Bullet | Confiança |
|---|------|----------|---------|----------------------------|---------------|-----------|
| 1 | Fog of War | <pergunta> | <resposta do Proxy> | <analogia em 1 frase> | → slice: <demo> | alta |
| 2 | Tracer Bullets | ... | ... | ... | ... | média |
| 3 | Semantic Anchors | ... | ... | ... | ... | baixa ⚠ escalate |

## Rejected items (restart loop with focus)
- <#5 — Vague Decisions: "should consider cache" → force explicit choice>

## Research tickets (AFK)
- <RT-1: confirm whether hot-path allows fetch() in error path>
```

---

## Triggers

| Phrase | Action |
|--------|--------|
| `auto-grill <path>` | Run the loop on a single doc. |
| `auto-grill <path1> <path2> ...` | Run the loop on multiple docs as composite target. |
| `interrogate <doc>` | Same as single — alias. |
| `grill this PRD` / `stress-test this spec` | Same — natural-language triggers (single). |
| `grill PRD and PLAN together` | Natural-language composite trigger. |
| `resume auto-grill` | Read `loop-state.json`, restart on rejected items. |
| `where is the auto-grill?` | Report current phase + progress + next step. |
| `stop auto-grill` | Write `loop-state.json`, halt, report summary. |
| `summary auto-grill` | Re-render the decisions table from the latest transcript (no new round). |

---

## Companion skills

- `tlc-spec-driven` — base SDD pipeline. Auto-grill runs **before** a phase starts, not during.
- `mattpocock-skills:grill-me` — synchronous variant. Use when you want to be in the loop.
- `mattpocock-skills:grill-with-docs` — the original. Use when you can babysit the questions.
- `mattpocock-skills:domain-modeling` — keeps `CONTEXT.md` and `docs/adr/` fresh between runs.
- `mattpocock-skills:to-spec` — downstream handoff after human approves. **CRITICAL: `to-spec` reads the `conversation context` (i.e., the grilling transcript / dialogue history), NOT `decisions.md`.** The `transcript.md` produced by auto-grill is the surrogate of that conversation context. Decisions.md is the human-facing summary; transcript.md carries the design tension that `to-spec` synthesizes. To handoff correctly: load `transcript.md` into the same session before invoking `/to-spec` (Read tool, or paste in chat).
- `prompts/to-roadmap.md` — **project-local** prompt template. Extracts `.specs/ROADMAP.md` from the SPEC produced by `to-spec`. Fills the gap between `to-spec` and `to-tickets`. Next natural step after the gate.
- `mattpocock-skills:to-tickets` — downstream handoff to break approved spec into vertical slices.
- `mattpocock-skills:code-review` — sibling for code; auto-grill is for docs.
- `notebooklm` — optional: seed `CONTEXT.md` from external research before running auto-grill.

---

## What this skill is NOT

- **Not a replacement for live conversation.** When you need to feel the design tension, use `grill-me` synchronously.
- **Not a code reviewer.** For code, use `code-review` or `simplify`.
- **Not an SDD planner.** For Specify → Design → Tasks, use `tlc-spec-driven`.
- **Not an auto-approval mechanism.** The human gate at the end is mandatory. Auto-grill helps you batch the boring questions; it does not eliminate your judgment.
- **Not a self-confirming loop.** The Proxy is forbidden from inventing answers; the confidence floor forces escalation. Two agents agreeing is not validation.
- **Not a network caller.** Hot-path purity holds (matches PLAN §6 for Memory Studio; matches the discipline of the originals).

---

## Critical rules

1. **One question per Interrogator round.** Never bundle.
2. **Every question carries a recommendation.** Pocock invariant.
3. **Proxy answers with evidence only.** No evidence → `NO_EVIDENCE` → low confidence → escalate.
4. **Hard floor at `confidence_floor` (default 0.7).** Below → human, no auto.
5. **Dumb Zone guard.** Transcript >100k tokens OR `--max-rounds` reached → halt + fresh-session summary.
6. **Never edit the target doc.** Read-only.
7. **Two sub-agents, fresh each round.** Author ≠ Proxy.
8. **Loop state persisted.** Rejected items must survive restart (the `loop-state.json` is the contract).
9. **CONTEXT.md is mandatory.** If missing, STOP. The loop without ubiquitous language is two AIs confirming each other.
10. **Farol stable IDs cross-checked.** If target cites a stable ID not in `.specs/ARCHITECTURE.md`, append to `.specs/DISCOVERIES.md` and mark the decision's confidence as medium.

---

## Orchestrator Discipline — Sanity Checks

Run these between rounds. They're how the orchestrator keeps itself honest (defense against autoconfirmation).

**Before dispatching Interrogator:**

- [ ] Did previous round's Proxy cite evidence? If `NO_EVIDENCE` → log gap, force research ticket.
- [ ] Is the lens exhausted (per lens stop-condition in §Lenses)? If not yet, stay on lens. If yes, switch.

**Before dispatching Proxy:**

- [ ] Is the question single (not bundled)? Pocock invariant. If multi-part → reject, re-dispatch Interrogator with "ONE question" reminder.
- [ ] Does the question carry a RECOMMENDATION? If missing → reject, re-dispatch.

**After receiving Proxy answer:**

- [ ] Confidence meets `--confidence-floor`? Yes → accept, append decision row. No → escalate (research ticket or human gate).
- [ ] Evidence is `path:line` (verbatim)? If paraphrase → downgrade confidence one level.
- [ ] Does the answer contradict earlier accepted answers? If yes → append to `.specs/DISCOVERIES.md` as contradiction; mark this decision `conf=low`.

**Per round:**

- [ ] Dispatched FRESH sub-agent (not reused)? Regra 7: `Author(Interrogator) ≠ Author(Proxy)`. Each round = new `Agent(...)` call with no shared state beyond `transcript[N-1]`.
- [ ] Updated `transcript[N].md` and `loop-state.json`?

**Per loop:**

- [ ] Token count of `transcript.md` < 100k? If approaching → halt with DUMB_ZONE summary.
- [ ] Round count < `--max-rounds`? If hit → halt with DUMB_ZONE summary.

**Per composite-target loop:**

- [ ] Interrogator question references BOTH (or all) docs? If only one → re-dispatch with composite reminder.
- [ ] Proxy evidence cites `path:line` in one of the composite docs?

---

## Why this matters (the autoconfirmation problem)

Matt Pocock explicitly warns: an agent that answers its own questions produces "slop". Auto-grill replaces the operator with a Proxy that has the same context — but a Proxy is still an LLM, and two LLMs that share training and priors will converge on confidently-wrong answers if no human breaks the tie. The defense is structural, not aspirational:

- **Proxy never invents** (rule 3).
- **Confidence floor is hard, not advisory** (rule 4).
- **Loop pauses at the gate** (the human gate at the end is non-negotiable).
- **Fog-of-War prefers research tickets over guesses** (phase 3).

If you find yourself approving auto-grill outputs without reading them, you've lost the game — the skill has become theater.

---

## Common Failure Modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Proxy invents answers (no `path:line` cite) | CONTEXT.md inadequate | Rebuild from `CLAUDE.md §Glossary` + product glossary per SETUP pre-flight |
| Both Interrogator and Proxy "agree" too easily | Farol stable IDs missing/stale OR CONTEXT.md thin | Refresh `.specs/ARCHITECTURE.md`, run `domain-modeling`, or expand temp CONTEXT.md |
| All decisions come back `low` confidence | Either CONTEXT.md missing, or target doc has unresolved branches | Surface as Research Tickets; do not auto-resolve |
| Transcript explodes past 50 rounds | Target has too many open branches | Split target into chapters; re-run per-chapter (composite target → multiple single-target runs) |
| Composite target: questions only reference one doc | Interrogator not loading both docs | Verify `# 2. Target (composite)` lists all paths; re-dispatch |
| Orchestrator edits target doc | Regra 6 violation | STOP — undo, restart loop read-only |
| Orchestrator invokes `to-spec` | Companion skills violation | STOP — gate is portão; human invokes manually |
| `--resume` doesn't continue | `loop-state.json` corrupted/moved | Don't resume — fresh run; manually seed decisions from old transcript |
| Decisions UI shows wrong schema | Markdown table malformed | Re-export from raw `decisions.md`; do not edit `.respondido.md` by hand |
| Orquestrador invoca auto-grill sem ter rodado SETUP pre-flight | Modelo fresco pulou checklist | Voltar ao SETUP, validar cada item, só então round 1 |

---

## Provenance

- **Composed on:** `mattpocock-skills/grill-with-docs` v1.1 + brainstorm in NotebookLM notebook `f235cc21-b876-483e-b8a7-20d6234fa35c` (2026-07-26).
- **Optimized for fresh-model plug-and-play on 2026-07-27:** added §SETUP pre-flight checklist (CONTEXT.md workaround for composite targets, farol skip path, read-only + gate contract), §Orchestrator Discipline sanity checks (regra 7 enforcement, contradiction detection), §Common Failure Modes (10 symptoms → causes → fixes). Composite-target support oficializado in CLI, sub-agent prompts, output naming, triggers.
- **Inspired by:** Matt Pocock (grilling, grill-me, grill-with-docs, domain-modeling). Lenses Fog of War / Semantic Anchors / Tracer Bullets surfaced in the user's 2026-07-26 NotebookLM discussion.
- **First target test:** `.specs/features/system-message-builder/spec.md` (Phase 5 of Memory Studio).
- **First composite target test:** `PRD.md` + `PLAN.md` (Memory Studio foundation, 2026-07-27).