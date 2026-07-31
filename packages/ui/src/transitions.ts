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
 * Two exports:
 *   - `applyToggle(state, itemId, action, opts, catalog)` — pure function
 *     that produces the next state (or a typed error) without performing I/O.
 *   - `toggleCatalogItem(request, catalog, store)` — orchestrator that
 *     reads current state, calls `applyToggle`, persists via the store.
 *
 * The pure API is the spec-defined contract used in tests. The
 * orchestrator is the HTTP integration seam for Phase 4.4.
 */

export const CRITICAL_CONFIRMATION_TOKEN = 'CONFIRMAR';
export const MAX_ACTIVE_PERSONAS = 3;

export type ToggleAction = 'on' | 'off';

export type TransitionErrorCode =
  | 'UNKNOWN_ITEM'
  | 'UNSUPPORTED_ACTION'
  | 'MALFORMED_FIELD'
  | 'CRITICAL_CONFIRMATION_REQUIRED'
  | 'PERSONA_LIMIT_EXCEEDED';

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

export class TransitionRequestError extends Error {
  readonly code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = 'TransitionRequestError';
    this.code = code;
  }
}
