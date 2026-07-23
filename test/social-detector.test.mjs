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

const normalizationFixtures = [
  ['NORM-01', '  OI  ', true],
  ['NORM-02', 'THANKS!!!', true],
  ['NORM-03', 'Bom   dia.', true],
  ['NORM-04', '\nbye\t', true],
  ['NORM-05', 'ola', true],
  ['NORM-06', 'ate mais', true],
  ['NORM-07', '', false],
  ['NORM-08', '   \n\t  ', false],
  ['NORM-09', '!!!', false],
];

for (const [caseId, prompt, expected] of normalizationFixtures) {
  test(`${caseId}: applies the specified normalization outcome`, () => {
    assert.equal(isSocial(prompt), expected);
  });
}

test('equal inputs return the same primitive boolean', () => {
  const firstResult = isSocial('thanks');
  const secondResult = isSocial('thanks');

  assert.equal(typeof firstResult, 'boolean');
  assert.equal(secondResult, firstResult);
});

test('100,000 unmatched characters return false without throwing', () => {
  assert.equal(isSocial('x'.repeat(100_000)), false);
});
