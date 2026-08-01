/**
 * Minimal GET /health endpoint for Phase 5a.1 smoke tests and container
 * liveness probes.
 *
 * Payload (Phase 5a.1 baseline + Phase 5b T-08 enhancement):
 *   {
 *     status: "ok",
 *     uptime_ms: <epoch ms since server start>,
 *     last_request_ts: <epoch ms of last successful /augment response,
 *                      or 0 when no request has succeeded yet>,
 *     request_id: <uuid v4>,
 *     schema_version: 3,
 *     audit_buffer: { depth, capacity: 100, last_flush_ts: <epoch_ms|null> },
 *     catalog: { count, last_rebuild_ts: <epoch_ms|null> }
 *   }
 *
 * Always returns 200 — liveness, not readiness. The audit_buffer
 * block surfaces the buffer's current depth (events pending flush)
 * and last flush timestamp so an operator can spot a stuck buffer
 * (D-007 fail-open visibility per PRD §10.4.4).
 *
 * `last_request_ts` is fed by `recordAugmentSuccess()` in `./augment.ts`,
 * keeping the augment handler free of /health wiring.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  getLastRequestTimestampMs,
  getServerStartTimeMs,
} from './boot.ts';
import { getAuditBufferSnapshot } from './audit/lifecycle.ts';
import { getCatalogSummary } from './audit/query.ts';
import { RING_BUFFER_CAPACITY } from './audit/buffer.ts';

interface HealthAuditBuffer {
  depth: number;
  capacity: number;
  last_flush_ts: number | null;
}

interface HealthCatalog {
  count: number;
  last_rebuild_ts: number | null;
}

interface HealthResponse {
  status: 'ok';
  uptime_ms: number;
  last_request_ts: number;
  request_id: string;
  schema_version: 3;
  audit_buffer: HealthAuditBuffer;
  catalog: HealthCatalog;
}

/**
 * Module-scoped handle to the SQLite DB so the health route can
 * compute `catalog.count`. Set by `boot.ts` via `setHealthDb()` when
 * a DB is wired into the server. When unset (the in-memory smoke
 * path), the block reports `count: 0` and `last_rebuild_ts: null`.
 */
let healthDb: import('better-sqlite3').Database | null = null;
let lastRebuildTs: number | null = null;

export function setHealthDb(db: import('better-sqlite3').Database | null): void {
  healthDb = db;
}

export function setLastRebuildTs(ts: number | null): void {
  lastRebuildTs = ts;
}

export function getLastRebuildTs(): number | null {
  return lastRebuildTs;
}

function resolvePackageVersion(): string {
  // Phase 5a.1 lives under src/server/, root package.json is 3 levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, '..', '..', '..', 'package.json');
  try {
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      const v = (parsed as { version: unknown }).version;
      if (typeof v === 'string') return v;
    }
  } catch {
    // Fall through to default — version is advisory, not a gate.
  }
  return '0.0.0';
}

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  const packageVersion = resolvePackageVersion();

  app.get('/health', async (): Promise<HealthResponse> => {
    const startTime = getServerStartTimeMs();
    const lastRequest = getLastRequestTimestampMs();
    const uptimeMs = startTime === 0 ? 0 : Date.now() - startTime;

    const snapshot = getAuditBufferSnapshot();
    const auditBuffer: HealthAuditBuffer = snapshot === null
      ? { depth: 0, capacity: RING_BUFFER_CAPACITY, last_flush_ts: null }
      : {
          depth: snapshot.depth,
          capacity: snapshot.capacity,
          last_flush_ts: snapshot.lastFlushTs,
        };

    const catalog: HealthCatalog =
      healthDb === null
        ? { count: 0, last_rebuild_ts: null }
        : { count: getCatalogSummary(healthDb).count, last_rebuild_ts: lastRebuildTs };

    return {
      status: 'ok',
      uptime_ms: uptimeMs,
      last_request_ts: lastRequest,
      request_id: randomUUID(),
      schema_version: 3,
      audit_buffer: auditBuffer,
      catalog,
    };
  });

  // Stash version on the app for downstream callers; cheap decorate so
  // future tests/handlers can read it without re-reading package.json.
  (app as unknown as { memoryStudioVersion: string }).memoryStudioVersion = packageVersion;
}