/**
 * Fingerprint function — Phase 2.
 *
 * `fingerprint(input)` returns a 4-component provenance object whose
 * `sessionId` field is the **first 16 bytes of SHA-256** of the raw
 * sessionId (32-char lowercase hex, via `hashSha256_16`). The raw
 * sessionId NEVER appears in the return value — this is the SDK-side
 * guard for PRD §10.3 item 1 (zero raw persistence of sessionId) and
 * PRD §5 (SDK contract).
 *
 * The function is `async` to leave room for future extensions (e.g.,
 * resolving `gitBranch` via shell when not provided). The current
 * implementation is synchronous internally — `Promise.resolve(result)`
 * preserves the contract without adding artificial latency.
 *
 * Per R-08 / AC-6: signature is the lock contract for Phase 3's
 * `@memory-studio/sdk` re-export. `agentId` is a required parameter
 * (the SDK pre-binds it to `"claude-code"` per PRD §14.4 MVP).
 */

import { hashSha256_16 } from './hash.ts';
import type { Fingerprint, FingerprintInput } from './types.ts';

/**
 * Builds a 4-component provenance object from the SDK caller context.
 *
 * @param input - Caller-supplied `{ projectPath, agentId, sessionId, gitBranch }`.
 * @returns A `Promise<Fingerprint>` whose `sessionId` is the hash of the
 *          raw input sessionId (the raw value never appears in the result).
 */
export async function fingerprint(input: FingerprintInput): Promise<Fingerprint> {
  const result: Fingerprint = {
    projectPath: input.projectPath,
    agentId: input.agentId,
    sessionId: hashSha256_16(input.sessionId),
    gitBranch: input.gitBranch,
  };
  return Promise.resolve(result);
}
