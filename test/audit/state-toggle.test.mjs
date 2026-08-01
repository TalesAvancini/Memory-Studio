/**
 * POST /state/toggle endpoint integration tests (Phase 5b T-10).
 *
 * Coverage:
 *   - Non-critical item: action on/off → 200, active reflects state
 *   - Critical rule + action off + missing critical_confirm → 400
 *   - Critical rule + action off + correct critical_confirm → 200
 *   - Critical rule + action off + wrong critical_confirm → 400
 *   - Unknown itemId → 404
 *   - Invalid body (missing itemId) → 400
 *   - 10 concurrent toggles → monotonic stateVersion (mutex serialization)
 *   - audit event enqueued with event_type: 'state_toggle'
 *
 * Boots Fastify with a tmpdir-backed state.json + a tmpdir-backed
 * YAML catalog directory containing fixture items.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server/index.ts';
import { resetAuditBufferForTests } from '../../src/server/audit/lifecycle.ts';

async function makeFixture() {
  const baseDir = await mkdtemp(join(tmpdir(), 'memstudio-toggle-'));
  const catalogDir = join(baseDir, 'catalog');
  await mkdir(catalogDir, { recursive: true });

  // Critical rule.
  await writeFile(
    join(catalogDir, 'rule-no-secrets.yaml'),
    'id: rule-no-secrets\ntype: rule\ncritical: true\ntext: do not leak secrets\n',
    'utf8',
  );
  // Non-critical skill.
  await writeFile(
    join(catalogDir, 'skill-auth-jwt.yaml'),
    'id: skill-auth-jwt\ntype: skill\ntitle: JWT auth\ncategory: procedural\ntext: handle JWTs\n',
    'utf8',
  );
  // Critical rule with custom confirm phrase.
  await writeFile(
    join(catalogDir, 'rule-pii.yaml'),
    'id: rule-pii\ntype: rule\ncritical: true\ncritical_confirm_phrase: "CONFIRM: PII disabled"\ntext: do not log PII\n',
    'utf8',
  );

  const stateJsonPath = join(baseDir, 'state.json');
  await writeFile(stateJsonPath, JSON.stringify({
    schemaVersion: 3,
    activeCatalog: [],
    stateVersion: 0,
  }), 'utf8');

  return { baseDir, catalogDir, stateJsonPath };
}

async function bootServer(opts, portRange) {
  resetAuditBufferForTests();
  return createServer({
    portRange,
    db: opts.db,
    fastifyOptions: { logger: false },
  });
}

async function shutdown(server) {
  if (server) await server.close();
  resetAuditBufferForTests();
}

// We need to boot Fastify ourselves because boot.ts doesn't currently wire
// /state/toggle (the route needs catalogDir + stateJsonPath which only make
// sense in a wired production path). So we boot Fastify directly with the
// route registered.

import Fastify from 'fastify';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { registerStateToggleRoute } from '../../src/server/routes/state-toggle.ts';
import { initAuditBuffer } from '../../src/server/audit/lifecycle.ts';

async function bootServerWithToggle(fixture, portRange) {
  const db = await openAndMigrate(':memory:');
  initAuditBuffer(db);
  resetAuditBufferForTests();
  initAuditBuffer(db);
  const app = Fastify({ logger: false });
  await registerStateToggleRoute(app, {
    stateJsonPath: fixture.stateJsonPath,
    catalogDir: fixture.catalogDir,
    db,
  });
  await app.listen({ port: portRange[0], host: '127.0.0.1' });
  return { app, db, url: `http://127.0.0.1:${portRange[0]}` };
}

async function shutdownWithToggle(handle) {
  await handle.app.close();
  handle.db.close();
  resetAuditBufferForTests();
}

test('POST /state/toggle: non-critical item, action on → 200, active=true', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'skill-auth-jwt', action: 'on' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.itemId, 'skill-auth-jwt');
      assert.equal(body.action, 'on');
      assert.equal(body.active, true);
      assert.equal(typeof body.stateVersion, 'number');

      const persisted = JSON.parse(await readFile(fx.stateJsonPath, 'utf8'));
      assert.deepEqual(persisted.activeCatalog, ['skill-auth-jwt']);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: non-critical item, action off → 200, active=false', async () => {
  const fx = await makeFixture();
  try {
    // Pre-seed state.json with the item active.
    await writeFile(fx.stateJsonPath, JSON.stringify({
      schemaVersion: 3, activeCatalog: ['skill-auth-jwt'], stateVersion: 1,
    }), 'utf8');
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'skill-auth-jwt', action: 'off' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.active, false);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: critical rule, no confirm → 400 critical_confirm_required', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'rule-no-secrets', action: 'off' }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'critical_confirm_required');
      assert.equal(body.itemId, 'rule-no-secrets');
      assert.match(body.hint, /OVERRIDE: rule-no-secrets/);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: critical rule + correct confirm → 200', async () => {
  const fx = await makeFixture();
  try {
    await writeFile(fx.stateJsonPath, JSON.stringify({
      schemaVersion: 3, activeCatalog: ['rule-no-secrets'], stateVersion: 1,
    }), 'utf8');
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: 'rule-no-secrets',
          action: 'off',
          critical_confirm: 'OVERRIDE: rule-no-secrets',
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.active, false);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: critical rule + wrong confirm → 400', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: 'rule-no-secrets',
          action: 'off',
          critical_confirm: 'wrong-phrase',
        }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.error, 'critical_confirm_required');
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: critical rule + custom critical_confirm_phrase (rule-pii) → 200', async () => {
  const fx = await makeFixture();
  try {
    await writeFile(fx.stateJsonPath, JSON.stringify({
      schemaVersion: 3, activeCatalog: ['rule-pii'], stateVersion: 1,
    }), 'utf8');
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          itemId: 'rule-pii',
          action: 'off',
          critical_confirm: 'CONFIRM: PII disabled',
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.active, false);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: unknown itemId → 404 item_not_found', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'unknown', action: 'on' }),
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'item_not_found');
      assert.equal(body.itemId, 'unknown');
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: invalid body (missing itemId) → 400', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      const res = await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'on' }),
      });
      assert.equal(res.status, 400);
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: 10 concurrent toggles → monotonic stateVersion (mutex serialization)', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      // Fire 10 toggles in parallel; the mutex serializes the writes
      // so stateVersion values are unique and form a strictly-increasing
      // sequence. The order in which responses arrive may differ from
      // the order in which writes completed, so we sort and check.
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          fetch(`${handle.url}/state/toggle`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              itemId: i % 2 === 0 ? 'skill-auth-jwt' : 'rule-no-secrets',
              action: 'on',
            }),
          })
        ),
      );
      const versions = [];
      for (const r of responses) {
        assert.equal(r.status, 200);
        const body = await r.json();
        versions.push(body.stateVersion);
      }
      // All versions are unique (mutex serialized each write).
      assert.equal(new Set(versions).size, versions.length, 'all stateVersions unique');
      // Sorted versions are strictly increasing.
      const sorted = [...versions].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        assert.ok(
          sorted[i] > sorted[i - 1],
          `stateVersion must be strictly increasing after sort; got ${sorted.join(',')}`,
        );
      }
      // Range covers exactly 10 contiguous increments from the initial
      // stateVersion=0 baseline → versions are 1..10.
      assert.equal(sorted[0], 1, 'first stateVersion is 1');
      assert.equal(sorted[sorted.length - 1], 10, 'last stateVersion is 10');
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});

test('POST /state/toggle: audit event enqueued with event_type: state_toggle', async () => {
  const fx = await makeFixture();
  try {
    const handle = await bootServerWithToggle(fx, [47400, 47400]);
    try {
      await fetch(`${handle.url}/state/toggle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ itemId: 'skill-auth-jwt', action: 'on' }),
      });
      // Wait briefly for the audit flush trigger (time-trigger is 1000ms; we
      // force a flush by calling the writer's flush via stop).
      // Instead, just check that the row is written before the buffer is GC'd.
      // Wait 1100ms to ensure the time-trigger flush fires.
      await new Promise((r) => setTimeout(r, 1100));
      const row = handle.db.prepare(
        `SELECT event_type, payload FROM audit_events WHERE event_type = 'state_toggle'`
      ).get();
      assert.ok(row, 'audit row exists');
      assert.equal(row.event_type, 'state_toggle');
      const payload = JSON.parse(row.payload);
      assert.equal(payload.itemId, 'skill-auth-jwt');
      assert.equal(payload.action, 'on');
      assert.equal(payload.active, true);
      assert.equal(typeof payload.stateVersion, 'number');
    } finally {
      await shutdownWithToggle(handle);
    }
  } finally {
    await rm(fx.baseDir, { recursive: true, force: true });
  }
});
