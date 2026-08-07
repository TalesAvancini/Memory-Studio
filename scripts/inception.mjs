#!/usr/bin/env node
/**
 * inception.mjs — one-command enable/disable/status for the Memory Studio
 * proxy on Claude Code.
 *
 * What it does
 * ------------
 * Patches `<repo>/.claude/settings.json` so that
 * `env.ANTHROPIC_BASE_URL` points at the local Memory Studio server
 * (default `http://127.0.0.1:42900`). On disable, restores the previous
 * value from a `.bak` written the first time enable runs.
 *
 * Why a script (and not "just edit the JSON")
 * -----------------------------------------
 * The settings.json file is tracked in git and contains a real
 * `ANTHROPIC_AUTH_TOKEN`. A naive `node -e "fs.writeFileSync(...)"`
 * rewrite would either overwrite the token or, worse, leave the file
 * in a state where the user commits the proxy URL by accident. This
 * script:
 *   - reads the existing JSON
 *   - mutates only `env.ANTHROPIC_BASE_URL` (preserves `permissions`,
 *     `additionalDirectories`, `ANTHROPIC_AUTH_TOKEN`, every other key)
 *   - writes back with the same 2-space indent the file shipped with
 *   - keeps a `.bak` for the round-trip
 *
 * Subcommands
 * -----------
 *   enable   - patch settings.json + .bak the previous state
 *   disable  - restore from .bak (or no-op if no .bak exists)
 *   status   - show the current ANTHROPIC_BASE_URL + ping the server
 *
 * Limitations (YAGNI — not handled on purpose)
 * -------------------------------------------
 * - Only edits Claude Code's per-repo `.claude/settings.json`. Other
 *   agents (Cursor, Windsurf, Cline, Aider) use their own config files
 *   and are out of scope.
 * - The env var is only re-read by Claude Code on spawn. After
 *   `enable` / `disable`, any `claude` session already running keeps
 *   the old value. The script prints a one-liner telling the user to
 *   kill + reopen.
 */

import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const SETTINGS_PATH = join(REPO_ROOT, '.claude', 'settings.json');
const BACKUP_PATH = SETTINGS_PATH + '.bak';
const PROXY_URL = 'http://127.0.0.1:42900';
const PROXY_HEALTH = `${PROXY_URL}/health`;

const SUBCOMMAND = process.argv[2];

function log(msg) {
  process.stdout.write(msg + '\n');
}

function die(msg, code = 1) {
  process.stderr.write(`inception: ${msg}\n`);
  process.exit(code);
}

async function exists(p) {
  try { await access(p, FS.F_OK); return true; }
  catch { return false; }
}

async function readJsonSafe(p) {
  const raw = await readFile(p, 'utf8');
  return { raw, json: JSON.parse(raw) };
}

async function writeJson(p, json) {
  // 2-space indent matches the file's shipped style (settings.json
  // uses 2 spaces; we keep that exact format on round-trip).
  const out = JSON.stringify(json, null, 2) + '\n';
  await writeFile(p, out, 'utf8');
}

/**
 * Read the current ANTHROPIC_BASE_URL (or null if not set).
 * Walks the JSON defensively so a missing `env` block doesn't crash.
 */
function currentBaseUrl(json) {
  return json?.env?.ANTHROPIC_BASE_URL ?? null;
}

/**
 * Set env.ANTHROPIC_BASE_URL while preserving every other key in the
 * file. Creates `env` if missing. Returns the previous value.
 */
function setBaseUrl(json, value) {
  const prev = currentBaseUrl(json);
  if (!json.env) json.env = {};
  json.env.ANTHROPIC_BASE_URL = value;
  return prev;
}

