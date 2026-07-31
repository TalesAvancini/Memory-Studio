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

### L-002 — Windows EBUSY/EPERM/EACCES retry-with-backoff pattern (50ms→1000ms, 25 attempts) is required when renaming model files that concurrent test files (e.g. embedder.test.mjs) may hold open. Reusable for any Windows CI that touches ONNX/model/sentinel files.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `test/**/*.test.mjs` · harmful: 0
- features: phase-1.4
- evidence: test/catalog/build-index.test.mjs:167-187 (test/**/*.test.mjs)
- last seen: 2026-07-31T03:58:20Z

### L-003 — When deleting CLI modules (e.g. src/catalog/cli.ts) the package.json scripts block must be updated in the same task — otherwise npm run <old-cli-name> stays broken across phases. Phase 1.1 T-01 deleted cli.ts without redirect; Phase 1.4 T-14 had to redirect catalog:load to build-index.ts to repair.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `package.json + calibration residue deletion` · harmful: 0
- features: phase-1.4
- evidence: package.json:scripts.catalog:load (package.json + calibration residue deletion)
- last seen: 2026-07-31T03:58:20Z

### L-004 — D-001 cross-check needs 2-axis classification: stale section refs (§18.5 pointing to deleted §18) are FAIL; META documentation of the D-001 rule itself (e.g. 'ZERO §18.x refs') is keep. Grep hits must be classified before marking as drift.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `.specs/ROADMAP.md + PRD/PLAN/SPEC` · harmful: 0
- features: phase-1.4
- evidence: ROADMAP.md:60,150 spec.md:705 (.specs/ROADMAP.md + PRD/PLAN/SPEC)
- last seen: 2026-07-31T03:58:21Z

### L-005 — Implementer 'true observation, wrong reason' pattern: Implementer correctly observed 
> memory-studio@0.0.0 build-index
> node --experimental-strip-types --no-warnings scripts/build-index.ts exit 2 but misattributed to 'config/catalog has 0 items' (actual cause: idempotent rerun exit contract). Verifier must audit reasoning AND observation, not just trust either.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `lessons learned about sub-agent honesty` · harmful: 0
- features: phase-3
- evidence: validation.md:Implementer-audit (lessons learned about sub-agent honesty)
- last seen: 2026-07-31T15:12:58Z

### L-006 — Dispatch (orchestrator's prompt) assertions about expected exit code/output can themselves be wrong — orchestrator must read actual implementation contract (e.g.  in scripts/build-index.ts) before claiming 'expected: X' to sub-agents. Verifier re-verifies, but introducing false expectations wastes tokens.
- signal: `spec_deviation` · recurrence: 1 feature(s) · scope: `loop-orchestrator discipline` · harmful: 0
- features: phase-3
- evidence: loop-orchestrator-dispatch (loop-orchestrator discipline)
- last seen: 2026-07-31T15:12:58Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
