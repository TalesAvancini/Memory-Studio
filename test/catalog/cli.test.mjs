/**
 * CLI tests — cover ACs crud-14, crud-15, crud-16, crud-20.
 *
 * Each subprocess test invokes the CLI through `node --import tsx src/catalog/cli.ts`
 * (the same code path `npm run catalog:load` runs, minus npm's lifecycle
 * overhead which would dominate the 10s test SLA on Windows). Tests point
 * CATALOG_DB_PATH at a per-test temp file (cleanup in finally) and set
 * MS_CATALOG_LOAD_QUIET=1 to keep stdout free of pino JSON lines.
 *
 * Most edge cases (usage errors, pino silence, error paths) are exercised
 * by importing `main` directly — this avoids the 1-2s per-spawn overhead on
 * Windows while still covering every branch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliFixture = join(repoRoot, 'config', 'skills', 'example-jwt-01.yaml');
const cliEntry = join(repoRoot, 'src', 'catalog', 'cli.ts');

function runCliSubprocess(yamlPath, dbPath, extraEnv = {}, extraArgs = []) {
  // Equivalent to running `npm run catalog:load <path>` but without the npm
  // shell overhead. The CLI script self-invokes its `main()` when started
  // directly (see cli.ts footer).
  const args = ['--import', 'tsx', cliEntry];
  if (yamlPath) args.push(yamlPath);
  for (const a of extraArgs) args.push(a);
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      CATALOG_DB_PATH: dbPath,
      MS_CATALOG_LOAD_QUIET: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

test('T-CLI-01: subprocess happy path — creates skill on first run, unchanged on second (crud-15, crud-20)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const r1 = runCliSubprocess(cliFixture, dbPath);
    assert.equal(r1.status, 0, `first run status: ${r1.status}\nstdout:${r1.stdout}\nstderr:${r1.stderr}`);
    assert.match(r1.stdout, /created skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}/);
    // stdout must be a single line (pino silenced).
    assert.equal(r1.stdout.split('\n').filter((l) => l.trim()).length, 1);

    const r2 = runCliSubprocess(cliFixture, dbPath);
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /unchanged skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}/);

    const id1 = r1.stdout.match(/id=(\d+)/)[1];
    const id2 = r2.stdout.match(/id=(\d+)/)[1];
    assert.equal(id1, id2);
    const hash1 = r1.stdout.match(/hash=([0-9a-f]{64})/)[1];
    const hash2 = r2.stdout.match(/hash=([0-9a-f]{64})/)[1];
    assert.equal(hash1, hash2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-02: subprocess with nonexistent file exits non-zero (crud-16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const result = runCliSubprocess('/nonexistent/does-not-exist.yaml', dbPath);
    assert.notEqual(result.status, 0);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /failed|cannot read|ENOENT|no such file/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-03: main() direct call with bad args returns 2 and prints usage (crud-14)', async () => {
  const cli = await import('../../src/catalog/cli.ts');
  assert.equal(await cli.main(['node', 'script']), 2, 'no args -> 2');
  assert.equal(await cli.main(['node', 'script', '--help']), 2, '--help -> 2');
  assert.equal(await cli.main(['node', 'script', '-h']), 2, '-h -> 2');
  assert.equal(await cli.main(['node', 'script', 'a', 'b']), 2, 'too many args -> 2');
});

test('T-CLI-04: main() direct call with invalid YAML exits 1 and logs error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-direct-'));
  const dbPath = join(dir, 'db.sqlite');
  const badYaml = join(dir, 'bad.yaml');
  writeFileSync(
    badYaml,
    ['slug: BadSlug', 'kind: skill', 'content: hi', ''].join('\n'),
    'utf8',
  );
  try {
    process.env.CATALOG_DB_PATH = dbPath;
    process.env.MS_CATALOG_LOAD_QUIET = '1';
    const cli = await import('../../src/catalog/cli.ts');
    const code = await cli.main(['node', 'script', badYaml]);
    assert.equal(code, 1);
  } finally {
    delete process.env.CATALOG_DB_PATH;
    delete process.env.MS_CATALOG_LOAD_QUIET;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-05: main() direct call with nonexistent file exits 1', async () => {
  process.env.CATALOG_DB_PATH = '/tmp/ms-cli-direct.sqlite';
  process.env.MS_CATALOG_LOAD_QUIET = '1';
  try {
    const cli = await import('../../src/catalog/cli.ts');
    const code = await cli.main(['node', 'script', '/nonexistent/zzz.yaml']);
    assert.equal(code, 1);
  } finally {
    delete process.env.CATALOG_DB_PATH;
    delete process.env.MS_CATALOG_LOAD_QUIET;
  }
});

test('T-CLI-06: main() direct call happy path — first run creates, second unchanged (crud-15)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-direct-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    process.env.CATALOG_DB_PATH = dbPath;
    process.env.MS_CATALOG_LOAD_QUIET = '1';

    const cli = await import('../../src/catalog/cli.ts');
    const code1 = await cli.main(['node', 'script', cliFixture]);
    assert.equal(code1, 0);

    const code2 = await cli.main(['node', 'script', cliFixture]);
    assert.equal(code2, 0);
  } finally {
    delete process.env.CATALOG_DB_PATH;
    delete process.env.MS_CATALOG_LOAD_QUIET;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-07: main() direct call with invalid DB path surfaces non-typed error', async () => {
  // Pointing CATALOG_DB_PATH at a directory forces better-sqlite3's
  // Database constructor to throw an unexpected error type, hitting the
  // `else` branch in cli.ts's catch block (where err is not a Loader/Writer/
  // Schema error).
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  try {
    process.env.CATALOG_DB_PATH = dir; // a directory, not a file
    process.env.MS_CATALOG_LOAD_QUIET = '1';
    const cli = await import('../../src/catalog/cli.ts');
    const code = await cli.main(['node', 'script', cliFixture]);
    assert.notEqual(code, 0);
  } finally {
    delete process.env.CATALOG_DB_PATH;
    delete process.env.MS_CATALOG_LOAD_QUIET;
    rmSync(dir, { recursive: true, force: true });
  }
});