/**
 * Error hierarchy for the catalog domain.
 *
 * Every public failure surface in the catalog raises a typed error so the CLI
 * can map it to the right exit code and log level.
 *
 * Note: Node 22's native TS strip-only mode (--no-warnings=ExperimentalWarning)
 * does NOT yet support TypeScript parameter properties (`constructor(readonly code: ...)`),
 * so every class below declares fields explicitly. Tests that consume these errors
 * pin the public surface (`name`, `code`, `path`).
 */

/** Loader: parse / validate a skill YAML. */
export class LoaderError extends Error {
  readonly code:
    | 'INVALID_KIND'
    | 'INVALID_SLUG'
    | 'MISSING_CONTENT'
    | 'YAML_PARSE_ERROR';
  readonly path: string;

  constructor(
    message: string,
    code:
      | 'INVALID_KIND'
      | 'INVALID_SLUG'
      | 'MISSING_CONTENT'
      | 'YAML_PARSE_ERROR',
    path: string,
  ) {
    super(message);
    this.name = 'LoaderError';
    this.code = code;
    this.path = path;
  }
}

/** Writer: insert / upsert into SQLite. */
export class WriterError extends Error {
  readonly code: 'HASH_COLLISION' | 'DB_ERROR';

  constructor(message: string, code: 'HASH_COLLISION' | 'DB_ERROR') {
    super(message);
    this.name = 'WriterError';
    this.code = code;
  }
}

/** Schema: DDL failure (missing table, bad SQL, etc). */
export class SchemaError extends Error {
  readonly code: 'DB_ERROR';

  constructor(message: string, code: 'DB_ERROR') {
    super(message);
    this.name = 'SchemaError';
    this.code = code;
  }
}

/** Embedder: encoding failure (model not loaded, NaN, etc). */
export class EmbedderError extends Error {
  readonly code: 'ENCODING_FAILED';

  constructor(message: string, code: 'ENCODING_FAILED') {
    super(message);
    this.name = 'EmbedderError';
    this.code = code;
  }
}