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

  return `<section data-tab="${escapeAttr(type === 'skill' ? 'skills' : type === 'rule' ? 'rules' : 'personas')}" aria-labelledby="${escapeAttr(type)}-heading" x-data="catalogTab">
<h2 id="${escapeAttr(type)}-heading">${escapeHtml(tabLabel)}</h2>
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
