import { z } from 'zod';
import { SkillSchema } from './skill.ts';
import { RuleSchema } from './rule.ts';
import { PersonaSchema } from './persona.ts';
import { validationErrorCode } from './shared.ts';

export { SkillSchema } from './skill.ts';
export { RuleSchema } from './rule.ts';
export { PersonaSchema } from './persona.ts';
export type { Skill } from './skill.ts';
export type { Rule } from './rule.ts';
export type { Persona } from './persona.ts';

export const CatalogSchema = z.discriminatedUnion('type', [SkillSchema, RuleSchema, PersonaSchema]);
export type CatalogItem = z.infer<typeof CatalogSchema>;
export type ValidationResult = { ok: true; record: CatalogItem } | { ok: false; code: string; error: string; issues: z.ZodIssue[] };

export function validateCatalogItem(parsed: unknown): ValidationResult {
  const result = CatalogSchema.safeParse(parsed);
  if (result.success) return { ok: true, record: result.data };
  const issue = result.error.issues[0]!;
  const code = validationErrorCode(issue);
  const path = issue.path.length ? issue.path.join('.') : 'item';
  return { ok: false, code, error: `${path}: ${code}`, issues: result.error.issues };
}

export class SchemaError extends Error {
  readonly code: string;
  readonly issues: z.ZodIssue[];
  constructor(result: Extract<ValidationResult, { ok: false }>) {
    super(result.error);
    this.name = 'SchemaError';
    this.code = result.code;
    this.issues = result.issues;
  }
}

export type { z };
