/**
 * GET /audit + GET /audit/summary endpoints (Phase 5b T-06 + T-07).
 *
 * /audit returns the last N audit events (default 50, max 500) as
 * redacted JSON: NO raw prompt/context text, only metadata per
 * PRD §10.3.1. Supports `?limit=N` (default 50, max 500) and
 * `?range=Ndays` (default 30, max 365).
 *
 * /audit/summary returns daily rollups: `{date, count, avgLatencyMs,
 * matchedItemsTotal, topPruningReason, topMatchedId}`. Designed for
 * Phase 7a consumption. Supports `?range=Ndays` (default 30, max 365).
 *
 * Both endpoints are read-only and do NOT enqueue audit events
 * (the audit log records mutations, not reads).
 *
 * Performance gate (R-15 / PRD §10.4.3): GET /audit?range=30days
 * returns in <100ms with a dataset of 1000+ rows. Verified by
 * `test/audit/perf-100ms.test.mjs` (T-08). The
 * `idx_audit_events_ts` index added by migration 003 keeps the
 * query plan cheap (ORDER BY ts DESC with a range filter uses the
 * index for both filter + sort).
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import {
  queryAuditEvents,
  queryAuditSummary,
} from '../audit/query.ts';
import type { AuditRow } from '../audit/types.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

interface AuditListResponseItem {
  ts: number;
  tenantId_hashed: string | null;
  eventType: string;
  latencyMs: number | null;
  matchedIds: ReadonlyArray<string>;
  pruningReasons: ReadonlyArray<string>;
  redactedPromptHash: string | null;
  fingerprint: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
}

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function clampRangeDays(raw: unknown): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RANGE_DAYS;
  return Math.min(n, MAX_RANGE_DAYS);
}

function parseJsonOrNull(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toPublicResponse(
  rows: ReadonlyArray<AuditRow>,
): ReadonlyArray<AuditListResponseItem> {
  return rows.map((row) => {
    const matchedIds = parseJsonOrNull(row.matchedIds);
    const pruningReasons = parseJsonOrNull(row.pruningReasons);
    return {
      ts: row.ts,
      tenantId_hashed: row.tenantIdHashed,
      eventType: row.eventType,
      latencyMs: row.latencyMs,
      matchedIds: Array.isArray(matchedIds) ? (matchedIds as string[]) : [],
      pruningReasons: Array.isArray(pruningReasons)
        ? (pruningReasons as string[])
        : [],
      redactedPromptHash: row.redactedPromptHash,
      fingerprint: parseJsonOrNull(row.fingerprint) as Record<string, unknown> | null,
      payload: parseJsonOrNull(row.payload) as Record<string, unknown> | null,
    };
  });
}

export async function registerAuditListRoute(
  app: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  app.get('/audit', async (request): Promise<ReadonlyArray<AuditListResponseItem>> => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const limit = clampLimit(q['limit']);
    const rangeDays = clampRangeDays(q['range']);
    const rows = queryAuditEvents(opts.db, { limit, rangeDays });
    return toPublicResponse(rows);
  });
}

export async function registerAuditSummaryRoute(
  app: FastifyInstance,
  opts: { db: Database },
): Promise<void> {
  app.get('/audit/summary', async (request) => {
    const q = (request.query ?? {}) as Record<string, unknown>;
    const rangeDays = clampRangeDays(q['range']);
    return queryAuditSummary(opts.db, { rangeDays });
  });
}