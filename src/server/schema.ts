/**
 * Zod schemas for the Memory Studio `/augment` endpoint.
 *
 * Phase 5a.1 (T-02) — request/response shapes per PRD §7.1, narrowed to
 * Phase 5a.1's scope:
 *
 *   - Required fields: `prompt`, `context` (nullable), `fingerprint`,
 *     `activeCatalog`, `schemaVersion`.
 *   - Optional: `tenantId` (per Phase 5a.1 dispatch override — server
 *     tolerates missing `tenantId` and emits `tenantId_hashed: null`).
 *   - `context: null` and `context` absent are treated identically
 *     (prompt-only mode).
 *   - `agentId` is restricted to the canonical literal `"claude-code"`
 *     (R-06 / PRD §14.4). Phase 5a.4 deferred this enforcement to Phase
 *     5b (the proxy layer gives visibility into non-canonical clients);
 *     T-11 picks up the tightening. The errorMap returns a deterministic
 *     message so the integration test (R-06 AC-26) can assert on the
 *     exact text `"agentId must be one of: claude-code"`.
 *
 * The same shapes are re-exported as inferred TypeScript types so the
 * SDK package can mirror them without a build step.
 */

import { z } from 'zod';

export const LastEventTypeSchema = z.enum(['tool_error', 'tool_call', 'tool_result']);
export type LastEventType = z.infer<typeof LastEventTypeSchema>;

export const LastEventSeveritySchema = z.enum(['warning', 'error', 'critical']);
export type LastEventSeverity = z.infer<typeof LastEventSeveritySchema>;

export const TodoItemSchema = z.object({
  status: z.string(),
  text: z.string(),
});
export type TodoItem = z.infer<typeof TodoItemSchema>;

export const LastEventSchema = z.object({
  type: LastEventTypeSchema,
  severity: LastEventSeveritySchema.optional(),
  payload: z.unknown(),
});
export type LastEvent = z.infer<typeof LastEventSchema>;

export const ContextSchema = z
  .object({
    scratch: z.string().optional(),
    todos: z.array(TodoItemSchema).optional(),
    recentFiles: z.array(z.string()).optional(),
    lastEvent: LastEventSchema.optional(),
    legacyState: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .nullable();
export type Context = z.infer<typeof ContextSchema>;

export const FingerprintSchema = z.object({
  projectPath: z.string(),
  agentId: z.literal('claude-code', {
    errorMap: () => ({ message: 'agentId must be one of: claude-code' }),
  }),
  sessionId: z.string(),
  gitBranch: z.string(),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export const AugmentRequestSchema = z.object({
  prompt: z.string().min(1),
  context: ContextSchema.optional(),
  fingerprint: FingerprintSchema,
  activeCatalog: z.array(z.string()),
  tenantId: z.string().optional(),
  schemaVersion: z.literal(3),
});
export type AugmentRequest = z.infer<typeof AugmentRequestSchema>;

export const MatchedSkillSchema = z.object({
  id: z.string(),
  score: z.number(),
  source: z.enum(['builtin', 'user']),
});
export type MatchedSkill = z.infer<typeof MatchedSkillSchema>;

export const MatchedRuleSchema = z.object({
  id: z.string(),
  score: z.number(),
  critical: z.boolean(),
});
export type MatchedRule = z.infer<typeof MatchedRuleSchema>;

export const MatchedPersonaSchema = z.object({
  id: z.string(),
  score: z.number(),
  isDefault: z.boolean(),
});
export type MatchedPersona = z.infer<typeof MatchedPersonaSchema>;

export const PruningDecisionsSchema = z.object({
  rejectedByFloor: z.array(z.object({ id: z.string(), reason: z.string() })),
  rejectedByBudget: z.array(z.object({ id: z.string(), reason: z.string() })),
  rejectedByAttentionTier: z.array(z.object({ id: z.string(), reason: z.string() })),
  rejectedByNegativeFeedback: z.array(z.object({ id: z.string(), reason: z.string() })),
  rejectedByCriticalDropped: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type PruningDecisions = z.infer<typeof PruningDecisionsSchema>;

export const LatencyMsSchema = z.object({
  embedding: z.number(),
  retrieval: z.number(),
  rerank: z.number(),
  total: z.number(),
});
export type LatencyMs = z.infer<typeof LatencyMsSchema>;

export const EmptyReasonSchema = z
  .enum(['low_confidence', 'social', 'timeout', 'no_active_items'])
  .nullable();
export type EmptyReason = z.infer<typeof EmptyReasonSchema>;

/**
 * Full response shape per PRD §7.1. Phase 5a.1 returns a placeholder
 * 200 response that matches the structural contract — retrieval and
 * augmentation arrive in Phase 5a.2.
 */
export const AugmentResponseSchema = z.object({
  systemMessage: z.string(),
  matchedSkills: z.array(MatchedSkillSchema),
  matchedRules: z.array(MatchedRuleSchema),
  matchedPersonas: z.array(MatchedPersonaSchema),
  pruningDecisions: PruningDecisionsSchema,
  latencyMs: LatencyMsSchema,
  decisionTraceId: z.string(),
  warnings: z.array(z.string()),
  emptyReason: EmptyReasonSchema.optional(),
  schemaVersion: z.literal(3),
});
export type AugmentResponse = z.infer<typeof AugmentResponseSchema>;