/**
 * Phase 6a — Hot Path Overhead POC (T-01 scaffold + T-02..T-04 measurements)
 *
 * Source spec: `.specs/features/phase-6a-poc-validation/spec.md`
 * Source tasks: `.specs/features/phase-6a-poc-validation/tasks.md`
 *
 * Measures the incremental hot-path overhead of inception híbrida
 * (Phase 6b's three new hot-path operations):
 *
 *   1. `sqlite.get(intel)` — read intel row from a real :memory: SQLite DB
 *   2. `concat(intel + prompt)` — pure string concatenation
 *   3. `template render` — build the 2-block `cache_control: ephemeral`
 *      system message with the intel literal appended to Block 2's
 *      variable suffix (inline extension of Phase 5a.2's
 *      `buildSystemMessage()` — does NOT modify `BuildOptions`).
 *
 * Statistical discipline (matches Phase 5a.4 `perf.test.mjs`):
 *   - N=10 amostras per component
 *   - 5 warmup calls per component (excluded from measurement)
 *   - p95 is the gating metric
 *   - min / median / p95 / max reported per component
 *
 * Scope guard:
 *   - No production code is touched.
 *   - ONNX runtime is excluded via a stub embedder (cached 384d
 *     Float32Array), per Phase 5a.4 R-13 / T-12 pattern.
 *   - Increment is measured against a no-op baseline (A-6).
 *
 * Run:
 *   node --experimental-strip-types --no-warnings scripts/poc-6a-hot-path.mjs
 *
 * Exit code:
 *   0 on PASS (all components under budget + total < 10ms)
 *   1 on FAIL (with adjustment recommendation)
 */

import { performance } from 'node:perf_hooks';
import { createServer, resetServerMetadataForTests } from '../src/server/index.ts';
import { setAugmentPipelineProvider } from '../src/server/augment.ts';
import { EMBEDDING_DIMENSIONS } from '../src/catalog/embedder/index.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../src/search/types.ts';
import { initializeSearchStorage } from '../src/search/schema.ts';
import Database from 'better-sqlite3';

// --- Constants (per tasks.md T-01) -----------------------------------------

const AMOSTRAS = 10;
const WARMUP_COUNT = 5;
// Distinct port range from Phase 5a.4 ([43900, 43999]) and default
// augment range ([42900, 43000]) to avoid collisions on parallel runs.
const PORT_RANGE = [44_000, 44_099];

// Per-component budgets (PRD §16.7).
const BUDGET_SQLITE_GET_MS = 5;
const BUDGET_CONCAT_MS = 1;
const BUDGET_TEMPLATE_MS = 1;
const BUDGET_TOTAL_MS = 10;

// --- Fixtures (matches Phase 5a.4 BASE_PROMPT) ------------------------------

const FIXTURE_INTEL = {
  agentState: 'poc-6a-fixture-agent-state',
  nextNeeds: ['fixture-need-a', 'fixture-need-b'],
  recentTopic: 'poc-6a-fixture-recent-topic',
};

const FIXTURE_PROMPT =
  'design a fastify endpoint that validates authentication tokens securely';

const FIXTURE_SKILLS = [
  'auth-jwt-validation',
  'auth-oauth-handler',
  'auth-session-cookie',
];

const FIXTURE_PERSONA = 'persona-senior-engineer';

const FIXTURE_ROWS = [
  {
    slug: 'auth-jwt-validation',
    kind: 'skill',
    content: 'design a fastify endpoint that validates JWT tokens using the jose library',
  },
  {
    slug: 'auth-oauth-handler',
    kind: 'skill',
    content: 'implement an OAuth 2 authorization-code handler with PKCE',
  },
  {
    slug: 'auth-session-cookie',
    kind: 'skill',
    content: 'set HttpOnly SameSite session cookies for authenticated routes',
  },
  {
    slug: 'rule-no-secrets-in-prompts',
    kind: 'rule',
    content: 'never include raw API keys, passwords, or tokens in prompts',
  },
  {
    slug: 'persona-senior-engineer',
    kind: 'persona',
    content: 'respond as a senior engineer — pragmatic, terse, focused on the requested artifact',
  },
];

