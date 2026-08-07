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

## Section 4 — UI server (Phase 4 shipped)

The UI server is a separate process from the augment API server. It serves the local dashboard for browsing the catalog, toggling active items, and editing settings. It binds to `127.0.0.1` only and does not require a `.env` — it reads YAML from `config/catalog/` and project state from `.memory-studio/state.json` directly off the filesystem relative to CWD.

### 4.1 — `npm run ui:start`

```bash
npm run ui:start
# Memory Studio UI: http://127.0.0.1:41823
```

The server picks the first free port in `[41823, 42823]` (declared in `packages/ui/src/port.ts:5`) and binds to `127.0.0.1`. Override the range with `MEMORY_STUDIO_UI_PORT_RANGE` using the same `START-END` format as the API server:

```bash
MEMORY_STUDIO_UI_PORT_RANGE="42800-42822" npm run ui:start
```

### 4.2 — What the UI serves

| Path | Method | Purpose |
|---|---|---|
| `/` | GET | `index.html` (dashboard shell) |
| `/assets/*` | GET | Static files (CSS, JS — htmx, alpine, app.js) |
| `/ui/{tab}` | GET | Partial HTML for a tab (`skills`, `rules`, `personas`, `audit`, `settings`) |
| `/state` | GET | Current project state as JSON |
| `/state/toggle` | POST | Toggle a catalog item on/off |
| `/state/settings` | POST | Apply a settings patch |

Tab partials are routed server-side (declared in `packages/ui/src/server.ts:47`); the server maps `/ui/skills`, `/ui/rules`, `/ui/personas`, `/ui/audit`, `/ui/settings` to their respective renderers. POST endpoints expect `Content-Type: application/json` and reject bodies larger than 64 KiB with HTTP 413.

### 4.3 — Running API + UI together

Both servers are independent processes. Run each in its own terminal:

```bash
# Terminal 1 — API
npm run server:start
# Memory Studio augment server: http://127.0.0.1:42900

# Terminal 2 — UI
npm run ui:start
# Memory Studio UI: http://127.0.0.1:41823
```

Then open `http://127.0.0.1:41823` in a browser. All 5 tabs (Skills, Rules, Personas, Audit, Settings) load partials via `/ui/{tab}` and write back through the JSON endpoints. Read-only browsing works without the API server — only the augment path requires it.

### 4.4 — UI troubleshooting

#### Port conflict (`EADDRINUSE`)

Same pattern as Section 3.1. The UI server scans `[41823, 42823]` and binds the first free port. If the boot log shows a different port than 41823, the previous instance was still bound. Either wait ~200ms after killing the prior process, or pin a different range:

```bash
MEMORY_STUDIO_UI_PORT_RANGE="42800-42822" npm run ui:start
```

#### State doesn't persist (toggle reverts on reload)

Two UI instances are racing on the same `.memory-studio/state.json`. The state store uses atomic `rename` for per-process writes (see `packages/ui/src/state.ts:239`), but a read-modify-write across two processes is a last-writer-wins race — the older change is silently overwritten. Kill the extra instance; only one `npm run ui:start` should be running against a given `projectRoot`.

#### Audit tab shows "No audit events yet"

This is the **default** state. The UI's `auditReader` is wired to `createEmptyAuditReader()` (see `packages/ui/src/audit.ts:25`), which always returns `[]`. Real audit data is not yet injected into the UI — it remains an API-only concern. The empty state is not a bug, but the gap is known.

#### Catalog doesn't appear (`CatalogUnavailableError`)

The UI resolves the catalog relative to CWD: `join(process.cwd(), 'config', 'catalog')`. If `npm run ui:start` was launched from a directory without a `config/catalog/*.yaml` tree, the reader throws `CatalogUnavailableError` (see `packages/ui/src/catalog.ts:41`) and every tab renders an empty catalog. Fix: run the command from the project root, or pass an absolute path programmatically via `createUiServer({ projectRoot: '/abs/path' })`.

### 4.5 — Port range separation (UI vs API)

