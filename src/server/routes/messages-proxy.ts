/**
 * POST /v1/messages transparent proxy (Phase 5b T-13).
 *
 * Implements R-09 (PRD §3 + §14.3) — the server accepts Anthropic's
 * `POST /v1/messages` request shape, intercepts the `system` field,
 * builds an internal `/augment` request (in-process, no HTTP hop),
 * rewrites the `system` field to Memory Studio's 2-block structure,
 * forwards to the upstream provider, captures `cache_read_input_tokens`
 * from the upstream response, and feeds the cache metric into the
 * audit buffer.
 *
 * Failure semantics differ from `/augment` (which is fail-open per
 * PRD §2):
 *
 *   - 503 `proxy_disabled` — no upstream URL configured.
 *   - 502 `proxy_host_not_allowed` — upstream URL is not on the
 *     loopback allowlist (PRD §10.3.4). The proxy DOES NOT have a
 *     fail-open path here: a non-loopback upstream is a configuration
 *     error, not a transient failure.
 *   - 502 `augment_failed` — the in-process `/augment` pipeline threw.
 *     The proxy returns 502 to the caller (the LLM agent expects a
 *     clear failure signal). The audit row is still enqueued with the
 *     failure metadata.
 *
 * The audit event uses `event_type: 'messages_proxy'` and carries:
 *   - `systemMessageSha256` (the SHA-256 of the 2-block structure)
 *   - `cacheReadInputTokens` + `cacheCreationInputTokens`
 *   - `matchedIds` + `pruningReasons` (from the augment response)
 *   - `redactedPromptHash` (sha256 of the original Anthropic request's
 *     prompt text, NOT the redacted form — redaction is for storage)
 *   - `tenantId_hashed` from `hashTenantId('proxy-tenant')`
 *
 * Local-only enforcement (R-10) is provided by
 * `assertLoopback()` from `src/server/security/proxy-allowlist.ts`.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hashTenantId } from '../security/tenant-hash.ts';
import { assertLoopback, ProxyHostNotAllowedError } from '../security/proxy-allowlist.ts';
import { getAuditBuffer } from '../audit/lifecycle.ts';
import type { AuditEvent } from '../audit/types.ts';
import { AugmentRequestSchema, type AugmentRequest } from '../schema.ts';
import { runAugment, type PipelineContext } from '../augment/pipeline.ts';
import { buildSystemMessage } from '../augment/augmenter.ts';

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;

// --- Anthropic Messages API request validation ------------------------------

const AnthropicContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  // Allow other fields (tool_use, etc.) without enumerating.
});

const AnthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
});

const AnthropicSystemBlockSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
});

const AnthropicMessagesRequestSchema = z.object({
  model: z.string(),
  max_tokens: z.number().optional(),
  system: z.union([z.string(), z.array(AnthropicSystemBlockSchema)]).optional(),
  messages: z.array(AnthropicMessageSchema).min(1),
});

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

// --- Helpers ----------------------------------------------------------------

/**
 * Extract the joined text of the Anthropic `system` field. Accepts
 * either a string or an array of blocks (Anthropic supports both).
 * Returns an empty string when absent.
 */
function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text ?? '') : ''))
      .filter((s) => s.length > 0)
      .join('\n\n');
  }
  return '';
}

/**
 * Extract the first user-role message's text content from the Anthropic
 * messages array. Joins multiple text blocks with `\n\n`.
 */
function extractFirstUserPrompt(
  messages: ReadonlyArray<z.infer<typeof AnthropicMessageSchema>>,
): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((b) => (typeof b === 'object' && b !== null && 'text' in b ? String((b as { text: unknown }).text ?? '') : ''))
        .filter((s) => s.length > 0)
        .join('\n\n');
    }
  }
  return '';
}

/**
 * Read MEMORY_STUDIO_ANTHROPIC_BASE_URL. Returns null when unset or
 * empty. Whitespace-trimmed.
 */
export function readUpstreamUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

/**
 * Compute SHA-256 hex of the concatenated `(systemText + messages JSON)`.
 * Used as the `redactedPromptHash` for the audit row — the hash is over
 * the original (pre-redaction) text per spec.md A-4.
 */
function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function enqueueAuditSafe(event: AuditEvent): void {
  try {
    const buf = getAuditBuffer();
    buf?.enqueue(event);
  } catch {
    // Audit is best-effort.
  }
}

// --- Route options ----------------------------------------------------------

export interface MessagesProxyRouteOptions {
  /**
   * Upstream provider base URL. When null, the route returns 503
   * `proxy_disabled`. Source: `MEMORY_STUDIO_ANTHROPIC_BASE_URL` env
   * var (read by the route or injected by the caller for tests).
   */
  upstreamUrl: string | null;
  /** Optional allowlist extension from `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS`. */
  allowedHostsCsv?: string;
  /** Provider of the in-process pipeline context (db + embedder). */
  pipelineProvider: () => PipelineContext;
  /** Upstream request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Test-only fetch override (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Test-only clock (defaults to Date.now). */
  now?: () => number;
}

// --- Route registration -----------------------------------------------------

