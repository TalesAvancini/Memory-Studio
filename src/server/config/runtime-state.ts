/**
 * Runtime state authority (Phase 7b T-01).
 *
 * `.memory-studio/state.json` is the production authority for both the active
 * catalog and retrieval thresholds. Callers load one snapshot and pass that
 * same immutable value through a whole request so catalog selection cannot
 * drift from the thresholds used to evaluate it.
 *
 * Configured initial values are 0.60/2. Before Phase 7b the pipeline omitted
 * threshold options and therefore used the search defaults 0.75/1.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  MIN_FTS_HITS_BOUND,
  MAX_FTS_HITS_BOUND,
} from '../../search/types.ts';

export interface RuntimeThresholds {
  readonly minCosineSimilarity: number;
  readonly minFtsHits: number;
}

/** Single immutable view of state for one request. */
export interface RuntimeStateSnapshot {
  readonly activeCatalog: readonly string[];
  readonly thresholds: RuntimeThresholds;
  readonly stateVersion: number | null;
  readonly loadedAt: number;
}

export class RuntimeStateValidationError extends Error {
  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'RuntimeStateValidationError';
    this.field = field;
  }
}

/** Reader seam used by tests and synthetic smokes. */
export type StateReader = () => Promise<string>;

export function defaultStateReader(path: string): StateReader {
  return async () => readFile(path, 'utf8');
}

/** explicit option -> env override -> project-local default. */
export function resolveStatePath(options: {
  readonly path?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly cwd?: string;
} = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.path?.trim();
  if (explicit) return resolve(cwd, explicit);

  const envPath = options.env?.['MEMORY_STUDIO_STATE_PATH']?.trim();
  if (envPath) return resolve(cwd, envPath);

  return resolve(cwd, '.memory-studio', 'state.json');
}

/** Pure parser/validator; production startup treats every error as fatal. */
export function parseRuntimeState(
  raw: string,
  loadedAt: number = Date.now(),
): RuntimeStateSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RuntimeStateValidationError(
      `state.json is not valid JSON: ${reason}`,
      'json',
    );
  }

  const root = requireRecord(parsed, 'root', 'state.json root must be an object');
  const thresholdRecord = requireRecord(
    root['thresholds'],
    'thresholds',
    'state.json is missing required object: thresholds',
  );

  const minCosineSimilarity = thresholdRecord['minCosineSimilarity'];
  if (
    typeof minCosineSimilarity !== 'number' ||
    !Number.isFinite(minCosineSimilarity) ||
    minCosineSimilarity < 0 ||
    minCosineSimilarity > 1
  ) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minCosineSimilarity must be a finite number in [0, 1], got ${String(minCosineSimilarity)}`,
      'minCosineSimilarity',
    );
  }

  const minFtsHits = thresholdRecord['minFtsHits'];
  if (
    typeof minFtsHits !== 'number' ||
    !Number.isInteger(minFtsHits) ||
    minFtsHits < MIN_FTS_HITS_BOUND ||
    minFtsHits > MAX_FTS_HITS_BOUND
  ) {
    throw new RuntimeStateValidationError(
      `state.json thresholds.minFtsHits must be an integer in [${MIN_FTS_HITS_BOUND}, ${MAX_FTS_HITS_BOUND}], got ${String(minFtsHits)}`,
      'minFtsHits',
    );
  }

  const activeCatalogRaw = root['activeCatalog'];
  if (!Array.isArray(activeCatalogRaw)) {
    throw new RuntimeStateValidationError(
      'state.json activeCatalog must be an array of strings',
      'activeCatalog',
    );
  }

  const activeCatalog: string[] = [];
  for (let index = 0; index < activeCatalogRaw.length; index += 1) {
    const entry = activeCatalogRaw[index];
    if (typeof entry !== 'string') {
      throw new RuntimeStateValidationError(
        `state.json activeCatalog[${index}] must be a string, got ${typeof entry}`,
        'activeCatalog',
      );
    }
    activeCatalog.push(entry);
  }

  const stateVersionRaw = root['stateVersion'];
  let stateVersion: number | null = null;
  if (stateVersionRaw !== undefined) {
    if (
      typeof stateVersionRaw !== 'number' ||
      !Number.isInteger(stateVersionRaw) ||
      stateVersionRaw < 0
    ) {
      throw new RuntimeStateValidationError(
        `state.json stateVersion must be a non-negative integer, got ${String(stateVersionRaw)}`,
        'stateVersion',
      );
    }
    stateVersion = stateVersionRaw;
  }

  const thresholds = Object.freeze({ minCosineSimilarity, minFtsHits });
  return Object.freeze({
    activeCatalog: Object.freeze([...activeCatalog]),
    thresholds,
    stateVersion,
    loadedAt,
  });
}

export async function loadRuntimeSnapshot(
  reader: StateReader,
  loadedAt: number = Date.now(),
): Promise<RuntimeStateSnapshot> {
  return parseRuntimeState(await reader(), loadedAt);
}

export async function loadRuntimeSnapshotFromPath(
  path: string,
  loadedAt: number = Date.now(),
): Promise<RuntimeStateSnapshot> {
  return loadRuntimeSnapshot(defaultStateReader(path), loadedAt);
}

function requireRecord(
  value: unknown,
  field: string,
  message: string,
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeStateValidationError(message, field);
  }
  return value as Record<string, unknown>;
}
