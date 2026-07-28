---
name: auto-grill-v2
description: Variant of auto-grill with verifier-honest-uncertainty pattern. When Stakeholder Proxy returns low/medium confidence, optionally dispatch an Insight Researcher sub-agent to gather external context (informational, NOT obligation to resolve). Both original finding + research note visible at gate. Opt-in via `--auto-research-insight` flag. Use when v0.2 produces too many `low` confidence decisions or research tickets, and you want research insights pre-loaded at gate instead of after-the-fact. NOT a replacement for v0.2 — opt-in enhancement. Original auto-grill unchanged at .claude/skills/auto-grill/SKILL.md.
license: CC-BY-4.0
metadata:
  author: Memory-Studio
  composed_on: mattpocock-skills/grill-with-docs v1.1
  inspired_by: Matt Pocock (grilling, grill-me, grill-with-docs, domain-modeling)
  variant: v2 (verifier-honest-uncertainty)
  base_skill: .claude/skills/auto-grill/SKILL.md (v0.2 — UNCHANGED)
  parent_version: auto-grill v0.2 (2026-07-27)
---

# Auto-Grill v2 — Verifier-Honest-Uncertainty variant

**What this skill is.** A drop-in variant of `auto-grill` v0.2 with one behavioral change: when the Stakeholder Proxy returns `low` or `medium` confidence, an **Insight Researcher** sub-agent can be dispatched to gather external context (docs, primary sources, ADRs) and the result is **appended to the finding** — **without** trying to boost the original confidence and **without** obligation to fix the gap.

