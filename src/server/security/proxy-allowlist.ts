/**
 * Proxy local-only enforcement (PRD §10.3.4 / Phase 5b T-12).
 *
 * The transparent `/v1/messages` proxy (`src/server/routes/messages-proxy.ts`)
 * forwards requests to an upstream Anthropic-compatible provider. Per the
 * spec, the upstream URL must be on the loopback allowlist (127.0.0.1,
 * localhost, ::1) unless the operator has explicitly extended the allowlist
 * via the `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` env var (comma-separated).
 *
 * The check is intentionally URL-string-based (no DNS resolution) so it
 * is reproducible, fast, and not subject to DNS rebinding at decision
 * time. The forward `fetch()` resolves DNS at request time; if the
 * operator wants true DNS-rebinding safety they can configure a custom
 * `lookup` function (out of MVP scope per spec.md A-19).
 *
 * `assertLoopback(url)` throws a typed error if the host is not
 * loopback. The transparent proxy catches the throw and returns
 * `502 {error: 'proxy_host_not_allowed'}` to the caller.
 */

export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '::1',
]);

/**
 * Resolve the allowlist: when `allowedHostsCsv` is provided, parse and
 * use it (REPLACES the default loopback set — does NOT append). When
 * omitted, return the default loopback set.
 *
 * Wildcard `*` is REJECTED (PRD §10.3.4 forbids any-host allow). Empty
 * entries are skipped. Whitespace is trimmed. Comparison is
 * case-insensitive (DNS hostnames are case-insensitive).
 */
function resolveAllowlist(allowedHostsCsv?: string): {
  readonly hosts: ReadonlySet<string>;
  readonly wildcardRejected: boolean;
  readonly csvProvided: boolean;
} {
  if (allowedHostsCsv === undefined) {
    return { hosts: LOOPBACK_HOSTS, wildcardRejected: false, csvProvided: false };
  }
  const entries = allowedHostsCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  if (entries.includes('*')) {
    return { hosts: new Set(), wildcardRejected: true, csvProvided: true };
  }
  return { hosts: new Set(entries), wildcardRejected: false, csvProvided: true };
}

/**
 * Error thrown when an upstream URL is not on the allowlist.
 *
 * The proxy route catches this and returns 502 `proxy_host_not_allowed`.
 * Other callers (e.g. test fixtures) can match by class or by `host`.
 */
export class ProxyHostNotAllowedError extends Error {
  readonly host: string | null;
  readonly wildcardRejected: boolean;

  constructor(host: string | null, message: string, wildcardRejected = false) {
    super(message);
    this.name = 'ProxyHostNotAllowedError';
    this.host = host;
    this.wildcardRejected = wildcardRejected;
  }
}

/**
 * Assert that the URL's host is on the loopback allowlist (or an
 * explicit `MEMORY_STUDIO_PROXY_ALLOWED_HOSTS` extension). Throws
 * `ProxyHostNotAllowedError` on mismatch. Returns the lowercase host
 * on success (callers may want it for logging).
 *
 * Edge cases handled:
 *   - Empty/null URL string → throws
 *   - Unparseable URL → throws (the URL constructor is strict)
 *   - Empty hostname (e.g. `http:///foo`) → throws
 *   - IPv6 bracket form `http://[::1]/foo` → hostname normalized to `::1`
 *   - Wildcard `*` in CSV → throws (no any-host allow)
 *   - Case-insensitive hostname comparison
 */
export function assertLoopback(
  url: URL | string,
  allowedHostsCsv?: string,
): string {
  const parsed = typeof url === 'string' ? parseUrl(url) : url;
  if (parsed === null) {
    throw new ProxyHostNotAllowedError(null, 'invalid_upstream_url');
  }
  // URL.hostname returns IPv6 hosts with brackets (e.g. `[::1]`).
  // Strip brackets so the comparison against LOOPBACK_HOSTS uses the
  // bare form `::1`.
  const rawHost = parsed.hostname.trim().toLowerCase();
  const host = rawHost.startsWith('[') && rawHost.endsWith(']')
    ? rawHost.slice(1, -1)
    : rawHost;
  if (host.length === 0) {
    throw new ProxyHostNotAllowedError(null, 'upstream_url_missing_host');
  }
  const { hosts, wildcardRejected, csvProvided } = resolveAllowlist(allowedHostsCsv);
  if (wildcardRejected) {
    throw new ProxyHostNotAllowedError(
      host,
      'wildcard_not_allowed_in_allowlist',
      true,
    );
  }
  // When the operator supplies an explicit CSV, REPLACE the default
  // loopback set (don't append). When the CSV is absent, fall back to
  // the default loopback set. This matches the spec: the operator
  // controls the allowlist via env var.
  const allowSet = csvProvided ? hosts : LOOPBACK_HOSTS;
  if (allowSet.has(host)) {
    return host;
  }
  throw new ProxyHostNotAllowedError(
    host,
    `upstream_host_not_loopback:${host}`,
  );
}

function parseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Structured result variant of the check. Useful for callers that
 * prefer a return value over a throw. The proxy route uses
 * `assertLoopback` (throw-based) for the inline allowlist gate; this
 * helper is the non-throwing counterpart used by the boot wiring log
 * line.
 */
export function checkProxyAllowlist(
  urlString: string,
  allowedHostsCsv?: string,
): { allowed: boolean; host: string | null; wildcardRejected: boolean } {
  try {
    const host = assertLoopback(urlString, allowedHostsCsv);
    return { allowed: true, host, wildcardRejected: false };
  } catch (err) {
    if (err instanceof ProxyHostNotAllowedError) {
      return {
        allowed: false,
        host: err.host,
        wildcardRejected: err.wildcardRejected,
      };
    }
    return { allowed: false, host: null, wildcardRejected: false };
  }
}
