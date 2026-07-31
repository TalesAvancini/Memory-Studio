import type { CatalogReader, UiCatalogItem } from './catalog.ts';
import type { ProjectStateStore, ProjectStateV3 } from './state.ts';

/**
 * Phase 4.2 toggle transition service.
 *
 * Enforces the server-side invariants for catalog toggles independent of
 * HTTP transport:
 *   - exact `CONFIRMAR` token for critical Rule off (`UI-10`/`UI-11`)
 *   - persona cap of 3 (`UI-16`)
 *   - unknown item / malformed field / unsupported action rejected (`UI-14`)
 *   - idempotent no-op when already in requested state (`UI-09`)
 *
 * Phase 4.3 extends the service with settings persistence:
 *   - threshold bounds (`UI-23`): `minCosineSimilarity` ∈ [0, 1] and
 *     `minFtsHits` integer ≥ 0
 *   - integrationMode enum (`UI-23`): `proxy` | `hook` | `mcp` | `cli`
 *   - required non-empty strings (`UI-23`): tenantId, embeddingModel
 *   - unrelated schema-v3 fields preserved (`UI-22`)
 *
 * Two exports per flow:
 *   - `applyToggle(state, itemId, action, opts, catalog)` and
 *     `applySettings(state, patch)` — pure functions that produce the
 *     next state (or a typed error) without performing I/O.
 *   - `toggleCatalogItem(request, catalog, store)` and
 *     `applySettingsPatch(request, store)` — orchestrators that read
 *     current state, call the pure function, and persist via the store.
 *
 * The pure APIs are the spec-defined contracts used in tests. The
 * orchestrators are the HTTP integration seams for Phase 4.4.
 */

export const CRITICAL_CONFIRMATION_TOKEN = 'CONFIRMAR';
export const MAX_ACTIVE_PERSONAS = 3;

export const SUPPORTED_INTEGRATION_MODES = ['proxy', 'hook', 'mcp', 'cli'] as const;
export type SupportedIntegrationMode = (typeof SUPPORTED_INTEGRATION_MODES)[number];

export const SETTINGS_FIELD_KEYS = [
  'minCosineSimilarity',
  'minFtsHits',
  'tenantId',
  'integrationMode',
  'embeddingModel',
] as const;
export type SettingsFieldKey = (typeof SETTINGS_FIELD_KEYS)[number];

export type ToggleAction = 'on' | 'off';

export type TransitionErrorCode =
  | 'UNKNOWN_ITEM'
  | 'UNSUPPORTED_ACTION'
  | 'MALFORMED_FIELD'
  | 'CRITICAL_CONFIRMATION_REQUIRED'
  | 'PERSONA_LIMIT_EXCEEDED'
  | 'INVALID_THRESHOLD'
  | 'UNSUPPORTED_INTEGRATION_MODE'
  | 'MISSING_STRING_FIELD';

export interface ToggleOptions {
  critical_confirm?: unknown;
}

export type ApplyToggleResult =
  | { ok: true; state: ProjectStateV3; changed: boolean; active: boolean }
  | { ok: false; code: TransitionErrorCode; message: string };

export interface ToggleRequest {
  itemId: string;
  action: ToggleAction;
  critical_confirm?: unknown;
}

/**
 * Phase 4.3 settings patch — five fields the user can edit through the
 * Settings tab. The `applySettings` pure function accepts a partial
 * input and rejects with typed errors when any field is malformed.
 *
 * The discriminated `integrationMode` is kept in lock-step with
 * `ProjectStateV3['integrationMode']`; SUPPORTED_INTEGRATION_MODES
 * above is the runtime source of truth used by validation.
 */
export interface SettingsPatch {
  minCosineSimilarity: number;
  minFtsHits: number;
  tenantId: string;
  integrationMode: SupportedIntegrationMode;
  embeddingModel: string;
}

export interface SettingsRequest extends Partial<SettingsPatch> {}

export type ApplySettingsResult =
  | { ok: true; state: ProjectStateV3; changed: boolean }
  | { ok: false; code: TransitionErrorCode; message: string };

