/**
 * CLI tests — cover ACs crud-14, crud-15, crud-16, crud-20.
 *
 * Each test invokes the CLI through `node --import tsx src/catalog/cli.ts`
 * (the same code path `npm run catalog:load` runs, minus npm's lifecycle
 * overhead which would dominate the 10s test SLA on Windows). Tests point
 * CATALOG_DB_PATH at a per-test temp file (cleanup in finally) and set
 * MS_CATALOG_LOAD_QUIET=1 to keep stdout free of pino JSON lines.
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

function runCli(yamlPath, dbPath, extraEnv = {}) {
  // Equivalent to running `npm run catalog:load <path>` but without the npm
  // shell overhead. The CLI script self-invokes its `main()` when started
  // directly (see cli.ts footer).
  const args = ['--import', 'tsx', cliEntry];
  if (yamlPath) args.push(yamlPath);
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

test('T-CLI-01: missing path argument exits 2 and prints usage (crud-14)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const result = runCli('', dbPath);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /usage:/);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-02: valid fixture creates skill on first run, unchanged on second (crud-15)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const r1 = runCli(cliFixture, dbPath);
    assert.equal(r1.status, 0, `first run status: ${r1.status}\nstdout:${r1.stdout}\nstderr:${r1.stderr}`);
    assert.match(r1.stdout, /created skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}/);

    const r2 = runCli(cliFixture, dbPath);
    assert.equal(r2.status, 0, `second run status: ${r2.status}\nstdout:${r2.stdout}\nstderr:${r2.stderr}`);
    assert.match(r2.stdout, /unchanged skill id=\d+ slug=example-jwt-01 hash=[0-9a-f]{64}/);

    // Both runs must report the SAME id and SAME hash (idempotency).
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

test('T-CLI-03: nonexistent file exits non-zero with a message in stderr (crud-16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const result = runCli('/nonexistent/does-not-exist.yaml', dbPath);
    assert.notEqual(result.status, 0);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /failed|cannot read|ENOENT|no such file/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-04: invalid YAML content exits non-zero (crud-16)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  const badYaml = join(dir, 'bad.yaml');
  writeFileSync(
    badYaml,
    ['slug: BadSlug', 'kind: skill', 'content: hi', ''].join('\n'),
    'utf8',
  );
  try {
    const result = runCli(badYaml, dbPath);
    assert.notEqual(result.status, 0);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /INVALID_SLUG|fail/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-05: MS_CATALOG_LOAD_QUIET=1 silences pino JSON-line output (crud-20)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    const result = runCli(cliFixture, dbPath, { MS_CATALOG_LOAD_QUIET: '1' });
    // The success path should only contain the "created skill ..." line,
    // nothing else. (If pino were not silenced it would emit a JSON line.)
    assert.equal(result.status, 0);
    const stdoutLines = (result.stdout || '').split('\n').filter((l) => l.trim());
    assert.equal(stdoutLines.length, 1);
    assert.match(stdoutLines[0], /^(created|unchanged) skill id=/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-CLI-06: --help exits 2 and prints usage (crud-14)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-cli-'));
  const dbPath = join(dir, 'db.sqlite');
  try {
    // Pass --help as the only positional argument; the CLI should detect it
    // as a usage request.
    const result = runCli('--help', dbPath);
    const combined = (result.stdout || '') + (result.stderr || '');
    assert.match(combined, /usage:/);
    assert.notEqual(result.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});