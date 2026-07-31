import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProjectStateConflictError,
  ProjectStatePersistenceError,
  createDefaultProjectState,
  createProjectStateStore,
  readProjectState,
  validateProjectState,
  writeProjectState,
} from '@memory-studio/ui';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-state-'));
  const statePath = join(root, '.memory-studio', 'state.json');
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, statePath };
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function validState(overrides = {}) {
  return {
    schemaVersion: 3,
    activeCatalog: [],
    thresholds: { minCosineSimilarity: 0.6, minFtsHits: 2 },
    fastAgent: { model: 'MiniMax-M2.7-highspeed', baseURL: 'https://api.minimax.io/anthropic' },
    integrationMode: 'proxy',
    agentId: 'claude-code',
    tenantId: '',
    embeddingModel: 'multilingual-e5-small',
    ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
    ...overrides,
  };
}

test('missing state returns schema-v3 defaults without creating a file', async (t) => {
  const { statePath } = await fixture(t);

  const state = await readProjectState(statePath);

  assert.deepEqual(state, createDefaultProjectState());
  assert.equal(await exists(statePath), false);
  assert.deepEqual(state.activeCatalog, []);
  assert.equal(state.integrationMode, 'proxy');
  assert.deepEqual(state.ui, { portRange: [41_823, 42_823], stack: 'htmx+alpine' });
});

test('first successful store mutation creates the missing project state', async (t) => {
  const { root, statePath } = await fixture(t);
  const store = createProjectStateStore(root);

  const updated = await store.update((current) => ({
    ...current,
    activeCatalog: ['skill-1'],
  }));

  assert.equal(await exists(statePath), true);
  assert.deepEqual(updated.activeCatalog, ['skill-1']);
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')), updated);
});

test('writeProjectState atomically writes a validated normalized state', async (t) => {
  const { statePath } = await fixture(t);
  const state = validState({ activeCatalog: ['rule-1', 'rule-1', 'skill-1'] });

  const written = await writeProjectState(statePath, state);
  const persisted = await readProjectState(statePath);

  assert.equal(written, true);
  assert.deepEqual(persisted.activeCatalog, ['rule-1', 'skill-1']);
  assert.equal(persisted.schemaVersion, 3);
  assert.equal(persisted.embeddingModel, 'multilingual-e5-small');
});

test('valid update preserves unrelated and additive fields while de-duplicating IDs', async (t) => {
  const { root, statePath } = await fixture(t);
  const original = {
    ...validState({ activeCatalog: ['skill-1'] }),
    futureField: { preserve: true },
  };
  await mkdir(join(root, '.memory-studio'), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');
  const store = createProjectStateStore(root);

  const updated = await store.update((current) => ({
    ...current,
    activeCatalog: [...current.activeCatalog, 'skill-1', 'rule-1'],
    thresholds: { ...current.thresholds, minFtsHits: 7 },
  }));
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));

  assert.deepEqual(updated.activeCatalog, ['skill-1', 'rule-1']);
  assert.equal(updated.thresholds.minFtsHits, 7);
  assert.deepEqual(persisted.futureField, { preserve: true });
  assert.deepEqual(persisted.fastAgent, original.fastAgent);
  assert.equal(persisted.agentId, original.agentId);
  assert.deepEqual(persisted.ui, original.ui);
});

test('malformed JSON and unsupported schema are typed conflicts that preserve bytes', async (t) => {
  const { root, statePath } = await fixture(t);
  await mkdir(join(root, '.memory-studio'), { recursive: true });
  const store = createProjectStateStore(root);
  const cases = [
    ['{"schemaVersion":3,', 'MALFORMED_STATE'],
    [JSON.stringify({ ...validState(), schemaVersion: 2 }), 'UNSUPPORTED_SCHEMA'],
  ];

  for (const [bytes, code] of cases) {
    await writeFile(statePath, bytes, 'utf8');
    await assert.rejects(
      () => store.update((current) => current),
      (error) => {
        assert.ok(error instanceof ProjectStateConflictError);
        assert.equal(error.code, code);
        return true;
      },
    );
    assert.equal(await readFile(statePath, 'utf8'), bytes);
  }
});

test('concurrent store updates serialize without lost writes', async (t) => {
  const { root, statePath } = await fixture(t);
  await writeProjectState(statePath, validState());
  const store = createProjectStateStore(root);
  const ids = ['skill-1', 'rule-1', 'persona-1', 'skill-2'];

  await Promise.all(ids.map((id) => store.update((current) => ({
    ...current,
    activeCatalog: [...current.activeCatalog, id],
  }))));
  const persisted = await store.read();

  assert.deepEqual(persisted.activeCatalog, ids);
});

test('rename failure preserves prior bytes and removes temporary residue', async (t) => {
  const { root, statePath } = await fixture(t);
  await writeProjectState(statePath, validState({ activeCatalog: ['before'] }));
  const before = await readFile(statePath, 'utf8');

  await assert.rejects(
    () => writeProjectState(
      statePath,
      validState({ activeCatalog: ['after'] }),
      { rename: async () => { throw new Error('simulated rename failure'); } },
    ),
    (error) => {
      assert.ok(error instanceof ProjectStatePersistenceError);
      assert.equal(error.code, 'STATE_WRITE_FAILED');
      return true;
    },
  );

  assert.equal(await readFile(statePath, 'utf8'), before);
  assert.deepEqual((await readdir(join(root, '.memory-studio'))).filter((name) => name.endsWith('.tmp')), []);
});

test('temp write failure preserves prior bytes and removes partial temporary file', async (t) => {
  const { root, statePath } = await fixture(t);
  await writeProjectState(statePath, validState({ activeCatalog: ['before'] }));
  const before = await readFile(statePath, 'utf8');

  await assert.rejects(
    () => writeProjectState(
      statePath,
      validState({ activeCatalog: ['after'] }),
      {
        open: async (path, flags) => {
          const handle = await open(path, flags);
          return {
            async writeFile() {
              await handle.writeFile('partial', 'utf8');
              throw new Error('simulated write failure');
            },
            sync: () => handle.sync(),
            close: () => handle.close(),
          };
        },
      },
    ),
    (error) => {
      assert.ok(error instanceof ProjectStatePersistenceError);
      assert.equal(error.code, 'STATE_WRITE_FAILED');
      return true;
    },
  );

  assert.equal(await readFile(statePath, 'utf8'), before);
  assert.deepEqual((await readdir(join(root, '.memory-studio'))).filter((name) => name.endsWith('.tmp')), []);
});

test('integrationMode accepts the "cli" enum extension', () => {
  // Pure in-memory check — no filesystem involved.
  const state = validState({ integrationMode: 'cli' });
  assert.doesNotThrow(() => validateProjectState(state));
});

test('integrationMode still rejects unknown values after extension', () => {
  const state = validState({ integrationMode: 'websocket' });
  assert.throws(
    () => validateProjectState(state),
    (error) => {
      assert.ok(error instanceof ProjectStateConflictError);
      assert.equal(error.code, 'INVALID_STATE');
      return true;
    },
  );
});

test('integrationMode "cli" round-trips through atomic write and read', async (t) => {
  const { statePath } = await fixture(t);
  const state = validState({ integrationMode: 'cli' });

  await writeProjectState(statePath, state);
  const persisted = await readProjectState(statePath);

  assert.equal(persisted.integrationMode, 'cli');
});
