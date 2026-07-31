import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CRITICAL_CONFIRMATION_TOKEN,
  MAX_ACTIVE_PERSONAS,
  TransitionRequestError,
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
