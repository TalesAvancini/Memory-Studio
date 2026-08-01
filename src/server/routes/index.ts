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
export { registerStateToggleRoute } from './state-toggle.ts';
export { registerMessagesProxyRoute, readUpstreamUrl } from './messages-proxy.ts';
export { registerMetricsRoute } from './metrics.ts';