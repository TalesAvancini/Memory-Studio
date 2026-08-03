/**
 * Production context factory (Phase 7b T-01).
 *
 * Owns the production combination of:
 *   - opened DB handle;
 *   - memoized `MultilingualE5SmallEmbedder` instance (real e5-small ONNX);
 *   - canonical catalog directory (`config/catalog/` or override);
 *   - state snapshot provider (from runtime-state.ts);
 *   - intel read/write hooks.
 *
 * The previous (Phase 7a) production boot path ran with a stub
 * zero-vector embedder + an empty in-memory context whenever a DB path
 * was configured but no embedder override existed. Phase 7b closes that
 * gap: when an on-disk DB is configured, the boot path MUST wire the
 * real embedder and the runtime state. Stub paths remain valid only
 * for tests and synthetic smokes.
 *
 * Boot rules (per spec.md R-3):
 *   - `MEMORY_STUDIO_CATALOG_DB_PATH` absent → explicit dev/stub path
 *     remains available (tests + smokes).
 *   - DB path present → production context is mandatory; failure to
 *     load model/state/catalog is startup failure (NOT silent
 *     zero-vector fallback).
 *   - Tests inject embedder + state factories to avoid loading ONNX.
 *   - DB/model lifetime is process-scoped; request context is shallow
 *     and cheap.
 */
import type { Database } from 'better-sqlite3';
import type { Embedder } from '../../catalog/embedder/types.ts';
import type { PipelineContext } from '../augment/pipeline.ts';
import { getIntel, writeIntelRow } from '../../catalog/intel-store.ts';
import {
  loadRuntimeSnapshotFromPath,
  type RuntimeStateSnapshot,
} from './runtime-state.ts';

/** Canonical catalog directory default. */
export const DEFAULT_CATALOG_DIR = 'config/catalog';

/** Options for `createProductionContext`. */
export interface CreateProductionContextOptions {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly catalogDir?: string;
  readonly statePath?: string;
}

/**
 * In-memory cache of the latest state snapshot, refreshed only when
 * the loaded timestamp changes. Production requests share this cache
 * so a single filesystem read per state-mutation boundary is enough.
 *
 * Tests inject their own snapshots via `createProductionContext` to
 * keep this default a no-op for them.
 */
export class StateSnapshotCache {
  private current: RuntimeStateSnapshot | null = null;
  private loader: () => Promise<RuntimeStateSnapshot>;

  constructor(loader: () => Promise<RuntimeStateSnapshot>) {
    this.loader = loader;
  }

  /** Replace the loader (used when state.json path changes at runtime). */
  setLoader(loader: () => Promise<RuntimeStateSnapshot>): void {
    this.loader = loader;
    this.current = null;
  }

  /** Return the cached snapshot, reloading only when invalidated. */
  async get(): Promise<RuntimeStateSnapshot> {
    if (this.current === null) {
      this.current = await this.loader();
    }
    return this.current;
  }

  /**
   * Force the next call to `get()` to reload from disk. Used by the
   * boot path after a state.json write, so subsequent requests see
   * the new values.
   */
  invalidate(): void {
    this.current = null;
  }
}

/**
 * Production-context bundle: the closed bundle the boot path needs.
 *
 * - `pipelineContext()` returns a `PipelineContext` carrying the
 *   real embedder + DB + intel hooks. The pipeline receives the
 *   state snapshot through the optional `getStateSnapshot` hook.
 * - `getStateSnapshot()` reads the cached snapshot for one request.
 *
 * The cache is held by the production context so two simultaneous
 * requests cannot split thresholds from catalog.
 */
export interface ProductionContext {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly catalogDir: string;
  readonly statePath: string;
  readonly stateCache: StateSnapshotCache;
  pipelineContext(opts?: {
    readonly thresholds?: RuntimeStateSnapshot['thresholds'];
    readonly sessionId?: string;
    readonly callFastAgent?: PipelineContext['callFastAgent'];
    readonly getIntelOverride?: PipelineContext['getIntel'];
    readonly writeIntelOverride?: PipelineContext['writeIntel'];
  }): PipelineContext;
  getStateSnapshot(): Promise<RuntimeStateSnapshot>;
}

/**
 * Build a production context. The caller owns the `db` lifetime; the
 * embedder is held by reference (real or stub). State is loaded
 * lazily through the cache.
 */
export function createProductionContext(
  options: CreateProductionContextOptions,
): ProductionContext {
  const catalogDir = options.catalogDir ?? DEFAULT_CATALOG_DIR;
  const statePath =
    options.statePath ?? `${process.cwd()}/.memory-studio/state.json`;

  const stateCache = new StateSnapshotCache(() =>
    loadRuntimeSnapshotFromPath(statePath),
  );

  const pipelineContext: ProductionContext['pipelineContext'] = (opts) => {
    const ctx: PipelineContext = {
      db: options.db,
      embedder: options.embedder,
      catalogDir,
    };
    if (opts?.sessionId !== undefined) {
      return {
        ...ctx,
        sessionId: opts.sessionId,
        getIntel: opts.getIntelOverride ?? defaultGetIntel(options.db),
        writeIntel: opts.writeIntelOverride ?? defaultWriteIntel(options.db),
        ...(opts.callFastAgent !== undefined ? { callFastAgent: opts.callFastAgent } : {}),
      };
    }
    return ctx;
  };

  return {
    db: options.db,
    embedder: options.embedder,
    catalogDir,
    statePath,
    stateCache,
    pipelineContext,
    getStateSnapshot: () => stateCache.get(),
  };
}

/** Default `getIntel` hook bound to the production DB. */
function defaultGetIntel(db: Database) {
  return (sessionId: string) => {
    try {
      return getIntel(db, sessionId);
    } catch {
      return null;
    }
  };
}

/** Default `writeIntel` hook bound to the production DB. */
function defaultWriteIntel(db: Database) {
  return async (sessionId: string, intel: import('../fast-agent/intel-schema.ts').Intel) => {
    const ts = Math.floor(Date.now() / 1000);
    writeIntelRow(db, sessionId, intel, ts);
  };
}

/**
 * Resolve whether the production context is required. Production
 * boot must fail loud when the DB is configured but the embedder or
 * state cannot be loaded — never silently fall back to the stub.
 */
export class ProductionContextLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductionContextLoadError';
  }
}
