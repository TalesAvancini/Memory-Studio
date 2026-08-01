/**
 * Intel store — the read/write primitives for the `intel` SQLite
 * table (Phase 6b migration 004_intel.sql).
 *
 * The helpers take an explicit `better-sqlite3` `Database` handle
 * for two reasons:
 *
 *   1. **Testability.** Production code (the augment pipeline,
 *      writer.ts) and tests use the same function shape — the test
 *      just passes `:memory:` instead of the on-disk catalog DB.
 *   2. **No module-level state.** A module-scoped DB connection
 *      would leak between tests and would prevent multiple
 *      unrelated DB handles from coexisting (smoke scripts,
 *      catalog-rebuild CLI, etc.). The Pipeline pattern (Phase 5a.2)
 *      already threads `db` through every store helper, so this
 *      module follows the same convention.
 *
 * The barcode / byte-string determinism test
 * (`test/catalog/intel-store.test.mjs`) and the WAL preservation
 * test (`test/catalog/intel-restart.test.mjs`) exercise these
 * helpers end-to-end. The pipeline's `getIntel?` / `writeIntel?`
 * context callbacks (T-13) wrap these primitives — see
 * `src/server/augment/pipeline.ts`.
 *
 * Hot-path read budget: < 5ms p95 (Phase 6a POC measured 0.02ms).
 * The covering index `idx_intel_session_id` lets SQLite avoid the
 * btree root→leaf walk for the PK lookup, so the read is an
 * index-only scan over a small row payload.
 */

import type { Database } from 'better-sqlite3';

import type { Intel } from '../server/fast-agent/intel-schema.ts';
import { deserializeIntel } from '../server/fast-agent/intel-schema.ts';

/**
 * SELECT the Intel literal for a given `session_id` from the
 * catalog DB. Returns `null` when:
 *
 *   - no row exists for `sessionId` (cold start, first request of
 *     a new session)
 *   - the row's `next_needs` JSON is corrupted
 *   - the row fails `IntelSchema.safeParse` (type drift)
 *
 * The caller treats `null` as "no intel" and skips the `## Intel`
 * section in Block 2.  This MUST NOT throw — the augment pipeline
 * runs in the hot path of every request (R-05 fail-open).
 */
export function getIntel(db: Database, sessionId: string): Intel | null {
  const row = db
    .prepare(
      'SELECT agent_state, next_needs, recent_topic FROM intel WHERE session_id = ?',
    )
    .get(sessionId) as
    | { agent_state: string; next_needs: string; recent_topic: string }
    | undefined;
  if (row === undefined) return null;
  return deserializeIntel(row);
}

/**
 * INSERT-or-REPLACE an Intel literal into the catalog DB.
 *
 * `ts` is unix SECONDS (matches `audit_events.ts` column type —
 * INTEGER second-precision is the Phase 5b.1 convention). Callers
 * that want unix-ms should divide by 1000 before passing in.
 *
 * The literal's `nextNeeds` array is JSON-encoded into the
 * `next_needs` TEXT column. The shape round-trips losslessly
 * because `serializeIntel` and `deserializeIntel` mirror each
 * other (and D-006 determinism preserves key order across runs).
 *
 * No batching, no async — the synchronous call IS the write. The
 * async batching fallback (mirroring `AuditRingBuffer` from
 * `src/server/audit/buffer.ts`) is created in
 * `src/server/fast-agent/writer.ts` ONLY if `writer-perf.test.mjs`
 * reports p95 > 1ms.
 */
export function writeIntelRow(
  db: Database,
  sessionId: string,
  intel: Intel,
  ts: number,
): void {
  db.prepare(
    'INSERT OR REPLACE INTO intel (session_id, agent_state, next_needs, recent_topic, ts) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, intel.agentState, JSON.stringify(intel.nextNeeds), intel.recentTopic, ts);
}
