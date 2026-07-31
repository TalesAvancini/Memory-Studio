/**
 * Catalog DB-row types + PRD v3.4 record shape.
 *
 * Phase 1.2 retracts the Phase 1.1 calibration-shape shims (`SkillRecord`,
 * `StoredSkill` with `slug`/`hash`, `RawSkillYaml`). The catalog now lives in
 * a real SQLite `catalog` table (see `migrations/001_init.sql`), so the
 * authoritative type is the DB row shape itself.
 *
 * `CatalogRow` mirrors the `catalog` table (PRD v3.4 R-05):
 *   id, type, title?, text, category?, critical?, is_default?,
 *   content_hash, created_at, updated_at
 *
 * `StoredSkill` is preserved as a **Phase 5 alias** of `CatalogRow` for any
 * downstream consumer (test/search/**, the calibration residue search suite)
 * that may import the symbol by its old name. It is intentionally the
 * PRD-shape row (no `slug`/`hash`) — Phase 5 must migrate its imports to
 * the new field names when it re-points the search suite.
 *
 * `SkillKind` and `SkillCategory` are kept because `src/search/types.ts`
 * imports `SkillKind` for its own `kind` discriminator; renaming those
 * would ripple into Phase 5 search work that is out of Phase 1.2 scope.
 */

export type SkillKind = 'skill' | 'rule' | 'persona';
export type SkillCategory = 'procedural' | 'diagnostic' | 'reference' | 'pattern';

/**
 * DB row shape for the `catalog` table. Mirrors `001_init.sql` DDL exactly
 * (camelCase TS view of the snake_case columns; Phase 5 query helpers map
 * between the two).
 */
export interface CatalogRow {
  id: string;
  type: SkillKind;
  title: string | null;
  text: string;
  category: SkillCategory | null;
  critical: boolean | null;
  isDefault: boolean | null;
  contentHash: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Phase 5 alias. The calibration residue + the Phase 1.1 compat shim used
 * `StoredSkill` for a record with `slug`/`hash`. Phase 1.2 retires those
 * fields; this alias keeps the symbol alive for any downstream import that
 * has not yet been migrated (notably `test/search/**`, which is Phase 5
 * work). Once Phase 5 re-points the search suite to `CatalogRow`, this
 * alias can be deleted.
 */
export type StoredSkill = CatalogRow;
