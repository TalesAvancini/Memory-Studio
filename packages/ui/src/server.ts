import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PORT_RANGE,
  PortRangeExhaustedError,
  UI_HOST,
  findFirstFreePort,
  type PortRange,
} from './port.ts';
import { createEmptyAuditReader, type AuditReader } from './audit.ts';
import type { CatalogReader } from './catalog.ts';
import {
  createDefaultPartialRenderers,
  renderSafeErrorPartial,
  type UiPartialRenderers,
} from './render.ts';
import {
  ProjectStateConflictError,
  createProjectStateStore,
  validateProjectState,
  type ProjectStateStore,
} from './state.ts';
import type { UiTab } from './index.ts';

const DEFAULT_PUBLIC_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url));

const STATIC_FILES = new Map<string, readonly [fileName: string, contentType: string]>([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/assets/htmx.min.js', ['htmx.min.js', 'text/javascript; charset=utf-8']],
  ['/assets/alpine.min.js', ['alpine.min.js', 'text/javascript; charset=utf-8']],
  ['/assets/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

const PARTIAL_ROUTES = new Map<string, UiTab>([
  ['/ui/skills', 'skills'],
  ['/ui/rules', 'rules'],
  ['/ui/personas', 'personas'],
  ['/ui/audit', 'audit'],
  ['/ui/settings', 'settings'],
]);

export interface UiServerOptions {
  portRange?: PortRange;
  publicDirectory?: string;
  projectRoot?: string;
  stateStore?: Pick<ProjectStateStore, 'read'>;
  auditReader?: AuditReader;
  catalogReader?: Pick<CatalogReader, 'list'>;
  partialRenderers?: Partial<UiPartialRenderers>;
}

export interface UiServerDependencies {
  findPort(range: PortRange): Promise<number>;
}

export interface UiServer {
  start(): Promise<{ url: string; port: number }>;
  close(): Promise<void>;
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

function sendHtml(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function isAddressInUse(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

async function bind(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, UI_HOST);
  });
}

export function createUiServer(
  options: UiServerOptions = {},
  dependencies: UiServerDependencies = { findPort: findFirstFreePort },
): UiServer {
  const range = options.portRange ?? DEFAULT_PORT_RANGE;
  const publicDirectory = options.publicDirectory ?? DEFAULT_PUBLIC_DIRECTORY;
  const stateStore = options.stateStore ?? createProjectStateStore(options.projectRoot ?? process.cwd());
  const partialRenderers: UiPartialRenderers = {
    ...createDefaultPartialRenderers(
      stateStore,
      options.auditReader ?? createEmptyAuditReader(),
      { catalogReader: options.catalogReader },
    ),
    ...options.partialRenderers,
  };
  let activeServer: Server | undefined;
  let activeAddress: { url: string; port: number } | undefined;
  let starting: Promise<{ url: string; port: number }> | undefined;

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      sendText(response, 405, 'Method Not Allowed');
      return;
    }

    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/state') {
      try {
        const state = await stateStore.read();
        validateProjectState(state);
        sendJson(response, 200, state);
      } catch (error) {
        const conflict = error instanceof ProjectStateConflictError;
        sendJson(response, conflict ? 409 : 500, {
          error: {
            code: conflict ? error.code : 'STATE_READ_FAILED',
            message: conflict ? 'Project state is invalid' : 'Project state could not be loaded',
          },
        });
      }
      return;
    }

    const tab = PARTIAL_ROUTES.get(pathname);
    if (tab) {
      try {
        sendHtml(response, 200, await partialRenderers[tab]());
      } catch {
        sendHtml(response, 500, renderSafeErrorPartial(tab));
      }
      return;
    }

    const asset = STATIC_FILES.get(pathname);
    if (!asset) {
      sendText(response, 404, 'Not Found');
      return;
    }

    try {
      const body = await readFile(join(publicDirectory, asset[0]));
      response.writeHead(200, { 'content-type': asset[1] });
      response.end(body);
    } catch {
      sendText(response, 500, 'Internal Server Error');
    }
  }

  async function performStart(): Promise<{ url: string; port: number }> {
    let scanStart = range[0];
    while (scanStart <= range[1]) {
      const port = await dependencies.findPort([scanStart, range[1]]);
      const candidate = createServer((request, response) => {
        void handleRequest(request, response);
      });
      try {
        await bind(candidate, port);
        activeServer = candidate;
        activeAddress = { url: `http://${UI_HOST}:${port}/`, port };
        return activeAddress;
      } catch (error) {
        if (!isAddressInUse(error)) throw error;
        // A process can claim the port after the probe closes; continue upward.
        scanStart = port + 1;
      }
    }
    throw new PortRangeExhaustedError(range);
  }

  return {
    start() {
      if (activeAddress) return Promise.resolve(activeAddress);
      if (!starting) {
        starting = performStart().finally(() => {
          starting = undefined;
        });
      }
      return starting;
    },
    async close() {
      const server = activeServer;
      activeServer = undefined;
      activeAddress = undefined;
      if (!server?.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };
}
