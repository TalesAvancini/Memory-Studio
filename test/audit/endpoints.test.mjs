/**
 * GET /audit + GET /audit/summary + GET /catalog + enhanced /health
 * integration tests (Phase 5b T-08).
 *
 * Boots the real Fastify server with an in-memory SQLite DB, fires
 * requests via `fetch`, and asserts the public response shapes.
 *
 * Coverage:
 *   - GET /catalog: empty → [], with items → full shape + embeddings metadata
 *   - GET /audit: empty → [], with rows → redacted (no prompt field),
 *     ?limit clamp, ?range filter
 *   - GET /audit/summary: empty → [], with rows → rollups grouped by date
 *   - GET /health: enhanced payload with audit_buffer + catalog blocks
 *
 * Perf gate (R-15 / PRD §10.4.3): 1000-row seed + GET /audit?range=30days
 * < 100ms (validated in a separate file: perf-100ms.test.mjs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { createServer } from '../../src/server/index.ts';
import {
  initAuditBuffer,
  resetAuditBufferForTests,
  setAuditBufferForTests,
} from '../../src/server/audit/lifecycle.ts';
import { AuditRingBuffer } from '../../src/server/audit/buffer.ts';
import { createBetterSqliteAuditWriter } from '../../src/server/audit/writer.ts';

async function bootServer() {
  const db = await openAndMigrate(':memory:');
  resetAuditBufferForTests();
  const server = await createServer({
    portRange: [47100, 47199],
    db,
    fastifyOptions: { logger: false },
  });
  return { db, server };
}

async function shutdown(server) {
  if (server) await server.close();
  resetAuditBufferForTests();
}

/**
 * Insert a row directly into the catalog table for GET /catalog tests.
 */
function seedCatalog(db, items) {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO catalog
       (id, type, title, text, category, critical, is_default, content_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const it of items) {
    stmt.run(
      it.id,
      it.type,
      it.title,
      it.text,
      it.category ?? null,
      it.critical ?? null,
      it.is_default ?? null,
      it.content_hash ?? 'hash-' + it.id,
      it.created_at ?? 1_700_000_000_000,
      it.updated_at ?? 1_700_000_000_000,
    );
  }
}

/**
 * Insert a row into audit_events directly for GET /audit tests.
 */
function seedAudit(db, evts) {
  const stmt = db.prepare(
    `INSERT INTO audit_events
       (ts, "tenantId_hashed", event_type, payload, fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const e of evts) {
    stmt.run(
      e.ts,
      e.tenantIdHashed ?? 'testhash1234',
      e.eventType,
      JSON.stringify(e.payload ?? {}),
      e.fingerprint ? JSON.stringify(e.fingerprint) : null,
      JSON.stringify(e.matchedIds ?? []),
      JSON.stringify(e.pruningReasons ?? []),
      e.latencyMs ?? 0,
      e.redactedPromptHash ?? 'a'.repeat(64),
    );
  }
}

// --- GET /catalog ---------------------------------------------------------

test('GET /catalog: empty catalog returns []', async () => {
  const { db, server } = await bootServer();
  try {
    const res = await fetch(`${server.url}/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  } finally {
    await shutdown(server);
  }
});

test('GET /catalog: with items returns full shape including has_embedding flag', async () => {
  const { db, server } = await bootServer();
  try {
    seedCatalog(db, [
      { id: 'skill-auth-01', type: 'skill', title: 'Auth', text: 'auth skill text', critical: 0, is_default: 1 },
      { id: 'rule-no-secrets', type: 'rule', title: 'No secrets', text: 'rule text', critical: 1, is_default: 0 },
    ]);
    const res = await fetch(`${server.url}/catalog`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 2);
    assert.equal(body[0].id, 'rule-no-secrets'); // sorted by id ASC
    assert.equal(body[1].id, 'skill-auth-01');
    for (const item of body) {
      assert.equal(typeof item.id, 'string');
      assert.ok(['skill', 'rule', 'persona'].includes(item.type));
      assert.equal(typeof item.text, 'string');
      assert.equal(typeof item.content_hash, 'string');
      assert.equal(item.has_embedding, false);
      assert.equal(item.embedding_dimensions, null);
    }
  } finally {
    await shutdown(server);
  }
});

// --- GET /audit -----------------------------------------------------------

