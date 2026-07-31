import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP_SOURCE = await readFile(
  fileURLToPath(new URL('../public/app.js', import.meta.url)),
  'utf8',
);

function loadAppContext() {
  const listeners = new Map();
  const registrations = new Map();
  const errors = [];
  const sandbox = {
    console: { error: (...args) => errors.push(args) },
    document: {
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
    history: { replaceState() {} },
    window: { location: { hash: '' }, htmx: { ajax() {} } },
    Alpine: {
      data: (name, factory) => registrations.set(name, factory),
    },
  };
  vm.runInNewContext(APP_SOURCE, sandbox);
  listeners.get('alpine:init')();
  return { registrations, errors };
}

function loadCatalogTab(config) {
  const { registrations } = loadAppContext();
  const factory = registrations.get('catalogTab');
  assert.ok(factory, 'catalogTab factory must be registered');

  const scriptText = JSON.stringify(config);
  const state = factory();
  state.$el = {
    querySelector: (selector) => (
      selector === 'script[data-catalog-config]'
        ? { textContent: scriptText }
        : null
    ),
  };
  state.init();
  return state;
}

const SKILL_JWT = {
  id: 'skill-jwt-validation',
  type: 'skill',
  title: 'JWT Validation',
  category: 'procedural',
  text: 'Validates JWT tokens issued by a trusted authority.',
};

const SKILL_K8S = {
  id: 'skill-k8s-rollout',
  type: 'skill',
  title: 'K8s Rollout',
  category: 'diagnostic',
  text: 'Diagnoses stuck Kubernetes rollouts.',
};

const RULE_NO_SECRETS = {
  id: 'rule-no-secrets',
  type: 'rule',
  critical: true,
  text: 'Never commit secrets.',
};

const RULE_DOC = {
  id: 'rule-doc',
  type: 'rule',
  critical: false,
  text: 'Prefer small documented snippets.',
};

function ids(items) {
  // Snapshot items into a fresh outer-scope array so deepStrictEqual
  // does not trip over vm-context prototype identity.
  return JSON.stringify(items.map((item) => item.id));
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

test('catalogTab loads items and activeIds from the inline JSON config', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, SKILL_K8S],
    activeIds: ['skill-jwt-validation'],
  });

  assert.equal(state.type, 'skill');
  assert.equal(ids(state.items), '["skill-jwt-validation","skill-k8s-rollout"]');
  assert.equal(eq(state.activeIds, ['skill-jwt-validation']), true);
  assert.equal(state.query, '');
  assert.equal(state.selectedId, null);
});

test('catalogTab search matches across id, title, category, and text case-insensitively', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, SKILL_K8S],
    activeIds: [],
  });

  assert.equal(ids(state.filtered()), '["skill-jwt-validation","skill-k8s-rollout"]');

  state.query = 'JWT';
  assert.equal(ids(state.filtered()), '["skill-jwt-validation"]');

  state.query = 'PROCEDURAL';
  assert.equal(ids(state.filtered()), '["skill-jwt-validation"]');

  state.query = 'kubernetes';
  assert.equal(ids(state.filtered()), '["skill-k8s-rollout"]');

  state.query = 'nonexistent';
  assert.equal(state.filtered().length, 0);
});

test('catalogTab clearing the query restores the full list', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, SKILL_K8S],
    activeIds: [],
  });

  state.query = 'jwt';
  assert.equal(state.filtered().length, 1);

  state.query = '';
  assert.equal(ids(state.filtered()), '["skill-jwt-validation","skill-k8s-rollout"]');

  state.query = '   ';
  assert.equal(ids(state.filtered()), '["skill-jwt-validation","skill-k8s-rollout"]');
});

test('catalogTab isActive reflects the loaded active IDs', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: ['rule-no-secrets'],
  });

  assert.equal(state.isActive('rule-no-secrets'), true);
  assert.equal(state.isActive('rule-other'), false);
});

test('catalogTab selected() returns the full item; selecting changes selectedId', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, SKILL_K8S],
    activeIds: [],
  });

  assert.equal(state.selected(), null);
  state.select('skill-k8s-rollout');
  assert.equal(state.selectedId, 'skill-k8s-rollout');
  assert.equal(state.selected()?.id, 'skill-k8s-rollout');
  assert.equal(state.selected()?.title, 'K8s Rollout');
});

