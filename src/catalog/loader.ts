/**
 * YAML loader for skill records.
 *
 * Takes a YAML string, validates the surface area (kind / slug / content),
 * computes a stable hash, and returns a SkillRecord ready for the writer.
 *
 * Idempotency invariant: same logical content (slug + kind + content + extras)
 * MUST always produce the same `hash`. We guarantee that by re-serializing
 * the parsed object through a canonical form before hashing.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse, stringify, isMap, isScalar } from 'yaml';
import { LoaderError } from './errors.ts';
import type { RawSkillYaml, SkillKind, SkillRecord } from './types.ts';
import { SLUG_PATTERN, VALID_KINDS } from './types.ts';

/**
 * Canonical YAML serialization. Sorted keys + block style + indent=2 give us
 * a stable byte sequence that is safe to sha256 for idempotency.
 */
export function canonicalYamlString(raw: RawSkillYaml): string {
  // yaml.stringify accepts a JS object; we round-trip through parse to drop
  // any comments or aliases that the user may have included.
  const doc = parse(stringify(raw, { indent: 2 }), { merge: false });
  return stringify(doc, {
    indent: 2,
    sortMapEntries: true,
    lineWidth: 0,
    // Force plain block style for predictable output.
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateKind(raw: unknown, path: string): SkillKind {
  if (typeof raw !== 'string') {
    throw new LoaderError(
      `kind must be a string (one of ${VALID_KINDS.join(', ')})`,
      'INVALID_KIND',
      path,
    );
  }
  // Accept either kebab-case ('rule') or PascalCase ('Rule') for forgiveness,
  // but normalize to lowercase before the membership check.
  const normalized = raw.trim().toLowerCase();
  if (!(VALID_KINDS as readonly string[]).includes(normalized)) {
    throw new LoaderError(
      `kind "${raw}" is not one of ${VALID_KINDS.join(', ')}`,
      'INVALID_KIND',
      path,
    );
  }
  return normalized as SkillKind;
}

function validateSlug(raw: unknown, path: string): string {
  if (typeof raw !== 'string') {
    throw new LoaderError(
      'slug must be a kebab-case string',
      'INVALID_SLUG',
      path,
    );
  }
  // NFC normalize + trim before pattern check.
  const normalized = raw.normalize('NFC').trim();
  if (!SLUG_PATTERN.test(normalized)) {
    throw new LoaderError(
      `slug "${raw}" is not valid kebab-case (^[a-z0-9]+(-[a-z0-9]+)*$)`,
      'INVALID_SLUG',
      path,
    );
  }
  return normalized;
}

function validateContent(raw: unknown, path: string): string {
  if (typeof raw !== 'string') {
    throw new LoaderError(
      'content must be a non-empty string',
      'MISSING_CONTENT',
      path,
    );
  }
  const trimmed = raw.normalize('NFC').trim();
  if (trimmed.length === 0) {
    throw new LoaderError(
      'content must be a non-empty string',
      'MISSING_CONTENT',
      path,
    );
  }
  return trimmed;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Parse and validate a YAML string. `source` is the logical path used for
 * error messages (file path, '<inline>', etc).
 */
export function loadSkillFromString(
  yamlText: string,
  source: string,
): SkillRecord {
  let parsed: unknown;
  try {
    parsed = parse(yamlText, { merge: false });
  } catch (err) {
    throw new LoaderError(
      `YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
      'YAML_PARSE_ERROR',
      source,
    );
  }

  if (!isMap(parsed) && !isPlainObject(parsed)) {
    throw new LoaderError(
      'YAML root must be a mapping (object)',
      'YAML_PARSE_ERROR',
      source,
    );
  }

  // Convert yaml Map -> plain object for easier handling. yaml's Map preserves
  // insertion order; we don't need that here.
  const raw: RawSkillYaml =
    isMap(parsed) && !isPlainObject(parsed)
      ? Object.fromEntries(
          (parsed as unknown as { entries: () => Iterable<[unknown, unknown]> })
            .entries(),
        )
      : (parsed as RawSkillYaml);

  const kind = validateKind(raw.kind, source);
  const slug = validateSlug(raw.slug, source);
  const content = validateContent(raw.content, source);

  // Mutate the raw object before canonicalizing so the canonical YAML is
  // derived from the normalized strings (otherwise an NFD-encoded `content`
  // survives the round-trip and produces a different hash than its NFC twin).
  raw.content = content;
  raw.slug = slug;

  const canonical = canonicalYamlString(raw);
  const hash = sha256Hex(canonical);

  return {
    slug,
    kind,
    content,
    contentYaml: canonical,
    hash,
    // `createdAt` is finalized by the writer on first insert. The loader
    // supplies a placeholder so the record is a complete data shape; the
    // writer overrides it on INSERT and preserves it on UPDATE.
    createdAt: 0,
  };
}

/**
 * Load a skill YAML from disk.
 */
export function loadSkillFromFile(path: string): SkillRecord {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new LoaderError(
      `cannot read YAML at ${path}: ${err instanceof Error ? err.message : String(err)}`,
      'YAML_PARSE_ERROR',
      path,
    );
  }
  return loadSkillFromString(text, path);
}

/**
 * Internal helper exposed for tests: hash a record's content_yaml exactly the
 * way the loader does. Useful for the "hash matches sha256(contentYaml)"
 * spec assertion.
 */
export function hashContentYaml(canonicalYaml: string): string {
  return sha256Hex(canonicalYaml);
}

// `isMap` and `isScalar` are imported to avoid an "unused import" warning
// when the type-narrowing helpers above get tree-shaken in some configs.
void isScalar;