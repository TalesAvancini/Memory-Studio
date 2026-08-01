/**
 * Server module public barrel.
 *
 * Phase 5a.1 ships the surface needed by the entry script and the smoke
 * tests; deeper orchestration (retrieval, thresholds, top-K, augmenter)
 * arrives in Phase 5a.2.
 */

export {
  createServer,
  DEFAULT_AUGMENT_PORT_RANGE,
  AUGMENT_HOST,
  getServerStartTimeMs,
  getLastRequestTimestampMs,
  recordLastRequestTimestampMs,
  resetServerMetadataForTests,
  parsePortRangeEnv,
  type AugmentServerOptions,
  type AugmentServerHandle,
} from './boot.ts';

export {
  AugmentRequestSchema,
  AugmentResponseSchema,
  ContextSchema,
  FingerprintSchema,
  type AugmentRequest,
  type AugmentResponse,
  type Context,
  type Fingerprint,
} from './schema.ts';

export { registerAugmentRoute, recordAugmentSuccess } from './augment.ts';
export { registerHealthRoute } from './health.ts';

// Phase 5b — audit async/fail-open runtime (D-007 CRITICAL). Additive
// re-exports; Phase 5a consumers continue to work unchanged.
export {
  FLUSH_COUNT_TRIGGER,
  FLUSH_TIME_MS,
  RING_BUFFER_CAPACITY,
  AuditRingBuffer,
  redactPlaceholders,
  redactObjectRecursive,
} from './audit/index.ts';
export type {
  AuditEvent,
  AuditRow,
  AuditWriter,
  AuditEventType,
  AuditBufferSnapshot,
  FlushReason,
} from './audit/index.ts';