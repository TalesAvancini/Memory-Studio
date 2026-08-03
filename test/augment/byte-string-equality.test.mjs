/**
 * SHA-256 byte-string equality integration test (D-006 done criterion).
 *
 * Phase 5a.3 (T-09) — proves that POSTing `/augment` twice with identical
 * logical input produces a byte-equal `systemMessage` SHA-256 in both
 * responses. Also proves that varying ANY of the inputs that influence
 * the 2-block system message (prompt, activeCatalog, persona, context)
 * produces a DIFFERENT SHA-256 — so the equality test isn't vacuously
 * trivially-true on a degenerate corpus.
 *
 * Uses Fastify `app.inject()` to exercise the FULL route handler
 * (Zod validation + social gate + retrieval pipeline + augmenter + log
 * emission), not just `runPipeline` in isolation. The 5+ cases below
 * cover the spec's required discriminators.
 *
 * Fixture strategy:
 *   - Realistic in-memory DB seeded with skills + a persona + a rule.
 *     Each row has unique FTS-indexable text so queryFts surfaces a
 *     stable matched set per query.
 *   - Stub embedder returns the zero vector (vector channel produces no
 *     matches) so the byte-string discriminator is driven purely by FTS
 *     text + activeCatalog membership + persona selection + context.
 *     This eliminates ONNX non-determinism from the test surface.
 *   - The seeded slugs are deterministic kebab-case identifiers so the
 *     tiebreak in `topKAndTiebreak` is stable.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import { createServer, resetServerMetadataForTests } from '../../src/server/index.ts';
import { setAugmentPipelineProvider } from '../../src/server/augment.ts';
import { EMBEDDING_DIMENSIONS } from '../../src/catalog/embedder/index.ts';
import { SEARCH_EMBEDDING_DIMENSIONS } from '../../src/search/types.ts';
import { initializeSearchStorage } from '../../src/search/schema.ts';

// --- Fixture corpus ---------------------------------------------------------
//
// 5 catalog rows: 3 skills + 1 rule + 1 persona. Each has unique FTS text
// so `queryFts(db, prompt)` returns a stable, deterministic matched set.
// Slugs are kebab-case so the tiebreak in `topKAndTiebreak` is stable.

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

// Non-social technical prompt (matches "auth" + "server" terms against the
// fixture rows above). Avoids the `isSocial` short-circuit in the pipeline.
const BASE_PROMPT = 'design a fastify endpoint that validates authentication tokens';

// --- Helpers ----------------------------------------------------------------

// Per-test port range. Each test gets a distinct range far from the
// default `[42900, 43000]` block used by `test/server/smoke.test.mjs`
// and `test/server/smoke-boot.test.mjs`. Without this, parallel test
// files (or rapid sequential boots on Windows) collide on 42900 with
// EADDRINUSE. We pick `[43700, 43999]` which is outside the default
// augment range and outside the Phase 4 UI range `[41823, 42823]`.
let nextTestPort = 43_700;
function reservePortRange() {
  const lo = nextTestPort;
  const hi = lo + 5;
  nextTestPort = hi + 1;
  return [lo, hi];
}

function freshSeededDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      category TEXT,
      critical INTEGER,
      is_default INTEGER,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      catalog_id TEXT PRIMARY KEY REFERENCES catalog(id) ON DELETE CASCADE,
      vector BLOB NOT NULL,
      model_version TEXT NOT NULL,
      embedded_at INTEGER NOT NULL
    );
  `);
  try {
    initializeSearchStorage(db);
  } catch {
    // Vec extension may be unavailable in some envs; pipeline is fail-open
    // so the test still runs (zero vec means no vector matches; FTS-only).
  }

  const zeroEmbedding = (() => {
    const arr = new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  })();

  const insertCatalog = db.prepare(
    `INSERT INTO catalog (id, type, text, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1)`,
  );
  const insertEmbed = db.prepare(
    `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
     VALUES (?, ?, ?, 1)`,
  );
  for (const row of FIXTURE_ROWS) {
    insertCatalog.run(row.slug, row.kind, row.content, `h-${row.slug}`);
    insertEmbed.run(row.slug, zeroEmbedding, 'multilingual-e5-small@1');
  }
  return db;
}

function stubProvider() {
  const db = freshSeededDb();
  return {
    db,
    embedder: {
      dimensions: EMBEDDING_DIMENSIONS,
      // Deterministic zero vector — eliminates ONNX non-determinism and
      // makes the byte-string discriminator driven by FTS + persona +
      // context only (the inputs we want to vary in the tests below).
      async encode() {
        return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
      },
      async embed() {
        return new Float32Array(SEARCH_EMBEDDING_DIMENSIONS);
      },
    },
  };
}

function buildRequest(overrides = {}) {
  return {
    prompt: BASE_PROMPT,
    context: null,
    fingerprint: {
      projectPath: '/tmp/byte-string-equality',
      agentId: 'claude-code',
      sessionId: 'bseq-session-001',
      gitBranch: 'main',
    },
    activeCatalog: [
      'auth-jwt-validation',
      'auth-oauth-handler',
      'auth-session-cookie',
      'rule-no-secrets-in-prompts',
      'persona-senior-engineer',
    ],
    tenantId: 'tenant-bseq',
    schemaVersion: 3,
    ...overrides,
  };
}

/**
 * Sanity check that the `systemMessage` field is a valid SHA-256 hex.
 * The augmenter always produces 64-char lowercase hex per D-006 + R-12.
 */
