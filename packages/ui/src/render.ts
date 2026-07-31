import type { AuditReader, AuditViewEvent } from './audit.ts';
import type { CatalogReader, UiCatalogItem } from './catalog.ts';
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

const CATALOG_TAB_LABELS: Record<'skill' | 'rule' | 'persona', string> = {
  skill: 'Skills',
  rule: 'Rules',
  persona: 'Personas',
};

function section(tab: UiTab, body: string): string {
  return `<section data-tab="${tab}" aria-labelledby="${tab}-heading"><h2 id="${tab}-heading">${TAB_LABELS[tab]}</h2>${body}</section>`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

export function escapeAttr(input: string): string {
  return escapeHtml(input);
}

/**
 * Encode a value for inclusion inside a `<script type="application/json">`
 * block. We escape `<`, `>`, and `&` to their Unicode form so the script
 * payload can never terminate the script tag prematurely or be mistaken
 * for HTML.
 */
export function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

export function renderPlaceholderPartial(tab: 'skills' | 'rules' | 'personas'): string {
  return section(tab, `<p>${TAB_LABELS[tab]} catalog controls load in the next subchapter.</p>`);
}

export interface CatalogViewModel {
  items: readonly UiCatalogItem[];
  activeIds: ReadonlySet<string>;
}

export const CRITICAL_RULE_EXAMPLE_COPY =
  "Rule critical:true — exemplo: toggle off + digitar 'CONFIRMAR' no painel → aceito; sem confirmação → bloqueado";

export const PERSONA_CAP_MESSAGE =
  'Persona cap reached (3 active). Disable one persona to activate another.';

function filterByType(
  items: readonly UiCatalogItem[],
  type: 'skill' | 'rule' | 'persona',
): readonly UiCatalogItem[] {
  return items.filter((item) => item.type === type);
}

function describeCatalogMeta(item: UiCatalogItem): string {
  switch (item.type) {
    case 'skill':
      return item.category;
    case 'rule':
      return item.critical ? 'critical rule' : 'rule';
    case 'persona':
      return item.isDefault ? 'default persona' : 'persona';
  }
}

function catalogDisplayTitle(item: UiCatalogItem): string {
  return item.type === 'skill' ? item.title : item.id;
}

export function renderCatalogPartial(
  type: 'skill' | 'rule' | 'persona',
  model: CatalogViewModel,
): string {
  const tabLabel = CATALOG_TAB_LABELS[type];
  const items = filterByType(model.items, type);
  const activeIds = [...model.activeIds];
  const config = {
    type,
    items,
    activeIds,
    displayMeta: describeCatalogMeta,
    displayTitle: catalogDisplayTitle,
  };
  const configJson = escapeScriptJson(config);
  const searchPlaceholder = `Filter ${tabLabel.toLowerCase()} by name, ID, keyword, category, or text…`;
  const lowerLabel = tabLabel.toLowerCase();
  const emptyState = items.length === 0
    ? `<p class="catalog-empty" data-state="empty">No ${escapeHtml(lowerLabel)} in the catalog.</p>`
    : '';
  const noMatchState = `<p class="catalog-empty" data-state="no-match" x-show="query &amp;&amp; filtered().length === 0">No ${escapeHtml(lowerLabel)} match "<span x-text="query"></span>".</p>`;

  const criticalExample = type === 'rule'
    ? `<p class="catalog-critical-example" data-state="critical-example">${escapeHtml(CRITICAL_RULE_EXAMPLE_COPY)}</p>`
    : '';
  const criticalModal = type === 'rule'
    ? `<div class="catalog-modal" x-show="pendingCriticalId" role="dialog" aria-modal="true" aria-labelledby="catalog-critical-modal-title" data-catalog-critical-modal>
  <article class="catalog-modal-content">
    <h3 id="catalog-critical-modal-title">Confirm Critical Rule toggle</h3>
    <p class="catalog-critical-warning">${escapeHtml(CRITICAL_RULE_EXAMPLE_COPY)}</p>
    <p>Type <code>CONFIRMAR</code> below to deactivate the rule:</p>
    <label class="catalog-modal-input-label">
      <span>Confirmation token</span>
      <input type="text" x-model="criticalConfirmInput" autocomplete="off" data-catalog-critical-input>
    </label>
    <p class="catalog-modal-error" x-show="criticalConfirmInput &amp;&amp; !criticalConfirmMatches()" role="alert">Type exactly <code>CONFIRMAR</code> to confirm.</p>
    <div class="catalog-modal-actions">
      <button type="button" @click="cancelCriticalToggle()" data-catalog-modal-cancel>Cancel</button>
      <button type="button" :disabled="!criticalConfirmMatches()" @click="confirmCriticalToggle()" data-catalog-modal-confirm>Confirm</button>
    </div>
  </article>
</div>`
    : '';

  return `<section data-tab="${escapeAttr(type === 'skill' ? 'skills' : type === 'rule' ? 'rules' : 'personas')}" aria-labelledby="${escapeAttr(type)}-heading" x-data="catalogTab">
<h2 id="${escapeAttr(type)}-heading">${escapeHtml(tabLabel)}</h2>
${criticalExample}
<script type="application/json" data-catalog-config>${configJson}</script>
<div class="catalog-layout">
  <div class="catalog-list-region">
    <label class="catalog-search">
      <span class="catalog-search-label">Search</span>
      <input type="search" placeholder="${escapeAttr(searchPlaceholder)}" x-model="query" data-catalog-search>
    </label>
    ${emptyState}
    ${noMatchState}
    <ul class="catalog-list" data-catalog-list>
      <template x-for="item in filtered()" :key="item.id">
        <li class="catalog-row" :class="{'is-active': isActive(item.id), 'is-selected': selectedId === item.id}" :data-id="item.id" :data-type="item.type">
          <button type="button" class="catalog-row-select" @click="select(item.id)">
            <span class="catalog-row-title" x-text="displayTitle(item)"></span>
            <span class="catalog-row-meta" x-text="displayMeta(item)"></span>
            <span class="catalog-row-status" x-text="isActive(item.id) ? 'Active' : 'Inactive'"></span>
          </button>
          <button type="button" class="catalog-row-toggle" :class="isActive(item.id) ? 'is-on' : 'is-off'" :data-critical="item.type === 'rule' &amp;&amp; item.critical" :disabled="shouldBlockForPersonaCap(item)" @click="toggleItem(item)" data-catalog-toggle>
            <span x-text="isActive(item.id) ? 'On' : 'Off'"></span>
          </button>
          <p class="catalog-persona-cap-error" x-show="shouldBlockForPersonaCap(item)" role="alert" data-state="persona-cap">${escapeHtml(PERSONA_CAP_MESSAGE)}</p>
        </li>
      </template>
    </ul>
  </div>
  <aside class="catalog-side-panel" aria-live="polite" data-catalog-side-panel>
    <template x-if="selected()">
      <article class="catalog-detail">
        <h3 class="catalog-detail-title" x-text="displayTitle(selected())"></h3>
        <p class="catalog-detail-meta" x-text="displayMeta(selected())"></p>
        <pre class="catalog-detail-text" x-text="selected().text"></pre>
      </article>
    </template>
    <template x-if="!selected()">
      <p class="catalog-detail-empty">Select a catalog item to view details.</p>
    </template>
  </aside>
</div>
${criticalModal}
</section>`;
}

export async function buildCatalogViewModel(
  catalogReader: Pick<CatalogReader, 'list'>,
  stateStore: Pick<ProjectStateStore, 'read'>,
): Promise<CatalogViewModel> {
  const [items, state] = await Promise.all([catalogReader.list(), stateStore.read()]);
  return { items, activeIds: new Set(state.activeCatalog) };
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

export interface DefaultPartialRendererOptions {
  catalogReader?: Pick<CatalogReader, 'list'>;
}

export function createDefaultPartialRenderers(
  stateStore: Pick<ProjectStateStore, 'read'>,
  auditReader: AuditReader,
  options: DefaultPartialRendererOptions = {},
): UiPartialRenderers {
  const { catalogReader } = options;
  const skillsRenderer: PartialRenderer = catalogReader
    ? async () => {
        const model = await buildCatalogViewModel(catalogReader, stateStore);
        return renderCatalogPartial('skill', model);
      }
    : async () => renderPlaceholderPartial('skills');
  const rulesRenderer: PartialRenderer = catalogReader
    ? async () => {
        const model = await buildCatalogViewModel(catalogReader, stateStore);
        return renderCatalogPartial('rule', model);
      }
    : async () => renderPlaceholderPartial('rules');
  const personasRenderer: PartialRenderer = catalogReader
    ? async () => {
        const model = await buildCatalogViewModel(catalogReader, stateStore);
        return renderCatalogPartial('persona', model);
      }
    : async () => renderPlaceholderPartial('personas');

  return {
    skills: skillsRenderer,
    rules: rulesRenderer,
    personas: personasRenderer,
    audit: async () => renderAuditPartial(await auditReader.latest(20)),
    settings: async () => renderSettingsPartial(await stateStore.read()),
  };
}
