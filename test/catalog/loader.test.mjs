/**
 * CatalogLoader tests (T-10 + T-12).
 *
 * Covers:
 *   T-10 (happy path):
 *     - Insert new items (added count = number of YAMLs)
 *     - Idempotency: re-running on unchanged YAMLs is a no-op
 *     - Modification: changing 1 YAML's `text` produces exactly 1 UPDATE
 *     - Deletion: removing 1 YAML produces exactly 1 DELETE (cascade to
 *       embeddings + vec)
 *     - Skip on invalid YAML: returns { skipped: N }, writes stderr, but
 *       does NOT crash the loader + does NOT leave the DB in a partial state
 *
 *   T-12 (error-path coverage — 7 edge cases from spec):
 *     1. Empty file (0 bytes)
 *     2. Broken YAML syntax (indentation)
 *     3. Conflicting `type` field — single document, well-formed, no conflict
 *        case in discriminated union (Zod rejects unknown types via literal)
 *     4. Duplicate `id` across two files
 *     5. Missing required field (e.g. text: '')
 *     6. `category` outside enum
 *     7. `critical` as string instead of boolean
 *
 * Each loader test uses a deterministic stub embedder (no real model
 * load) and a fresh `:memory:` SQLite database via `openAndMigrate`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { CatalogLoader } from '../../src/catalog/loader.ts';
import { EMBEDDING_DIMENSIONS, MultilingualE5SmallEmbedder } from '../../src/catalog/embedder/index.ts';
import { openAndMigrate } from '../../src/catalog/db/open.ts';

/** Deterministic stub embedder. The same input ALWAYS produces the same
 *  384d vector. Hash input chars modulo 384 dims. */
function makeStubEmbedder() {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async encode(text) {
      const arr = new Float32Array(EMBEDDING_DIMENSIONS);
      // Mix the input chars + their codepoints into a few "anchor" dims
      // and fill the rest with a deterministic hash.
      for (let i = 0; i < text.length && i < EMBEDDING_DIMENSIONS; i += 1) {
        arr[i] = (text.charCodeAt(i) % 97) / 97 - 0.5;
      }
      // Fill any remaining dims with a deterministic but distinct value.
      let seed = 0;
      for (let i = 0; i < text.length; i += 1) {
        seed = ((seed * 31) + text.charCodeAt(i)) >>> 0;
      }
      for (let i = text.length; i < EMBEDDING_DIMENSIONS; i += 1) {
        arr[i] = ((seed + i * 17) % 97) / 97 - 0.5;
      }
      return arr;
    },
    async embed(text) {
      return this.encode(text);
    },
  };
}

/** Open a fresh in-memory catalog DB and apply migrations. */
async function freshDb() {
  return await openAndMigrate(':memory:');
}

/** Create a temp yamlDir and write the given `file -> content` map. */
async function tempDir(files) {
  const dir = await mkdtemp(join(tmpdir(), 'ms-loader-'));
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    await mkdir(join(path, '..'), { recursive: true }).catch(() => undefined);
    await writeFile(path, body, 'utf8');
  }
  return dir;
}

/** Pretty skill YAML body. */
const VALID_SKILL = (id, text) => `id: ${id}
type: skill
title: ${id} title
category: procedural
text: ${text}
`;

const VALID_RULE = (id) => `id: ${id}
type: rule
critical: true
text: Rule body ${id}
`;

const VALID_PERSONA = (id) => `id: ${id}
type: persona
isDefault: true
text: Persona body ${id}
`;

// ---------------------------------------------------------------------------
// T-10 happy-path tests
// ---------------------------------------------------------------------------

