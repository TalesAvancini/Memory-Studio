#!/usr/bin/env node
/**
 * scripts/build-index.ts — Phase 1.4 T-13.
 *
 * CLI orchestrator for the YAML → SQLite + embeddings cold-path pipeline.
 *
 * Usage:
 *   node scripts/build-index.ts                          # default config/catalog/ + data/memory-studio.sqlite
 *   node scripts/build-index.ts --yaml-dir <dir>         # custom YAML directory
 *   node scripts/build-index.ts --db-path <file>         # custom SQLite path
 *   node scripts/build-index.ts --empty-ok               # exit 0 even when no items load
 *
 * Contract (T-13 done criteria):
 *   - Exit 0 on full success (≥ 1 item loaded OR --empty-ok)
 *   - Exit 1 on unrecoverable error (ONNX model missing, DB open fail, migration fail,
 *     embedder load fail, embedder inference fail)
 *   - Exit 2 on partial success (≥ 1 YAML skipped due to validation, ≥ 0 loaded)
 *
 * Stderr format:
 *   [INFO]  build-index: parsing <yamlDir>
 *   [INFO]  build-index: schemaVersion=N
 *   [PERF]  build-index: <ms>ms for <N> skills (added=X updated=Y deleted=Z skipped=K totalMs=M)
 *   [WARN]  build-index: skipped <file>: <reason>          (per-file from CatalogLoader)
 *   [ERROR] build-index: model not found at <path>         (T-13 done #2)
 *   [ERROR] build-index: <message>                         (other unrecoverables)
 *
 * The default paths are the PRD §6.4 / §14.5 conventions:
 *   - yamlDir:   <repo>/config/catalog/
 *   - dbPath:    <repo>/data/memory-studio.sqlite
 *
 * The script intentionally has NO business logic beyond orchestration; all
 * catalog work lives in src/catalog/** (CatalogLoader, MultilingualE5SmallEmbedder,
 * openAndMigrate). This keeps the script small and easy to swap for a Phase
 * 5 caller that drives the loader programmatically.
 */

// Phase 1.4 deliverable — greenfield script. Imports reach into Phase 1.1+1.2+1.3.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

import { CatalogLoader } from '../src/catalog/loader.ts';
import { MultilingualE5SmallEmbedder } from '../src/catalog/embedder/index.ts';
import { openAndMigrate } from '../src/catalog/db/open.ts';
import { getCatalogSchemaVersion } from '../src/catalog/version.ts';
import { EmbedderError, MigrationError } from '../src/catalog/errors.ts';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..');
const DEFAULT_YAML_DIR = resolve(REPO_ROOT, 'config', 'catalog');
const DEFAULT_DB_PATH = resolve(REPO_ROOT, 'data', 'memory-studio.sqlite');

// ─── Argv parsing ────────────────────────────────────────────────────────────

interface CliOptions {
  yamlDir: string;
  dbPath: string;
  emptyOk: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const out: CliOptions = {
    yamlDir: DEFAULT_YAML_DIR,
    dbPath: DEFAULT_DB_PATH,
    emptyOk: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--yaml-dir':
        out.yamlDir = resolve(argv[++i] ?? '');
        break;
      case '--db-path':
        out.dbPath = resolve(argv[++i] ?? '');
        break;
      case '--empty-ok':
        out.emptyOk = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        process.stderr.write(`[ERROR] build-index: unknown argument: ${arg}\n`);
        process.exit(1);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `usage: build-index [--yaml-dir <dir>] [--db-path <file>] [--empty-ok]\n` +
      `                  [-h | --help]\n\n` +
      `Defaults:\n` +
      `  --yaml-dir   <repo>/config/catalog/             (PRD §6.4)\n` +
      `  --db-path    <repo>/data/memory-studio.sqlite   (PRD §14.5)\n` +
      `  --empty-ok   exit 0 when 0 items load (default: exit 2)\n\n` +
      `Exit codes:\n` +
      `  0  full success (≥ 1 item loaded OR --empty-ok)\n` +
      `  1  unrecoverable (ONNX model missing, DB open, migration, embedder load/inference)\n` +
      `  2  partial success (≥ 1 YAML skipped due to validation)\n`,
  );
}

// ─── Stderr helpers ──────────────────────────────────────────────────────────

function info(line: string): void {
  process.stderr.write(`[INFO] build-index: ${line}\n`);
}

function perf(line: string): void {
  process.stderr.write(`[PERF] build-index: ${line}\n`);
}

function error(line: string): void {
  process.stderr.write(`[ERROR] build-index: ${line}\n`);
}

/**
 * Determine exit code from loader result + flags.
 *   - Skipped count > 0 → 2 (partial success)
 *   - 0 items and --empty-ok not set → 2 (treat empty as partial)
 *   - Otherwise → 0
 */
function exitCodeFor(result: { added: number; updated: number; skipped: number }, emptyOk: boolean): 0 | 2 {
  if (result.skipped > 0) return 2;
  const totalChanges = result.added + result.updated;
  if (totalChanges === 0 && !emptyOk) return 2;
  return 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  info(`parsing ${opts.yamlDir}`);
  info(`schemaVersion=${getCatalogSchemaVersion()}`);

  // 1. YAML directory must exist (else fail fast with a clear message).
  if (!existsSync(opts.yamlDir)) {
    error(`yaml directory not found at ${opts.yamlDir}`);
    return 1;
  }

  // 2. Open DB + apply migrations.
  let db: Awaited<ReturnType<typeof openAndMigrate>>;
  try {
    db = await openAndMigrate(opts.dbPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    error(`failed to open database at ${opts.dbPath}: ${msg}`);
    return 1;
  }

  try {
    // 3. Instantiate the multilingual-e5-small embedder.
    let embedder: MultilingualE5SmallEmbedder;
    try {
      embedder = new MultilingualE5SmallEmbedder({ kind: 'passage' });
      await embedder.init();
    } catch (err) {
      // Wrap model-not-found in a clear stderr line (per T-13 done #2 + R-08).
      if (err instanceof EmbedderError) {
        error(`model not found — ${err.message}`);
      } else if (err instanceof Error) {
        error(`failed to load embedder: ${err.message}`);
      } else {
        error(`failed to load embedder: ${String(err)}`);
      }
      return 1;
    }

    // 4. Run the loader. MigrationError from openAndMigrate would have surfaced
    //    at step 2; per-file validation failures are caught inside loadAll()
    //    and reported via `result.skipped` + stderr lines. Anything else
    //    (DB constraint, embedder crash mid-run) bubbles out and we exit 1.
    const loader = new CatalogLoader(db, embedder, { yamlDir: opts.yamlDir });
    let result: Awaited<ReturnType<typeof loader.loadAll>>;
    try {
      result = await loader.loadAll();
    } catch (err) {
      if (err instanceof MigrationError) {
        error(`migration failed: ${err.message}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        error(`loader crashed: ${msg}`);
      }
      return 1;
    }

    // 5. Print the perf summary line (per T-13 done #1 + AC-9).
    const totalChanges = result.added + result.updated;
    perf(
      `${result.durationMs}ms for ${totalChanges} skills (added=${result.added} updated=${result.updated} deleted=${result.deleted} skipped=${result.skipped} totalMs=${result.durationMs})`,
    );

    return exitCodeFor(result, opts.emptyOk);
  } finally {
    try {
      db.close();
    } catch {
      // best-effort
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Last-resort safety net — should never fire because main() catches
    // every typed error already. Print + exit 1 so the orchestrator knows
    // the build failed.
    error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
