#!/usr/bin/env node
/**
 * scripts/snapshot-metrics.mjs — Phase 7b T-06 (snapshot collector).
 *
 * Captures an immutable, redacted snapshot of the live `/metrics`
 * endpoint + complete audit aggregate + state thresholds, and
 * writes it atomically to `.specs/acceptance/snapshots/<ISO>.json`.
 *
 * Required explicit flags (no defaulting to "real"):
 *   --url <metrics-base>     e.g. http://127.0.0.1:42900
 *   --state <path>           path to .memory-studio/state.json
 *   --db <path>              path to the catalog SQLite DB (for direct
 *                            complete audit aggregation — preferred)
 *   --out-dir <path>         output directory for snapshots
 *   --source <real|synthetic>  REQUIRED. Never defaults.
 *   --provider-mode <mode>   REQUIRED. 'anthropic-real' or 'anthropic-stub'.
 *   --fast-agent-mode <mode> REQUIRED. 'real' or 'stub'.
 *   --runtime-mode <mode>    REQUIRED. 'production' or 'stub'.
 *
 * Safety:
 *   - Never logs credentials, raw prompts/responses, or raw session IDs.
 *   - Atomic temp+rename write. Existing files are never overwritten.
 *   - Forbidden-field scan before rename (raw content / credential keys).
 *   - Network errors / non-200 / malformed JSON exit non-zero without
 *     leaving a final artifact.
 *   - Captures hashes of evidence inputs for the final report.
 */
import { readFile, writeFile, rename, access } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { canonicalJsonStringify } from '../src/server/augment/byte-string.ts';

const USAGE = `Usage: snapshot-metrics.mjs \\
  --url <metrics-base> \\
  --state <path> \\
  --db <path> \\
  --out-dir <path> \\
  --source <real|synthetic> \\
  --provider-mode <anthropic-real|anthropic-stub> \\
  --fast-agent-mode <real|stub> \\
  --runtime-mode <production|stub>

Required (no defaults for source/modes to prevent silent mislabeling):
  --source, --provider-mode, --fast-agent-mode, --runtime-mode

Output: <out-dir>/<ISO-UTC-safe-timestamp>.json (atomic temp+rename)
`;

const FORBIDDEN_KEYS = [
  'prompt', 'response', 'raw_content', 'authorization', 'x-api-key',
  'api_key', 'apikey', 'password', 'secret', 'token', 'credential',
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--url') { opts.url = argv[++i]; continue; }
    if (a === '--state') { opts.state = argv[++i]; continue; }
    if (a === '--db') { opts.db = argv[++i]; continue; }
    if (a === '--out-dir') { opts.outDir = argv[++i]; continue; }
    if (a === '--source') { opts.source = argv[++i]; continue; }
    if (a === '--provider-mode') { opts.providerMode = argv[++i]; continue; }
    if (a === '--fast-agent-mode') { opts.fastAgentMode = argv[++i]; continue; }
    if (a === '--runtime-mode') { opts.runtimeMode = argv[++i]; continue; }
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE); process.exit(0); }
    throw new Error(`unknown argument: ${a}`);
  }
  const required = ['url', 'state', 'db', 'outDir', 'source', 'providerMode', 'fastAgentMode', 'runtimeMode'];
  for (const k of required) {
    if (opts[k] === undefined) throw new Error(`--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required`);
  }
  if (opts.source !== 'real' && opts.source !== 'synthetic') {
    throw new Error(`--source must be 'real' or 'synthetic', got '${opts.source}'`);
  }
  if (opts.runtimeMode !== 'production' && opts.runtimeMode !== 'stub') {
    throw new Error(`--runtime-mode must be 'production' or 'stub', got '${opts.runtimeMode}'`);
  }
  if (opts.fastAgentMode !== 'real' && opts.fastAgentMode !== 'stub') {
    throw new Error(`--fast-agent-mode must be 'real' or 'stub', got '${opts.fastAgentMode}'`);
  }
  if (!opts.providerMode.startsWith('anthropic-')) {
    throw new Error(`--provider-mode must start with 'anthropic-', got '${opts.providerMode}'`);
  }
  return opts;
}

function logErr(msg) { process.stderr.write(`[snapshot-metrics] ${msg}\n`); }
function logOut(msg) { process.stdout.write(`[snapshot-metrics] ${msg}\n`); }

function safeTimestamp(d) {
  return d.toISOString().replace(/[:.]/g, '-');
}

