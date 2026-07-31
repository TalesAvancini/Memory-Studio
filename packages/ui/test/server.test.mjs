import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createUiServer, findFirstFreePort, UI_HOST } from '@memory-studio/ui';

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
