-- Phase 5b — 003_audit_events_ts_index.sql
--
-- Adds a B-tree index on audit_events.ts to make the 10.4.3 perf
-- gate (audit query <100ms / 30 days) achievable at scale. The index
-- is small (~24 bytes per row on a single INTEGER column) and
-- negligible compared to the audit_events payload.
--
-- This migration is forward-only (no DOWN script) per Phase 1.2
-- policy: the catalog has no rollback mechanism. The index is
-- additive; existing queries are unaffected.

CREATE INDEX IF NOT EXISTS idx_audit_events_ts ON audit_events(ts);