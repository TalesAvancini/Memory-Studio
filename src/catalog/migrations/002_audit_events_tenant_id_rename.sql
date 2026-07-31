-- Phase 2 — 002_audit_events_tenant_id_rename.sql
--
-- Renames `audit_events.tenant_hash` → `audit_events."tenantId_hashed"`
-- to align the column name with PRD §10.3 item 2 (tenantId hashed
-- invariant) and ROADMAP Phase 2 done #5 column list. No data is
-- transformed; ALTER TABLE ... RENAME COLUMN preserves existing values
-- under the new name (verified by AC-11 + the data-preservation test in
-- `test/catalog/migrations-phase-2.test.mjs`).
--
-- The new column name is quoted (`"tenantId_hashed"`) because it is
-- camelCase + underscore — SQLite treats unquoted identifiers as
-- case-insensitive fold-to-uppercase, so the mixed-case name would
-- otherwise be normalized away. With quotes the case is preserved.
--
-- This migration is forward-only (no DOWN script) per Phase 1.2 policy:
-- the catalog has no rollback mechanism. The rename is low-risk
-- (column name only — no data transformation, no schema-shape change).

ALTER TABLE audit_events RENAME COLUMN tenant_hash TO "tenantId_hashed";
