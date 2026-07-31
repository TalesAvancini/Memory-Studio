import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRITICAL_RULE_EXAMPLE_COPY,
  PERSONA_CAP_MESSAGE,
  escapeScriptJson,
  renderAuditPartial,
  renderCatalogPartial,
  renderSettingsPartial,
} from '@memory-studio/ui';

const SAMPLE_SKILL = {
  id: 'skill-jwt-validation',
  type: 'skill',
  title: 'JWT Validation',
  category: 'procedural',
  text: 'Validates JWT tokens.\n',
};

const SAMPLE_RULE = {
  id: 'rule-no-secrets',
  type: 'rule',
  critical: true,
  text: 'Never commit secrets.\n',
};

const SAMPLE_RULE_NON_CRITICAL = {
  id: 'rule-doc',
  type: 'rule',
  critical: false,
  text: 'Prefer small snippets.\n',
};

const SAMPLE_PERSONA = {
  id: 'persona-concise',
  type: 'persona',
  isDefault: true,
  text: 'Respond concisely.',
};

test('renderCatalogPartial renders a Skills tab with two-column layout', () => {
  const html = renderCatalogPartial('skill', {
    items: [SAMPLE_SKILL],
    activeIds: new Set([SAMPLE_SKILL.id]),
  });

  assert.match(html, /data-tab="skills"/);
  assert.match(html, /x-data="catalogTab"/);
  assert.match(html, /class="catalog-layout"/);
  assert.match(html, /class="catalog-list-region"/);
  assert.match(html, /class="catalog-side-panel"/);
  assert.match(html, /data-catalog-search/);
});

test('renderCatalogPartial marks active items and renders selection state', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_RULE],
    activeIds: new Set([SAMPLE_RULE.id]),
  });

  assert.match(html, /data-tab="rules"/);
  // Active items get the is-active class.
  assert.match(html, /is-active/);
  // Selection state binds via Alpine.
  assert.match(html, /is-selected/);
});

test('renderCatalogPartial renders Personas with persona id as display title', () => {
  const html = renderCatalogPartial('persona', {
    items: [SAMPLE_PERSONA],
    activeIds: new Set(),
  });

  assert.match(html, /data-tab="personas"/);
  assert.match(html, /displayTitle\(item\)/);
  assert.match(html, /displayMeta\(item\)/);
});

test('renderCatalogPartial HTML-escapes catalog text fields', () => {
  const malicious = {
    id: 'rule-evil',
    type: 'rule',
    critical: true,
    text: '<script>window.PWNED = true;</script>',
  };

  const html = renderCatalogPartial('rule', {
    items: [malicious],
    activeIds: new Set(),
  });

  // The literal <script> must never appear as raw HTML in the markup.
  // Alpine's x-text binding is also safe (sets textContent, not innerHTML).
  assert.doesNotMatch(html, /<script>window\.PWNED/);
  // The escaped form must be present somewhere in the rendered output:
  // either as &lt; entities in markup, or as Unicode escapes inside the
  // JSON <script data-catalog-config> payload.
  const hasEntity = /&lt;script&gt;window\.PWNED/.test(html);
  const hasUnicode = /\\u003cscript\\u003ewindow\.PWNED/.test(html);
  assert.ok(hasEntity || hasUnicode, 'payload must be HTML-escaped before output');
});

test('renderCatalogPartial HTML-escapes titles in data-row markup', () => {
  const skill = {
    id: 'skill-bad',
    type: 'skill',
    title: '</span><img src=x onerror=alert(1)>',
    category: 'procedural',
    text: 'x',
  };

  const html = renderCatalogPartial('skill', {
    items: [skill],
    activeIds: new Set(),
  });

  assert.doesNotMatch(html, /<img[^>]*onerror=alert/);
  const hasEntity = /&lt;img src=x onerror=alert/.test(html);
  const hasUnicode = /\\u003cimg src=x onerror=alert/.test(html);
  assert.ok(hasEntity || hasUnicode, 'title must be HTML-escaped before output');
});

test('renderCatalogPartial renders explicit empty state when no items match type', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_SKILL, SAMPLE_PERSONA],
    activeIds: new Set(),
  });

  assert.match(html, /data-state="empty"/);
  assert.match(html, /No rules in the catalog\./);
});

test('renderCatalogPartial renders no-match state guarded by x-show query', () => {
  const html = renderCatalogPartial('skill', {
    items: [SAMPLE_SKILL],
    activeIds: new Set(),
  });

  assert.match(html, /data-state="no-match"/);
  assert.match(html, /x-show="query &amp;&amp; filtered\(\)\.length === 0"/);
});

