import { z } from 'zod';
import { idSchema, textSchema } from './shared.ts';

export const RuleSchema = z.object({
  id: idSchema,
  type: z.literal('rule'),
  text: textSchema,
  critical: z.boolean().optional().default(false),
}).strict();

export type Rule = z.infer<typeof RuleSchema>;
