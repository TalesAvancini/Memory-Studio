# Claude Code integration — `ANTHROPIC_BASE_URL` wiring

> Phase 5a ships the **SDK-level smoke** path. The **transparent proxy** path (full `/v1/messages` interception) ships in Phase 5b.

## Section 1 — SDK-level smoke (Phase 5a shipped)

`/augment` accepts a structured `AugmentRequest` and returns an `AugmentResponse` whose `systemMessage` is the SHA-256 of the deterministic 2-block system message. The SDK client wraps the POST.

```ts
import { MemoryStudioClient, fingerprint } from '@memory-studio/sdk';

const client = new MemoryStudioClient({
  baseUrl: 'http://127.0.0.1:42900', // port from the augment-server log
  tenantId: 'my-tenant',             // optional; SHA-256[:16] hashed server-side
});

const res = await client.augment({
  prompt: 'design a fastify endpoint that validates JWT tokens',
  context: null,
  fingerprint: fingerprint({
    projectPath: '/path/to/project',
    agentId: 'claude-code',
    sessionId: process.env.CLAUDE_SESSION_ID ?? 'local-dev',
    gitBranch: 'main',
  }),
  activeCatalog: ['auth-jwt-validation', 'rule-no-secrets-in-prompts'],
  schemaVersion: 3,
});
// res.systemMessage is the 64-char hex SHA-256 (D-006: identical input → identical SHA).
// res.matchedSkills / matchedRules / matchedPersonas = partitioned matched set.
// res.emptyReason ∈ 'social' | 'no_active_items' | 'low_confidence' | 'timeout' | null.
```

Boot the server (separate terminal):

```bash
npm run server:start
# Memory Studio augment server: http://127.0.0.1:42900
```

Verify determinism (two calls with identical input → identical SHA):

```bash
curl -s -X POST http://127.0.0.1:42900/augment \
  -H 'content-type: application/json' -d @./fixtures/req.json | jq .systemMessage
# → "4f6dba1b411a9c2947863416098aeac30db43869f1469d6bc11a7852925eb633"
```

## Section 2 — Transparent proxy (Phase 5b future)

Phase 5b adds a `/v1/messages` proxy so Claude Code speaks directly to Memory Studio without SDK instrumentation. Once shipped, the wiring is one env var:

```bash
# .claude/settings.local.json (NOT settings.json — local-only override)
export ANTHROPIC_BASE_URL=http://127.0.0.1:42900
```

```json
// .claude/settings.local.json
{ "env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:42900" } }
```

Claude Code then routes `/v1/messages` to Memory Studio, which builds the 2-block `cache_control: ephemeral` system message, forwards to Anthropic (real provider), and logs `usage.cache_read_input_tokens` from the response. Until Phase 5b ships, `ANTHROPIC_BASE_URL` is **not intercepted** — use the SDK client (Section 1).

## Section 3 — Troubleshooting

### Port conflict (`EADDRINUSE`)

The augment server picks the first free port in `[42900, 43000]`. If the boot log shows a different port than expected, the previous port was still bound. Either wait ~200ms after killing the prior process, or pass `portRange: [a, b]` programmatically via `createServer({ portRange: [...] })`.

### Server unreachable (connection refused)

Run the boot smoke to confirm `/health` on the actual bound URL:

```bash
node scripts/smoke-server-boot.mjs
# [PASS] boot smoke: http://127.0.0.1:42900/health → 200, status=ok
```

The smoke parses the URL from the `Memory Studio augment server:` log line — no hardcoded port guess. If it fails, check the augment-server stdout for the exact bound URL.

### Cache hit not appearing

The 2nd call to `/v1/messages` should show `usage.cache_read_input_tokens > 0`. If it stays at 0 across identical calls, the `system` field is drifting between calls. Verify:

1. The `system` field is the EXACT 2-block structure (Block 1 + Block 2) with both blocks carrying `cache_control: { type: "ephemeral" }`.
2. The 2-block text is byte-identical between calls (no whitespace drift, no key reorder in embedded JSON, no timestamp injection).
3. The model is the same (cache keys are scoped to `(model, system)`).

Phase 5a's `systemMessage` SHA-256 IS the byte-string key. If `/augment` returns the same SHA across two calls, the forwarded request WILL hit the provider cache.

### `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var

This env var is **documented but not currently read** by `src/server/boot.ts` (the server uses `DEFAULT_AUGMENT_PORT_RANGE` directly). Set the port programmatically via `createServer({ portRange: [a, b] })` for non-default ranges.
