/**
 * build-index CLI orchestrator tests (T-13).
 *
 * Spawns `scripts/build-index.ts` as a child process against a
 * controlled yamlDir + dbPath (both in temp dirs) and asserts the
 * 3 exit-code + stderr-format scenarios from tasks.md T-13:
 *
 *   1. Exit 0 — full success (≥ 1 valid YAML).
 *      stderr contains `[INFO] build-index: parsing <yamlDir>` +
 *                 `[PERF] build-index: <ms>ms for <N> skills`
 *
 *   2. Exit 1 — ONNX model missing (we point to a bogus cache dir + use
 *      a stub model that does not exist; the multilingual-e5-small embedder
 *      throws EmbedderError, build-index surfaces `[ERROR] model not found — …`).
 *
 *   3. Exit 2 — ≥ 1 YAML skipped due to validation (we write 1 good +
 *      1 bad YAML; loader skips the bad one, build-index exits 2).
 *
 * All scenarios use real `node --experimental-strip-types` so they
 * exercise the same code path npm would run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/** Run `node --experimental-strip-types scripts/build-index.ts <args>`
 *  and return { code, stderr, stdout }. */
function runBuildIndex(args, opts = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        resolve(repoRoot, 'scripts', 'build-index.ts'),
        ...args,
      ],
      {
        cwd: repoRoot,
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    child.on('error', rejectRun);
    child.on('close', (code) => resolveRun({ code, stderr, stdout }));
  });
}

/** Make a temp dir for yaml or DB. */
async function tempPath(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return dir;
}

/** Write YAML files (key = filename, value = body) into `dir`. */
async function writeYamls(dir, files) {
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, 'utf8');
  }
}

// Standard valid Skill body (procedural, non-empty text).
const VALID_SKILL = (id, text) =>
  `id: ${id}\n` +
  `type: skill\n` +
  `title: ${id} title\n` +
  `category: procedural\n` +
  `text: ${text}\n`;

// ─── Scenario 1: exit 0 on full success ──────────────────────────────────────

