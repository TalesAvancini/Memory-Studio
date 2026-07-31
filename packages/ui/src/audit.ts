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

export const DEFAULT_AUDIT_LIMIT = 50;

export function selectRecentAuditEvents(
  events: readonly AuditViewEvent[],
  limit = DEFAULT_AUDIT_LIMIT,
): readonly AuditViewEvent[] {
  const boundedLimit = Number.isInteger(limit) && limit >= 0 ? limit : DEFAULT_AUDIT_LIMIT;
  return [...events]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, boundedLimit);
}

export function createEmptyAuditReader(): AuditReader {
  return {
    async latest() {
      return [];
    },
  };
}
