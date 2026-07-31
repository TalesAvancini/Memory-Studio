import test from 'node:test';
import assert from 'node:assert/strict';
test('built package exposes public SDK symbols', async () => { const sdk = await import('@memory-studio/sdk'); assert.equal(typeof sdk.collectContext, 'function'); assert.equal(typeof sdk.fingerprint, 'function'); assert.equal(typeof sdk.MemoryStudioClient, 'function'); });