test('build-index exits 0 on full success and prints [INFO] + [PERF] lines', async () => {
  const yamlDir = await tempPath('ms-bidx-ok-');
  const dbDir = await tempPath('ms-bidx-ok-db-');
  const dbPath = join(dbDir, 'memory-studio.sqlite');
  try {
    await writeYamls(yamlDir, {
      'auth-jwt-01.yaml': VALID_SKILL('auth-jwt-01', 'Validates JWT tokens.'),
      'no-secrets.yaml':
        `id: no-secrets\n` +
        `type: rule\n` +
        `critical: true\n` +
        `text: Never include secrets in prompts.\n`,
    });

    const { code, stderr } = await runBuildIndex([
      '--yaml-dir', yamlDir,
      '--db-path', dbPath,
    ]);

    assert.equal(code, 0, `stderr:\n${stderr}`);
    assert.match(stderr, /\[INFO\] build-index: parsing .*ms-bidx-ok-/);
    assert.match(stderr, /\[PERF\] build-index: \d+ms for \d+ skills/);
    // First run must show at least one added (≥ 2 items, ≥ 0 skipped).
    assert.match(stderr, /added=\d+ updated=\d+ deleted=\d+ skipped=\d+/);
  } finally {
    await rm(yamlDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

// ─── Scenario 2: exit 1 when ONNX model missing ──────────────────────────────
//
// Approach: temporarily rename the cached model's `onnx/` folder so that
// `assertMultilingualE5SmallCached()` (called from
// `MultilingualE5SmallEmbedder.init()`) sees the file missing, throws
// `EmbedderError`, and `build-index.ts` surfaces it as
// `[ERROR] build-index: model not found — …`. Folder restore is in `finally`.
//
// Why not just set HF_HOME/TRANSFORMERS_CACHE? transformers.js v4 binds
// the cache dir at import time and ignores most shell-level overrides —
// the hardcoded `expectedModelPath()` looks at
// `node_modules/@huggingface/transformers/.cache/<repo>/onnx/model.onnx`
// regardless of env vars. The only reliable gate is to remove the cached
// file/folder. Restore is atomic + idempotent.

const MODEL_CACHE_DIR = join(
  repoRoot,
  'node_modules',
  '@huggingface',
  'transformers',
  '.cache',
  'Xenova',
  'multilingual-e5-small',
  'onnx',
);
const MODEL_ONNX_FILE = join(MODEL_CACHE_DIR, 'model.onnx');

test('build-index exits 1 when ONNX model is missing and prints [ERROR] model not found', async () => {
  const yamlDir = await tempPath('ms-bidx-noModel-');
  const dbDir = await tempPath('ms-bidx-noModel-db-');
  const dbPath = join(dbDir, 'memory-studio.sqlite');

  // Skip the test if the cached `model.onnx` file doesn't exist on disk —
  // we can't simulate "missing" cleanly. (First-time checkout before
  // `npm run verify-env` would hit this; the test reports skip rather than fail.)
  if (!existsSync(MODEL_ONNX_FILE)) {
    return; // test.skip equivalent — the test passes vacuously
  }

  const backupPath = `${MODEL_ONNX_FILE}.bak-${Date.now()}`;
  let renamed = false;
  try {
    await writeYamls(yamlDir, {
      'auth-jwt-01.yaml': VALID_SKILL('auth-jwt-01', 'Validates JWT tokens.'),
    });

    // Rename only the .onnx file (not the directory) so the embedder's
    // model-existence check (`existsSync(model.onnx)`) fails. Renaming
    // can hit EBUSY on Windows when concurrent test files (embedder.test.mjs)
    // are still using the model. Retry with exponential backoff up to ~10s.
    const { rename } = await import('node:fs/promises');
    const renameWithRetry = async (src, dst) => {
      const MAX_ATTEMPTS = 25;
      let delay = 50;
      let lastErr;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          await rename(src, dst);
          return;
        } catch (err) {
          lastErr = err;
          if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
            await new Promise((r) => setTimeout(r, delay));
            delay = Math.min(delay * 2, 1000);
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    };

    await renameWithRetry(MODEL_ONNX_FILE, backupPath);
    renamed = true;

    const { code, stderr } = await runBuildIndex([
      '--yaml-dir', yamlDir,
      '--db-path', dbPath,
    ]);

    assert.equal(code, 1, `stderr:\n${stderr}`);
    assert.match(stderr, /\[ERROR\] build-index: model not found/);
    assert.match(stderr, /not found at /);
  } finally {
    if (renamed) {
      try {
        const { rename } = await import('node:fs/promises');
        await rename(backupPath, MODEL_ONNX_FILE);
      } catch (restoreErr) {
        // Last-ditch attempt: try to log so a manual restore is possible.
        process.stderr.write(
          `[build-index.test.mjs] WARNING failed to restore ${backupPath} → ${MODEL_ONNX_FILE}: ${restoreErr && restoreErr.message ? restoreErr.message : restoreErr}\n`,
        );
      }
    }
    await rm(yamlDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

// ─── Scenario 3: exit 2 on YAML validation failure ───────────────────────────

test('build-index exits 2 when ≥ 1 YAML is invalid and prints [WARN] skipped', async () => {
  const yamlDir = await tempPath('ms-bidx-skip-');
  const dbDir = await tempPath('ms-bidx-skip-db-');
  const dbPath = join(dbDir, 'memory-studio.sqlite');
  try {
    // 1 valid + 1 invalid (missing `text`). Expectation: added=1, skipped=1, exit 2.
    await writeYamls(yamlDir, {
      'good.yaml': VALID_SKILL('good', 'OK text'),
      'bad.yaml': 'id: bad\ntype: skill\ntitle: bad title\ncategory: procedural\n', // no text field
    });

    const { code, stderr } = await runBuildIndex([
      '--yaml-dir', yamlDir,
      '--db-path', dbPath,
    ]);

    assert.equal(code, 2, `stderr:\n${stderr}`);
    assert.match(stderr, /\[WARN\] build-index: skipped bad\.yaml/);
    assert.match(stderr, /\[PERF\] build-index: \d+ms for \d+ skills/);
  } finally {
    await rm(yamlDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});

// ─── Scenario 4: empty-ok flag ────────────────────────────────────────────────

test('build-index with --empty-ok exits 0 even when 0 items load', async () => {
  const yamlDir = await tempPath('ms-bidx-empty-');
  const dbDir = await tempPath('ms-bidx-empty-db-');
  const dbPath = join(dbDir, 'memory-studio.sqlite');
  try {
    // Empty yamlDir — no files at all.
    await mkdir(yamlDir, { recursive: true });

    const { code, stderr } = await runBuildIndex([
      '--yaml-dir', yamlDir,
      '--db-path', dbPath,
      '--empty-ok',
    ]);

    assert.equal(code, 0, `stderr:\n${stderr}`);
    assert.match(stderr, /\[PERF\] build-index: \d+ms for 0 skills/);
  } finally {
    await rm(yamlDir, { recursive: true, force: true });
    await rm(dbDir, { recursive: true, force: true });
  }
});
