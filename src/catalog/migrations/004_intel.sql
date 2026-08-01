-- Phase 6b — 004_intel.sql
--
-- Adds the Intel store table for the inception híbrida flow (Phase 6b).
-- The Intel literal is extracted from the previous provider response by the
-- fast-agent module (src/server/fast-agent/client.ts) and consumed at the
-- start of the next turn by runAugment (Stage 1b in pipeline.ts) so that
-- Block 2 of the system message can prepend a `## Intel` section. Cache
-- hit invariant (R-15) depends on this row being readable in < 5ms p95.
--
-- Schema shape mirrors SPEC §IMod-5 literal:
--   { agentState: string, nextNeeds: string[], recentTopic: string }
-- serialized into 3 columns. `next_needs` is JSON-encoded (Phase 6a T-10
-- confirmed JSON.stringify → JSON.parse round-trip preserves shape).
--
-- Defaults match D-005 graceful degradation (empty strings/arrays parse OK).
-- `WITHOUT ROWID` because the row IS the primary key (session_id is a
-- 16-char hex hash from the SDK per Phase 3 contract) — saves the implicit
-- rowid + 4 bytes of pointer overhead per lookup.
--
-- WAL pragma is idempotent in SQLite (the pragma returns the current mode
-- on re-apply). Phase 5b.1's 002 + 003 migrations may have already set
-- WAL for audit_events — re-apply is safe and re-confirms WAL semantics
-- for the new table.
--
-- Forward-only (no DOWN) per Phase 1.2 policy: the catalog has no
-- rollback mechanism. The new table is additive; existing queries are
-- unaffected.

CREATE TABLE IF NOT EXISTS intel (
  session_id   TEXT PRIMARY KEY,
  agent_state  TEXT NOT NULL DEFAULT '',
  next_needs   TEXT NOT NULL DEFAULT '[]',
  recent_topic TEXT NOT NULL DEFAULT '',
  ts           INTEGER NOT NULL
) WITHOUT ROWID;

-- Covering index on the PK column. Hot-path read runs
--   SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?
-- which is index-only with this index (all columns are inside the table
-- itself, but the index lets SQLite skip the btree root-to-leaf walk for
-- the PK lookup). Phase 6a POC measured 0.02ms p95 (250× headroom under
-- the 5ms budget per AC-9).

CREATE INDEX IF NOT EXISTS idx_intel_session_id ON intel(session_id);

-- Promote to WAL mode (idempotent — SQLite returns 'wal' on re-apply).

PRAGMA journal_mode = WAL;
