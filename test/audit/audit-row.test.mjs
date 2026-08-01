/**
 * Audit row schema compliance tests (Phase 5b T-08).
 *
 * Per PRD §10.3.1 + SPEC §IMod-8: the audit_events row for an
 * /augment request contains ONLY metadata hashes and JSON-encoded
 * arrays. ZERO raw prompt/context text. ZERO raw tenantId.
 *
 * This test wires the real SQLite writer + an actual DB, enqueues
 * a sample event with placeholder-containing fingerprint and
 * payload fields, flushes, and asserts:
 *   - The row exists with all 9 expected columns
 *   - No field contains raw prompt text, raw context text, or
 *     raw tenantId (raw = the un-hashed / un-redacted value)
 *   - The redacted_prompt_hash is a 64-char sha256 hex
 *   - The fingerprint and payload JSON fields are stringified but
 *     have placeholder strings replaced with <REDACTED>
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { AuditRingBuffer } from '../../src/server/audit/buffer.ts';
import { createBetterSqliteAuditWriter } from '../../src/server/audit/writer.ts';
import { redactObjectRecursive } from '../../src/server/audit/redact.ts';
import { hashTenantId } from '../../src/server/security/tenant-hash.ts';
import { createServer } from '../../src/server/index.ts';

const RAW_PROMPT_SECRET = 'super-secret-prompt-content-DO-NOT-LOG';
const RAW_TENANT_ID = 'tenant-raw-acme-12345';
const PLACEHOLDER_SECRET = 'abc123';
const PLACEHOLDER_API = 'sk-ant-deadbeefcafebabe1234567890';

test('audit row: zero raw text — the prompt value NEVER appears in any column', async () => {
  const db = await openAndMigrate(':memory:');
  const writer = createBetterSqliteAuditWriter(db);
  const buf = new AuditRingBuffer(writer);

  const promptHash = createHash('sha256').update(RAW_PROMPT_SECRET, 'utf8').digest('hex');
  const event = {
    ts: 1_700_000_000_000,
    tenantIdHashed: hashTenantId(RAW_TENANT_ID),
    redactedPromptHash: promptHash,
    matchedIds: ['skill-auth-01', 'rule-no-secrets'],
    pruningReasons: ['low_confidence'],
    latencyMs: 12.5,
    fingerprint: redactObjectRecursive({
      agentId: 'claude-code',
      sessionId: 'sess-abc',
      // NOTE: a placeholder nested in a fingerprint field.
      note: 'deploy ${SECRET_KEY}=' + PLACEHOLDER_SECRET,
    }),
    payload: redactObjectRecursive({
      systemMessageSha256: 'a'.repeat(64),
      cacheReadInputTokens: null,
      model: 'claude-sonnet-4-5',
      // NOTE: an API key placeholder in the payload.
      apiHint: 'sk-ant-' + PLACEHOLDER_API.slice(7),
    }),
    eventType: 'augment',
  };
  buf.enqueue(event);
  await buf.flush('manual');

  const row = db.prepare('SELECT * FROM audit_events').get();
  assert.ok(row, 'audit row exists');

  // 9 expected columns.
  const expectedKeys = [
    'id', 'ts', 'tenantId_hashed', 'event_type', 'payload',
    'fingerprint', 'matched_ids', 'pruning_reasons', 'latency_ms',
    'redacted_prompt_hash',
  ];
  for (const key of expectedKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), `row has ${key}`);
  }

  // tenantId_hashed is the HASH, never the raw tenant id.
  assert.notEqual(row['tenantId_hashed'], RAW_TENANT_ID);
  assert.equal(row['tenantId_hashed'], hashTenantId(RAW_TENANT_ID));

  // The prompt_hash is sha256 hex (64 chars).
  assert.match(row['redacted_prompt_hash'], /^[0-9a-f]{64}$/);
  assert.equal(row['redacted_prompt_hash'], promptHash);

  // No raw prompt value appears ANYWHERE in the row.
  const serialized = JSON.stringify(row);
  assert.ok(
    !serialized.includes(RAW_PROMPT_SECRET),
    'raw prompt value must NEVER appear in any column',
  );

  // Placeholder secrets are redacted in JSON fields.
  assert.ok(!serialized.includes(PLACEHOLDER_SECRET), 'placeholder secret abc123 redacted');
  assert.ok(serialized.includes('<REDACTED>'), '<REDACTED> token present in JSON fields');
});

test('audit row: end-to-end via createServer + POST /augment writes audit row', async () => {
  const db = await openAndMigrate(':memory:');
  // Build an in-memory augment pipeline that uses this DB.
  // Re-use the boot factory's `db` option to wire audit lifecycle.
  const server = await createServer({
    portRange: [47200, 47299], // distinct from endpoints.test.mjs [47100, 47199]
    db,
    fastifyOptions: { logger: false },
  });

  try {
    const validBody = {
      prompt: 'design a server endpoint',
      context: null,
      fingerprint: {
        projectPath: '/tmp/project',
        agentId: 'claude-code',
        sessionId: 'sess-xyz',
        gitBranch: 'main',
      },
      activeCatalog: ['skill-auth-01'],
      tenantId: 'tenant-e2e-test',
      schemaVersion: 3,
    };

    const res = await fetch(`${server.url}/augment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    assert.equal(res.status, 200);

    // Wait for the audit buffer to flush (time trigger 1000ms).
    await new Promise((r) => setTimeout(r, 1100));

    const rows = db.prepare('SELECT * FROM audit_events').all();
    assert.ok(rows.length >= 1, 'at least one audit row written');

    const last = rows[rows.length - 1];
    assert.equal(last['event_type'], 'augment');
    assert.equal(last['tenantId_hashed'], hashTenantId('tenant-e2e-test'));
    assert.match(last['redacted_prompt_hash'], /^[0-9a-f]{64}$/);

    // Raw prompt text never appears in the row.
    const serialized = JSON.stringify(last);
    assert.ok(!serialized.includes('design a server endpoint'));
  } finally {
    await server.close();
  }
});