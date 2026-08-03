/**
 * Runtime state authority (Phase 7b T-01).
 *
 * Server-owned typed adapter for `.memory-studio/state.json`. The
 * configured thresholds and active catalog are authoritative for the
 * `/augment` and `/v1/messages` paths — pre-7b effective defaults
 * (`0.75/1` from `src/search/types.ts`, reached because `pipeline.ts`
 * called `applyThresholds(ranked)` with no options) are now overridden
 * at runtime when state is wired.
 *
 * Why a server-owned adapter (vs editing `src/search/**`):
 *   - Locked layer. The `src/search/**` module is on the
 *     `src/server/`, `src/social-detector/**`, `src/fingerprint/**`,
 *     `packages/sdk/**`, `packages/ui/**`, `CLAUDE.md` no-touch list.
 *   - State is loaded ONCE per request and threaded through
 *     `PipelineContext` so activeCatalog + thresholds stay coherent.
 *   - Tests inject a path/reader; no global cwd mutation required.
 *
 * Validation:
 *   - cosine is a finite number in `[0, 1]`.
 *   - FTS is a non-negative integer within the existing server bounds
 *     (`MIN_FTS_HITS_BOUND..MAX_FTS_HITS_BOUND` from `src/search/types.ts`).
 *   - active catalog IDs are strings (empty array permitted).
 *
 * Reading state once per request is enforced by `loadRuntimeSnapshot`,
 * which returns an immutable snapshot. The same snapshot is consumed by
 * the pipeline (thresholds) AND the proxy (activeCatalog), so a
 * concurrent toggle cannot produce an inconsistent request.
 */
import { readFile } from 'node:fs/promises';
import {
  MIN_FTS_HITS_BOUND,
  MAX_FTS_HITS_BOUND,
} from '../../search/types.ts';

/** Single immutable view of the runtime state for one request. */
export interface RuntimeStateSnapshot {
  readonly activeCatalog: readonly string[];
  readonly thresholds: {
    readonly minCosineSimilarity: number;
    readonly minFtsHits: number;
  };
  /** Schema version recorded in state.json, when present. */
  readonly stateVersion: number | null;
  /** Wall-clock ms when this snapshot was loaded. */
  readonly loadedAt: number;
}

export class RuntimeStateValidationError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message);
    this.name = 'RuntimeStateValidationError';
  }
}

/**
 * Optional reader factory — tests inject a custom reader to avoid
 * touching the real `.memory-studio/state.json` file. Production uses
 * the default which reads from disk.
 */
export type StateReader = () => Promise<string>;

/**
 * The default reader — reads the state file from disk. Path resolution
 * order: explicit option → `MEMORY_STUDIO_STATE_PATH` env var →
 * `<cwd>/.memory-studio/state.json`.
 */
export function defaultStateReader(path: string): StateReader {
  return async () => {
    return readFile(path, 'utf8');
  };
}

/**
 * Resolve the state.json path. Production resolves to
 * `<cwd>/.memory-studio/state.json`; tests inject an explicit path.
 */
export function resolveStatePath(options?: {
  readonly path?: string;
  readonly env?: NodeJS.ProcessEnv;
}): string {
  if (options?.path !== undefined && options.path.length > 0) {
    return options.path;
  }
  const envPath = options?.env?.['MEMORY_STUDIO_STATE_PATH'];
  if (envPath !== undefined && envPath.length > 0) {
    return envPath;
  }
  return `${process.cwd()}/.memory-studio/state.json`;
}

/**
 * Parse and validate a raw state.json string. Pure function — no
 * filesystem access. Exported for tests that want to exercise
 * validation paths without writing files.
 *
 * Throws `RuntimeStateValidationError` when the JSON is missing
 * required fields or carries invalid values.
 */
