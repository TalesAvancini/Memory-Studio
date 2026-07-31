export interface AuditViewEvent {
  timestamp: string;
  redactedPrompt: string;
  matchedIds: string[];
  pruningReasons: string[];
  latencyMs: number;
}

export interface AuditReader {
  latest(limit: number): Promise<readonly AuditViewEvent[]>;
}

export function createEmptyAuditReader(): AuditReader {
  return {
    async latest() {
      return [];
    },
  };
}
