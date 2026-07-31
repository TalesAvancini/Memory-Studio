/**
 * SHA-256 byte-string + canonical JSON serialization.
 *
 * Phase 5a.2 (T-08) — provides the determinism primitives for the
 * `/augment` system message. The `systemMessage` field in the response
 * is the SHA-256 hex digest of the EXACT 2-block structure that would
 * be sent to Anthropic, marked `cache_control: ephemeral` on both blocks.
 *
 * Determinism rules (D-006):
 *   1. Field keys are sorted recursively before serialization
 *      (the standard JSON canonicalization form). Without this,
 *      `{a:1,b:2}` and `{b:2,a:1}` would produce different hashes.
 *   2. Whitespace is stripped (no `JSON.stringify(x, null, 2)`).
 *   3. UTF-8 NFC normalization is applied to string leaves so accented
 *      characters produce the same byte sequence across runs.
 *   4. Hash input is the canonical string, encoded as UTF-8, then hashed
 *      via `node:crypto.createHash('sha256')`.
 *
 * The function is pure — no global state, no I/O — so it can be reused
 * for the tiebreak stress test (1000 requests → same hash).
 */

import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys for stable, deterministic JSON
 * serialization. Arrays preserve their order (intentional — the matched
 * item array is already tiebreak-sorted upstream).
 */
function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => sortKeysDeep(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted as T;
  }
  return value;
}

/**
 * Serialize a value as canonical JSON: stable key order, no whitespace,
 * UTF-8 NFC-normalized string leaves.
 *
 * This is the canonicalization form used for the byte-string hash. It
 * is NOT a general-purpose JSON serializer (no replacer, no indent
 * support); use `JSON.stringify` directly for those.
 */
export function canonicalJsonStringify(value: unknown): string {
  const sorted = sortKeysDeep(value);
  // `JSON.stringify` on a plain object with sorted keys already produces
  // a deterministic output for our domain (string / number / boolean /
  // null / array / plain object leaves). The NFC normalization on string
  // leaves ensures accented characters compare equal across hosts.
  return JSON.stringify(sorted, replacerNfc, '');
}

function replacerNfc(_key: string, val: unknown): unknown {
  if (typeof val === 'string') {
    return val.normalize('NFC');
  }
  return val;
}

/**
 * Compute the SHA-256 hex digest of a UTF-8 string. The output is the
 * 64-character lowercase hex form (matching the Anthropic cache key
 * convention and the SPEC §IMod-7 step 8 contract).
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Convenience: canonical JSON → SHA-256 hex. The single-line entry
 * point used by the augmenter when building the `systemMessage` field.
 */
export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}