export function parseRuntimeState(raw: string): RuntimeStateSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new RuntimeStateValidationError(
      `state.json is not valid JSON: ${reason}`,
      'json',
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new RuntimeStateValidationError(
      'state.json root must be an object',
      'root',
    );
  }
  const root = parsed as Record<string, unknown>;

  // --- thresholds -----------------------------------------------------------
  const thresholdsRaw = root['thresholds'];
  if (thresholdsRaw === undefined || thresholdsRaw === null) {
    throw new RuntimeStateValidationError(
      'state.json is missing required field: thresholds',
      'thresholds',
    );
  }
  if (typeof thresholdsRaw !== 'object') {
    throw new RuntimeStateValidationError(
      'state.json thresholds must be an object',
      'thresholds',
    );
  }
  const thresholds = thresholdsRaw as Record<string, unknown>;

  const cosineRaw = thresholds['minCosineSimilarity'];
  if (typeof cosineRaw !== 'number' || !Number.isFinite(cosineRaw)) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minCosineSimilarity must be a finite number, got ${typeof cosineRaw}`,
      'minCosineSimilarity',
    );
  }
  if (cosineRaw < 0 || cosineRaw > 1) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minCosineSimilarity must be in [0, 1], got ${cosineRaw}`,
      'minCosineSimilarity',
    );
  }

  const ftsRaw = thresholds['minFtsHits'];
  if (typeof ftsRaw !== 'number' || !Number.isInteger(ftsRaw)) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minFtsHits must be an integer, got ${typeof ftsRaw}`,
      'minFtsHits',
    );
  }
  if (ftsRaw < MIN_FTS_HITS_BOUND || ftsRaw > MAX_FTS_HITS_BOUND) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minFtsHits must be in [${MIN_FTS_HITS_BOUND}, ${MAX_FTS_HITS_BOUND}], got ${ftsRaw}`,
      'minFtsHits',
    );
  }

  // --- activeCatalog --------------------------------------------------------
  const activeCatalogRaw = root['activeCatalog'];
  let activeCatalog: readonly string[];
  if (activeCatalogRaw === undefined) {
    activeCatalog = [];
  } else if (!Array.isArray(activeCatalogRaw)) {
    throw new RuntimeStateValidationError(
      `state.json activeCatalog must be an array, got ${typeof activeCatalogRaw}`,
      'activeCatalog',
    );
  } else {
    const validated: string[] = [];
    for (let i = 0; i < activeCatalogRaw.length; i += 1) {
      const entry = activeCatalogRaw[i];
      if (typeof entry !== 'string') {
        throw new RuntimeStateValidationError(
          `state.json activeCatalog[${i}] must be a string, got ${typeof entry}`,
          'activeCatalog',
        );
      }
      validated.push(entry);
    }
    activeCatalog = validated;
  }

  // --- schemaVersion (optional) --------------------------------------------
  const stateVersionRaw = root['schemaVersion'];
  let stateVersion: number | null = null;
  if (stateVersionRaw !== undefined) {
    if (typeof stateVersionRaw !== 'number' || !Number.isInteger(stateVersionRaw)) {
      throw new RuntimeStateValidationError(
        `state.json schemaVersion must be an integer, got ${typeof stateVersionRaw}`,
        'schemaVersion',
      );
    }
    stateVersion = stateVersionRaw;
  }

  return {
    activeCatalog,
    thresholds: {
      minCosineSimilarity: cosineRaw,
      minFtsHits: ftsRaw,
    },
    stateVersion,
    loadedAt: Date.now(),
  };
}

/**
 * Load an immutable state snapshot from disk via the supplied reader.
 * One call per request — pipelines and proxies share the same snapshot.
 */
export async function loadRuntimeSnapshot(
  reader: StateReader,
): Promise<RuntimeStateSnapshot> {
  const raw = await reader();
  return parseRuntimeState(raw);
}

/**
 * Convenience: compose a reader from an explicit path and load. Used by
 * boot.ts when production state.json is on disk.
 */
export async function loadRuntimeSnapshotFromPath(
  path: string,
): Promise<RuntimeStateSnapshot> {
  return loadRuntimeSnapshot(defaultStateReader(path));
}
