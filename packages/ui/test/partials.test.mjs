import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCatalogPartial, escapeScriptJson } from '@memory-studio/ui';

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
