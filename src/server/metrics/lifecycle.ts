/**
 * Metrics buffer lifecycle (Phase 7a T-02).
 *
 * Manages the module-scoped singleton `MetricsRingBuffer`. Mirrors
 * `src/server/audit/lifecycle.ts` (the Phase 5b audit pattern):
 *
 *   - `initMetricsBuffer()` — creates the singleton. Idempotent —
 *     subsequent calls return the same instance.
 *   - `getMetricsBuffer()` — returns the singleton (or `null` if not
 *     yet initialized; collector uses this to fail-open gracefully).
 *   - `startMetricsBuffer()` — begins the 60s time trigger.
 *   - `stopMetricsBuffer()` — clears the time trigger. Wired into
 *     `boot.ts`'s SIGTERM handler.
 *   - `setMetricsBufferForTests(buffer)` — inject a custom buffer
 *     (e.g. for test isolation; reset with `null`).
 *   - `resetMetricsBufferForTests()` — clears module-scoped state
 *     between test runs.
 *
 * The singleton is process-scoped (matches AuditRingBuffer). The
 * collector (`collector.ts`) calls `getMetricsBuffer()` and `?.recordAugment(...)`
 * so a missing buffer fails open without blocking the request.
 */

import { MetricsRingBuffer } from './ring-buffer.ts';

let bufferInstance: MetricsRingBuffer | null = null;

export function initMetricsBuffer(): MetricsRingBuffer {
  if (bufferInstance !== null) return bufferInstance;
  bufferInstance = new MetricsRingBuffer();
  return bufferInstance;
}

export function getMetricsBuffer(): MetricsRingBuffer | null {
  return bufferInstance;
}

export async function startMetricsBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  bufferInstance.start();
}

export async function stopMetricsBuffer(): Promise<void> {
  if (bufferInstance === null) return;
  await bufferInstance.stop();
}

/** Test-only — inject a custom buffer (or `null` to reset). */
export function setMetricsBufferForTests(buffer: MetricsRingBuffer | null): void {
  bufferInstance = buffer;
}

/** Test-only — reset module-scoped state between runs. */
export function resetMetricsBufferForTests(): void {
  if (bufferInstance !== null) {
    bufferInstance.resetForTests();
  }
  bufferInstance = null;
}
