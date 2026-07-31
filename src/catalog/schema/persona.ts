import { z } from 'zod';
import { idSchema, textSchema } from './shared.ts';

export const PersonaSchema = z.object({
  id: idSchema,
  type: z.literal('persona'),
  text: textSchema,
  isDefault: z.boolean().optional().default(false),
}).strict();

export type Persona = z.infer<typeof PersonaSchema>;
