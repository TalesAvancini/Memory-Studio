/**
 * Audit buffer lifecycle (Phase 5b T-03).
 *
 * Manages the module-scoped singleton `AuditRingBuffer`:
 *   - `initAuditBuffer(db)` — creates the writer from a better-sqlite3
 *     connection and wires it into the buffer. Idempotent — subsequent
 *     calls return the same instance.
 *   - `getAuditBuffer()` — returns the singleton (or null if not yet
 *     initialized).
 *   - `startAuditBuffer()` — no-op placeholder for now (timer is lazy).
 *   - `stopAuditBuffer()` — flushes the remainder with reason
 *     `'shutdown'` and clears the timer. Wired into `boot.ts` SIGTERM.
 *   - `setAuditBufferForTests(buffer)` — inject a custom buffer (e.g.
 *     a stub writer that throws). Reset with `null`.
 */

import type { Database } from 'better-sqlite3';
import { AuditRingBuffer } from './buffer.ts';
import { createBetterSqliteAuditWriter } from './writer.ts';
import type { AuditBufferSnapshot } from './buffer.ts';

let bufferInstance: AuditRingBuffer | null = null;

export function initAuditBuffer(db: Database): AuditRingBuffer {
  if (bufferInstance !== null) return bufferInstance;
  const writer = createBetterSqliteAuditWriter(db);
  bufferInstance = new AuditRingBuffer(writer);
  return bufferInstance;
}

export function getAuditBuffer(): AuditRingBuffer | null {
  return bufferInstance;
}

/**
 * Snapshot of the buffer's state for the `/health` endpoint. Returns
 * `null` when the buffer has not been initialized (the route returns
 * the snapshot directly when present; the route also surfaces
 * `audit_buffer: null` in that case to keep the response shape stable).
 */
export function getAuditBufferSnapshot(): AuditBufferSnapshot | null {
  if (bufferInstance === null) return null;
  return bufferInstance.snapshot();
}

export async function startAuditBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  bufferInstance.start();
}

export async function stopAuditBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  await bufferInstance.stop();
}

/** Test-only — inject a custom buffer (or null to reset). */
export function setAuditBufferForTests(buffer: AuditRingBuffer | null): void {
  bufferInstance = buffer;
}

/** Test-only — reset module-scoped state between runs. */
export function resetAuditBufferForTests(): void {
  if (bufferInstance !== null) {
    bufferInstance.resetForTests();
  }
  bufferInstance = null;
}