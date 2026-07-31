import {
  DEFAULT_AUDIT_LIMIT,
  selectRecentAuditEvents,
  type AuditReader,
  type AuditViewEvent,
} from './audit.ts';
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

export function renderAuditPartial(
  events: readonly AuditViewEvent[],
  limit = DEFAULT_AUDIT_LIMIT,
): string {
  const recentEvents = selectRecentAuditEvents(events, limit);
  const contextHelp = '<p class="audit-context-help" title="Collected context is reported using the canonical recentFiles field.">Context evidence</p>';
  const body = recentEvents.length === 0
    ? `${contextHelp}<p data-state="empty">No audit events yet.</p>`
    : `${contextHelp}<ol class="audit-events" data-audit-events>${recentEvents.map((event) => `<li class="audit-event">
  <time datetime="${escapeAttr(event.timestamp)}">${escapeHtml(event.timestamp)}</time>
  <dl>
    <dt>Redacted prompt</dt><dd>${escapeHtml(event.redactedPrompt)}</dd>
    <dt>Matched IDs</dt><dd>${event.matchedIds.length > 0 ? event.matchedIds.map(escapeHtml).join(', ') : 'None'}</dd>
    <dt>Pruning reasons</dt><dd>${event.pruningReasons.length > 0 ? event.pruningReasons.map(escapeHtml).join(', ') : 'None'}</dd>
    <dt>Latency</dt><dd>${escapeHtml(String(event.latencyMs))} ms</dd>
  </dl>
</li>`).join('')}</ol>`;
  return section('audit', body);
}

export function renderSettingsPartial(state: ProjectStateV3): string {
  const integrationModeOptions = [
    'proxy',
    'hook',
    'mcp',
    'cli',
  ]
    .map((value) => `<option value="${escapeAttr(value)}"${value === state.integrationMode ? ' selected' : ''}>${escapeHtml(value)}</option>`)
    .join('');

  const body = `
<section class="settings-tab" x-data="settingsTab">
<p class="settings-intro" data-settings-intro>Schema ${state.schemaVersion} project settings.</p>
<p class="settings-status" data-settings-status role="status" aria-live="polite" x-show="statusMessage" x-text="statusMessage"></p>
<p class="settings-error" data-settings-error role="alert" x-show="errorMessage" x-text="errorMessage"></p>
<form class="settings-form" data-settings-form aria-labelledby="settings-heading">
  <label class="settings-field">
    <span class="settings-field-label">Minimum cosine similarity</span>
    <input
      type="number"
      name="minCosineSimilarity"
      step="0.01"
      min="0"
      max="1"
      value="${escapeAttr(String(state.thresholds.minCosineSimilarity))}"
      data-settings-input="minCosineSimilarity"
      required
    >
  </label>
  <label class="settings-field">
    <span class="settings-field-label">Minimum FTS hits</span>
    <input
      type="number"
      name="minFtsHits"
      step="1"
      min="0"
      value="${escapeAttr(String(state.thresholds.minFtsHits))}"
      data-settings-input="minFtsHits"
      required
    >
  </label>
  <label class="settings-field">
    <span class="settings-field-label">Tenant</span>
    <input
      type="text"
      name="tenantId"
      value="${escapeAttr(state.tenantId ?? '')}"
      data-settings-input="tenantId"
      required
    >
  </label>
  <label class="settings-field">
    <span class="settings-field-label">Integration mode</span>
    <select name="integrationMode" data-settings-input="integrationMode" required>
      ${integrationModeOptions}
    </select>
  </label>
  <label class="settings-field">
    <span class="settings-field-label">Embedding model</span>
    <input
      type="text"
      name="embeddingModel"
      value="${escapeAttr(state.embeddingModel ?? '')}"
      data-settings-input="embeddingModel"
      required
    >
  </label>
  <div class="settings-actions">
    <button type="submit" data-settings-submit :disabled="submitting" x-text="submitting ? 'Saving…' : 'Save settings'"></button>
  </div>
</form>
</section>`.trim();

  return section('settings', body);
}

export function renderSafeErrorPartial(tab: UiTab): string {
  return section(tab, `<p role="alert">${TAB_LABELS[tab]} could not be loaded.</p>`);
}

export interface DefaultPartialRendererOptions {
  catalogReader?: Pick<CatalogReader, 'list'>;
  auditLimit?: number;
}

export function createDefaultPartialRenderers(
  stateStore: Pick<ProjectStateStore, 'read'>,
  auditReader: AuditReader,
  options: DefaultPartialRendererOptions = {},
): UiPartialRenderers {
  const { catalogReader, auditLimit = DEFAULT_AUDIT_LIMIT } = options;
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
    audit: async () => renderAuditPartial(await auditReader.latest(auditLimit), auditLimit),
    settings: async () => renderSettingsPartial(await stateStore.read()),
  };
}
