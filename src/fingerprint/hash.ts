/**
 * Hash primitive — Phase 2.
 *
 * `hashSha256_16(input)` returns the first **16 BYTES** of the SHA-256
 * digest of `input` (UTF-8 encoded) as a 32-character lowercase hex string.
 * The `sha256[0:16]` notation in PRD §8 is Python-style byte slicing on
 * the raw digest; the ROADMAP Phase 2 done #4 criterion is "32-char hex"
 * which matches `bytes[0:16].hex()` in Python or
 * `digest.subarray(0, 16).toString('hex')` in Node.
 *
 * Use cases (Phase 2 scope):
 *   - `fingerprint()` hashes `sessionId` before it leaves the SDK boundary
 *     (PRD §10.3 item 1 — zero raw persistence).
 *   - Phase 5b will hash `tenantId` for the same reason (PRD §10.3 item 2).
 *
 * Implementation constraint (R-07 / AC-14): Node 22 built-in `node:crypto`
 * ONLY — no npm dependencies added.
 */

import { createHash } from 'node:crypto';

/** Length of the returned hex string (16 bytes * 2 hex chars/byte = 32 chars). */
export const HASH_HEX_LENGTH = 32;

/**
 * Returns the first 16 bytes of SHA-256(input) as a 32-char lowercase hex string.
 *
 * @param input - Arbitrary string (UTF-8 encoded before hashing).
 * @returns 32-character lowercase hex string (deterministic, side-effect-free).
 */
export function hashSha256_16(input: string): string {
  const digest = createHash('sha256').update(input, 'utf8').digest();
  return digest.subarray(0, 16).toString('hex');
}
