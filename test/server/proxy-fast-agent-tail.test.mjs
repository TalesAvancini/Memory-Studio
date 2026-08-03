/**
 * Phase 7b T-03 — proxy response-first fast-agent tail tests.
 * @date 2026-08-03
 * @version 1
 *
 * Verifies that the transparent proxy's response-first fast-agent
 * scheduling (R-6) behaves correctly:
 *
 *   1. Tail fires AFTER the upstream response completes (response-first).
 *   2. Tail reads ASSISTANT response text, not the user prompt.
 *   3. Intel is stored under a hashed per-session identity.
 *   4. Turn N+1 reads Turn N's intel via the pipeline.
 *   5. Injected 429 from the fast-agent fails open (R-6/L-007).
 *   6. Two-turn streaming case also stores the intel tail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import Fastify from 'fastify';
import { registerMessagesProxyRoute } from '../../src/server/routes/messages-proxy.ts';
import { openAndMigrate } from '../../src/catalog/db/open.ts';

function hashSessionId(raw) {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

function buildJsonResponse(text) {
  return JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-sonnet-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 20,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 7,
    },
  });
}

function startJsonUpstream(responseText) {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(buildJsonResponse(responseText));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
function encode(text) { return new TextEncoder().encode(text); }

function startStreamingUpstream() {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      (async () => {
        res.write(sseEvent('message_start', {
          type: 'message_start',
          message: { type: 'message', content: [], usage: { input_tokens: 10 } },
        }));
        res.write(sseEvent('content_block_delta', {
          type: 'content_block_delta', index: 0,
          delta: { type: 'text_delta', text: 'streamed response' },
        }));
        res.write(sseEvent('message_delta', {
          type: 'message_delta', delta: {},
          usage: { cache_read_input_tokens: 13, output_tokens: 3 },
        }));
        res.write('data: [DONE]\n\n');
        res.end();
      })().catch(() => res.end());
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      resolve({ port, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function makeFixturePipeline(db, intelBySession = new Map(), sessionId) {
  return {
    db,
    embedder: { dimensions: 384, async encode() { return new Float32Array(384); } },
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
    retrieve() { return { ranked: [], ftsTotalHits: 0, retrievalMs: 0 }; },
    getIntel(sid) { return intelBySession.get(sid) ?? null; },
    async writeIntel(sid, intel) { intelBySession.set(sid, intel); },
    sessionId,
  };
}

function makeAnthropicRequest(text) {
  return {
    model: 'claude-sonnet-4-5',
    max_tokens: 64,
    stream: false,
    system: 'fixture-system',
    messages: [{ role: 'user', content: text }],
  };
}

test('proxy response-first tail writes intel after the response completes', async () => {
  const stub = await startJsonUpstream('Hello from the assistant');
  const tailCalls = [];
  let tailLatency = null;
  try {
    const db = await openAndMigrate(':memory:');
    const intelBySession = new Map();
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makeFixturePipeline(db, intelBySession),
      runtimeContextProvider: async (sid) => ({
        state: {
          activeCatalog: [],
          thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
          stateVersion: 1,
          loadedAt: Date.now(),
        },
        pipeline: makeFixturePipeline(db, intelBySession, sid),
      }),
      fastAgentCaller: async (text) => {
        tailCalls.push(text);
        tailLatency = Date.now();
        return {
          agentState: 'responded',
          nextNeeds: ['verify'],
          recentTopic: text.slice(0, 32),
        };
      },
    });
    try {
      const sessionId = 'fixture-session-A';
      const hashedSessionId = hashSessionId(sessionId);
      const headers = { 'x-memory-studio-session-id': sessionId, 'content-type': 'application/json' };
      const tRequestStart = Date.now();
      const res = await app.inject({
        method: 'POST', url: '/v1/messages', headers, payload: makeAnthropicRequest('hello world'),
      });
      const tResponseEnd = Date.now();
      assert.equal(res.statusCode, 200);
      // Wait up to 1s for the tail to fire AND write the intel.
      const deadline = Date.now() + 1000;
      while (!intelBySession.has(hashedSessionId) && Date.now() < deadline) await sleep(20);
      assert.ok(tailLatency !== null, 'fast-agent tail must run after response');
      assert.ok(tailLatency >= tResponseEnd, 'fast-agent tail must run after response completes (response-first)');
      assert.ok(tailLatency - tRequestStart < 3000, 'fast-agent tail must be fast (<3s)');
      assert.equal(tailCalls.length, 1);
      // Tail reads ASSISTANT text — verify the prompt the fast agent saw
      // was the response text, NOT the user input 'hello world'.
      assert.match(tailCalls[0], /Hello from the assistant/);
      // Intel is stored under the hashed session identity.
      const stored = intelBySession.get(hashedSessionId);
      assert.ok(stored !== undefined, 'intel must be stored under hashed session identity');
      assert.equal(stored.recentTopic.length > 0, true);
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
  }
});

test('proxy turn N+1 reads turn N response-derived intel via the pipeline', async () => {
  const stub = await startJsonUpstream('first response');
  try {
    const db = await openAndMigrate(':memory:');
    const intelBySession = new Map();
    const app = Fastify({ logger: false });
    let tailCalls = 0;
    let readCalls = 0;
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makeFixturePipeline(db, intelBySession),
      runtimeContextProvider: async (sid) => ({
        state: {
          activeCatalog: ['skill-a'],
          thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
          stateVersion: 1,
          loadedAt: Date.now(),
        },
        pipeline: {
          ...makeFixturePipeline(db, intelBySession, sid),
          getIntel(s) { readCalls += 1; return intelBySession.get(s) ?? null; },
        },
      }),
      fastAgentCaller: async () => {
        tailCalls += 1;
        return { agentState: 'rolling', nextNeeds: ['next-step'], recentTopic: 'topic' };
      },
    });
    try {
      const sessionId = 'fixture-session-B';
      const hashedSessionId = hashSessionId(sessionId);
      const headers = { 'x-memory-studio-session-id': sessionId, 'content-type': 'application/json' };
      // Turn N
      await app.inject({ method: 'POST', url: '/v1/messages', headers, payload: makeAnthropicRequest('turn1') });
      // Wait for tail to write intel
      let deadline = Date.now() + 1000;
      while (!intelBySession.has(hashedSessionId) && Date.now() < deadline) await sleep(20);
      assert.ok(intelBySession.has(hashedSessionId), 'turn N must write intel under hashed session identity');
      // Turn N+1 — pipeline must call getIntel to read prior intel.
      const readCallsAfterTurn1 = readCalls;
      await app.inject({ method: 'POST', url: '/v1/messages', headers, payload: makeAnthropicRequest('turn2') });
      // Wait for the getIntel to be called on turn 2.
      deadline = Date.now() + 1000;
      while (readCalls <= readCallsAfterTurn1 && Date.now() < deadline) await sleep(20);
      assert.ok(readCalls > readCallsAfterTurn1, 'turn N+1 pipeline must call getIntel to read prior intel');
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
  }
});

test('proxy fast-agent 429 fails open: provider response still 200, no unbounded retry', async () => {
  const stub = await startJsonUpstream('still responding despite fast-agent failure');
  let unbounded = 0;
  try {
    const db = await openAndMigrate(':memory:');
    const intelBySession = new Map();
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makeFixturePipeline(db, intelBySession),
      runtimeContextProvider: async (sid) => ({
        state: {
          activeCatalog: [],
          thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
          stateVersion: 1,
          loadedAt: Date.now(),
        },
        pipeline: makeFixturePipeline(db, intelBySession, sid),
      }),
      fastAgentCaller: async () => {
        // L-007 fail-open: simulate 429 — throw once, no retry loop.
        unbounded += 1;
        throw new Error('429 too many requests');
      },
    });
    try {
      const sessionId = 'fixture-session-C';
      const hashedSessionId = hashSessionId(sessionId);
      const headers = { 'x-memory-studio-session-id': sessionId, 'content-type': 'application/json' };
      const res = await app.inject({ method: 'POST', url: '/v1/messages', headers, payload: makeAnthropicRequest('hello') });
      assert.equal(res.statusCode, 200, 'provider response must succeed even when tail fast-agent fails');
      // Wait for tail to attempt and fail.
      let deadline = Date.now() + 1000;
      while (unbounded === 0 && Date.now() < deadline) await sleep(20);
      assert.equal(unbounded, 1, 'fast-agent must be called exactly once (no unbounded retry)');
      // Allow the catch handler a moment to run.
      await sleep(50);
      // No intel was stored because the fast-agent failed.
      assert.equal(intelBySession.has(hashedSessionId), false, 'no intel stored when fast-agent fails');
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
  }
});

test('proxy streaming response also triggers the fast-agent tail', async () => {
  const stub = await startStreamingUpstream();
  try {
    const db = await openAndMigrate(':memory:');
    const intelBySession = new Map();
    const app = Fastify({ logger: false });
    let tailRan = false;
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => makeFixturePipeline(db, intelBySession),
      runtimeContextProvider: async (sid) => ({
        state: {
          activeCatalog: [],
          thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
          stateVersion: 1,
          loadedAt: Date.now(),
        },
        pipeline: makeFixturePipeline(db, intelBySession, sid),
      }),
      fastAgentCaller: async (text) => {
        tailRan = true;
        return { agentState: 'stream-done', nextNeeds: [], recentTopic: text.slice(0, 20) };
      },
    });
    try {
      const sessionId = 'fixture-session-D';
      const hashedSessionId = hashSessionId(sessionId);
      const headers = { 'x-memory-studio-session-id': sessionId, 'content-type': 'application/json' };
      const req = makeAnthropicRequest('streaming please');
      req.stream = true;
      const res = await app.inject({ method: 'POST', url: '/v1/messages', headers, payload: req });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /streamed response/);
      // Wait for tail
      let deadline = Date.now() + 1500;
      while (!intelBySession.has(hashedSessionId) && Date.now() < deadline) await sleep(20);
      assert.equal(tailRan, true, 'streaming response must trigger fast-agent tail');
      assert.ok(intelBySession.has(hashedSessionId), 'intel must be stored under hashed session identity');
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
  }
});
