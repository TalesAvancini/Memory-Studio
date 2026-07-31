/**
 * Catalog domain barrel.
 *
 * Re-exports the public surface of `src/catalog/**` so downstream consumers
 * (Phase 1.3 CatalogLoader, Phase 1.4 build-index CLI, Phase 5 search,
 * Phase 2 social-detector) can `import { ... } from '../catalog/index.js'`
 * without poking at the internal module layout. Pure re-export only — no
 * logic, no new symbols.
 *
 * Layering:
 *   - Zod schemas + types + validator + SchemaError: from `./schema/index.js`
 *   - DB-row types (Phase 1.2): from `./types.js`
 *   - Typed error surface (Phase 1.2): from `./errors.js`
 *   - Migration runner (Phase 1.2): from `./migrations/runner.js`
 *   - DB opener + sqlite-vec load (Phase 1.2): from `./db/open.js`
 *   - Calibration-residue compat (DDL helper for `test/search/**`):
 *     from `./schema.js`
 */

// Zod schemas + Zod-inferred types + validator + SchemaError.
export * from './schema/index.ts';

// Phase 1.2 DB-row types (CatalogRow + StoredSkill alias + SkillKind/Category).
export type {
  SkillKind,
  SkillCategory,
  CatalogRow,
  StoredSkill,
} from './types.ts';

// Typed error surface (Phase 1.2 adds MigrationError; EmbedderError preserved
// in calibration shape for Phase 5 search suite).
export { SchemaError, EmbedderError, MigrationError } from './errors.ts';

// Phase 1.2 — versioned migration runner. Phase 1.4 build-index CLI calls
// applyMigrations() before opening the catalog DB for writes.
export {
  applyMigrations,
  applyMigrationsSync,
} from './migrations/runner.ts';
export type { MigrationResult, ApplyMigrationsOptions } from './migrations/runner.ts';

// Phase 1.2 — DB opener. Loads sqlite-vec extension + enables WAL +
// foreign_keys. Companion helper `openAndMigrate` chains the runner.
export {
  openCatalogDb,
  openAndMigrate,
  EMBEDDING_DIMENSIONS,
} from './db/open.ts';

// Calibration-residue DDL helper. `test/search/**` opens an in-memory DB
// and calls `createSchema` to seed the legacy `skills` table for its FTS5
// + sqlite-vec integration tests. Phase 5 will rewrite the search suite
// to use the new schema directly; until then, this re-export keeps the
// suite green without re-implementing the helper here.
export { createSchema } from './schema.ts';
