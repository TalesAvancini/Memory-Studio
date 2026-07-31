# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — vec0 virtual tables (sqlite-vec) reject FTS5-style ('delete', ...) trigger command syntax; use plain 'DELETE FROM vec_table WHERE rowid = old.rowid' instead. Triggers on catalog_fts (FTS5) keep ('delete', ...) syntax because they target FTS5 not vec0.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `src/catalog/migrations/*.sql` · harmful: 0
- features: phase-1.2
- evidence: src/catalog/migrations/001_init.sql:embeddings_au (src/catalog/migrations/*.sql)
- last seen: 2026-07-31T02:33:03Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
