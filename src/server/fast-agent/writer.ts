/**
 * Fast agent writer — persists the Intel literal to the catalog
 * SQLite table (Phase 6b R-06 / AC-5).
 *
 * Two write modes per AD-006 #4:
 *   1. **Sync** (default). One `INSERT OR REPLACE` per call. Phase 6a
 *      POC measured 0.02ms per write — well under the 1ms fallback
 *      trigger (A-6).
 *   2. **Async** (D-007 fallback, NOT auto-activated). Mirrors
 *      `AuditRingBuffer` — in-memory ring buffer + batch flush
 *      N=100 OR T=1000ms + fail-open. Created only if the perf test
 *      reports `p95 > 1ms` (writer-perf.test.mjs).
 *
 * AD-008 (T-17) records the measured sync p95 and decides which
 * mode is canonical for production. The Implementer's job in this
 * phase is to:
 *   - ship the sync writer (canonical)
 *   - ship the async writer factory (documented fallback)
 *   - measure & record the perf result
 *
 * The module-level `setIntelWriterDb(db)` test seam lets the
 * augment pipeline inject the catalog `Database` at boot (the
 * pipeline owns the DB lifecycle via boot.ts). Tests inject
 * `:memory:` directly so the writer does not need its own file
 * IO + WAL setup. Callers that don't bind a DB before the first
 * `writeIntelSync(...)` get a clear error — never silent corruption.
 */

import { performance } from 'node:perf_hooks';
import type { Database } from 'better-sqlite3';

import type { Intel } from './intel-schema.ts';
import { writeIntelRow } from '../../catalog/intel-store.ts';

// ---------------------------------------------------------------------------
// Module-scoped DB handle — bound at boot, swappable for tests.
// ---------------------------------------------------------------------------

let _writerDb: Database | null = null;

/**
 * Bind the catalog DB the writer writes into. Production calls this
 * once at boot (the augment pipeline owns the handle). Tests inject
 * `:memory:` for hermetic perf measurements.
 *
 * Pass `null` to unbind (test cleanup).
 */
export function setIntelWriterDb(db: Database | null): void {
  _writerDb = db;
}

/** Test-only — read the currently bound DB. */
export function getIntelWriterDb(): Database | null {
  return _writerDb;
}

/** Test-only — reset the writer's module-scoped state between runs. */
export function resetIntelWriterForTests(): void {
  _writerDb = null;
}

// ---------------------------------------------------------------------------
// Public API: writeIntelSync — the canonical hot-path write.
// ---------------------------------------------------------------------------

/**
 * Synchronous write of an Intel literal to the bound catalog DB.
 * Naming matches the spec verbatim (`writeIntelSync(sessionId, intel)`);
 * returns `Promise<void>` to keep the callsite uniform with the
 * async fallback (`writeIntelAsync`, future).
 *
 * Throws when no DB is bound — never silently drops intel. The hot
 * path never reaches `writeIntelSync` without a bound DB (boot.ts
 * binds during `createServer()`).
 */
export async function writeIntelSync(sessionId: string, intel: Intel): Promise<void> {
  const db = _writerDb;
  if (db === null) {
    throw new Error(
      '[fast-agent-writer] no catalog DB bound — call setIntelWriterDb(db) before writeIntelSync',
    );
  }
  const ts = Math.floor(Date.now() / 1000);
  writeIntelRow(db, sessionId, intel, ts);
}

// ---------------------------------------------------------------------------
// Factories: createSyncIntelWriter / createAsyncIntelWriter
// ---------------------------------------------------------------------------

export interface IntelWriter {
  /** Write one Intel literal to the store. */
  write(sessionId: string, intel: Intel): Promise<void>;
  /**
   * Measure the latency of the canonical (sync) write path.
   * Used by writer-perf.test.mjs to decide sync vs async. The
   * async writer returns 0 here — its `write()` is fire-and-forget.
   */
  measureSyncWriteMs(sessionId: string, intel: Intel): Promise<number>;
}

/**
 * Sync writer — wraps `writeIntelRow` directly. Default per AD-006 #4.
 */
