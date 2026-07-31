import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import {
  createDefaultProjectState,
  createUiServer,
  findFirstFreePort,
  UI_HOST,
} from '@memory-studio/ui';

const launcherPath = fileURLToPath(new URL('../../../scripts/ui-server.mjs', import.meta.url));

async function listen(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, UI_HOST, resolve);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function freePort() {
  const probe = await listen();
  const address = probe.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  await close(probe);
  return address.port;
}

async function findFreePair(start, end) {
  for (let first = start; first < end; first += 2) {
    let firstProbe;
    let secondProbe;
    try {
      firstProbe = await listen(first);
      secondProbe = await listen(first + 1);
      return first;
    } catch (error) {
      if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error;
    } finally {
      if (firstProbe) await close(firstProbe);
      if (secondProbe) await close(secondProbe);
    }
  }
  throw new Error('Could not locate two consecutive free ports for test fixture');
}

function launch(portRange) {
  return spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', launcherPath], {
    env: { ...process.env, MEMORY_STUDIO_UI_PORT_RANGE: portRange },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForExit(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const result = await Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Launcher did not exit')), 5_000).unref();
    }),
  ]);
  return result;
}

async function waitForUrl(child) {
  child.stdout.setEncoding('utf8');
  return Promise.race([
    new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) resolve(match[0]);
      });
      child.once('exit', (code) => reject(new Error(`Launcher exited before URL output (${code})`)));
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Launcher did not print a URL')), 5_000).unref();
    }),
  ]);
}

test('server selects the next port when the first is occupied and closes cleanly', async (t) => {
  const first = await findFreePair(44_000, 44_999);
  const occupied = await listen(first);
  t.after(() => close(occupied));

  const server = createUiServer({ portRange: [first, first + 1] });
  t.after(() => server.close());

  const started = await server.start();

  assert.equal(started.port, first + 1);
  assert.equal(started.url, `http://${UI_HOST}:${started.port}/`);
  await server.close();
  await assert.doesNotReject(() => server.close());
});

test('server retries upward when the probed port is claimed before bind', async (t) => {
  const first = await findFreePair(45_000, 45_999);
  const rangeEnd = first + 1;
  const occupiedAfterProbe = await listen(first);
  t.after(() => close(occupiedAfterProbe));
  const requestedRanges = [];
  const selectedByProbe = [];
  const server = createUiServer(
    { portRange: [first, rangeEnd] },
    {
      findPort: async (range) => {
        requestedRanges.push(range);
        if (requestedRanges.length === 1) return first;
        const selected = await findFirstFreePort(range);
        selectedByProbe.push(selected);
        return selected;
      },
    },
  );
  t.after(() => server.close());

  const started = await server.start();

  assert.equal(started.port, selectedByProbe.at(-1));
  assert.deepEqual(requestedRanges, [[first, rangeEnd], [first + 1, rangeEnd]]);
});

test('server returns root and local assets with their contracted content types', async (t) => {
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port] });
  t.after(() => server.close());
  const { url } = await server.start();
  const cases = [
    ['', 'text/html; charset=utf-8', /Memory Studio/],
    ['assets/styles.css', 'text/css; charset=utf-8', /#panel-content/],
    ['assets/htmx.min.js', 'text/javascript; charset=utf-8', /htmx/],
    ['assets/alpine.min.js', 'text/javascript; charset=utf-8', /Alpine/],
    ['assets/app.js', 'text/javascript; charset=utf-8', /uiPanel/],
  ];

  for (const [path, contentType, bodyPattern] of cases) {
    const response = await fetch(new URL(path, url));
    assert.equal(response.status, 200, path || '/');
    assert.equal(response.headers.get('content-type'), contentType, path || '/');
    assert.match(await response.text(), bodyPattern, path || '/');
  }
});

test('server distinguishes unknown routes from unsupported methods', async (t) => {
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port] });
  t.after(() => server.close());
  const { url } = await server.start();

  const missing = await fetch(new URL('missing', url));
  const unsupported = await fetch(url, { method: 'POST' });

  assert.equal(missing.status, 404);
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.get('allow'), 'GET');
});

