/**
 * Production request context (Phase 7b T-01).
 *
 * This module binds the on-disk catalog DB, real/injected embedder, canonical
 * catalog directory, runtime-state reader, and Intel store hooks. State is
 * loaded exactly once by `requestContext()` and the resulting snapshot is
 * shared by active-catalog selection and threshold evaluation for that request.
 */
import { resolve } from 'node:path';
import type { Database } from 'better-sqlite3';
import type { Embedder } from '../../catalog/embedder/types.ts';
import { getIntel, writeIntelRow } from '../../catalog/intel-store.ts';
import type { PipelineContext } from '../augment/pipeline.ts';
import type { Intel } from '../fast-agent/intel-schema.ts';
import {
  defaultStateReader,
  loadRuntimeSnapshot,
  resolveStatePath,
  type RuntimeStateSnapshot,
  type StateReader,
} from './runtime-state.ts';

export const DEFAULT_CATALOG_DIR = 'config/catalog';

export interface CreateProductionContextOptions {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly catalogDir?: string;
  readonly statePath?: string;
  readonly stateReader?: StateReader;
  readonly now?: () => number;
}

export interface ProductionRequestOptions {
  readonly sessionId?: string;
  readonly callFastAgent?: PipelineContext['callFastAgent'];
  readonly getIntel?: PipelineContext['getIntel'];
  readonly writeIntel?: PipelineContext['writeIntel'];
}

export interface ProductionRequestContext {
  readonly state: RuntimeStateSnapshot;
  readonly pipeline: PipelineContext;
}

export interface ProductionContext {
  readonly db: Database;
  readonly embedder: Embedder;
  readonly catalogDir: string;
  readonly statePath: string;
  /** Load a fresh immutable snapshot. Call at most once per request. */
  getStateSnapshot(): Promise<RuntimeStateSnapshot>;
  /** Build a pipeline context from an already-loaded snapshot. */
  pipelineContext(
    state: RuntimeStateSnapshot,
    options?: ProductionRequestOptions,
  ): PipelineContext;
  /** Atomic request seam: one state read plus one context derived from it. */
  requestContext(options?: ProductionRequestOptions): Promise<ProductionRequestContext>;
}

export function createProductionContext(
  options: CreateProductionContextOptions,
): ProductionContext {
  const catalogDir = resolve(options.catalogDir ?? DEFAULT_CATALOG_DIR);
  const statePath = resolveStatePath({ path: options.statePath });
  const stateReader = options.stateReader ?? defaultStateReader(statePath);
  const now = options.now ?? Date.now;

  const getStateSnapshot = async (): Promise<RuntimeStateSnapshot> => {
    return loadRuntimeSnapshot(stateReader, now());
  };

  const pipelineContext = (
    state: RuntimeStateSnapshot,
    requestOptions: ProductionRequestOptions = {},
  ): PipelineContext => {
    const context: PipelineContext = {
      db: options.db,
      embedder: options.embedder,
      catalogDir,
      thresholds: state.thresholds,
    };

    if (requestOptions.sessionId === undefined) return context;

    return {
      ...context,
      sessionId: requestOptions.sessionId,
      getIntel: requestOptions.getIntel ?? defaultGetIntel(options.db),
      writeIntel: requestOptions.writeIntel ?? defaultWriteIntel(options.db),
      ...(requestOptions.callFastAgent !== undefined
        ? { callFastAgent: requestOptions.callFastAgent }
        : {}),
    };
  };

  const productionContext: ProductionContext = {
    db: options.db,
    embedder: options.embedder,
    catalogDir,
    statePath,
    getStateSnapshot,
    pipelineContext,
    async requestContext(requestOptions = {}) {
      const state = await getStateSnapshot();
      return {
        state,
        pipeline: pipelineContext(state, requestOptions),
      };
    },
  };

  return productionContext;
}

function defaultGetIntel(db: Database): NonNullable<PipelineContext['getIntel']> {
  return (sessionId: string): Intel | null => {
    try {
      return getIntel(db, sessionId);
    } catch {
      return null;
    }
  };
}

function defaultWriteIntel(db: Database): NonNullable<PipelineContext['writeIntel']> {
  return async (sessionId: string, intel: Intel): Promise<void> => {
    writeIntelRow(db, sessionId, intel, Math.floor(Date.now() / 1000));
  };
}

export class ProductionContextLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProductionContextLoadError';
  }
}
