/**
 * Fastify server bootstrap for the Memory Studio augment endpoint.
 *
 * Phase 5a.1 (T-01) — Server Foundation. Creates a Fastify instance bound
 * to the first free port in `DEFAULT_AUGMENT_PORT_RANGE` (default
 * `[42900, 43000]` — kept distinct from Phase 4's UI range `[41823, 42823]`).
 *
 * Usage:
 *   - Programmatic: `import { createServer } from './server/boot.ts'`
 *   - CLI: `node --experimental-strip-types --no-warnings src/server/boot.ts`
 *     (prints `Memory Studio augment server: http://127.0.0.1:<port>`)
 *
 * Routes registered:
 *   - GET  /health  (see ./health.ts)
 *   - POST /augment (see ./augment.ts — Phase 5a.1 placeholder; full
 *                    retrieval pipeline lands in Phase 5a.2)
 *
 * Server metadata for `/health` (start time + last successful request
 * timestamp) lives in module-scoped variables because Phase 5a.1 runs a
 * single server per process. Tests use Fastify `inject()` for in-process
 * testing without binding a port.
 */

import { createServer as createHttpServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAugmentRoute, getAugmentPipelineProviderOverride } from './augment.ts';
import { registerHealthRoute, setHealthDb } from './health.ts';
import { initAuditBuffer, startAuditBuffer, stopAuditBuffer } from './audit/lifecycle.ts';
import {
  initMetricsBuffer,
  startMetricsBuffer,
  stopMetricsBuffer,
} from './metrics/lifecycle.ts';
import {
  registerCatalogListRoute,
  registerCatalogRebuildRoute,
  registerAuditListRoute,
  registerAuditSummaryRoute,
  registerStateToggleRoute,
  registerMessagesProxyRoute,
  registerMetricsRoute,
  readUpstreamUrl,
} from './routes/index.ts';
import type { PipelineContext } from './augment/pipeline.ts';
import type { Embedder } from '../catalog/embedder/types.ts';
import { EMBEDDING_DIMENSIONS } from '../catalog/embedder/index.ts';
import {
  getMode as getFastAgentMode,
  getModel as getFastAgentModel,
  getEndpoint as getFastAgentEndpoint,
} from './fast-agent/client.ts';
import { setIntelWriterDb } from './fast-agent/writer.ts';
import {
  MultilingualE5SmallEmbedder,
  type Embedder as CatalogEmbedder,
} from '../catalog/embedder/index.ts';
import {
  createProductionContext,
  type ProductionContext,
} from './config/production-context.ts';
import {
  resolveStatePath,
  type StateReader,
} from './config/runtime-state.ts';

/** Runtime mode selected by the caller/entrypoint. */
export type ServerRuntimeMode = 'stub' | 'production';

/** Production embedder factories are injectable for tests and smoke fixtures. */
export type EmbedderFactory = () => CatalogEmbedder | Promise<CatalogEmbedder>;

export interface ProductionServerOptions {
  readonly statePath?: string;
  readonly catalogDir?: string;
  readonly stateReader?: StateReader;
  readonly embedder?: CatalogEmbedder;
  readonly embedderFactory?: EmbedderFactory;
}

async function loadProductionEmbedder(
  options: ProductionServerOptions = {},
): Promise<CatalogEmbedder> {
  const embedder = options.embedder
    ?? (options.embedderFactory !== undefined
      ? await options.embedderFactory()
      : new MultilingualE5SmallEmbedder({ kind: 'query' }));
  const init = (embedder as CatalogEmbedder & { init?: () => Promise<void> }).init;
  if (init !== undefined) await init.call(embedder);
  return embedder;
}

async function assertProductionCatalogDir(catalogDir: string): Promise<void> {
  const info = await stat(catalogDir);
  if (!info.isDirectory()) {
    throw new Error(`production catalog path is not a directory: ${catalogDir}`);
  }
}

async function createProductionRuntime(
  options: AugmentServerOptions,
): Promise<ProductionContext> {
  if (options.db === undefined) {
    throw new Error('production runtime requires an opened catalog DB');
  }
  const production = options.production ?? {};
  const catalogDir = resolve(
    production.catalogDir
      ?? process.env['MEMORY_STUDIO_CATALOG_DIR']
      ?? 'config/catalog',
  );
  await assertProductionCatalogDir(catalogDir);
  const embedder = await loadProductionEmbedder(production);
  const context = createProductionContext({
    db: options.db,
    embedder,
    catalogDir,
    statePath: production.statePath,
    stateReader: production.stateReader,
  });
  // Validate state and model before registering/serving production routes.
  await context.getStateSnapshot();
  return context;
}

