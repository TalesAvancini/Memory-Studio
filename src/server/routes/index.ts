/**
 * Routes module barrel (Phase 5b).
 *
 * Re-exports the public surface of `src/server/routes/**`. Pure
 * re-exports — no logic.
 */

export { registerCatalogListRoute } from './catalog.ts';
export { registerCatalogRebuildRoute } from './catalog-rebuild.ts';
export {
  registerAuditListRoute,
  registerAuditSummaryRoute,
} from './audit.ts';