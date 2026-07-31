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
import {
  TransitionRequestError,
  applySettingsPatch,
  type SettingsRequest,
} from './transitions.ts';
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

const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface UiServerOptions {
  portRange?: PortRange;
  publicDirectory?: string;
  projectRoot?: string;
  stateStore?: Pick<ProjectStateStore, 'read' | 'update'>;
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

async function readJsonBody(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; message: string }> {
  const contentType = request.headers['content-type'];
  const contentTypeString = Array.isArray(contentType) ? contentType.join(',') : (contentType ?? '');
  if (!contentTypeString.toLowerCase().includes('application/json')) {
    return { ok: false, status: 415, message: 'Content-Type must be application/json' };
  }
  const contentLengthHeader = request.headers['content-length'];
  if (typeof contentLengthHeader === 'string' && Number(contentLengthHeader) > MAX_JSON_BODY_BYTES) {
    return { ok: false, status: 413, message: `Request body exceeds ${MAX_JSON_BODY_BYTES} bytes` };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      return { ok: false, status: 413, message: `Request body exceeds ${MAX_JSON_BODY_BYTES} bytes` };
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return { ok: false, status: 400, message: 'Request body must be a JSON object' };
  }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, message: 'Request body must be valid JSON' };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  async function handleSettings(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request);
    if (!body.ok) {
      sendJson(response, body.status, {
        error: { code: body.status === 413 ? 'PAYLOAD_TOO_LARGE' : body.status === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'MALFORMED_BODY', message: body.message },
      });
      return;
    }
    if (!isPlainObject(body.value)) {
      sendJson(response, 400, {
        error: { code: 'MALFORMED_BODY', message: 'Settings request must be a JSON object' },
      });
      return;
    }
    const patch: SettingsRequest = body.value;
    try {
      const result = await applySettingsPatch(patch, stateStore);
      sendJson(response, 200, { ok: true, state: result.state, changed: result.changed });
    } catch (error) {
      if (error instanceof TransitionRequestError) {
        sendJson(response, 400, {
          error: { code: error.code, message: error.message },
        });
        return;
      }
      sendJson(response, 500, {
        error: { code: 'STATE_WRITE_FAILED', message: 'Settings could not be persisted' },
      });
    }
  }

  async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/state/settings') {
      if (request.method !== 'POST') {
        response.setHeader('allow', 'POST');
        sendText(response, 405, 'Method Not Allowed');
        return;
      }
      await handleSettings(request, response);
      return;
    }

    if (request.method !== 'GET') {
      response.setHeader('allow', 'GET');
      sendText(response, 405, 'Method Not Allowed');
      return;
    }

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