export interface AugmentServerOptions {
  portRange?: [number, number];
  host?: string;
  fastifyOptions?: FastifyServerOptions;
  /**
   * Optional better-sqlite3 handle for the audit async runtime
   * (Phase 5b T-03). When provided, `initAuditBuffer(db)` wires the
   * writer so every /augment enqueues an audit event. When omitted,
   * the audit buffer is left uninitialized and the route handler
   * silently skips enqueue (fail-open: audit never blocks the
   * request).
   */
  db?: DatabaseType;
  /**
   * Stub is the default for programmatic tests/smokes. The direct entrypoint
   * selects production whenever MEMORY_STUDIO_CATALOG_DB_PATH is configured.
   */
  runtimeMode?: ServerRuntimeMode;
  /** Required/injected production resources when runtimeMode=production. */
  production?: ProductionServerOptions;
  /**
   * Phase 5b T-13 — transparent /v1/messages proxy options.
   * When omitted, the proxy reads `MEMORY_STUDIO_ANTHROPIC_BASE_URL`
   * from `process.env` (entry-point path). Programmatic callers can
   * pass an explicit `upstreamUrl` (e.g. `null` to force 503).
   */
  proxy?: {
    upstreamUrl?: string | null;
    allowedHostsCsv?: string;
  };
}