export function createSyncIntelWriter(db: Database): IntelWriter {
  return {
    async write(sessionId, intel) {
      writeIntelRow(db, sessionId, intel, Math.floor(Date.now() / 1000));
    },
    async measureSyncWriteMs(sessionId, intel) {
      const t0 = performance.now();
      writeIntelRow(db, sessionId, intel, Math.floor(Date.now() / 1000));
      return performance.now() - t0;
    },
  };
}

// ---------------------------------------------------------------------------
// Async fallback (D-007 mirror) — ship the factory, do NOT auto-activate.
// ---------------------------------------------------------------------------

/** Mirror of audit/buffer.ts constants. Kept local so the writer's
 * contract is testable without pulling audit dependencies in. */
const FLUSH_COUNT_TRIGGER = 100;
const FLUSH_TIME_MS = 1_000;
const RING_BUFFER_CAPACITY = 10_000;

/**
 * Async writer — NOT auto-activated. Mirrors `AuditRingBuffer`:
 *   - In-memory ring buffer (capacity 10_000)
 *   - `enqueue()` push + immediate return (fire-and-forget)
 *   - `flush()` triggered at `FLUSH_COUNT_TRIGGER` events OR
 *     `FLUSH_TIME_MS` (whichever first)
 *   - Fail-open: write error → stderr line, batch dropped,
 *     `enqueue()` never blocks
 *
 * Activated only when `writer-perf.test.mjs` reports
 * `p95 > 1ms` per AD-006 #4 fallback trigger. AD-008 (T-17)
 * records the measured p95 + the activatED / NOT-ACTIVATED choice.
 */
export function createAsyncIntelWriter(db: Database): IntelWriter {
  interface PendingIntel {
    readonly sessionId: string;
    readonly intel: Intel;
    readonly ts: number;
  }
  let buffer: PendingIntel[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlushTimer(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush('time-trigger');
    }, FLUSH_TIME_MS);
  }

  async function flush(reason: 'count-trigger' | 'time-trigger' | 'shutdown'): Promise<void> {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    for (const entry of batch) {
      try {
        writeIntelRow(db, entry.sessionId, entry.intel, entry.ts);
      } catch (err) {
        // Fail-open: drop the row, log to stderr, never crash the
        // fast-agent call site. Mirrors `AuditRingBuffer.enqueue`'s
        // catch in src/server/audit/buffer.ts.
        const reason2 = err instanceof Error ? err.message : String(err);
        console.error(`[fast-agent-writer] async ${reason} flush failed: ${reason2}; dropped 1 entry`);
      }
    }
  }

  return {
    async write(sessionId, intel) {
      if (buffer.length >= RING_BUFFER_CAPACITY) {
        buffer.shift();
        console.error(
          '[fast-agent-writer] ring buffer at capacity; dropped oldest entry (fail-open)',
        );
      }
      buffer.push({
        sessionId,
        intel,
        ts: Math.floor(Date.now() / 1000),
      });
      scheduleFlushTimer();
      if (buffer.length >= FLUSH_COUNT_TRIGGER) {
        await flush('count-trigger');
      }
    },
    async measureSyncWriteMs() {
      // Async writer's sync-write path is empty — return 0 to make
      // the perf test trivially distinguish which mode is active.
      return 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Default export: the canonical sync writer factory, used by boot.ts.
// ---------------------------------------------------------------------------

/**
 * Default IntelWriter factory used by boot.ts. Returns a sync writer
 * bound to the supplied catalog DB. Phase 6b wires this in via
 * `createServer()` (T-13) — the proxy / pipeline call sites pick
 * it up through `getIntelWriter()`.
 *
 * See AD-006 #4 for the sync-vs-async decision rationale and AD-008
 * (T-17) for the production decision.
 */
export function createDefaultIntelWriter(db: Database): IntelWriter {
  return createSyncIntelWriter(db);
}

/** Convenience getter used by the proxy + pipeline call sites. */
export function getIntelWriter(): IntelWriter {
  const db = _writerDb;
  if (db === null) {
    throw new Error(
      '[fast-agent-writer] no catalog DB bound — call setIntelWriterDb(db) before getIntelWriter',
    );
  }
  return createSyncIntelWriter(db);
}