test('renderCatalogPartial embeds JSON catalog config in script tag with safe escaping', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_RULE],
    activeIds: new Set([SAMPLE_RULE.id]),
  });

  const match = html.match(/<script type="application\/json" data-catalog-config>([\s\S]*?)<\/script>/);
  assert.ok(match, 'catalog config script tag must be present');
  const config = JSON.parse(match[1]);
  assert.deepEqual(config.type, 'rule');
  assert.deepEqual(config.items, [SAMPLE_RULE]);
  assert.deepEqual(config.activeIds, [SAMPLE_RULE.id]);
  // Script tag terminator can never be embedded inside the JSON payload.
  assert.doesNotMatch(match[1], /<\/script>/i);
});

test('renderCatalogPartial only includes items of the requested type', () => {
  const html = renderCatalogPartial('skill', {
    items: [SAMPLE_SKILL, SAMPLE_RULE, SAMPLE_PERSONA],
    activeIds: new Set(),
  });

  const configMatch = html.match(/<script type="application\/json" data-catalog-config>([\s\S]*?)<\/script>/);
  assert.ok(configMatch);
  const config = JSON.parse(configMatch[1]);
  assert.deepEqual(config.items.map((item) => item.type), ['skill']);
});

test('escapeScriptJson neutralizes HTML terminator characters', () => {
  const value = { evil: '</script><script>alert(1)</script>' };
  const escaped = escapeScriptJson(value);
  // JSON.parse must still round-trip exactly.
  assert.deepEqual(JSON.parse(escaped), value);
  // And the literal </script must not survive into the output.
  assert.doesNotMatch(escaped, /<\/script>/i);
});

test('Rules partial renders the exact mandated Critical Rule example copy', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_RULE],
    activeIds: new Set([SAMPLE_RULE.id]),
  });

  assert.match(html, /data-state="critical-example"/);
  // The copy must appear, escaped or unescaped. In the rendered HTML the
  // single-quote becomes &#39; because every catalog-bound field passes
  // through HTML escaping — the browser parses &#39; back to ' on display.
  const escapedCopy = CRITICAL_RULE_EXAMPLE_COPY
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  assert.match(html, new RegExp(escapedCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Rules partial embeds the Critical Rule modal markup with CONFIRMAR input', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_RULE],
    activeIds: new Set([SAMPLE_RULE.id]),
  });

  assert.match(html, /data-catalog-critical-modal/);
  assert.match(html, /data-catalog-critical-input/);
  assert.match(html, /data-catalog-modal-cancel/);
  assert.match(html, /data-catalog-modal-confirm/);
  // Confirm button is enabled only when input matches exactly.
  assert.match(html, /:disabled="!criticalConfirmMatches\(\)"/);
});

