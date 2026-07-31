import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUiServer, UI_HOST } from '@memory-studio/ui';

const publicUrl = new URL('../public/', import.meta.url);

async function readPublicFile(name) {
  return readFile(new URL(name, publicUrl), 'utf8');
}

test('workspace package imports with the five public tabs', async () => {
  const ui = await import('@memory-studio/ui');

  assert.deepEqual(ui.UI_TABS, ['skills', 'rules', 'personas', 'audit', 'settings']);
});

test('shell exposes exactly five labeled hash anchors and one content target', async () => {
  const html = await readPublicFile('index.html');
  const anchors = [...html.matchAll(/<a\b[^>]*href="#([^"]+)"[^>]*>([^<]+)<\/a>/g)];

  assert.deepEqual(
    anchors.map((match) => [match[1], match[2].trim()]),
    [
      ['skills', 'Skills'],
      ['rules', 'Rules'],
      ['personas', 'Personas'],
      ['audit', 'Audit'],
      ['settings', 'Settings'],
    ],
  );
  assert.equal((html.match(/\bid="panel-content"/g) ?? []).length, 1);
});

test('shell references only local buildless framework and style assets', async () => {
  const html = await readPublicFile('index.html');

  assert.match(html, /src="\/assets\/htmx\.min\.js"/);
  assert.match(html, /src="\/assets\/alpine\.min\.js"/);
  assert.match(html, /src="\/assets\/app\.js"/);
  assert.match(html, /href="\/assets\/styles\.css"/);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /cdn/i);
});

test('vendored HTMX and Alpine assets identify supported local versions', async () => {
  const [htmx, alpine] = await Promise.all([
    readPublicFile('htmx.min.js'),
    readPublicFile('alpine.min.js'),
  ]);

  assert.match(htmx, /htmx[^\n]*1\.9\./i);
  assert.match(alpine, /Alpine[^\n]*3\./i);
});

async function listen(port = 0) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, UI_HOST, resolve);
  });
  return server;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function projectFixture() {
  const root = await mkdtemp(join(tmpdir(), 'memory-studio-ui-smoke-'));
  await mkdir(join(root, 'config', 'catalog'), { recursive: true });
  return root;
}

test('five-tab smoke flow fetches root, partials, state, and local assets', async (t) => {
  const projectRoot = await projectFixture();
  const probe = await listen();
  const address = probe.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');
  const port = address.port;
  await close(probe);

  const server = createUiServer({
    portRange: [port, port],
    projectRoot,
  });
  t.after(async () => {
    await server.close();
    await rm(projectRoot, { recursive: true, force: true });
  });
  const { url } = await server.start();

  const routes = [
    { path: '/', type: 'text/html; charset=utf-8', marker: 'Memory Studio' },
    { path: '/ui/skills', type: 'text/html; charset=utf-8', marker: 'data-tab="skills"' },
    { path: '/ui/rules', type: 'text/html; charset=utf-8', marker: 'data-tab="rules"' },
    { path: '/ui/personas', type: 'text/html; charset=utf-8', marker: 'data-tab="personas"' },
    { path: '/ui/audit', type: 'text/html; charset=utf-8', marker: 'data-tab="audit"' },
    { path: '/ui/settings', type: 'text/html; charset=utf-8', marker: 'data-tab="settings"' },
    { path: '/state', type: 'application/json; charset=utf-8', marker: '"schemaVersion":3' },
    { path: '/assets/styles.css', type: 'text/css; charset=utf-8', marker: '#panel-content' },
    { path: '/assets/htmx.min.js', type: 'text/javascript; charset=utf-8', marker: 'htmx' },
    { path: '/assets/alpine.min.js', type: 'text/javascript; charset=utf-8', marker: 'Alpine' },
    { path: '/assets/app.js', type: 'text/javascript; charset=utf-8', marker: 'uiPanel' },
  ];

  for (const route of routes) {
    const response = await fetch(new URL(route.path, url));
    assert.equal(response.status, 200, route.path);
    assert.equal(response.headers.get('content-type'), route.type, route.path);
    assert.match(await response.text(), new RegExp(route.marker), route.path);
  }
});
