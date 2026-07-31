import { z } from 'zod';
import { idSchema, textSchema } from './shared.ts';

export const SkillSchema = z.object({
  id: idSchema,
  type: z.literal('skill'),
  title: z.string().min(1, 'title_required'),
  category: z.enum(['procedural', 'diagnostic', 'reference', 'pattern']),
  text: textSchema,
}).strict();

export type Skill = z.infer<typeof SkillSchema>;
