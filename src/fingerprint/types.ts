/**
 * Fingerprint types — Phase 2.
 *
 * Locks the public shape of the SDK provenance object (PRD §5 + ROADMAP
 * Phase 2 done #3). The 4-component shape (`projectPath`, `agentId`,
 * `sessionId`, `gitBranch`) is the SDK boundary contract:
 *
 *   - `projectPath`, `agentId`, `gitBranch` pass through unchanged.
 *   - `sessionId` is REPLACED by `hashSha256_16(sessionId)` before the
 *     function returns — the raw sessionId NEVER leaves the SDK boundary
 *     (PRD §10.3 item 1: zero raw persistence).
 *
 * The Phase 3 SDK package (`@memory-studio/sdk`) re-exports `fingerprint`
 * with `agentId` pre-bound to `"claude-code"` (PRD §14.4 MVP-hardcoded),
 * but Phase 2 keeps `agentId` as a required parameter so the SDK layer
 * has the freedom to bind or pass through.
 */

export interface FingerprintInput {
  /** Absolute path to the project being fingerprinted (e.g., `process.cwd()`). */
  projectPath: string;
  /** Identifier of the calling agent (MVP: hardcoded `"claude-code"` per PRD §14.4). */
  agentId: string;
  /**
   * Raw session identifier supplied by the calling code. **NEVER persisted**:
   * `fingerprint()` hashes this value before returning it in the result.
   */
  sessionId: string;
  /** Git branch in use (typically collected via `git rev-parse --abbrev-ref HEAD`). */
  gitBranch: string;
}

export interface Fingerprint {
  /** Pass-through of `input.projectPath`. */
  projectPath: string;
  /** Pass-through of `input.agentId`. */
  agentId: string;
  /**
   * 32-char lowercase hex of `sha256[0:16](input.sessionId)` —
   * the raw sessionId NEVER appears in this field.
   */
  sessionId: string;
  /** Pass-through of `input.gitBranch`. */
  gitBranch: string;
}