| Server | Default range | Env var |
|---|---|---|
| API | `[42900, 43000]` | `MEMORY_STUDIO_AUGMENT_PORT_RANGE` |
| UI  | `[41823, 42823]` | `MEMORY_STUDIO_UI_PORT_RANGE` |

The ranges are **disjoint by design** so a runaway API process can never collide with a UI process and vice versa. See `.specs/ROADMAP.md` and `.specs/features/phase-4-ui-panel/validation-phase-4.1.md` for the rationale.

## Section 5 — Inception (1-command proxy toggle for Claude Code)

Section 4 explains how to run the API and UI servers. This section explains how to make Claude Code actually use the API as its `baseURL` — without editing JSON by hand, setting shell env vars, or running `claude` from a sibling directory.

The `inception` script (`scripts/inception.mjs`) patches `<repo>/.claude/settings.json` so that `env.ANTHROPIC_BASE_URL` points at the local proxy (`http://127.0.0.1:42900`). It does a JSON merge — `ANTHROPIC_AUTH_TOKEN`, `permissions`, and every other key in the file are preserved byte-for-byte. A `.bak` is written on the first `enable` and used by `disable` to roll back.

### 5.1 — Onboarding (1 command, then run)

```bash
# Once per repo: patch Claude Code to route through the proxy
npm run inception:enable

# Daily use (3 terminals)
npm run server:start    # terminal 1 — API on 42900
npm run ui:start        # terminal 2 — UI on 41823
claude                  # terminal 3 — routes through the proxy
```

After `inception:enable`, the script prints the diff and a one-liner:

```
✓ patched .claude/settings.json:
    ANTHROPIC_BASE_URL: https://api.minimax.io/anthropic → http://127.0.0.1:42900
    other keys preserved (auth token, permissions, etc.)

⚠  kill any running `claude` and reopen it. Claude Code reads
   env vars at spawn time, not on every request.
```

**The reopen step is mandatory.** A `claude` session started before `inception:enable` will keep its old `ANTHROPIC_BASE_URL` until you quit and reopen it. This is the #1 cause of "I ran inception:enable and the proxy still isn't being used" reports.

### 5.2 — `inception:status` (sanity check)

```bash
npm run inception:status
# or: node scripts/inception.mjs status

inception status:
  ANTHROPIC_BASE_URL = http://127.0.0.1:42900
  inception enabled  = true
  proxy expected at  = http://127.0.0.1:42900
  proxy health      = OK (uptime 12s, catalog count 17)

✓ ready. Open (or reopen) Claude Code in this repo to use the proxy.
```

The `proxy health` line pings the API's `/health` endpoint with a 1.5s timeout. If you see `unreachable`, the API isn't running — start it with `npm run server:start` first.

### 5.3 — Disable (back to direct upstream)

```bash
npm run inception:disable
```

Restores `ANTHROPIC_BASE_URL` from `.claude/settings.json.bak` (the pre-inception snapshot). Other keys are preserved. If no `.bak` exists (someone deleted it, or `enable` was never run), this is a no-op.

### 5.4 — Subcommand reference

| Subcommand | What it does |
|---|---|
| `inception:enable` | Merge-patch `ANTHROPIC_BASE_URL` into `.claude/settings.json`, write `.bak` if missing. |
| `inception:disable` | Restore `.claude/settings.json` from `.bak`. No-op if no `.bak`. |
| `inception:status` | Print current `ANTHROPIC_BASE_URL` + ping `/health`. |

### 5.5 — Limitations (YAGNI)

- **Claude Code only.** Other agents (Cursor, Windsurf, Cline, Aider, OpenCode, Continue) each use their own config file. The script does not touch them. Add a per-agent variant when needed.
- **Per-repo, not global.** The patch is applied to `<repo>/.claude/settings.json`, not `~/.claude/settings.json`. If you `cd` out of the repo and run `claude` from a sibling directory, Claude Code reads a different settings file (or the user-global one) and won't see the proxy URL.
- **No auto-revert on disable.** `inception:disable` only restores from the FIRST `enable`'s backup. If you ran `enable` → manually edited the file → `enable` again → `disable`, the disable restores to your pre-inception original, not your manual edit. This is intentional (the script never overwrites a `.bak` it didn't create).