test('catalogTab selected() returns null when the selected item is filtered out', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, SKILL_K8S],
    activeIds: [],
  });

  state.select('skill-k8s-rollout');
  assert.equal(state.selected()?.id, 'skill-k8s-rollout');

  state.query = 'jwt';
  // selectedId still references the hidden item, but selected() returns null
  // because the item is no longer in the filtered list. The side panel must
  // fall back to the empty state instead of leaking stale content.
  assert.equal(state.selected(), null);

  state.query = '';
  assert.equal(state.selected()?.id, 'skill-k8s-rollout');
});

test('catalogTab displayTitle and displayMeta return type-specific labels', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT, RULE_NO_SECRETS, { id: 'persona-x', type: 'persona', isDefault: true, text: 'X' }],
    activeIds: [],
  });

  assert.equal(state.displayTitle(SKILL_JWT), 'JWT Validation');
  assert.equal(state.displayMeta(SKILL_JWT), 'procedural');
  assert.equal(state.displayTitle(RULE_NO_SECRETS), 'rule-no-secrets');
  assert.equal(state.displayMeta(RULE_NO_SECRETS), 'critical rule');
  const persona = { id: 'persona-x', type: 'persona', isDefault: true, text: 'X' };
  assert.equal(state.displayTitle(persona), 'persona-x');
  assert.equal(state.displayMeta(persona), 'default persona');
});

test('catalogTab init() ignores malformed JSON config and logs error', () => {
  const { registrations, errors } = loadAppContext();
  const factory = registrations.get('catalogTab');
  const state = factory();
  state.$el = {
    querySelector: () => ({ textContent: '{ this is not json' }),
  };

  state.init();

  assert.equal(state.type, '');
  assert.equal(state.items.length, 0);
  assert.equal(state.activeIds.length, 0);
  assert.equal(errors.length, 1);
});

test('catalogTab init() with no config script keeps defaults', () => {
  const { registrations } = loadAppContext();
  const factory = registrations.get('catalogTab');
  const state = factory();
  state.$el = { querySelector: () => null };

  state.init();

  assert.equal(state.type, '');
  assert.equal(state.items.length, 0);
  assert.equal(state.activeIds.length, 0);
});

test('catalogTab toggleItem on non-critical skill returns on action without confirmation', () => {
  const state = loadCatalogTab({
    type: 'skill',
    items: [SKILL_JWT],
    activeIds: [],
  });

  const action = state.toggleItem(SKILL_JWT);
  assert.equal(JSON.stringify(action), JSON.stringify({ itemId: 'skill-jwt-validation', action: 'on', critical_confirm: undefined }));
});

test('catalogTab toggleItem off on active non-critical rule returns off action without confirmation', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_DOC],
    activeIds: ['rule-doc'],
  });

  const action = state.toggleItem(RULE_DOC);
  assert.equal(JSON.stringify(action), JSON.stringify({ itemId: 'rule-doc', action: 'off', critical_confirm: undefined }));
});

test('catalogTab toggleItem on critical rule is permitted without confirmation', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: [],
  });

  const action = state.toggleItem(RULE_NO_SECRETS);
  assert.equal(action?.itemId, 'rule-no-secrets');
  assert.equal(action?.action, 'on');
  assert.equal(action?.critical_confirm, undefined);
  assert.equal(state.pendingCriticalId, null, 'activating a critical rule must not open the modal');
});

test('catalogTab toggleItem off on critical rule opens the modal and clears input', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: ['rule-no-secrets'],
  });

  const result = state.toggleItem(RULE_NO_SECRETS);

  assert.equal(result, null, 'deactivation must defer to modal confirm step');
  assert.equal(state.pendingCriticalId, 'rule-no-secrets');
  assert.equal(state.criticalConfirmInput, '');
});

test('catalogTab cancelCriticalToggle clears modal state', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: ['rule-no-secrets'],
  });
  state.toggleItem(RULE_NO_SECRETS);
  state.criticalConfirmInput = 'CONFIRMAR';

  state.cancelCriticalToggle();

  assert.equal(state.pendingCriticalId, null);
  assert.equal(state.criticalConfirmInput, '');
});

test('catalogTab criticalConfirmMatches requires the exact CONFIRMAR token', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: ['rule-no-secrets'],
  });

  const cases = [
    ['CONFIRMAR', true],
    ['confirmar', false],
    [' CONFIRMAR', false],
    ['CONFIRMAR ', false],
    ['\tCONFIRMAR', false],
    ['', false],
    ['CON FIRMAR', false],
  ];
  for (const [input, expected] of cases) {
    state.criticalConfirmInput = input;
    assert.equal(state.criticalConfirmMatches(), expected, `input=${JSON.stringify(input)}`);
  }
});

