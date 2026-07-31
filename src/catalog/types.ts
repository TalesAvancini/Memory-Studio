// NOTE: This interface is a Phase 1.1 compat shim only. Phase 1.2 will
// replace with DB-row types sourced from the `catalog` table (PRD v3.4 R-05).
//
// Calibration residue shaped this differently — see git history pre-Phase 1.
// PRD v3.4 uses `text` (the Zod-parsed YAML body) and moves embeddings to
// their own table. Timestamps are camelCase. The remaining fields
// (`slug`, `hash`) keep the calibration shape because Phase 5 search tests
// still depend on it; Phase 1.2 will rewrite them too.

export type SkillKind = 'skill' | 'rule' | 'persona';
export type SkillCategory = 'procedural' | 'diagnostic' | 'reference' | 'pattern';

export interface SkillRecord {
  id: string;
  type: SkillKind;
  title?: string;
  text: string;
  category?: SkillCategory;
  critical?: boolean;
  isDefault?: boolean;
}

export interface StoredSkill extends SkillRecord {
  slug: string;
  hash: string;
  createdAt: number;
  updatedAt: number;
}

export interface RawSkillYaml extends SkillRecord {}
