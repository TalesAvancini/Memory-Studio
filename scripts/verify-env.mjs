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
  record('onnxruntime-node', false, 'TODO: implemented in T-03', 'placeholder — replaced in T-03');
  throw new Error('TODO: onnxruntime-node check not yet implemented (T-03)');
}

function checkFts5() {
  record('fts5', false, 'TODO: implemented in T-02', 'placeholder — replaced in T-02');
  throw new Error('TODO: fts5 check not yet implemented (T-02)');
}

function checkSqliteVec() {
  record('sqlite-vec', false, 'TODO: implemented in T-02', 'placeholder — replaced in T-02');
  throw new Error('TODO: sqlite-vec check not yet implemented (T-02)');
}

function checkEmbedding() {
  record('embedding', false, 'TODO: implemented in T-05', 'placeholder — replaced in T-05');
  throw new Error('TODO: embedding check not yet implemented (T-05)');
}

function checkFilesystem() {
  record('filesystem', false, 'TODO: implemented in T-04', 'placeholder — replaced in T-04');
  throw new Error('TODO: filesystem check not yet implemented (T-04)');
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