function scanForForbiddenFields(obj, path = '$') {
  if (obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return [];
  const hits = [];
  for (const [k, v] of Object.entries(obj)) {
    const lowerK = k.toLowerCase();
    if (FORBIDDEN_KEYS.some((fk) => lowerK.includes(fk))) {
      hits.push(`${path}.${k}`);
    }
    if (typeof v === 'object' && v !== null) {
      hits.push(...scanForForbiddenFields(v, `${path}.${k}`));
    }
  }
  return hits;
}

async function fetchJson(url) {
  const res = await fetch(url, { method: 'GET' });
  if (res.status !== 200) {
    throw new Error(`GET ${url} returned ${res.status}`);
  }
  return res.json();
}

async function aggregateAudit(dbPath) {
  // Direct SQLite aggregation. Required for complete audit (R-8).
  const db = new Database(dbPath, { readonly: true });
  try {
    const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit').get()?.n ?? 0;
    if (auditCount === 0) {
      return { complete: true, first_event_ts: 0, last_event_ts: 0, turns_by_session_hash: {} };
    }
    // Per hashed session, count distinct turn events (one per audit row).
    const sessionRows = db.prepare(
      `SELECT json_extract(fingerprint, '$.sessionId') AS sid, COUNT(*) AS turns
       FROM audit
       WHERE event_type IN ('augment_request', 'messages_proxy')
       GROUP BY sid`
    ).all();
    const turnsBySession = {};
    for (const r of sessionRows) {
      if (typeof r.sid === 'string' && r.sid.length > 0) {
        turnsBySession[r.sid] = r.turns;
      }
    }
    const tsRange = db.prepare(
      'SELECT MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM audit'
    ).get();
    return {
      complete: true,
      first_event_ts: tsRange?.first_ts ?? 0,
      last_event_ts: tsRange?.last_ts ?? 0,
      turns_by_session_hash: turnsBySession,
    };
  } finally {
    db.close();
  }
}

function hashObject(obj) {
  return createHash('sha256').update(canonicalJsonStringify(obj), 'utf8').digest('hex');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = resolve(process.cwd(), opts.outDir);
  await mkdir(outDir, { recursive: true });
  // Fetch /metrics
  const metricsUrl = `${opts.url.replace(/\/$/, '')}/metrics`;
  let metrics;
  try {
    metrics = await fetchJson(metricsUrl);
  } catch (err) {
    logErr(`metrics fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  // Validate metrics shape
  if (typeof metrics !== 'object' || metrics === null) {
    logErr('metrics response is not a JSON object');
    process.exit(1);
  }
  if (metrics.schema_version !== 2) {
    logErr(`metrics schema_version must be 2 (Phase 7b T-04), got ${metrics.schema_version}`);
    process.exit(1);
  }
  if (!metrics.evidence || typeof metrics.evidence !== 'object') {
    logErr('metrics response missing evidence block');
    process.exit(1);
  }
  // Read state
  const statePath = resolve(process.cwd(), opts.state);
  let state;
  try {
    const raw = await readFile(statePath, 'utf8');
    state = JSON.parse(raw);
  } catch (err) {
    logErr(`state read failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  if (state?.thresholds?.minCosineSimilarity === undefined || state?.thresholds?.minFtsHits === undefined) {
    logErr('state.json missing thresholds');
    process.exit(1);
  }
  // Aggregate audit
  let audit;
  try {
    audit = await aggregateAudit(opts.db);
  } catch (err) {
    logErr(`audit aggregate failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const now = new Date();
  const snapshot = {
    schema_version: 1,
    captured_at: now.toISOString(),
    source: opts.source,
    provider_mode: opts.providerMode,
    fast_agent_mode: opts.fastAgentMode,
    runtime_mode: opts.runtimeMode,
    metrics_url: metricsUrl,
    thresholds: {
      minCosineSimilarity: state.thresholds.minCosineSimilarity,
      minFtsHits: state.thresholds.minFtsHits,
    },
    metrics: {
      p50_latency_ms: metrics.p50_latency_ms ?? null,
      p99_latency_ms: metrics.p99_latency_ms ?? null,
      working_set_mb: metrics.working_set_mb,
      evidence: metrics.evidence,
    },
    audit,
  };
  // Forbidden-field scan
  const hits = scanForForbiddenFields(snapshot);
  if (hits.length > 0) {
    logErr(`forbidden field(s) detected: ${hits.join(', ')}; refusing to write`);
    process.exit(1);
  }
  // Evidence hashes (input set manifest)
  const evidenceHashes = {
    metrics: hashObject(metrics),
    state: hashObject(state.thresholds),
    audit: hashObject(audit),
  };
  const body = {
    ...snapshot,
    evidence_hashes: evidenceHashes,
  };
  // Atomic temp + rename
  const ts = safeTimestamp(now);
  const finalPath = join(outDir, `${ts}.json`);
  try {
    await access(finalPath);
    logErr(`refusing to overwrite existing snapshot: ${finalPath}`);
    process.exit(1);
  } catch {
    // file does not exist — proceed
  }
  const tempPath = `${finalPath}.tmp.${process.pid}`;
  try {
    await writeFile(tempPath, JSON.stringify(body, null, 2), 'utf8');
    await rename(tempPath, finalPath);
  } catch (err) {
    logErr(`write failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  logOut(`wrote ${finalPath} (source=${opts.source}, runtime=${opts.runtimeMode})`);
  process.exit(0);
}

main().catch((err) => {
  logErr(`crashed: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n');
  process.exit(2);
});
