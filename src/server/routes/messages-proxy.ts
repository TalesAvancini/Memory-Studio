/**
 * Transparent Anthropic Messages proxy.
 *
 * Phase 7b T-02 keeps the provider-shaped body intact, derives a hashed
 * per-session identity, loads one runtime-state snapshot, forwards the exact
 * detailed pipeline system blocks, and preserves the caller's original system
 * prefix. T-03 adds the streaming adapter on top of the same request seam.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { hashTenantId } from '../security/tenant-hash.ts';
import { assertLoopback, ProxyHostNotAllowedError } from '../security/proxy-allowlist.ts';
import { getAuditBuffer } from '../audit/lifecycle.ts';
import type { AuditEvent } from '../audit/types.ts';
import { AugmentRequestSchema, type AugmentRequest } from '../schema.ts';
import {
  runAugmentDetailed,
  type DetailedAugmentResult,
  type PipelineContext,
} from '../augment/pipeline.ts';
import type { SystemBlock } from '../augment/augmenter.ts';
import type { ProductionRequestContext } from '../config/production-context.ts';
import { recordProxySample } from '../metrics/collector.ts';

const DEFAULT_UPSTREAM_TIMEOUT_MS = 30_000;
const SESSION_HEADER = 'x-memory-studio-session-id';

export const FORWARDED_HEADER_ALLOWLIST = Object.freeze([
  'x-api-key',
  'authorization',
  'anthropic-version',
  'anthropic-beta',
  'content-type',
] as const);

const AnthropicContentBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough();

const AnthropicMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
}).passthrough();

const AnthropicSystemBlockSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
}).passthrough();

export const AnthropicMessagesRequestSchema = z.object({
  model: z.string().min(1),
  max_tokens: z.number().int().positive(),
  system: z.union([z.string(), z.array(AnthropicSystemBlockSchema)]).optional(),
  messages: z.array(AnthropicMessageSchema).min(1),
}).passthrough();

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

type IncomingHeaders = FastifyRequest['headers'];

export interface SessionIdentity {
  readonly hash: string;
  readonly source: 'header' | 'fallback';
}

export function readUpstreamUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];
  if (raw === undefined || raw === null) return null;
  const trimmed = String(raw).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Text-only stable view used for the fallback session hash. */
export function extractSystemText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .filter((block): block is Record<string, unknown> =>
      block !== null && typeof block === 'object')
    .filter((block) => block['type'] === 'text')
    .map((block) => typeof block['text'] === 'string' ? block['text'] : '')
    .join('\n\n');
}

export function extractFirstUserPrompt(
  messages: ReadonlyArray<z.infer<typeof AnthropicMessageSchema>>,
): string {
  for (const message of messages) {
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content;
    return message.content
      .map((block) => typeof block.text === 'string' ? block.text : '')
      .join('\n\n');
  }
  return '';
}

export function deriveSessionIdentity(
  headers: IncomingHeaders,
  originalSystem: unknown,
  firstUserPrompt: string,
): SessionIdentity {
  const explicit = headerValue(headers[SESSION_HEADER]);
  if (explicit !== null && explicit.length > 0) {
    return { hash: sha256Hex(explicit), source: 'header' };
  }
  const stableSystemText = extractSystemText(originalSystem);
  return {
    hash: sha256Hex(stableSystemText + String.fromCharCode(0) + firstUserPrompt),
    source: 'fallback',
  };
}

/**
 * The pipeline folds every original text block into its stable Block 1 so the
 * detailed SHA includes those exact text bytes. Unsupported/non-text blocks
 * cannot be represented by the two-block builder, so they remain verbatim
 * ahead of the two Memory Studio blocks and are explicitly outside that SHA.
 */
export function composeForwardedSystem(
  original: AnthropicMessagesRequest['system'],
  memoryStudioBlocks: readonly SystemBlock[],
): readonly Record<string, unknown>[] {
  // The pipeline folds every original text block into its stable Block 1,
  // so the detailed system already includes the original text bytes. We
  // forward any non-text original block (e.g. tool_result / image) that
  // the two-block builder cannot represent, so its presence is preserved
  // for the upstream call. Only blocks that are neither type=``text`` nor
  // a Memory Studio block need explicit preservation; text-type original
  // blocks are already folded into the first Memory Studio block.
  const preservedPrefix: Record<string, unknown>[] = [];
  if (Array.isArray(original)) {
    for (const block of original) {
      if (block.type === 'text') continue;
      preservedPrefix.push({ ...block });
    }
  }
  return [
    ...preservedPrefix,
    ...memoryStudioBlocks.map((block) => ({ ...block })),
  ];
}

