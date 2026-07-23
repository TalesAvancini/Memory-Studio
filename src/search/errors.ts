/**
 * Typed error hierarchy for the search domain.
 *
 * Mirrors the catalog error style (explicit class + string-union `code`).
 * `SearchError.cause` is an optional `unknown` that downstream code can
 * inspect; messages never echo query content (only length/type when relevant).
 *
 * Note: Node 22's native TS strip-only mode does NOT support TypeScript
 * parameter properties, so each class declares fields explicitly.
 */

export type SearchErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_K'
  | 'INVALID_CONFIG'
  | 'INVALID_EMBEDDING'
  | 'VECTOR_EXTENSION_UNAVAILABLE'
  | 'SCHEMA_ERROR'
  | 'QUERY_ERROR'
  | 'EMBEDDING_FAILED';

/** Single typed error class for every search-domain failure. */
export class SearchError extends Error {
  readonly code: SearchErrorCode;
  override readonly cause?: unknown;

  constructor(message: string, code: SearchErrorCode, cause?: unknown) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Wrap a thrown value as `SearchError` only when it is not already one.
 * Useful in SQL/extension boundaries so callers can rely on a uniform type.
 */
export function asSearchError(
  err: unknown,
  code: SearchErrorCode,
  prefix: string,
): SearchError {
  if (err instanceof SearchError) return err;
  const msg =
    err instanceof Error
      ? `${prefix}: ${err.message}`
      : `${prefix}: ${String(err)}`;
  return new SearchError(msg, code, err);
}