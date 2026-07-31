#!/usr/bin/env node
// Quick smoke test of CatalogLoader against the real example catalog.
import { CatalogLoader } from '../src/catalog/loader.ts';
import { makeStubEmbedder } from './helpers/stub-embedder.mjs';
import { openAndMigrate } from '../src/catalog/db/open.ts';
import { getCatalogSchemaVersion } from '../src/catalog/version.ts';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const yamlDir = join(repoRoot, 'config', 'catalog');
const dbPath = join(repoRoot, 'data', 'smoke-loader.sqlite');

console.log('[SMOKE] yamlDir:', yamlDir);
console.log('[SMOKE] dbPath:', dbPath);
console.log('[SMOKE] schemaVersion:', getCatalogSchemaVersion());

const db = await openAndMigrate(dbPath);
try {
  const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir });
  const start = Date.now();
  const result = await loader.loadAll();
  const totalMs = Date.now() - start;
  console.log('[SMOKE] result:', JSON.stringify({ ...result, skippedFiles: result.skippedFiles.length }));
  console.log(`[SMOKE] total wall-clock: ${totalMs}ms`);

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM catalog) AS catalog_count,
      (SELECT COUNT(*) FROM embeddings) AS embeddings_count,
      (SELECT COUNT(*) FROM catalog_fts) AS fts_count,
      (SELECT COUNT(*) FROM catalog_vec) AS vec_count
  `).get();
  console.log('[SMOKE] DB counts:', JSON.stringify(counts));

  // Re-run: should be idempotent.
  const second = await loader.loadAll();
  console.log('[SMOKE] second run:', JSON.stringify({ added: second.added, updated: second.updated, deleted: second.deleted, skipped: second.skipped }));
} finally {
  db.close();
  try { rmSync(dbPath, { force: true }); } catch {}
  try { rmSync(dbPath + '-wal', { force: true }); } catch {}
  try { rmSync(dbPath + '-shm', { force: true }); } catch {}
}
