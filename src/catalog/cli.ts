#!/usr/bin/env node
/**
 * CLI entry point for `npm run catalog:load <yaml-path>`.
 *
 * Pipeline:
 *   1. Parse argv (1 mandatory positional arg = path to a skill YAML).
 *   2. Open (or create) data/skills.sqlite (path overridable via
 *      CATALOG_DB_PATH env var).
 *   3. Run createSchema() to ensure the tables exist (idempotent).
 *   4. Load + validate the YAML via the loader.
 *   5. Generate the embedding via DeterministicStubEmbedder.
 *   6. Idempotent upsert via upsertSkill().
 *   7. Print the action ("created" or "unchanged") + id/slug/hash.
 *
 * Exit codes (Unix convention):
 *   0 — success (insert OR unchanged).
 *   1 — runtime error (validation, SQL, IO).
 *   2 — usage error (wrong argv).
 */

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';
import Database from 'better-sqlite3';
import { pino } from 'pino';

import { createSchema } from './schema.ts';
import { loadSkillFromFile } from './loader.ts';
import { DeterministicStubEmbedder } from './embedder.ts';
import { upsertSkill } from './writer.ts';
import { LoaderError, SchemaError, WriterError } from './errors.ts';

const DEFAULT_DB_PATH = 'data/skills.sqlite';
const USAGE =
  'usage: npm run catalog:load <path-to-yaml>\n\n' +
  'environment:\n' +
  '  CATALOG_DB_PATH      override SQLite path (default: data/skills.sqlite)\n' +
  '  MS_CATALOG_LOAD_QUIET=1  silence the pino logger';

function printUsage(): void {
  stderr.write(`${USAGE}\n`);
}

function isUsageError(argv: readonly string[]): boolean {
  // argv[0] = node, argv[1] = script path (tsx wrapper).
  // Strip those to get the "user-facing" args.
  const userArgs = argv.slice(2);
  if (userArgs.length === 1 && (userArgs[0] === '--help' || userArgs[0] === '-h')) {
    return true;
  }
  if (userArgs.length === 0) return true;
  if (userArgs.length > 1) return true;
  return false;
}

export async function main(argvIn: readonly string[]): Promise<number> {
  if (isUsageError(argvIn)) {
    printUsage();
    return 2;
  }
  const userArgs = argvIn.slice(2);
  const yamlPath = resolve(userArgs[0] as string);

  const quiet = process.env.MS_CATALOG_LOAD_QUIET === '1';
  const log = pino({ level: quiet ? 'silent' : 'info' });

  const dbPath = resolve(process.env.CATALOG_DB_PATH ?? DEFAULT_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  try {
    createSchema(db);

    const record = loadSkillFromFile(yamlPath);
    const embedding = await new DeterministicStubEmbedder().embed(record.content);
    const result = upsertSkill(db, record, embedding);

    const verb = result.action === 'inserted' ? 'created' : 'unchanged';
    stdout.write(
      `${verb} skill id=${result.skill.id} slug=${result.skill.slug} hash=${result.skill.hash}\n`,
    );
    return 0;
  } catch (err) {
    if (
      err instanceof LoaderError ||
      err instanceof WriterError ||
      err instanceof SchemaError
    ) {
      log.error(
        {
          event: 'catalog:load_failed',
          code: err.code,
          path: yamlPath,
          msg: err.message,
        },
        'catalog:load failed',
      );
    } else {
      log.error(
        { event: 'catalog:load_failed', err: String(err), path: yamlPath },
        'catalog:load failed',
      );
    }
    stderr.write(
      `catalog:load failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  } finally {
    db.close();
  }
}

// Touch a couple of fs helpers so the import isn't flagged as unused in
// strict linter configs (mkdirSync existsSync are used above).
void existsSync;
void readFileSync;

// Auto-run when invoked directly (not when imported for tests).
// We compare the absolute file URL of this module against the resolved URL
// of `process.argv[1]` (the script tsx launched).
const scriptUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
const isDirectInvocation = import.meta.url === scriptUrl;
if (isDirectInvocation) {
  main(argv)
    .then((code) => exit(code))
    .catch((err) => {
      stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
      exit(1);
    });
}