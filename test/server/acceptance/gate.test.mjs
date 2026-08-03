/**
 * Phase 7b T-05 — acceptance gate CLI tests.
 * @date 2026-08-03
 * @version 1
 *
 * Exercises scripts/acceptance-gate.mjs end-to-end:
 *   - production mode rejects synthetic evidence
 *   - --allow-synthetic accepts but reports closure=false
 *   - --out refuses to write when not eligible
 *   - empty input dir exits non-zero (INCOMPLETE)
 *   - --json outputs the evaluation object
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const GATE_PATH = join(REPO_ROOT, 'scripts', 'acceptance-gate.mjs');
const STATE_PATH = join(REPO_ROOT, '.memory-studio', 'state.json');

function makeSnapshot({
  capturedAt = '2026-08-08T00:00:00.000Z',
  source = 'real',
  providerMode = 'anthropic-real',
  fastAgentMode = 'real',
  runtimeMode = 'production',
  auditComplete = true,
  matched = 75,
  attempted = 100,
  cacheHit = 65,
  proxy = 100,
  firstEventTs = Date.parse('2026-08-01T00:00:00.000Z'),
  lastEventTs = Date.parse('2026-08-08T00:00:00.000Z'),
  turns = 5,
  turnsPerSession = 10,
  p50 = 30,
  p99 = 150,
  workingSetMb = 800,
} = {}) {
  const turnsBySession = {};
  for (let i = 0; i < turns; i += 1) {
    turnsBySession[`session_${i.toString().padStart(2, '0')}`] = turnsPerSession;
  }
  return {
    schema_version: 1,
    captured_at: capturedAt,
    source,
    provider_mode: providerMode,
    fast_agent_mode: fastAgentMode,
    runtime_mode: runtimeMode,
    metrics_url: 'http://127.0.0.1:42900/metrics',
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
    metrics: {
      p50_latency_ms: p50,
      p99_latency_ms: p99,
      working_set_mb: workingSetMb,
      evidence: {
        matched_requests: matched,
        attempted_requests: attempted,
        cache_hit_requests: cacheHit,
        proxy_requests: proxy,
        latency_sample_count: 100,
        process_started_at: Date.parse('2026-08-01T00:00:00.000Z'),
      },
    },
    audit: {
      complete: auditComplete,
      first_event_ts: firstEventTs,
      last_event_ts: lastEventTs,
      turns_by_session_hash: turnsBySession,
    },
  };
}

function makeSnapshotsSet() {
  // Use dates in the past relative to "today" (the evaluator date is
  // 2026-08-03 per the system context). End the last snapshot 1 day
  // before today so the future-clock check passes.
  const endTs = Date.parse('2026-08-02T00:00:00.000Z');
  const SEVEN = 7 * 24 * 60 * 60 * 1000;
  const startTs = endTs - SEVEN;
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const ts = startTs + Math.floor(SEVEN * (i / 6));
    const factor = (i + 1) / 7;
    out.push(makeSnapshot({
      capturedAt: new Date(ts).toISOString(),
      matched: Math.round(75 * factor),
      attempted: Math.round(100 * factor),
      cacheHit: Math.round(65 * factor),
      proxy: Math.round(100 * factor),
      firstEventTs: i === 0 ? startTs : startTs + i * 60_000,
      lastEventTs: ts,
    }));
  }
  return out;
}

async function runGate(args) {
  return spawnSync(process.execPath, [
    '--experimental-strip-types', '--no-warnings',
    GATE_PATH, ...args,
  ], { encoding: 'utf8' });
}

test('gate: empty snapshot dir exits non-zero (INCOMPLETE)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-empty-'));
  try {
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH]);
    assert.equal(res.status, 1, 'gate must exit 1 for INCOMPLETE');
    assert.match(res.stdout + res.stderr, /INCOMPLETE/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: production mode rejects synthetic snapshots (INCOMPLETE)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-synth-'));
  try {
    const synth = makeSnapshot({ source: 'synthetic' });
    await writeFile(join(dir, 'synth-1.json'), JSON.stringify(synth));
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH]);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /INCOMPLETE/);
    assert.match(res.stdout + res.stderr, /0 eligible/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: --allow-synthetic accepts synthetic and reports eligible_for_phase_closure=false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-allow-'));
  try {
    for (let i = 0; i < makeSnapshotsSet().length; i += 1) {
      const s = makeSnapshotsSet()[i];
      // Use a Windows-safe filename (no colons).
      const safe = `snap-${i.toString().padStart(3, '0')}.json`;
      await writeFile(join(dir, safe), JSON.stringify({ ...s, source: 'synthetic' }));
    }
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH, '--allow-synthetic', '--json']);
    assert.equal(res.status, 0, 'allow-synthetic + machinery works → exit 0');
    const eval_ = JSON.parse(res.stdout);
    assert.equal(eval_.eligible_for_phase_closure, false);
    assert.equal(eval_.ignored_synthetic_files.length, 0, 'synthetic accepted under --allow-synthetic');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: passing real evidence yields verdict=PASS and closure=true', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-pass-'));
  try {
    const set = makeSnapshotsSet();
    for (let i = 0; i < set.length; i += 1) {
      const safe = `snap-${i.toString().padStart(3, '0')}.json`;
      await writeFile(join(dir, safe), JSON.stringify(set[i]));
    }
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH]);
    assert.equal(res.status, 0, 'PASS verdict → exit 0');
    assert.match(res.stdout + res.stderr, /verdict: PASS/);
    assert.match(res.stdout + res.stderr, /eligible_for_phase_closure: true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: --out refuses to write when not eligible for closure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-out-'));
  try {
    const synth = makeSnapshot({ source: 'synthetic' });
    await writeFile(join(dir, 'synth-1.json'), JSON.stringify(synth));
    const outPath = join(dir, 'report.md');
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH, '--out', outPath, '--allow-synthetic']);
    assert.equal(res.status, 1, 'refused write → exit 1');
    assert.match(res.stderr, /refusing to write/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: --json output is a parseable AcceptanceEvaluation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-json-'));
  try {
    const set = makeSnapshotsSet();
    for (let i = 0; i < set.length; i += 1) {
      const safe = `snap-${i.toString().padStart(3, '0')}.json`;
      await writeFile(join(dir, safe), JSON.stringify(set[i]));
    }
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH, '--json']);
    assert.equal(res.status, 0);
    const eval_ = JSON.parse(res.stdout);
    assert.equal(eval_.verdict, 'PASS');
    assert.equal(eval_.eligible_for_phase_closure, true);
    assert.ok(Array.isArray(eval_.criteria));
    assert.ok(eval_.criteria.every((c) => c.passed));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('gate: malformed snapshot file does not crash; counted as parse error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gate-malformed-'));
  try {
    await writeFile(join(dir, 'bad.json'), '{"not": "a snapshot"}');
    const res = await runGate(['--snapshots', dir, '--state', STATE_PATH]);
    assert.notEqual(res.status, 0, 'malformed input → non-zero exit');
    assert.match(res.stderr, /parse failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