test('loader inserts new items on first run', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'auth-jwt-01.yaml': VALID_SKILL('auth-jwt-01', 'JWT validation body'),
    'no-secrets.yaml': VALID_RULE('no-secrets'),
    'concise.yaml': VALID_PERSONA('concise'),
  });
  try {
    const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
    const result = await loader.loadAll();
    assert.equal(result.added, 3);
    assert.equal(result.updated, 0);
    assert.equal(result.deleted, 0);
    assert.equal(result.skipped, 0);

    const catalogCount = db.prepare('SELECT COUNT(*) AS n FROM catalog').get();
    assert.equal(catalogCount.n, 3);
    const embeddingsCount = db.prepare('SELECT COUNT(*) AS n FROM embeddings').get();
    assert.equal(embeddingsCount.n, 3);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loader is idempotent on a re-run (unchanged YAMLs)', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'a.yaml': VALID_SKILL('a', 'first text'),
    'b.yaml': VALID_SKILL('b', 'second text'),
  });
  try {
    const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
    const first = await loader.loadAll();
    assert.equal(first.added, 2);
    assert.equal(first.updated, 0);

    const second = await loader.loadAll();
    assert.equal(second.added, 0, 'no adds on re-run');
    assert.equal(second.updated, 0, 'no updates on re-run');
    assert.equal(second.deleted, 0, 'no deletes on re-run');
    assert.equal(second.skipped, 0);

    const catalogCount = db.prepare('SELECT COUNT(*) AS n FROM catalog').get();
    assert.equal(catalogCount.n, 2);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loader reports exactly 1 UPDATE when one YAML is edited', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'a.yaml': VALID_SKILL('a', 'original text'),
    'b.yaml': VALID_SKILL('b', 'unchanged text'),
  });
  try {
    const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
    await loader.loadAll();

    // Edit `a`'s text — content_hash changes.
    await writeFile(join(dir, 'a.yaml'), VALID_SKILL('a', 'rewritten text'), 'utf8');
    const result = await loader.loadAll();
    assert.equal(result.added, 0);
    assert.equal(result.updated, 1, 'one row updated');
    assert.equal(result.deleted, 0);
    assert.equal(result.skipped, 0);

    // Verify the text in the DB matches the new value.
    const row = db.prepare('SELECT text FROM catalog WHERE id = ?').get('a');
    assert.equal(row.text, 'rewritten text');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loader reports exactly 1 DELETE when one YAML is removed', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'a.yaml': VALID_SKILL('a', 'keep me'),
    'b.yaml': VALID_SKILL('b', 'remove me'),
  });
  try {
    const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
    await loader.loadAll();

    // Remove `b` from disk; loader should DELETE its row + cascade.
    await rm(join(dir, 'b.yaml'));
    const result = await loader.loadAll();
    assert.equal(result.added, 0);
    assert.equal(result.updated, 0);
    assert.equal(result.deleted, 1);
    assert.equal(result.skipped, 0);

    const rows = db.prepare('SELECT id FROM catalog ORDER BY id').all();
    assert.deepEqual(rows.map((r) => r.id), ['a']);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('delete cascades to embeddings + catalog_vec (AC-7)', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'a.yaml': VALID_SKILL('a', 'keep'),
    'b.yaml': VALID_SKILL('b', 'cascade target'),
  });
  try {
    const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
    await loader.loadAll();

    // Both rows must have a vec entry.
    const before = db.prepare('SELECT COUNT(*) AS n FROM catalog_vec').get();
    assert.equal(before.n, 2);

    // Remove b, re-load, expect vec to drop by 1.
    await rm(join(dir, 'b.yaml'));
    await loader.loadAll();
    const after = db.prepare('SELECT COUNT(*) AS n FROM catalog_vec').get();
    assert.equal(after.n, 1, 'cascade delete removed the vec row');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T-10 skip path
// ---------------------------------------------------------------------------

test('loader counts a YAML missing required field as skipped and does NOT add it', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'good.yaml': VALID_SKILL('good', 'OK text'),
    // Missing title and text; will fail Zod validation.
    'bad.yaml': 'id: bad\ntype: skill\ncategory: procedural\n',
  });
  try {
    // Capture stderr to confirm a [WARN] line was emitted.
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    /** @type {any} */
    const capture = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    process.stderr.write = capture;
    try {
      const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
      const result = await loader.loadAll();
      assert.equal(result.added, 1, 'only the good YAML is added');
      assert.equal(result.skipped, 1, 'bad YAML is skipped');
      assert.match(stderrChunks.join(''), /skipped bad\.yaml/);
    } finally {
      process.stderr.write = origWrite;
    }

    const rows = db.prepare('SELECT id FROM catalog').all();
    assert.deepEqual(rows.map((r) => r.id), ['good']);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T-12 error-path coverage — 7 edge cases
// ---------------------------------------------------------------------------

/** All T-12 cases share the same scaffolding: 1 valid + 1 invalid YAML,
 *  loader should add 1 + skip 1, and the valid one must end up in the DB. */
async function runErrorCase({ name, body, expectErrorSubstring = null }) {
  const db = await freshDb();
  const dir = await tempDir({
    'good.yaml': VALID_SKILL('good', 'OK body'),
    [name]: body,
  });
  try {
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    /** @type {any} */
    const capture = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    process.stderr.write = capture;
    try {
      const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
      const result = await loader.loadAll();
      assert.equal(result.added, 1, `${name}: only good.yaml should be added`);
      assert.equal(result.skipped, 1, `${name}: only ${name} should be skipped`);
      const rows = db.prepare('SELECT id FROM catalog').all();
      assert.deepEqual(rows.map((r) => r.id), ['good'], `${name}: DB integrity preserved`);
      if (expectErrorSubstring) {
        assert.match(stderrChunks.join(''), new RegExp(expectErrorSubstring), `${name}: stderr message`);
      }
    } finally {
      process.stderr.write = origWrite;
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('T-12 case 1: empty file is skipped', async () => {
  await runErrorCase({ name: 'empty.yaml', body: '' });
});

test('T-12 case 2: broken YAML syntax is skipped', async () => {
  // Bad indentation — the `yaml` package throws on parse.
  await runErrorCase({
    name: 'broken.yaml',
    body: 'id: skill-1\n  type: skill\n    title: bad indent\n text: x\n',
  });
});

test('T-12 case 3: conflicting type field is skipped', async () => {
  // id present, but type is wrong (PersonaSchema requires `type: persona`).
  await runErrorCase({
    name: 'wrong-type.yaml',
    body: 'id: conf-1\ntype: skill\ntext: body\nisDefault: true\ntitle: x\ncategory: procedural\n',
  });
});

test('T-12 case 4: duplicate id across files -> second file skipped', async () => {
  const db = await freshDb();
  const dir = await tempDir({
    'first.yaml': VALID_SKILL('dup', 'first body'),
    'second.yaml': VALID_SKILL('dup', 'second body with different text'),
  });
  try {
    const stderrChunks = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    /** @type {any} */
    const capture = (chunk) => { stderrChunks.push(String(chunk)); return true; };
    process.stderr.write = capture;
    try {
      const loader = new CatalogLoader(db, makeStubEmbedder(), { yamlDir: dir });
      const result = await loader.loadAll();
      assert.equal(result.added, 1);
      assert.equal(result.skipped, 1);
      assert.match(stderrChunks.join(''), /duplicate id "dup"/);
    } finally {
      process.stderr.write = origWrite;
    }
    // The first occurrence wins (deterministic by sorted filename).
    const row = db.prepare('SELECT text FROM catalog WHERE id = ?').get('dup');
    assert.equal(row.text, 'first body');
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('T-12 case 5: missing required field is skipped', async () => {
  // No `title` field — required for skills.
  await runErrorCase({
    name: 'no-title.yaml',
    body: 'id: missing-1\ntype: skill\ncategory: procedural\ntext: body\n',
  });
});

test('T-12 case 6: category outside enum is skipped', async () => {
  await runErrorCase({
    name: 'bad-category.yaml',
    body: 'id: cat-bad\ntype: skill\ntitle: x\ncategory: totally-not-an-enum\ntext: body\n',
  });
});

test('T-12 case 7: critical as string is skipped', async () => {
  await runErrorCase({
    name: 'bad-critical.yaml',
    body: 'id: rule-crit\ntype: rule\ncritical: "yes"\ntext: body\n',
  });
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

test('loader rejects embedder with wrong dimensions', () => {
  const fakeEmbedder = { dimensions: 100, encode: async () => new Float32Array(0) };
  assert.throws(
    () => new CatalogLoader(/** @type {any} */ ({}), /** @type {any} */ (fakeEmbedder), { yamlDir: '/tmp' }),
    /dimensions must be 384/,
  );
});

test('loader requires yamlDir option', () => {
  assert.throws(
    () => new CatalogLoader(/** @type {any} */ ({}), makeStubEmbedder(), {}),
    /yamlDir is required/,
  );
});
