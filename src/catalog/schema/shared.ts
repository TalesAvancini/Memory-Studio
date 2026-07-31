import { z } from 'zod';

export const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const idSchema = z.string().regex(idPattern, 'invalid_id');
export const textSchema = z.string().min(1, 'text_required').transform((value) => value.normalize('NFC'));
export const validationErrorCode = (issue: z.ZodIssue): string => {
  if (issue.code === 'invalid_enum_value') return 'invalid_category';
  if (issue.code === 'invalid_type' && issue.message === 'Required') {
    return `${issue.path.at(-1) ?? 'item'}_required`;
  }
  if (issue.code === 'invalid_type') return `invalid_${issue.path.at(-1) ?? 'value'}_type`;
  if (issue.path.length && issue.code === 'invalid_string') return `invalid_${issue.path.join('_')}`;
  return issue.path.length ? `${issue.path.join('_')}_required` : 'invalid_catalog_item';
};
