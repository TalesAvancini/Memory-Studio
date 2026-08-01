/**
 * On-demand catalog DB opener for the boot entry-point path.
 *
 * Phase 5b T-14's smoke needs the augment server to persist audit rows
 * to a temp DB. This module wraps `openAndMigrate` from the catalog
 * layer so boot.ts can call it lazily (only when
 * `MEMORY_STUDIO_CATALOG_DB_PATH` is set in the environment).
 *
 * The function is intentionally simple — it's a one-line wrapper
 * around the canonical `openAndMigrate` from `src/catalog/db/open.ts`.
 * Kept in its own file so boot.ts can do a dynamic `import()` and
 * avoid loading sqlite-vec at boot time when the env var is unset.
 */

import { openAndMigrate } from '../../catalog/db/open.ts';
import type { Database as DatabaseType } from 'better-sqlite3';

export async function openCatalogDbForBoot(path: string): Promise<DatabaseType> {
  return openAndMigrate(path);
}
