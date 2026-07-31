/**
 * Catalog schema version (Phase 1.3 T-11).
 *
 * Exposes the constant `CATALOG_SCHEMA_VERSION` (and a typed accessor
 * `getCatalogSchemaVersion()`) for downstream phases that need to read
 * the schema version — Phase 1.4 build-index CLI prints it; Phase 5's
 * `GET /catalog` response embeds it as `schemaVersion: <number>`.
 *
 * Version policy (PLAN §16.4 M2):
 *   - `MAJOR` bump on breaking schema changes (column type, PK change,
 *     rename, remove). Phase 1 ships version `3` per PRD §6.4
 *     (predecessors 1 + 2 were the calibration residue eras).
 *   - `MINOR` bump on additive, non-breaking changes (new nullable column,
 *     new index, new optional table).
 *
 * This constant is the single source of truth at compile time. The
 * `schema_migrations` table stores the applied-version history
 * independently at runtime; both MUST agree for a healthy DB
 * (`.specs/STATE.md` flags drift between the two as `quarantined`).
 */

/** PRD v3.4 schema. Phase 1 ships this version; bump on breaking changes. */
export const CATALOG_SCHEMA_VERSION = 3 as const;

/**
 * Typed accessor for downstream phases (Phase 5 search suite, future
 * SDK packages). Returns the literal `3`; type-as-const narrows the
 * return type so consumers can rely on a precise number.
 */
export function getCatalogSchemaVersion(): number {
  return CATALOG_SCHEMA_VERSION;
}
