/**
 * Fingerprint module — public barrel.
 *
 * Phase 2 exposes two functions and two types:
 *   - `hashSha256_16(input)` — the byte-slice hash primitive.
 *   - `fingerprint(input)` — the 4-component provenance builder.
 *   - `FingerprintInput` / `Fingerprint` — locked shapes (PRD §5 + §10.3).
 *
 * Phase 3 (`@memory-studio/sdk` package) will re-export from this barrel
 * with `agentId` pre-bound to `"claude-code"` (PRD §14.4 MVP).
 */

export { hashSha256_16, HASH_HEX_LENGTH } from './hash.ts';
export { fingerprint } from './fingerprint.ts';
export type { Fingerprint, FingerprintInput } from './types.ts';
