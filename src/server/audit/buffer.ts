/**
 * Audit ring buffer (D-007 CRITICAL runtime).
 *
 * Per PRD §10.3.1 + SPEC §IMod-8 every mutation request enqueues an
 * audit event into an in-memory ring buffer and returns 200 immediately.
 * The buffer flushes to SQLite in batches on EITHER trigger:
 *   - count trigger: N=100 events
 *   - time trigger:  T=1000ms (first enqueue starts the timer)
 * Whichever fires first wins. SQLite write errors are caught and the
 * batch is dropped — the request that triggered the enqueue is NEVER
 * blocked (PRD §8 invariante nova 15: SQLite write failures must not
 * cascade into request latency).
 *
 * Safety valves:
 *   - RING_BUFFER_CAPACITY (10_000) hard cap. If the buffer reaches
 *     capacity because the writer has been failing, the OLDEST event is
 *     dropped and a stderr line is emitted. This is a last-resort
 *     guardrail; in normal operation the count/time triggers keep the
 *     buffer well under 1_000 events.
 *
 * Concurrency:
 *   - The flush uses `buffer.splice(0, length)` which atomically takes
 *     ownership of the current batch. New enqueues after the splice go
 *     into a fresh buffer. No locks needed; the splice is the sync
 *     primitive.
 *   - The timer is started on the FIRST enqueue and cleared on every
 *     flush, so the cadence is "100 events within the last 1000ms OR
 *     1000ms elapsed since the last enqueue."
 *
 * Lifecycle:
 *   - `start()` — currently a no-op (the timer is lazy; no startup
 *     needed). Kept for future use and so `boot.ts` has a symmetric
 *     start/stop pair.
 *   - `stop()` — flushes the remainder with reason `'shutdown'` and
 *     clears the timer. Wired into `boot.ts`'s SIGTERM handler.
 *
 * Fail-open (D-007):
 *   - On writer error: stderr line `[audit] write failed (reason);
 *     dropped N events: <error>`. `lastFlushTs` is set to `null` so
 *     `/health` can surface the stuck-buffer signal. The buffer is
 *     NOT poisoned — subsequent `enqueue()` calls succeed normally.
 */

import type { AuditEvent, AuditWriter } from './types.ts';

export const FLUSH_COUNT_TRIGGER = 100;
export const FLUSH_TIME_MS = 1000;
export const RING_BUFFER_CAPACITY = 10_000;

/** Why a flush was triggered. */
export type FlushReason = 'count-trigger' | 'time-trigger' | 'shutdown';

export interface AuditBufferSnapshot {
  readonly depth: number;
  readonly capacity: typeof RING_BUFFER_CAPACITY;
  readonly lastFlushTs: number | null;
}

export class AuditRingBuffer {
  private readonly writer: AuditWriter;
  private buffer: AuditEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushTs: number | null = null;
  private started = false;

  constructor(writer: AuditWriter) {
    this.writer = writer;
  }

  /**
   * No-op stub. The timer is lazy — the first `enqueue()` starts it.
   * Kept so `boot.ts` has a symmetric start/stop pair.
   */
  start(): void {
    this.started = true;
  }

  /**
   * Flush any remaining events (reason `'shutdown'`) and clear the
   * timer. Returns the promise from the writer's `writeBatch` so
   * `boot.ts` can `await` graceful shutdown.
   */
  async stop(): Promise<void> {
    await this.flush('shutdown');
    this.started = false;
  }

  /**
   * Push an event into the buffer. Triggers a count-based flush when
   * `buffer.length` reaches `FLUSH_COUNT_TRIGGER`. Starts the time
   * trigger timer if no flush is pending.
   */
  enqueue(event: AuditEvent): void {
    // Safety valve: drop oldest event if at capacity. The buffer
    // should never reach this in normal operation — the count + time
    // triggers flush long before capacity. Reaching capacity means
    // the writer has been failing for a while.
    if (this.buffer.length >= RING_BUFFER_CAPACITY) {
      this.buffer.shift();
      console.error(
        `[audit] buffer at capacity (${RING_BUFFER_CAPACITY}); oldest event dropped`,
      );
    }
    this.buffer.push(event);

    if (this.buffer.length >= FLUSH_COUNT_TRIGGER) {
      // Fire-and-forget — the request that triggered the enqueue
      // does not await the flush (D-007 fail-open).
      void this.flush('count-trigger');
    } else if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        void this.flush('time-trigger');
      }, FLUSH_TIME_MS);
      // unref so a pending timer does not keep the event loop alive
      // in tests that explicitly stop the server.
      this.flushTimer.unref?.();
    }
  }

  /**
   * Flush the current buffer to the writer. Atomically splices the
   * buffer (no events lost during a concurrent enqueue) and clears
   * the timer. On writer error: logs to stderr, sets `lastFlushTs` to
   * null (stuck-buffer signal for `/health`), drops the batch — does
   * NOT retry, does NOT block the calling request.
   */
  async flush(reason: FlushReason): Promise<void> {
    if (this.buffer.length === 0) return;

    // Atomically take ownership of the current batch. After the splice,
    // new enqueues go into a fresh buffer.
    const batch = this.buffer.splice(0, this.buffer.length);

    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    try {
      await this.writer.writeBatch(batch);
      this.lastFlushTs = Date.now();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[audit] write failed (${reason}); dropped ${batch.length} events: ${message}`,
      );
      this.lastFlushTs = null;
    }
  }

  /** Current buffer depth (events waiting to flush). */
  getDepth(): number {
    return this.buffer.length;
  }

  /**
   * Epoch ms of the last successful flush, or `null` if a flush has
   * failed since boot (signals a stuck buffer to `/health`).
   */
  getLastFlushTs(): number | null {
    return this.lastFlushTs;
  }

  /** Snapshot for `/health`. */
  snapshot(): AuditBufferSnapshot {
    return {
      depth: this.buffer.length,
      capacity: RING_BUFFER_CAPACITY,
      lastFlushTs: this.lastFlushTs,
    };
  }

  /** Test-only — reset module-scoped state between runs. */
  resetForTests(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer = [];
    this.lastFlushTs = null;
    this.started = false;
  }
}