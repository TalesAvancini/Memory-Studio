import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSocial } from '../src/social-detector/is-social.ts';

const positiveFixtures = [
  ['POS-01', 'oi'],
  ['POS-02', 'olá'],
  ['POS-03', 'bom dia'],
  ['POS-04', 'boa tarde'],
  ['POS-05', 'boa noite'],
  ['POS-06', 'e aí'],
  ['POS-07', 'valeu'],
  ['POS-08', 'obrigado'],
  ['POS-09', 'obrigada'],
  ['POS-10', 'muito obrigado'],
  ['POS-11', 'tchau'],
  ['POS-12', 'até logo'],
  ['POS-13', 'até mais'],
  ['POS-14', 'tudo bem?'],
  ['POS-15', 'como vai?'],
  ['POS-16', 'hi'],
  ['POS-17', 'hello'],
  ['POS-18', 'hey'],
  ['POS-19', 'good morning'],
  ['POS-20', 'good afternoon'],
  ['POS-21', 'good evening'],
  ['POS-22', 'thanks'],
  ['POS-23', 'thank you'],
  ['POS-24', 'many thanks'],
  ['POS-25', 'thx'],
  ['POS-26', 'bye'],
  ['POS-27', 'goodbye'],
  ['POS-28', 'see you'],
  ['POS-29', 'how are you?'],
  ['POS-30', "what's up?"],
];

for (const [caseId, prompt] of positiveFixtures) {
  test(`${caseId}: recognizes the specified social fixture`, () => {
    assert.equal(isSocial(prompt), true);
  });
}

test('unmatched implementation request continues technical retrieval', () => {
  assert.equal(isSocial('Implement JWT authentication in TypeScript'), false);
});

test('unmatched SQL question continues technical retrieval', () => {
  assert.equal(isSocial('Explain why this SQL query is slow'), false);
});
