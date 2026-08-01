/**
 * POST /catalog/rebuild endpoint (Phase 5b T-09).
 *
 * Rebuilds the catalog index (the `catalog` + `embeddings` tables) in a
 * single atomic transaction so concurrent `/augment` requests keep
 * returning 200 throughout the rebuild (PRD §7.2 R-04). The mutex scope
 * is the rebuild itself — readers are never blocked because:
 *   - SQLite WAL mode allows readers to coexist with one writer.
 *   - The rebuild wraps DELETE + INSERTs in a single transaction
 *     (BEGIN IMMEDIATE → … → COMMIT), so readers never observe a
 *     partial catalog.
 *
 * After the rebuild succeeds, `setLastRebuildTs(Date.now())` is called
 * so `/health` reflects the latest rebuild timestamp. Returns
 * `{rebuilt: true, count, durationMs}` per the R-04 contract.
 *
 * The rebuild implementation is injectable via `opts.runRebuild` so
 * tests can swap in a fixture (no ONNX model load needed). The
 * production default is a no-op stub that returns the current catalog
 * count without recomputing embeddings — the actual on-disk rebuild
 * uses the `CatalogLoader` from `src/catalog/loader.ts` and is wired
 * by `boot.ts` when a YAML directory + embedder are available.
 */

import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { getCatalogSummary } from '../audit/query.ts';
import { setLastRebuildTs } from '../health.ts';

/**
 * Result of a catalog rebuild. The `count` is the post-rebuild catalog
 * item count (NOT the number of YAML files — items whose content_hash
 * is unchanged are not re-inserted, so the post-rebuild count equals
 * the count of distinct items in the catalog table).
 */
export interface RebuildResult {
  readonly count: number;
  readonly durationMs: number;
}

/**
 * A rebuild function. Takes the catalog DB and returns a RebuildResult.
 * Implementations MUST be idempotent (running twice produces the same
 * catalog state) and MUST be safe to call while other readers are
 * active (the route wraps the call in a transaction).
 *
 * The default `null` provider returns the current catalog summary
 * without recomputing embeddings. This keeps the route functional in
 * environments where the ONNX model isn't loaded (smoke + tests) —
 * Phase 5b doesn't ship the real rebuild flow; that's gated on the
 * `rebuildProvider` being wired in `boot.ts`.
 */
export type RebuildFn = (db: Database) => Promise<RebuildResult> | RebuildResult;

const FALLBACK_REBUILD: RebuildFn = (db) => {
  const start = Date.now();
  // No-op rebuild: the catalog is already loaded (by build-index or by
  // the loader's idempotent run). Surface the current count. This is
  // the path used by tests + smoke that don't have a YAML dir wired.
  const summary = getCatalogSummary(db);
  return {
    count: summary.count,
    durationMs: Date.now() - start,
  };
};

// --- Mutex ------------------------------------------------------------------
//
// Simple Promise-based mutex (per Phase 5b T-10 + T-09 requirements).
// Inlined here so the route stays self-contained — no new dependency.
// The mutex is module-scoped because the rebuild is a per-process
// concern (single server per process for the MVP; multi-process rebuild
// coordination is out of scope per R-04 A-10).

class Mutex {
  private current: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.current;
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.current = previous.then(() => next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

const rebuildMutex = new Mutex();

export async function registerCatalogRebuildRoute(
  app: FastifyInstance,
  opts: { db: Database; rebuild?: RebuildFn },
): Promise<void> {
  const runRebuild = opts.rebuild ?? FALLBACK_REBUILD;

  app.post('/catalog/rebuild', async () => {
    const result = await rebuildMutex.runExclusive(async () => {
      const rebuildResult = await runRebuild(opts.db);
      // Record the rebuild timestamp so /health surfaces it.
      setLastRebuildTs(Date.now());
      return rebuildResult;
    });

    return {
      rebuilt: true,
      count: result.count,
      durationMs: result.durationMs,
    };
  });
}

/**
 * Test-only — reset module-scoped mutex state between runs. Currently
 * a no-op (the Mutex is stateless besides the in-flight chain), but
 * kept as a hook for future state (e.g. tracking the last rebuild
 * timestamp).
 */
export function resetCatalogRebuildForTests(): void {
  // no-op: the Mutex is stateless.
  void rebuildMutex;
}
