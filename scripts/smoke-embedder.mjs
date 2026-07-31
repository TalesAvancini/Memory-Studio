#!/usr/bin/env node
// Quick smoke test for the embedder module — local, NOT a gate.
import { MultilingualE5SmallEmbedder } from '../src/catalog/embedder/index.ts';
import { EMBEDDING_DIMENSIONS, expectedModelPath } from '../src/catalog/embedder/index.ts';
import { existsSync } from 'node:fs';

console.log('[SMOKE] model path:', expectedModelPath());
console.log('[SMOKE] model exists:', existsSync(expectedModelPath()));
console.log('[SMOKE] dim constant:', EMBEDDING_DIMENSIONS);

const e = new MultilingualE5SmallEmbedder({ kind: 'passage' });
console.log('[SMOKE] embedder created, dims:', e.dimensions);

const start = Date.now();
const v1 = await e.encode('hello world');
const t1 = Date.now() - start;
console.log(`[SMOKE] first encode took ${t1}ms, returned Float32Array length=${v1.length}, first 3=[${Array.from(v1.slice(0, 3)).map(x => x.toFixed(4)).join(', ')}]`);

const start2 = Date.now();
const v2 = await e.encode('hello world');
const t2 = Date.now() - start2;
console.log(`[SMOKE] second encode took ${t2}ms`);

let same = v1.length === v2.length;
if (same) {
  for (let i = 0; i < v1.length; i += 1) {
    if (Math.abs(v1[i] - v2[i]) > 1e-6) { same = false; break; }
  }
}
console.log(`[SMOKE] deterministic: ${same}`);

const eq = new MultilingualE5SmallEmbedder({ kind: 'query' });
const v3 = await eq.encode('hello world');
let diff = v1.length === v3.length;
if (diff) {
  let dist = 0;
  for (let i = 0; i < v1.length; i += 1) {
    const d = v1[i] - v3[i];
    dist += d * d;
  }
  console.log(`[SMOKE] L2(query vs passage of same text): ${Math.sqrt(dist).toFixed(6)}`);
}
console.log(`[SMOKE] DONE`);
process.exit(0);
