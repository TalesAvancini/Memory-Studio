/**
 * Minimal GET /health endpoint for Phase 5a.1 smoke tests and container
 * liveness probes.
 *
 * Payload:
 *   {
 *     status: "ok",
 *     uptime_ms: <epoch ms since server start>,
 *     last_request_ts: <epoch ms of last successful /augment response,
 *                      or 0 when no request has succeeded yet>
 *   }
 *
 * Always returns 200 — readiness checks (catalog DB, ONNX model,
 * FTS5/vec extensions) land in Phase 5b alongside the broader endpoint
 * surface per PRD §7.2.
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

interface HealthResponse {
  status: 'ok';
  uptime_ms: number;
  last_request_ts: number;
  request_id: string;
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
    return {
      status: 'ok',
      uptime_ms: uptimeMs,
      last_request_ts: lastRequest,
      request_id: randomUUID(),
    };
  });

  // Stash version on the app for downstream callers; cheap decorate so
  // future tests/handlers can read it without re-reading package.json.
  (app as unknown as { memoryStudioVersion: string }).memoryStudioVersion = packageVersion;
}