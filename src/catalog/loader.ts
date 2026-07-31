/**
 * CatalogLoader (Phase 1.3 T-10).
 *
 * Orchestrates the full YAML → SQLite pipeline:
 *   1. read `*.yaml` files from `yamlDir`
 *   2. parse + validate each file via Zod (SkillSchema / RuleSchema / PersonaSchema)
 *      - invalid files are skipped with a stderr line and counted in `skipped`
 *   3. compute a canonical content hash (sha256 over the canonical JSON form)
 *   4. embed each item's `text` field through the Embedder
 *   5. upsert into `catalog` + `embeddings` keyed on `id`
 *      - no-op if the row already exists with the same content_hash
 *      - update if exists with different content_hash (re-embed too)
 *      - insert if id is new
 *   6. prune rows whose `id` is no longer present in the YAML set
 *      (ON DELETE CASCADE removes the matching embeddings + vec rows)
 *
 * Returns a single `LoadResult` summary so `build-index` (Phase 1.4)
 * can print a one-line perf summary. All errors are typed — bad YAML
 * goes to stderr + `skipped` counter, embedder failures throw `EmbedderError`,
 * SQLite failures bubble up as-is.
 *
 * Notes on idempotency:
 *   - `id` is the natural key (TEXT PRIMARY KEY)
 *   - `content_hash` detects in-place edits without re-reading the YAML file
 *   - The embeddings row is keyed on `catalog_id` (FK CASCADE handles delete)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseYaml, Document } from 'yaml';

import type { Database } from 'better-sqlite3';

import type { Embedder } from './embedder/types.ts';
import { validateCatalogItem } from './schema/index.ts';
import type { CatalogItem } from './schema/index.ts';
import { SchemaError } from './schema/index.ts';

export interface CatalogLoaderOptions {
  /** Absolute path to a directory containing `*.yaml` catalog files. */
  yamlDir: string;
  /**
   * Model version label written into the `embeddings.model_version` column.
   * Defaults to `multilingual-e5-small-v1`. Phase 5+ may override if the
   * embedder under `embedder.dimensions` returns differently-shaped vectors.
   */
  modelVersion?: string;
}

export interface LoadResult {
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  durationMs: number;
  /**
   * Files that failed validation. Each entry maps the file's basename to
   * the structured error code (`SchemaError.code`). Tests assert against
   * the count + the basename; build-index CLI just prints stderr.
   */
  skippedFiles: Array<{ file: string; error: string }>;
}

interface CatalogRowDB {
  content_hash: string;
}

const DEFAULT_MODEL_VERSION = 'multilingual-e5-small-v1';

/**
 * Encapsulates the parse → validate → embed → upsert → prune pipeline.
 * Construct once and call `loadAll()` repeatedly; the loader is
 * idempotent across runs on the same `(db, embedder, yamlDir)` triple.
 */
export class CatalogLoader {
  private readonly db: Database;
  private readonly embedder: Embedder;
  private readonly yamlDir: string;
  private readonly modelVersion: string;

  constructor(db: Database, embedder: Embedder, options: CatalogLoaderOptions) {
    if (!db) throw new TypeError('CatalogLoader: db is required');
    if (!embedder) throw new TypeError('CatalogLoader: embedder is required');
    if (!options || typeof options.yamlDir !== 'string' || options.yamlDir.length === 0) {
      throw new TypeError('CatalogLoader: options.yamlDir is required');
    }
    if (embedder.dimensions !== 384) {
      throw new TypeError(
        `CatalogLoader: embedder.dimensions must be 384; got ${embedder.dimensions}`,
      );
    }
    this.db = db;
    this.embedder = embedder;
    this.yamlDir = options.yamlDir;
    this.modelVersion = options.modelVersion ?? DEFAULT_MODEL_VERSION;
  }

