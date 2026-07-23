/**
 * Memory Studio — entry point.
 * Re-exports the public surface of each domain so downstream consumers can
 * `import { ... } from 'memory-studio'` once we publish the package.
 *
 * Per-domain barrels (e.g. `./catalog/index.ts`) are still preferred for
 * tree-shaking; this top-level barrel is just for discoverability.
 */

export const VERSION = '0.0.0';

export function placeholder(): string {
  return `Memory Studio v${VERSION} — scaffold`;
}

// Catalog domain (Phase 2): schema, loader, embedder, writer.
export * from './catalog/index.ts';
