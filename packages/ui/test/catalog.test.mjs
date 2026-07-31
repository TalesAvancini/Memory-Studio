import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CatalogUnavailableError,
  createEmptyCatalogReader,
  createFileSystemCatalogReader,
} from '@memory-studio/ui';

const SKILL_YAML = [
  'id: skill-jwt-validation',
  'type: skill',
  'title: JWT Validation',
  'category: procedural',
  'text: |',
  '  Validates JWT tokens issued by a trusted authority.',
  '',
].join('\n');

const SKILL_TWO_YAML = [
  'id: skill-another',
  'type: skill',
  'title: Another Skill',
  'category: diagnostic',
  'text: Diagnostic content here.',
  '',
].join('\n');

const RULE_YAML = [
  'id: rule-no-secrets',
  'type: rule',
  'critical: true',
  'text: |',
  '  Never commit secrets or API keys to git.',
  '',
].join('\n');

const RULE_NON_CRITICAL_YAML = [
  'id: rule-doc-snippets',
  'type: rule',
  'critical: false',
  'text: Prefer small documented snippets.',
  '',
].join('\n');

const PERSONA_YAML = [
  'id: persona-concise',
  'type: persona',
  'isDefault: true',
  'text: Respond concisely.',
  '',
].join('\n');

const PERSONA_TWO_YAML = [
  'id: persona-pragmatic',
  'type: persona',
  'isDefault: false',
  'text: Be a pragmatic engineer.',
  '',
].join('\n');

async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-catalog-'));
  const yamlDir = join(root, 'catalog');
  await mkdir(yamlDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(yamlDir, name), content, 'utf8');
  }
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, yamlDir };
}

test('filesystem reader returns deterministic alphabetical order across files', async (t) => {
  const { yamlDir } = await fixture(t, {
    'a-skill-two.yaml': SKILL_TWO_YAML,
    'b-rule.yaml': RULE_YAML,
    'c-persona-pragmatic.yaml': PERSONA_TWO_YAML,
    'd-persona-concise.yaml': PERSONA_YAML,
  });

  const reader = createFileSystemCatalogReader(yamlDir);
  const items = await reader.list();

  // IDs are sorted alphabetically regardless of on-disk filename.
  assert.deepEqual(
    items.map((item) => item.id),
    [
      'persona-concise',
      'persona-pragmatic',
      'rule-no-secrets',
      'skill-another',
    ],
  );
});

test('filesystem reader resolves a Skill record with title and category', async (t) => {
  const { yamlDir } = await fixture(t, { 'skill.yaml': SKILL_YAML });

  const reader = createFileSystemCatalogReader(yamlDir);
  const item = await reader.get('skill-jwt-validation');

  assert.deepEqual(item, {
    id: 'skill-jwt-validation',
    type: 'skill',
    title: 'JWT Validation',
    category: 'procedural',
    text: 'Validates JWT tokens issued by a trusted authority.\n',
  });
});

test('filesystem reader resolves a critical Rule', async (t) => {
  const { yamlDir } = await fixture(t, { 'rule.yaml': RULE_YAML });

  const reader = createFileSystemCatalogReader(yamlDir);
  const item = await reader.get('rule-no-secrets');

  assert.deepEqual(item, {
    id: 'rule-no-secrets',
    type: 'rule',
    critical: true,
    text: 'Never commit secrets or API keys to git.\n',
  });
});

test('filesystem reader resolves a non-critical Rule with critical:false', async (t) => {
  const { yamlDir } = await fixture(t, { 'rule.yaml': RULE_NON_CRITICAL_YAML });

  const reader = createFileSystemCatalogReader(yamlDir);
  const item = await reader.get('rule-doc-snippets');

  assert.equal(item?.type, 'rule');
  assert.equal(item?.critical, false);
  assert.match(item?.text ?? '', /Prefer small documented snippets\./);
});

test('filesystem reader resolves a Persona with isDefault flag', async (t) => {
  const { yamlDir } = await fixture(t, { 'persona.yaml': PERSONA_YAML });

  const reader = createFileSystemCatalogReader(yamlDir);
  const item = await reader.get('persona-concise');

  assert.deepEqual(item, {
    id: 'persona-concise',
    type: 'persona',
    isDefault: true,
    text: 'Respond concisely.',
  });
});

