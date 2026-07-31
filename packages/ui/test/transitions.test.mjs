import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CRITICAL_CONFIRMATION_TOKEN,
  MAX_ACTIVE_PERSONAS,
  SETTINGS_FIELD_KEYS,
  SUPPORTED_INTEGRATION_MODES,
  TransitionRequestError,
  applySettings,
  applySettingsPatch,
  applyToggle,
  createDefaultProjectState,
  createEmptyCatalogReader,
  createProjectStateStore,
  toggleCatalogItem,
} from '@memory-studio/ui';

const SKILL_A = {
  id: 'skill-a',
  type: 'skill',
  title: 'Skill A',
  category: 'procedural',
  text: 'Procedural.',
};

const SKILL_B = {
  id: 'skill-b',
  type: 'skill',
  title: 'Skill B',
  category: 'diagnostic',
  text: 'Diagnostic.',
};

const RULE_NON_CRITICAL = {
  id: 'rule-doc',
  type: 'rule',
  critical: false,
  text: 'Prefer small snippets.',
};

const RULE_CRITICAL = {
  id: 'rule-no-secrets',
  type: 'rule',
  critical: true,
  text: 'Never commit secrets.',
};

const PERSONA_A = { id: 'persona-a', type: 'persona', isDefault: true, text: 'Concise.' };
const PERSONA_B = { id: 'persona-b', type: 'persona', isDefault: false, text: 'Pragmatic.' };
const PERSONA_C = { id: 'persona-c', type: 'persona', isDefault: false, text: 'Detailed.' };
const PERSONA_D = { id: 'persona-d', type: 'persona', isDefault: false, text: 'Concise variant.' };

function reader(items) {
  return createEmptyCatalogReader(items);
}

function state(activeCatalog = []) {
  const base = createDefaultProjectState();
  return { ...base, activeCatalog };
}

test('applyToggle activates a non-critical skill and returns updated state', async () => {
  const catalog = reader([SKILL_A]);
  const before = state();

  const result = await applyToggle(before, 'skill-a', 'on', {}, catalog);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.active, true);
  assert.deepEqual(result.state.activeCatalog, ['skill-a']);
  assert.deepEqual(before.activeCatalog, [], 'input state must remain untouched');
});

test('applyToggle deactivates an active item and returns updated state', async () => {
  const catalog = reader([SKILL_A]);
  const before = state(['skill-a']);

  const result = await applyToggle(before, 'skill-a', 'off', {}, catalog);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.active, false);
  assert.deepEqual(result.state.activeCatalog, []);
});

test('applyToggle is idempotent when the requested action matches current state', async () => {
  const catalog = reader([SKILL_A]);
  const before = state(['skill-a']);

  const result = await applyToggle(before, 'skill-a', 'on', {}, catalog);

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.active, true);
  assert.equal(result.state, before, 'no-op result should reuse the same state object');
});

test('applyToggle de-duplicates when the same id was previously duplicated', async () => {
  const catalog = reader([SKILL_A]);
  const before = state(['skill-a', 'skill-a', 'skill-b']);

  const result = await applyToggle(before, 'skill-a', 'off', {}, catalog);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.activeCatalog, ['skill-b']);
});

test('applyToggle rejects unknown item id with UNKNOWN_ITEM', async () => {
  const catalog = reader([SKILL_A]);

  const result = await applyToggle(state(), 'skill-missing', 'on', {}, catalog);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNKNOWN_ITEM');
});

test('applyToggle rejects unsupported action with UNSUPPORTED_ACTION', async () => {
  const catalog = reader([SKILL_A]);

  const result = await applyToggle(state(), 'skill-a', 'toggle', {}, catalog);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'UNSUPPORTED_ACTION');
});

test('applyToggle rejects malformed itemId with MALFORMED_FIELD', async () => {
  const catalog = reader([SKILL_A]);

  const cases = [null, undefined, 123, '', { id: 'skill-a' }];
  for (const itemId of cases) {
    const result = await applyToggle(state(), itemId, 'on', {}, catalog);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'MALFORMED_FIELD');
  }
});

