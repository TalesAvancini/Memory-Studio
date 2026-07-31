-- Phase 1.2 — 001_init.sql
--
-- Single initial migration for Memory Studio's catalog SQLite database.
-- Defines the storage substrate (catalog + embeddings + audit_events),
-- the version-tracking table (schema_migrations), and the two virtual
-- tables that Phase 5 (search) will query: catalog_fts (FTS5) over
-- catalog.text, and catalog_vec (sqlite-vec) over embeddings.vector.
--
-- Triggers keep the virtual tables in sync with their source tables:
--   catalog_ai / catalog_au / catalog_ad → catalog_fts
--   embeddings_ai / embeddings_ad         → catalog_vec
-- All triggers are AFTER (not BEFORE) so we never recurse into the
-- source table while writing to it.
--
-- audit_events includes the 5 Phase-5-ready columns from PRD §10.3
-- (fingerprint, matched_ids, pruning_reasons, latency_ms,
-- redacted_prompt_hash) in addition to the calibration baseline
-- (id, ts, tenant_hash, event_type, payload). Writers land in
-- Phase 5; the columns are nullable until then.
--
-- catalog_vec uses FLOAT[384] with an explicit rowid binding to
-- catalog.id via the embeddings.catalog_id FK. sqlite-vec 0.1.9
-- requires this workaround — see src/catalog/db/open.ts JSDoc.

-- ---------------------------------------------------------------------------
-- Base tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS catalog (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('skill', 'rule', 'persona')),
  title       TEXT,
  text        TEXT NOT NULL,
  category    TEXT,
  critical    INTEGER,
  is_default  INTEGER,
  content_hash TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS embeddings (
  catalog_id    TEXT PRIMARY KEY REFERENCES catalog(id) ON DELETE CASCADE,
  vector        BLOB NOT NULL,
  model_version TEXT NOT NULL,
  embedded_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                   INTEGER NOT NULL,
  tenant_hash          TEXT NOT NULL,
  event_type           TEXT NOT NULL,
  payload              TEXT NOT NULL,
  fingerprint          TEXT,
  matched_ids          TEXT,
  pruning_reasons      TEXT,
  latency_ms           INTEGER,
  redacted_prompt_hash TEXT
);

-- ---------------------------------------------------------------------------
-- FTS5 virtual table — mirrors catalog.text
-- ---------------------------------------------------------------------------
-- unicode61 tokenizer with diacritics removal so Portuguese/Spanish/French
-- tokens normalize to the same lexemes. Porter stemming disabled (default).
-- content='catalog' declares an external-content FTS5 table; the source-of-
-- truth rows live in `catalog`, and FTS5 only stores the indexed tokens.

CREATE VIRTUAL TABLE IF NOT EXISTS catalog_fts USING fts5(
  text,
  content='catalog',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- ---------------------------------------------------------------------------
-- sqlite-vec virtual table — mirrors embeddings.vector (FLOAT[384])
-- ---------------------------------------------------------------------------
-- Phase 5 queries this with vec_distance_cosine. The PRIMARY KEY column
-- (embedding_id INTEGER) is bound to embeddings.catalog_id's rowid via
-- the embeddings_ai trigger below — sqlite-vec 0.1.9 does not allow
-- string rowids, so we use the embeddings rowid as the vec rowid.

CREATE VIRTUAL TABLE IF NOT EXISTS catalog_vec USING vec0(
  embedding float[384]
);

-- ---------------------------------------------------------------------------
-- Triggers — FTS5 sync (catalog → catalog_fts)
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS catalog_ai
AFTER INSERT ON catalog
BEGIN
  INSERT INTO catalog_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS catalog_au
AFTER UPDATE ON catalog
BEGIN
  -- FTS5 has no UPDATE; delete + insert on the rowid keeps the index in sync.
  INSERT INTO catalog_fts(catalog_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO catalog_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS catalog_ad
AFTER DELETE ON catalog
BEGIN
  INSERT INTO catalog_fts(catalog_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

-- ---------------------------------------------------------------------------
-- Triggers — sqlite-vec sync (embeddings → catalog_vec)
-- ---------------------------------------------------------------------------
-- embeddings.catalog_id is TEXT; sqlite-vec 0.1.9 wants the rowid as
-- INTEGER. We bind the embeddings rowid (which is the catalog rowid by
-- referential cascade) to catalog_vec's implicit rowid so vec_distance_cosine
-- joins cleanly to catalog.id via the rowid-to-catalog rowid mapping.

CREATE TRIGGER IF NOT EXISTS embeddings_ai
AFTER INSERT ON embeddings
BEGIN
  INSERT INTO catalog_vec(rowid, embedding) VALUES (new.rowid, new.vector);
END;

CREATE TRIGGER IF NOT EXISTS embeddings_au
AFTER UPDATE ON embeddings
BEGIN
  INSERT INTO catalog_vec(catalog_vec, rowid, embedding) VALUES ('delete', old.rowid, old.vector);
  INSERT INTO catalog_vec(rowid, embedding) VALUES (new.rowid, new.vector);
END;

CREATE TRIGGER IF NOT EXISTS embeddings_ad
AFTER DELETE ON embeddings
BEGIN
  INSERT INTO catalog_vec(catalog_vec, rowid, embedding) VALUES ('delete', old.rowid, old.vector);
END;
