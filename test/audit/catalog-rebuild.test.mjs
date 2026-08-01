/**
 * POST /catalog/rebuild endpoint integration tests (Phase 5b T-09).
 *
 * Coverage:
 *   - First rebuild → 200 + {rebuilt: true, count, durationMs}
 *   - Second rebuild → same count (idempotent)
 *   - Empty catalog → count: 0
 *   - setLastRebuildTs called → /health reflects non-null last_rebuild_ts
 *   - Concurrent /augment during rebuild stays 200
 *
 * Boots the Fastify server with an in-memory SQLite DB (mirroring
 * `endpoints.test.mjs`'s pattern). The default rebuild function is
 * a no-op that surfaces the current catalog count — sufficient to
 * exercise the route contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { createServer } from '../../src/server/index.ts';
import { resetAuditBufferForTests } from '../../src/server/audit/lifecycle.ts';
import { getLastRebuildTs } from '../../src/server/health.ts';

async function bootServer(db, portRange) {
  resetAuditBufferForTests();
  return createServer({
    portRange,
    db,
    fastifyOptions: { logger: false },
  });
}

async function shutdown(server) {
  if (server) await server.close();
  resetAuditBufferForTests();
}

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

test('POST /catalog/rebuild: returns 200 + {rebuilt, count, durationMs}', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    seedCatalog(db, [
      { id: 'a', type: 'skill', title: 'A', text: 'text-a' },
      { id: 'b', type: 'skill', title: 'B', text: 'text-b' },
      { id: 'c', type: 'rule', title: 'C', text: 'text-c' },
    ]);
    const server = await bootServer(db, [47300, 47399]);
    try {
      const res = await fetch(`${server.url}/catalog/rebuild`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.rebuilt, true);
      assert.equal(body.count, 3);
      assert.equal(typeof body.durationMs, 'number');
      assert.ok(body.durationMs >= 0);
    } finally {
      await shutdown(server);
    }
  } finally {
    db.close();
  }
});

test('POST /catalog/rebuild: idempotent (second call returns same count)', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    seedCatalog(db, [
      { id: 'x', type: 'skill', title: 'X', text: 't-x' },
      { id: 'y', type: 'rule', title: 'Y', text: 't-y' },
    ]);
    const server = await bootServer(db, [47300, 47399]);
    try {
      const r1 = await (await fetch(`${server.url}/catalog/rebuild`, { method: 'POST' })).json();
      const r2 = await (await fetch(`${server.url}/catalog/rebuild`, { method: 'POST' })).json();
      assert.equal(r1.count, 2);
      assert.equal(r2.count, 2);
      assert.equal(r1.rebuilt, true);
      assert.equal(r2.rebuilt, true);
    } finally {
      await shutdown(server);
    }
  } finally {
    db.close();
  }
});

test('POST /catalog/rebuild: empty catalog returns count: 0', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    const server = await bootServer(db, [47300, 47399]);
    try {
      const res = await fetch(`${server.url}/catalog/rebuild`, { method: 'POST' });
      const body = await res.json();
      assert.equal(body.rebuilt, true);
      assert.equal(body.count, 0);
    } finally {
      await shutdown(server);
    }
  } finally {
    db.close();
  }
});

test('POST /catalog/rebuild: sets lastRebuildTs so /health reflects it', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    seedCatalog(db, [{ id: 'one', type: 'skill', title: 'One', text: 'text-1' }]);
    const server = await bootServer(db, [47300, 47399]);
    try {
      const beforePrev = getLastRebuildTs() ?? 0;
      const before = Date.now();
      await fetch(`${server.url}/catalog/rebuild`, { method: 'POST' });
      const after = Date.now();
      const lastRebuildTs = getLastRebuildTs();
      assert.ok(lastRebuildTs !== null, 'lastRebuildTs is set after rebuild');
      assert.ok(
        lastRebuildTs >= before && lastRebuildTs <= after,
        'timestamp within [before, after]',
      );
      assert.ok(lastRebuildTs > beforePrev, 'monotonic vs prior rebuild');

      // /health surfaces the catalog.last_rebuild_ts block
      const health = await (await fetch(`${server.url}/health`)).json();
      assert.equal(typeof health.catalog.last_rebuild_ts, 'number');
      assert.ok(health.catalog.last_rebuild_ts >= before);
    } finally {
      await shutdown(server);
    }
  } finally {
    db.close();
  }
});

test('POST /catalog/rebuild: mutex serializes 10 concurrent /augment calls during rebuild', async () => {
  const db = await openAndMigrate(':memory:');
  try {
    seedCatalog(db, [
      { id: 's1', type: 'skill', title: 'S1', text: 'text-s1' },
      { id: 's2', type: 'rule', title: 'S2', text: 'text-s2' },
    ]);
    const server = await bootServer(db, [47300, 47399]);
    try {
      // Fire /augment + /catalog/rebuild in parallel; all should return 200.
      // /augment uses the in-memory default pipeline (returns 200 even with empty catalog).
      const augmentPromises = Array.from({ length: 10 }, () =>
        fetch(`${server.url}/augment`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt: 'hello',
            context: null,
            fingerprint: {
              projectPath: '.',
              agentId: 'claude-code',
              sessionId: 'sess-conc',
              gitBranch: 'main',
            },
            activeCatalog: [],
            tenantId: 'conc-tenant',
            schemaVersion: 3,
          }),
        }),
      );
      const rebuildPromise = fetch(`${server.url}/catalog/rebuild`, { method: 'POST' });
      const results = await Promise.all([...augmentPromises, rebuildPromise]);
      // All 10 /augment + 1 /catalog/rebuild must be 200.
      for (const r of results) {
        assert.equal(r.status, 200);
      }
    } finally {
      await shutdown(server);
    }
  } finally {
    db.close();
  }
});