export interface AugmentServerHandle {
  app: FastifyInstance;
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Distinct from Phase 4's UI range (41823-42823). Server keeps its own block. */
export const DEFAULT_AUGMENT_PORT_RANGE: readonly [number, number] = [42_900, 43_000];
export const AUGMENT_HOST = '127.0.0.1';

// --- Server metadata shared with /health -------------------------------------
// Module-scoped because Phase 5a.1 runs a single server per process. The
// `lastRequestTimestampMs` is updated by the augment route after every
// successful 200 response; /health reads both to assemble its payload.

let serverStartTimeMs = 0;
let lastRequestTimestampMs = 0;

export function getServerStartTimeMs(): number {
  return serverStartTimeMs;
}

export function getLastRequestTimestampMs(): number {
  return lastRequestTimestampMs;
}

/**
 * Update the `last_request_ts` surfaced by `/health`. Called by the
 * augment route after every successful (200) response. Pass `undefined`
 * to use the current epoch ms.
 */
export function recordLastRequestTimestampMs(timeMs: number = Date.now()): void {
  lastRequestTimestampMs = timeMs;
}

/** Test-only — reset module-scoped metadata between runs. */
export function resetServerMetadataForTests(): void {
  serverStartTimeMs = 0;
  lastRequestTimestampMs = 0;
}

// --- Port discovery ----------------------------------------------------------

async function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const probe = createHttpServer();
    probe.unref();
    probe.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
      } else {
        reject(error);
      }
    });
    probe.listen(port, host, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findFirstFreePort(
  range: readonly [number, number],
  host: string,
): Promise<number> {
  for (let port = range[0]; port <= range[1]; port += 1) {
    if (await isPortFree(port, host)) return port;
  }
  throw new Error(`No free port in ${range[0]}-${range[1]} on ${host}`);
}

// --- Server factory ----------------------------------------------------------

export async function createServer(
  options: AugmentServerOptions = {},
): Promise<AugmentServerHandle> {
  const range = options.portRange ?? DEFAULT_AUGMENT_PORT_RANGE;
  const host = options.host ?? AUGMENT_HOST;
  const port = await findFirstFreePort(range, host);

  const app = Fastify({
    logger: false,
    disableRequestLogging: true,
    ...options.fastifyOptions,
  });

  // Reset metadata so each createServer() call gets a clean start timestamp.
  serverStartTimeMs = Date.now();
  lastRequestTimestampMs = 0;

  // Audit buffer lifecycle (Phase 5b T-03). The buffer is wired BEFORE
  // the route handlers register so the first /augment request can
  // enqueue immediately. If no DB is provided (the in-memory smoke
  // path), the buffer is left uninitialized and the route handler
  // skips enqueue (D-007 fail-open: audit never blocks the request).
  if (options.db !== undefined) {
    initAuditBuffer(options.db);
    await startAuditBuffer();
    setHealthDb(options.db);
  }

  // Phase 6b (T-07) — fast-agent client + Intel writer wiring. The
  // MODE was resolved at module-load by client.ts; here we (a) echo
  // it once more with the resolved endpoint + model so operator
  // logs are self-describing, (b) bind the catalog DB to the writer
  // so the proxy + pipeline can call writeIntelSync() without
  // (re)binding. The env vars MINIMAX_API_KEY (R-02) and
  // MEMORY_STUDIO_FAST_AGENT_MODEL (R-17) are read once at module
  // load (see src/server/fast-agent/client.ts) so the server-side
  // resolution is stable for the lifetime of this process.
  console.log(
    `[boot] fast-agent MODE=${getFastAgentMode()} endpoint=${getFastAgentEndpoint()} model=${getFastAgentModel()}`,
  );
  if (options.db !== undefined) {
    setIntelWriterDb(options.db);
  }

  // Phase 7b T-01 — production is explicit for programmatic callers and
  // mandatory for the env-driven on-disk boot path. The preflight eagerly
  // validates state, catalog directory, and model before routes can serve.
  const runtimeMode = options.runtimeMode ?? 'stub';
  const productionContext = runtimeMode === 'production'
    ? await createProductionRuntime(options)
    : null;
  console.log(`[boot] runtime MODE=${runtimeMode}`);

  // Phase 7a (T-05) — metrics module wiring.
  // initialized AFTER the audit buffer + Intel writer so the
  // metrics module sees the audit + intel lifecycles first
  // (audit owns the DB; intel owns the writer). `startMetricsBuffer`
  // begins the 60s time trigger; `registerMetricsRoute` adds
  // `GET /metrics` to the Fastify instance. The buffer is module-
  // scoped via lifecycle.ts so the route + collectors share the
  // same instance.
  const metricsBuffer = initMetricsBuffer();
  await startMetricsBuffer();
  await registerMetricsRoute(app, { buffer: metricsBuffer });

  await registerHealthRoute(app);
  await registerAugmentRoute(app, {
    onSuccess: recordLastRequestTimestampMs,
    ...(productionContext !== null
      ? { requestContextProvider: () => productionContext.requestContext() }
      : {}),
  });

  // Phase 5b — auxiliary read endpoints. Only register when a DB is
  // provided (these endpoints query SQLite directly). The smoke /
  // in-memory path remains untouched.
  if (options.db !== undefined) {
    await registerCatalogListRoute(app, { db: options.db });
    await registerCatalogRebuildRoute(app, { db: options.db });
    await registerAuditListRoute(app, { db: options.db });
    await registerAuditSummaryRoute(app, { db: options.db });
  }

  // Phase 5b — transparent /v1/messages proxy. Registered whenever an
  // upstream URL is configured (env var MEMORY_STUDIO_ANTHROPIC_BASE_URL
  // for the entry-point path; the explicit `proxy` option for
  // programmatic callers). When the URL is null, the route returns
  // 503 proxy_disabled on every call (the default behavior).
  //
  // Phase 7b T-01/T-02: the proxy now consumes the production
  // context — real embedder + on-disk DB + runtime state snapshot.
  // When `options.db` is set the production context is mandatory; we
  // fail loud on embedder/state load failure rather than silently
  // falling back to the zero-vector stub.
  const proxyUpstreamUrl = options.proxy?.upstreamUrl ?? readUpstreamUrl();
  const proxyAllowedHosts = options.proxy?.allowedHostsCsv
    ?? process.env['MEMORY_STUDIO_PROXY_ALLOWED_HOSTS'];
  await registerMessagesProxyRoute(app, {
    upstreamUrl: proxyUpstreamUrl,
    allowedHostsCsv: proxyAllowedHosts,
    pipelineProvider: () => defaultProxyPipelineContext(options.db),
    ...(productionContext !== null
      ? {
          runtimeContextProvider: (sessionId: string) =>
            productionContext.requestContext({ sessionId }),
        }
      : {}),
  });

  await app.listen({ port, host });

  return {
    app,
    url: `http://${host}:${port}`,
    port,
    async close() {
      // Stop the metrics time interval BEFORE closing Fastify so the
      // interval does not fire during shutdown. Then drain the audit
      // buffer (existing Phase 5b behavior). Then close Fastify.
      // Order matters: metrics has no DB dependency so it stops
      // first; audit owns the DB so it stops before app.close().
      await stopMetricsBuffer();
      await stopAuditBuffer();
      await app.close();
    },
  };
}

/**
 * Resolve a `PipelineContext` for the transparent `/v1/messages` proxy.
 * When a DB is wired AND a pipeline provider override is set, reuse
 * it (proxy requests hit the same catalog as `/augment`); otherwise
 * synthesize a minimal context with a zero-vector stub embedder. The
 * proxy never mutates the catalog, so the db handle is read-only
 * from the proxy's perspective.
 */
function defaultProxyPipelineContext(db: DatabaseType | undefined): PipelineContext {
  if (db !== undefined) {
    const override = getAugmentPipelineProviderOverride();
    if (override !== null) return override();
    return { db, embedder: createStubEmbedder() };
  }
  // No DB: synthesize an in-memory context with a zero-vector embedder.
  // This path keeps the proxy route functional in environments where
  // no catalog DB is wired (smoke, unit tests).
  return {
    db: db as unknown as PipelineContext['db'],
    embedder: createStubEmbedder(),
  };
}

function createStubEmbedder(): Embedder {
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async encode(_text: string): Promise<Float32Array> {
      return new Float32Array(EMBEDDING_DIMENSIONS);
    },
    async embed(text: string): Promise<Float32Array> {
      return this.encode(text);
    },
  };
}

