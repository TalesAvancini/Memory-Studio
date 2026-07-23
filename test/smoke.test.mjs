import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('smoke: runner alive', () => assert.equal(1, 1));
test('smoke: package.json exists', () => assert.ok(existsSync(join(root, 'package.json'))));
test('smoke: tsconfig.json exists', () => assert.ok(existsSync(join(root, 'tsconfig.json'))));
test('smoke: src/index.ts exists', () => assert.ok(existsSync(join(root, 'src', 'index.ts'))));
test('smoke: package.json declares ESM + Node 22', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.engines.node.startsWith('>=22'));
});
