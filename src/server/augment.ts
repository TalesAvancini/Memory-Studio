/**
 * POST /augment route handler.
 *
 * Phase 5a.2 (T-08) — wires the route to the real augmentation
 * pipeline. The Phase 5a.1 placeholder (which returned empty matched
 * arrays and `emptyReason: null` for any valid input) is replaced by
 * `runAugment(req, context)`, which composes the social gate, the
 * active-catalog filesystem validation, FTS5 + sqlite-vec + RRF
 * retrieval, the double threshold, the top-K + tiebreak, and the
 * 2-block `cache_control: ephemeral` system message builder.
 *
 * Pipeline context (db, embedder, catalog dir) is supplied via the
 * `setAugmentPipelineProvider` hook so tests in `test/augment/*` can
 * inject in-memory fixtures. The default provider used in production
 * wiring is created lazily on first request so module import stays
 * cheap (no ONNX load at import time).
 *
 * On any retrieval failure (FTS error, vec error, embedder failure,
 * missing catalog dir) the pipeline returns 200 with
 * `emptyReason: 'timeout'` and a persona-only system message — the
 * server NEVER returns 500 for retrieval errors (PRD §2 fail-open).
 */

import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import {
  AugmentRequestSchema,
  type AugmentResponse,
} from './schema.ts';
import { requestLogger } from './logger.ts';
import { recordLastRequestTimestampMs } from './boot.ts';
import { runAugment, type PipelineContext } from './augment/pipeline.ts';
import type { RuntimeStateSnapshot } from './config/runtime-state.ts';
import { initializeSearchStorage } from '../search/schema.ts';
import type { Embedder } from '../catalog/embedder/types.ts';
import { EMBEDDING_DIMENSIONS } from '../catalog/embedder/index.ts';
import { hashTenantId } from './security/tenant-hash.ts';
import { redactObjectRecursive } from './audit/redact.ts';
import { getAuditBuffer } from './audit/lifecycle.ts';
import type { AuditEvent } from './audit/types.ts';

export interface AugmentRouteOptions {
  onSuccess?: (timeMs?: number) => void;
  /**
   * Optional explicit pipeline provider. When supplied, the route
   * handler uses this for every request. The provider may be async so a
   * production context can load one state snapshot before building it.
   */
  pipelineProvider?: () => PipelineContext | Promise<PipelineContext>;
  /**
   * Atomic production seam. It returns one state snapshot and the pipeline
   * derived from that same snapshot; the route overrides the request's
   * activeCatalog with the state authority before running augmentation.
   */
  requestContextProvider?: () => Promise<{
    readonly state: RuntimeStateSnapshot;
    readonly pipeline: PipelineContext;
  }>;
}

const PERFORMANCE_BUDGET_RERANK_MS = 0;

// Re-exported for Phase 5a call sites that imported `hashTenantId`
// from `./augment.ts` directly. The canonical implementation now
// lives in `./security/tenant-hash.ts` (extracted verbatim per T-04);
// this re-export keeps the existing surface stable.
export { hashTenantId };

/**
 * Build the audit row for a successful /augment request. Per PRD
 * §10.3.1 the row contains ZERO raw prompt/context text — only
 * `redacted_prompt_hash`, metadata arrays, and JSON-encoded payloads.
 * `fingerprint` and `payload` JSON fields are walked through
 * `redactObjectRecursive` so any placeholder secrets in nested strings
 * are masked before persistence.
 */
function buildAuditEvent(
  parsedRequest: import('./schema.ts').AugmentRequest,
  response: AugmentResponse,
  redactedPromptHash: string,
  fingerprintMetadata: Record<string, unknown>,
  payloadMetadata: Record<string, unknown>,
): AuditEvent {
  const matchedIds = [
    ...response.matchedSkills.map((m) => m.id),
    ...response.matchedRules.map((m) => m.id),
    ...response.matchedPersonas.map((m) => m.id),
  ];
  const pruningReasons: string[] = [
    ...response.pruningDecisions.rejectedByFloor.map((r) => r.reason),
    ...response.pruningDecisions.rejectedByBudget.map((r) => r.reason),
    ...response.pruningDecisions.rejectedByAttentionTier.map((r) => r.reason),
    ...response.pruningDecisions.rejectedByNegativeFeedback.map((r) => r.reason),
    ...response.pruningDecisions.rejectedByCriticalDropped.map((r) => r.reason),
  ];
  return {
    ts: Date.now(),
    tenantIdHashed: hashTenantId(parsedRequest.tenantId),
    redactedPromptHash,
    matchedIds,
    pruningReasons,
    latencyMs: response.latencyMs.total,
    fingerprint: redactObjectRecursive(fingerprintMetadata) as Record<string, unknown>,
    payload: redactObjectRecursive(payloadMetadata) as Record<string, unknown>,
    eventType: 'augment',
  };
}

