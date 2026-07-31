/**
 * Embedder module barrel (Phase 1.3 T-09).
 *
 * Public surface:
 *   - `Embedder` interface
 *   - `MultilingualE5SmallEmbedder` class
 *   - `EmbedderKind` type
 *   - model-path utilities (`expectedModelPath`, `defaultCacheDir`, etc.)
 *
 * Re-exports the design-time `EMBEDDING_DIMENSIONS` constant for any
 * downstream caller (Phase 5 search suite) that imports it directly
 * instead of relying on `embedder.dimensions`.
 */

export type { Embedder } from './types.ts';
export {
  MultilingualE5SmallEmbedder,
  type EmbedderKind,
  type MultilingualE5SmallEmbedderOptions,
} from './multilingual-e5-small.ts';
export {
  MULTILINGUAL_E5_SMALL_REPO,
  defaultCacheDir,
  defaultModelId,
  expectedModelPath,
  assertMultilingualE5SmallCached,
} from './model-path.ts';

/** Re-export of the literal dimensionality for callers that prefer a constant. */
export const EMBEDDING_DIMENSIONS = 384 as const;
