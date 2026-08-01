/**
 * GET /metrics route (Phase 7a T-04).
 *
 * Surfaces the `MetricsSnapshot` produced by `MetricsRingBuffer`
 * as a JSON response. The route reads the CACHED snapshot
 * (`readDashboard` — O(1), < 1ms) so it never recomputes on the
 * request path. Recomputes happen on the count (every 10 requests)
 * and time (every 60s) triggers inside the buffer.
 *
 * Why a NEW endpoint (vs extending `/health`):
 *   - `/health` is the liveness probe (PRD §10.4). Its payload is
 *     fixed-shape for container orchestrators. Inflating it with 5+
 *     metric fields would break K8s probe parsing + log greppability.
 *   - `/health` answers "is the server up?" (binary); `/metrics`
 *     answers "how is it performing?" (quantitative). Mixing them
 *     conflates two responsibilities (see design.md §3).
 *   - Phase 7a follows the Phase 5b pattern: `/health` is stable;
 *     new functionality gets a new endpoint.
 *
 * Schema version: 1 (own counter; not tied to `/health`'s v3).
 *
 * Auth: none (operational endpoint, like `/health`).
 *
 * Reference: spec.md R-7 + AC-8.
 */

import type { FastifyInstance } from 'fastify';
import type { MetricsRingBuffer } from '../metrics/ring-buffer.ts';
import { readDashboard } from '../metrics/dashboard.ts';

export interface MetricsRouteOptions {
  /** The buffer to read from. Wired in `boot.ts` via the lifecycle singleton. */
  buffer: MetricsRingBuffer;
}

export async function registerMetricsRoute(
  app: FastifyInstance,
  opts: MetricsRouteOptions,
): Promise<void> {
  app.get('/metrics', async () => {
    return readDashboard(opts.buffer);
  });
}
