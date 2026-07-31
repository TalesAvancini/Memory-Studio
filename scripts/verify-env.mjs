#!/usr/bin/env node
// scripts/verify-env.mjs — Phase 0 environment validation gate.
//
// Runs 6 deterministic checks against the runtime environment and exits 0
// only when all pass. Per-check output is structured so the Verifier can
// independently confirm pass/fail from stdout (no self-assessment).
//
// Check order (fixed, matches .specs/features/phase-0-environment-validation/spec.md):
//   1. node-version        — Node 22 LTS major (process.versions.node)
//   2. onnxruntime-node    — package loads, native binary resolves
//   3. fts5                — SQLite PRAGMA compile_options contains ENABLE_FTS5
//   4. sqlite-vec          — extension loads, SELECT vec_version() returns a string
//   5. embedding           — multilingual-e5-small ONNX produces a 384d Float32Array
//   6. filesystem          — .memory-studio/state.json write+read roundtrip preserves original content

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(__filename));
const STATE_JSON = join(REPO_ROOT, '.memory-studio', 'state.json');

// ─── Result accumulator ──────────────────────────────────────────────────────

const checks = [];

/**
 * Record a check outcome. Always prints one structured stdout line.
 * If ok=false, prints a remediation hint to stderr and accumulates a failure.
 */
function record(name, ok, observed, hint) {
  const tag = ok ? '[PASS]' : '[FAIL]';
  const line = `${tag} ${name}: ${observed}`;
  console.log(line);
  if (!ok && hint) {
    console.error(`        ${name}: ${hint}`);
  }
  checks.push({ name, ok, observed });
}

// ─── Check 1: Node version (R-03, AC-3) ──────────────────────────────────────

function checkNodeVersion() {
  const raw = process.versions.node; // e.g. "22.22.2" (no 'v' prefix in process.versions)
  const versionString = `v${raw}`; // match `node --version` shape for AC-3 (v22.x.y)
  const majorStr = raw.split('.')[0];
  const major = Number.parseInt(majorStr, 10);
  const ok = Number.isInteger(major) && major >= 22;
  record(
    'node-version',
    ok,
    `${versionString} (major=${major}, requires >=22)`,
    'install Node 22 LTS from https://nodejs.org (engines.node in package.json requires >=22.0.0).'
  );
}

// ─── Stubs (replaced in T-02..T-05) ──────────────────────────────────────────

function checkOnnxRuntimeNode() {
  // R-04 / AC-2: onnxruntime-node must load without throwing (ESM-friendly via createRequire).
  const localRequire = createRequire(import.meta.url);
  let ort;
  try {
    ort = localRequire('onnxruntime-node');
  } catch (err) {
    record(
      'onnxruntime-node',
      false,
      `require('onnxruntime-node') threw: ${err && err.message ? err.message : err}`,
      'install the package (`npm install onnxruntime-node`) or rebuild the native binary (`npm rebuild onnxruntime-node --build-from-source` if no prebuilt matches your platform).'
    );
    return;
  }
  let observed = 'loaded';
  try {
    const v = ort && ort.env && ort.env.versions ? ort.env.versions : null;
    if (v && typeof v === 'object') {
      const common = v.common || v.node || 'unknown';
      observed = `loaded (version=${common})`;
    }
  } catch {
    // Fall back to "loaded" if version probe fails — module still imported.
  }
  record('onnxruntime-node', true, observed, null);
}

async function checkFts5() {
  // R-05 / AC-4: PRAGMA compile_options must include ENABLE_FTS5.
  let Database;
  try {
    const mod = await import('better-sqlite3');
    Database = mod.default;
  } catch (err) {
    record(
      'fts5',
      false,
      `better-sqlite3 import failed: ${err && err.message ? err.message : err}`,
      'install better-sqlite3 (`npm install better-sqlite3`) or run `npm install` to restore node_modules.'
    );
    return;
  }
  let options;
  try {
    const db = new Database(':memory:');
    options = db.pragma('compile_options');
    db.close();
  } catch (err) {
    record(
      'fts5',
      false,
      `PRAGMA compile_options failed: ${err && err.message ? err.message : err}`,
      'better-sqlite3 binary may be missing or incompatible — run `npm rebuild better-sqlite3`.'
    );
    return;
  }
  const has = Array.isArray(options) && options.some((row) => row.compile_options === 'ENABLE_FTS5');
  record(
    'fts5',
    has,
    has ? 'ENABLE_FTS5 present in compile_options' : 'ENABLE_FTS5 missing from compile_options',
    has ? null : 'install a SQLite build with FTS5 enabled (better-sqlite3 11.x ships FTS5 — check `npm rebuild better-sqlite3`).'
  );
}

