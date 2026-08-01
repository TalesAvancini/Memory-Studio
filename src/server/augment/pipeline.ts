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
import type { Intel } from '../fast-agent/intel-schema.ts';
import { recordAugmentSample } from '../metrics/collector.ts';

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
  /**
   * Phase 6b (T-13) — Session ID for the in-process call chain.
   * When set, Stage 1b reads prior intel via `getIntel(sessionId)`
   * and the tail setImmediate writes back the intel used in this
   * turn. When `undefined`, the pipeline runs without intel (the
   * 2-block structure stays at the no-intel baseline SHA, preserving
   * the cache hit invariant R-15 for legacy callers).
   */
  readonly sessionId?: string;
  /**
   * Phase 6b (T-13) — Read prior turn's intel from the store. Called
   * by Stage 1b when `sessionId` is provided. Returns `null` when no
   * intel row exists (cold start). Must NOT throw — fail-open to
   * `null` so the pipeline never crashes on a corrupted row.
   */
  readonly getIntel?: (sessionId: string) => Intel | null;
  /**
   * Phase 6b (T-13) — Persist intel to the store. Invoked by the
   * tail setImmediate AFTER the response is built, so the `/augment`
   * caller is NEVER blocked by the write latency. Synchronous writes
   * complete in < 1ms (Phase 6a POC measured 0.02ms p95 — well under
   * the AD-006 #4 budget). The tail is fire-and-forget; errors are
   * logged to stderr and never bubble up.
   */
  readonly writeIntel?: (sessionId: string, intel: Intel) => Promise<void>;
  /**
   * Phase 6b (T-13) — Optional fast-agent call for cold-start
   * intel extraction. When `sessionId` is set AND `getIntel` returns
   * `null` AND this hook is provided, Stage 1b calls it synchronously
   * to extract fresh intel from the current prompt. Production wires
   * this to `fetchIntel` (`src/server/fast-agent/client.ts`); tests
   * inject a stub that returns a deterministic literal.
   *
   * R-20 fire-and-forget semantics: errors here degrade to
   * `intel = null` (intel section omitted) and NEVER block the
   * request response.
   */
  readonly callFastAgent?: (req: { readonly prompt: string; readonly model: string }) => Promise<{ readonly intel: Intel }>;
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

  // --- Stage 1b: Intel (Phase 6b T-13) -------------------------------------
  // Read prior turn's intel from the store (warm hit) OR extract fresh
  // intel from the current prompt via the fast-agent (cold start). The
  // result flows into Block 2's `## Intel` section via
  // `BuildOptions.intel`. Fail-open: any error here leaves `intel` as
  // `null` (intel section omitted) so the cache hit invariant R-15 is
  // preserved when the row is corrupted or the fast-agent is down.
  //
  // Hot-path read budget: Phase 6a POC measured `sqlite.get(intel) =
  // 0.02ms p95` (250x headroom under the 5ms AD-006 ceiling). Cold-start
  // extraction adds a single fast-agent call (`< 3s p95` per the stub
  // POC) but is gated to first-turn-of-session only (the next turn's
  // warm read is < 0.02ms).
  let intel: Intel | null = null;
  if (context.sessionId !== undefined) {
    const sessionId = context.sessionId;
    if (context.getIntel !== undefined) {
      try {
        intel = context.getIntel(sessionId);
      } catch {
        // Fail-open: never let a bad read crash the pipeline.
        intel = null;
      }
    }
    if (intel === null && context.callFastAgent !== undefined) {
      // Cold start: extract fresh intel from this turn's prompt.
      try {
        const result = await context.callFastAgent({
          prompt: request.prompt,
          model: 'MiniMax-M2.7-highspeed',
        });
        intel = result.intel;
      } catch {
        // Fail-open: degraded cold start → no intel this turn.
        intel = null;
      }
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
    intel, // NEW Phase 6b T-13 — flows into Block 2's `## Intel` section.
  });

  // --- Stage 9: Response builder ----------------------------------------
  const totalMs = performance.now() - t0;
  const latency: LatencyTimings = {
    embeddingMs,
    retrievalMs,
    rerankMs: 0,
    totalMs,
  };

  // --- Stage 9.5: Tail setImmediate (Phase 6b T-13) ---------------------
  // Persist the intel we just used AFTER the response is returned. The
  // helper is a no-op when (a) no sessionId, (b) no writeIntel hook,
  // or (c) intel is null — so the existing test surface (Phase 5a/5b
  // tests that call runAugment with bare PipelineContext) is
  // unaffected.
  scheduleIntelTailWrite(context, intel);

  const response = buildResponse({
    request,
    systemMessage: sha256,
    matched,
    rejectedByFloor,
    warnings: topKWarnings,
    latency,
  });

  // --- Stage 9.6: Metrics sample (Phase 7a T-06) -----------------------
  // Record matched.count + latencyMs.total for the metrics dashboard.
  // NO-OP when the metrics buffer is not initialized (the in-memory
  // smoke path) OR when the buffer throws (fail-open per D-007
  // mirror). Never blocks the request — fire-and-forget.
  // Phase 7a T-06: this is the matched/no-match path (Stages 6-9
  // reached retrieval); `emptyReason` is the response's
  // `low_confidence` (if thresholds rejected all) or null/undefined.
  recordAugmentSample({
    matched: matched.length > 0,
    emptyReason: response.emptyReason ?? null,
    latencyMs: totalMs,
  });

  return response;
}

