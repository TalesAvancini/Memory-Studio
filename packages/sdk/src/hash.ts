import { createHash } from 'node:crypto';
export const HASH_HEX_LENGTH = 32;
export function hashSha256_16(input: string): string { return createHash('sha256').update(input, 'utf8').digest().subarray(0, 16).toString('hex'); }
