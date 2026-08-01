/**
 * Security module barrel (Phase 5b).
 *
 * Re-exports the public surface of `src/server/security/**` so callers
 * (the augment route, the audit lifecycle, the future proxy-allowlist
 * module) can import from a single path. Pure re-exports only.
 */

export { hashTenantId } from './tenant-hash.ts';