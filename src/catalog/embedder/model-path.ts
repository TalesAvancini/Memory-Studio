/**
 * Model-path resolver (Phase 1.3 T-09).
 *
 * The multilingual-e5-small ONNX model is fetched + cached by
 * `@huggingface/transformers` under `node_modules/@huggingface/transformers/.cache/<repo>/`
 * (the library's default `env.cacheDir`). Phase 0 (`verify-env.mjs`)
 * already downloaded + cached the weights there. The build-index CLI
 * relies on this convention so model files are not re-downloaded.
 *
 * This module exposes:
 *   - `defaultModelId()` — the canonical HuggingFace repo id (`Xenova/multilingual-e5-small`)
 *   - `defaultCacheDir()` — the absolute path to the local model cache
 *   - `expectedModelPath()` — combined default `{cacheDir}/{repo}/onnx/model.onnx`
 *   - `multilingualE5SmallPath()` — explicit resolver for THIS model
 *   - `EmbeddingModelNotFoundError` — typed error used when the ONNX file
 *      is missing at the expected path (build-index surfaces this with a
 *      clear "model not found at <path>" stderr message per R-12).
 *
 * We do NOT alter `env.cacheDir` here. The Phase 0 invocation pinned it
 * implicitly via the `pipeline()` call. The disk location convention is
 * the library's internal `.cache/<org>/<name>/` layout.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EmbedderError } from '../errors.ts';

export const MULTILINGUAL_E5_SMALL_REPO = 'Xenova/multilingual-e5-small';

/**
 * Resolve the absolute path of the @huggingface/transformers package
 * directory by walking up from this module's URL, then down into
 * node_modules. The layout is `<repo>/node_modules/@huggingface/transformers/`.
 */
function transformersPackageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // here = `<repo>/src/catalog/embedder/`
  // Need:  `<repo>/node_modules/@huggingface/transformers/`
  // Walk up 3 levels to reach `<repo>/`, then descend into `node_modules/`.
  return resolve(here, '..', '..', '..', 'node_modules', '@huggingface', 'transformers');
}

/** Library default cache directory (used by `@huggingface/transformers`). */
export function defaultCacheDir(): string {
  return join(transformersPackageRoot(), '.cache');
}

/** Canonical HuggingFace repo id for multilingual-e5-small. */
export function defaultModelId(): string {
  return MULTILINGUAL_E5_SMALL_REPO;
}

/**
 * Absolute path to the cached ONNX weights for multilingual-e5-small.
 * `${cacheDir}/Xenova/multilingual-e5-small/onnx/model.onnx`.
 */
export function expectedModelPath(): string {
  return join(defaultCacheDir(), MULTILINGUAL_E5_SMALL_REPO, 'onnx', 'model.onnx');
}

/**
 * Eager model-path resolver. Throws `EmbedderError` with a remediation
 * hint if the ONNX file is missing at the expected cache path. Call this
 * BEFORE instantiating an `InferenceSession` so the build-index CLI fails
 * fast with a clear stderr message. The error code is the typed
 * `'ENCODING_FAILED'` (the broader `EmbedderError` class); the message
 * is what tells the operator why embedding failed.
 */
export function assertMultilingualE5SmallCached(): string {
  const modelPath = expectedModelPath();
  if (!existsSync(modelPath)) {
    throw new EmbedderError(
      `multilingual-e5-small model not found at ${modelPath}. ` +
        `Run 'npm run verify-env' to download via @huggingface/transformers, ` +
        `or pre-populate node_modules/@huggingface/transformers/.cache/${MULTILINGUAL_E5_SMALL_REPO}/.`,
      'ENCODING_FAILED',
    );
  }
  return modelPath;
}