function isToggleAction(action: unknown): action is ToggleAction {
  return action === 'on' || action === 'off';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCriticalRule(item: UiCatalogItem): boolean {
  return item.type === 'rule' && item.critical === true;
}

function isPersona(item: UiCatalogItem): boolean {
  return item.type === 'persona';
}

function countActivePersonas(
  state: ProjectStateV3,
  personas: readonly UiCatalogItem[],
): number {
  const personaIds = new Set(personas.map((p) => p.id));
  let count = 0;
  for (const id of state.activeCatalog) {
    if (personaIds.has(id)) count += 1;
  }
  return count;
}

/**
 * Pure toggle transition. Does not perform I/O — the caller supplies the
 * current state and the catalog reader.
 *
 * Contract:
 *   - `state` is never mutated. The returned `state` on `ok: true` is the
 *     proposed next state; persistence is the caller's responsibility.
 *   - On `ok: false`, the original `state` is unchanged in memory.
 *   - Critical Rule off without exact `CONFIRMAR` is rejected with
 *     `CRITICAL_CONFIRMATION_REQUIRED`.
 *   - Activating a 4th persona is rejected with `PERSONA_LIMIT_EXCEEDED`.
 *   - Re-asserting the current active state returns `ok: true, changed: false`.
 */
export async function applyToggle(
  state: ProjectStateV3,
  itemId: unknown,
  action: unknown,
  options: ToggleOptions = {},
  catalog: Pick<CatalogReader, 'get' | 'list'>,
): Promise<ApplyToggleResult> {
  if (!isNonEmptyString(itemId)) {
    return { ok: false, code: 'MALFORMED_FIELD', message: 'itemId must be a non-empty string' };
  }
  if (!isToggleAction(action)) {
    return { ok: false, code: 'UNSUPPORTED_ACTION', message: 'action must be "on" or "off"' };
  }

  const item = await catalog.get(itemId);
  if (!item) {
    return { ok: false, code: 'UNKNOWN_ITEM', message: `Unknown catalog item: ${itemId}` };
  }

  if (action === 'off' && isCriticalRule(item)) {
    const confirm = options.critical_confirm;
    if (typeof confirm !== 'string' || confirm !== CRITICAL_CONFIRMATION_TOKEN) {
      return {
        ok: false,
        code: 'CRITICAL_CONFIRMATION_REQUIRED',
        message: `Critical rule requires exact ${CRITICAL_CONFIRMATION_TOKEN} confirmation`,
      };
    }
  }

  const activeIds = new Set(state.activeCatalog);
  const wasActive = activeIds.has(itemId);
  const targetActive = action === 'on';

  if (wasActive === targetActive) {
    return { ok: true, state, changed: false, active: targetActive };
  }

  if (targetActive && isPersona(item)) {
    const allItems = await catalog.list();
    const current = countActivePersonas(state, allItems);
    if (current >= MAX_ACTIVE_PERSONAS) {
      return {
        ok: false,
        code: 'PERSONA_LIMIT_EXCEEDED',
        message: `Persona cap is ${MAX_ACTIVE_PERSONAS}; disable one before activating another`,
      };
    }
  }

  if (targetActive) {
    activeIds.add(itemId);
  } else {
    activeIds.delete(itemId);
  }
  const nextState: ProjectStateV3 = {
    ...state,
    activeCatalog: [...activeIds],
  };

  return { ok: true, state: nextState, changed: true, active: targetActive };
}

export interface ToggleCatalogItemResult {
  itemId: string;
  active: boolean;
  state: ProjectStateV3;
}

export async function toggleCatalogItem(
  request: ToggleRequest,
  catalog: Pick<CatalogReader, 'get' | 'list'>,
  store: Pick<ProjectStateStore, 'read' | 'update'>,
): Promise<ToggleCatalogItemResult> {
  const current = await store.read();
  const result = await applyToggle(
    current,
    request.itemId,
    request.action,
    { critical_confirm: request.critical_confirm },
    catalog,
  );
  if (!result.ok) {
    throw new TransitionRequestError(result.code, result.message);
  }
  if (!result.changed) {
    return { itemId: request.itemId, active: result.active, state: current };
  }
  const persisted = await store.update(() => result.state);
  return { itemId: request.itemId, active: result.active, state: persisted };
}

function isSupportedIntegrationMode(value: unknown): value is SupportedIntegrationMode {
  return typeof value === 'string'
    && (SUPPORTED_INTEGRATION_MODES as readonly string[]).includes(value);
}

function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= min
    && value <= max;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Phase 4.3 — `UI-22`/`UI-23`. Pure settings transition. Validates the
 * five editable fields and produces the next state without I/O.
 *
 * Rules (`UI-23`):
 *   - `minCosineSimilarity`: finite number in [0, 1]
 *   - `minFtsHits`: integer ≥ 0
 *   - `tenantId`: non-empty string
 *   - `integrationMode`: one of `proxy` | `hook` | `mcp` | `cli`
 *   - `embeddingModel`: non-empty string
 *
 * Preservation (`UI-22`): unrelated schema-v3 fields (activeCatalog,
 * fastAgent, agentId, ui, schemaVersion, plus any future keys) flow
 * through the spread unchanged. The settings patch only writes the
 * five fields it owns.
 *
 * Idempotency: when every field matches the current state, the result
 * has `changed: false` and returns the input state — no write required.
 */
export function applySettings(
  state: ProjectStateV3,
  patch: SettingsRequest,
): ApplySettingsResult {
  if (!Number.isFinite(patch.minCosineSimilarity)) {
    return {
      ok: false,
      code: 'INVALID_THRESHOLD',
      message: 'minCosineSimilarity must be a finite number',
    };
  }
  if (!isFiniteNumberInRange(patch.minCosineSimilarity, 0, 1)) {
    return {
      ok: false,
      code: 'INVALID_THRESHOLD',
      message: 'minCosineSimilarity must be between 0 and 1 (inclusive)',
    };
  }
  if (!isNonNegativeInteger(patch.minFtsHits)) {
    return {
      ok: false,
      code: 'INVALID_THRESHOLD',
      message: 'minFtsHits must be a non-negative integer',
    };
  }
  if (!isSupportedIntegrationMode(patch.integrationMode)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_INTEGRATION_MODE',
      message: `integrationMode must be one of: ${SUPPORTED_INTEGRATION_MODES.join(', ')}`,
    };
  }
  if (!isNonEmptyString(patch.tenantId)) {
    return {
      ok: false,
      code: 'MISSING_STRING_FIELD',
      message: 'tenantId must be a non-empty string',
    };
  }
  if (!isNonEmptyString(patch.embeddingModel)) {
    return {
      ok: false,
      code: 'MISSING_STRING_FIELD',
      message: 'embeddingModel must be a non-empty string',
    };
  }

  const changed = state.thresholds.minCosineSimilarity !== patch.minCosineSimilarity
    || state.thresholds.minFtsHits !== patch.minFtsHits
    || state.tenantId !== patch.tenantId
    || state.integrationMode !== patch.integrationMode
    || state.embeddingModel !== patch.embeddingModel;

  if (!changed) {
    return { ok: true, state, changed: false };
  }

  const thresholds = {
    ...state.thresholds,
    minCosineSimilarity: patch.minCosineSimilarity,
    minFtsHits: patch.minFtsHits,
  };
  const nextState: ProjectStateV3 = {
    ...state,
    thresholds,
    tenantId: patch.tenantId,
    integrationMode: patch.integrationMode,
    embeddingModel: patch.embeddingModel,
  };

  return { ok: true, state: nextState, changed: true };
}

export interface SettingsUpdateResult {
  state: ProjectStateV3;
  changed: boolean;
}

/**
 * Phase 4.3 — orchestrator. Reads the current state, calls
 * `applySettings`, and persists through the store's serialized
 * mutation queue. Throws `TransitionRequestError` on validation
 * failure; the store is not touched in that case so the prior bytes
 * remain identical (`UI-23`).
 */
export async function applySettingsPatch(
  request: SettingsRequest,
  store: Pick<ProjectStateStore, 'read' | 'update'>,
): Promise<SettingsUpdateResult> {
  const current = await store.read();
  const result = applySettings(current, request);
  if (!result.ok) {
    throw new TransitionRequestError(result.code, result.message);
  }
  if (!result.changed) {
    return { state: current, changed: false };
  }
  const persisted = await store.update(() => result.state);
  return { state: persisted, changed: true };
}

export class TransitionRequestError extends Error {
  readonly code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = 'TransitionRequestError';
    this.code = code;
  }
}
