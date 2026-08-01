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