async function cmdEnable() {
  if (!(await exists(SETTINGS_PATH))) {
    die(`.claude/settings.json not found at ${SETTINGS_PATH}. ` +
        `Are you running this from the Memory Studio repo root?`, 2);
  }

  const { raw, json } = await readJsonSafe(SETTINGS_PATH);
  const prev = currentBaseUrl(json);

  if (prev === PROXY_URL) {
    log(`✓ inception already enabled (ANTHROPIC_BASE_URL=${PROXY_URL}). Nothing to do.`);
    return;
  }

  setBaseUrl(json, PROXY_URL);

  // Backup strategy:
  //   - if .bak does not exist, write the current raw file (pre-patch)
  //   - if .bak exists, leave it alone (so multiple enable/disable
  //     round-trips always restore to the ORIGINAL pre-inception state,
  //     not to whatever the last `disable` produced)
  if (!(await exists(BACKUP_PATH))) {
    await copyFile(SETTINGS_PATH, BACKUP_PATH);
    log(`  backup written: ${BACKUP_PATH}`);
  }

  await writeJson(SETTINGS_PATH, json);

  log(`✓ patched .claude/settings.json:`);
  log(`    ANTHROPIC_BASE_URL: ${prev ?? '<unset>'} → ${PROXY_URL}`);
  log(`    other keys preserved (auth token, permissions, etc.)`);
  log('');
  log('⚠  kill any running `claude` and reopen it. Claude Code reads');
  log('   env vars at spawn time, not on every request.');
}

async function cmdDisable() {
  if (!(await exists(SETTINGS_PATH))) {
    log('.claude/settings.json not found — nothing to disable.');
    return;
  }
  if (!(await exists(BACKUP_PATH))) {
    log('no .bak found — inception was never enabled here, or the .bak');
    log('was removed. Leaving settings.json as-is.');
    return;
  }

  const backup = await readJsonSafe(BACKUP_PATH);
  await writeJson(SETTINGS_PATH, backup.json);

  const prev = currentBaseUrl(backup.json);
  log(`✓ restored .claude/settings.json from .bak.`);
  log(`    ANTHROPIC_BASE_URL: ${PROXY_URL} → ${prev ?? '<unset>'}`);
  log('');
  log('⚠  kill any running `claude` and reopen it for the change to take effect.');
}

async function cmdStatus() {
  let enabled = false;
  let currentUrl = null;
  if (await exists(SETTINGS_PATH)) {
    try {
      const { json } = await readJsonSafe(SETTINGS_PATH);
      currentUrl = currentBaseUrl(json);
      enabled = currentUrl === PROXY_URL;
    } catch (err) {
      log(`⚠  could not parse .claude/settings.json: ${err.message}`);
    }
  } else {
    log('(no .claude/settings.json)');
  }

  log(`inception status:`);
  log(`  ANTHROPIC_BASE_URL = ${currentUrl ?? '<unset>'}`);
  log(`  inception enabled  = ${enabled}`);
  log(`  proxy expected at  = ${PROXY_URL}`);

  // Probe the proxy. Short timeout — we don't want `status` to hang.
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(PROXY_HEALTH, { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      log(`  proxy health      = OK (uptime ${Math.round((j.uptime_ms ?? 0) / 1000)}s, catalog count ${j.catalog?.count ?? '?'})`);
    } else {
      log(`  proxy health      = HTTP ${res.status} (is the server running?)`);
    }
  } catch (err) {
    log(`  proxy health      = unreachable (${err.name === 'AbortError' ? 'timeout' : err.message})`);
    log('                      start it with: npm run server:start');
  }

  if (enabled) {
    log('');
    log('✓ ready. Open (or reopen) Claude Code in this repo to use the proxy.');
  } else {
    log('');
    log('to enable: node scripts/inception.mjs enable');
  }
}

async function main() {
  switch (SUBCOMMAND) {
    case 'enable':  return cmdEnable();
    case 'disable': return cmdDisable();
    case 'status':  return cmdStatus();
    default:
      log('usage: node scripts/inception.mjs <enable|disable|status>');
      die(`unknown subcommand: ${SUBCOMMAND ?? '(none)'}`, 2);
  }
}

main().catch((err) => {
  die(err?.stack ?? String(err));
});