function firstInvalidPath(issues: ReadonlyArray<{ path: ReadonlyArray<unknown> }>): string {
  if (issues.length === 0) return '<unknown>';
  const first = issues[0]!;
  if (first.path.length === 0) return '<root>';
  return first.path.map((segment) => String(segment)).join('.');
}

// --- Pipeline provider plumbing --------------------------------------------
//
// The default provider creates an in-memory sqlite + stub embedder so
// the route works out of the box for the smoke test. Production wiring
// (real catalog dir + ONNX embedder) lands in Phase 5a.4 alongside the
// `server:start` script that opens the on-disk catalog DB.

let pipelineProviderOverride: (() => PipelineContext) | null = null;

/**
 * Override the module-level pipeline provider. Used by tests in
 * `test/augment/*` to inject fixtures. Pass `null` to clear the
 * override and fall back to the lazy in-memory default.
 */
export function setAugmentPipelineProvider(
  provider: (() => PipelineContext) | null,
): void {
  pipelineProviderOverride = provider;
}

/** Test-only: read the current provider override. */
export function getAugmentPipelineProviderOverride(): (() => PipelineContext) | null {
  return pipelineProviderOverride;
}

let cachedDefaultContext: PipelineContext | null = null;

function defaultPipelineContext(): PipelineContext {
  if (cachedDefaultContext !== null) return cachedDefaultContext;
  cachedDefaultContext = createInMemoryPipelineContext();
  return cachedDefaultContext;
}

/**
 * Build an in-memory DB with the production `catalog` table shape + a stub
 * embedder that always returns a zero vector. Used by the default
 * pipeline provider so the route works without any external state.
 * Real wiring (on-disk catalog + ONNX embedder) is the production path.
 *
 * The `catalog` table shape mirrors the migration DDL in
 * `src/catalog/migrations/001_init.sql` so the in-memory default exercises
 * the same schema the on-disk DB uses.
 *
 * The search storage (FTS5 + sqlite-vec virtual tables + sync
 * triggers) is also initialized so the FTS channel query doesn't
 * fail on "no such table: catalog_fts" when the route receives a
 * request against an empty corpus.
 */
