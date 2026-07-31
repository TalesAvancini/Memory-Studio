// Compatibility shim — Phase 5 search suite (out of Phase 1.1 scope) used
// to consume `CatalogError` / `EmbedderError` / `MigrationError` /
// `LoaderError` classes from this module. Phase 1.1 collapses the typed
// error surface into a single `SchemaError` (see src/catalog/schema/index.ts)
// plus driver-level errors thrown directly from better-sqlite3 / ONNX
// runtime.
//
// `EmbedderError` is preserved here in its calibration residue shape because
// `test/search/search.test.mjs` (T-ORCH-13b, SEARCH-13 privacy regression)
// imports it directly. Phase 5 will re-point the search suite to a new
// embedder-error surface; until then, this class keeps T-ORCH-13b green.

export class EmbedderError extends Error {
  readonly code: 'ENCODING_FAILED';
  constructor(message: string, code: 'ENCODING_FAILED') {
    super(message);
    this.name = 'EmbedderError';
    this.code = code;
  }
}

export { SchemaError } from './schema/index.ts';
