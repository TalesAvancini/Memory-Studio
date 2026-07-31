import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const stylesPath = fileURLToPath(new URL('../public/styles.css', import.meta.url));
const indexPath = fileURLToPath(new URL('../public/index.html', import.meta.url));

const styles = await readFile(stylesPath, 'utf8');
const index = await readFile(indexPath, 'utf8');

test('root shell sets html/body margin to 0 and keeps body inside the 72rem container', () => {
  assert.match(styles, /html,\s*body\s*{[^}]*margin:\s*0;[^}]*}/);
  assert.match(styles, /body\s*{[^}]*max-width:\s*72rem;[^}]*overflow-x:\s*hidden;[^}]*}/);
});

test('catalog layout switches to a two-column grid at viewport widths of 1024 px and above', () => {
  assert.match(styles, /\.catalog-layout\s*{[^}]*display:\s*grid;[^}]*}/);
  assert.match(styles, /@media\s*\(min-width:\s*64rem\)/);
  assert.match(
    styles,
    /\.catalog-layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.6fr\)\s*minmax\(0,\s*1fr\);[^}]*}/,
  );
});

test('catalog rows, lists, and side panels allow long IDs and content to wrap without widening the page', () => {
  assert.match(styles, /\.catalog-list[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?word-break:\s*break-word;/);
  assert.match(styles, /\.catalog-side-panel\s*{[^}]*min-width:\s*0;[^}]*}/);
  assert.match(styles, /#panel-content > \*[^{]*\{[^}]*min-width:\s*0;[^}]*\}/);
});

test('critical modal is a fixed positioned dialog with focusable confirmation input and accessible labeling', () => {
  // The browser test file already asserts the markup rendered with role="dialog",
  // aria-modal, and aria-labelledby attributes. Here we lock the CSS contract for
  // the dialog overlay (fixed positioning, full viewport, centered content).
  assert.match(styles, /\.catalog-modal\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*}/);
  assert.match(styles, /\.catalog-modal-content\s*{[^}]*background:\s*Canvas;[^}]*}/);
});

test('root shell renders the tablist as a navigation region with role=tab and aria-current on the active tab', () => {
  assert.match(index, /<nav[^>]*role="tablist"/);
  assert.match(index, /aria-label="Memory Studio sections"/);
  assert.match(index, /role="tab"/);
  assert.match(index, /aria-current="tab === 'skills' \? 'page' : null"/);
  // All five hash anchors must be present with stable ids.
  for (const hash of ['#skills', '#rules', '#personas', '#audit', '#settings']) {
    assert.match(index, new RegExp(`href="${hash.replace('#', '#')}"`));
  }
});

test('root shell has no remote stylesheet/framework dependency and no bundler reference', () => {
  assert.doesNotMatch(index, /https?:\/\//i);
  assert.doesNotMatch(index, /cdn\./i);
  assert.doesNotMatch(index, /\bwebpack\b|\brollup\b|\bvite\b|\bparcel\b|\besbuild\b/i);
  assert.doesNotMatch(index, /<script[^>]*src="\/assets\/[^"]*"[^>]*type="module"/);
  // The defer attribute keeps the static asset contract buildless.
  assert.match(index, /<script defer src="\/assets\/htmx\.min\.js"/);
  assert.match(index, /<script defer src="\/assets\/alpine\.min\.js"/);
  assert.match(index, /<script defer src="\/assets\/app\.js"/);
});

test('root shell exposes a stable responsive container via #panel-content', () => {
  assert.match(styles, /#panel-content\s*{[^}]*min-width:\s*0;[^}]*}/);
  assert.match(index, /id="panel-content"[^>]*aria-live="polite"/);
});

test('catalog detail content and controls wrap within their grid tracks', () => {
  assert.match(styles, /\.catalog-detail-text\s*{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;[^}]*}/);
  assert.match(styles, /\.catalog-row-select\s*{[^}]*flex:\s*1 1 auto;[^}]*max-width:\s*100%;[^}]*}/);
  assert.match(styles, /\.catalog-search input\s*{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*}/);
});

test('catalog layout uses border-box sizing for the 1024px viewport boundary', () => {
  assert.match(styles, /\*,\s*\*::before,\s*\*::after\s*{[^}]*box-sizing:\s*border-box;[^}]*}/);
  assert.match(styles, /body\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*}/);
});
