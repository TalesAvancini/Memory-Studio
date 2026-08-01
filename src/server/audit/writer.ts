/**
 * SQLite batch writer for the audit_events table (D-007).
 *
 * Phase 5b ships the write side of the audit pipeline. The buffer
 * (`buffer.ts`) accumulates events and calls `writeBatch()` on
 * triggers (N=100 OR T=1000ms). The writer wraps the insert in a
 * `db.transaction()` so a failure during one of the inserts rolls
 * the whole batch back. Errors propagate to `buffer.flush()`'s
 * catch — the request that triggered the enqueue is never blocked.
 *
 * The column list matches `001_init.sql:49-60` exactly:
 *   ts, "tenantId_hashed", event_type, payload, fingerprint,
 *   matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash
 *
 * JSON fields (payload, fingerprint, matched_ids, pruning_reasons)
 * are stringified before insert. NULL tenantId_hashed becomes a
 * literal NULL (no placeholder hash).
 */

import type { Database } from 'better-sqlite3';
import type { AuditEvent, AuditWriter } from './types.ts';

export function createBetterSqliteAuditWriter(db: Database): AuditWriter {
  const stmt = db.prepare(`
    INSERT INTO audit_events (
      ts, "tenantId_hashed", event_type, payload, fingerprint,
      matched_ids, pruning_reasons, latency_ms, redacted_prompt_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return {
    async writeBatch(events: ReadonlyArray<AuditEvent>): Promise<void> {
      const tx = db.transaction((batch: ReadonlyArray<AuditEvent>): void => {
        for (const e of batch) {
          stmt.run(
            e.ts,
            e.tenantIdHashed,
            e.eventType,
            JSON.stringify(e.payload),
            e.fingerprint ? JSON.stringify(e.fingerprint) : null,
            JSON.stringify(e.matchedIds),
            JSON.stringify(e.pruningReasons),
            e.latencyMs,
            e.redactedPromptHash,
          );
        }
      });
      // The transaction throws on failure; the buffer's catch handles it.
      tx(events);
    },
  };
}