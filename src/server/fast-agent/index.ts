/**
 * Fast-agent module barrel — the single import surface for the
 * Phase 6b in-process MiniMax-M2.7-highspeed intel-extraction
 * module.
 *
 * Re-exports the public surface of `src/server/fast-agent/**` so
 * downstream consumers (the augmenter, the pipeline, the proxy,
 * tests) can write:
 *
 *   import { getIntel, writeIntelRow, fetchIntel, EMPTY_INTEL,
 *            IntelSchema, serializeIntel, writeIntelSync,
 *            createAsyncIntelWriter, type Intel } from '../fast-agent/index.ts';
 *
 * instead of poking at the internal module layout.
 *
 * Layering:
 *   - Intel type + Zod schema + serialize/deserialize + EMPTY_INTEL
 *     sentinel: from `intel-schema.ts` (the canonical owner).
 *   - Fast agent client (Anthropic SDK + stub fallback): from
 *     `client.ts` (`fetchIntel`).
 *   - Fast agent writer (sync + async fallback): from `writer.ts`
 *     (`writeIntelSync`, `createSyncIntelWriter`,
 *     `createAsyncIntelWriter`, `createDefaultIntelWriter`,
 *     `setIntelWriterDb`, `resetIntelWriterForTests`).
 *   - Intel store read/write primitives: from
 *     `src/catalog/intel-store.ts` (`getIntel`, `writeIntelRow`).
 *     Cross-directory import is a known barrel anti-pattern that
 *     this module tolerates so the consumer's import surface stays
 *     one path (no `../catalog/index.ts` mixed in).
 *
 * Phase 6b Batch 2 (T-12) — provides the clean import surface for
 * the `BuildOptions.intel` extension (T-09) and the writer-reader
 * roundtrip test (T-11).
 */

// --- Intel schema (canonical owner) -----------------------------------------

export {
  IntelSchema,
  EMPTY_INTEL,
  serializeIntel,
  deserializeIntel,
  emptyIntel,
} from './intel-schema.ts';
export type { Intel } from './intel-schema.ts';

// --- Fast agent client (Anthropic SDK + stub fallback) ---------------------

export { fetchIntel, resolveMode, getMode, getModel, getEndpoint } from './client.ts';
export type { FastAgentResult, Mode } from './client.ts';

// --- Fast agent writer (sync + async fallback) -----------------------------

export {
  writeIntelSync,
  createSyncIntelWriter,
  createAsyncIntelWriter,
  createDefaultIntelWriter,
  getIntelWriter,
  setIntelWriterDb,
  getIntelWriterDb,
  resetIntelWriterForTests,
} from './writer.ts';
export type { IntelWriter } from './writer.ts';

// --- Intel store read/write primitives (cross-directory re-export) ---------

// These live in src/catalog/intel-store.ts (Phase 6b T-02). Re-exported
// here so the consumer can mix schema + store + client + writer in a
// single import statement. The catalog barrel
// (`src/catalog/index.ts`) ALSO re-exports these — both surfaces stay
// consistent (the catalog barrel remains the canonical catalog index;
// this barrel is the canonical fast-agent surface).
export { getIntel, writeIntelRow } from '../../catalog/intel-store.ts';