// --- Direct-entry guard ------------------------------------------------------
// When `boot.ts` is run via `node --experimental-strip-types src/server/boot.ts`,
// the file IS the main module. We compare `import.meta.url` (file:// URL) to
// `process.argv[1]` (the entry path) so the factory remains importable
// without side effects.

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  const entryPath = process.argv[1].replace(/\\/g, '/');
  const moduleUrl = import.meta.url;
  return (
    moduleUrl === `file:///${entryPath}` ||
    moduleUrl === `file:///${entryPath.replace(/^\//, '')}` ||
    moduleUrl.endsWith(entryPath)
  );
}

// --- Env-driven port range override -----------------------------------------
// `MEMORY_STUDIO_AUGMENT_PORT_RANGE="lo-hi"` lets users pin the server's
// port-search range without rebuilding. Format: `"42900-43000"`. On any
// parse failure, log a warning to stderr and fall back to
// `DEFAULT_AUGMENT_PORT_RANGE` so the server still boots. The env var is
// only honored when boot.ts is the entry module — programmatic imports
// keep the explicit `options.portRange` for testability.

const PORT_RANGE_ENV_VAR = 'MEMORY_STUDIO_AUGMENT_PORT_RANGE';
const PORT_RANGE_PATTERN = /^(\d+)-(\d+)$/;

export function parsePortRangeEnv(
  raw: string | undefined,
): [number, number] | null {
  if (raw === undefined || raw === '') return null;
  const match = PORT_RANGE_PATTERN.exec(raw);
  if (match === null) return null;
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo < 0 || hi > 65_535 || lo > hi) return null;
  return [lo, hi];
}

if (isMainModule()) {
  const envRange = parsePortRangeEnv(process.env[PORT_RANGE_ENV_VAR]);
  if (process.env[PORT_RANGE_ENV_VAR] !== undefined && envRange === null) {
    console.error(
      `[boot] invalid ${PORT_RANGE_ENV_VAR}=${JSON.stringify(process.env[PORT_RANGE_ENV_VAR])} ` +
        `(expected "lo-hi" with 0 <= lo <= hi <= 65535); falling back to ` +
        `${DEFAULT_AUGMENT_PORT_RANGE[0]}-${DEFAULT_AUGMENT_PORT_RANGE[1]}`,
    );
  }
  const portRange: [number, number] =
    envRange ?? [DEFAULT_AUGMENT_PORT_RANGE[0], DEFAULT_AUGMENT_PORT_RANGE[1]];

  // Optional catalog DB path. When MEMORY_STUDIO_CATALOG_DB_PATH is
  // set, open the on-disk SQLite DB so audit rows persist to disk
  // (otherwise the augment server runs in-memory and audit rows are
  // dropped — see D-007 fail-open semantics). Phase 5b T-14's smoke
  // uses this to verify the proxy writes `messages_proxy` audit rows.
  const dbPath = process.env['MEMORY_STUDIO_CATALOG_DB_PATH'];
  const bootOptions: AugmentServerOptions = { portRange };
  if (dbPath !== undefined && dbPath.trim().length > 0) {
    void import('./catalog/open-on-demand.ts').then(async (mod) => {
      try {
        const db = await mod.openCatalogDbForBoot(dbPath);
        bootOptions.db = db;
        bootOptions.runtimeMode = 'production';
        bootOptions.production = {
          statePath: resolveStatePath({ env: process.env }),
          catalogDir: process.env['MEMORY_STUDIO_CATALOG_DIR'] ?? 'config/catalog',
        };
      } catch (err) {
        console.error(
          `[boot] failed to open MEMORY_STUDIO_CATALOG_DB_PATH=${dbPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      startServer(bootOptions);
    });
  } else {
    startServer(bootOptions);
  }

  function startServer(opts: AugmentServerOptions): void {
    createServer(opts).then(
      (handle) => {
        console.log(`Memory Studio augment server: ${handle.url}`);
        let closing = false;
        const shutdown = async (): Promise<void> => {
          if (closing) return;
          closing = true;
          try {
            await handle.close();
          } finally {
            process.exit(0);
          }
        };
        process.once('SIGINT', () => {
          void shutdown();
        });
        process.once('SIGTERM', () => {
          void shutdown();
        });
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
      },
    );
  }
}