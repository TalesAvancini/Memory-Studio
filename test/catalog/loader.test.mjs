/**
 * Loader tests — cover ACs crud-04, crud-05, crud-06.
 *
 * The fixture YAMLs are small inline strings rather than committed files so
 * the test surface is self-contained. The committed fixture
 * `config/skills/example-jwt-01.yaml` is exercised by the CLI tests in T7.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import {
  loadSkillFromString,
  loadSkillFromFile,
  canonicalYamlString,
  hashContentYaml,
} from '../../src/catalog/loader.ts';
import { LoaderError } from '../../src/catalog/errors.ts';
import { VALID_KINDS } from '../../src/catalog/types.ts';

const VALID_YAML = [
  'slug: auth-jwt-01',
  'kind: skill',
  'content: How to validate JWT tokens in TypeScript.',
  '',
].join('\n');

function assertLoaderCode(err, expectedCode) {
  assert.ok(
    err instanceof LoaderError,
    `expected LoaderError, got ${err?.constructor?.name}`,
  );
  assert.equal(err.code, expectedCode);
}

test('T-LOADER-01: valid YAML returns a SkillRecord with the expected fields', () => {
  const record = loadSkillFromString(VALID_YAML, '<inline>');
  assert.equal(record.slug, 'auth-jwt-01');
  assert.equal(record.kind, 'skill');
  assert.equal(record.content, 'How to validate JWT tokens in TypeScript.');
  assert.equal(typeof record.hash, 'string');
  assert.equal(record.hash.length, 64, 'sha256 hex is 64 chars');
  assert.equal(record.contentYaml.length > 0, true);
});

test('T-LOADER-02: invalid kind throws LoaderError(INVALID_KIND)', () => {
  const yaml = ['slug: x', 'kind: nonsense', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_KIND');
  }
});

test('T-LOADER-03a: uppercase slug throws LoaderError(INVALID_SLUG)', () => {
  const yaml = ['slug: Auth-JWT', 'kind: skill', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_SLUG');
  }
});

test('T-LOADER-03b: snake_case slug throws LoaderError(INVALID_SLUG)', () => {
  const yaml = ['slug: auth_jwt', 'kind: skill', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_SLUG');
  }
});

test('T-LOADER-03c: leading-dash slug throws LoaderError(INVALID_SLUG)', () => {
  const yaml = ['slug: -auth', 'kind: skill', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_SLUG');
  }
});

test('T-LOADER-04: missing content throws LoaderError(MISSING_CONTENT)', () => {
  const yaml = ['slug: x', 'kind: skill', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'MISSING_CONTENT');
  }
});

test('T-LOADER-04b: empty content throws LoaderError(MISSING_CONTENT)', () => {
  const yaml = ['slug: x', 'kind: skill', 'content: "   "', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'MISSING_CONTENT');
  }
});

test('T-LOADER-05: malformed YAML throws LoaderError(YAML_PARSE_ERROR)', () => {
  // Unmatched bracket is a parse error.
  const bad = ['slug: x', 'kind: [unclosed', ''].join('\n');
  try {
    loadSkillFromString(bad, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'YAML_PARSE_ERROR');
  }
});

test('T-LOADER-06: extra fields are preserved in contentYaml (crud-05)', () => {
  const yaml = [
    'slug: extra-fields-01',
    'kind: rule',
    'content: Always run lint before committing.',
    'extra:',
    '  tags:',
    '    - workflow',
    '    - lint',
    'references:',
    '  - https://example.com/lint',
    '',
  ].join('\n');
  const record = loadSkillFromString(yaml, '<inline>');
  assert.equal(record.kind, 'rule');
  // The canonical YAML must contain the extra fields.
  assert.match(record.contentYaml, /extra:/);
  assert.match(record.contentYaml, /references:/);
  assert.match(record.contentYaml, /workflow/);
  assert.match(record.contentYaml, /example\.com\/lint/);
});

test('T-LOADER-07: hash equals sha256(contentYaml) and slug is NFC+trim normalized (crud-06)', () => {
  // The slug pattern is ASCII-only (per design.md), but NFC normalization
  // still applies to all string inputs. Use leading/trailing whitespace +
  // an ASCII slug to verify the normalization pipeline.
  const yaml = [
    'slug: "  auth-jwt-01  "',
    'kind: skill',
    'content: NFC normalization works.',
    '',
  ].join('\n');
  const record = loadSkillFromString(yaml, '<inline>');

  assert.equal(record.slug, 'auth-jwt-01', 'slug is NFC + trim normalized');

  const expectedHash = createHash('sha256')
    .update(record.contentYaml, 'utf8')
    .digest('hex');
  assert.equal(record.hash, expectedHash);
  assert.equal(record.hash, hashContentYaml(record.contentYaml));
});

test('T-LOADER-07b: NFC normalization on `content` makes NFD/NFC inputs hash-equal', () => {
  // Construct NFD ('e' + U+0301) at runtime so file-encoding can't pre-merge
  // the combining mark.
  const nfd = 'cafe' + String.fromCodePoint(0x0301);
  const nfc = nfd.normalize('NFC');
  assert.notEqual(nfd, nfc, 'sanity: NFD != NFC for combined marks');

  const yamlA = `slug: a\nkind: skill\ncontent: "${nfd}"\n`;
  const yamlB = `slug: a\nkind: skill\ncontent: "${nfc}"\n`;
  const rA = loadSkillFromString(yamlA, '<inline>');
  const rB = loadSkillFromString(yamlB, '<inline>');

  assert.equal(rA.content, nfc);
  assert.equal(rB.content, nfc);
  assert.equal(rA.contentYaml, rB.contentYaml);
  assert.equal(rA.hash, rB.hash);
});

test('T-LOADER-08: rule and persona kinds are accepted', () => {
  for (const kind of VALID_KINDS) {
    const yaml = [
      `slug: kind-${kind}`,
      `kind: ${kind}`,
      `content: ${kind} content`,
      '',
    ].join('\n');
    const record = loadSkillFromString(yaml, '<inline>');
    assert.equal(record.kind, kind);
  }
});

test('T-LOADER-09: round-trip load+serialize+load produces same hash', () => {
  const r1 = loadSkillFromString(VALID_YAML, '<inline>');
  // Simulate what a caller might do: persist record fields, re-build YAML,
  // re-load. Hash must match because canonical YAML is key-sorted.
  const rebuilt = [
    `slug: "${r1.slug}"`,
    `kind: ${r1.kind}`,
    `content: ${r1.content}`,
    '',
  ].join('\n');
  const r2 = loadSkillFromString(rebuilt, '<inline>');
  assert.equal(r2.hash, r1.hash);
});

test('T-LOADER-10: loadSkillFromFile reads disk and reports path in errors', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-loader-'));
  const filePath = join(dir, 'skill.yaml');
  try {
    writeFileSync(filePath, VALID_YAML, 'utf8');
    const record = loadSkillFromFile(filePath);
    assert.equal(record.slug, 'auth-jwt-01');

    // Bad kind in a real file should carry the file path.
    writeFileSync(
      filePath,
      ['slug: bad', 'kind: bogus', 'content: c', ''].join('\n'),
      'utf8',
    );
    try {
      loadSkillFromFile(filePath);
      assert.fail('should have thrown');
    } catch (err) {
      assertLoaderCode(err, 'INVALID_KIND');
      assert.equal(err.path, filePath);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T-LOADER-11: loadSkillFromFile reports IO failures with the file path', () => {
  try {
    loadSkillFromFile('/nonexistent/path/does-not-exist.yaml');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'YAML_PARSE_ERROR');
    assert.match(err.path, /does-not-exist\.yaml/);
  }
});

test('T-LOADER-12: canonicalYamlString sorts keys deterministically', () => {
  const a = canonicalYamlString({ b: 1, a: 2, c: 3 });
  const b = canonicalYamlString({ c: 3, a: 2, b: 1 });
  assert.equal(a, b);
});

test('T-LOADER-13: non-string kind throws LoaderError(INVALID_KIND)', () => {
  const yaml = ['slug: x', 'kind: 42', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_KIND');
  }
});

test('T-LOADER-14: non-string slug throws LoaderError(INVALID_SLUG)', () => {
  const yaml = ['slug: 99', 'kind: skill', 'content: hi', ''].join('\n');
  try {
    loadSkillFromString(yaml, '<inline>');
    assert.fail('should have thrown');
  } catch (err) {
    assertLoaderCode(err, 'INVALID_SLUG');
  }
});

test('T-LOADER-15: YAML root must be a mapping, not a scalar or array', () => {
  const scalarYaml = 'just a string\n';
  try {
    loadSkillFromString(scalarYaml, '<inline>');
    assert.fail('should have thrown on scalar root');
  } catch (err) {
    assertLoaderCode(err, 'YAML_PARSE_ERROR');
  }

  const arrayYaml = ['- one', '- two', ''].join('\n');
  try {
    loadSkillFromString(arrayYaml, '<inline>');
    assert.fail('should have thrown on array root');
  } catch (err) {
    assertLoaderCode(err, 'YAML_PARSE_ERROR');
  }
});