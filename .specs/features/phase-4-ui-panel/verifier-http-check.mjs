// Independent Verifier HTTP harness — fires 7 scenarios against a fresh server.
import { createUiServer, createEmptyCatalogReader } from '@memory-studio/ui';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TOGGLE_ITEMS = [
  { id: 'skill-a', type: 'skill', title: 'Skill A', category: 'procedural', text: 'Skill text' },
  { id: 'rule-critical', type: 'rule', critical: true, text: 'Critical rule text' },
  ...['a', 'b', 'c', 'd'].map((s) => ({
    id: `persona-${s}`, type: 'persona', isDefault: s === 'a', text: `Persona ${s.toUpperCase()}`,
  })),
];

const projectRoot = await mkdtemp(join(tmpdir(), 'verifier-phase44-'));
await mkdir(join(projectRoot, 'config', 'catalog'), { recursive: true });
await mkdir(join(projectRoot, '.memory-studio'), { recursive: true });

const seedBytes = JSON.stringify({
  schemaVersion: 3, activeCatalog: ['rule-critical', 'persona-a', 'persona-b', 'persona-c'],
  thresholds: { minCosineSimilarity: 0.5, minFtsHits: 1 },
  fastAgent: { model: 'm', baseURL: 'https://api.example.com/v1' },
  integrationMode: 'proxy', agentId: 'a', tenantId: '', embeddingModel: 'multilingual-e5-small',
  ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
}, null, 2);
const stateFile = join(projectRoot, '.memory-studio', 'state.json');
await writeFile(stateFile, seedBytes, 'utf8');

const server = createUiServer({
  portRange: [50_000, 51_000], projectRoot,
  catalogReader: createEmptyCatalogReader(TOGGLE_ITEMS),
});
const { url } = await server.start();
console.log('VERIFIER: server URL =', url);

async function reseed() {
  await writeFile(stateFile, JSON.stringify({
    schemaVersion: 3, activeCatalog: ['rule-critical', 'persona-a', 'persona-b', 'persona-c'],
    thresholds: { minCosineSimilarity: 0.5, minFtsHits: 1 },
    fastAgent: { model: 'm', baseURL: 'https://api.example.com/v1' },
    integrationMode: 'proxy', agentId: 'a', tenantId: '', embeddingModel: 'multilingual-e5-small',
    ui: { portRange: [41_823, 42_823], stack: 'htmx+alpine' },
  }, null, 2), 'utf8');
}

async function postToggle(body, contentType = 'application/json') {
  return fetch(new URL('state/toggle', url), {
    method: 'POST', headers: { 'content-type': contentType }, body,
  });
}

const results = [];

async function run(name, fn, options = {}) {
  const before = await readFile(stateFile, 'utf8');
  try {
    const r = await fn();
    const after = await readFile(stateFile, 'utf8');
    results.push({ name, ...r, stateUnchanged: before === after });
  } catch (e) {
    results.push({ name, status: 'EXCEPTION', detail: String(e?.message ?? e) });
  }
  if (options.reseed) await reseed();
}

// === 8 SPEC-MANDATED SCENARIOS + DISCRIMINATION ===

await run('1) Valid non-critical toggle (skill-a on)', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'skill-a', action: 'on' }));
  const j = await r.json();
  return { status: r.status, contentType: r.headers.get('content-type'), body: j };
}, { reseed: true });

await run('2) Critical off WITH CONFIRMAR', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: 'CONFIRMAR' }));
  const j = await r.json();
  return { status: r.status, body: j };
}, { reseed: true });

await run('3) Unconfirmed critical off (no field)', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off' }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('4) Fourth persona attempt', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'persona-d', action: 'on' }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('5) Malformed JSON', async () => {
  const r = await postToggle('{ not json');
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('6) Oversized body (>64 KiB)', async () => {
  const big = JSON.stringify({ itemId: 'skill-a', action: 'on', padding: 'x'.repeat(64 * 1024 + 1) });
  const r = await postToggle(big);
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('7) GET on /state/toggle', async () => {
  const r = await fetch(new URL('state/toggle', url), { method: 'GET' });
  return { status: r.status, allowHeader: r.headers.get('allow') };
});

await run('8) Wrong content-type (text/plain)', async () => {
  const r = await fetch(new URL('state/toggle', url), {
    method: 'POST', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ itemId: 'skill-a', action: 'on' }),
  });
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('D1) Padded CONFIRMAR (leading space)', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: ' CONFIRMAR' }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('D2) Padded CONFIRMAR (trailing space)', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: 'CONFIRMAR ' }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('D3) Mixed-case confirmaR', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: 'confirmaR' }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('D4) Boolean critical_confirm=true', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: true }));
  const j = await r.json();
  return { status: r.status, body: j };
});

await run('D5) Numeric critical_confirm=1', async () => {
  const r = await postToggle(JSON.stringify({ itemId: 'rule-critical', action: 'off', critical_confirm: 1 }));
  const j = await r.json();
  return { status: r.status, body: j };
});

console.log('\n=== INDEPENDENT VERIFICATION RESULTS ===');
for (const r of results) {
  console.log(JSON.stringify(r));
}

// === PERFORMANCE INDEPENDENT VERIFICATION ===
// Restart the server to measure fresh-process cold vs warm
await server.close();
const server2 = createUiServer({
  portRange: [50_001, 51_000], projectRoot,
  catalogReader: createEmptyCatalogReader(TOGGLE_ITEMS),
});
const { url: url2 } = await server2.start();
console.log('VERIFIER PERF URL =', url2);
try {
  const tCold = Date.now();
  const coldResp = await fetch(url2);
  await coldResp.text();
  const coldMs = Date.now() - tCold;
  const tWarm = Date.now();
  const warmResp = await fetch(url2);
  await warmResp.text();
  const warmMs = Date.now() - tWarm;
  console.log('VERIFIER PERF:', JSON.stringify({
    coldMs, warmMs,
    coldLt1000: coldMs < 1000, warmLt1000: warmMs < 1000,
    coldGtWarm: coldMs > warmMs, // proves cold did fresh process init
    coldStatus: coldResp.status, warmStatus: warmResp.status,
  }));
} catch (e) {
  console.log('VERIFIER PERF ERROR:', String(e?.message ?? e));
}

await server2.close();
await rm(projectRoot, { recursive: true, force: true }).catch(() => {});
