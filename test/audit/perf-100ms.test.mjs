/**
 * Audit query perf gate (Phase 5b T-08 + R-15 + PRD §10.4.3).
 *
 * Seeds 1000 audit rows then fires 10 GET /audit?range=30days
 * requests, asserts max wall-clock < 100ms (per PRD §10.4.3).
 *
 * The query uses the idx_audit_events_ts index added by migration
 * 003 to keep the ORDER BY ts DESC + range filter cheap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openAndMigrate } from '../../src/catalog/db/open.ts';
import { createServer } from '../../src/server/index.ts';
import { resetAuditBufferForTests } from '../../src/server/audit/lifecycle.ts';

test('GET /audit?range=30days with 1000 rows returns in <100ms (PRD §10.4.3)', async () => {
  const db = await openAndMigrate(':memory:');
  resetAuditBufferForTests();
  const server = await createServer({
    portRange: [47300, 47399], // distinct from endpoints/audit-row ranges
    db,
    fastifyOptions: { logger: false },
  });

  try {
    // Seed 1000 rows with timestamps spread across the last 30 days.
    const day = 86_400_000;
    const now = Date.now();
    const stmt = db.prepare(
      `INSERT INTO audit_events
         (ts, "tenantId_hashed", event_type, payload, fingerprint, matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const seedTx = db.transaction(() => {
      for (let i = 0; i < 1000; i += 1) {
        const ts = now - (i * 1000 * 30); // spread over 30 days
        stmt.run(
          ts,
          `hash${i.toString(16).padStart(12, '0')}`.slice(0, 16),
          'augment',
          '{}',
          null,
          '[]',
          '[]',
          10,
          'a'.repeat(64),
        );
      }
    });
    seedTx();

    // Warmup request (not measured).
    await fetch(`${server.url}/audit?range=30days`);

    // 10 measured requests; assert max wall-clock < 100ms.
    const elapsed = [];
    for (let i = 0; i < 10; i += 1) {
      const t0 = performance.now();
      const res = await fetch(`${server.url}/audit?range=30days`);
      await res.json();
      const ms = performance.now() - t0;
      elapsed.push(ms);
    }
    const max = Math.max(...elapsed);
    const median = elapsed.sort()[Math.floor(elapsed.length / 2)];

    assert.ok(
      max < 100,
      `GET /audit?range=30days must return in <100ms (max ${max.toFixed(2)}ms, median ${median.toFixed(2)}ms, samples ${JSON.stringify(elapsed.map((e) => e.toFixed(2)))})`,
    );
  } finally {
    await server.close();
    resetAuditBufferForTests();
  }
});