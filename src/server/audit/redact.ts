/**
 * Placeholder secret redaction (PRD §10.3.3 + SPEC §IMod-13 invariante 13).
 *
 * Before the audit pipeline computes `redacted_prompt_hash`, this regex
 * layer matches common placeholder patterns and replaces them with the
 * literal token `<REDACTED>`. The replacement is INVISIBLE to the
 * audit hash computation — the hash is computed over the ORIGINAL
 * prompt (the placeholder is a hint that "the human used a secret
 * reference here"; the actual secret value is never persisted).
 *
 * Four placeholder patterns (PRD §10.3.3 + design.md):
 *   1. `${SECRET_KEY}=value` — shell-style env-var assignment
 *   2. `password|token|api_key|secret_key=value` — connection-string style
 *   3. `sk-...` — Anthropic / OpenAI API key format
 *   4. `Bearer ...` — HTTP bearer / JWT
 *
 * CRITICAL INVARIANT: the function returns a NEW string/object. The
 * input is never mutated — callers can safely keep a reference to the
 * original and pass the redacted copy to the audit pipeline.
 */

export const PLACEHOLDER_PATTERNS: ReadonlyArray<RegExp> = [
  // 1. ${SECRET_KEY}=abc123 — shell-style env-var assignment
  /\$\{[A-Z_][A-Z0-9_]*\}=[^\s]+/g,
  // 2. password=... | token=... | api_key=... | secret_key=...
  /\b(password|token|api_key|secret_key)\s*=\s*[^\s]+/gi,
  // 3. sk-ant-... — Anthropic / OpenAI API key format (20+ chars after sk-)
  /sk-[A-Za-z0-9_-]{20,}/g,
  // 4. Bearer eyJ... — HTTP bearer / JWT (20+ chars after Bearer)
  /\bBearer\s+[A-Za-z0-9._-]{20,}/g,
];

const REDACTED_TOKEN = '<REDACTED>';

/**
 * Apply each placeholder pattern in sequence and return a NEW string
 * with matches replaced by `<REDACTED>`. The input is NOT mutated.
 */
export function redactPlaceholders(text: string): string {
  let redacted = text;
  for (const pattern of PLACEHOLDER_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED_TOKEN);
  }
  return redacted;
}

/**
 * Walk an arbitrary JSON-serializable value and return a NEW value
 * with every string leaf redacted. Object keys are preserved (they
 * are NOT redacted — only the values that may contain placeholders).
 * Arrays are walked element-by-element. Non-string primitives
 * (numbers, booleans, null) pass through unchanged.
 *
 * Used for `fingerprint.payload` JSON fields that may contain string
 * values referencing placeholders.
 */
export function redactObjectRecursive(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPlaceholders(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObjectRecursive(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactObjectRecursive(v);
    }
    return out;
  }
  return value;
}