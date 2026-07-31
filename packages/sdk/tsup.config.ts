import { defineConfig } from 'tsup';
import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm', 'cjs'], dts: true, clean: true, target: 'node22', minify: true, treeshake: true, sourcemap: false, splitting: false, outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }), async onSuccess() { const path = join(process.cwd(), 'dist', 'index.mjs'); const raw = readFileSync(path); const gz = gzipSync(raw); process.stderr.write(`[SIZE] sdk: ${(gz.length / 1024).toFixed(2)}KB gzipped (${(statSync(path).size / 1024).toFixed(2)}KB raw)\n`); if (gz.length > 50000) process.exit(1); } });