test('applyToggle rejects non-string critical_confirm with CRITICAL_CONFIRMATION_REQUIRED', async () => {
  const catalog = reader([RULE_CRITICAL]);
  const cases = [
    { critical_confirm: undefined },
    { critical_confirm: null },
    { critical_confirm: true },
    { critical_confirm: 1 },
    { critical_confirm: {} },
  ];

  for (const opts of cases) {
    const result = await applyToggle(state(), 'rule-no-secrets', 'off', opts, catalog);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CRITICAL_CONFIRMATION_REQUIRED', JSON.stringify(opts));
  }
});

test('applyToggle rejects lowercase confirmation with CRITICAL_CONFIRMATION_REQUIRED', async () => {
  const catalog = reader([RULE_CRITICAL]);

  const result = await applyToggle(
    state(['rule-no-secrets']),
    'rule-no-secrets',
    'off',
    { critical_confirm: 'confirmar' },
    catalog,
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'CRITICAL_CONFIRMATION_REQUIRED');
});

test('applyToggle rejects padded confirmation with CRITICAL_CONFIRMATION_REQUIRED', async () => {
  const catalog = reader([RULE_CRITICAL]);
  const cases = [' CONFIRMAR', 'CONFIRMAR ', ' CONFIRMAR ', '\tCONFIRMAR', 'CONFIRMAR\n'];

  for (const confirm of cases) {
    const result = await applyToggle(
      state(['rule-no-secrets']),
      'rule-no-secrets',
      'off',
      { critical_confirm: confirm },
      catalog,
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CRITICAL_CONFIRMATION_REQUIRED', `padded form rejected: ${JSON.stringify(confirm)}`);
  }
});

test('applyToggle permits critical rule off with exact CONFIRMAR token', async () => {
  const catalog = reader([RULE_CRITICAL]);

  const result = await applyToggle(
    state(['rule-no-secrets']),
    'rule-no-secrets',
    'off',
    { critical_confirm: CRITICAL_CONFIRMATION_TOKEN },
    catalog,
  );

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.activeCatalog, []);
});

test('applyToggle permits activating a critical rule without confirmation', async () => {
  const catalog = reader([RULE_CRITICAL]);

  const result = await applyToggle(state(), 'rule-no-secrets', 'on', {}, catalog);

  assert.equal(result.ok, true);
  assert.deepEqual(result.state.activeCatalog, ['rule-no-secrets']);
});

test('applyToggle permits toggling non-critical rules without confirmation', async () => {
  const catalog = reader([RULE_NON_CRITICAL]);

  const result = await applyToggle(
    state(['rule-doc']),
    'rule-doc',
    'off',
    {},
    catalog,
  );

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
});

test('applyToggle activates personas up to the cap and blocks the fourth', async () => {
  const catalog = reader([PERSONA_A, PERSONA_B, PERSONA_C, PERSONA_D]);

  const first = await applyToggle(state(), 'persona-a', 'on', {}, catalog);
  assert.equal(first.ok, true);
  const second = await applyToggle(first.state, 'persona-b', 'on', {}, catalog);
  assert.equal(second.ok, true);
  const third = await applyToggle(second.state, 'persona-c', 'on', {}, catalog);
  assert.equal(third.ok, true);
  assert.equal(third.state.activeCatalog.length, MAX_ACTIVE_PERSONAS);

  const fourth = await applyToggle(third.state, 'persona-d', 'on', {}, catalog);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.code, 'PERSONA_LIMIT_EXCEEDED');
  // The saturated input state must remain unmutated by the failed attempt.
  assert.deepEqual(third.state.activeCatalog, [PERSONA_A.id, PERSONA_B.id, PERSONA_C.id]);
});

