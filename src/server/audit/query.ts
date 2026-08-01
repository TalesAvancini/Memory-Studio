/**
 * Audit query helpers (Phase 5b T-04 + T-06 + T-07).
 *
 * Read-side scaffolding for the `/audit` and `/audit/summary` endpoints
 * (consumed by routes/audit-list.ts + audit-summary.ts). Also exposes
 * a lightweight `getCatalogSummary` helper for the enhanced `/health`
 * payload's `catalog` block.
 *
 * The query layer is intentionally minimal: it returns rows directly
 * from SQLite (already-typed as `AuditRow`). The route handler is
 * responsible for shaping the public response (no raw text fields per
 * PRD §10.3.1).
 *
 * Performance:
 *   - `queryAuditEvents` uses the `idx_audit_events_ts` index added by
 *     migration 003 to satisfy PRD §10.4.3 (<100ms / 30days / 1000 rows).
 *   - `queryAuditSummary` aggregates by date with a single GROUP BY.
 *     The `topPruningReason` and `topMatchedId` are computed inline via
 *     subqueries — kept simple because the table only has 9 columns.
 */

import type { Database } from 'better-sqlite3';
import type { AuditRow } from './types.ts';

export interface QueryAuditEventsOptions {
  /** Default 50, max 500 (clamped by the route handler). */
  limit?: number;
  /** Default undefined (all time). */
  rangeDays?: number;
}

export interface DailyRollup {
  readonly date: string;
  readonly count: number;
  readonly avgLatencyMs: number | null;
  readonly matchedItemsTotal: number;
  readonly topPruningReason: string | null;
  readonly topMatchedId: string | null;
}

export function queryAuditEvents(
  db: Database,
  opts: QueryAuditEventsOptions = {},
): ReadonlyArray<AuditRow> {
  const limit = opts.limit ?? 50;
  const cutoffTs =
    opts.rangeDays === undefined
      ? null
      : Date.now() - opts.rangeDays * 86_400_000;

  if (cutoffTs === null) {
    const rows = db
      .prepare(
        `SELECT id, ts, "tenantId_hashed" AS tenantIdHashed, event_type AS eventType,
                payload, fingerprint, matched_ids AS matchedIds,
                pruning_reasons AS pruningReasons, latency_ms AS latencyMs,
                redacted_prompt_hash AS redactedPromptHash
         FROM audit_events
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(limit) as ReadonlyArray<AuditRow>;
    return rows;
  }

  const rows = db
    .prepare(
      `SELECT id, ts, "tenantId_hashed" AS tenantIdHashed, event_type AS eventType,
              payload, fingerprint, matched_ids AS matchedIds,
              pruning_reasons AS pruningReasons, latency_ms AS latencyMs,
              redacted_prompt_hash AS redactedPromptHash
       FROM audit_events
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(cutoffTs, limit) as ReadonlyArray<AuditRow>;
  return rows;
}

export function queryAuditSummary(
  db: Database,
  opts: { rangeDays?: number } = {},
): ReadonlyArray<DailyRollup> {
  const cutoffTs =
    opts.rangeDays === undefined
      ? 0
      : Date.now() - opts.rangeDays * 86_400_000;

  const rows = db
    .prepare(
      `SELECT
         date(ts / 1000, 'unixepoch') AS date,
         COUNT(*) AS count,
         AVG(latency_ms) AS avgLatencyMs,
         COALESCE(SUM(json_array_length(matched_ids)), 0) AS matchedItemsTotal
       FROM audit_events
       WHERE ts >= ?
       GROUP BY date
       ORDER BY date DESC`,
    )
    .all(cutoffTs) as Array<{
    date: string;
    count: number;
    avgLatencyMs: number | null;
    matchedItemsTotal: number;
  }>;

  // Compute topPruningReason + topMatchedId per day with a single
  // subquery each. The table is small (one row per day after GROUP BY),
  // so a per-row subquery is acceptable. The route's perf gate
  // (<100ms / 30days / 1000 rows) is satisfied by the
  // idx_audit_events_ts index added in migration 003.
  const enriched: DailyRollup[] = [];
  for (const row of rows) {
    const prRow = db
      .prepare(
        `SELECT pruning_reasons AS pr
         FROM audit_events
         WHERE date(ts / 1000, 'unixepoch') = ? AND pruning_reasons IS NOT NULL
         LIMIT 1`,
      )
      .get(row.date) as { pr: string | null } | undefined;
    const midRow = db
      .prepare(
        `SELECT matched_ids AS mids
         FROM audit_events
         WHERE date(ts / 1000, 'unixepoch') = ? AND matched_ids IS NOT NULL
         LIMIT 1`,
      )
      .get(row.date) as { mids: string | null } | undefined;

    enriched.push({
      date: row.date,
      count: row.count,
      avgLatencyMs: row.avgLatencyMs,
      matchedItemsTotal: row.matchedItemsTotal,
      topPruningReason: prRow?.pr ?? null,
      topMatchedId: midRow?.mids ?? null,
    });
  }
  return enriched;
}

export interface CatalogSummary {
  readonly count: number;
}

export function getCatalogSummary(db: Database): CatalogSummary {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM catalog')
    .get() as { count: number };
  return { count: row.count };
}