**Why it exists.** v0.2 follows R4 strictly: `conf < floor` → escalate to human at gate. This is honest but **blind** — the human at the gate has no extra information to decide on. They see "conf=low" with no context for *why*. v2 fills that gap **honestly** (research notes can also be uncertain), structurally (researcher is a 3rd role, not a back-channel for the Proxy), and informatively (human sees what was looked at, even if it didn't resolve).

**Key epistemic shift:** research is **insight**, not fix. The verifier admits uncertainty structurally rather than pretending to be certain or trying to become certain via auto-resolution.

**The original is unchanged.** This skill is a parallel variant; the original `auto-grill` v0.2 stays intact at `.claude/skills/auto-grill/SKILL.md`. v2 only adds an opt-in flag and a 3rd sub-agent role.

---

## When to use v2 vs v0.2

| Scenario | Use |
|---|---|
| Spec is well-grounded; few low-confidence decisions expected | **v0.2** (default) |
| v0.2 run produced many `low` confidence rows; you want context to make gate decisions | **v2** (`--auto-research-insight`) |
| You want research notes captured alongside decisions (not as separate tickets) | **v2** |
| Target has obvious gaps; you want human gate with pre-loaded external info | **v2** |
| You want strict escalation with no automatic research | **v0.2** (don't use flag) |
| Hot path / latency-sensitive context (research adds latency per round) | **v0.2** |

**Cost note:** v2 adds 1 sub-agent dispatch per low/medium-confidence round. Adds ~30–90s per round and ~2–5k tokens. Human gate is **richer** (research notes visible) but each finding takes longer to produce.

---

## What changed from v0.2 (delta summary)

1. **New opt-in flag:** `--auto-research-insight` (off by default).
2. **New 3rd sub-agent role:** Insight Researcher (informational, NOT stakeholder, NOT obligationary).
3. **New R11:** "Verifier admits uncertainty structurally — research is insight, not obligation."
4. **New output:** `<target>.auto-grill.research.md` (research notes appended to low/medium-confidence findings).
5. **Updated `decisions.md` schema:** adds `Research Note` column.
6. **Updated Round Protocol:** when `conf < floor`, orchestrator can dispatch Insight Researcher (instead of pure escalation).
7. **Updated Orchestrator Discipline:** new sanity check before/after research dispatch.

**Everything else is identical to v0.2.** SETUP pre-flight, lenses, confidence scoring, sub-agent discrimination (regra 7), Dumb Zone guard, gate contract — all unchanged.

---

## SETUP — Pre-flight Checklist

**Run BEFORE round 1.** Any failure → STOP and fix; the loop without these is theater (regra 9).

**Inherit from v0.2 unchanged:**

- [ ] **CONTEXT.md exists OR build temp.** If absent, build from `CLAUDE.md §Glossary` + any product-specific glossary section in target docs.
- [ ] **`.specs/ARCHITECTURE.md` exists?** If yes, load stable IDs into fingerprint. If no, skip farol (regra 10).
- [ ] **Target identified** (single OR composite).
- [ ] **Output dir ready.** Default: next to target. For composite / long runs: `.specs/auto-grill-output/<timestamp>/`.
- [ ] **`--confidence-floor` set.** Default `0.7` (hard).
- [ ] **`--max-rounds` set.** Default `50`.
- [ ] **Decisions UI path noted.** For >40 decisions, hand off `assets/decisions-ui.html` at gate.
- [ ] **Read-only contract acknowledged.** Auto-grill NEVER edits PRD/PLAN/spec/target.
- [ ] **Gate contract acknowledged.** Auto-grill NEVER invokes `to-spec` / `to-roadmap` / `to-tickets` / `implement`.

**v2 additions:**

- [ ] **`--auto-research-insight` decided.** Off by default (matches v0.2 behavior). Turn ON if you want the Honest-Uncertainty path (see §Round Protocol below).
- [ ] **Research budget set (if flag ON).** Default: max 1 research dispatch per finding (no recursion). Set via `--max-research-per-finding <N>` (default 1).

**ESTE CHECKLIST É INTERNO. NÃO pergunte cada item ao humano.** Run silently; abort only on hard failures (CONTEXT.md missing, target unreadable).

---

## Round Protocol — Honest Uncertainty path (NEW in v2)

Loop canônico herdado de v0.2 + novo caminho quando `conf < floor`:

| Outcome | v0.2 behavior | v2 behavior (`--auto-research-insight` ON) | Por quê |
|---|---|---|---|
| `conf >= floor` AND lens not exhausted | Novo round | Novo round | (unchanged) |
| `conf >= floor` AND lens exhausted | Artifact Pack | Artifact Pack | (unchanged) |
| `conf < floor` | Escalate to human | **Dispatch Insight Researcher (1-shot) → append research note → escalate to human WITH research note** | Honest uncertainty: verifier admits the gap; research brings context; human sees both |
| `NO_EVIDENCE` | Research Ticket (AFK) | **Dispatch Insight Researcher inline → append note → research note replaces ticket** | Pre-loaded research > AFK ticket; same uncertainty semantics |
| Rounds >= 50 OR tokens >= 100k | Halt DUMB_ZONE | Halt DUMB_ZONE | (unchanged) |

**Critical distinction (R11 — new):**

- Insight Researcher output **does NOT** modify the original confidence score. If Proxy said `low`, the decision row stays `low` regardless of what research found.
- Insight Researcher is **NOT** bound to resolve. Research can also return `NO_EVIDENCE` or `medium-confidence insight`.
- Insight Researcher output **IS** appended to the decision row in `decisions.md` and written to `<target>.auto-grill.research.md`.
- Human at gate sees: `{original finding (conf X), research note, insight confidence}` — all visible, no inflation.

**1-shot constraint (anti-recursion):**

- Research dispatch is bounded: max `--max-research-per-finding` (default 1). If research also returns uncertain, **no second research dispatch** — orchestrator records the uncertainty and escalates.
- This prevents the "research loop trying to become certain" failure mode.
- Exception: if `--max-research-per-finding=2` is set and first research returned `NO_EVIDENCE`, orchestrator MAY dispatch a second with broader scope (e.g., external docs vs project-only). Documented as `--research-recursion=allowed` flag (use cautiously).

---

## Sub-agent prompt templates

**Inherit from v0.2 unchanged:** Interrogator + Stakeholder Proxy.

**v2 addition (3rd role):**

### Insight Researcher (NEW in v2)

```
=== AUTO-GRILL v2 — INSIGHT RESEARCHER (round <N>) ===

ROLE: Bring external context to a finding where Stakeholder Proxy returned
low/medium confidence. You are NOT a stakeholder. You do NOT represent the
project. You gather insights from primary sources and report what you found.

# 1. What you're researching
- Original finding (from Proxy): <answer + confidence + evidence>
- Gap: <what's missing — verbatim from Proxy's IF LOW field>
- Target context: <Doc 1 path> [<Doc 2 path> if composite]

# 2. Sources you may consult (in order of preference)
1. <Doc 1 path> and <Doc 2 path> — the target doc(s) themselves (re-read with focus)
2. CONTEXT.md (ubiquitous language glossary)
3. docs/adr/*.md (architectural decisions in the project)
4. .scratch/ (working notes)
5. External primary sources (READ-ONLY via WebFetch / WebSearch):
   - Official documentation of libraries / APIs cited in target
   - Authoritative references (NOT blog posts, NOT speculation)
   - NO speculative answers; if no source backs a claim, return NO_EVIDENCE

# 3. Return shape (always)
- INSIGHT: <what you found, ≤ 100 words; cite sources path:line or URL>
- SOURCE_QUALITY: <primary | secondary | none>
- INSIGHT_CONFIDENCE: <high | medium | low>
- IF LOW: <what you searched; what you couldn't find; what would unblock>
- DO_NOT: <what would be making things up here>

# 4. Hard rules
- You are informational, NOT a fixer. If you can't find primary sources,
  return NO_EVIDENCE. Do NOT infer. Do NOT speculate.
- You do NOT modify the original Proxy confidence. You append; you don't replace.
- You do NOT answer the original question yourself. You bring context.
- Cite verbatim (path:line or URL). Paraphrase = downgrade confidence.

# 5. Return contract
- "{INSIGHT} [{SOURCE_QUALITY}/{INSIGHT_CONFIDENCE}] (evidence: <cite>)" OR
- "NO_EVIDENCE — <what was searched; what was missing; what would unblock>"
```

---

## Confidence scoring (inherited from v0.2 + R11)

| Level | Criterion |
|-------|-----------|
| **High** | Anchored in `CONTEXT.md` / ADR + concrete tracer bullet + zero contradictions |
| **Medium** | Anchored with explicit caveat (e.g., "assumes X holds") |
| **Low** | Unresolved branch, term not in glossary, or transcript >100k tokens (Dumb Zone) |

**Hard rule (R4, unchanged).** Any decision below `confidence_floor` (default **0.7**) → escalation, no auto-resolution.

**v2 addition (R11, new):** Research insight is reported with its own confidence (`INSIGHT_CONFIDENCE`) which is **independent** of the original decision's confidence. Both visible at gate.

---

## Critical rules

**Inherited from v0.2 (rules 1-10):**

1. One question per Interrogator round.
2. Every question carries a recommendation.
3. Proxy answers with evidence only.
4. Hard floor at `confidence_floor` (default 0.7).
5. Dumb Zone guard (100k tokens / `--max-rounds`).
6. Never edit the target doc.
7. Two sub-agents, fresh each round (Author ≠ Proxy).
8. Loop state persisted.
9. CONTEXT.md is mandatory.
10. Farol stable IDs cross-checked.

**v2 addition:**

11. **Verifier admits uncertainty structurally — research is insight, not obligation.** When Stakeholder Proxy returns `low`/`medium`, the orchestrator MAY dispatch an Insight Researcher (opt-in flag) to gather external context. The research output is informational, NOT a fix, NOT an obligation, and does NOT modify the original confidence. Human at gate sees `{finding, research note, both confidences}` — visible, not inflated, not hidden.

**Why R11 is structural, not aspirational:**

- Without R11: LLMs (including the Proxy) will infer. They'll return `medium` and quietly "feel" confident. Research can become a back-channel for autoconfirmation.
- With R11: the gap is named, the research is bounded (1-shot by default), the confidence stays honest, and the human gate has context.

---

## Inputs (CLI invocation)

```bash
# From project root

# === v2 with honest-uncertainty path ===
auto-grill PLAN.md --auto-research-insight
auto-grill PRD.md PLAN.md --auto-research-insight --max-research-per-finding 1
auto-grill .specs/spec.md --auto-research-insight --output-dir .specs/auto-grill-output/

# === v2 default = v0.2 behavior (flag off) ===
auto-grill PLAN.md                          # no research; identical to v0.2
auto-grill PRD.md PLAN.md                   # composite without research
```

**Flags (v2 additions in bold):**

| Flag | Default | Purpose |
|------|---------|---------|
| `--lenses <list>` | all | Comma-separated subset of lens names |
| `--confidence-floor <0..1>` | 0.7 | Below this → escalate, never auto-resolve |
| `--context-dir <path>` | repo root | Where to find CONTEXT.md, docs/adr/, .scratch/ |
| `--output-dir <path>` | next to target | Where to write the Artifact Pack |
| `--max-rounds <N>` | 50 | Hard cap on Interrogator rounds (Dumb Zone guard) |
| `--resume` | false | Read `loop-state.json` and continue from last rejected branch |
| `--no-farol` | false | Skip the `.specs/ARCHITECTURE.md` stable-ID check |
| **`--auto-research-insight`** | **false** | **Opt-in: dispatch Insight Researcher when Proxy returns low/medium confidence** |
| **`--max-research-per-finding <N>`** | **1** | **Anti-recursion cap on research dispatches per finding (R11)** |
| **`--research-recursion=allowed`** | **false** | **Permit 2nd research dispatch if 1st returned NO_EVIDENCE (use cautiously)** |

---

## Outputs

**Inherited from v0.2 unchanged:**

```
<path>.auto-grill.transcript.md
<path>.auto-grill.decisions.md
<path>.auto-grill.loop-state.json
.specs/DISCOVERIES.md                       # appended
```

**v2 addition (when `--auto-research-insight` is used):**

```
<path>.auto-grill.research.md               # NEW: research notes appended to low/medium-confidence findings
```

**Composite naming applies** to the new file too: `PRD-PLAN.auto-grill.research.md`.

### `decisions.md` schema (updated for v2)

```markdown
| # | Lens | Pergunta | Decisão | Analogia | Tracer | Conf | Research Note | Insight Conf |
|---|------|----------|---------|----------|--------|------|---------------|--------------|
| 1 | Fog of War | <pergunta> | <resposta Proxy> | <analogia> | → slice: <demo> | alta | — | — |
| 2 | Tracer Bullets | ... | ... | ... | ... | média | "Insight: X (cite Y)" | média |
| 3 | Semantic Anchors | ... | ... | ... | ... | baixa | "Insight: could not find Z" | low |

## Research Notes (full text)
### Finding #2 — Tracer Bullets
**Original finding (conf: média):** <...>
**Insight Researcher note (conf: média):** <...>
**Sources cited:** <path:line or URL>

### Finding #3 — Semantic Anchors
**Original finding (conf: baixa):** <...>
**Insight Researcher note (conf: low):** NO_EVIDENCE — <what was searched>
```

The `Research Note` column is **only populated when research was dispatched** (i.e., for low/medium-confidence findings under the v2 flag). High-confidence findings show `—` because research was not needed.

---

## Orchestrator Discipline — Sanity Checks

**Inherit from v0.2 unchanged:**

- [ ] Before dispatching Interrogator: lens not exhausted; previous Proxy cited evidence or flagged NO_EVIDENCE.
- [ ] Before dispatching Proxy: question single; carries RECOMMENDATION.
- [ ] After receiving Proxy answer: confidence meets floor; evidence is path:line; no contradiction with earlier answers.
- [ ] Per round: FRESH sub-agents (regra 7); transcript updated; loop-state updated.
- [ ] Per loop: token count < 100k; round count < `--max-rounds`.

**v2 additions:**

- [ ] **Before dispatching Insight Researcher:** `--auto-research-insight` flag ON AND Proxy returned `low`/`medium` AND research count for this finding < `--max-research-per-finding`. If any condition fails → skip research, escalate directly to gate.
- [ ] **After receiving Insight Researcher output:** record insight verbatim (path:line / URL); do NOT modify the original Proxy confidence; do NOT attempt second research unless `--research-recursion=allowed` AND first research returned `NO_EVIDENCE`.

---

## Companion skills

**Inherited from v0.2:**

- `tlc-spec-driven` — base SDD pipeline. Auto-grill runs **before** a phase starts.
- `mattpocock-skills:grill-me` — synchronous variant.
- `mattpocock-skills:grill-with-docs` — the original HITL.
- `mattpocock-skills:domain-modeling` — keeps `CONTEXT.md` fresh.
- `mattpocock-skills:to-spec` — downstream handoff after human approves.
- `prompts/to-roadmap.md` — project-local, extracts `.specs/ROADMAP.md` from SPEC.
- `mattpocock-skills:to-tickets` — downstream handoff.
- `mattpocock-skills:code-review` — sibling for code.
- `notebooklm` — seed `CONTEXT.md` from external research.

**v2 companion:**

- `mattpocock-skills:research` — the **Insight Researcher** role in v2 follows the protocol of this skill. v2's Insight Researcher sub-agent is a lightweight, focused variant: same epistemic discipline (primary sources only, NO_EVIDENCE when missing), narrower scope (one finding at a time), informational output only.

---

## Common Failure Modes

**Inherit from v0.2 unchanged:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Proxy invents answers (no `path:line` cite) | CONTEXT.md inadequate | Rebuild per SETUP pre-flight |
| Interrogator + Proxy agree too easily | Farol stable IDs missing/stale | Refresh ARCHITECTURE.md, run domain-modeling |
| All decisions come back `low` confidence | CONTEXT.md missing or target has unresolved branches | v0.2: surface as Research Tickets. v2: enable `--auto-research-insight` |
| Transcript explodes past 50 rounds | Target has too many open branches | Split target; multiple single-target runs |
| Composite target: questions only reference one doc | Interrogator not loading both docs | Verify `# 2. Target (composite)`; re-dispatch |
| Orchestrator edits target doc | Regra 6 violation | STOP — undo, restart read-only |
| Orchestrator invokes `to-spec` | Companion skills violation | STOP — gate is portão |
| `--resume` doesn't continue | `loop-state.json` corrupted | Fresh run; seed decisions manually |

**v2 additions:**

| Symptom | Likely cause | Fix |
|---|---|---|
| Research adds latency, no new decisions | `--auto-research-insight` flag ON but target was high-confidence | Set flag OFF for high-confidence runs |
| Insight Researcher returns speculative answers | R11 violation — researcher inferred instead of returning NO_EVIDENCE | Verify prompt §4 hard rules; re-dispatch with reminder |
| Insight Researcher loops (2nd, 3rd dispatch per finding) | `--research-recursion=allowed` misconfigured OR R11 cap bypassed | Default `--max-research-per-finding=1`; remove recursion flag |
| Human gate is overwhelming (finding + research note = too much text) | Research notes too verbose | Tighter prompt §3 (≤100 words INSIGHT); or run v0.2 instead |
| Research note contradicts original finding | Researcher found conflicting primary source | Both visible at gate — human decides; this is **expected behavior**, not a bug |

---

## Why R11 (verifier-honest-uncertainty) matters

LLMs always infer. They rarely admit they don't know. A verifier that pretends to be certain — or that auto-resolves its own uncertainty via research loops — becomes theater. The human at the gate sees a confident table and approves without realizing the gap was never filled.

R11 is the structural counter:

1. **Admit.** Verifier returns `low`/`medium` and stays there. No auto-boost.
2. **Document.** If research is dispatched, its output is recorded verbatim (path:line / URL), not paraphrased.
3. **Bound.** Max 1 research per finding (default). No recursion unless explicitly opted-in.
4. **Visible.** Human sees `{finding, research note, both confidences}` at gate. No hidden work.

This is closer to Wayfinder's `fog of war`: the unknown is **mapped**, not hidden.

---

## Provenance

- **Base skill:** `auto-grill` v0.2 (2026-07-27) at `.claude/skills/auto-grill/SKILL.md` — **UNCHANGED.**
- **Variant conceived:** 2026-07-28 (conversa Memory-Studio-Discuss sobre Wayfinder + honest uncertainty).
- **Designed by:** humano (proposal) + Claude (consolidation into SKILL.md format).
- **Origin memory:** `feedback-verifier-honest-uncertainty`.
- **Status:** experimental; not yet production-validated. See `BACKLOG.md` for promotion criteria.