#!/usr/bin/env node
// Smoke test of CatalogLoader with the REAL multilingual-e5-small embedder
// against the real example catalog. Exercises the full pipeline end-to-end
// (Phase 1.3 + Phase 1.1 schemas + Phase 1.2 triggers).
import { CatalogLoader } from '../src/catalog/loader.ts';
import { MultilingualE5SmallEmbedder } from '../src/catalog/embedder/index.ts';
import { openAndMigrate } from '../src/catalog/db/open.ts';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const yamlDir = join(repoRoot, 'config', 'catalog');
const dbPath = join(repoRoot, 'data', 'smoke-real-loader.sqlite');

console.log('[SMOKE-REAL] yamlDir:', yamlDir);
console.log('[SMOKE-REAL] loading multilingual-e5-small...');

const embedder = new MultilingualE5SmallEmbedder({ kind: 'passage' });
const initStart = Date.now();
await embedder.init();
console.log(`[SMOKE-REAL] pipeline loaded in ${Date.now() - initStart}ms`);

const db = await openAndMigrate(dbPath);
try {
  const loader = new CatalogLoader(db, embedder, { yamlDir });
  const start = Date.now();
  const result = await loader.loadAll();
  const totalMs = Date.now() - start;
  console.log('[SMOKE-REAL] result:', JSON.stringify({ ...result, skippedFiles: result.skippedFiles.length }));
  console.log(`[SMOKE-REAL] total wall-clock: ${totalMs}ms`);

  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM catalog) AS catalog_count,
      (SELECT COUNT(*) FROM embeddings) AS embeddings_count,
      (SELECT COUNT(*) FROM catalog_fts) AS fts_count,
      (SELECT COUNT(*) FROM catalog_vec) AS vec_count
  `).get();
  console.log('[SMOKE-REAL] DB counts:', JSON.stringify(counts));

  // Test FTS lookup of a known token.
  const sample = db.prepare("SELECT text FROM catalog WHERE id = 'example-skill-01'").get();
  console.log(`[SMOKE-REAL] example-skill-01 text: ${String(sample.text).slice(0, 60)}...`);

  // Test vec_distance_cosine on the loaded embeddings.
  const queryVec = await embedder.encode('passage: JWT tokens');
  const distances = db.prepare(`
    SELECT c.id, vec_distance_cosine(catalog_vec.embedding, ?) AS d
    FROM catalog_vec JOIN catalog c ON c.rowid = catalog_vec.rowid
    ORDER BY d ASC
  `).all(Buffer.from(queryVec.buffer, queryVec.byteOffset, queryVec.byteLength));
  console.log('[SMOKE-REAL] query distances:', distances.map(d => `${d.id}: ${d.d.toFixed(4)}`).join(', '));

  // Second run: should be idempotent.
  const second = await loader.loadAll();
  console.log('[SMOKE-REAL] second run:', JSON.stringify({ added: second.added, updated: second.updated, deleted: second.deleted, skipped: second.skipped }));
} finally {
  db.close();
  try { rmSync(dbPath, { force: true }); } catch {}
  try { rmSync(dbPath + '-wal', { force: true }); } catch {}
  try { rmSync(dbPath + '-shm', { force: true }); } catch {}
}
