/**
 * Audit event/row types for the Phase 5b audit async runtime.
 *
 * Per PRD §10.3.1 + SPEC §IMod-8 (D-007 CRITICAL) the audit row
 * contains ZERO raw prompt/context text — only metadata hashes and
 * JSON-encoded arrays. The shape is enforced by `writer.ts` (which
 * inserts into the existing `audit_events` table from migration 001)
 * and by the `/audit` + `/audit/summary` query helpers in
 * `query.ts`.
 *
 * The AuditEvent is the in-memory shape produced by `runPipeline` and
 * consumed by `AuditRingBuffer.enqueue()`. The AuditRow mirrors the
 * SQLite column shape so `writer.ts` can keep its prepared statement
 * strictly typed.
 */

export type AuditEventType =
  | 'augment'
  | 'messages_proxy'
  | 'catalog_rebuild'
  | 'state_toggle';

/**
 * In-memory audit event. Carried from the request handler through the
 * ring buffer to the SQLite writer. All fields are readonly so the
 * buffer/writer cannot mutate the producer's data.
 */
export interface AuditEvent {
  readonly ts: number;
  readonly tenantIdHashed: string | null;
  readonly redactedPromptHash: string;
  readonly matchedIds: ReadonlyArray<string>;
  readonly pruningReasons: ReadonlyArray<string>;
  readonly latencyMs: number;
  readonly fingerprint: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly eventType: AuditEventType;
}

/**
 * Row shape mirroring the `audit_events` table. The Phase 2 migration
 * renamed `tenant_hash` → `"tenantId_hashed"` (mixed-case + quoted to
 * preserve case in SQLite). The `id` is assigned by SQLite on insert.
 */
export interface AuditRow {
  readonly id: number;
  readonly ts: number;
  readonly tenantIdHashed: string | null;
  readonly eventType: string;
  readonly payload: string;
  readonly fingerprint: string | null;
  readonly matchedIds: string | null;
  readonly pruningReasons: string | null;
  readonly latencyMs: number | null;
  readonly redactedPromptHash: string | null;
}

/**
 * Writer interface. The buffer holds an injected writer so tests can
 * swap a stub that throws (fail-open smoke) without touching the real
 * SQLite writer.
 */
export interface AuditWriter {
  writeBatch(events: ReadonlyArray<AuditEvent>): Promise<void>;
}