// --- Statistics helpers (copy from test/augment/perf.test.mjs:217-264) ------

function sorted(arr) {
  return arr.slice().sort((a, b) => a - b);
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedArr.length)),
  );
  return sortedArr[idx];
}

function summarizeRound(latencies) {
  const s = sorted(latencies);
  return {
    min: s[0] ?? 0,
    median: percentile(s, 50),
    p95: percentile(s, 95),
    max: s[s.length - 1] ?? 0,
    n: s.length,
  };
}

function r2(n) {
  return Math.round(n * 100) / 100;
}

// --- Component 1 stub: sqlite.get(intel) (T-02) -----------------------------

function freshSeededIntelDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS intel (
      session_id TEXT PRIMARY KEY,
      agent_state TEXT NOT NULL DEFAULT '',
      next_needs TEXT NOT NULL DEFAULT '[]',
      recent_topic TEXT NOT NULL DEFAULT '',
      ts INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    'INSERT INTO intel (session_id, agent_state, next_needs, recent_topic, ts) VALUES (?, ?, ?, ?, ?)',
  );
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const sessionId = `poc-6a-session-${String(i).padStart(3, '0')}`;
    insert.run(
      sessionId,
      `agent-state-${i}`,
      JSON.stringify([`need-${i}-a`, `need-${i}-b`]),
      `recent-topic-${i}`,
      1_700_000_000 + i,
    );
  }
  return db;
}

function measureSqliteGet() {
  const db = freshSeededIntelDb();
  const stmt = db.prepare('SELECT * FROM intel WHERE session_id = ?');

  // Warmup
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    const sessionId = `poc-6a-session-${String(i % AMOSTRAS).padStart(3, '0')}`;
    stmt.get(sessionId);
  }

  // Measurement
  const latencies = [];
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const sessionId = `poc-6a-session-${String(i).padStart(3, '0')}`;
    const t0 = performance.now();
    const row = stmt.get(sessionId);
    // Deserialize JSON nextNeeds (this is part of the read cost).
    const intel = {
      agentState: row.agent_state,
      nextNeeds: JSON.parse(row.next_needs),
      recentTopic: row.recent_topic,
    };
    const t1 = performance.now();
    latencies.push(t1 - t0);
  }

  db.close();
  return summarizeRound(latencies);
}

// --- Component 2 stub: concat(intel + prompt) (T-03) ------------------------

function measureConcat() {
  const intel = FIXTURE_INTEL;
  const prompt = FIXTURE_PROMPT;

  // Warmup
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    const _ = `## Intel\n${intel.agentState}\n\n## NextNeeds\n${intel.nextNeeds.join(', ')}\n\n## RecentTopic\n${intel.recentTopic}\n\n## Prompt\n${prompt}`;
    void _;
  }

  // Measurement
  const latencies = [];
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const t0 = performance.now();
    const concatText = `## Intel\n${intel.agentState}\n\n## NextNeeds\n${intel.nextNeeds.join(', ')}\n\n## RecentTopic\n${intel.recentTopic}\n\n## Prompt\n${prompt}`;
    const t1 = performance.now();
    latencies.push(t1 - t0);
    void concatText;
  }
  return summarizeRound(latencies);
}

// --- Component 3 stub: template render (T-03) -------------------------------
//
// Inline extension of Phase 5a.2's `buildSystemMessage()` that adds an
// `## Intel` section to Block 2's variable suffix. Phase 6b will add
// `intel?: Intel` to `BuildOptions` formally; Phase 6a uses this local
// helper to avoid touching the locked layer.

function stubMatched() {
  // Three skills + persona — matches Phase 5a.4 fixture corpus
  const skills = FIXTURE_SKILLS.map((slug) => ({
    slug,
    kind: 'skill',
    text: FIXTURE_ROWS.find((r) => r.slug === slug).content,
    rrfScore: 0.5,
  }));
  const personas = [
    {
      slug: FIXTURE_PERSONA,
      kind: 'persona',
      text: FIXTURE_ROWS.find((r) => r.slug === FIXTURE_PERSONA).content,
      rrfScore: 0.5,
    },
  ];
  return [...skills, ...personas];
}

