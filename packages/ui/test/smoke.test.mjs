import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
