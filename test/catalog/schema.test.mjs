import test from 'node:test';
import assert from 'node:assert/strict';
import { SkillSchema, RuleSchema, PersonaSchema, validateCatalogItem, CatalogSchema } from '../../src/catalog/schema/index.ts';

test('valid Skill parses with category enum', () => {
  const result = SkillSchema.parse({ id: 'auth-jwt-01', type: 'skill', title: 'JWT', category: 'procedural', text: 'Validate tokens.' });
  assert.equal(result.category, 'procedural');
});

test('Skill rejects missing title with field path', () => {
  const result = validateCatalogItem({ id: 'skill-1', type: 'skill', category: 'pattern', text: 'body' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'title_required');
});

test('Skill rejects category outside enum deterministically', () => {
  const result = validateCatalogItem({ id: 'skill-1', type: 'skill', title: 'x', category: 'other', text: 'body' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'invalid_category');
});

test('Rule and Persona parse defaults', () => {
  assert.equal(RuleSchema.parse({ id: 'rule-1', type: 'rule', text: 'Do this.' }).critical, false);
  assert.equal(PersonaSchema.parse({ id: 'persona-1', type: 'persona', text: 'Be concise.' }).isDefault, false);
});

test('Rule critical and Persona isDefault reject non-boolean values', () => {
  assert.throws(() => RuleSchema.parse({ id: 'rule-1', type: 'rule', text: 'x', critical: 'yes' }));
  assert.throws(() => PersonaSchema.parse({ id: 'persona-1', type: 'persona', text: 'x', isDefault: 1 }));
});

test('all schemas reject missing id and empty text', () => {
  assert.throws(() => SkillSchema.parse({ type: 'skill', title: 'x', category: 'pattern', text: 'x' }));
  assert.throws(() => RuleSchema.parse({ id: 'rule-1', type: 'rule', text: '' }));
  assert.throws(() => PersonaSchema.parse({ id: 'persona-1', type: 'persona', text: '' }));
});

test('text is NFC normalized', () => {
  const result = RuleSchema.parse({ id: 'rule-1', type: 'rule', text: 'Café' });
  assert.equal(result.text, 'Café');
});
