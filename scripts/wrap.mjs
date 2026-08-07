#!/usr/bin/env node
/**
 * wrap.mjs — 1-command Claude Code wrapper for Memory Studio.
 *
 * What it does
 * ------------
 * Boots (or reuses) the local Memory Studio API on 42900 + UI on
 * 41823, then spawns `claude` in the current working directory with
 * ANTHROPIC_BASE_URL pointing at the local proxy.
 *
 * The .claude/settings.json of the target project is patched in
 * place to set ANTHROPIC_BASE_URL while preserving every other key
 * (auth token, permissions, additional directories, model names).
 * A .bak is written on first patch; `wrap --restore` reverts.
 *
 * Why a wrapper, not just `npm run inception:enable`
 * -----------------------------------------------
 * The per-repo `inception:enable` script exists for the Memory
 * Studio repo itself. wrap.mjs is for OTHER projects — the user
 * runs `claude-incept` (or `node scripts/wrap.mjs`) from any
 * project, and the wrapper routes through Memory Studio without
 * requiring the user to know the proxy URL or to edit any
 * settings.json by hand.
 *
 * Usage
 * -----
 *   node scripts/wrap.mjs           # start servers + launch claude
 *   node scripts/wrap.mjs --restore # remove the wrapper, kill servers
 *   node scripts/wrap.mjs --servers # start servers only (no claude spawn)
 *
 * After `claude` exits, the wrapper tears the proxy down only if
 * it started it (existing servers are left alone, as detected by
 * PID before the boot).
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROXY_URL = 'http://127.0.0.1:42900';
const UI_URL = 'http://127.0.0.1:41823';
const PROXY_HEALTH = `${PROXY_URL}/health`;
const UI_PORT_RANGE = [41823, 42823];
const API_PORT_RANGE = [42900, 43000];

const ARGV = process.argv.slice(2);
const RESTORE_MODE = ARGV.includes('--restore');
const SERVERS_ONLY = ARGV.includes('--servers');
const TARGET_DIR = process.cwd();

const _require = createRequire(import.meta.url);
const SETTINGS_PATH = join(TARGET_DIR, '.claude', 'settings.json');
const SETTINGS_BAK = SETTINGS_PATH + '.bak';

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', gray: '\x1b[90m',
};
const c = (col, s) => process.stdout.isTTY ? `${ANSI[col]}${s}${ANSI.reset}` : s;
const log = (msg) => process.stdout.write(msg + '\n');
const die = (msg, code = 1) => { process.stderr.write(c('red', `wrap: ${msg}`) + '\n'); process.exit(code); };

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function isPortOpen(port) {
  // Tries the API on its expected port. Returns true if HTTP responds.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 500);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok || r.status === 503; // 503 = proxy_disabled but server is up
  } catch {
    clearTimeout(t);
    return false;
  }
}

function spawnDetached(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
  child.unref();
  return child;
}

async function waitForApi(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(42900)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function waitForUi(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 500);
      const r = await fetch(UI_URL, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  if (await isPortOpen(42900)) {
    log(c('gray', '  [server] already up on 42900 — reusing'));
    return false; // didn't start
  }
  log(c('cyan', '  [server] starting on 42900…'));
  spawnDetached('node', [
    '--env-file=.env',
    '--experimental-strip-types', '--no-warnings',
    'src/server/boot.ts',
  ], { cwd: REPO_ROOT });
  if (!(await waitForApi())) die('server failed to start within 30s. Check $env:TEMP\\memory-api*.log');
  log(c('green', '  [server] ready on 42900'));
  return true;
}

async function ensureUi() {
  if (await isPortOpen(41823) || await fetch(UI_URL).then(r => r.ok).catch(() => false)) {
    log(c('gray', '  [ui] already up on 41823 — reusing'));
    return false;
  }
  log(c('cyan', '  [ui] starting on 41823…'));
  spawnDetached('node', [
    '--experimental-strip-types', '--no-warnings',
    'scripts/ui-server.mjs',
  ], { cwd: REPO_ROOT });
  if (!(await waitForUi())) die('ui failed to start within 30s');
  log(c('green', '  [ui] ready on 41823'));
  return true;
}

async function patchSettings() {
  if (!(await exists(SETTINGS_PATH))) {
    log(c('yellow', `  [settings] no .claude/settings.json in ${TARGET_DIR} — spawning claude with env only`));
    return false;
  }
  const raw = await readFile(SETTINGS_PATH, 'utf8');
  let json;
  try { json = JSON.parse(raw); } catch (e) {
    die(`.claude/settings.json in ${TARGET_DIR} is not valid JSON: ${e.message}`);
  }
  const prev = json?.env?.ANTHROPIC_BASE_URL;
  if (prev === PROXY_URL) {
    log(c('gray', `  [settings] ANTHROPIC_BASE_URL already → ${PROXY_URL}`));
    return false;
  }
  if (!json.env) json.env = {};
  json.env.ANTHROPIC_BASE_URL = PROXY_URL;
  if (!(await exists(SETTINGS_BAK))) {
    await copyFile(SETTINGS_PATH, SETTINGS_BAK);
    log(c('gray', `  [settings] backup written: ${SETTINGS_BAK}`));
  }
  await writeFile(SETTINGS_PATH, JSON.stringify(json, null, 2) + '\n', 'utf8');
  log(c('green', `  [settings] patched: ANTHROPIC_BASE_URL ${prev ?? '<unset>'} → ${PROXY_URL}`));
  log(c('gray', '             (other keys preserved; auth token, permissions, models untouched)'));
  return true;
}

async function restoreSettings() {
  if (!(await exists(SETTINGS_BAK))) {
    log(c('yellow', `  [settings] no .bak at ${SETTINGS_BAK} — nothing to restore`));
    return;
  }
  const bak = await readFile(SETTINGS_BAK, 'utf8');
  await writeFile(SETTINGS_PATH, bak, 'utf8');
  log(c('green', `  [settings] restored from ${SETTINGS_BAK}`));
}

async function spawnClaude() {
  log('');
  log(c('bold', '  → launching claude in ') + c('cyan', TARGET_DIR));
  log(c('gray', '    env: ANTHROPIC_BASE_URL=' + PROXY_URL));
  log('');
  // Inherit stdio so claude's own UI shows up in this terminal.
  const child = spawn('claude', [], {
    cwd: TARGET_DIR,
    stdio: 'inherit',
    env: { ...process.env, ANTHROPIC_BASE_URL: PROXY_URL },
    windowsHide: true,
  });
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  });
}

async function main() {
  if (RESTORE_MODE) {
    log(c('bold', 'Memory Studio wrap — RESTORE mode'));
    log('');
    await restoreSettings();
    log('');
    log(c('green', '✓ wrapper reverted. Proxy URL removed from .claude/settings.json.'));
    log(c('gray', '  Servers (if any) left running — kill with `npm run server:stop` (TODO) or Ctrl+C in their terminals.'));
    return;
  }

  log(c('bold', 'Memory Studio wrap — 1-command proxy toggle'));
  log(c('gray', `  target: ${TARGET_DIR}`));
  log('');

  const startedServer = await ensureServer();
  await ensureUi();

  if (!SERVERS_ONLY) {
    await patchSettings();
    log('');
    log(c('bold', '  UI: ') + c('cyan', UI_URL) + c('gray', '  (watch the green banner turn green when you talk to claude)'));
    log('');
    const code = await spawnClaude();
    log('');
    log(c('gray', `claude exited with code ${code}.`));
    if (code === 0) {
      log(c('green', '✓ session ended cleanly. Proxy URL still in .claude/settings.json.'));
      log(c('gray', '  run `node scripts/wrap.mjs --restore` in this dir to revert.'));
    } else {
      log(c('yellow', `⚠ session ended with non-zero exit. Settings untouched, can retry or restore.`));
    }
  } else {
    log('');
    log(c('green', '✓ servers up:'));
    log(c('gray', `    API: ${PROXY_URL}`));
    log(c('gray', `    UI:  ${UI_URL}`));
    log(c('gray', '  (no claude spawned — --servers mode)'));
  }
}

main().catch((err) => die(err?.stack ?? String(err)));
