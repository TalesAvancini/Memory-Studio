/**
 * POST /augment route handler.
 *
 * Phase 5a.1 (T-03) — request validation + structured response shape.
 *
 * Pipeline (Phase 5a.1, placeholder):
 *   1. Zod validate the body (AugmentRequestSchema).
 *      Failure → 400 with `{ error: { code: 'MISSING_REQUIRED_FIELD',
 *      field, message } }` naming the first offending path.
 *   2. Generate `decisionTraceId = crypto.randomUUID()`.
 *   3. Emit a structured log line via `requestLogger()` carrying the
 *      `usage.cache_read_input_tokens` field stub (`null` in Phase 5a.1;
 *      Phase 5b surfaces provider cache metrics once the /v1/messages
 *      proxy is wired).
 *   4. Return 200 with a placeholder AugmentResponse that matches the
 *      full PRD §7.1 response shape. The retrieval pipeline lands in
 *      Phase 5a.2 (T-05..T-08).
 *
 * Recording the success timestamp is delegated to `recordAugmentSuccess`
 * which the boot factory wires into the route via `onSuccess`. This
 * keeps `/health`'s `last_request_ts` fresh without coupling /augment
 * to `/health` directly.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  AugmentRequestSchema,
  type AugmentRequest,
  type AugmentResponse,
} from './schema.ts';
import { requestLogger } from './logger.ts';
import { recordLastRequestTimestampMs } from './boot.ts';

export interface AugmentRouteOptions {
  onSuccess?: (timeMs?: number) => void;
}

const PERFORMANCE_BUDGET_RERANK_MS = 0;
const PERFORMANCE_BUDGET_TOTAL_MS_PLACEHOLDER = 0;

function hashTenantId(tenantId: string | undefined): string | null {
  if (!tenantId) return null;
  return createHash('sha256').update(tenantId, 'utf8').digest('hex').slice(0, 16);
}

function buildPlaceholderResponse(
  request: AugmentRequest,
  decisionTraceId: string,
  startMs: number,
): AugmentResponse {
  const totalMs = Date.now() - startMs;
  return {
    systemMessage: '',
    matchedSkills: [],
    matchedRules: [],
    matchedPersonas: [],
    pruningDecisions: {
      rejectedByFloor: [],
      rejectedByBudget: [],
      rejectedByAttentionTier: [],
      rejectedByNegativeFeedback: [],
      rejectedByCriticalDropped: [],
    },
    latencyMs: {
      embedding: 0,
      retrieval: 0,
      rerank: PERFORMANCE_BUDGET_RERANK_MS,
      total: totalMs || PERFORMANCE_BUDGET_TOTAL_MS_PLACEHOLDER,
    },
    decisionTraceId,
    warnings: request.activeCatalog.length === 0
      ? ['activeCatalog is empty — proceeding with persona only']
      : [],
    emptyReason: request.activeCatalog.length === 0 ? 'no_active_items' : null,
    schemaVersion: 3,
  };
}

function firstInvalidPath(issues: ReadonlyArray<{ path: ReadonlyArray<unknown> }>): string {
  if (issues.length === 0) return '<unknown>';
  const first = issues[0]!;
  if (first.path.length === 0) return '<root>';
  return first.path.map((segment) => String(segment)).join('.');
}

export async function registerAugmentRoute(
  app: FastifyInstance,
  options: AugmentRouteOptions = {},
): Promise<void> {
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

    const response = buildPlaceholderResponse(parsed.data, decisionTraceId, startMs);

    const log = requestLogger({
      requestId: decisionTraceId,
      tenantIdHashed: hashTenantId(parsed.data.tenantId),
    });
    log.info(
      {
        route: '/augment',
        decisionTraceId,
        latencyMs: response.latencyMs,
        matchedIds: [],
        systemMessageSha256: response.systemMessage,
        usage: {
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      },
      '/augment',
    );

    options.onSuccess?.(Date.now());
    reply.code(200);
    return response;
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