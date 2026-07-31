/**
 * Response builder for the `/augment` pipeline.
 *
 * Phase 5a.2 — assembles the full `AugmentResponse` from the orchestrator
 * output: the SHA-256 hex of the 2-block system message, the partitioned
 * matched arrays, the structured latency timings, the
 * `decisionTraceId` UUID, warnings, and the `emptyReason` enum.
 *
 * The response shape is defined in `src/server/schema.ts`
 * (`AugmentResponseSchema`) and is intentionally 1:1 with PRD §7.1.
 * `cacheHit` is OMITTED — provider cache metrics surface via the
 * structured log line's `usage.cache_read_input_tokens` field (R-15,
 * R-16), not in the response body.
 */

import { randomUUID } from 'node:crypto';
import type {
  AugmentRequest,
  AugmentResponse,
  Context,
  EmptyReason,
  LatencyMs,
  PruningDecisions,
  RejectionEntry,
} from './types.ts';
import { emptyPruningDecisions, partitionByKind } from './augmenter.ts';
import type { RankedItem } from './retrieval.ts';

/** Per-phase latency in milliseconds (Phase 5a.2 + Phase 5a.4 perf budget). */
export interface LatencyTimings {
  readonly embeddingMs: number;
  readonly retrievalMs: number;
  /** Always 0 in Phase 5a.2 — rerank is a future capability. */
  readonly rerankMs: number;
  /** Total wall-clock since the request entered the route handler. */
  readonly totalMs: number;
}

/** Inputs the response builder needs from the pipeline. */
export interface BuildResponseInput {
  readonly request: AugmentRequest;
  /** SHA-256 hex of the canonical 2-block system message. */
  readonly systemMessage: string;
  /** Tiebreak-sorted, top-K-truncated matched items. */
  readonly matched: ReadonlyArray<RankedItem>;
  /** Threshold rejections. */
  readonly rejectedByFloor: ReadonlyArray<RejectionEntry>;
  /** Top-K + other warnings (e.g. "only 2 items above threshold"). */
  readonly warnings: ReadonlyArray<string>;
  /** Latency timings. */
  readonly latency: LatencyTimings;
  /** Optional explicit override. When `null` or `undefined`, computed. */
  readonly emptyReason?: EmptyReason | null;
  /** Decision trace ID override (default: random UUIDv4). */
  readonly decisionTraceId?: string;
}

/**
 * Build the full `AugmentResponse`. Pure function — no I/O, no global
 * state. Deterministic given the same input (UUID aside).
 */
export function buildResponse(input: BuildResponseInput): AugmentResponse {
  const { matched } = input;
  const partitioned = partitionByKind(matched);

  const pruning: PruningDecisions = {
    ...emptyPruningDecisions(),
    rejectedByFloor: input.rejectedByFloor.map((r) => ({
      id: r.id,
      reason: r.reason,
    })) as Array<{ id: string; reason: string }>,
  };

  const latencyMs: LatencyMs = {
    embedding: round3(input.latency.embeddingMs),
    retrieval: round3(input.latency.retrievalMs),
    rerank: round3(input.latency.rerankMs),
    total: round3(input.latency.totalMs),
  };

  const emptyReason: EmptyReason = computeEmptyReason({
    explicit: input.emptyReason,
    matchedCount: matched.length,
    request: input.request,
  });

  return {
    systemMessage: input.systemMessage,
    matchedSkills: [...partitioned.skills],
    matchedRules: [...partitioned.rules],
    matchedPersonas: [...partitioned.personas],
    pruningDecisions: pruning,
    latencyMs,
    decisionTraceId: input.decisionTraceId ?? randomUUID(),
    warnings: [...input.warnings],
    emptyReason,
    schemaVersion: 3,
  };
}

/**
 * Compute the `emptyReason` enum for the response. Priority:
 *
 *   1. Explicit override (used by social / no-active-items / fail-open paths).
 *   2. `null` — matched array is non-empty (no empty signal).
 *   3. `'low_confidence'` — matched array is empty.
 */
function computeEmptyReason(opts: {
  explicit: EmptyReason | undefined;
  matchedCount: number;
  request: AugmentRequest;
}): EmptyReason {
  if (opts.explicit !== undefined) return opts.explicit;
  if (opts.matchedCount > 0) return null;
  // Context is ignored here on purpose: even with no context, a prompt
  // that matches ≥1 item returns `null`. An empty matched set with no
  // override surfaces as `low_confidence` (PRD §10.1 item 9).
  void opts.request;
  return 'low_confidence';
}

/** Round to 3 decimal places for log readability. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Re-export the context type for tests. */
export type { Context };