test('disabling one persona releases a slot for the next activation', async () => {
  const catalog = reader([PERSONA_A, PERSONA_B, PERSONA_C, PERSONA_D]);
  const saturated = state([PERSONA_A.id, PERSONA_B.id, PERSONA_C.id]);

  const blocked = await applyToggle(saturated, 'persona-d', 'on', {}, catalog);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'PERSONA_LIMIT_EXCEEDED');

  const disabled = await applyToggle(saturated, 'persona-a', 'off', {}, catalog);
  assert.equal(disabled.ok, true);

  const retry = await applyToggle(disabled.state, 'persona-d', 'on', {}, catalog);
  assert.equal(retry.ok, true);
  assert.equal(retry.state.activeCatalog.length, MAX_ACTIVE_PERSONAS);
  assert.equal(retry.state.activeCatalog.includes('persona-d'), true);
});

test('deactivating a persona below the cap is always permitted', async () => {
  const catalog = reader([PERSONA_A, PERSONA_B]);

  const result = await applyToggle(
    state(['persona-a', 'persona-b', 'persona-other']),
    'persona-a',
    'off',
    {},
    catalog,
  );

  assert.equal(result.ok, true);
});

test('applyToggle treats skill and rule types as not subject to persona cap', async () => {
  const catalog = reader([SKILL_A, SKILL_B, PERSONA_A, PERSONA_B, PERSONA_C]);

  const withPersonaCap = await applyToggle(
    state([PERSONA_A.id, PERSONA_B.id, PERSONA_C.id]),
    'skill-a',
    'on',
    {},
    catalog,
  );
  assert.equal(withPersonaCap.ok, true);
});

test('toggleCatalogItem persists the change via the project state store', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-toggle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  const catalog = reader([SKILL_A]);

  const result = await toggleCatalogItem(
    { itemId: 'skill-a', action: 'on' },
    catalog,
    store,
  );

  assert.equal(result.active, true);
  assert.deepEqual(result.state.activeCatalog, ['skill-a']);

  const persisted = await store.read();
  assert.deepEqual(persisted.activeCatalog, ['skill-a']);
});

test('toggleCatalogItem throws TransitionRequestError and does not persist on rejection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-toggle-reject-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  const catalog = reader([RULE_CRITICAL]);

  await assert.rejects(
    () => toggleCatalogItem(
      { itemId: 'rule-no-secrets', action: 'off' },
      catalog,
      store,
    ),
    (error) => {
      assert.ok(error instanceof TransitionRequestError);
      assert.equal(error.code, 'CRITICAL_CONFIRMATION_REQUIRED');
      return true;
    },
  );

  // No state file should exist because no mutation succeeded.
  const persisted = await store.read();
  assert.deepEqual(persisted.activeCatalog, []);
});

test('toggleCatalogItem with matching state returns success without writing the store', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-toggle-noop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  await store.update((current) => ({ ...current, activeCatalog: ['skill-a'] }));
  const catalog = reader([SKILL_A]);

  const result = await toggleCatalogItem(
    { itemId: 'skill-a', action: 'on' },
    catalog,
    store,
  );

  assert.equal(result.active, true);
  assert.deepEqual(result.state.activeCatalog, ['skill-a']);
  // Subsequent reads see the same state — orchestrator did not write again.
  const reread = await store.read();
  assert.deepEqual(reread.activeCatalog, ['skill-a']);
});

test('toggleCatalogItem blocks the fourth persona and leaves state unmutated', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-toggle-persona-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  const catalog = reader([PERSONA_A, PERSONA_B, PERSONA_C, PERSONA_D]);
  await store.update((current) => ({
    ...current,
    activeCatalog: [PERSONA_A.id, PERSONA_B.id, PERSONA_C.id],
  }));
  const beforeBytes = JSON.stringify(await store.read());

  await assert.rejects(
    () => toggleCatalogItem(
      { itemId: 'persona-d', action: 'on' },
      catalog,
      store,
    ),
    (error) => {
      assert.ok(error instanceof TransitionRequestError);
      assert.equal(error.code, 'PERSONA_LIMIT_EXCEEDED');
      return true;
    },
  );

  // State bytes on disk must remain identical to the pre-attempt snapshot.
  const after = await store.read();
  assert.equal(JSON.stringify(after), beforeBytes);
  assert.deepEqual(after.activeCatalog, [PERSONA_A.id, PERSONA_B.id, PERSONA_C.id]);
});

