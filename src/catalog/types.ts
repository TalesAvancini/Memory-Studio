/**
 * Public types for the catalog domain.
 *
 * SkillRecord is what the loader emits; StoredSkill is what comes from the DB
 * (with id + updatedAt). RawSkillYaml is the boundary type for unvalidated YAML
 * (per CLAUDE.md "sem any exceto em boundary com JSON dinamico").
 */

export type SkillKind = 'skill' | 'rule' | 'persona';

export interface SkillRecord {
  readonly slug: string; // kebab-case, unico
  readonly kind: SkillKind;
  readonly content: string; // texto cru do procedimento
  readonly contentYaml: string; // YAML original serializado (audit trail)
  readonly hash: string; // sha256(contentYaml), hex 64 chars
  readonly createdAt: number; // epoch ms, definido no primeiro insert
}

export interface StoredSkill extends SkillRecord {
  readonly id: number;
  readonly updatedAt: number;
}

// Boundary type para YAML cru (antes da validacao)
export interface RawSkillYaml {
  slug?: unknown;
  kind?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export const VALID_KINDS: readonly SkillKind[] = ['skill', 'rule', 'persona'] as const;

// kebab-case slug pattern (CLAUDE.md § Naming)
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;