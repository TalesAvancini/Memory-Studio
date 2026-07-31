/**
 * Internal types for the augment pipeline.
 *
 * Phase 5a.2 — the pipeline orchestrator + augmenter + response builder
 * re-use the public Zod-inferred shapes from `src/server/schema.ts`
 * (AugmentRequest, AugmentResponse) and re-export them here so the
 * augment module can declare a single import surface.
 *
 * Why this file exists:
 *   - Keeps the augment subfolder self-contained (every import
 *     resolves inside `src/server/augment/*`).
 *   - Provides a stable seam for tests (which can import these types
 *     without dragging the full server module graph).
 *   - Avoids a circular import: the response builder needs PruningDecisions
 *     from this file, while the augment route handler imports
 *     `runPipeline` from `pipeline.ts` and the augmenter from
 *     `augmenter.ts` — both consume these types.
 */

export type {
  AugmentRequest,
  AugmentResponse,
  Context,
  Fingerprint,
  MatchedSkill,
  MatchedRule,
  MatchedPersona,
  PruningDecisions,
  LatencyMs,
  EmptyReason,
  LastEvent,
  LastEventType,
  LastEventSeverity,
  TodoItem,
} from '../schema.ts';

export type { RejectionEntry } from './thresholds.ts';
