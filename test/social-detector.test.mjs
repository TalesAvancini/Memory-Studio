import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { isSocial } from '../src/social-detector/index.ts';

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

const falsePositiveFixtures = [
  ['FP-01', 'thanks to memoization, this function is fast'],
  ['FP-02', 'the method thanks the user after saving'],
  ['FP-03', 'write a function that returns "thanks"'],
  ['FP-04', 'create a regex that matches hello'],
  ['FP-05', 'why does the bye command close the socket?'],
  ['FP-06', 'obrigado is Portuguese for thank you'],
  ['FP-07', 'thanks, now refactor the parser'],
  ['FP-08', 'oi, corrija o bug no parser'],
  ['FP-09', 'bom dia, implemente um endpoint'],
  ['FP-10', 'how are you handling database retries?'],
  ['FP-11', 'como vai funcionar o cache?'],
  ['FP-12', 'good morning jobs fail in CI'],
];

for (const [caseId, prompt] of falsePositiveFixtures) {
  test(`${caseId}: preserves retrieval for specified technical context`, () => {
    assert.equal(isSocial(prompt), false);
  });
}

// ---------------------------------------------------------------------------
// Phase 2 — 20+20 fixture + FP rate assertion (T-02)
//
// Loads `test/social-detector/fixtures.yaml` (co-located with this test
// file) and asserts:
//   - 20 social prompts each return `true` from `isSocial`
//   - 20 real prompts each return `false` from `isSocial`
//   - Real-prompt misclassification rate ≤ 5% (≤ 1 of 20; 0% is the target)
//
// Each real prompt deliberately contains a social word in non-bypass
// context (e.g., `"thanks, agora refatora o parser"`) so the test
// exercises the FALSE_POSITIVE catalog and proves calibration FP safety
// at scale.
// ---------------------------------------------------------------------------

test('20+20 fixture: FP rate ≤ 5% (Phase 2 T-02 / AC-4 / AC-5)', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesPath = join(here, 'social-detector', 'fixtures.yaml');
  const yamlText = await readFile(fixturesPath, 'utf8');
  const parsed = parseYaml(yamlText);

  assert.ok(parsed && typeof parsed === 'object', 'fixture file must parse to an object');
  const { social_prompts, real_prompts } = parsed;

  assert.ok(Array.isArray(social_prompts), 'social_prompts must be an array');
  assert.ok(Array.isArray(real_prompts), 'real_prompts must be an array');
  assert.equal(social_prompts.length, 20, 'social_prompts must have exactly 20 entries');
  assert.equal(real_prompts.length, 20, 'real_prompts must have exactly 20 entries');

  // Every social prompt must return true — collect any failures for clarity.
  const socialFailures = social_prompts
    .map((prompt, i) => ({ prompt, idx: i, ok: isSocial(prompt) }))
    .filter((entry) => !entry.ok);
  assert.deepEqual(
    socialFailures,
    [],
    `social prompts misclassified (${socialFailures.length}/20): ${JSON.stringify(
      socialFailures.map((f) => f.prompt),
    )}`,
  );

  // Every real prompt must return false — FP rate must be ≤ 5%.
  const realFailures = real_prompts
    .map((prompt, i) => ({ prompt, idx: i, ok: isSocial(prompt) }))
    .filter((entry) => entry.ok);
  assert.equal(
    realFailures.length,
    0,
    `real prompts misclassified (FP rate ${(realFailures.length / 20) * 100}%, max tolerated ≤ 5%): ${JSON.stringify(
      realFailures.map((f) => f.prompt),
    )}`,
  );
});
