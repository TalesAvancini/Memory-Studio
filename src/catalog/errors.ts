// Compatibility shim — Phase 5 search tests reference the legacy
// `CatalogError`/`EmbedderError` hierarchy. Phase 1.1 rewires this through
// `src/catalog/schema/index.ts`, which now exports a single `SchemaError`.
// This stub keeps the surface stable until the search suite is re-pointed.
export class CatalogError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
  }
}

export class EmbedderError extends CatalogError {
  constructor(message: string) {
    super('EMBEDDER_ERROR', message);
    this.name = 'EmbedderError';
  }
}

export class MigrationError extends CatalogError {
  constructor(message: string) {
    super('MIGRATION_ERROR', message);
    this.name = 'MigrationError';
  }
}

export class LoaderError extends CatalogError {
  constructor(message: string) {
    super('LOADER_ERROR', message);
    this.name = 'LoaderError';
  }
}

export { SchemaError } from './schema/index.ts';