function buildVariableSuffixWithIntel(matched, intel) {
  const sections = [];
  const skills = matched.filter((m) => m.kind === 'skill');
  if (skills.length > 0) {
    sections.push('## Skills\n' + skills.map((s) => s.text).join('\n\n'));
  }
  if (intel) {
    sections.push(
      '## Intel\n' +
        `agentState: ${intel.agentState}\n` +
        `nextNeeds: ${intel.nextNeeds.join(', ')}\n` +
        `recentTopic: ${intel.recentTopic}`,
    );
  }
  return sections.join('\n\n');
}

function templateRenderWithIntel(matched, intel) {
  const personas = matched.filter((m) => m.kind === 'persona');
  const block1Text = personas.map((p) => p.text).join('\n\n');
  const block2Text = buildVariableSuffixWithIntel(matched, intel);
  // Inline two-block structure (mirrors Phase 5a.2's output).
  // We don't call canonicalSha256 here because the cost being measured
  // is the template construction, not the hash. The byte-string
  // equality test (T-09) covers the hash dimension separately.
  return [
    { type: 'text', text: block1Text, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: block2Text, cache_control: { type: 'ephemeral' } },
  ];
}

function measureTemplateRender() {
  const matched = stubMatched();
  const intel = FIXTURE_INTEL;

  // Warmup
  for (let i = 0; i < WARMUP_COUNT; i += 1) {
    const _ = templateRenderWithIntel(matched, intel);
    void _;
  }

  // Measurement
  const latencies = [];
  for (let i = 0; i < AMOSTRAS; i += 1) {
    const t0 = performance.now();
    const blocks = templateRenderWithIntel(matched, intel);
    const t1 = performance.now();
    latencies.push(t1 - t0);
    void blocks;
  }
  return summarizeRound(latencies);
}

// --- Server boot (unused in T-01; placeholder for T-02+ in-process flow) ---
//
// Phase 5a.4 boot pattern — kept for parity. Phase 6a measures the 3
// operations directly (no app.inject) because the operations are
// independent of the full HTTP request lifecycle; we want the micro-cost
// of EACH operation, not the cost over the wire.

function freshSeededSkillsDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      content_yaml TEXT NOT NULL,
      embedding BLOB NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  try {
    initializeSearchStorage(db);
  } catch {
    // Vec extension may be unavailable; pipeline is fail-open.
  }
  const zeroEmbedding = (() => {
    const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  })();
  const insert = db.prepare(
    `INSERT INTO skills (slug, kind, content_yaml, embedding, hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
  );
  for (const row of FIXTURE_ROWS) {
    insert.run(row.slug, row.kind, row.content, zeroEmbedding, `h-${row.slug}`);
  }
  return db;
}

function stubProvider() {
  const db = freshSeededSkillsDb();
  const cachedVector = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS).fill(0.1);
  return {
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      async encode() {
        return new Float32Array(cachedVector);
      },
      async embed() {
        return new Float32Array(cachedVector);
      },
    },
  };
}

/**
 * Main orchestrator (T-04). Boots the server (in-process, no socket bind)
 * to validate the harness wires through the real pipeline, then runs the
 * 3 measurements.
 *
 * Per spec A-6 (incremental overhead), the 3 measurements are run as
 * standalone operations (not inside an `app.inject()`) so the per-call
 * cost is the micro-cost of the operation itself, not contaminated by
 * the full pipeline cost. The server boot is a sanity check that the
 * measurement harness initializes the same dependencies the production
 * pipeline would use.
 */
async function main() {
  // --- Sanity: boot server in-process (no socket bind needed) ----------
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  let handle = null;
  try {
    handle = await createServer({ portRange: PORT_RANGE });
  } catch (err) {
    console.error(
      `[hot-path] FAIL server boot error: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  try {
    // --- Component 1: sqlite.get(intel) (T-02) -------------------------
    const sqliteGet = measureSqliteGet();

    // --- Component 2: concat (T-03) ------------------------------------
    const concat = measureConcat();

    // --- Component 3: template render (T-03) ---------------------------
    const template = measureTemplateRender();

    // --- Total + verdict (T-04) -----------------------------------------
    const totalP95 = sqliteGet.p95 + concat.p95 + template.p95;
    const totalMedian = sqliteGet.median + concat.median + template.median;

    const sqlitePass = sqliteGet.p95 < BUDGET_SQLITE_GET_MS;
    const concatPass = concat.p95 < BUDGET_CONCAT_MS;
    const templatePass = template.p95 < BUDGET_TEMPLATE_MS;
    const totalPass = totalP95 < BUDGET_TOTAL_MS;
    const pass = sqlitePass && concatPass && templatePass && totalPass;

    const verdict = pass ? 'PASS' : 'FAIL';

    // --- Per-component breakdown ---------------------------------------
    console.log(
      `[hot-path]   sqlite.get: min=${r2(sqliteGet.min)}ms ` +
        `median=${r2(sqliteGet.median)}ms ` +
        `p95=${r2(sqliteGet.p95)}ms ` +
        `max=${r2(sqliteGet.max)}ms ` +
        `[budget < ${BUDGET_SQLITE_GET_MS}ms] ${sqlitePass ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `[hot-path]   concat:     min=${r2(concat.min)}ms ` +
        `median=${r2(concat.median)}ms ` +
        `p95=${r2(concat.p95)}ms ` +
        `max=${r2(concat.max)}ms ` +
        `[budget < ${BUDGET_CONCAT_MS}ms] ${concatPass ? 'PASS' : 'FAIL'}`,
    );
    console.log(
      `[hot-path]   template:   min=${r2(template.min)}ms ` +
        `median=${r2(template.median)}ms ` +
        `p95=${r2(template.p95)}ms ` +
        `max=${r2(template.max)}ms ` +
        `[budget < ${BUDGET_TEMPLATE_MS}ms] ${templatePass ? 'PASS' : 'FAIL'}`,
    );

    // --- PRIMARY summary line ------------------------------------------
    console.log(
      `[hot-path] ${verdict} median=${r2(totalMedian)}ms ` +
        `p95=${r2(totalP95)}ms ` +
        `total-overhead=${r2(totalP95)}ms ` +
        `[sqlite.get p95=${r2(sqliteGet.p95)}ms ` +
        `concat p95=${r2(concat.p95)}ms ` +
        `template p95=${r2(template.p95)}ms]`,
    );

    // --- Adjustment recommendation on FAIL ----------------------------
    if (!pass) {
      console.log(`[hot-path] FAIL adjustment recommendations (per design.md §2.6):`);
      if (!sqlitePass) {
        console.log(
          `  - sqlite.get p95 over budget: add idx_intel_session_id covering index; ` +
            `or denormalize into audit_events row; or use prepared statement cache`,
        );
      }
      if (!concatPass) {
        console.log(
          `  - concat p95 over budget: use String.prototype.concat or template literal JIT path; ` +
            `or precompute template skeleton; or skip concat when intel is empty`,
        );
      }
      if (!templatePass) {
        console.log(
          `  - template render p95 over budget: use JSON.stringify shortcut (skip canonicalJsonStringify ` +
            `when inputs are pre-sorted); or precompute Block 1 (persona) outside the loop; ` +
            `or memoize canonicalSha256()`,
        );
      }
      if (!totalPass) {
        console.log(
          `  - total p95 over budget: combine adjustments above; ` +
            `do NOT collapse — per PRD §16.7 the path is to adjust, not abandon`,
        );
      }
    }

    process.exit(pass ? 0 : 1);
  } finally {
    if (handle) {
      await handle.close();
    }
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
}

main().catch((err) => {
  console.error(
    `[hot-path] FAIL unhandled error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