test('disabling one persona via toggleCatalogItem releases a slot for the next activation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-toggle-persona-slot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  const catalog = reader([PERSONA_A, PERSONA_B, PERSONA_C, PERSONA_D]);
  await store.update((current) => ({
    ...current,
    activeCatalog: [PERSONA_A.id, PERSONA_B.id, PERSONA_C.id],
  }));

  const deactivated = await toggleCatalogItem(
    { itemId: PERSONA_A.id, action: 'off' },
    catalog,
    store,
  );
  assert.equal(deactivated.active, false);
  assert.equal(deactivated.state.activeCatalog.length, 2);

  const activated = await toggleCatalogItem(
    { itemId: PERSONA_D.id, action: 'on' },
    catalog,
    store,
  );
  assert.equal(activated.active, true);
  assert.equal(activated.state.activeCatalog.length, MAX_ACTIVE_PERSONAS);
  assert.equal(activated.state.activeCatalog.includes(PERSONA_D.id), true);
});

// =============================================================================
// Phase 4.3 — Settings transition (T4.3-2)
// =============================================================================

function settingsFixture(overrides = {}) {
  const base = createDefaultProjectState();
  return {
    ...base,
    thresholds: { ...base.thresholds, ...(overrides.thresholds ?? {}) },
    activeCatalog: overrides.activeCatalog ?? ['skill-a', 'persona-b'],
    fastAgent: overrides.fastAgent ?? { ...base.fastAgent, model: 'MiniMax-M2.7-highspeed', baseURL: 'https://api.minimax.io/anthropic' },
    integrationMode: overrides.integrationMode ?? 'proxy',
    agentId: overrides.agentId ?? 'claude-code',
    tenantId: overrides.tenantId ?? '',
    embeddingModel: overrides.embeddingModel ?? 'multilingual-e5-small',
    ui: overrides.ui ?? { ...base.ui, portRange: [41_823, 42_823] },
  };
}

function validPatch(overrides = {}) {
  return {
    minCosineSimilarity: 0.75,
    minFtsHits: 3,
    tenantId: 'tenant-1',
    integrationMode: 'cli',
    embeddingModel: 'multilingual-e5-small',
    ...overrides,
  };
}

test('SETTINGS_FIELD_KEYS enumerates the five editable settings fields', () => {
  assert.deepEqual(
    [...SETTINGS_FIELD_KEYS].sort(),
    ['embeddingModel', 'integrationMode', 'minCosineSimilarity', 'minFtsHits', 'tenantId'].sort(),
  );
});

test('SUPPORTED_INTEGRATION_MODES exposes the four integration modes', () => {
  assert.deepEqual(
    [...SUPPORTED_INTEGRATION_MODES].sort(),
    ['cli', 'hook', 'mcp', 'proxy'].sort(),
  );
});

