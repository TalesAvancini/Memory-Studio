/**
 * Safe BM25 lexical retrieval over the FTS5 `content_fts` table.
 *
 * Design constraints:
 *   - The user-supplied query is treated as text, never as FTS5 syntax.
 *   - We extract unique Unicode alphanumeric tokens, double-quote each one
 *     to escape FTS5 operators, and join with `OR`.
 *   - The expression is bound as a parameter; nothing the user types reaches
 *     FTS5 without going through `buildFtsQuery`.
 *   - Punctuation-only input returns `undefined` so callers can short-circuit
 *     to "no lexical matches" without producing an empty MATCH expression.
 *
 * Ranking:
 *   - bm25(content_fts) is ASC by default in FTS5 (lower = more relevant).
 *   - We order by bm25 ASC, then by rowid ASC for a stable ID fallback.
 *   - Total distinct hits is counted BEFORE the candidate limit so the
 *     channel gate can compare against minFtsHits even when the limit is
 *     smaller than the hit count.
 *
 * Errors:
 *   - SQL failures wrap as `SearchError(QUERY_ERROR)` with cause but no
 *     query content in the message.
 */

import type { Database } from 'better-sqlite3';
import { asSearchError } from './errors.ts';
import type { FtsCandidate, FtsSearchResult } from './types.ts';
import { SEARCH_TABLES } from './schema.ts';

const FTS_TABLE = SEARCH_TABLES.fts;

/** Match Unicode letters, marks, numbers, or connector punctuation (e.g. '_'). */
const TOKEN_REGEX = /[\p{L}\p{M}\p{N}_]+/gu;

/**
 * Extract unique alphanumeric tokens from a query, quote each one safely,
 * and join them with `OR`. Returns `undefined` when no tokens are present.
 *
 * The double-quote wrapping escapes FTS5 reserved characters (`OR`, `AND`,
 * `NOT`, `NEAR`, `(`, `)`, `:`, `*`, etc.) by treating the whole token as
 * a literal phrase. Embedded double-quotes are stripped first so the
 * generated expression stays well-formed.
 */
export function buildFtsQuery(rawQuery: string): string | undefined {
  if (typeof rawQuery !== 'string') return undefined;
  const tokens = rawQuery.match(TOKEN_REGEX);
  if (!tokens || tokens.length === 0) return undefined;

  // Preserve first-seen order while deduplicating (case-insensitive). PT-BR
  // and EN share the same Unicode identifier rules here, and de-dup keeps
  // the MATCH expression minimal.
  const seen = new Set<string>();
  const ordered = [];
  for (const tok of tokens) {
    const key = tok.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // Strip any inner double-quotes before wrapping.
    ordered.push(`"${tok.replace(/"/g, '')}"`);
  }
  if (ordered.length === 0) return undefined;
  return ordered.join(' OR ');
}

interface FtsRow {
  rowid: number;
  bm25: number;
}

interface FtsCountRow {
  n: number;
}

/**
 * Run the FTS5 channel: count distinct hits, then return BM25-ranked
 * candidates up to `limit`. Empty/undefined expression → zero results
 * without raising an error.
 */
export function queryFts(
  db: Database,
  rawQuery: string,
  limit: number,
): FtsSearchResult {
  const expression = buildFtsQuery(rawQuery);
  if (expression === undefined) {
    return { totalHits: 0, candidates: [] };
  }

  // 1. Total distinct hits before applying the candidate limit.
  const countRows = db
    .prepare<[string], FtsCountRow>(
      `SELECT COUNT(*) AS n FROM ${FTS_TABLE} WHERE ${FTS_TABLE} MATCH ?`,
    )
    .all(expression);
  const totalHits = countRows[0]?.n ?? 0;

  if (totalHits === 0) {
    return { totalHits: 0, candidates: [] };
  }

  // 2. Candidate rows ordered by bm25 ASC then rowid ASC for stability.
  const rows = db
    .prepare<[string, number], FtsRow>(
      `SELECT rowid AS rowid, bm25(${FTS_TABLE}) AS bm25
       FROM ${FTS_TABLE}
       WHERE ${FTS_TABLE} MATCH ?
       ORDER BY bm25 ASC, rowid ASC
       LIMIT ?`,
    )
    .all(expression, limit);

  const candidates: FtsCandidate[] = rows.map((row, idx) => ({
    id: row.rowid,
    bm25: row.bm25,
    rank: idx + 1,
  }));

  return { totalHits, candidates };
}

/**
 * Wrap a thrown SQL error from the FTS adapter as a typed SearchError.
 * Re-exported so test files can simulate failure paths cleanly.
 */
export function wrapFtsError(err: unknown): never {
  throw asSearchError(err, 'QUERY_ERROR', 'FTS MATCH failed');
}