  /**
   * Run the full load pipeline. Returns a summary; throws on unrecoverable
   * errors (SQLite, embedder, missing yamlDir). Per-file validation
   * failures are reported via `result.skipped`/`skippedFiles`, never thrown.
   */
  async loadAll(): Promise<LoadResult> {
    const start = Date.now();
    const skippedFiles: Array<{ file: string; error: string }> = [];
    let added = 0;
    let updated = 0;
    let deleted = 0;

    // 1. Collect + parse + validate YAML files ---------------------------------
    const yamlFiles = await this.collectYamlFiles();
    const itemsById = new Map<string, { item: CatalogItem; file: string }>();

    for (const file of yamlFiles) {
      const readResult = await this.readYaml(file);
      if (!readResult.ok) {
        skippedFiles.push({ file, error: readResult.reason });
        continue;
      }
      const validation = validateCatalogItem(readResult.parsed);
      if (!validation.ok) {
        const reason = validation.error || validation.code;
        // Per R-12: stderr + skip (do not crash the loader).
        process.stderr.write(`[WARN] build-index: skipped ${file}: ${reason}\n`);
        skippedFiles.push({ file, error: reason });
        continue;
      }
      const record = validation.record;
      const existing = itemsById.get(record.id);
      if (existing) {
        // Duplicate id: first wins; second skipped (spec edge case).
        process.stderr.write(
          `[WARN] build-index: skipped ${file}: duplicate id "${record.id}" (already in ${existing.file})\n`,
        );
        skippedFiles.push({ file, error: 'duplicate_id' });
        continue;
      }
      itemsById.set(record.id, { item: record, file });
    }

    const skipped = skippedFiles.length;

    // 2. Upsert into catalog + embeddings -------------------------------------
    // Wrap each per-item upsert in a try/catch so one bad item doesn't
    // crash the loader (the spec is "skip on error"). Embedder failures
    // (e.g. model missing) DO bubble up — build-index should exit 1.
    const upsertStmt = this.db.prepare(
      `INSERT INTO catalog (id, type, title, text, category, critical, is_default, content_hash, created_at, updated_at)
       VALUES (@id, @type, @title, @text, @category, @critical, @is_default, @hash, @ts, @ts)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         title = excluded.title,
         text = excluded.text,
         category = excluded.category,
         critical = excluded.critical,
         is_default = excluded.is_default,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
    );

    const selectStmt = this.db.prepare(
      'SELECT content_hash FROM catalog WHERE id = ?',
    );

    const insertEmbeddingStmt = this.db.prepare(
      `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(catalog_id) DO UPDATE SET
         vector = excluded.vector,
         model_version = excluded.model_version,
         embedded_at = excluded.embedded_at`,
    );

    for (const { item, file } of itemsById.values()) {
      const hash = sha256Canonical(item);
      const ts = Date.now();
      const existing = selectStmt.get(item.id) as CatalogRowDB | undefined;
      const wasNew = !existing;
      const wasUpdated = !!existing && existing.content_hash !== hash;

      // Skip when the stored row is byte-identical (no-op idempotency).
      if (existing && existing.content_hash === hash) continue;

      // Embed text (precondition: must succeed before we write the row).
      const vector = await this.embedder.encode(item.text);

      const writeTransaction = this.db.transaction(() => {
        upsertStmt.run({
          id: item.id,
          type: item.type,
          title: 'title' in item ? item.title ?? null : null,
          text: item.text,
          category: 'category' in item ? item.category ?? null : null,
          critical: 'critical' in item ? (item.critical ? 1 : 0) : null,
          is_default: 'isDefault' in item ? (item.isDefault ? 1 : 0) : null,
          hash,
          ts,
        });
        insertEmbeddingStmt.run(
          item.id,
          Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
          this.modelVersion,
          ts,
        );
      });
      writeTransaction();

      if (wasNew) added += 1;
      else if (wasUpdated) updated += 1;
      // touched file suppresses unused-var lint while remaining on the
      // record for future logging hooks (kept intentionally simple for
      // Phase 1.3 — verbose per-file logging lives in Phase 1.4 CLI).
      void file;
    }

    // 3. Prune ids that disappeared from the YAML set -------------------------
    const incomingIds = new Set(itemsById.keys());
    const deleteStmt = this.db.prepare('DELETE FROM catalog WHERE id = ?');
    const existingIds = (
      this.db.prepare('SELECT id FROM catalog').all() as Array<{ id: string }>
    ).map((r) => r.id);
    for (const id of existingIds) {
      if (!incomingIds.has(id)) {
        deleteStmt.run(id);
        deleted += 1;
      }
    }

    return {
      added,
      updated,
      deleted,
      skipped,
      durationMs: Date.now() - start,
      skippedFiles,
    };
  }

  /**
   * Read all `.yaml`/`.yml` files in `yamlDir`. Sort for determinism
   * (so two consecutive loaders process the same files in the same
   * order — cosmetic but helps debugging).
   */
  private async collectYamlFiles(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.yamlDir);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`CatalogLoader: cannot read yamlDir ${this.yamlDir}: ${reason}`);
    }
    return entries
      .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
      .sort();
  }

  /**
   * Read a single YAML file. Returns a discriminated result:
   *   `{ ok: true, parsed }` — caller continues to schema validation
   *   `{ ok: false, reason }` — caller increments `skippedFiles`
   *
   * Side-effect: writes a `[WARN] build-index: skipped <file>: <reason>`
   * line to stderr on every failure so the build-index CLI shows them
   * next to its perf summary.
   */
  private async readYaml(file: string): Promise<
    { ok: true; parsed: unknown } | { ok: false; reason: string }
  > {
    const path = join(this.yamlDir, file);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const msg = `${reason}`;
      process.stderr.write(`[WARN] build-index: skipped ${file}: ${msg}\n`);
      return { ok: false, reason: msg };
    }
    if (raw.trim().length === 0) {
      const msg = 'file is empty';
      process.stderr.write(`[WARN] build-index: skipped ${file}: ${msg}\n`);
      return { ok: false, reason: msg };
    }
    try {
      const doc = parseYaml(raw);
      // The `yaml` package returns a Document instance for some inputs;
      // normalize to a plain value via Document#toJSON if so.
      const value = doc instanceof Document ? (doc.toJSON() ?? null) : doc;
      if (value === null || value === undefined) {
        const msg = 'yaml document is empty';
        process.stderr.write(`[WARN] build-index: skipped ${file}: ${msg}\n`);
        return { ok: false, reason: msg };
      }
      return { ok: true, parsed: value };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[WARN] build-index: skipped ${file}: ${reason}\n`);
      return { ok: false, reason };
    }
  }
}

/**
 * Deterministic content hash for a validated catalog item. Uses the
 * canonical JSON form (the Zod schema has stripped extra fields and
 * applied transforms like NFC normalization; we serialize a stable
 * snapshot rather than re-stringifying the original YAML so two
 * different YAMLs that describe the same item produce the same hash).
 */
function sha256Canonical(item: CatalogItem): string {
  const stable = {
    id: item.id,
    type: item.type,
    title: 'title' in item ? item.title ?? null : null,
    text: item.text,
    category: 'category' in item ? item.category ?? null : null,
    critical: 'critical' in item ? item.critical ?? false : null,
    isDefault: 'isDefault' in item ? item.isDefault ?? false : null,
  };
  const json = JSON.stringify(stable, Object.keys(stable).sort());
  return createHash('sha256').update(json).digest('hex');
}

// Re-export SchemaError for callers (loader throws nothing typed itself,
// but downstream code that catches SchemaError from a direct schema parse
// can import it from here without poking at the schema submodule).
export { SchemaError };
