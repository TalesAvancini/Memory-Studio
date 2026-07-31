/**
 * Structured pino JSON logger for the augment server.
 *
 * Phase 5a.1 (T-04) — every /augment request emits a single-line JSON
 * log with fields ready for Phase 5a.4 perf analysis:
 *
 *   {
 *     "level": "info",
 *     "time": "2026-07-31T12:34:56.789Z",
 *     "requestId": "550e8400-...",
 *     "tenantId_hashed": "abc123...",
 *     "latencyMs": { "embedding": 12.3, "retrieval": 4.5, "rerank": 0, "total": 18.2 },
 *     "matchedIds": ["..."],
 *     "systemMessageSha256": "def456...",
 *     "usage": { "cache_read_input_tokens": null, "cache_creation_input_tokens": null },
 *     "msg": "/augment"
 *   }
 *
 * `usage.cache_read_input_tokens` is `null` in Phase 5a.1 (Phase 5b wires
 * the /v1/messages proxy and surfaces provider cache metrics).
 *
 * Per L-006 (Phase 4.4 lesson): timestamps use `Date.now()` style (epoch
 * ms) via `pino.stdTimeFunctions.isoTime` for ISO 8601 string output,
 * keeping perf measurement drift observable across runs.
 */

import pino, { type Logger } from 'pino';

export const logger: Logger = pino({
  level: process.env['MEMORY_STUDIO_LOG_LEVEL'] ?? 'info',
  formatters: {
    level(label: string): { level: string } {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface RequestLoggerOptions {
  requestId: string;
  tenantIdHashed: string | null;
}

/**
 * Build a child logger that always carries `requestId` and
 * `tenantId_hashed` so the structured log line can be joined to audit
 * events (Phase 5b) without re-passing context.
 */
export function requestLogger(options: RequestLoggerOptions): Logger {
  const { requestId, tenantIdHashed } = options;
  return logger.child({
    requestId,
    tenantId_hashed: tenantIdHashed,
  });
}