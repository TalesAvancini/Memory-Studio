# auto-grill v2 — Verifier-Honest-Uncertainty variant

Variant of [auto-grill v0.2](../auto-grill/README.md) with one behavioral change: when Stakeholder Proxy returns low/medium confidence, an **Insight Researcher** sub-agent can be dispatched to gather external context. Both original finding + research note are visible at gate. **Opt-in** via `--auto-research-insight` flag.

The original auto-grill v0.2 is **unchanged** at `.claude/skills/auto-grill/`. v2 is a parallel variant, not a replacement.

---

## TL;DR

```bash
# Default = v0.2 behavior (no research, no overhead)
auto-grill PLAN.md

# v2 with honest-uncertainty path
auto-grill PLAN.md --auto-research-insight

# v2 with custom research cap
auto-grill PRD.md PLAN.md --auto-research-insight --max-research-per-finding 2

# v2 with recursion allowed (use cautiously)
auto-grill spec.md --auto-research-insight --research-recursion=allowed
```

**When to use v2:** v0.2 run produced too many `low` confidence decisions or research tickets, and you want research insights pre-loaded at gate.

**When NOT to use v2:** target is well-grounded; you want strict escalation without automatic research; latency-sensitive context.

---

## What changed from v0.2 (the delta)

| Aspect | v0.2 | v2 |
|---|---|---|
| Sub-agent roles | Interrogator + Stakeholder Proxy | + **Insight Researcher** (3rd role) |
| Behavior at `conf < floor` | Escalate to human (blind) | Dispatch Insight Researcher (1-shot) → escalate WITH research note |
| Critical rules | R1-R10 | + **R11** (verifier-honest-uncertainty) |
| Outputs | transcript + decisions + loop-state + DISCOVERIES | + **`*.auto-grill.research.md`** |
| Decisions schema | 7 columns | + **Research Note** + **Insight Conf** columns |
| Flag | `--no-farol` | + `--auto-research-insight` (default OFF) |
| Recursion | N/A | + `--max-research-per-finding` (default 1) + `--research-recursion=allowed` (default OFF) |

**Cost:** v2 adds ~30–90s and ~2–5k tokens per low/medium-confidence round (1 research dispatch).

---

## When to choose which

