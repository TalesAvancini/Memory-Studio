/**
 * Idempotent upsert writer for the skills table.
 *
 * Idempotency model (per design.md §5):
 *   - SELECT by `hash` first. If a row exists, we DON'T modify it. We just
 *     hand it back to the caller as `action: 'unchanged'`.
 *   - If `hash` exists but `slug` in the incoming record differs from the
 *     stored slug, we emit a `WriterWarning` log line so the operator notices
 *     a rename. We do NOT update the row — slug rename is a Phase 8 migration
 *     concern, not a write path concern.
 *   - If `hash` is new, INSERT a fresh row with `created_at = updated_at =
 *     Date.now()`.
 *
 * Embedding storage: the Float32Array is persisted as a BLOB. We use
 * `Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)` so any view
 * (including sub-arrays) round-trips without copying when possible.
 */

import type { Database } from 'better-sqlite3';
import { pino, type Logger } from 'pino';
import { WriterError } from './errors.ts';
import type { SkillRecord, StoredSkill } from './types.ts';

export type UpsertAction = 'inserted' | 'unchanged';

export interface UpsertResult {
  readonly skill: StoredSkill;
  readonly action: UpsertAction;
}

interface SkillsRow {
  id: number;
  slug: string;
  kind: string;
  content_yaml: string;
  embedding: Buffer;
  hash: string;
  created_at: number;
  updated_at: number;
}

/** Build a silent logger by default. Tests / CLI inject their own. */
function defaultLogger(): Logger {
  return pino({ level: process.env.MS_CATALOG_LOAD_QUIET ? 'silent' : 'info' });
}

function rowToStoredSkill(row: SkillsRow): StoredSkill {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as StoredSkill['kind'],
    content: '', // writer doesn't track content; callers can re-read content_yaml
    contentYaml: row.content_yaml,
    hash: row.hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Serialize the embedding to a Buffer suitable for BLOB storage.
 *
 * `Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)` accepts the
 * underlying ArrayBuffer of a Float32Array (including views) and reads
 * exactly the bytes that hold the live data.
 */
export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(
    embedding.buffer,
    embedding.byteOffset,
    embedding.byteLength,
  );
}

/**
 * Deserialize a BLOB back into a Float32Array.
 *
 * `Buffer#buffer` may be a shared pool, so we slice to get a clean
 * ArrayBuffer for the Float32Array constructor.
 */
export function bufferToEmbedding(buf: Buffer): Float32Array {
  // Copy into a fresh ArrayBuffer to avoid sharing with the Buffer pool.
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

export interface UpsertOptions {
  readonly logger?: Logger;
  readonly now?: () => number;
}

/**
 * Upsert a skill into the catalog.
 *
 * @param db       better-sqlite3 database connection (caller owns open/close).
 * @param record   the SkillRecord to insert (loader-produced).
 * @param embedding 384-dim Float32Array (embedder-produced).
 * @param options  optional logger + clock injection for tests.
 */
export function upsertSkill(
  db: Database,
  record: SkillRecord,
  embedding: Float32Array,
  options: UpsertOptions = {},
): UpsertResult {
  if (embedding.length !== 384) {
    throw new WriterError(
      `embedding must be 384-dim, got ${embedding.length}`,
      'DB_ERROR',
    );
  }

  const log = options.logger ?? defaultLogger();
  const now = options.now ?? Date.now;
  const embeddingBuf = embeddingToBuffer(embedding);

  // 1. Lookup by hash — the idempotency key.
  const selectByHash = db.prepare<[string], SkillsRow>(
    `SELECT id, slug, kind, content_yaml, embedding, hash, created_at, updated_at
     FROM skills WHERE hash = ?`,
  );

  let existing: SkillsRow | undefined;
  try {
    existing = selectByHash.get(record.hash);
  } catch (err) {
    throw new WriterError(
      `SELECT by hash failed: ${err instanceof Error ? err.message : String(err)}`,
      'DB_ERROR',
    );
  }

  if (existing) {
    if (existing.slug !== record.slug) {
      // Hash collision or external rename. Log but don't modify.
      log.warn(
        {
          event: 'WriterWarning',
          reason: 'slug_differs_for_same_hash',
          stored_slug: existing.slug,
          incoming_slug: record.slug,
          hash: record.hash,
        },
        'writer warning: slug mismatch for existing hash, record unchanged',
      );
    }
    return { skill: rowToStoredSkill(existing), action: 'unchanged' };
  }

  // 2. Insert a new row.
  const insert = db.prepare(
    `INSERT INTO skills
      (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const ts = now();
  let result;
  try {
    result = insert.run(
      record.slug,
      record.kind,
      record.contentYaml,
      embeddingBuf,
      record.hash,
      ts,
      ts,
    );
  } catch (err) {
    // Slug uniqueness is the most likely failure here (different hash, same
    // slug). Surface as a WriterError.
    throw new WriterError(
      `INSERT failed: ${err instanceof Error ? err.message : String(err)}`,
      'DB_ERROR',
    );
  }

  const id = Number(result.lastInsertRowid);
  const stored: StoredSkill = {
    id,
    slug: record.slug,
    kind: record.kind,
    content: record.content,
    contentYaml: record.contentYaml,
    hash: record.hash,
    createdAt: ts,
    updatedAt: ts,
  };
  return { skill: stored, action: 'inserted' };
}

/**
 * Read a single skill by id, returning its full StoredSkill (including
 * embedding as a Float32Array). Returns undefined if not found.
 *
 * Helper for tests + CLI debugging; not used by the catalog:load flow.
 */
export function readSkillById(
  db: Database,
  id: number,
): StoredSkill | undefined {
  const row = db
    .prepare<[number], SkillsRow>(
      `SELECT id, slug, kind, content_yaml, embedding, hash, created_at, updated_at
       FROM skills WHERE id = ?`,
    )
    .get(id);
  if (!row) return undefined;
  const stored = rowToStoredSkill(row);
  // Include the embedding for callers that need it.
  return Object.assign(stored, {
    embedding: bufferToEmbedding(row.embedding),
  }) as StoredSkill & { embedding: Float32Array };
}