// ---------------------------------------------------------------------------
// Tail setImmediate helper (Phase 6b T-13)
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget write of the intel literal used in the current turn
 * (Phase 6b T-13). The setImmediate runs AFTER the response is built
 * and returned, so the `/v1/messages` response time is unaffected by
 * the write latency.
 *
 * Why a setImmediate (NOT await):
 *   - Phase 6a POC measured the sync write at 0.02ms p95 — but a
 *     `setImmediate` ensures the write NEVER blocks the hot path
 *     even on a slow disk.
 *   - The setImmediate runs in the next event-loop tick; the
 *     `/augment` response has already been returned to the caller.
 *
 * Why the response path is unchanged:
 *   - The current turn's intel was already read (or extracted) in
 *     Stage 1b; the response carries the 2-block SHA from Block 1
 *     (persona) + Block 2 (intel + ...). Writing the intel we just
 *     used back to the store is idempotent (warm hit) OR the cold-
 *     start persistence (no prior row). The actual R_N-based intel
 *     extraction happens in the messages-proxy.ts path (T-14) which
 *     has access to the upstream response text.
 */
function scheduleIntelTailWrite(
  context: PipelineContext,
  intel: Intel | null,
): void {
  if (context.sessionId === undefined) return;
  if (context.writeIntel === undefined) return;
  if (intel === null) return;
  const sessionId = context.sessionId;
  const writeIntel = context.writeIntel;
  // Capture by value so the setImmediate closure stays stable.
  const intelToWrite = intel;
  setImmediate(() => {
    void writeIntel(sessionId, intelToWrite).catch((err) => {
      const reason = err instanceof Error ? err.message : String(err);
      // Fail-open: log to stderr, never block, never bubble.
      console.error(`[pipeline] tail setImmediate writeIntel failed: ${reason}`);
    });
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
  const response = buildResponse({
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
  // --- Phase 7a T-06: metrics sample (fail-open path) ------------------
  // Persona-only paths are EXCLUDED from the R-1 denominator per
  // spec.md R-1 table. Latency IS captured (R-3/R-4 include ALL paths).
  // Fire-and-forget — collector swallows errors (D-007 mirror).
  recordAugmentSample({
    matched: false,
    emptyReason: reason,
    latencyMs: totalMs,
  });
  return response;
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
  const response = buildResponse({
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
  // --- Phase 7a T-06: metrics sample (fail-open path) ------------------
  // 'timeout' is EXCLUDED from the R-1 denominator per spec.md R-1
  // table. Latency IS captured (R-3/R-4 include ALL paths).
  recordAugmentSample({
    matched: false,
    emptyReason: 'timeout',
    latencyMs: totalMs,
  });
  return response;
}
