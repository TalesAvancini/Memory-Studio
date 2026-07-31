import type { RedactionMode } from './types.js';
export const REDACTED = '<REDACTED>';
const MINIMAL = [
  /\b(?:sk|pk)[-_][A-Za-z0-9]{20,}\b/g,
  /\bapi[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}['"]?/gi,
  /\b(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)\s*=\s*[^\s'"]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
];
const STRICT = [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, /\bAKIA[0-9A-Z]{16}\b/g, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g];
export function redactString(input: string, mode: RedactionMode): string { let result = input; for (const pattern of MINIMAL) result = result.replace(pattern, REDACTED); if (mode === 'strict') for (const pattern of STRICT) result = result.replace(pattern, REDACTED); return result; }
export function redactValue(input: unknown, mode: RedactionMode): unknown { if (typeof input === 'string') return redactString(input, mode); if (Array.isArray(input)) return input.map(value => redactValue(value, mode)); if (input !== null && typeof input === 'object') { const result: Record<string, unknown> = {}; for (const [key, value] of Object.entries(input)) result[key] = redactValue(value, mode); return result; } return input; }
