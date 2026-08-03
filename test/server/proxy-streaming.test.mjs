/**
 * Phase 7b T-03 transparent proxy streaming adapter tests.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import Fastify from 'fastify';
import { registerMessagesProxyRoute } from '../../src/server/routes/messages-proxy.ts';
import { createSseTee } from '../../src/server/proxy/sse-tee.ts';
import { openAndMigrate } from '../../src/catalog/db/open.ts';

function sseEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function encode(text) {
  return new TextEncoder().encode(text);
}

test('sse tee captures usage and assistant text without buffering', async () => {
  const tee = createSseTee();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encode(sseEvent('message_start', {
        type: 'message_start', message: {
          type: 'message', id: 'msg',
          content: [],
          usage: { cache_read_input_tokens: 11, input_tokens: 30 },
        },
      })));
      controller.enqueue(encode(sseEvent('content_block_start', {
        type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
      })));
      controller.enqueue(encode(sseEvent('content_block_delta', {
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' },
      })));
      controller.enqueue(encode(sseEvent('content_block_delta', {
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' },
      })));
      controller.enqueue(encode(sseEvent('message_delta', {
        type: 'message_delta',
        delta: {},
        usage: { cache_read_input_tokens: 42, input_tokens: 99, output_tokens: 5 },
      })));
      controller.enqueue(encode('event: message_stop\ndata: {}\n\n'));
      controller.enqueue(encode('data: [DONE]\n\n'));
      controller.close();
    },
  });

  await tee.tee(body);
  assert.equal(tee.completed, true);
  assert.equal(tee.usage.cacheReadInputTokens, 42);
  assert.equal(tee.usage.inputTokens, 99);
  assert.equal(tee.usage.outputTokens, 5);
  assert.equal(tee.usage.cacheCreationInputTokens, null);
  assert.equal(tee.assistantText, 'Hello world');
});

function startStubUpstream(chunks) {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      (async () => {
        for (const chunk of chunks) {
          res.write(chunk);
          await new Promise((r) => setTimeout(r, 20));
        }
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

test('proxy relays streaming bytes and records usage after completion', async () => {
  const chunks = [
    sseEvent('message_start', {
      type: 'message_start',
      message: { type: 'message', content: [], usage: { input_tokens: 21 } },
    }),
    sseEvent('content_block_delta', {
      type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: 'STREAMED ' },
    }),
    sseEvent('message_delta', {
      type: 'message_delta', delta: {},
      usage: { cache_read_input_tokens: 17, output_tokens: 9 },
    }),
    'data: [DONE]\n\n',
  ];
  const stub = await startStubUpstream(chunks);
  try {
    const db = await openAndMigrate(':memory:');
    const app = Fastify({ logger: false });
    await registerMessagesProxyRoute(app, {
      upstreamUrl: `http://127.0.0.1:${stub.port}`,
      pipelineProvider: () => ({
        db,
        embedder: { dimensions: 384, async encode() { return new Float32Array(384); } },
        thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
        retrieve() {
          return { ranked: [], ftsTotalHits: 0, retrievalMs: 0 };
        },
      }),
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        payload: {
          model: 'claude-sonnet-4-5',
          max_tokens: 64,
          stream: true,
          messages: [{ role: 'user', content: 'hello' }],
        },
      });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /STREAMED/);
      assert.match(res.body, /cache_read_input_tokens.:17/);
    } finally {
      await app.close();
      await db.close();
    }
  } finally {
    await stub.close();
  }
});
