/**
 * Public Embedder interface (Phase 1.3 T-09).
 *
 * The interface is the seam between the multilingual-e5-small ONNX
 * implementation (`./multilingual-e5-small.ts`), deterministic stubs used
 * in unit tests, and any future model swap. The loader depends on this
 * interface, not on the concrete multilingual implementation.
 *
 * Convention:
 *   - `dimensions` is a literal `384` so TypeScript users get a precise
 *     return type; downstream code can rely on `Float32Array` length.
 *   - `encode` is the canonical async entry point (matches the design and
 *     the PRD §6.4 contract).
 *   - `embed` is the legacy alias kept for Phase 5 search-suite callers
 *     (`src/search/**` imports `{ EMBEDDING_DIMENSIONS, embed }` from the
 *     calibration residue shape). All implementations MUST provide both.
 *
 * Pure model interface — does not throw typed errors here. Concrete
 * implementations throw `EmbedderError` (see `../../errors.ts`) on model
 * load / inference failures so callers can branch on the error code
 * without sniffing messages.
 */

export interface Embedder {
  readonly dimensions: 384;
  encode(text: string): Promise<Float32Array>;
  /** Legacy alias of `encode`. Kept for Phase 5 backward compat. */
  embed(text: string): Promise<Float32Array>;
}