export async function registerMessagesProxyRoute(
  app: FastifyInstance,
  opts: MessagesProxyRouteOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;

  app.post('/v1/messages', async (request, reply: FastifyReply) => {
    const decisionTraceId = createHash('sha256').update(String(now())).digest('hex').slice(0, 16);

    // --- 1. Proxy enabled check --------------------------------------------
    if (opts.upstreamUrl === null) {
      reply.code(503);
      return {
        error: 'proxy_disabled',
        hint: 'Set MEMORY_STUDIO_ANTHROPIC_BASE_URL to enable',
      };
    }

    // --- 2. Allowlist check ------------------------------------------------
    try {
      assertLoopback(opts.upstreamUrl, opts.allowedHostsCsv);
    } catch (err) {
      if (err instanceof ProxyHostNotAllowedError) {
        reply.code(502);
        return {
          error: 'proxy_host_not_allowed',
          host: err.host,
          hint: err.wildcardRejected
            ? 'Wildcard * is forbidden in MEMORY_STUDIO_PROXY_ALLOWED_HOSTS'
            : 'Add the host to MEMORY_STUDIO_PROXY_ALLOWED_HOSTS or use a loopback URL',
        };
      }
      throw err;
    }

    // --- 3. Anthropic request validation ----------------------------------
    const parsed = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_anthropic_request',
        issues: parsed.error.issues,
      };
    }
    const anthropicReq = parsed.data;
    const systemText = extractSystemText(anthropicReq.system);
    const promptText = extractFirstUserPrompt(anthropicReq.messages);
    const hashInput = systemText + JSON.stringify(anthropicReq.messages);
    const redactedPromptHash = sha256Hex(hashInput);

    // --- 4. Build internal /augment request -------------------------------
    const augmentReq: AugmentRequest = AugmentRequestSchema.parse({
      prompt: promptText,
      context: null,
      fingerprint: {
        projectPath: '.',
        agentId: 'claude-code',
        sessionId: 'proxy',
        gitBranch: 'main',
      },
      activeCatalog: [],
      tenantId: 'proxy-tenant',
      schemaVersion: 3,
    });

    // --- 5. Run pipeline (in-process) -------------------------------------
    let augmentResponse;
    try {
      augmentResponse = await runAugment(augmentReq, opts.pipelineProvider());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 502 — proxy IS the failure signal for the LLM agent.
      enqueueAuditSafe({
        ts: now(),
        tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
        redactedPromptHash,
        matchedIds: [],
        pruningReasons: [],
        latencyMs: 0,
        fingerprint: { agentId: 'claude-code', source: 'proxy', decisionTraceId },
        payload: {
          model: anthropicReq.model,
          error: 'augment_failed',
          message,
        },
        eventType: 'messages_proxy',
      });
      reply.code(502);
      return {
        error: 'augment_failed',
        message,
      };
    }

    // --- 6. Augment system field ------------------------------------------
    const systemMessageOutput = buildSystemMessage(augmentReq, {
      matched: [],
    });
    const augmentedSystem = systemMessageOutput.system;

    // --- 7. Forward to upstream -------------------------------------------
    const proxiedReq = {
      ...anthropicReq,
      system: augmentedSystem,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(`${opts.upstreamUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(proxiedReq),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      enqueueAuditSafe({
        ts: now(),
        tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
        redactedPromptHash,
        matchedIds: [],
        pruningReasons: [],
        latencyMs: 0,
        fingerprint: { agentId: 'claude-code', source: 'proxy', decisionTraceId },
        payload: {
          model: anthropicReq.model,
          error: 'upstream_fetch_failed',
          message,
        },
        eventType: 'messages_proxy',
      });
      reply.code(502);
      return {
        error: 'upstream_fetch_failed',
        message,
      };
    }
    clearTimeout(timer);

    // --- 8. Capture cache metrics -----------------------------------------
    let upstreamBody: Record<string, unknown> = {};
    try {
      upstreamBody = (await upstreamRes.json()) as Record<string, unknown>;
    } catch {
      // Upstream returned non-JSON — surface upstream status + empty cache metrics.
    }
    const usageRaw = upstreamBody['usage'];
    const usage = (usageRaw !== null && typeof usageRaw === 'object'
      ? (usageRaw as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const cacheReadInputTokens = typeof usage['cache_read_input_tokens'] === 'number'
      ? (usage['cache_read_input_tokens'] as number)
      : null;
    const cacheCreationInputTokens = typeof usage['cache_creation_input_tokens'] === 'number'
      ? (usage['cache_creation_input_tokens'] as number)
      : null;
    const inputTokens = typeof usage['input_tokens'] === 'number'
      ? (usage['input_tokens'] as number)
      : null;
    const outputTokens = typeof usage['output_tokens'] === 'number'
      ? (usage['output_tokens'] as number)
      : null;

    const matchedIds = [
      ...augmentResponse.matchedSkills.map((m) => m.id),
      ...augmentResponse.matchedRules.map((m) => m.id),
      ...augmentResponse.matchedPersonas.map((m) => m.id),
    ];
    const pruningReasons: string[] = [
      ...augmentResponse.pruningDecisions.rejectedByFloor.map((r) => r.reason),
      ...augmentResponse.pruningDecisions.rejectedByBudget.map((r) => r.reason),
      ...augmentResponse.pruningDecisions.rejectedByAttentionTier.map((r) => r.reason),
      ...augmentResponse.pruningDecisions.rejectedByNegativeFeedback.map((r) => r.reason),
      ...augmentResponse.pruningDecisions.rejectedByCriticalDropped.map((r) => r.reason),
    ];

    // --- 9. Audit row -----------------------------------------------------
    enqueueAuditSafe({
      ts: now(),
      tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
      redactedPromptHash,
      matchedIds,
      pruningReasons,
      latencyMs: augmentResponse.latencyMs.total,
      fingerprint: { agentId: 'claude-code', source: 'proxy', decisionTraceId },
      payload: {
        model: anthropicReq.model,
        systemMessageSha256: augmentResponse.systemMessage,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        inputTokens,
        outputTokens,
        upstreamStatus: upstreamRes.status,
      },
      eventType: 'messages_proxy',
    });

    // --- 10. Return response ----------------------------------------------
    reply.code(upstreamRes.status);
    return upstreamBody;
  });
}