function createInMemoryPipelineContext(): PipelineContext {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      text TEXT NOT NULL,
      category TEXT,
      critical INTEGER,
      is_default INTEGER,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS embeddings (
      catalog_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      model_version TEXT NOT NULL,
      embedded_at INTEGER NOT NULL
    );
  `);

  // Initialize search storage (FTS5 + vec0) so retrieval doesn't
  // throw "no such table" on an empty in-memory DB. Real production
  // wiring opens the on-disk catalog DB; this initialization is a
  // best-effort — if the sqlite-vec extension can't be loaded, we
  // skip it and let retrieval return empty (the pipeline is fail-open
  // and returns `emptyReason: 'timeout'`).
  try {
    initializeSearchStorage(db);
  } catch {
    // Best-effort initialization; the pipeline is fail-open.
  }

  const embedder: Embedder = {
    dimensions: EMBEDDING_DIMENSIONS,
    async encode(_text: string): Promise<Float32Array> {
      return new Float32Array(EMBEDDING_DIMENSIONS);
    },
    // Legacy alias of encode — kept for Phase 5 backward compat with
    // `src/search/*` which still calls `embedder.embed(text)`.
    async embed(text: string): Promise<Float32Array> {
      return this.encode(text);
    },
  };

  return { db, embedder };
}

function resolveProvider(
  opts: AugmentRouteOptions,
): () => PipelineContext | Promise<PipelineContext> {
  if (opts.pipelineProvider !== undefined) return opts.pipelineProvider;
  if (pipelineProviderOverride !== null) return pipelineProviderOverride;
  return defaultPipelineContext;
}

export async function registerAugmentRoute(
  app: FastifyInstance,
  options: AugmentRouteOptions = {},
): Promise<void> {
  const provider = resolveProvider(options);

  app.post('/augment', async (request, reply) => {
    const startMs = Date.now();
    const decisionTraceId = randomUUID();
    const parsed = AugmentRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      const field = firstInvalidPath(parsed.error.issues);
      const message = parsed.error.issues[0]?.message ?? 'Invalid request body';
      const log = requestLogger({
        requestId: decisionTraceId,
        tenantIdHashed: hashTenantId(
          typeof request.body === 'object' && request.body !== null && 'tenantId' in request.body
            ? String((request.body as { tenantId: unknown }).tenantId ?? '') || undefined
            : undefined,
        ),
      });
      log.warn(
        {
          route: '/augment',
          decisionTraceId,
          validationField: field,
          validationMessage: message,
          issues: parsed.error.issues,
        },
        '/augment validation rejected',
      );
      reply.code(400);
      return {
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          field,
          message,
        },
      };
    }

    // Real pipeline path (Phase 5a.2). The provider is per-request
    // because the test suite may swap it between calls; the default
    // returns a memoized context (cheap to share).
    let response: AugmentResponse;
    let effectiveRequest = parsed.data;
    try {
      let pipelineContext: PipelineContext;
      if (options.requestContextProvider !== undefined) {
        const requestContext = await options.requestContextProvider();
        effectiveRequest = {
          ...parsed.data,
          activeCatalog: [...requestContext.state.activeCatalog],
        };
        pipelineContext = requestContext.pipeline;
      } else {
        pipelineContext = await provider();
      }
      response = await runAugment(effectiveRequest, pipelineContext);
    } catch (err) {
      // Defensive: the pipeline is fail-open by contract; a throw
      // here is a programmer error, not a retrieval error. Log and
      // surface a structured 500 (the only place the server returns
      // non-200 for a validated body).
      const message = err instanceof Error ? err.message : String(err);
      const log = requestLogger({
        requestId: decisionTraceId,
        tenantIdHashed: hashTenantId(parsed.data.tenantId),
      });
      log.error(
        {
          route: '/augment',
          decisionTraceId,
          error: message,
        },
        '/augment pipeline error',
      );
      reply.code(500);
      return {
        error: {
          code: 'PIPELINE_ERROR',
          message,
        },
      };
    }

    // Ensure the response carries the route-scoped `decisionTraceId`
    // so the log line and the response body are joinable.
    const finalResponse: AugmentResponse = {
      ...response,
      decisionTraceId,
      latencyMs: {
        ...response.latencyMs,
        rerank: PERFORMANCE_BUDGET_RERANK_MS,
      },
    };

    const log = requestLogger({
      requestId: decisionTraceId,
      tenantIdHashed: hashTenantId(parsed.data.tenantId),
    });
    log.info(
      {
        route: '/augment',
        decisionTraceId,
        latencyMs: finalResponse.latencyMs,
        matchedIds: [
          ...finalResponse.matchedSkills.map((m) => m.id),
          ...finalResponse.matchedRules.map((m) => m.id),
          ...finalResponse.matchedPersonas.map((m) => m.id),
        ],
        systemMessageSha256: finalResponse.systemMessage,
        usage: {
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      },
      '/augment',
    );

    // Audit enqueue (D-007 CRITICAL — Phase 5b T-03). The audit row
    // contains ZERO raw prompt/context text per PRD §10.3.1. The
    // `redactedPromptHash` is the sha256 hex of the ORIGINAL prompt
    // (redaction is for log/storage; the hash is computed over the
    // input verbatim so the cache key stays stable).
    //
    // Fail-open: enqueue never throws. If the buffer is uninitialized
    // (the boot order didn't wire it), the audit is a silent no-op —
    // tests that don't need audit get a clean baseline.
    try {
      const auditBuffer = getAuditBuffer();
      if (auditBuffer !== null) {
        const redactedPromptHash = createHash('sha256')
          .update(parsed.data.prompt, 'utf8')
          .digest('hex');
        const fingerprintMetadata = {
          agentId: parsed.data.fingerprint.agentId,
          sessionId: parsed.data.fingerprint.sessionId,
          projectPath: parsed.data.fingerprint.projectPath,
          gitBranch: parsed.data.fingerprint.gitBranch,
          requestId: decisionTraceId,
        };
        const payloadMetadata = {
          systemMessageSha256: finalResponse.systemMessage,
          matchedSkillsCount: finalResponse.matchedSkills.length,
          matchedRulesCount: finalResponse.matchedRules.length,
          matchedPersonasCount: finalResponse.matchedPersonas.length,
          emptyReason: finalResponse.emptyReason ?? null,
          warnings: finalResponse.warnings,
        };
        const event = buildAuditEvent(
          parsed.data,
          finalResponse,
          redactedPromptHash,
          fingerprintMetadata,
          payloadMetadata,
        );
        auditBuffer.enqueue(event);
      }
    } catch {
      // Audit is best-effort; never block the response.
    }

    options.onSuccess?.(Date.now());
    reply.code(200);
    return finalResponse;
  });
}

/**
 * Records that an `/augment` request completed successfully. Wired by
 * `boot.ts` into the route's `onSuccess` hook so `/health.last_request_ts`
 * reflects the most recent successful response without coupling the
 * augment handler to the health endpoint directly.
 *
 * Re-exported from the barrel for tests that exercise the wiring.
 */
export function recordAugmentSuccess(timeMs: number = Date.now()): void {
  recordLastRequestTimestampMs(timeMs);
}
