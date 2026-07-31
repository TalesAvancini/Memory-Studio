/**
 * Social detector — Phase 2 promotion of the calibration module.
 *
 * Calibration source: `src/social-detector/is-social.ts` (Phase 1 era).
 * This file is the verbatim content of that module with two minimal,
 * additive pattern entries (`/^ok$/u`, `/^okay$/u`) at the end of
 * `SOCIAL_PATTERNS` so the ROADMAP Phase 2 done #1 example list
 * (`["oi", "valeu", "thanks", "obrigado", "ok", "..."]`) is fully covered
 * for `ok`/`okay`. Calibration NORM-09 (`"!!!"` / `"..."` → false) is
 * preserved — the regex catalog only matches at the start of the
 * normalized prompt, and the new patterns are start-anchored to
 * single-token greetings (`ok`, `okay`).
 *
 * Per `.specs/CALIBRATION-RESIDUE.md` and the dispatch constraint, this is
 * a PROMOTION (verbatim copy + 2-line addition), NOT a rewrite. The
 * algorithm is byte-identical to calibration.
 */

const FALSE_POSITIVE_PATTERNS: readonly RegExp[] = Object.freeze([
  /^thanks to\b/u,
  /\bthanks the user\b/u,
  /["'`]thanks["'`]/u,
  /\b(?:regex|pattern)\b.*\bmatches?\s+hello\b/u,
  /\bbye command\b/u,
  /^obrigado is\b.*\bthank you$/u,
  /^(?:thanks|oi|bom dia),\s+\S/u,
  /^how are you handling\b/u,
  /^como vai funcionar\b/u,
  /^good morning jobs\b/u,
]);

const SOCIAL_PATTERNS: readonly RegExp[] = Object.freeze([
  /^oi$/u,
  /^ol[áa]$/u,
  /^bom dia$/u,
  /^boa tarde$/u,
  /^boa noite$/u,
  /^e aí$/u,
  /^valeu$/u,
  /^obrigado$/u,
  /^obrigada$/u,
  /^muito obrigado$/u,
  /^tchau$/u,
  /^até logo$/u,
  /^(?:até|ate) mais$/u,
  /^tudo bem$/u,
  /^como vai$/u,
  /^hi$/u,
  /^hello$/u,
  /^hey$/u,
  /^good morning$/u,
  /^good afternoon$/u,
  /^good evening$/u,
  /^thanks$/u,
  /^thank you$/u,
  /^many thanks$/u,
  /^thx$/u,
  /^bye$/u,
  /^goodbye$/u,
  /^see you$/u,
  /^how are you$/u,
  /^what's up$/u,
  // Phase 2 additions — minimal, additive; preserve all existing behavior.
  /^ok$/u,
  /^okay$/u,
]);

function normalizePrompt(prompt: string): string {
  return prompt
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .replace(/[.!?…]+$/u, '')
    .trim();
}

export function isSocial(prompt: string): boolean {
  const normalizedPrompt = normalizePrompt(prompt);

  if (
    normalizedPrompt.length === 0 ||
    FALSE_POSITIVE_PATTERNS.some((pattern) => pattern.test(normalizedPrompt))
  ) {
    return false;
  }

  return SOCIAL_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
}
