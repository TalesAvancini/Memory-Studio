#!/usr/bin/env node
/**
 * scripts/smoke-metrics.mjs — Phase 7a T-07
 *
 * End-to-end smoke that proves the GET /metrics endpoint returns a
 * well-formed snapshot after driving real /augment requests
 * through the Fastify server.
 *
 * Flow:
 *   1. Boot the in-process server on a fresh port in [48300, 48399]
 *      (distinct from the [42900, 43000] block that has the test#366
 *      port-exhaustion flake AND distinct from the [47700, 47799]
 *      Phase 6b smoke range).
 *   2. Drive 10 /augment requests — all with empty activeCatalog,
 *      producing 10 persona-only "no_active_items" responses. These
 *      are EXCLUDED from the R-1 denominator per spec.md R-1.
 *      Latency IS captured for all 10 (R-3/R-4).
 *   3. GET /metrics → assert:
 *      - schema_version === 1
 *      - request_hit_rate === null (no "measured" requests)
 *      - p50_latency_ms > 0 (latencies captured)
 *      - p99_latency_ms > 0
 *      - working_set_mb > 0
 *      - proxy_enabled === false (env unset)
 *      - window.request_count === 10
 *   4. Cleanup with handle.close().
 *
 * Why an in-process boot (vs child process): the existing
 * smoke-augment-server.mjs uses a child process for the
 * port-from-stdout discovery, but Phase 7a's /metrics route is
 * in-process; the simpler in-process boot is sufficient and faster.
 *
 * Exit code: 0 on `[smoke-metrics] PASS`, non-zero on any failure.
 */

import { createServer } from '../src/server/boot.ts';

const PORT_RANGE = [48_300, 48_399];

function log(level, msg) {
  console.log(`[smoke-metrics] ${msg}`);
}

async function buildValidRequest() {
  return {
    prompt: 'memory studio metrics smoke',
    context: null,
    fingerprint: {
      projectPath: '.',
      agentId: 'claude-code',
      sessionId: `smoke-metrics-${Date.now()}`,
      gitBranch: 'main',
    },
    activeCatalog: [], // empty → persona-only "no_active_items" path
    tenantId: 'smoke-metrics-tenant',
    schemaVersion: 3,
  };
}

async function main() {
  // Ensure proxy disabled for this smoke (default; explicit for clarity).
  delete process.env['MEMORY_STUDIO_ANTHROPIC_BASE_URL'];

  const handle = await createServer({ portRange: PORT_RANGE });
  log('info', `server booted on ${handle.url}`);

  try {
    // Drive 10 /augment requests.
    for (let i = 0; i < 10; i++) {
      const req = await buildValidRequest();
      const res = await fetch(`${handle.url}/augment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (res.status !== 200) {
        throw new Error(`augment request ${i} returned status ${res.status}`);
      }
    }
    log('info', 'drove 10 /augment requests');

    // GET /metrics.
    const metricsRes = await fetch(`${handle.url}/metrics`);
    if (metricsRes.status !== 200) {
      throw new Error(`/metrics returned status ${metricsRes.status}`);
    }
    const body = await metricsRes.json();
    log('info', `GET /metrics → ${JSON.stringify(body)}`);

    // Assert shape.
    const requiredKeys = [
      'request_hit_rate',
      'token_cache_coverage',
      'p50_latency_ms',
      'p99_latency_ms',
      'working_set_mb',
      'window',
      'proxy_enabled',
      'schema_version',
      'timestamp',
    ];
    for (const k of requiredKeys) {
      if (!(k in body)) {
        throw new Error(`/metrics response missing key: ${k}`);
      }
    }

    // Assert values.
    if (body.schema_version !== 1) {
      throw new Error(`schema_version expected 1, got ${body.schema_version}`);
    }
    if (body.request_hit_rate !== null) {
      throw new Error(
        `request_hit_rate expected null (all 10 are no_active_items, excluded from R-1), got ${body.request_hit_rate}`,
      );
    }
    if (body.token_cache_coverage !== null) {
      throw new Error(
        `token_cache_coverage expected null (proxy disabled), got ${body.token_cache_coverage}`,
      );
    }
    if (typeof body.p50_latency_ms !== 'number' || body.p50_latency_ms <= 0) {
      throw new Error(
        `p50_latency_ms expected > 0, got ${body.p50_latency_ms}`,
      );
    }
    if (typeof body.p99_latency_ms !== 'number' || body.p99_latency_ms <= 0) {
      throw new Error(
        `p99_latency_ms expected > 0, got ${body.p99_latency_ms}`,
      );
    }
    if (typeof body.working_set_mb !== 'number' || body.working_set_mb <= 0) {
      throw new Error(
        `working_set_mb expected > 0, got ${body.working_set_mb}`,
      );
    }
    if (body.working_set_mb > 1500) {
      throw new Error(
        `working_set_mb ${body.working_set_mb} exceeds 1500 MB ceiling (PRD §10.2.3)`,
      );
    }
    if (body.proxy_enabled !== false) {
      throw new Error(
        `proxy_enabled expected false (env unset), got ${body.proxy_enabled}`,
      );
    }
    if (body.window.request_count !== 10) {
      throw new Error(
        `window.request_count expected 10, got ${body.window.request_count}`,
      );
    }

    log('info', 'all assertions PASS');
    console.log('[smoke-metrics] PASS');
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error('[smoke-metrics] FAIL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
