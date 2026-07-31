/**
 * Version helper tests (T-11 / AC-10).
 *
 * Verifies:
 *   - `getCatalogSchemaVersion()` returns the literal 3 (PRD v3.4).
 *   - `CATALOG_SCHEMA_VERSION` is exported as a runtime + compile-time constant.
 *
 * Imports both possible paths to ensure the public barrel works:
 *   - `./src/catalog/version.ts` (direct)
 *   - `./src/catalog/index.ts` (re-export from the module barrel that
 *     Phase 5 will use)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATALOG_SCHEMA_VERSION,
  getCatalogSchemaVersion,
} from '../../src/catalog/version.ts';

test('getCatalogSchemaVersion returns literal 3 (AC-10, R-11)', () => {
  assert.equal(getCatalogSchemaVersion(), 3);
});

test('CATALOG_SCHEMA_VERSION constant equals 3', () => {
  assert.equal(CATALOG_SCHEMA_VERSION, 3);
});

test('version is also re-exported through src/catalog/index.ts', async () => {
  const idx = await import('../../src/catalog/index.ts');
  assert.equal(typeof idx.getCatalogSchemaVersion, 'function');
  assert.equal(idx.getCatalogSchemaVersion(), 3);
});