test('launcher exits non-zero and identifies an exhausted range', async (t) => {
  const occupied = await listen();
  t.after(() => close(occupied));
  const address = occupied.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const range = `${address.port}-${address.port}`;

  const result = await waitForExit(launch(range));

  assert.equal(result.code, 1);
  assert.match(result.stderr, new RegExp(range));
});

test('launcher prints the selected full URL', async (t) => {
  const port = await freePort();
  const child = launch(`${port}-${port}`);
  t.after(() => child.kill());

  const url = await waitForUrl(child);

  assert.equal(url, `http://${UI_HOST}:${port}/`);
  child.kill();
  await waitForExit(child);
});

async function projectFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-ui-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('server exposes five HTML partials and validated project state JSON', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();
  const tabs = ['skills', 'rules', 'personas', 'audit', 'settings'];

  for (const tab of tabs) {
    const response = await fetch(new URL(`ui/${tab}`, url));
    assert.equal(response.status, 200, tab);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', tab);
    assert.match(await response.text(), new RegExp(`data-tab="${tab}"`), tab);
  }

  const stateResponse = await fetch(new URL('state', url));
  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.deepEqual(await stateResponse.json(), createDefaultProjectState());
});

test('provider failure renders a safe HTML partial without filesystem details', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({
    portRange: [port, port],
    projectRoot,
    auditReader: {
      async latest() {
        throw new Error(`catalog failed at ${join(projectRoot, 'private', 'audit.json')}`);
      },
    },
  });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await fetch(new URL('ui/audit', url));
  const body = await response.text();

  assert.equal(response.status, 500);
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(body, /Audit could not be loaded/);
  assert.doesNotMatch(body, /audit\.json|private|memory-studio-ui-server/i);
});

test('malformed project state returns a safe typed JSON conflict', async (t) => {
  const projectRoot = await projectFixture(t);
  const stateDirectory = join(projectRoot, '.memory-studio');
  await mkdir(stateDirectory, { recursive: true });
  const malformed = '{"schemaVersion":3,"secretPath":"C:\\\\private\\\\state.json",';
  await writeFile(join(stateDirectory, 'state.json'), malformed, 'utf8');
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await fetch(new URL('state', url));
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.deepEqual(body, {
    error: { code: 'MALFORMED_STATE', message: 'Project state is invalid' },
  });
  assert.doesNotMatch(JSON.stringify(body), /secretPath|private|state\.json/);
});

test('hash router normalizes empty and unknown hashes and loads known tabs', async (t) => {
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port] });
  t.after(() => server.close());
  const { url } = await server.start();
  const source = await (await fetch(new URL('assets/app.js', url))).text();
  const listeners = new Map();
  const registrations = new Map();
  const requests = [];
  const window = {
    location: { hash: '' },
    htmx: {
      ajax(method, path, options) {
        requests.push({ method, path, options });
      },
    },
  };
  const history = {
    replaceState(_state, _title, hash) {
      window.location.hash = hash;
    },
  };
  vm.runInNewContext(source, {
    document: { addEventListener: (name, listener) => listeners.set(name, listener) },
    Alpine: { data: (name, factory) => registrations.set(name, factory) },
    history,
    window,
  });
  listeners.get('alpine:init')();
  const panel = registrations.get('uiPanel')();

  panel.route();
  assert.equal(panel.tab, 'skills');
  assert.equal(window.location.hash, '#skills');
  assert.equal(requests.at(-1).method, 'GET');
  assert.equal(requests.at(-1).path, '/ui/skills');
  assert.equal(requests.at(-1).options.target, '#panel-content');
  assert.equal(requests.at(-1).options.swap, 'innerHTML');

  window.location.hash = '#unknown';
  panel.route();
  assert.equal(panel.tab, 'skills');
  assert.equal(window.location.hash, '#skills');

  window.location.hash = '#rules';
  panel.route();
  assert.equal(panel.tab, 'rules');
  assert.equal(requests.at(-1).path, '/ui/rules');
});

