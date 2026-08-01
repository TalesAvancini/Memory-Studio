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
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database as DatabaseType } from 'better-sqlite3';
import { registerAugmentRoute } from './augment.ts';
import { registerHealthRoute, setHealthDb } from './health.ts';
import { initAuditBuffer, startAuditBuffer, stopAuditBuffer } from './audit/lifecycle.ts';
import {
  registerCatalogListRoute,
  registerCatalogRebuildRoute,
  registerAuditListRoute,
  registerAuditSummaryRoute,
} from './routes/index.ts';

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

  await registerHealthRoute(app);
  await registerAugmentRoute(app, {
    onSuccess: recordLastRequestTimestampMs,
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

  await app.listen({ port, host });

  return {
    app,
    url: `http://${host}:${port}`,
    port,
    async close() {
      // Drain the audit buffer BEFORE closing Fastify so events
      // emitted in the shutdown window still flush.
      await stopAuditBuffer();
      await app.close();
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
  createServer({ portRange }).then(
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