test('applySettings persists all five fields and preserves schema-v3 unrelated data (UI-22)', () => {
  const before = settingsFixture({
    activeCatalog: ['skill-a', 'rule-1'],
    fastAgent: { model: 'gpt-fast', baseURL: 'https://api.example.com/v1' },
    agentId: 'claude-code',
    tenantId: '',
    embeddingModel: 'old-model',
    integrationMode: 'proxy',
  });
  const patch = validPatch();

  const result = applySettings(before, patch);

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.state.thresholds.minCosineSimilarity, patch.minCosineSimilarity);
  assert.equal(result.state.thresholds.minFtsHits, patch.minFtsHits);
  assert.equal(result.state.tenantId, patch.tenantId);
  assert.equal(result.state.integrationMode, patch.integrationMode);
  assert.equal(result.state.embeddingModel, patch.embeddingModel);
  // Schema-v3 unrelated fields preserved.
  assert.equal(result.state.schemaVersion, 3);
  assert.deepEqual(result.state.activeCatalog, ['skill-a', 'rule-1']);
  assert.deepEqual(result.state.fastAgent, before.fastAgent);
  assert.equal(result.state.agentId, 'claude-code');
  assert.deepEqual(result.state.ui, before.ui);
});

test('applySettings is idempotent when the patch matches the current state', () => {
  const current = settingsFixture({
    thresholds: { minCosineSimilarity: 0.5, minFtsHits: 2 },
    tenantId: 'tenant-x',
    integrationMode: 'mcp',
    embeddingModel: 'multilingual-e5-small',
  });
  const patch = validPatch({
    minCosineSimilarity: 0.5,
    minFtsHits: 2,
    tenantId: 'tenant-x',
    integrationMode: 'mcp',
    embeddingModel: 'multilingual-e5-small',
  });

  const result = applySettings(current, patch);

  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(result.state, current, 'no-op should reuse the same state object');
});

test('applySettings rejects cosine out of range with INVALID_THRESHOLD (UI-23)', () => {
  const before = settingsFixture();
  const cases = [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, 'high'];

  for (const value of cases) {
    const result = applySettings(before, validPatch({ minCosineSimilarity: value }));
    assert.equal(result.ok, false, `value ${String(value)} should be rejected`);
    assert.equal(result.code, 'INVALID_THRESHOLD');
  }
});

test('applySettings rejects negative or non-integer minFtsHits with INVALID_THRESHOLD (UI-23)', () => {
  const before = settingsFixture();
  const cases = [-1, 1.5, 'three', null];

  for (const value of cases) {
    const result = applySettings(before, validPatch({ minFtsHits: value }));
    assert.equal(result.ok, false, `value ${String(value)} should be rejected`);
    assert.equal(result.code, 'INVALID_THRESHOLD');
  }
});

test('applySettings accepts the inclusive bounds 0 and 1 for cosine (UI-23)', () => {
  const before = settingsFixture();

  const lower = applySettings(before, validPatch({ minCosineSimilarity: 0 }));
  assert.equal(lower.ok, true);
  const upper = applySettings(before, validPatch({ minCosineSimilarity: 1 }));
  assert.equal(upper.ok, true);
});

test('applySettings accepts minFtsHits = 0 (UI-23)', () => {
  const before = settingsFixture();
  const result = applySettings(before, validPatch({ minFtsHits: 0 }));
  assert.equal(result.ok, true);
});

test('applySettings rejects unsupported integrationMode with typed error (UI-23)', () => {
  const before = settingsFixture();

  for (const value of ['websocket', '', null, 42, 'PROXY']) {
    const result = applySettings(before, validPatch({ integrationMode: value }));
    assert.equal(result.ok, false, `value ${String(value)} should be rejected`);
    assert.equal(result.code, 'UNSUPPORTED_INTEGRATION_MODE');
  }
});

test('applySettings accepts every supported integrationMode including cli (UI-23)', () => {
  const before = settingsFixture();

  for (const value of SUPPORTED_INTEGRATION_MODES) {
    const result = applySettings(before, validPatch({ integrationMode: value }));
    assert.equal(result.ok, true, `value ${value} should be accepted`);
    assert.equal(result.state.integrationMode, value);
  }
});