// =============================================================================
// Phase 4.3 — POST /state/settings (T4.3-2)
// =============================================================================

const VALID_SETTINGS_PATCH = {
  minCosineSimilarity: 0.75,
  minFtsHits: 3,
  tenantId: 'tenant-1',
  integrationMode: 'cli',
  embeddingModel: 'multilingual-e5-small',
};

async function postSettings(url, body, { contentType = 'application/json' } = {}) {
  return fetch(new URL('state/settings', url), {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
}

test('POST /state/settings persists all five fields and preserves unrelated state (UI-21, UI-22)', async (t) => {
  const projectRoot = await projectFixture(t);
  await mkdir(join(projectRoot, '.memory-studio'), { recursive: true });
  await writeFile(
    join(projectRoot, '.memory-studio', 'state.json'),
    JSON.stringify({
      schemaVersion: 3,
      activeCatalog: ['skill-a', 'rule-1'],
      thresholds: { minCosineSimilarity: 0.5, minFtsHits: 4 },
      fastAgent: { model: 'gpt-fast', baseURL: 'https://api.example.com/v1' },
      integrationMode: 'proxy',
      agentId: 'claude-code',
      tenantId: '',
      embeddingModel: 'old-model',
      ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
    }, null, 2),
    'utf8',
  );
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await postSettings(url, JSON.stringify(VALID_SETTINGS_PATCH));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.changed, true);
  assert.equal(payload.state.thresholds.minCosineSimilarity, 0.75);
  assert.equal(payload.state.thresholds.minFtsHits, 3);
  assert.equal(payload.state.tenantId, 'tenant-1');
  assert.equal(payload.state.integrationMode, 'cli');
  assert.equal(payload.state.embeddingModel, 'multilingual-e5-small');
  // Schema-v3 unrelated fields preserved.
  assert.equal(payload.state.schemaVersion, 3);
  assert.deepEqual(payload.state.activeCatalog, ['skill-a', 'rule-1']);
  assert.deepEqual(payload.state.fastAgent, { model: 'gpt-fast', baseURL: 'https://api.example.com/v1' });
  assert.equal(payload.state.agentId, 'claude-code');
  assert.deepEqual(payload.state.ui, { portRange: [41_823, 42_823], stack: 'htmx+alpine' });

  // Subsequent state read confirms the persisted file.
  const reread = await (await fetch(new URL('state', url))).json();
  assert.equal(reread.thresholds.minCosineSimilarity, 0.75);
  assert.equal(reread.integrationMode, 'cli');
});

test('POST /state/settings rejects out-of-range cosine with 400 and leaves state unchanged (UI-23)', async (t) => {
  const projectRoot = await projectFixture(t);
  await mkdir(join(projectRoot, '.memory-studio'), { recursive: true });
  const initialBytes = JSON.stringify({
    schemaVersion: 3,
    activeCatalog: ['skill-keep'],
    thresholds: { minCosineSimilarity: 0.42, minFtsHits: 9 },
    fastAgent: { model: 'MiniMax-M2.7-highspeed', baseURL: 'https://api.minimax.io/anthropic' },
    integrationMode: 'proxy',
    agentId: 'claude-code',
    tenantId: 'before-tenant',
    embeddingModel: 'before-model',
    ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
  }, null, 2);
  await writeFile(
    join(projectRoot, '.memory-studio', 'state.json'),
    initialBytes,
    'utf8',
  );
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const cases = [
    { minCosineSimilarity: 1.01, label: 'above range' },
    { minCosineSimilarity: -0.01, label: 'below range' },
    { minCosineSimilarity: Number.NaN, label: 'NaN (serialized as null)' },
  ];

  for (const overrides of cases) {
    const patch = { ...VALID_SETTINGS_PATCH, ...overrides };
    if (overrides.minCosineSimilarity === Number.NaN) {
      patch.minCosineSimilarity = 'high'; // string → NaN coercion at parse time
      delete patch.minCosineSimilarity;
    }
    const response = await postSettings(url, JSON.stringify(patch));
    const payload = await response.json();
    assert.equal(response.status, 400, `case: ${overrides.label}`);
    assert.equal(payload.error.code, 'INVALID_THRESHOLD');
  }

  // State bytes on disk must remain identical to the pre-attempt snapshot.
  const stateFile = join(projectRoot, '.memory-studio', 'state.json');
  const persistedBytes = await (await import('node:fs/promises')).readFile(stateFile, 'utf8');
  assert.equal(persistedBytes, initialBytes);
});

test('POST /state/settings rejects negative or non-integer minFtsHits with 400 (UI-23)', async (t) => {
  const projectRoot = await projectFixture(t);
  await mkdir(join(projectRoot, '.memory-studio'), { recursive: true });
  const initial = {
    schemaVersion: 3,
    activeCatalog: [],
    thresholds: { minCosineSimilarity: 0.5, minFtsHits: 5 },
    fastAgent: { model: 'm', baseURL: 'https://api.example.com/v1' },
    integrationMode: 'proxy',
    agentId: 'a',
    tenantId: 't',
    embeddingModel: 'e',
    ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
  };
  await writeFile(
    join(projectRoot, '.memory-studio', 'state.json'),
    JSON.stringify(initial, null, 2),
    'utf8',
  );
  const initialBytes = await (await import('node:fs/promises')).readFile(
    join(projectRoot, '.memory-studio', 'state.json'),
    'utf8',
  );
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const cases = [-1, 1.5, 'three'];
  for (const minFtsHits of cases) {
    const response = await postSettings(url, JSON.stringify({ ...VALID_SETTINGS_PATCH, minFtsHits }));
    const payload = await response.json();
    assert.equal(response.status, 400, `minFtsHits: ${String(minFtsHits)}`);
    assert.equal(payload.error.code, 'INVALID_THRESHOLD');
  }

  const persistedBytes = await (await import('node:fs/promises')).readFile(
    join(projectRoot, '.memory-studio', 'state.json'),
    'utf8',
  );
  assert.equal(persistedBytes, initialBytes);
});

test('POST /state/settings rejects unsupported integrationMode with 400 (UI-23)', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const cases = ['websocket', 'PROXY', ''];
  for (const integrationMode of cases) {
    const response = await postSettings(url, JSON.stringify({ ...VALID_SETTINGS_PATCH, integrationMode }));
    const payload = await response.json();
    assert.equal(response.status, 400, `mode: ${integrationMode}`);
    assert.equal(payload.error.code, 'UNSUPPORTED_INTEGRATION_MODE');
  }
});

test('POST /state/settings rejects empty tenantId/embeddingModel with 400 (UI-23)', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const cases = [
    { tenantId: '', label: 'empty tenantId' },
    { embeddingModel: '', label: 'empty embeddingModel' },
  ];
  for (const overrides of cases) {
    const response = await postSettings(url, JSON.stringify({ ...VALID_SETTINGS_PATCH, ...overrides }));
    const payload = await response.json();
    assert.equal(response.status, 400, overrides.label);
    assert.equal(payload.error.code, 'MISSING_STRING_FIELD');
  }
});

test('POST /state/settings rejects non-JSON body with 400 and typed error envelope', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await postSettings(url, '{ not json');
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'MALFORMED_BODY');
});

test('POST /state/settings rejects non-object body with 400 and typed error envelope', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await postSettings(url, JSON.stringify([1, 2, 3]));
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error.code, 'MALFORMED_BODY');
});

test('POST /state/settings returns 405 for non-POST methods', async (t) => {
  const projectRoot = await projectFixture(t);
  const port = await freePort();
  const server = createUiServer({ portRange: [port, port], projectRoot });
  t.after(() => server.close());
  const { url } = await server.start();

  const response = await fetch(new URL('state/settings', url), { method: 'GET' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
});

