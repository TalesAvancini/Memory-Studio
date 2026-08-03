#!/usr/bin/env node
/**
 * scripts/acceptance-gate.mjs — Phase 7b T-05 (CLI wrapper for the
 * typed acceptance evaluator).
 *
 * Usage:
 *
 *   # Production mode (no synthetic evidence accepted):
 *   node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
 *     --snapshots .specs/acceptance/snapshots \
 *     --state .memory-studio/state.json
 *
 *   # Synthetic mode (test-only; always reports
 *   # `eligible_for_phase_closure: false`):
 *   node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
 *     --snapshots .specs/acceptance/snapshots \
 *     --state .memory-studio/state.json \
 *     --allow-synthetic
 *
 *   # Generate the dated Markdown report (only when the gate
 *   # is eligible for closure; refuses otherwise):
 *   node --experimental-strip-types --no-warnings scripts/acceptance-gate.mjs \
 *     --snapshots .specs/acceptance/snapshots \
 *     --state .memory-studio/state.json \
 *     --out .specs/features/phase-7b-acceptance-gate/acceptance-2026-08-09.md
 *
 * Exit code: 0 only when every R-9 / R-10 / R-11 criterion passes
 * AND production mode (synthetic rejected). Otherwise non-zero with
 * the list of failing criterion IDs printed to stderr.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import {
  evaluateAcceptance,
  parseAcceptanceSnapshot,
  renderAcceptanceReport,
  loadRuntimeSnapshotFromPath,
  AcceptanceSnapshotValidationError,
} from '../src/server/acceptance/acceptance-report.ts';

const USAGE = `Usage: acceptance-gate.mjs --snapshots <dir> --state <path> [--allow-synthetic] [--out <path>]

Options:
  --snapshots <dir>     Directory of *.json snapshot files
  --state <path>        Path to .memory-studio/state.json
  --allow-synthetic     Test-only: accept synthetic / stub evidence.
                        ALWAYS reports eligible_for_phase_closure=false.
  --out <path>          Write the dated Markdown report to <path>.
                        Refuses to write when eligible_for_phase_closure=false.
  --evaluation-date <iso>  Override the evaluation date (ISO 8601). Default: now.
  --json                Emit a JSON evaluation object on stdout (for tooling).
`;

function parseArgs(argv) {
  const opts = {
    snapshots: null,
    state: null,
    allowSynthetic: false,
    out: null,
    evaluationDate: Date.now(),
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--snapshots') { opts.snapshots = argv[++i]; continue; }
    if (arg === '--state') { opts.state = argv[++i]; continue; }
    if (arg === '--allow-synthetic') { opts.allowSynthetic = true; continue; }
    if (arg === '--out') { opts.out = argv[++i]; continue; }
    if (arg === '--evaluation-date') { opts.evaluationDate = Date.parse(argv[++i]); continue; }
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '-h' || arg === '--help') { process.stdout.write(USAGE); process.exit(0); }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (opts.snapshots === null) throw new Error('--snapshots is required');
  if (opts.state === null) throw new Error('--state is required');
  return opts;
}

async function loadSnapshots(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { snapshots: [], errors: [] };
    }
    throw err;
  }
  const snapshots = [];
  const errors = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const path = join(dir, entry);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw);
      snapshots.push(parseAcceptanceSnapshot(parsed));
    } catch (err) {
      errors.push({ file: path, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }
  return { snapshots, errors };
}

function logErr(msg) { process.stderr.write(`[acceptance-gate] ${msg}\n`); }
function logOut(msg) { process.stdout.write(`[acceptance-gate] ${msg}\n`); }

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.evaluationDate)) {
    logErr(`invalid --evaluation-date: ${opts.evaluationDate}`);
    process.exit(2);
  }
  const { snapshots, errors } = await loadSnapshots(opts.snapshots);
  if (errors.length > 0) {
    for (const e of errors) logErr(`parse failed: ${e.file} → ${e.error.message}`);
  }
  if (snapshots.length === 0 && errors.length > 0) {
    logErr('no valid snapshots found; exiting non-zero');
    process.exit(1);
  }
  const statePath = resolve(process.cwd(), opts.state);
  const state = await loadRuntimeSnapshotFromPath(statePath, opts.evaluationDate);
  const evaluation = evaluateAcceptance({
    snapshots,
    state,
    allowSynthetic: opts.allowSynthetic,
    evaluationDate: opts.evaluationDate,
  });

  if (opts.json) {
    // When --json is set, emit ONLY the evaluation object so callers
    // can pipe stdout to JSON.parse without text contamination.
    process.stdout.write(JSON.stringify(evaluation, null, 2) + '\n');
  } else {
    printSummary(evaluation);
  }

  if (opts.out !== null) {
    if (!evaluation.eligible_for_phase_closure) {
      logErr(`refusing to write --out ${opts.out} because eligible_for_phase_closure=false`);
      process.exit(1);
    }
    const { writeFile } = await import('node:fs/promises');
    const outPath = resolve(process.cwd(), opts.out);
    const body = renderAcceptanceReport(evaluation, { generationTimestamp: opts.evaluationDate });
    await writeFile(outPath, body, 'utf8');
    logOut(`wrote report: ${outPath}`);
  }

  if (!opts.allowSynthetic) {
    if (evaluation.verdict !== 'PASS') {
      const failing = evaluation.criteria.filter((c) => !c.passed).map((c) => c.id);
      logErr(`verdict=${evaluation.verdict}; failing criteria: ${failing.join(', ') || '(none — incomplete evidence)'}`);
      process.exit(1);
    }
    if (!evaluation.eligible_for_phase_closure) {
      logErr('verdict=PASS but eligible_for_phase_closure=false (synthetic evidence present)');
      process.exit(1);
    }
  } else {
    // --allow-synthetic mode (test-only): the gate runs the machinery
    // and reports the verdict / eligible_for_phase_closure. The smoke
    // is expected to exit 0 because the machinery works — the verdict
    // is INCOMPLETE for short test runs and the closure is always
    // false under --allow-synthetic.
    if (evaluation.eligible_for_phase_closure) {
      logErr('--allow-synthetic produced eligible_for_phase_closure=true (unexpected; this should always be false)');
      process.exit(1);
    }
  }
  process.exit(0);
}

function printSummary(eval_) {
  logOut(`verdict: ${eval_.verdict}`);
  logOut(`eligible_for_phase_closure: ${eval_.eligible_for_phase_closure}`);
  logOut(`snapshots: ${eval_.evidence_hashes.length} eligible, ${eval_.ignored_synthetic_files.length} ignored`);
  logOut(`session coverage: span=${(eval_.session_coverage.span_ms / 86_400_000).toFixed(2)}d, sessions=${eval_.session_coverage.qualifying_sessions}, turns=${eval_.session_coverage.qualifying_turns}`);
  logOut(`budgets: hit_rate=${fmt(eval_.budgets.request_hit_rate)}, cache_coverage=${fmt(eval_.budgets.token_cache_coverage)}, worst_p50=${fmtMs(eval_.budgets.worst_p50_latency_ms)}, worst_p99=${fmtMs(eval_.budgets.worst_p99_latency_ms)}, max_working_set=${fmtMb(eval_.budgets.max_working_set_mb)}`);
  logOut(`tuning: ${eval_.tuning_recommendation.action} — ${eval_.tuning_recommendation.reason}`);
  for (const c of eval_.criteria) {
    logOut(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.id}: ${c.description} (observed=${c.observed}; threshold=${c.threshold})`);
  }
}

function fmt(v) { return v === null ? 'null' : v.toFixed(4); }
function fmtMs(v) { return v === null ? 'null' : `${v}ms`; }
function fmtMb(v) { return v === null ? 'null' : `${v}MB`; }

main().catch((err) => {
  logErr(`crashed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(2);
});
