/**
 * Pipeline orchestrator for the `/augment` endpoint.
 *
 * Phase 5a.2 (T-08) — composes the full retrieval + augmentation
 * pipeline. The route handler (`src/server/augment.ts`) calls
 * `runAugment(req, ctx)` and returns the `AugmentResponse` it builds.
 *
 * Pipeline stages (each is a single function or composes a small
 * module so the unit test surface stays small):
 *
 *   1. Social gate — `isSocial(prompt)` → persona-only path on match.
 *   2. activeCatalog vazio (D-008) — persona-only with `no_active_items`.
 *   3. activeCatalog filesystem validation — drops missing YAMLs.
 *   4. Embed query — caller-supplied `embedder.encode(prompt)`.
 *   5. Retrieval — FTS5 + sqlite-vec + RRF + hydration + active filter.
 *   6. Thresholds — double gate (cosine + FTS hits).
 *   7. Top-K + tiebreak (D-006) — 3-5 items, slug-sorted.
 *   8. Augmenter — 2-block `cache_control: ephemeral` + SHA-256 hex.
 *   9. Response builder — partition + latency + decisionTraceId.
 *
 * Fail-open semantics (PRD §2):
 *   - Any retrieval error (embed / FTS / vec) is caught and the
 *     response becomes persona-only with `emptyReason: 'timeout'`.
 *   - The server NEVER returns 500 for retrieval errors. Validation
 *     errors are the route handler's responsibility and are reported
 *     separately as 400.
 *
 * The orchestrator is test-friendly: it accepts a `PipelineContext`
 * (db, embedder, search) so tests can swap in in-memory fixtures
 * without touching the real ONNX model.
 */

import { isSocial } from '../../social-detector/index.ts';
import type { Embedder } from '../../catalog/embedder/types.ts';
import { runRetrieval } from './retrieval.ts';
import type { RankedItem } from './retrieval.ts';
import {
  applyThresholds,
  validateActiveCatalogIds,
  type RejectionEntry,
} from './thresholds.ts';
import { topKAndTiebreak, DEFAULT_MIN_K, DEFAULT_MAX_K } from './top-k.ts';
import { buildSystemMessage } from './augmenter.ts';
import { buildResponse, type LatencyTimings } from './response.ts';
import type { AugmentRequest, AugmentResponse, EmptyReason } from './types.ts';

import type { Database } from 'better-sqlite3';

/** Caller-supplied context. */
export interface PipelineContext {
  readonly db: Database;
  readonly embedder: Embedder;
  /**
   * Absolute path to the catalog YAML directory. When provided, the
   * orchestrator validates each activeCatalog id against
   * `<catalogDir>/<id>.yaml`. Missing files are surfaced as
   * `pruningDecisions.rejectedByFloor[]` with `id_not_in_catalog`.
   */
  readonly catalogDir?: string;
  /**
   * Optional override of the embedding callback. Defaults to
   * `embedder.encode(prompt)`. Tests inject a deterministic stub.
   */
  readonly encodeQuery?: (prompt: string) => Promise<Float32Array>;
}

/** Internal pipeline result. */
interface PipelineRun {
  readonly response: AugmentResponse;
}

/**
 * The full /augment pipeline orchestrator. Single entry point used by
 * the route handler. Pure (no global state) — caller owns the db,
 * embedder, and config.
 */
