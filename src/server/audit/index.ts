/**
 * Audit module barrel (Phase 5b).
 *
 * Re-exports the public surface of `src/server/audit/**` so callers
 * (lifecycle.ts, the augment route, the transparent proxy route) can
 * import from a single path. Pure re-exports only — no logic.
 */

export {
  FLUSH_COUNT_TRIGGER,
  FLUSH_TIME_MS,
  RING_BUFFER_CAPACITY,
  AuditRingBuffer,
} from './buffer.ts';
export type { AuditBufferSnapshot, FlushReason } from './buffer.ts';

export type { AuditEvent, AuditRow, AuditWriter, AuditEventType } from './types.ts';

export {
  redactPlaceholders,
  redactObjectRecursive,
  PLACEHOLDER_PATTERNS,
} from './redact.ts';