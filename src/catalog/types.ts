// Compatibility shim — Phase 5 search tests reference the legacy
// `SkillKind` enum from the calibration residue. Phase 1.1 collapses this
// into a single `CatalogItem` discriminated union; this file keeps the
// alias stable for downstream imports.
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
  content_yaml: string;
  embedding: Buffer;
  hash: string;
  created_at: number;
  updated_at: number;
}

export interface RawSkillYaml extends SkillRecord {}