test('applySettings rejects empty tenantId and embeddingModel with MISSING_STRING_FIELD (UI-23)', () => {
  const before = settingsFixture();

  for (const value of ['', null, undefined, 0, {}]) {
    const tenant = applySettings(before, validPatch({ tenantId: value }));
    assert.equal(tenant.ok, false, `tenantId ${String(value)} should be rejected`);
    assert.equal(tenant.code, 'MISSING_STRING_FIELD');

    const embedding = applySettings(before, validPatch({ embeddingModel: value }));
    assert.equal(embedding.ok, false, `embeddingModel ${String(value)} should be rejected`);
    assert.equal(embedding.code, 'MISSING_STRING_FIELD');
  }
});

test('applySettingsPatch persists the patch via the project state store (UI-22)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-settings-ok-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  await store.update((current) => ({
    ...current,
    activeCatalog: ['skill-a', 'persona-b'],
    fastAgent: { ...current.fastAgent, model: 'gpt-fast', baseURL: 'https://api.example.com/v1' },
  }));

  const result = await applySettingsPatch(validPatch(), store);

  assert.equal(result.changed, true);
  assert.equal(result.state.thresholds.minCosineSimilarity, 0.75);
  assert.equal(result.state.integrationMode, 'cli');
  assert.equal(result.state.tenantId, 'tenant-1');
  assert.equal(result.state.embeddingModel, 'multilingual-e5-small');

  const persisted = await store.read();
  assert.equal(persisted.thresholds.minCosineSimilarity, 0.75);
  assert.equal(persisted.integrationMode, 'cli');
  assert.deepEqual(persisted.activeCatalog, ['skill-a', 'persona-b']);
  assert.equal(persisted.fastAgent.model, 'gpt-fast');
  assert.equal(persisted.schemaVersion, 3);
});

test('applySettingsPatch throws TransitionRequestError and leaves state bytes unchanged (UI-23)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-settings-reject-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  await store.update((current) => ({
    ...current,
    thresholds: { minCosineSimilarity: 0.42, minFtsHits: 9 },
    tenantId: 'before-tenant',
    integrationMode: 'hook',
    embeddingModel: 'before-model',
  }));
  const before = await store.read();
  const beforeBytes = JSON.stringify(before);

  await assert.rejects(
    () => applySettingsPatch(validPatch({
      minCosineSimilarity: 2, // out of range
      tenantId: 'after-tenant',
      integrationMode: 'cli',
      embeddingModel: 'after-model',
    }), store),
    (error) => {
      assert.ok(error instanceof TransitionRequestError);
      assert.equal(error.code, 'INVALID_THRESHOLD');
      return true;
    },
  );

  // State bytes must remain identical — validation fails before persistence.
  const after = await store.read();
  assert.equal(JSON.stringify(after), beforeBytes);
  assert.equal(after.tenantId, 'before-tenant');
  assert.equal(after.integrationMode, 'hook');
  assert.equal(after.embeddingModel, 'before-model');
  assert.equal(after.thresholds.minCosineSimilarity, 0.42);
  assert.equal(after.thresholds.minFtsHits, 9);
});

test('applySettingsPatch returns changed:false without rewriting when patch matches state (UI-22)', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-settings-noop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createProjectStateStore(root);
  await store.update((current) => ({
    ...current,
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
    tenantId: 'tenant-keep',
    integrationMode: 'proxy',
    embeddingModel: 'multilingual-e5-small',
  }));
  const fileBytesBefore = await (await import('node:fs/promises')).readFile(
    join(root, '.memory-studio', 'state.json'),
    'utf8',
  );

  const result = await applySettingsPatch(validPatch({
    minCosineSimilarity: 0.6,
    minFtsHits: 2,
    tenantId: 'tenant-keep',
    integrationMode: 'proxy',
    embeddingModel: 'multilingual-e5-small',
  }), store);

  assert.equal(result.changed, false);
  // No write was scheduled — file bytes must remain unchanged.
  const fileBytesAfter = await (await import('node:fs/promises')).readFile(
    join(root, '.memory-studio', 'state.json'),
    'utf8',
  );
  assert.equal(fileBytesAfter, fileBytesBefore);
});