async function checkSqliteVec() {
  // R-06 / AC-5: SELECT vec_version() must return a non-empty string.
  let Database, sqliteVec;
  try {
    const dbMod = await import('better-sqlite3');
    Database = dbMod.default;
    sqliteVec = await import('sqlite-vec');
  } catch (err) {
    record(
      'sqlite-vec',
      false,
      `module import failed: ${err && err.message ? err.message : err}`,
      'install sqlite-vec (`npm install sqlite-vec`) — required for vector search in Phase 1+.'
    );
    return;
  }
  let version;
  try {
    const db = new Database(':memory:');
    sqliteVec.load(db);
    const row = db.prepare('SELECT vec_version() AS v').get();
    version = row && row.v;
    db.close();
  } catch (err) {
    record(
      'sqlite-vec',
      false,
      `SELECT vec_version() failed: ${err && err.message ? err.message : err}`,
      'sqlite-vec extension could not be loaded — check the prebuilt matches your Node version and OS; try `npm rebuild sqlite-vec`.'
    );
    return;
  }
  const ok = typeof version === 'string' && version.length > 0;
  record(
    'sqlite-vec',
    ok,
    ok ? `vec_version=${version}` : 'vec_version returned empty',
    ok ? null : 'sqlite-vec returned an empty version string — reinstall `sqlite-vec` and verify it matches your platform.'
  );
}

function checkEmbedding() {
  record('embedding', false, 'TODO: implemented in T-05', 'placeholder — replaced in T-05');
  throw new Error('TODO: embedding check not yet implemented (T-05)');
}

function checkFilesystem() {
  // R-08 / AC-10: write+read roundtrip on .memory-studio/state.json, original content preserved.
  const dir = dirname(STATE_JSON);

  // Ensure .memory-studio/ exists.
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  } catch (err) {
    record(
      'filesystem',
      false,
      `mkdir ${dir} failed: ${err && err.message ? err.message : err}`,
      `create the .memory-studio/ directory manually (e.g. \`mkdir .memory-studio\`) and rerun.`
    );
    return;
  }

  // Capture original content (sha256) so we can restore it byte-for-byte.
  const existedBefore = existsSync(STATE_JSON);
  let originalContent = null;
  let originalSha = null;
  if (existedBefore) {
    try {
      originalContent = readFileSync(STATE_JSON);
      originalSha = createHash('sha256').update(originalContent).digest('hex');
    } catch (err) {
      record(
        'filesystem',
        false,
        `read ${STATE_JSON} failed: ${err && err.message ? err.message : err}`,
        'fix file permissions on .memory-studio/state.json and rerun.'
      );
      return;
    }
  }

  // Write a minimal valid JSON test marker.
  const testMarker = JSON.stringify({ schemaVersion: 3, _verifyEnvTest: true }, null, 2) + '\n';
  try {
    writeFileSync(STATE_JSON, testMarker, 'utf8');
  } catch (err) {
    record(
      'filesystem',
      false,
      `write ${STATE_JSON} failed: ${err && err.message ? err.message : err}`,
      'fix filesystem permissions on .memory-studio/ (the loop needs write access to persist state).'
    );
    return;
  }

  // Read back and parse — roundtrip OK only if JSON.parse succeeds.
  let roundtripOk = false;
  try {
    const readBack = readFileSync(STATE_JSON, 'utf8');
    const parsed = JSON.parse(readBack);
    roundtripOk = parsed && parsed._verifyEnvTest === true;
  } catch (err) {
    // Restore before reporting failure.
    restoreOriginal(originalContent, existedBefore);
    record(
      'filesystem',
      false,
      `read-back / parse failed: ${err && err.message ? err.message : err}`,
      'filesystem write succeeded but read-back is corrupt — check disk health and rerun.'
    );
    return;
  }

  // Restore original content (or remove marker if no prior file).
  const restored = restoreOriginal(originalContent, existedBefore);

  // Verify restoration actually produced the original sha256 (when there was one).
  let preserved = true;
  if (existedBefore) {
    try {
      const afterContent = readFileSync(STATE_JSON);
      const afterSha = createHash('sha256').update(afterContent).digest('hex');
      preserved = afterSha === originalSha;
    } catch {
      preserved = false;
    }
  }

  const ok = roundtripOk && restored && preserved;
  const observedParts = [];
  observedParts.push(roundtripOk ? 'roundtrip OK' : 'roundtrip FAILED');
  observedParts.push(restored ? 'restored' : 'restore FAILED');
  if (existedBefore) observedParts.push(`original sha256 ${originalSha.slice(0, 12)}... preserved`);
  else observedParts.push('no prior file (marker removed)');
  record(
    'filesystem',
    ok,
    observedParts.join(', '),
    ok ? null : 'state.json preservation failed — investigate write/read race or filesystem buffering.'
  );
}

function restoreOriginal(originalContent, existedBefore) {
  try {
    if (existedBefore && originalContent !== null) {
      writeFileSync(STATE_JSON, originalContent);
    } else {
      // No original — remove the test marker so we leave nothing behind.
      try {
        writeFileSync(STATE_JSON, '');
      } catch {
        // best-effort
      }
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

async function runChecks() {
  // Try to run each check independently so one failure doesn't short-circuit
  // the report. Stubs throw intentionally; caught and recorded here.
  const runners = [
    checkNodeVersion,
    checkOnnxRuntimeNode,
    checkFts5,
    checkSqliteVec,
    checkEmbedding,
    checkFilesystem,
  ];
  for (const run of runners) {
    try {
      await run();
    } catch (err) {
      // Stubs throw to surface unimplemented state; record() already emitted a [FAIL] line.
      // We swallow the error so subsequent checks still run.
      void err;
    }
  }

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`${passed}/${total} checks passed`);

  // Exit non-zero unless all pass. AC-1 + AC-7.
  if (passed !== total) {
    process.exitCode = 1;
  }
}

runChecks().catch((err) => {
  console.error('verify-env: unhandled error', err);
  process.exit(2);
});