function assertValidSha256(value) {
  assert.equal(typeof value, 'string', 'systemMessage must be a string');
  assert.equal(value.length, 64, `SHA-256 hex must be 64 chars, got ${value.length}`);
  assert.match(value, /^[0-9a-f]{64}$/, `systemMessage is not lowercase hex: ${value}`);
}

/**
 * Mirror of the canonicalSha256 primitive but exposed for the assertion
 * step. The augmenter already ran this server-side; we recompute only as
 * a cross-check that the response value really is a SHA-256 of something.
 */
function sha256Hex(input) {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// --- Test 1: identical input → identical SHA-256 (the D-006 done criterion)

test('byte-string-equality: identical request → identical systemMessage SHA-256 (D-006 done)', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const req = buildRequest();
    const r1 = await handle.app.inject({ method: 'POST', url: '/augment', payload: req });
    const r2 = await handle.app.inject({ method: 'POST', url: '/augment', payload: req });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);

    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.equal(
      b1.systemMessage,
      b2.systemMessage,
      `expected identical SHA-256 for identical request; got ${b1.systemMessage} vs ${b2.systemMessage}`,
    );

    // Cross-check: the SHA must differ from a fresh hash of an empty
    // string (the NIST "all zeros" sentinel). A regression that returns
    // a constant would slip past the equality assertion above.
    assert.notEqual(
      b1.systemMessage,
      sha256Hex(''),
      'systemMessage must not be the SHA-256 of an empty string',
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 2: different prompt → different SHA-256 ----------------------------
//
// Two prompts designed to match different FTS items in the fixture:
//   - BASE_PROMPT hits `auth-jwt-validation` (FTS match on "fastify endpoint validates JWT tokens")
//   - ALT_PROMPT  hits `auth-session-cookie` (FTS match on "session cookies")
// The matched set differs → the byte-string (built from matched slugs) differs.

test('byte-string-equality: different prompt → different systemMessage SHA-256', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const r1 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({ prompt: BASE_PROMPT }),
    });
    const r2 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        prompt: 'design a session-cookie authentication flow with HttpOnly flags',
      }),
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.notEqual(
      b1.systemMessage,
      b2.systemMessage,
      `expected different SHA-256 for different prompt that matches different items; both got ${b1.systemMessage}`,
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 3: different activeCatalog → different SHA-256 --------------------
//
// Shrinking the activeCatalog drops items from the matched set (the
// activeCatalog filter is applied AFTER threshold, in `filterActiveCatalog`).
// Different active list → different matched slugs → different byte-string.

test('byte-string-equality: different activeCatalog → different systemMessage SHA-256', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const r1 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        activeCatalog: [
          'auth-jwt-validation',
          'auth-oauth-handler',
          'auth-session-cookie',
          'rule-no-secrets-in-prompts',
          'persona-senior-engineer',
        ],
      }),
    });
    const r2 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        activeCatalog: ['auth-jwt-validation', 'persona-senior-engineer'],
      }),
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.notEqual(
      b1.systemMessage,
      b2.systemMessage,
      `expected different SHA-256 for different activeCatalog; both got ${b1.systemMessage}`,
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 4: different persona → different SHA-256 --------------------------
//
// The persona text feeds Block 1 of the 2-block system message. Swapping
// which persona slug is in activeCatalog changes Block 1's body (only the
// matched persona is included), which changes the canonical JSON and
// therefore the SHA-256.
//
// We swap the persona slug for a synthetic one whose text we also seed
// into the DB so retrieval can hydrate it.

test('byte-string-equality: different persona in activeCatalog → different systemMessage SHA-256', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  // Seed an alternate persona so the swap is a valid catalog entry.
  provider.db.prepare(
    `INSERT INTO catalog (id, type, text, content_hash, created_at, updated_at)
     VALUES (?, 'persona', ?, ?, 1, 1)`,
  ).run(
    'persona-staff-engineer',
    'respond as a staff engineer — systems-level thinking, trade-off analysis, broader impact',
    'h-persona-staff-engineer',
  );
  provider.db.prepare(
    `INSERT INTO embeddings (catalog_id, vector, model_version, embedded_at)
     VALUES (?, ?, ?, 1)`,
  ).run(
    'persona-staff-engineer',
    Buffer.alloc(SEARCH_EMBEDDING_DIMENSIONS * 4),
    'multilingual-e5-small@1',
  );
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const r1 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        activeCatalog: [
          'auth-jwt-validation',
          'rule-no-secrets-in-prompts',
          'persona-senior-engineer',
        ],
      }),
    });
    const r2 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        activeCatalog: [
          'auth-jwt-validation',
          'rule-no-secrets-in-prompts',
          'persona-staff-engineer',
        ],
      }),
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.notEqual(
      b1.systemMessage,
      b2.systemMessage,
      `expected different SHA-256 for different persona slug; both got ${b1.systemMessage}`,
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 5: different context (scratch text) → different SHA-256 -----------
//
// `Context` lands in Block 2 (as `canonicalSha256(JSON.stringify(context))`
// + the raw JSON). Different `context.scratch` text → different SHA-256.

test('byte-string-equality: different context.scratch → different systemMessage SHA-256', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const r1 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        context: { scratch: 'current task: implement JWT validation in Fastify' },
      }),
    });
    const r2 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        context: { scratch: 'current task: implement OAuth 2 PKCE flow in Fastify' },
      }),
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.notEqual(
      b1.systemMessage,
      b2.systemMessage,
      `expected different SHA-256 for different context.scratch; both got ${b1.systemMessage}`,
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 6 (bonus): context null → context present → different SHA-256 ----
//
// `context: null` (R-03 / PRD §7.1) is treated as "no context" — Block 2's
// Context section is OMITTED entirely. Switching null ↔ populated context
// adds/removes a section from Block 2, so the byte-string MUST differ.

test('byte-string-equality: context:null vs context populated → different systemMessage SHA-256', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const r1 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({ context: null }),
    });
    const r2 = await handle.app.inject({
      method: 'POST',
      url: '/augment',
      payload: buildRequest({
        context: { scratch: 'any non-empty scratch text here' },
      }),
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    const b1 = JSON.parse(r1.body);
    const b2 = JSON.parse(r2.body);
    assertValidSha256(b1.systemMessage);
    assertValidSha256(b2.systemMessage);
    assert.notEqual(
      b1.systemMessage,
      b2.systemMessage,
      `expected different SHA-256 for context:null vs populated context; both got ${b1.systemMessage}`,
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});

// --- Test 7 (bonus): three identical calls → identical SHA-256 ------------
//
// Beyond the D-006 "two calls" assertion, prove that the SHA is stable
// across MORE than two calls — a regression where the SHA drifts over
// the server's lifetime (e.g. process-level state leaking into the
// canonical form) would slip past a 2-call assertion.

test('byte-string-equality: 3 sequential identical calls → identical systemMessage SHA-256 (stability)', async () => {
  resetServerMetadataForTests();
  const provider = stubProvider();
  setAugmentPipelineProvider(() => provider);
  const handle = await createServer({ portRange: reservePortRange() });
  try {
    const req = buildRequest();
    const responses = await Promise.all([
      handle.app.inject({ method: 'POST', url: '/augment', payload: req }),
      handle.app.inject({ method: 'POST', url: '/augment', payload: req }),
      handle.app.inject({ method: 'POST', url: '/augment', payload: req }),
    ]);
    const bodies = responses.map((r) => JSON.parse(r.body));
    for (const b of bodies) assertValidSha256(b.systemMessage);
    assert.equal(bodies[0].systemMessage, bodies[1].systemMessage);
    assert.equal(bodies[1].systemMessage, bodies[2].systemMessage);
    assert.equal(
      new Set(bodies.map((b) => b.systemMessage)).size,
      1,
      'expected exactly 1 unique SHA-256 across 3 sequential identical calls',
    );
  } finally {
    await handle.close();
    setAugmentPipelineProvider(null);
    provider.db.close();
  }
});