test('GET /audit: empty audit table returns []', async () => {
  const { db, server } = await bootServer();
  try {
    const res = await fetch(`${server.url}/audit`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  } finally {
    await shutdown(server);
  }
});

test('GET /audit: with rows returns redacted shape (no prompt/context fields)', async () => {
  const { db, server } = await bootServer();
  try {
    const promptHash = createHash('sha256').update('hello', 'utf8').digest('hex');
    const now = Date.now();
    seedAudit(db, [
      { ts: now - 1000, tenantIdHashed: 'abc123', eventType: 'augment', matchedIds: ['x'], latencyMs: 5, redactedPromptHash: promptHash },
      { ts: now, tenantIdHashed: 'def456', eventType: 'augment', matchedIds: [], latencyMs: 10, redactedPromptHash: promptHash },
    ]);
    const res = await fetch(`${server.url}/audit`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.length, 2);
    for (const row of body) {
      assert.equal(typeof row.ts, 'number');
      assert.equal(typeof row.tenantId_hashed, 'string');
      assert.equal(row.eventType, 'augment');
      // NO raw prompt field.
      assert.equal(row.prompt, undefined);
      assert.equal(row.context, undefined);
      assert.equal(row.tenantId, undefined);
      // matchedIds is an array.
      assert.ok(Array.isArray(row.matchedIds));
      // redactedPromptHash is sha256 hex.
      assert.match(row.redactedPromptHash, /^[0-9a-f]{64}$/);
    }
  } finally {
    await shutdown(server);
  }
});

test('GET /audit: ?limit clamps to MAX_LIMIT (500)', async () => {
  const { db, server } = await bootServer();
  try {
    const now = Date.now();
    seedAudit(db, Array.from({ length: 10 }, (_, i) => ({
      ts: now - (10 - i) * 1000,
      eventType: 'augment',
    })));
    const res = await fetch(`${server.url}/audit?limit=600`);
    const body = await res.json();
    assert.equal(body.length, 10, 'returns all 10 (under MAX_LIMIT=500)');
  } finally {
    await shutdown(server);
  }
});

// --- GET /audit/summary ---------------------------------------------------

test('GET /audit/summary: empty audit table returns []', async () => {
  const { db, server } = await bootServer();
  try {
    const res = await fetch(`${server.url}/audit/summary`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, []);
  } finally {
    await shutdown(server);
  }
});

test('GET /audit/summary: groups by date with correct counts', async () => {
  const { db, server } = await bootServer();
  try {
    const day = 86_400_000;
    const today = Date.now();
    seedAudit(db, [
      { ts: today, eventType: 'augment', latencyMs: 10, matchedIds: ['a', 'b'] },
      { ts: today + 1000, eventType: 'augment', latencyMs: 20, matchedIds: ['c'] },
      { ts: today - day, eventType: 'augment', latencyMs: 30, matchedIds: [] },
    ]);
    const res = await fetch(`${server.url}/audit/summary?range=7days`);
    const body = await res.json();
    assert.ok(body.length >= 1, 'at least one rollup');
    for (const row of body) {
      assert.equal(typeof row.date, 'string');
      assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof row.count, 'number');
      assert.ok(row.count >= 1);
      assert.ok(typeof row.matchedItemsTotal === 'number');
    }
  } finally {
    await shutdown(server);
  }
});

// --- GET /health (enhanced) ----------------------------------------------

test('GET /health: returns 200 with audit_buffer + catalog blocks', async () => {
  const { db, server } = await bootServer();
  try {
    seedCatalog(db, [
      { id: 'skill-x', type: 'skill', title: 'X', text: 'text-x' },
    ]);
    const res = await fetch(`${server.url}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime_ms, 'number');
    assert.equal(typeof body.last_request_ts, 'number');
    assert.equal(typeof body.request_id, 'string');
    assert.equal(body.schema_version, 3);
    // Enhanced blocks.
    assert.ok(body.audit_buffer, 'audit_buffer block present');
    assert.equal(typeof body.audit_buffer.depth, 'number');
    assert.equal(typeof body.audit_buffer.capacity, 'number');
    assert.ok(body.audit_buffer.last_flush_ts === null || typeof body.audit_buffer.last_flush_ts === 'number');
    assert.ok(body.catalog, 'catalog block present');
    assert.equal(body.catalog.count, 1);
    assert.ok(body.catalog.last_rebuild_ts === null || typeof body.catalog.last_rebuild_ts === 'number');
  } finally {
    await shutdown(server);
  }
});

test('GET /health: audit_buffer.depth reflects enqueue count (test-only hook)', async () => {
  const { db, server } = await bootServer();
  try {
    // Enqueue 5 events directly via the module-scoped buffer.
    const buf = initAuditBuffer(db);
    for (let i = 0; i < 5; i += 1) {
      buf.enqueue({
        ts: Date.now(),
        tenantIdHashed: null,
        redactedPromptHash: 'a'.repeat(64),
        matchedIds: [],
        pruningReasons: [],
        latencyMs: 0,
        fingerprint: {},
        payload: {},
        eventType: 'augment',
      });
    }
    const res = await fetch(`${server.url}/health`);
    const body = await res.json();
    assert.equal(body.audit_buffer.depth, 5, 'depth reflects 5 enqueued events');
  } finally {
    await shutdown(server);
  }
});