| Scenario | Recommendation |
|---|---|
| Spec well-grounded; few low-confidence decisions expected | **v0.2** (default) |
| v0.2 produced many `low` confidence rows; want context for gate decisions | **v2** (`--auto-research-insight`) |
| Want research notes captured alongside decisions (not separate tickets) | **v2** |
| Target has obvious gaps; want human gate with pre-loaded external info | **v2** |
| Want strict escalation, no automatic research | **v0.2** (don't use flag) |
| Latency-sensitive context (research adds latency per round) | **v0.2** |

---

## How it works (1 round anatomy, v2 with flag ON)

1. **Dispatch FRESH Interrogator** with `{target, lens, transcript[N-1], floor}` → emits `{LENS, QUESTION, RECOMMENDATION, EVIDENCE_REQUESTED, WHY_NOW}`.
2. **Dispatch FRESH Stakeholder Proxy** with `{Q above, sources list}` → emits `{ANSWER, CONFIDENCE, EVIDENCE cite}` OR `NO_EVIDENCE + gap`.
3. **Orchestrator routes** based on confidence floor:
   - `conf >= floor` → accept, append decision row.
   - `conf < floor` AND flag ON AND research count < cap → **dispatch FRESH Insight Researcher** with `{finding, gap, target context, sources allowed}`.
   - `conf < floor` AND flag OFF OR cap reached → escalate directly.
4. **Insight Researcher returns** `{INSIGHT, SOURCE_QUALITY, INSIGHT_CONFIDENCE, IF LOW}` OR `NO_EVIDENCE`.
5. **Orchestrator records** both: original finding (in decisions.md) + research note (in decisions.md Research Note column AND in `*.auto-grill.research.md`).
6. **Original confidence is NOT modified.** Research insight is informational; its own confidence is reported alongside.
7. **Update transcript[N]**.
8. **Decide next step:** new round (different lens) OR Artifact Pack.

**Invariante (R11):** verifier admits uncertainty structurally. Research is insight, NOT fix. No auto-resolution, no recursion, no confidence inflation.

---

## Example decisions.md output (v2)

```markdown
| # | Lens | Pergunta | Decisão | Tracer | Conf | Research Note | Insight Conf |
|---|------|----------|---------|--------|------|---------------|--------------|
| 1 | Fog of War | Drift §18→§16 stale? | sim, 3 ocorrências | L241/L254/L375 | alta | — | — |
| 2 | Cache Determinism | RRF tiebreak definido? | spec missing | add sort + SHA256 | baixa | "WebSearch no canonical RRF tiebreak; 3 secondary; spec gap real" | baixa |

## Research Notes (full text)

### Finding #2 — Cache Determinism
**Original finding (conf: baixa):** spec missing RRF tiebreak
**Insight Researcher note (conf: baixa):** NO_EVIDENCE for canonical RRF tiebreak.
WebSearch 'RRF tiebreak': 3 secondary sources (blog posts), no official doc / RFC / paper.
**Sources cited:** (none primary)
```

---

## Files in this directory

```
.claude/skills/auto-grill-v2/
├── SKILL.md                      # canonical contract (delta from v0.2)
├── README.md                     # this file
├── diagrams/
│   └── 15-honest-uncertainty.md  # NEW: state machine + decision tree + gate output
└── prompts/
    └── insight-researcher.md     # NEW: sub-agent prompt template
```

**No diagram 01-14 here** — v2 inherits the visual language of v0.2. Only the delta (R11 + Honest Uncertainty path) is its own artifact (diagram 15).

**No `assets/decisions-ui.html` here** — v0.2's UI is unchanged. v2's research notes append to the same markdown schema; the v0.2 UI handles them transparently as extra columns.

---

## What's NOT in v2 (and why)

- **No changes to lenses.** Inherited from v0.2 (Fog of War, Semantic Anchors, Tracer Bullets, Cache Determinism, Latency/Hot-Path Purity, Edge Cases, Contradictions, Vague Decisions).
- **No changes to confidence scoring.** High/Medium/Low with the same criteria. R4 floor unchanged.
- **No changes to gate contract.** Human gate is mandatory. Auto-grill NEVER invokes `to-spec` / `to-roadmap` / `to-tickets` / `implement`.
- **No changes to read-only contract.** Target doc is NEVER edited by the skill.
- **No changes to Dumb Zone guard.** 100k tokens / `--max-rounds` cap unchanged.
- **No changes to fresh-sub-agent rule.** Regra 7 still enforced (Author ≠ Proxy ≠ Researcher).

v2 is a **single behavioral addition**, not a redesign.

---

## Promotion criteria (v0.2 → v2 default)

If v2 is validated in production and the v0.2 default behavior becomes obsolete, v2 can be **promoted to default** by:

1. Moving v0.2 SKILL.md to `.claude/skills/auto-grill/archive/v0.2/`.
2. Replacing `.claude/skills/auto-grill/SKILL.md` with v2 SKILL.md + R11 as default (no flag needed).
3. Updating `description` in frontmatter to reflect default behavior.
4. Updating CLAUDE.md and cross-references.

**Not done yet.** v2 is experimental; needs production validation.

---

## Provenance

- **Base skill:** `auto-grill` v0.2 (2026-07-27) at `.claude/skills/auto-grill/SKILL.md` — **UNCHANGED.**
- **Variant conceived:** 2026-07-28 (conversa Memory-Studio-Discuss sobre Wayfinder + honest uncertainty).
- **Origin memory:** `feedback-verifier-honest-uncertainty`.
- **Status:** experimental; not yet production-validated.
- **Inspiration:** Wayfinder's `Research` ticket type + Pocock's `research` skill (epistemic discipline of primary sources only).