export async function runAugment(
  request: AugmentRequest,
  context: PipelineContext,
): Promise<AugmentResponse> {
  const t0 = performance.now();
  const encode = context.encodeQuery ?? ((p: string) => context.embedder.encode(p));

  // --- Stage 1: Social gate ----------------------------------------------
  if (isSocial(request.prompt)) {
    return personaOnlyResponse(request, t0, 'social');
  }

  // --- Stage 2: activeCatalog vazio (D-008) -------------------------------
  if (request.activeCatalog.length === 0) {
    return personaOnlyResponse(request, t0, 'no_active_items');
  }

  // --- Stage 3: filesystem validation ------------------------------------
  let validActiveCatalog: ReadonlyArray<string> = request.activeCatalog;
  let rejectedByFloor: RejectionEntry[] = [];
  if (context.catalogDir !== undefined) {
    const validated = validateActiveCatalogIds(request.activeCatalog, context.catalogDir);
    validActiveCatalog = validated.valid;
    rejectedByFloor = [...validated.rejected];
    if (validActiveCatalog.length === 0) {
      // All active catalog entries are missing on disk — return
      // persona-only with `no_active_items` (consistent with D-008).
      return personaOnlyResponse(request, t0, 'no_active_items', rejectedByFloor);
    }
  }

  // --- Stage 4: Embed query ----------------------------------------------
  let queryVec: Float32Array;
  let embeddingMs = 0;
  try {
    const tEmbed = performance.now();
    queryVec = await encode(request.prompt);
    embeddingMs = performance.now() - tEmbed;
  } catch (err) {
    return failOpenResponse(request, t0, embeddingMs, err);
  }

  // --- Stage 5: Retrieval (FTS + vec + RRF + hydrate + active filter) ---
  let retrievalMs = 0;
  let ranked: ReadonlyArray<RankedItem>;
  try {
    const out = runRetrieval(context.db, request.prompt, queryVec, validActiveCatalog);
    ranked = out.ranked;
    retrievalMs = out.retrievalMs;
  } catch (err) {
    return failOpenResponse(request, t0, embeddingMs, err);
  }

  // --- Stage 6: Double threshold -----------------------------------------
  const { passed, rejected } = applyThresholds(ranked);
  rejectedByFloor = [...rejectedByFloor, ...rejected];

  // --- Stage 7: Top-K + tiebreak (D-006) --------------------------------
  const { matched, warnings: topKWarnings } = topKAndTiebreak(passed, {
    minK: DEFAULT_MIN_K,
    maxK: DEFAULT_MAX_K,
  });

  // --- Stage 8: Augmenter (2-block cache_control + SHA-256) --------------
  const { sha256 } = buildSystemMessage(request, {
    matched,
    context: request.context,
    warnings: topKWarnings,
  });

  // --- Stage 9: Response builder ----------------------------------------
  const totalMs = performance.now() - t0;
  const latency: LatencyTimings = {
    embeddingMs,
    retrievalMs,
    rerankMs: 0,
    totalMs,
  };

  return buildResponse({
    request,
    systemMessage: sha256,
    matched,
    rejectedByFloor,
    warnings: topKWarnings,
    latency,
  });
}

/**
 * Build the persona-only response for the social / no-active-items /
 * all-missing-active-catalog paths. The systemMessage is the SHA-256
 * hex of a 2-block structure where block 2 is empty (D-006 still
 * produces a stable, deterministic hash).
 */
function personaOnlyResponse(
  request: AugmentRequest,
  t0: number,
  reason: EmptyReason,
  rejectedByFloor: ReadonlyArray<RejectionEntry> = [],
): AugmentResponse {
  const totalMs = performance.now() - t0;
  // Compute the persona-only 2-block SHA-256 so the response carries a
  // stable, deterministic hash (D-006 invariant: even the empty /
  // social / no-active paths produce a stable systemMessage).
  const { sha256 } = buildSystemMessage(request, {
    matched: [],
    personaTextOverride: '',
  });
  return buildResponse({
    request,
    systemMessage: sha256,
    matched: [],
    rejectedByFloor,
    warnings:
      reason === 'no_active_items'
        ? ['activeCatalog is empty — proceeding with persona only']
        : [],
    latency: {
      embeddingMs: 0,
      retrievalMs: 0,
      rerankMs: 0,
      totalMs,
    },
    emptyReason: reason,
  });
}

/**
 * Build the fail-open response when retrieval errors out. The system
 * message becomes persona-only, `emptyReason: 'timeout'`, and the
 * response is still 200 (per PRD §2 + SPEC §IMod-8).
 */
function failOpenResponse(
  request: AugmentRequest,
  t0: number,
  embeddingMs: number,
  _err: unknown,
): AugmentResponse {
  const totalMs = performance.now() - t0;
  // Compute the persona-only 2-block SHA-256 (D-006 invariant).
  const { sha256 } = buildSystemMessage(request, {
    matched: [],
    personaTextOverride: '',
  });
  return buildResponse({
    request,
    systemMessage: sha256,
    matched: [],
    rejectedByFloor: [],
    warnings: ['retrieval failed; serving persona-only fallback'],
    latency: {
      embeddingMs,
      retrievalMs: 0,
      rerankMs: 0,
      totalMs,
    },
    emptyReason: 'timeout',
  });
}
