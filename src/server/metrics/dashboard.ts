/**
 * Metrics dashboard helper (Phase 7a T-03).
 *
 * Read-side seam from the `/metrics` route to the
 * `MetricsRingBuffer` singleton. Mirrors `collector.ts` (the write
 * seam).
 *
 * Why a separate file from `ring-buffer.ts`:
 *   - `ring-buffer.ts` defines the class + types (data + behavior).
 *   - `collector.ts` is the write seam (pipeline + proxy).
 *   - `dashboard.ts` is the read seam (route). It exposes two
 *     functions: `computeDashboard` (force-recompute) and
 *     `readDashboard` (cached read). The route uses `readDashboard`
 *     for constant-time responses.
 *
 * Per design.md §2.3, the route does NOT recompute on read — it
 * reads the cached snapshot produced by the count + time triggers.
 * On first call (no snapshot yet), the buffer lazily recomputes.
 */

import type { MetricsRingBuffer, MetricsSnapshot } from './ring-buffer.ts';

/**
 * Force-recompute the dashboard. Returns the freshly-computed
 * `MetricsSnapshot`. Called by tests that want to assert metrics
 * synchronously without waiting for the time trigger.
 */
export function computeDashboard(buffer: MetricsRingBuffer): MetricsSnapshot {
  return buffer.recomputeDashboard();
}

/**
 * Read the cached snapshot. Returns the last recomputed value;
 * on first call, lazily recomputes if the buffer has no snapshot
 * yet. This is the route's fast-path (< 1ms typical).
 */
export function readDashboard(buffer: MetricsRingBuffer): MetricsSnapshot {
  return buffer.snapshot();
}