test('Personas partial renders the inline persona-cap error message', () => {
  const html = renderCatalogPartial('persona', {
    items: [SAMPLE_PERSONA],
    activeIds: new Set(),
  });

  assert.match(html, /data-state="persona-cap"/);
  assert.match(html, new RegExp(PERSONA_CAP_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  // Toggle button binds to the browser-side persona cap gate.
  assert.match(html, /:disabled="shouldBlockForPersonaCap\(item\)"/);
});

test('Skills partial does not render Critical Rule example copy (rule-only)', () => {
  const html = renderCatalogPartial('skill', {
    items: [SAMPLE_SKILL],
    activeIds: new Set(),
  });

  assert.doesNotMatch(html, /data-state="critical-example"/);
  assert.doesNotMatch(html, /data-catalog-critical-modal/);
});

test('Critical Rule row exposes critical marker on the toggle button', () => {
  const html = renderCatalogPartial('rule', {
    items: [SAMPLE_RULE, SAMPLE_RULE_NON_CRITICAL],
    activeIds: new Set([SAMPLE_RULE.id]),
  });

  // The x-for template iterates over both rows and emits one toggle button
  // bound to item.critical — Alpine clones the template per item at runtime.
  assert.match(html, /:data-critical="item\.type === 'rule' &amp;&amp; item\.critical"/);
  // One template instance contains the data-catalog-toggle marker.
  assert.match(html, /data-catalog-toggle/);
});

test('renderAuditPartial renders the newest N supplied events with required evidence', () => {
  const html = renderAuditPartial([
    {
      timestamp: '2026-07-31T08:00:00.000Z',
      redactedPrompt: 'older prompt',
      matchedIds: ['skill-old'],
      pruningReasons: ['below threshold'],
      latencyMs: 19,
    },
    {
      timestamp: '2026-07-31T10:00:00.000Z',
      redactedPrompt: 'newest prompt',
      matchedIds: ['rule-new', 'persona-new'],
      pruningReasons: ['token budget'],
      latencyMs: 7,
    },
    {
      timestamp: '2026-07-31T09:00:00.000Z',
      redactedPrompt: 'middle prompt',
      matchedIds: ['skill-middle'],
      pruningReasons: [],
      latencyMs: 11,
    },
  ], 2);

  assert.match(html, /2026-07-31T10:00:00\.000Z/);
  assert.match(html, /newest prompt/);
  assert.match(html, /rule-new/);
  assert.match(html, /persona-new/);
  assert.match(html, /token budget/);
  assert.match(html, />7 ms</);
  assert.match(html, /2026-07-31T09:00:00\.000Z/);
  assert.doesNotMatch(html, /older prompt/);
  assert.ok(html.indexOf('newest prompt') < html.indexOf('middle prompt'));
});

test('renderAuditPartial renders honest empty state and canonical recentFiles tooltip', () => {
  const html = renderAuditPartial([]);

  assert.match(html, /no audit events yet/i);
  assert.match(html, /title="[^"]*recentFiles[^"]*"/);
  assert.doesNotMatch(html, /gitStatus|recent_files|recentFilesList|lastFiles/);
});

test('renderAuditPartial escapes supplied event markup', () => {
  const html = renderAuditPartial([{
    timestamp: '<time onmouseover=alert(1)>',
    redactedPrompt: '<script>alert(1)</script>',
    matchedIds: ['<img src=x onerror=alert(1)>'],
    pruningReasons: ['<svg onload=alert(1)>'],
    latencyMs: 3,
  }]);

  assert.doesNotMatch(html, /<script>alert|<img src=x|<svg onload|<time onmouseover/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/);
});

// =============================================================================
// Phase 4.3 — Settings partial (T4.3-2)
// =============================================================================

function settingsStateFixture(overrides = {}) {
  return {
    schemaVersion: 3,
    activeCatalog: ['skill-a'],
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
    fastAgent: { model: 'MiniMax-M2.7-highspeed', baseURL: 'https://api.minimax.io/anthropic' },
    integrationMode: 'cli',
    agentId: 'claude-code',
    tenantId: 'tenant-x',
    embeddingModel: 'multilingual-e5-small',
    ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
    ...overrides,
  };
}

test('renderSettingsPartial exposes the five editable fields with state values (UI-21)', () => {
  const state = settingsStateFixture();
  const html = renderSettingsPartial(state);

  assert.match(html, /data-tab="settings"/);
  assert.match(html, /x-data="settingsTab"/);
  // Five inputs visible with state-sourced values.
  // Order of attributes in the rendered HTML is `value` then `data-settings-input`.
  assert.match(html, /value="0\.6"[\s\S]*?data-settings-input="minCosineSimilarity"/);
  assert.match(html, /value="2"[\s\S]*?data-settings-input="minFtsHits"/);
  assert.match(html, /value="tenant-x"[\s\S]*?data-settings-input="tenantId"/);
  assert.match(html, /data-settings-input="integrationMode"/);
  assert.match(html, /<option value="cli" selected/);
  assert.match(html, /value="multilingual-e5-small"[\s\S]*?data-settings-input="embeddingModel"/);
  // Status and error regions are bound to Alpine state.
  assert.match(html, /data-settings-status[^>]*x-show="statusMessage"/);
  assert.match(html, /data-settings-error[^>]*x-show="errorMessage"/);
  assert.match(html, /data-settings-submit[^>]*:disabled="submitting"/);
});

test('renderSettingsPartial enumerates all four integration modes', () => {
  const html = renderSettingsPartial(settingsStateFixture({ integrationMode: 'hook' }));

  assert.match(html, /<option value="proxy"/);
  assert.match(html, /<option value="hook" selected/);
  assert.match(html, /<option value="mcp"/);
  assert.match(html, /<option value="cli"/);
});

test('renderSettingsPartial HTML-escapes tenant and embedding model values', () => {
  const html = renderSettingsPartial(settingsStateFixture({
    tenantId: '</span><img src=x onerror=alert(1)>',
    embeddingModel: '<script>window.PWNED=1</script>',
  }));

  assert.doesNotMatch(html, /<img[^>]*onerror=alert/);
  assert.doesNotMatch(html, /<script>window\.PWNED/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&lt;script&gt;window\.PWNED=1&lt;\/script&gt;/);
});

