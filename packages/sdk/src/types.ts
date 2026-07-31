export type RedactionMode = 'minimal' | 'strict';
export type RedactionLevel = RedactionMode;

export interface Context {
  scratch?: string;
  todos?: { status: string; text: string }[];
  recentFiles?: string[];
  lastEvent?: { type: 'tool_error' | 'tool_call' | 'tool_result'; severity?: 'warning' | 'error' | 'critical'; payload: unknown };
  legacyState?: string;
  sessionId?: string;
}
export interface CollectContextInput { scratch?: string; todos?: { status: string; text: string }[]; recentFiles?: string[]; lastEvent?: Context['lastEvent']; legacyState?: string; sessionId?: string; redaction?: RedactionMode; }
export interface FingerprintInput { projectPath: string; agentId?: string; sessionId: string; gitBranch: string; }
export interface Fingerprint { projectPath: string; agentId: string; sessionId: string; gitBranch: string; }
export interface AugmentRequest { prompt: string; context?: Context | null; fingerprint: Fingerprint; activeCatalog: string[]; tenantId?: string; schemaVersion: 3; }
export interface AugmentResponse {
  systemMessage: string; matchedSkills: { id: string; score: number; source: 'builtin' | 'user' }[];
  matchedRules: { id: string; score: number; critical: boolean }[];
  matchedPersonas: { id: string; score: number; isDefault: boolean }[];
  pruningDecisions: { rejectedByFloor: { id: string; reason: string }[]; rejectedByBudget: { id: string; reason: string }[]; rejectedByAttentionTier: { id: string; reason: string }[]; rejectedByNegativeFeedback: { id: string; reason: string }[]; rejectedByCriticalDropped: { id: string; reason: string }[] };
  latencyMs: { embedding: number; retrieval: number; rerank: number; total: number };
  decisionTraceId: string; warnings: string[]; emptyReason?: 'low_confidence' | 'social' | 'timeout' | 'no_active_items' | null; schemaVersion: 3;
}
export class SdkError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = 'SdkError'; this.code = code; } }
