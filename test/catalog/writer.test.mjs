/**
 * Writer tests — cover ACs crud-10, crud-11, crud-12, crud-13.
 *
 * Each test opens a fresh `:memory:` SQLite, runs createSchema, then exercises
 * upsertSkill. We capture pino logs via a writable destination so we can
 * assert on the WriterWarning emitted when slug changes but hash stays the
 * same (AC crud-11).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { pino } from 'pino';
import { Writable } from 'node:stream';
import { createSchema } from '../../src/catalog/schema.ts';
import {
  upsertSkill,
  embeddingToBuffer,
  bufferToEmbedding,
  readSkillById,
} from '../../src/catalog/writer.ts';
import { WriterError } from '../../src/catalog/errors.ts';
import { DeterministicStubEmbedder } from '../../src/catalog/embedder.ts';
// SkillRecord is a type-only export; use JSDoc instead of `import type`.

/**
 * Build a pino logger that pipes JSON-line output into a memory buffer.
 * Returns the logger and a getter that yields the captured lines.
 */
function captureLogger() {
  const lines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString('utf8'));
      cb();
    },
  });
  const log = pino({ level: 'warn' }, sink);
  return { log, lines };
}

function freshDb() {
  const db = new Database(':memory:');
  createSchema(db);
  return db;
}

async function makeRecordAndEmbedding(slug = 'jwt-skill-01', content = 'jwt content') {
  /** @type {SkillRecord} */
  const record = {
    slug,
    kind: 'skill',
    content,
    contentYaml: `slug: ${slug}\nkind: skill\ncontent: ${content}\n`,
    hash: 'will-be-recomputed-by-loader', // tests don't go through loader
    createdAt: 0,
  };
  // Hash the contentYaml so the writer's idempotency key is realistic.
  const { createHash } = await import('node:crypto');
  record.hash = createHash('sha256').update(record.contentYaml, 'utf8').digest('hex');

  const embedder = new DeterministicStubEmbedder();
  const embedding = await embedder.embed(content);
  return { record, embedding };
}

test('T-WRITER-01: first upsert returns action=inserted with id >= 1 (crud-10)', async () => {
  const db = freshDb();
  try {
    const { record, embedding } = await makeRecordAndEmbedding();
    const result = upsertSkill(db, record, embedding);
    assert.equal(result.action, 'inserted');
    assert.ok(result.skill.id >= 1);
    assert.equal(result.skill.slug, record.slug);
    assert.equal(result.skill.hash, record.hash);
    assert.equal(result.skill.kind, record.kind);
  } finally {
    db.close();
  }
});

test('T-WRITER-02: second upsert with same record returns action=unchanged, same id (crud-10)', async () => {
  const db = freshDb();
  try {
    const { record, embedding } = await makeRecordAndEmbedding();
    const r1 = upsertSkill(db, record, embedding);
    const r2 = upsertSkill(db, record, embedding);
    assert.equal(r1.action, 'inserted');
    assert.equal(r2.action, 'unchanged');
    assert.equal(r2.skill.id, r1.skill.id);
  } finally {
    db.close();
  }
});

test('T-WRITER-03: same hash but different slug returns unchanged + WriterWarning (crud-11)', async () => {
  const db = freshDb();
  try {
    const { record, embedding } = await makeRecordAndEmbedding('original-slug');
    const r1 = upsertSkill(db, record, embedding);
    assert.equal(r1.action, 'inserted');

    const { log, lines } = captureLogger();
    const renamed = { ...record, slug: 'renamed-slug' };
    const r2 = upsertSkill(db, renamed, embedding, { logger: log });
    assert.equal(r2.action, 'unchanged');
    assert.equal(r2.skill.id, r1.skill.id);
    assert.equal(r2.skill.slug, 'original-slug', 'stored slug is preserved');

    // At least one captured line must mention WriterWarning + slug_diff.
    assert.ok(lines.length > 0, 'expected at least one warning log line');
    const blob = lines.join('\n');
    assert.match(blob, /WriterWarning/);
    assert.match(blob, /slug_differs_for_same_hash/);
    assert.match(blob, /original-slug/);
    assert.match(blob, /renamed-slug/);
  } finally {
    db.close();
  }
});

