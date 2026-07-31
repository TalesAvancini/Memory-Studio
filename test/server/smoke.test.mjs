// Phase 5a.1 smoke tests for the Fastify augment server.
//
// Coverage:
//   - boot: createServer() returns a handle with app, url, port, close()
//   - boot: server binds to first free port in DEFAULT_AUGMENT_PORT_RANGE
//   - boot: port discovery rejects exhausted range
//   - health: GET /health returns 200 with status, uptime_ms, last_request_ts
//   - health: last_request_ts advances after a successful /augment call
//   - augment: POST /augment missing prompt → 400 MISSING_REQUIRED_FIELD
//   - augment: POST /augment missing fingerprint → 400
//   - augment: POST /augment missing activeCatalog → 400
//   - augment: POST /augment missing schemaVersion → 400
//   - augment: POST /augment with valid body → 200 + structural placeholder
//   - augment: activeCatalog [] → 200 with emptyReason no_active_items
//   - augment: context null → 200 with no warnings
//   - augment: schemaVersion != 3 → 400
//   - schema: AugmentRequestSchema infers the SDK-compatible shape
//
// Uses Fastify inject() for in-process testing where possible so the
// suite does not need a free port per test. One end-to-end test runs
// createServer() to prove the full bootstrap path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createServer,
  DEFAULT_AUGMENT_PORT_RANGE,
  getLastRequestTimestampMs,
  getServerStartTimeMs,
  resetServerMetadataForTests,
  AugmentRequestSchema,
} from '../../src/server/index.ts';

function buildValidRequest(overrides = {}) {
  return {
    prompt: 'design a server endpoint',
    context: null,
    fingerprint: {
      projectPath: '/tmp/project',
      agentId: 'claude-code',
      sessionId: 'abc123',
      gitBranch: 'main',
    },
    activeCatalog: ['skill-auth-01'],
    tenantId: 'tenant-xyz',
    schemaVersion: 3,
    ...overrides,
  };
}

// --- Schema-level tests -------------------------------------------------------

test('schema: AugmentRequestSchema accepts a canonical valid request', () => {
  const req = buildValidRequest();
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, true);
});

test('schema: AugmentRequestSchema rejects missing prompt', () => {
  const req = buildValidRequest();
  delete req.prompt;
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.ok(parsed.error.issues.some((i) => i.path.includes('prompt')));
  }
});

test('schema: AugmentRequestSchema rejects missing fingerprint', () => {
  const req = buildValidRequest();
  delete req.fingerprint;
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, false);
});

test('schema: AugmentRequestSchema rejects missing activeCatalog', () => {
  const req = buildValidRequest();
  delete req.activeCatalog;
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, false);
});

test('schema: AugmentRequestSchema rejects missing schemaVersion', () => {
  const req = buildValidRequest();
  delete req.schemaVersion;
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, false);
});

test('schema: AugmentRequestSchema rejects schemaVersion != 3', () => {
  const req = buildValidRequest();
  req.schemaVersion = 4;
  const parsed = AugmentRequestSchema.safeParse(req);
  assert.equal(parsed.success, false);
});

test('schema: AugmentRequestSchema treats context:null and context absent identically', () => {
  const withNull = AugmentRequestSchema.safeParse(buildValidRequest({ context: null }));
  const without = AugmentRequestSchema.safeParse({ ...buildValidRequest(), context: undefined });
  assert.equal(withNull.success, true);
  assert.equal(without.success, true);
});

// --- Boot tests ---------------------------------------------------------------

test('boot: DEFAULT_AUGMENT_PORT_RANGE is a 101-port block in [42900, 43000]', () => {
  assert.equal(DEFAULT_AUGMENT_PORT_RANGE[0], 42_900);
  assert.equal(DEFAULT_AUGMENT_PORT_RANGE[1], 43_000);
});

test('boot: createServer() returns handle with app, url, port, close()', async () => {
  const handle = await createServer();
  try {
    assert.equal(typeof handle.app, 'object');
    assert.ok(handle.url.startsWith('http://127.0.0.1:'));
    assert.equal(typeof handle.port, 'number');
    assert.equal(typeof handle.close, 'function');
    assert.ok(handle.port >= DEFAULT_AUGMENT_PORT_RANGE[0]);
    assert.ok(handle.port <= DEFAULT_AUGMENT_PORT_RANGE[1]);
  } finally {
    await handle.close();
  }
});

test('boot: port discovery rejects exhausted range', async () => {
  await assert.rejects(
    () => createServer({ portRange: [50_000, 49_999] }),
    /No free port/,
  );
});

