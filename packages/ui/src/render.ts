import type { AuditReader, AuditViewEvent } from './audit.ts';
import type { UiTab } from './index.ts';
import type { ProjectStateStore, ProjectStateV3 } from './state.ts';

export type PartialRenderer = () => Promise<string>;
export type UiPartialRenderers = Record<UiTab, PartialRenderer>;

const TAB_LABELS: Record<UiTab, string> = {
  skills: 'Skills',
  rules: 'Rules',
  personas: 'Personas',
  audit: 'Audit',
  settings: 'Settings',
};

function section(tab: UiTab, body: string): string {
  return `<section data-tab="${tab}" aria-labelledby="${tab}-heading"><h2 id="${tab}-heading">${TAB_LABELS[tab]}</h2>${body}</section>`;
}

export function renderPlaceholderPartial(tab: 'skills' | 'rules' | 'personas'): string {
  return section(tab, `<p>${TAB_LABELS[tab]} catalog controls load in the next subchapter.</p>`);
}

export function renderAuditPartial(events: readonly AuditViewEvent[]): string {
  const body = events.length === 0
    ? '<p>No audit events yet.</p>'
    : `<p>${events.length} audit event${events.length === 1 ? '' : 's'} available.</p>`;
  return section('audit', body);
}

export function renderSettingsPartial(state: ProjectStateV3): string {
  return section('settings', `<p>Project state schema ${state.schemaVersion} is loaded.</p>`);
}

export function renderSafeErrorPartial(tab: UiTab): string {
  return section(tab, `<p role="alert">${TAB_LABELS[tab]} could not be loaded.</p>`);
}

export function createDefaultPartialRenderers(
  stateStore: Pick<ProjectStateStore, 'read'>,
  auditReader: AuditReader,
): UiPartialRenderers {
  return {
    skills: async () => renderPlaceholderPartial('skills'),
    rules: async () => renderPlaceholderPartial('rules'),
    personas: async () => renderPlaceholderPartial('personas'),
    audit: async () => renderAuditPartial(await auditReader.latest(20)),
    settings: async () => renderSettingsPartial(await stateStore.read()),
  };
}