test('filesystem reader returns undefined for unknown item id', async (t) => {
  const { yamlDir } = await fixture(t, { 'rule.yaml': RULE_YAML });

  const reader = createFileSystemCatalogReader(yamlDir);

  assert.equal(await reader.get('rule-does-not-exist'), undefined);
});

test('filesystem reader silently skips malformed entries', async (t) => {
  const { yamlDir } = await fixture(t, {
    'good.yaml': RULE_YAML,
    'bad-missing-id.yaml': 'type: rule\ncritical: true\ntext: no id here\n',
    'bad-missing-text.yaml': 'id: rule-no-text\ntype: rule\n',
    'bad-wrong-type.yaml': 'id: weird-thing\ntype: weirdsnippet\ntext: unknown type\n',
    'bad-skill-missing-title.yaml': 'id: skill-notitle\ntype: skill\ncategory: procedural\ntext: missing title\n',
  });

  const reader = createFileSystemCatalogReader(yamlDir);
  const items = await reader.list();

  assert.deepEqual(items.map((item) => item.id), ['rule-no-secrets']);
});

test('filesystem reader ignores empty YAML files', async (t) => {
  const { yamlDir } = await fixture(t, {
    'rule.yaml': RULE_YAML,
    'empty.yaml': '',
  });

  const reader = createFileSystemCatalogReader(yamlDir);
  const items = await reader.list();

  assert.deepEqual(items.map((item) => item.id), ['rule-no-secrets']);
});

test('filesystem reader throws CatalogUnavailableError when directory is missing', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-catalog-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const reader = createFileSystemCatalogReader(join(root, 'does-not-exist'));

  await assert.rejects(
    () => reader.list(),
    (error) => {
      assert.ok(error instanceof CatalogUnavailableError);
      assert.equal(error.code, 'CATALOG_UNAVAILABLE');
      assert.match(error.message, /does-not-exist/);
      return true;
    },
  );
});

test('filesystem reader throws CatalogUnavailableError on malformed YAML syntax', async (t) => {
  const { yamlDir } = await fixture(t, {
    // Unterminated flow sequence — YAML 1.2 strict parse error.
    'broken.yaml': 'id: rule-no-secrets\ntype: rule\ncritical: true\ntext: [\n',
  });

  const reader = createFileSystemCatalogReader(yamlDir);

  await assert.rejects(
    () => reader.list(),
    (error) => {
      assert.ok(error instanceof CatalogUnavailableError);
      assert.equal(error.code, 'CATALOG_UNAVAILABLE');
      assert.match(error.message, /broken\.yaml/);
      return true;
    },
  );
});

test('filesystem reader caches the directory listing across repeated calls', async (t) => {
  const { yamlDir } = await fixture(t, { 'rule.yaml': RULE_YAML });
  let readdirCalls = 0;
  const reader = createFileSystemCatalogReader(yamlDir, {
    fileSystem: {
      readdir: async (path) => {
        readdirCalls += 1;
        return readdir(path);
      },
    },
  });

  await reader.list();
  await reader.list();
  await reader.get('rule-no-secrets');

  assert.equal(readdirCalls, 1, 'readdir must be called exactly once across calls');
});

test('empty catalog reader returns no items', async () => {
  const reader = createEmptyCatalogReader();

  assert.deepEqual(await reader.list(), []);
  assert.equal(await reader.get('anything'), undefined);
});

test('empty catalog reader returns injected items in deterministic order', async () => {
  const reader = createEmptyCatalogReader([
    { id: 'rule-b', type: 'rule', critical: true, text: 'B' },
    { id: 'rule-a', type: 'rule', critical: false, text: 'A' },
    { id: 'skill-a', type: 'skill', title: 'A', category: 'procedural', text: 'A' },
  ]);

  const items = await reader.list();

  assert.deepEqual(
    items.map((item) => item.id),
    ['rule-a', 'rule-b', 'skill-a'],
  );
  assert.equal((await reader.get('rule-b'))?.critical, true);
});