test('catalogTab confirmCriticalToggle returns action only with exact CONFIRMAR', () => {
  const state = loadCatalogTab({
    type: 'rule',
    items: [RULE_NO_SECRETS],
    activeIds: ['rule-no-secrets'],
  });
  state.toggleItem(RULE_NO_SECRETS);
  state.criticalConfirmInput = 'confirmar';
  assert.equal(state.confirmCriticalToggle(), null, 'wrong-case confirm must be rejected');

  state.criticalConfirmInput = ' CONFIRMAR';
  assert.equal(state.confirmCriticalToggle(), null, 'padded confirm must be rejected');

  state.criticalConfirmInput = 'CONFIRMAR';
  const action = state.confirmCriticalToggle();
  assert.equal(JSON.stringify(action), JSON.stringify({
    itemId: 'rule-no-secrets',
    action: 'off',
    critical_confirm: 'CONFIRMAR',
  }));
  // Modal state cleared after a successful confirm.
  assert.equal(state.pendingCriticalId, null);
  assert.equal(state.criticalConfirmInput, '');
});

test('catalogTab activePersonaCount and isAtPersonaCap reflect the persona set', () => {
  const items = [
    { id: 'persona-a', type: 'persona', isDefault: true, text: 'A' },
    { id: 'persona-b', type: 'persona', isDefault: false, text: 'B' },
    { id: 'persona-c', type: 'persona', isDefault: false, text: 'C' },
    { id: 'persona-d', type: 'persona', isDefault: false, text: 'D' },
  ];
  const state = loadCatalogTab({ type: 'persona', items, activeIds: [] });

  assert.equal(state.activePersonaCount(), 0);
  assert.equal(state.isAtPersonaCap(), false);

  state.activeIds = ['persona-a', 'persona-b', 'persona-c'];
  assert.equal(state.activePersonaCount(), 3);
  assert.equal(state.isAtPersonaCap(), true);
});

test('catalogTab shouldBlockForPersonaCap blocks 4th activation only', () => {
  const items = [
    { id: 'persona-a', type: 'persona', isDefault: true, text: 'A' },
    { id: 'persona-b', type: 'persona', isDefault: false, text: 'B' },
    { id: 'persona-c', type: 'persona', isDefault: false, text: 'C' },
    { id: 'persona-d', type: 'persona', isDefault: false, text: 'D' },
  ];
  const state = loadCatalogTab({
    type: 'persona',
    items,
    activeIds: ['persona-a', 'persona-b', 'persona-c'],
  });

  // 4th persona activation blocked
  assert.equal(state.shouldBlockForPersonaCap(items[3]), true);
  // Deactivating an active persona always permitted
  assert.equal(state.shouldBlockForPersonaCap(items[0]), false);
  // Non-persona items never blocked by persona cap
  assert.equal(state.shouldBlockForPersonaCap(SKILL_JWT), false);
});

test('catalogTab toggleItem on 4th persona returns null and does not mutate state', () => {
  const items = [
    { id: 'persona-a', type: 'persona', isDefault: true, text: 'A' },
    { id: 'persona-b', type: 'persona', isDefault: false, text: 'B' },
    { id: 'persona-c', type: 'persona', isDefault: false, text: 'C' },
    { id: 'persona-d', type: 'persona', isDefault: false, text: 'D' },
  ];
  const state = loadCatalogTab({
    type: 'persona',
    items,
    activeIds: ['persona-a', 'persona-b', 'persona-c'],
  });

  const action = state.toggleItem(items[3]);

  assert.equal(action, null, '4th persona activation must short-circuit');
  assert.equal(JSON.stringify(state.activeIds), JSON.stringify(['persona-a', 'persona-b', 'persona-c']));
});

test('catalogTab disabling a persona releases a slot for the next activation', () => {
  const items = [
    { id: 'persona-a', type: 'persona', isDefault: true, text: 'A' },
    { id: 'persona-b', type: 'persona', isDefault: false, text: 'B' },
    { id: 'persona-c', type: 'persona', isDefault: false, text: 'C' },
    { id: 'persona-d', type: 'persona', isDefault: false, text: 'D' },
  ];
  const state = loadCatalogTab({
    type: 'persona',
    items,
    activeIds: ['persona-a', 'persona-b', 'persona-c'],
  });
  // Deactivate persona-a — opens no modal (not critical).
  const deactivated = state.toggleItem(items[0]);
  state.activeIds = ['persona-b', 'persona-c'];

  assert.equal(state.shouldBlockForPersonaCap(items[3]), false);
  const next = state.toggleItem(items[3]);
  assert.equal(JSON.stringify(next), JSON.stringify({ itemId: 'persona-d', action: 'on', critical_confirm: undefined }));
});
