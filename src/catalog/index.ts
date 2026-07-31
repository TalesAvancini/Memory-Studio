/**
 * Catalog domain barrel.
 *
 * Re-exports the public surface of `src/catalog/**` so downstream consumers
 * (Phase 2 social-detector, Phase 5 search, scripts/build-index in Phase 1.4)
 * can `import { ... } from '../catalog/index.js'` without poking at the
 * internal module layout. Pure re-export only — no logic, no new symbols.
 *
 * Layering:
 *   - Zod schemas + types: from `./schema/index.js`
 *   - Compat shim types: from `./types.js` (Phase 1.1; Phase 1.2 will replace)
 *   - Single typed error: from `./errors.js`
 *   - Embedder interface + dimension constant: from `./embedder.js`
 *   - Calibration-residue compat (DDL helper for `test/search/**`):
 *     from `./schema.js`
 */

// Zod schemas + Zod-inferred types + validator + SchemaError.
export * from './schema/index.ts';

// Phase 1.1 compat shim types (StoredSkill, SkillKind, etc.). Phase 1.2 will
// retire these and replace with DB-row types.
export type {
  SkillKind,
  SkillCategory,
  SkillRecord,
  StoredSkill,
  RawSkillYaml,
} from './types.ts';

// Single typed error surface for the catalog domain.
export { SchemaError } from './errors.ts';

// Embedder interface + dimension constant. The interface here is the
// Phase 1.1 placeholder (Phase 1.3 will swap in multilingual-e5-small).
export { EMBEDDING_DIMENSIONS } from './embedder.ts';
export type { Embedder } from './embedder.ts';

// Calibration-residue DDL helper. `test/search/**` opens an in-memory DB and
// calls `createSchema` to seed the legacy `skills` table for its FTS5 +
// sqlite-vec integration tests. Phase 1.2 will rewrite the search suite to
// use the new schema directly; until then, this re-export keeps the suite
// green without re-implementing the helper here.
export { createSchema } from './schema.ts';
