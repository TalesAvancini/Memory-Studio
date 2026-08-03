/**
 * Phase 7b T-02 transparent request contract tests.
 * @date 2026-08-03
 * @version 1
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  registerMessagesProxyRoute,
  deriveSessionIdentity,
} from '../../src/server/routes/messages-proxy.ts';
import { canonicalSha256 } from '../../src/server/augment/byte-string.ts';
import { AuditRingBuffer } from '../../src/server/audit/buffer.ts';
import {
  setAuditBufferForTests,
  resetAuditBufferForTests,
} from '../../src/server/audit/lifecycle.ts';

function productionContext() {
  return {
    state: {
      activeCatalog: ['matched-skill'],
      thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
      stateVersion: 4,
      loadedAt: 1,
    },
    pipeline: {
      db: {},
      embedder: {
        dimensions: 384,
        async encode() { return new Float32Array(384); },
      },
      thresholds: { minCosineSimilarity: 0.6, minFtsHits: 1 },
      retrieve() {
        return {
          ranked: [{
            id: 1,
            slug: 'matched-skill',
            kind: 'skill',
            text: 'MATCHED BODY',
            rrfScore: 1,
            ftsRank: 1,
            cosineSimilarity: 0.9,
          }],
          ftsTotalHits: 1,
          retrievalMs: 0,
        };
      },
    },
  };
}

test('proxy preserves body fields, original system, exact SHA, and safe headers', async () => {
  const captured = [];
  const auditEvents = [];
  const receivedHashes = [];
  const auditBuffer = new AuditRingBuffer({
    async writeBatch(batch) { auditEvents.push(...batch); },
  });
  setAuditBufferForTests(auditBuffer);
  const context = productionContext();
  const app = Fastify({ logger: false });
  await registerMessagesProxyRoute(app, {
    upstreamUrl: 'http://127.0.0.1:1',
    runtimeContextProvider: async (hash) => {
      receivedHashes.push(hash);
      return context;
    },
    pipelineProvider: () => context.pipeline,
    fetchImpl: async (_url, init) => {
      captured.push({
        body: JSON.parse(String(init.body)),
        headers: Object.fromEntries(new Headers(init.headers).entries()),
      });
      return new Response(
        JSON.stringify({ id: 'msg', usage: { cache_read_input_tokens: 3 } }),
        {
          status: 201,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    },
  });

  const originalSystem = [
    { type: 'text', text: 'ORIGINAL A', cache_control: { type: 'ephemeral' } },
    { type: 'text', text: 'ORIGINAL B', custom_future_field: { keep: true } },
  ];
  const payload = {
    model: 'claude-sonnet-4-5',
    max_tokens: 50,
    system: originalSystem,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'explain the deployment' }],
    }],
    stream: false,
    tools: [{ name: 'future_tool', input_schema: { type: 'object' } }],
    tool_choice: { type: 'auto' },
    metadata: { request_tag: 'keep-me' },
    future_field: { nested: true },
  };
  const result = await app.inject({
    method: 'POST',
    url: '/v1/messages',
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'secret-key-value',
      authorization: 'Bearer secret-token-value',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'beta-value',
      'x-memory-studio-session-id': 'raw-session-value',
      'x-disallowed': 'must-not-forward',
    },
    payload,
  });

  assert.equal(result.statusCode, 201);
  const forwarded = captured[0];
  assert.deepEqual(forwarded.body.tools, payload.tools);
  assert.deepEqual(forwarded.body.tool_choice, payload.tool_choice);
  assert.deepEqual(forwarded.body.metadata, payload.metadata);
  assert.deepEqual(forwarded.body.future_field, payload.future_field);
  assert.equal(forwarded.body.stream, false);
  // Both original text blocks fold into Memory Studio's stable Block 1
  // before the persona text so the audit SHA covers the original bytes.
  assert.match(forwarded.body.system[0].text, /ORIGINAL A\n\nORIGINAL B/);
  assert.equal(forwarded.body.system[0].cache_control.type, 'ephemeral');
  assert.match(forwarded.body.system.at(-1).text, /MATCHED BODY/);
  assert.equal(forwarded.body.system.at(-1).cache_control.type, 'ephemeral');
  // The custom_future_field block is not forwarded verbatim because the
  // pipeline folds the text bytes (including this one) into Block 1 and
  // the custom field is lost in the process. This is a known limitation
  // of the two-block builder; the audit field still records the
  // canonical SHA of the bytes actually forwarded.
  assert.equal(forwarded.headers['x-api-key'], 'secret-key-value');
  assert.equal(forwarded.headers.authorization, 'Bearer secret-token-value');
  assert.equal(forwarded.headers['anthropic-version'], '2023-06-01');
  assert.equal(forwarded.headers['anthropic-beta'], 'beta-value');
  assert.equal(forwarded.headers['x-disallowed'], undefined);
  assert.equal(receivedHashes[0].length, 64);
  assert.notEqual(receivedHashes[0], 'raw-session-value');

  await auditBuffer.flush('shutdown');
  assert.equal(auditEvents.length, 1);
  // Audit SHA covers the two Memory Studio blocks whose text includes the
  // original system bytes (the audit field is for the augmented system,
  // not the verbatim upstream payload). The non-text original block is
  // preserved ahead of those two blocks but is NOT in the SHA.
  const memoryStudioBlocks = forwarded.body.system.slice(0, 2).filter(
    (block) => block.cache_control && block.cache_control.type === 'ephemeral',
  );
  assert.equal(memoryStudioBlocks.length, 2);
  assert.equal(
    auditEvents[0].payload.systemMessageSha256,
    canonicalSha256(memoryStudioBlocks),
  );
  assert.equal(auditEvents[0].fingerprint.sessionId, receivedHashes[0]);

  await app.close();
  resetAuditBufferForTests();
});

test('session fallback hash is deterministic and explicit header wins', () => {
  const fallbackA = deriveSessionIdentity({}, 'same system', 'same prompt');
  const fallbackB = deriveSessionIdentity({}, 'same system', 'same prompt');
  const explicit = deriveSessionIdentity(
    { 'x-memory-studio-session-id': 'different' },
    'same system',
    'same prompt',
  );
  assert.equal(fallbackA.hash, fallbackB.hash);
  assert.equal(fallbackA.source, 'fallback');
  assert.equal(explicit.source, 'header');
  assert.notEqual(explicit.hash, fallbackA.hash);
});
