import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export interface ProjectStateV3 {
  schemaVersion: 3;
  activeCatalog: string[];
  thresholds: {
    minCosineSimilarity: number;
    minFtsHits: number;
    [key: string]: unknown;
  };
  fastAgent: {
    model: string;
    baseURL: string;
    [key: string]: unknown;
  };
  integrationMode: 'proxy' | 'hook' | 'mcp';
  agentId: string;
  tenantId?: string;
  embeddingModel?: string;
  ui: {
    portRange: [number, number];
    stack: 'htmx+alpine';
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ProjectStateConflictCode =
  | 'MALFORMED_STATE'
  | 'UNSUPPORTED_SCHEMA'
  | 'INVALID_STATE';

export class ProjectStateConflictError extends Error {
  readonly code: ProjectStateConflictCode;
  readonly cause?: unknown;

  constructor(code: ProjectStateConflictCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ProjectStateConflictError';
    this.code = code;
    this.cause = cause;
  }
}

export class ProjectStatePersistenceError extends Error {
  readonly code = 'STATE_WRITE_FAILED';
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ProjectStatePersistenceError';
    this.cause = cause;
  }
}

export interface StateFileHandle {
  writeFile(data: string, encoding: 'utf8'): Promise<unknown>;
  sync(): Promise<unknown>;
  close(): Promise<unknown>;
}

export interface StateFileOperations {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  open(path: string, flags: 'wx'): Promise<StateFileHandle>;
  rename(source: string, target: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const NODE_STATE_FILE_OPERATIONS: StateFileOperations = {
  readFile: (path, encoding) => readFile(path, encoding),
  mkdir: (path, options) => mkdir(path, options),
  open: (path, flags) => open(path, flags),
  rename,
  rm,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function invalid(message: string): never {
  throw new ProjectStateConflictError('INVALID_STATE', message);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function validateProjectState(value: unknown): asserts value is ProjectStateV3 {
  if (!isRecord(value)) invalid('Project state must be a JSON object');
  if (value.schemaVersion !== 3) {
    if (typeof value.schemaVersion === 'number') {
      throw new ProjectStateConflictError(
        'UNSUPPORTED_SCHEMA',
        `Unsupported project state schema version: ${value.schemaVersion}`,
      );
    }
    invalid('Project state schemaVersion must be 3');
  }

  if (!Array.isArray(value.activeCatalog) || !value.activeCatalog.every(isNonEmptyString)) {
    invalid('activeCatalog must be an array of non-empty strings');
  }

  if (!isRecord(value.thresholds)
    || typeof value.thresholds.minCosineSimilarity !== 'number'
    || !Number.isFinite(value.thresholds.minCosineSimilarity)
    || value.thresholds.minCosineSimilarity < 0
    || value.thresholds.minCosineSimilarity > 1
    || typeof value.thresholds.minFtsHits !== 'number'
    || !Number.isInteger(value.thresholds.minFtsHits)
    || value.thresholds.minFtsHits < 0) {
    invalid('thresholds must contain valid minCosineSimilarity and minFtsHits values');
  }

  if (!isRecord(value.fastAgent)
    || !isNonEmptyString(value.fastAgent.model)
    || !isNonEmptyString(value.fastAgent.baseURL)) {
    invalid('fastAgent must contain non-empty model and baseURL strings');
  }

  if (value.integrationMode !== 'proxy'
    && value.integrationMode !== 'hook'
    && value.integrationMode !== 'mcp') {
    invalid('integrationMode must be proxy, hook, or mcp');
  }
  if (!isNonEmptyString(value.agentId)) invalid('agentId must be a non-empty string');
  if (value.tenantId !== undefined && typeof value.tenantId !== 'string') {
    invalid('tenantId must be a string when present');
  }
  if (value.embeddingModel !== undefined && !isNonEmptyString(value.embeddingModel)) {
    invalid('embeddingModel must be a non-empty string when present');
  }

  if (!isRecord(value.ui)
    || !Array.isArray(value.ui.portRange)
    || value.ui.portRange.length !== 2
    || !value.ui.portRange.every(Number.isInteger)
    || typeof value.ui.portRange[0] !== 'number'
    || typeof value.ui.portRange[1] !== 'number'
    || value.ui.portRange[0] < 1
    || value.ui.portRange[1] > 65_535
    || value.ui.portRange[0] > value.ui.portRange[1]
    || value.ui.stack !== 'htmx+alpine') {
    invalid('ui must contain a valid portRange and htmx+alpine stack');
  }
}

export function createDefaultProjectState(): ProjectStateV3 {
  return {
    schemaVersion: 3,
    activeCatalog: [],
    thresholds: {
      minCosineSimilarity: 0.6,
      minFtsHits: 2,
    },
    fastAgent: {
      model: 'MiniMax-M2.7-highspeed',
      baseURL: 'https://api.minimax.io/anthropic',
    },
    integrationMode: 'proxy',
    agentId: 'claude-code',
    tenantId: '',
    embeddingModel: 'multilingual-e5-small',
    ui: {
      portRange: [41_823, 42_823],
      stack: 'htmx+alpine',
    },
  };
}

function normalizeProjectState(state: ProjectStateV3): ProjectStateV3 {
  validateProjectState(state);
  const normalized: ProjectStateV3 = {
    ...state,
    activeCatalog: [...new Set(state.activeCatalog)],
    thresholds: { ...state.thresholds },
    fastAgent: { ...state.fastAgent },
    ui: {
      ...state.ui,
      portRange: [...state.ui.portRange],
    },
  };
  validateProjectState(normalized);
  return normalized;
}

function operationsWith(
  overrides: Partial<StateFileOperations> = {},
): StateFileOperations {
  return { ...NODE_STATE_FILE_OPERATIONS, ...overrides };
}

export async function readProjectState(
  path: string,
  operationOverrides: Partial<StateFileOperations> = {},
): Promise<ProjectStateV3> {
  const operations = operationsWith(operationOverrides);
  let bytes: string;
  try {
    bytes = await operations.readFile(path, 'utf8');
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return createDefaultProjectState();
    throw new ProjectStatePersistenceError('Could not read project state', error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch (error) {
    throw new ProjectStateConflictError('MALFORMED_STATE', 'Project state contains malformed JSON', error);
  }
  validateProjectState(parsed);
  return parsed;
}

export async function writeProjectState(
  path: string,
  state: ProjectStateV3,
  operationOverrides: Partial<StateFileOperations> = {},
): Promise<boolean> {
  const operations = operationsWith(operationOverrides);
  const normalized = normalizeProjectState(state);
  await operations.mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle: StateFileHandle | undefined;

  try {
    handle = await operations.open(temporaryPath, 'wx');
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await operations.rename(temporaryPath, path);
    return true;
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Cleanup continues through the sibling temp removal.
      }
    }
    try {
      await operations.rm(temporaryPath, { force: true });
    } catch {
      // The persistence error remains the actionable failure.
    }
    throw new ProjectStatePersistenceError('Could not atomically write project state', error);
  }
}

export interface ProjectStateStore {
  readonly path: string;
  read(): Promise<ProjectStateV3>;
  update(mutator: (current: ProjectStateV3) => ProjectStateV3): Promise<ProjectStateV3>;
}

export function createProjectStateStore(
  projectRoot: string,
  operationOverrides: Partial<StateFileOperations> = {},
): ProjectStateStore {
  const path = join(projectRoot, '.memory-studio', 'state.json');
  let mutationQueue: Promise<void> = Promise.resolve();

  return {
    path,
    read: () => readProjectState(path, operationOverrides),
    update(mutator) {
      const mutation = mutationQueue.then(async () => {
        const current = await readProjectState(path, operationOverrides);
        const next = normalizeProjectState(mutator(structuredClone(current)));
        await writeProjectState(path, next, operationOverrides);
        return next;
      });
      mutationQueue = mutation.then(() => undefined, () => undefined);
      return mutation;
    },
  };
}
