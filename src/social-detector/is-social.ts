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

  if (normalizedPrompt.length === 0) {
    return false;
  }

  return SOCIAL_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
}
