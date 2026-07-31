/**
 * Multilingual-e5-small Embedder implementation (Phase 1.3 T-09).
 *
 * Wraps `@huggingface/transformers` `pipeline('feature-extraction')` for
 * the `Xenova/multilingual-e5-small` ONNX model. Returns a 384d
 * Float32Array for any input text after prefixing with `query: ` or
 * `passage: ` (asymmetric retrieval pattern documented in the model
 * card — dropping the prefix drops retrieval quality ~30%).
 *
 * Loading strategy:
 *   - Pipeline is lazy: `encode()` is the first call that triggers the
 *     load. The library caches the model under
 *     `node_modules/@huggingface/transformers/.cache/Xenova/multilingual-e5-small/`
 *     after `verify-env.mjs` runs once, so subsequent loads are < 1s.
 *   - We call `assertMultilingualE5SmallCached()` to fail fast with a
 *     clear "model not found" message before any model-load attempt.
 *   - Inference uses `{ pooling: 'mean', normalize: true }` (per the
 *     multilingual-e5-small model card conventions; normalized vectors
 *     + mean-pool over token embeddings are required for cosine
 *     similarity).
 *
 * Determinism:
 *   - The same input text → same Float32Array on repeated `encode()`
 *     calls (the model itself is deterministic in ONNX eval mode; the
 *     input pipeline is stable across runs).
 *   - `query:` vs `passage:` prefixes produce DIFFERENT embeddings per
 *     the asymmetric retrieval convention (verified by an integration
 *     test in `test/catalog/embedder.test.mjs`).
 *
 * Error surface:
 *   - Model not cached → `EmbedderError('encoding failed: ... not found')`
 *   - Pipeline load throws → wrapped in `EmbedderError('ENCODING_FAILED')`
 *   - Inference returns wrong dims → wrapped in `EmbedderError('ENCODING_FAILED')`
 */

import type { Embedder } from './types.ts';
import { EmbedderError } from '../errors.ts';
import {
  MULTILINGUAL_E5_SMALL_REPO,
  assertMultilingualE5SmallCached,
} from './model-path.ts';

const EMBEDDING_DIMENSIONS = 384 as const;

export type EmbedderKind = 'query' | 'passage';

export interface MultilingualE5SmallEmbedderOptions {
  /** Asymmetric retrieval prefix selector. */
  kind: EmbedderKind;
  /**
   * Override the HuggingFace repo id. Defaults to `Xenova/multilingual-e5-small`.
   * Exposed primarily for testing (a tiny stub model is NOT bundled —
   * tests should pass a stub via the `Embedder` interface instead).
   */
  modelId?: string;
}

interface PipelineTensor {
  data: Float32Array;
}

/**
 * Subset of the `@huggingface/transformers` pipeline shape we rely on.
 * Loosely typed so we don't pin the runtime to a specific sub-release;
 * the relevant methods (`(text, options) -> Tensor`) are stable.
 */
interface FeatureExtractionPipeline {
  (text: string, options?: Record<string, unknown>): Promise<PipelineTensor> | PipelineTensor;
}

/**
 * Multilingual-e5-small implementation. Loads the model lazily on
 * first `encode()` call. Thread-safe for a single loader instance;
 * concurrent `encode()` calls share the same pipeline (idempotent).
 */
export class MultilingualE5SmallEmbedder implements Embedder {
  readonly dimensions: 384 = EMBEDDING_DIMENSIONS;
  readonly kind: EmbedderKind;
  readonly modelId: string;

  private _pipeline: FeatureExtractionPipeline | null = null;
  private _loadPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(options: MultilingualE5SmallEmbedderOptions) {
    if (options.kind !== 'query' && options.kind !== 'passage') {
      throw new EmbedderError(
        `MultilingualE5SmallEmbedder: kind must be 'query' or 'passage', got ${String(options.kind)}`,
        'ENCODING_FAILED',
      );
    }
    this.kind = options.kind;
    this.modelId = options.modelId ?? MULTILINGUAL_E5_SMALL_REPO;
  }

