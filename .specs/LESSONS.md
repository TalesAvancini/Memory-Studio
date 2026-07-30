# Lessons

Self-improving lessons playbook. **Rendered from `.specs/lessons.json` via `scripts/lessons.py`** — do NOT hand-edit.

## Status legend

- **candidate** — Verifier FAIL surfaced a grounded lesson. Not yet confirmed.
- **confirmed** — Validated across ≥2 phases OR human-confirmed. Loaded before Planner dispatch.
- **quarantined** — Marked false-positive. Kept for audit, never loaded.

## Schema (per lesson)

```json
{
  "id": "L-NNN",
  "status": "candidate | confirmed | quarantined",
  "category": "correctness | robustness | perf | ux | integration",
  "summary": "One-sentence actionable lesson",
  "evidence": [
    {"phase": "N", "finding": "Description of grounded failure", "ref": "path:line"}
  ],
  "added_at": "ISO-8601",
  "promoted_at": "ISO-8601 (when status → confirmed)"
}
```

## Confirmed lessons (loaded by tlc-roadmap-loop before Planner dispatch)

*(empty — first confirmed lesson will be added after first Verifier FAIL or human-curated entry)*

## Candidate lessons (audit log only, never loaded)

*(empty)*

## Quarantined (audit only, never loaded)

*(empty)*

---

## Maintenance contract

- `scripts/lessons.py add` — append candidate from grounded failure (called by Verifier)
- `scripts/lessons.py promote <id>` — candidate → confirmed (manual, after ≥2 phase validations)
- `scripts/lessons.py list --status confirmed` — what tlc-roadmap-loop loads before dispatch
- `scripts/lessons.py quarantine <id>` — false-positive, marked and skipped