/** Safe allowlist only; the internal Memory Studio session header is omitted. */
export function buildForwardHeaders(headers: IncomingHeaders): Headers {
  const forwarded = new Headers();
  for (const name of FORWARDED_HEADER_ALLOWLIST) {
    if (name === 'content-type') continue;
    const value = headerValue(headers[name]);
    if (value !== null) forwarded.set(name, value);
  }
  // The proxy always serializes the upstream body as JSON.
  forwarded.set('content-type', 'application/json');
  if (!forwarded.has('anthropic-version')) {
    forwarded.set('anthropic-version', '2023-06-01');
  }
  return forwarded;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value.join(', ') : value;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function enqueueAuditSafe(event: AuditEvent): void {
  try {
    getAuditBuffer()?.enqueue(event);
  } catch {
    // Audit is best-effort and never blocks the provider response.
  }
}

export interface MessagesProxyRouteOptions {
  upstreamUrl: string | null;
  allowedHostsCsv?: string;
  pipelineProvider: () => PipelineContext;
  runtimeContextProvider?: (sessionId: string) => Promise<ProductionRequestContext>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export async function registerMessagesProxyRoute(
  app: FastifyInstance,
  options: MessagesProxyRouteOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  app.post('/v1/messages', async (request, reply: FastifyReply) => {
    const tProxyStart = performance.now();
    const decisionTraceId = sha256Hex(String(now())).slice(0, 16);

    if (options.upstreamUrl === null) {
      reply.code(503);
      return {
        error: 'proxy_disabled',
        hint: 'Set MEMORY_STUDIO_ANTHROPIC_BASE_URL to enable',
      };
    }

    try {
      assertLoopback(options.upstreamUrl, options.allowedHostsCsv);
    } catch (error) {
      if (error instanceof ProxyHostNotAllowedError) {
        reply.code(502);
        return {
          error: 'proxy_host_not_allowed',
          host: error.host,
          hint: error.wildcardRejected
            ? 'Wildcard * is forbidden in MEMORY_STUDIO_PROXY_ALLOWED_HOSTS'
            : 'Add the host to MEMORY_STUDIO_PROXY_ALLOWED_HOSTS or use a loopback URL',
        };
      }
      throw error;
    }

    const parsed = AnthropicMessagesRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_anthropic_request', issues: parsed.error.issues };
    }

    const anthropicRequest = parsed.data;
    const originalSystem = anthropicRequest.system;
    const promptText = extractFirstUserPrompt(anthropicRequest.messages);
    const session = deriveSessionIdentity(request.headers, originalSystem, promptText);
    const redactedPromptHash = sha256Hex(
      extractSystemText(originalSystem) +
        String.fromCharCode(0) +
        JSON.stringify(anthropicRequest.messages),
    );

    let runtimeContext: ProductionRequestContext | null = null;
    let augmentResult: DetailedAugmentResult;
    try {
      if (options.runtimeContextProvider !== undefined) {
        runtimeContext = await options.runtimeContextProvider(session.hash);
      }
      const augmentRequest: AugmentRequest = AugmentRequestSchema.parse({
        prompt: promptText,
        context: null,
        fingerprint: {
          projectPath: '.',
          agentId: 'claude-code',
          sessionId: session.hash,
          gitBranch: 'main',
        },
        activeCatalog: runtimeContext === null
          ? []
          : [...runtimeContext.state.activeCatalog],
        tenantId: 'proxy-tenant',
        schemaVersion: 3,
      });
      const basePipeline = runtimeContext?.pipeline ?? options.pipelineProvider();
      const stableOriginalSystemText = extractSystemText(originalSystem);
      const hasOriginalText = stableOriginalSystemText.length > 0;
      const pipeline = hasOriginalText
        ? { ...basePipeline, originalSystemText: stableOriginalSystemText }
        : basePipeline;
      const detailed = await runAugmentDetailed(augmentRequest, pipeline);
      if (hasOriginalText) {
        // Pipeline already folded the original text into Block 1.
        // The proxy forwards the pipeline's exact blocks; unsupported
        // non-text blocks remain verbatim ahead of them.
        augmentResult = {
          response: detailed.response,
          system: detailed.system,
        };
      } else {
        augmentResult = detailed;
      }
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      enqueueAuditSafe({
        ts: now(),
        tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
        redactedPromptHash,
        matchedIds: [],
        pruningReasons: [],
        latencyMs: 0,
        fingerprint: {
          agentId: 'claude-code',
          source: 'proxy',
          sessionId: session.hash,
          decisionTraceId,
        },
        payload: { model: anthropicRequest.model, error: 'augment_failed', errorClass },
        eventType: 'messages_proxy',
      });
      reply.code(502);
      return { error: 'augment_failed', message: 'Memory Studio augmentation failed' };
    }

    const proxiedRequest = {
      ...anthropicRequest,
      system: composeForwardedSystem(originalSystem, augmentResult.system),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let upstreamResponse: Response;
    let upstreamText: string;
    try {
      upstreamResponse = await doFetch(`${options.upstreamUrl}/v1/messages`, {
        method: 'POST',
        headers: buildForwardHeaders(request.headers),
        body: JSON.stringify(proxiedRequest),
        signal: controller.signal,
      });
      upstreamText = await upstreamResponse.text();
    } catch (error) {
      clearTimeout(timer);
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      enqueueAuditSafe({
        ts: now(),
        tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
        redactedPromptHash,
        matchedIds: [],
        pruningReasons: [],
        latencyMs: 0,
        fingerprint: {
          agentId: 'claude-code',
          source: 'proxy',
          sessionId: session.hash,
          decisionTraceId,
        },
        payload: { model: anthropicRequest.model, error: 'upstream_fetch_failed', errorClass },
        eventType: 'messages_proxy',
      });
      reply.code(502);
      return { error: 'upstream_fetch_failed', message: 'Upstream provider request failed' };
    }
    clearTimeout(timer);

    const upstreamContentType = upstreamResponse.headers.get('content-type');
    const upstreamBody = parseJsonObject(upstreamText);
    const usage = objectValue(upstreamBody?.['usage']);
    const cacheReadInputTokens = nonNegativeNumber(usage?.['cache_read_input_tokens']);
    const cacheCreationInputTokens = nonNegativeNumber(usage?.['cache_creation_input_tokens']);
    const inputTokens = nonNegativeNumber(usage?.['input_tokens']);
    const outputTokens = nonNegativeNumber(usage?.['output_tokens']);

    const response = augmentResult.response;
    const matchedIds = [
      ...response.matchedSkills.map((item) => item.id),
      ...response.matchedRules.map((item) => item.id),
      ...response.matchedPersonas.map((item) => item.id),
    ];
    const pruningReasons = [
      ...response.pruningDecisions.rejectedByFloor.map((item) => item.reason),
      ...response.pruningDecisions.rejectedByBudget.map((item) => item.reason),
      ...response.pruningDecisions.rejectedByAttentionTier.map((item) => item.reason),
      ...response.pruningDecisions.rejectedByNegativeFeedback.map((item) => item.reason),
      ...response.pruningDecisions.rejectedByCriticalDropped.map((item) => item.reason),
    ];

    enqueueAuditSafe({
      ts: now(),
      tenantIdHashed: hashTenantId('proxy-tenant') ?? '',
      redactedPromptHash,
      matchedIds,
      pruningReasons,
      latencyMs: response.latencyMs.total,
      fingerprint: {
        agentId: 'claude-code',
        source: 'proxy',
        sessionId: session.hash,
        sessionSource: session.source,
        decisionTraceId,
      },
      payload: {
        model: anthropicRequest.model,
        systemMessageSha256: response.systemMessage,
        cacheReadInputTokens,
        cacheCreationInputTokens,
        inputTokens,
        outputTokens,
        upstreamStatus: upstreamResponse.status,
        responseComplete: true,
        stream: false,
      },
      eventType: 'messages_proxy',
    });

    if (upstreamResponse.status === 200) {
      recordProxySample({
        cacheReadTokens: cacheReadInputTokens,
        latencyMs: performance.now() - tProxyStart,
      });
    }

    reply.code(upstreamResponse.status);
    if (upstreamContentType !== null) reply.header('content-type', upstreamContentType);
    return reply.send(upstreamText);
  });
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return objectValue(value);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
