/**
 * Embedder re-export alias (Phase 1.3 T-09).
 *
 * Earlier phases (1.1, 1.2) kept a compat shim at this path so `src/search/**`
 * continued to import `EMBEDDING_DIMENSIONS` while the real implementation
 * lived in `src/catalog/embedder/`. T-09 lands the real impl and removes
 * the stub, but keeps this file as a thin re-export of the new barrel so
 * every existing import path keeps resolving.
 */

export {
  EMBEDDING_DIMENSIONS,
  MultilingualE5SmallEmbedder,
  defaultCacheDir,
  defaultModelId,
  expectedModelPath,
  assertMultilingualE5SmallCached,
  MULTILINGUAL_E5_SMALL_REPO,
} from './embedder/index.ts';
export type { Embedder, EmbedderKind, MultilingualE5SmallEmbedderOptions } from './embedder/index.ts';

// Deprecated shape kept only for typed callers that imported the shim;
// the calibration-residue `encode/embed` methods are now provided by
// `MultilingualE5SmallEmbedder` (the ONLY concrete implementation).
// Test code that needs a deterministic stub should use a literal object
// matching the `Embedder` interface (`{ dimensions: 384, encode, embed }`).
