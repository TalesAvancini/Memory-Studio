/**
 * TenantId hashing (PRD 10.3.2).
 *
 * The canonical helper is the `hashTenantId()` function extracted
 * verbatim from `src/server/augment.ts:51-54` (Phase 5a.1). Phase 5b
 * moves the helper to `src/server/security/tenant-hash.ts` so it can
 * be re-used across all 7 endpoints (audit, logs, /audit response).
 * The Phase 5a call site continues to work via a re-export.
 *
 * Hash strategy:
 *   - sha256(tenantId, 'utf8') → 64 hex chars
 *   - truncate to first 16 hex chars (sha256[0:16])
 *
 * Why truncate? 16 hex chars = 64 bits = 2^64 namespace, which is
 * collision-safe for the per-tenant cardinality Memory Studio
 * targets. Truncation also keeps the column narrow enough to index
 * efficiently.
 *
 * Returns `null` for undefined / null / empty input — the audit row
 * stores `NULL` in `tenantId_hashed` rather than a placeholder hash.
 */

import { createHash } from 'node:crypto';

export function hashTenantId(
  tenantId: string | undefined | null,
): string | null {
  if (!tenantId) return null;
  return createHash('sha256').update(tenantId, 'utf8').digest('hex').slice(0, 16);
}