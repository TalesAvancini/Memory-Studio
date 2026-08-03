/**
 * POST /v1/messages transparent proxy integration tests (Phase 5b T-13).
 *
 * Coverage:
 *   - proxy_disabled 503 when upstreamUrl is null
 *   - proxy_host_not_allowed 502 when upstream is non-loopback
 *   - 400 invalid_anthropic_request for malformed body
 *   - 200 happy path: forwards to stub upstream; returns stub response
 *   - audit row written with cacheReadInputTokens + cacheCreationInputTokens
 *   - augment_failed 502 when pipeline throws
 *   - system field rewritten to 2-block structure (forwarded body has
 *     `cache_control: ephemeral` blocks)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { initAuditBuffer, resetAuditBufferForTests } from '../../src/server/audit/lifecycle.ts';
import { registerMessagesProxyRoute } from '../../src/server/routes/messages-proxy.ts';
import Fastify from 'fastify';

async function bootProxy(opts, portRange) {
  resetAuditBufferForTests();
  const db = await openAndMigrate(':memory:');
  const app = Fastify({ logger: false });
  await registerMessagesProxyRoute(app, opts);
  await app.listen({ port: portRange[0], host: '127.0.0.1' });
  return {
    app,
    db,
    url: `http://127.0.0.1:${portRange[0]}`,
    async close() {
      await app.close();
      db.close();
      resetAuditBufferForTests();
    },
  };
}

function startStubUpstream(handler) {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function makeAnthropicRequest() {
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 50,
    system: 'you are a helpful assistant',
    messages: [{ role: 'user', content: 'hello' }],
  };
}

function makeAnthropicResponse({ cacheRead = 0, cacheCreation = 0, inputTokens = 10, outputTokens = 5 } = {}) {
  return {
    id: 'msg_test_123',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'OK' }],
    model: 'claude-sonnet-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreation,
      cache_read_input_tokens: cacheRead,
    },
  };
}

test('POST /v1/messages: proxy_disabled 503 when upstreamUrl is null', async () => {
  const db = await openAndMigrate(':memory:');
  initAuditBuffer(db);
  resetAuditBufferForTests();
  initAuditBuffer(db);
  const app = Fastify({ logger: false });
  await registerMessagesProxyRoute(app, {
    upstreamUrl: null,
    pipelineProvider: () => ({ db, embedder: { dimensions: 384, encode: async () => new Float32Array(384) } }),
  });
  await app.listen({ port: 47500, host: '127.0.0.1' });
  try {
    const res = await fetch('http://127.0.0.1:47500/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeAnthropicRequest()),
    });
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, 'proxy_disabled');
  } finally {
    await app.close();
    db.close();
    resetAuditBufferForTests();
  }
});

test('POST /v1/messages: proxy_host_not_allowed 502 when upstream is non-loopback', async () => {
  const db = await openAndMigrate(':memory:');
  initAuditBuffer(db);
  resetAuditBufferForTests();
  initAuditBuffer(db);
  const app = Fastify({ logger: false });
  await registerMessagesProxyRoute(app, {
    upstreamUrl: 'https://api.anthropic.com',
    pipelineProvider: () => ({ db, embedder: { dimensions: 384, encode: async () => new Float32Array(384) } }),
  });
  await app.listen({ port: 47501, host: '127.0.0.1' });
  try {
    const res = await fetch('http://127.0.0.1:47501/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(makeAnthropicRequest()),
    });
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error, 'proxy_host_not_allowed');
    assert.equal(body.host, 'api.anthropic.com');
  } finally {
    await app.close();
    db.close();
    resetAuditBufferForTests();
  }
});

test('POST /v1/messages: 400 invalid_anthropic_request for malformed body', async () => {
  const db = await openAndMigrate(':memory:');
  initAuditBuffer(db);
  resetAuditBufferForTests();
  initAuditBuffer(db);
  const app = Fastify({ logger: false });
  await registerMessagesProxyRoute(app, {
    upstreamUrl: 'http://127.0.0.1:65530',
    pipelineProvider: () => ({ db, embedder: { dimensions: 384, encode: async () => new Float32Array(384) } }),
  });
  await app.listen({ port: 47502, host: '127.0.0.1' });
  try {
    const res = await fetch('http://127.0.0.1:47502/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5' }), // missing messages
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'invalid_anthropic_request');
  } finally {
    await app.close();
    db.close();
    resetAuditBufferForTests();
  }
});

test('POST /v1/messages: 200 happy path forwards to stub; audit row has cacheReadInputTokens', async () => {
  const stub = await startStubUpstream((req, res, body) => {
    // Echo the request and verify it has the augmented 2-block system.
    const parsed = JSON.parse(body);
    const systemBlocks = Array.isArray(parsed.system) ? parsed.system : [];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(makeAnthropicResponse({ cacheRead: 42, cacheCreation: 17, inputTokens: 100, outputTokens: 7 })));
    void systemBlocks;
  });
  try {
    const db = await openAndMigrate(':memory:');
    initAuditBuffer(db);
    resetAuditBufferForTests();
    initAuditBuffer(db);
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: stub.url,
      pipelineProvider: () => ({ db, embedder: { dimensions: 384, encode: async () => new Float32Array(384) } }),
    });
    await app.listen({ port: 47503, host: '127.0.0.1' });
    try {
      const res = await fetch('http://127.0.0.1:47503/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeAnthropicRequest()),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.usage.cache_read_input_tokens, 42);
      assert.equal(body.usage.cache_creation_input_tokens, 17);

      // Wait for audit flush (time-trigger is 1000ms).
      await new Promise((r) => setTimeout(r, 1100));
      const row = db.prepare(
        `SELECT event_type, payload FROM audit_events WHERE event_type = 'messages_proxy'`
      ).get();
      assert.ok(row, 'audit row exists');
      const payload = JSON.parse(row.payload);
      assert.equal(payload.cacheReadInputTokens, 42);
      assert.equal(payload.cacheCreationInputTokens, 17);
      assert.equal(payload.model, 'claude-sonnet-4-5');
      assert.equal(typeof payload.systemMessageSha256, 'string');
      assert.match(payload.systemMessageSha256, /^[0-9a-f]{64}$/);
    } finally {
      await app.close();
      db.close();
      resetAuditBufferForTests();
    }
  } finally {
    await stub.close();
  }
});

test('POST /v1/messages: augment_failed 502 when pipeline throws', async () => {
  const stub = await startStubUpstream((_req, res) => {
    // Should not be reached.
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const db = await openAndMigrate(':memory:');
    initAuditBuffer(db);
    resetAuditBufferForTests();
    initAuditBuffer(db);
    const app = Fastify({ logger: false });
    // Pipeline provider throws synchronously.
    await registerMessagesProxyRoute(app, {
      upstreamUrl: stub.url,
      pipelineProvider: () => { throw new Error('pipeline blew up'); },
    });
    await app.listen({ port: 47504, host: '127.0.0.1' });
    try {
      const res = await fetch('http://127.0.0.1:47504/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(makeAnthropicRequest()),
      });
      assert.equal(res.status, 502);
      const body = await res.json();
      assert.equal(body.error, 'augment_failed');
      assert.equal(body.message, 'Memory Studio augmentation failed');
    } finally {
      await app.close();
      db.close();
      resetAuditBufferForTests();
    }
  } finally {
    await stub.close();
  }
});

test('POST /v1/messages: system field rewritten to 2-block structure (cache_control: ephemeral)', async () => {
  let capturedBody = null;
  const stub = await startStubUpstream((req, res, body) => {
    capturedBody = body;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(makeAnthropicResponse({ cacheRead: 1, cacheCreation: 1 })));
  });
  try {
    const db = await openAndMigrate(':memory:');
    initAuditBuffer(db);
    resetAuditBufferForTests();
    initAuditBuffer(db);
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: stub.url,
      pipelineProvider: () => ({ db, embedder: { dimensions: 384, encode: async () => new Float32Array(384) } }),
    });
    await app.listen({ port: 47505, host: '127.0.0.1' });
    try {
      await fetch('http://127.0.0.1:47505/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...makeAnthropicRequest(),
          system: 'original system text',
        }),
      });
      assert.ok(capturedBody !== null);
      const parsed = JSON.parse(capturedBody);
      assert.ok(Array.isArray(parsed.system), 'system is an array of blocks');
      assert.equal(parsed.system.length, 2, 'exactly 2 blocks (PRD §8 invariante 11)');
      for (const block of parsed.system) {
        assert.equal(block.type, 'text');
        assert.equal(block.cache_control.type, 'ephemeral');
        assert.equal(typeof block.text, 'string');
      }
    } finally {
      await app.close();
      db.close();
      resetAuditBufferForTests();
    }
  } finally {
    await stub.close();
  }
});