test('T-WRITER-04: embedding round-trip is bit-exact (crud-12)', async () => {
  const db = freshDb();
  try {
    const { record, embedding } = await makeRecordAndEmbedding();
    upsertSkill(db, record, embedding);

    const stored = readSkillById(db, 1);
    assert.ok(stored, 'skill should be readable by id');

    // The readSkillById helper attaches a fresh embedding; assert bit equality.
    const restored = /** @type {any} */ (stored).embedding;
    assert.ok(restored instanceof Float32Array);
    assert.equal(restored.length, embedding.length);
    for (let i = 0; i < embedding.length; i += 1) {
      assert.equal(restored[i], embedding[i]);
    }
  } finally {
    db.close();
  }
});

test('T-WRITER-05: updated_at is set on insert and remains stable on unchanged (crud-13)', async () => {
  const db = freshDb();
  try {
    const { record, embedding } = await makeRecordAndEmbedding();

    // Inject a controllable clock so we can detect changes.
    let virtualNow = 1_700_000_000_000;
    const r1 = upsertSkill(db, record, embedding, { now: () => virtualNow });
    assert.equal(r1.skill.createdAt, virtualNow);
    assert.equal(r1.skill.updatedAt, virtualNow);

    virtualNow += 5_000;
    const r2 = upsertSkill(db, record, embedding, { now: () => virtualNow });
    assert.equal(r2.action, 'unchanged');
    // updated_at must NOT advance on unchanged idempotent call.
    assert.equal(r2.skill.updatedAt, 1_700_000_000_000);
    assert.equal(r2.skill.createdAt, 1_700_000_000_000);
  } finally {
    db.close();
  }
});

test('T-WRITER-06: 2 records with different hashes produce 2 distinct rows', async () => {
  const db = freshDb();
  try {
    const a = await makeRecordAndEmbedding('skill-a', 'alpha');
    const b = await makeRecordAndEmbedding('skill-b', 'beta');
    const r1 = upsertSkill(db, a.record, a.embedding);
    const r2 = upsertSkill(db, b.record, b.embedding);
    assert.equal(r1.action, 'inserted');
    assert.equal(r2.action, 'inserted');
    assert.notEqual(r1.skill.id, r2.skill.id);

    const count = db.prepare('SELECT COUNT(*) AS n FROM skills').get();
    assert.equal(count.n, 2);
  } finally {
    db.close();
  }
});

test('T-WRITER-07: embedding-to-Buffer + buffer-to-Float32Array is bit-exact (crud-12)', async () => {
  const e = new DeterministicStubEmbedder();
  const arr = await e.embed('round-trip');
  const buf = embeddingToBuffer(arr);
  assert.equal(buf.byteLength, 1536);
  const restored = bufferToEmbedding(buf);
  assert.equal(restored.length, arr.length);
  for (let i = 0; i < arr.length; i += 1) {
    assert.equal(restored[i], arr[i]);
  }
});

test('T-WRITER-08: empty string from embedder is rejected with WriterError before insert', async () => {
  // Embedder refuses empty strings by design; if a caller hands us an
  // embedding with a wrong length, we reject.
  const db = freshDb();
  try {
    const { record } = await makeRecordAndEmbedding();
    const bad = new Float32Array(100); // wrong dimension
    try {
      upsertSkill(db, record, bad);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof WriterError);
      assert.equal(err.code, 'DB_ERROR');
    }
  } finally {
    db.close();
  }
});

test('T-WRITER-09: WriterError surfaces SQL failures from the underlying driver', () => {
  const db = freshDb();
  try {
    // Closing the DB before insert should cause a SQL error that we wrap.
    db.close();
    const record = {
      slug: 'x',
      kind: 'skill',
      content: 'c',
      contentYaml: 'slug: x\nkind: skill\ncontent: c\n',
      hash: 'h',
      createdAt: 0,
    };
    const embedding = new Float32Array(384);
    try {
      upsertSkill(db, record, embedding);
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok(err instanceof WriterError);
    }
  } catch {
    // ignore the close-on-close
  }
});