// --- In-process route tests (Fastify inject) ---------------------------------

async function injectValid(handle, body) {
  return handle.app.inject({
    method: 'POST',
    url: '/augment',
    payload: body,
  });
}

test('augment: POST /augment with valid body returns 200 + structural placeholder', async () => {
  resetServerMetadataForTests();
  const handle = await createServer();
  try {
    const response = await injectValid(handle, buildValidRequest());
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.schemaVersion, 3);
    assert.deepEqual(body.matchedSkills, []);
    assert.deepEqual(body.matchedRules, []);
    assert.deepEqual(body.matchedPersonas, []);
    assert.deepEqual(body.pruningDecisions, {
      rejectedByFloor: [],
      rejectedByBudget: [],
      rejectedByAttentionTier: [],
      rejectedByNegativeFeedback: [],
      rejectedByCriticalDropped: [],
    });
    assert.equal(typeof body.decisionTraceId, 'string');
    assert.equal(body.decisionTraceId.length, 36);
    assert.deepEqual(body.warnings, []);
    assert.equal(body.emptyReason, null);
  } finally {
    await handle.close();
  }
});

test('augment: POST /augment missing prompt → 400 MISSING_REQUIRED_FIELD', async () => {
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    delete req.prompt;
    const response = await injectValid(handle, req);
    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
    assert.equal(body.error.field, 'prompt');
  } finally {
    await handle.close();
  }
});

test('augment: POST /augment missing fingerprint → 400', async () => {
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    delete req.fingerprint;
    const response = await injectValid(handle, req);
    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.error.code, 'MISSING_REQUIRED_FIELD');
    assert.equal(body.error.field, 'fingerprint');
  } finally {
    await handle.close();
  }
});

test('augment: POST /augment missing activeCatalog → 400', async () => {
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    delete req.activeCatalog;
    const response = await injectValid(handle, req);
    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.error.field, 'activeCatalog');
  } finally {
    await handle.close();
  }
});

test('augment: POST /augment missing schemaVersion → 400', async () => {
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    delete req.schemaVersion;
    const response = await injectValid(handle, req);
    assert.equal(response.statusCode, 400);
    const body = JSON.parse(response.body);
    assert.equal(body.error.field, 'schemaVersion');
  } finally {
    await handle.close();
  }
});

test('augment: POST /augment schemaVersion:4 → 400', async () => {
  const handle = await createServer();
  try {
    const req = buildValidRequest();
    req.schemaVersion = 4;
    const response = await injectValid(handle, req);
    assert.equal(response.statusCode, 400);
  } finally {
    await handle.close();
  }
});

test('augment: activeCatalog:[] → 200 with emptyReason:no_active_items + warning', async () => {
  const handle = await createServer();
  try {
    const response = await injectValid(handle, buildValidRequest({ activeCatalog: [] }));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.emptyReason, 'no_active_items');
    assert.deepEqual(body.warnings, [
      'activeCatalog is empty — proceeding with persona only',
    ]);
  } finally {
    await handle.close();
  }
});

test('augment: context:null is accepted (prompt-only mode)', async () => {
  const handle = await createServer();
  try {
    const response = await injectValid(handle, buildValidRequest({ context: null }));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.emptyReason, null);
    assert.deepEqual(body.warnings, []);
  } finally {
    await handle.close();
  }
});

// --- /health tests -----------------------------------------------------------

test('health: GET /health returns 200 with status:ok, uptime_ms, last_request_ts', async () => {
  resetServerMetadataForTests();
  const handle = await createServer();
  try {
    const response = await handle.app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'ok');
    assert.equal(typeof body.uptime_ms, 'number');
    assert.ok(body.uptime_ms >= 0);
    assert.equal(typeof body.last_request_ts, 'number');
    assert.equal(body.last_request_ts, 0);
  } finally {
    await handle.close();
  }
});

test('health: last_request_ts advances after a successful /augment call', async () => {
  resetServerMetadataForTests();
  const handle = await createServer();
  try {
    assert.equal(getLastRequestTimestampMs(), 0);
    assert.ok(getServerStartTimeMs() > 0);

    const augmentResponse = await injectValid(handle, buildValidRequest());
    assert.equal(augmentResponse.statusCode, 200);

    const lastTs = getLastRequestTimestampMs();
    assert.ok(lastTs > 0, 'last_request_ts should advance after a successful augment call');

    const health = await handle.app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(health.body);
    assert.equal(body.last_request_ts, lastTs);
    assert.ok(body.uptime_ms >= 0);
  } finally {
    await handle.close();
  }
});