  /**
   * Apply the asymmetric retrieval prefix (`query: ` / `passage: `).
   * Exported for tests and for the build-index CLI; not intended for
   * external callers (callers should go through `encode()`).
   */
  prefix(text: string): string {
    return `${this.kind}: ${text}`;
  }

  /**
   * Eagerly load the model. Idempotent; concurrent callers share the
   * same in-flight promise. Throws `EmbedderError('ENCODING_FAILED')`
   * if the cached ONNX weights are missing.
   */
  async init(): Promise<void> {
    await this.loadPipeline();
  }

  /**
   * Canonical entry point. Returns a Float32Array of length 384.
   * Throws `EmbedderError('ENCODING_FAILED')` on any failure (model
   * missing, pipeline load, inference, wrong dimensions).
   */
  async encode(text: string): Promise<Float32Array> {
    if (typeof text !== 'string') {
      throw new EmbedderError(
        `encode(text) expects string, got ${typeof text}`,
        'ENCODING_FAILED',
      );
    }
    const pipeline = await this.loadPipeline();
    let result: PipelineTensor | Float32Array;
    try {
      result = await pipeline(this.prefix(text), { pooling: 'mean', normalize: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new EmbedderError(
        `multilingual-e5-small inference failed: ${reason}`,
        'ENCODING_FAILED',
      );
    }
    // The library returns `{ data: Float32Array }`; some versions return
    // the Float32Array directly. Normalize.
    const data = result instanceof Float32Array ? result : result.data;
    if (!(data instanceof Float32Array)) {
      throw new EmbedderError(
        `embedding is not a Float32Array; got ${typeof data}`,
        'ENCODING_FAILED',
      );
    }
    if (data.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbedderError(
        `embedding has ${data.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
        'ENCODING_FAILED',
      );
    }
    // Defensive copy so the returned Float32Array is independent of the
    // library's internal buffer (which the next encode call may reuse).
    return new Float32Array(data);
  }

  /** Legacy alias of `encode`. Phase 5 search-suite compat. */
  async embed(text: string): Promise<Float32Array> {
    return this.encode(text);
  }

  /**
   * Internal loader. Memoizes the pipeline + the loading promise so
   * concurrent `encode()` calls during the first ~1-3s warmup share a
   * single load. The eager `assertMultilingualE5SmallCached()` check
   * guarantees a clear error when the model isn't downloaded.
   */
  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    if (this._pipeline) return this._pipeline;
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = (async () => {
      assertMultilingualE5SmallCached();
      let transformers: typeof import('@huggingface/transformers');
      try {
        transformers = await import('@huggingface/transformers');
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new EmbedderError(
          `failed to import @huggingface/transformers: ${reason}`,
          'ENCODING_FAILED',
        );
      }
      const { pipeline, env } = transformers;
      if (typeof pipeline !== 'function') {
        throw new EmbedderError(
          '@huggingface/transformers has no pipeline() export — check the version',
          'ENCODING_FAILED',
        );
      }
      // Keep the cache dir local to node_modules (default) so the build
      // doesn't depend on a user-level HF_HOME.
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      try {
        const loaded = await (pipeline as any)('feature-extraction', this.modelId);
        this._pipeline = loaded as FeatureExtractionPipeline;
        return this._pipeline;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new EmbedderError(
          `multilingual-e5-small pipeline('feature-extraction', '${this.modelId}') failed: ${reason}`,
          'ENCODING_FAILED',
        );
      }
    })();
    try {
      return await this._loadPromise;
    } finally {
      // After first resolution, clear `_loadPromise` so error retries work.
      // On success, `_pipeline` is set; on failure, reset so a retry can
      // re-attempt the load (callers typically bubble the error up).
      if (!this._pipeline) this._loadPromise = null;
    }
  }
}
