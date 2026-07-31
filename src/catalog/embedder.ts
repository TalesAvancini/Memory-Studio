/**
 * @deprecated Phase 1.3 deliverable. This compat shim exposes `encode()`
 * interface to keep test/search/** green during Phase 1.1. DO NOT USE in
 * new code. Phase 1.3 will replace with the real multilingual-e5-small
 * integration.
 */
// Compatibility shim — Phase 5 search tests still reference the calibration
// `EMBEDDING_DIMENSIONS` constant. The Phase 1.1 Zod schemas live in
// `src/catalog/schema/*`; this file just re-exports the constant so the
// search suite keeps loading until those tests graduate to the new embedder
// interface.
export { EMBEDDING_DIMENSIONS } from './schema.ts';

export interface Embedder {
  readonly dimensions: 384;
  encode(text: string): Promise<Float32Array>;
  embed(text: string): Promise<Float32Array>;
}