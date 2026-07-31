---
date: 2026-07-31
version: 1
description: "Phase 3 — SDK Cliente spec. Creates a new `@memory-studio/sdk` npm workspace package: TypeScript puro, ~50KB gzipped build, zero native deps, zero runtime deps. SDK exposes `collectContext` (redaction), `fingerprint` (4-component provenance with sha256[0:16] sessionId hashing), and `MemoryStudioClient.augment` (HTTP POST to `/augment`). agentId hardcoded `\"claude-code\"` per PRD §14.4 MVP."
explanation: |
  Phase 3 ships the client-side SDK that embedding agents (Claude Code MVP)
  call to collect their state and POST it to the Memory Studio server
  (Phase 5a — server not yet built). This is the first phase to use an
  npm workspace (`packages/sdk/`), so root `package.json` gains a
  `workspaces` field.

  SDK is **truly standalone**: zero runtime dependencies (not even
  `memory-studio` as workspace dep — that's blocked by the root being
  `private: true` and not a published package). Hash primitive
  (`hashSha256_16`) is inlined via `node:crypto`; fingerprint function
  is inlined as ~10 lines with `agentId: "claude-code"` literal per
  PRD §14.4 MVP. Phase 2's `src/fingerprint/fingerprint.ts` is the
  authoritative server-side reference; SDK's copy is verified-equal by
  golden-vector tests on the same NIST vectors.

  Secret redaction is regex-based, scoped to `scratch` (free text) and
  `lastEvent.payload` (recursively on string values). Three primary
  patterns (API keys, .env values, JWT tokens) at `redaction: "minimal"`;
  strict mode adds GitHub PATs + AWS keys + PEM blocks. Redaction runs
  **before** JSON serialization in `collectContext`, so the SDK boundary
  is the redact point (PRD §10.3 item 1: zero raw persistence).

  Build is via `tsup` — modern standard for dual ESM + CJS with
  declaration files. Build size **measured** (gzipped) at script time
  with an assertion against 50KB. SDK smoke test (`node -e "require('@memory-studio/sdk')"`)
  proves Node 22 can load it with zero external runtime deps.

  Scope is intentionally narrow: NO server, NO UI, NO retrieval, NO
  Fastify. SDK is the client side of `/augment` (Phase 5a is the
  server).

  The Verifier should expect:
  - New workspace at `packages/sdk/`
  - Root `package.json` modified to add `"workspaces": ["packages/*"]`
    (workspace dep is NOT added from `packages/sdk/` to root — that
    creates a circular layout with the private root; SDK inlines its
    primitives instead)
  - `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`
    byte-identical (Verifier runs `git diff` to confirm)
  - New SDK package has no native deps, no runtime deps, no external
    files outside `packages/sdk/**` and the root workspace field

  Touch ONLY files under `.specs/features/phase-3-sdk-client/` for
  this planning artifact. Implementation tasks live in `tasks.md` and
  will be executed in a separate Planner→Implementer dispatch.
related:
  - ../../ROADMAP.md
  - ../../architecture/memory-studio.html
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../../CLAUDE.md
  - ../../../.scratch/memory-studio/spec.md
  - ../../../src/fingerprint/fingerprint.ts
  - ../../../src/fingerprint/hash.ts
  - ../../../src/catalog/schema/skill.ts
  - ../../../package.json
  - ../../../tsconfig.json
  - ../../../.gitignore
---

# Phase 3 — SDK Cliente — Spec

**Phase:** 3
**Slug:** `phase-3-sdk-client`
**Source:** `.specs/ROADMAP.md` lines 271-309 (Phase 3 entry)
**Goal:** ship `@memory-studio/sdk` as a standalone npm workspace package — TypeScript puro, ~50KB gzipped build, zero native deps, zero runtime deps — that embedding agents (Claude Code MVP) call to collect their state (`collectContext`), build a 4-component fingerprint (`fingerprint`), and POST to `/augment` (`MemoryStudioClient.augment`).
**Estimate:** 3-4h (per ROADMAP)

---

## Architectural Reference

> Farol nodes (`.specs/architecture/memory-studio.html` + `memory-studio.architecture.json`) consumed by Phase 3:

> **Módulo 3 — Hot Path (síncrono, p50<50ms):**
> - `sdk` — `@memory-studio/sdk` (TS · ~50KB · zero deps). **Phase 3 IMPLEMENTS** this node as a new workspace package at `packages/sdk/`.

> **Módulo 5 — Storage (runtime data):**
> - `state-json` — `.memory-studio/state.json` exposes `agentId: "claude-code"` literal (MVP). Phase 3 SDK reads it via `process.env.MEMORY_STUDIO_AGENT_ID` (optional override) or uses the literal directly.

> **Out of farol scope for Phase 3** (deliberately, will land in later phases):
> - `server` (Phase 5a) — receives the SDK's POST `/augment`. Server not built; SDK tests mock the HTTP layer.
> - `augmenter` / `search` / `social-detector` / `cache` / `audit-buffer` / `fts5-vec` / `sqlite` / `embed-model` — Phase 5 runtime.
> - `ui-panel` (Phase 4).
> - `fast-agent` / `intel-store` / `match-script` (Phase 6).

**Edges built by Phase 3 (Implementer's TODO list):**
- `sdk → state-json` (read agentId literal from `.memory-studio/state.json` if present, else default `"claude-code"`)
- `sdk → server` (HTTP POST `/augment` — server NOT built; SDK mocks fetch in tests)

**Edges NOT built by Phase 3 (consumers in later phases):**
- `server → sdk` (Phase 5a actually receives the request)
- `sdk → catalog` (no catalog reading; SDK is request-builder only)

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | A new npm package `@memory-studio/sdk` lives at `packages/sdk/`. Root `package.json` declares `"workspaces": ["packages/*"]` so `npm install` at root resolves the package and `tsup` build picks it up | ROADMAP done #1 + SPEC §IMod-1 + dispatch constraint "first workspace" |
| **R-02** | The SDK package has **zero runtime dependencies** in `dependencies` (only `devDependencies` for `tsup`, `@types/node`, `typescript`). No native modules (no `better-sqlite3`, no `onnxruntime-node`, no `sqlite-vec`) | ROADMAP done #1 ("zero deps nativas") + PRD §8 invariante "TypeScript puro" |
| **R-03** | Function `collectContext(opts: CollectContextInput): Promise<Context>` accepts `{ scratch, todos, recentFiles, lastEvent, redaction }` and returns a serialized `Context` object. `redaction` defaults to `"minimal"`; value `"strict"` adds patterns | SPEC §IMod-2 + SPEC §C (story 20) + ROADMAP done #2 |
| **R-04** | The returned `Context` type matches PRD §7.1 request shape: `{ scratch?, todos?, recentFiles?, lastEvent?, legacyState?, sessionId? }`. All camelCase canonical per SPEC §IMod-20 (`recentFiles`, `lastEvent`, NOT `gitStatus`/`files`/`recent_files`/snake_case) | PRD §7.1 + SPEC §IMod-20 + ROADMAP done #3 |
| **R-05** | `collectContext` runs **secret redaction** on `scratch` and `lastEvent.payload` BEFORE serializing. At `redaction: "minimal"`, three regex patterns: (a) API keys (`sk-[A-Za-z0-9]{32,}` + similar `pk-`/`api_` prefixes), (b) `.env` values (`(API_KEY\|SECRET\|TOKEN\|PASSWORD\|PRIVATE_KEY)=([^\s'"]+)`), (c) JWT tokens (`eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`). At `redaction: "strict"`, adds GitHub PATs (`gh[pousr]_[A-Za-z0-9]{36,}`), AWS access keys (`AKIA[0-9A-Z]{16}`), PEM private-key blocks. Replaced with `<REDACTED>` | PRD §10.3 item 1 + ROADMAP done #8 + SPEC §H (story 49) + dispatch "regex-based scan" |
| **R-06** | Function `fingerprint(opts: FingerprintInput): Promise<Fingerprint>` accepts `{ projectPath, agentId, sessionId, gitBranch }` and returns a 4-component object `{ projectPath, agentId, sessionId: <hashed>, gitBranch }`. The returned `sessionId` is `hashSha256_16(input.sessionId)` — the raw sessionId NEVER appears in the result (PRD §10.3 item 1: zero raw persistence) | PRD §5 + ROADMAP done #4 + SPEC §IMod-2 + SPEC §C (story 21) |
| **R-07** | The hash primitive `hashSha256_16(input: string): string` returns the first **16 bytes** of SHA-256 digest as a **32-char lowercase hex string**. Verified by NIST golden vectors (empty string, "abc", "The quick brown fox..."). Implementation uses `node:crypto` `createHash("sha256")` — no npm dependencies | PRD §8 invariante sólida "sha256[0:16]" + ROADMAP done #4 + PRD §10.3 item 2 |
| **R-08** | Class `MemoryStudioClient` with constructor `{ baseURL: string; tenantId: string }` exposes `async augment(req: AugmentRequest): Promise<AugmentResponse>`. The method issues `POST {baseURL}/augment` with `Content-Type: application/json` and a serialized `AugmentRequest` body. The `tenantId` is hashed via `hashSha256_16` before being attached to the request (server receives `tenantId_hashed`, never the raw value — PRD §10.3 item 2) | PRD §5 + PRD §7.1 + ROADMAP done #5 + SPEC §IMod-2 + SPEC §IMod-3 |
| **R-09** | The `AugmentRequest` shape matches PRD §7.1: `{ prompt, context?, fingerprint, activeCatalog, tenantId, schemaVersion: 3 }`. The `AugmentResponse` shape matches PRD §7.1: `{ systemMessage, matchedSkills, matchedRules, matchedPersonas, pruningDecisions, latencyMs, decisionTraceId, warnings, emptyReason?, schemaVersion: 3 }` (`cacheHit` is OMITTED — MVP per PRD §17.1 / SPEC §IMod-4) | PRD §7.1 + SPEC §IMod-3 + SPEC §IMod-4 + ROADMAP done #5 |
| **R-10** | **Prompt-only mode:** `client.augment({ prompt, context: null, fingerprint, ...})` sends a request with `context: null` (not omitted) and parses the response identically. The server (Phase 5a) treats `context: null` as the "no agent state" signal; the SDK sends it correctly and handles 200/empty-matches responses | PRD §7.1 + ROADMAP done #6 + SPEC §C (story 23) + SPEC §IMod-12 |
| **R-11** | `agentId` is **hardcoded as the literal string `"claude-code"`** in the SDK source. The constant lives in a single file (`packages/sdk/src/agent-id.ts` or inline in `fingerprint.ts`) and is exported for v3.1+ configurability. Per PRD §14.4, MVP is `"claude-code"` only | PRD §14.4 + ROADMAP done #7 + SPEC §C (story 24) |
| **R-12** | The SDK's `package.json` has the `"exports"` field with `"."` → ESM + CJS dual entries + `"types"` entry. `"type": "module"` is set. `"engines": { "node": ">=22" }` is set. `"files": ["dist"]` restricts published files | ROADMAP done #9 + modern npm package conventions |
| **R-13** | Build script produces dual ESM + CJS outputs **with type declarations**: `dist/index.mjs` (or `.js` with ESM type), `dist/index.cjs`, `dist/index.d.ts`, `dist/*.d.mts` (or `.d.ts` for both). Built via `tsup` (modern standard for TS dual builds). `npm run build` exits 0 | ROADMAP done #9 + dispatch "tsup or rollup your call" |
| **R-14** | Build size of `packages/sdk/dist/` is **measured** and asserted to be **≤ 50KB gzipped** (sum of `index.mjs` + `index.cjs` after gzip). Measured in `npm run build` (prints size to stderr) AND in a CI smoke check that fails build if > 50KB. Raw size is also reported but not the gate | ROADMAP done #1 ("medido") + PRD §10.4 spirit (medido, não estimado) + dispatch "assert ≤ 50KB" |
| **R-15** | The SDK smoke test passes: `node --eval "import('@memory-studio/sdk').then(m => console.log(typeof m.MemoryStudioClient))"` exits 0 and prints `function`. Proves the package loads in Node 22 with zero external runtime deps | ROADMAP done #10 + dispatch "Test smoke: SDK roda em Node 22 sem dependências externas" |
| **R-16** | A short README at `packages/sdk/README.md` documents: (a) installation (`npm install @memory-studio/sdk`), (b) basic usage example (the snippet from PRD §5), (c) link to PRD §5 for full API contract | dispatch "README curto com usage example" |
| **R-17** | **Workspace coupling is minimal:** root `package.json` gains `"workspaces": ["packages/*"]` field. The SDK package does NOT depend on the root `memory-studio` package (workspace dep would conflict with `"private": true` + non-published root). Hash primitive and fingerprint function are **inlined** in the SDK; correctness verified by golden-vector tests that match Phase 2's `src/fingerprint/` outputs | dispatch "decide a/b/c" + R-02 zero runtime deps constraint |
| **R-18** | **No farol or server references:** SDK does NOT touch `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`. The Verifier runs `git diff <baseline>..HEAD -- src/` and asserts zero changes | dispatch "Touch scope: ONLY packages/sdk/** + root package.json workspace field" + AD-002 calibration residue rule |

### Out of scope (explicit non-goals)

- **`@memory-studio/server`** (Phase 5a) — Fastify server, `/augment` handler, retrieval runtime. SDK tests mock the HTTP layer via `fetch` mock.
- **`@memory-studio/ui`** (Phase 4) — HTMX+Alpine panel.
- **Retrieval runtime** (FTS5 + sqlite-vec + RRF + threshold gates) — Phase 5a.
- **Audit write runtime** — Phase 5b.
- **Byte-string determinism + tiebreak ordering + pruningDecisions construction** — Phase 5a (server owns it; SDK just receives the response).
- **Fast agent + Intel pipeline** (Phase 6) — SDK does not touch.
- **Multi-agent fingerprint support** (v3.1+) — `agentId` is hardcoded `"claude-code"` per PRD §14.4 MVP.
- **Cache hit field** in response — OMITTED per PRD §17.1 / SPEC §IMod-4 (MVP metric is via log).
- **Pre-bundled CLI binary** — SDK is a library; agents use `MemoryStudioClient` from their code.
- **Retry / backoff / circuit breaker on `augment()`** — fail-open semantics are the SERVER's job (Phase 5a); SDK propagates errors to caller.
- **TLS configuration / custom certificates** — `fetch` defaults; SDK does not override.
- **Adapter OpenAI↔Anthropic** — v3.1+ (PRD §11).

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | Directory `packages/sdk/` exists with `package.json`, `tsconfig.json`, `src/`, `dist/` (after build), `README.md`, and `test/` |
| **AC-2** | Root `package.json` has `"workspaces": ["packages/*"]` field. `npm install` at root succeeds and resolves `@memory-studio/sdk` symlink into root `node_modules/@memory-studio/sdk` (verified by `ls -la node_modules/@memory-studio/sdk` → points to `packages/sdk`) |
| **AC-3** | `packages/sdk/package.json` has `"name": "@memory-studio/sdk"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"files": ["dist"]`, `"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" } }`, and a `"scripts"` block with `"build": "tsup"` |
| **AC-4** | `packages/sdk/package.json` `dependencies` block is empty (`{}`). `devDependencies` contains `tsup`, `typescript`, `@types/node`. No `better-sqlite3`, `onnxruntime-node`, `sqlite-vec`, `yaml`, `zod`, etc. |
| **AC-5** | `import { collectContext, fingerprint, MemoryStudioClient } from "@memory-studio/sdk"` (after `npm run build`) resolves to `packages/sdk/dist/index.mjs` and exports the 3 named symbols |
| **AC-6** | `collectContext({ scratch: "hello world", todos: [], recentFiles: [], redaction: "minimal" })` returns a `Promise<Context>` whose serialized JSON has shape `{ scratch: "hello world", todos: [], recentFiles: [], sessionId: undefined }` (or sessionId filled if provided) |
| **AC-7** | `collectContext({ scratch: "My API key is sk-1234567890abcdef1234567890abcdef", redaction: "minimal" })` returns `Context` with `scratch === "My API key is <REDACTED>"` (the `sk-…` literal is replaced) |
| **AC-8** | `collectContext({ scratch: "password=hunter2 in my .env", redaction: "minimal" })` returns `Context` with `scratch === "<REDACTED> in my .env"` (the `password=…` value is replaced) |
| **AC-9** | `collectContext({ scratch: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c is my JWT", redaction: "minimal" })` returns `Context` with `scratch === "<REDACTED> is my JWT"` |
| **AC-10** | `collectContext({ scratch: "AKIAIOSFODNN7EXAMPLE", redaction: "minimal" })` returns `Context` with `scratch === "AKIAIOSFODNN7EXAMPLE"` UNCHANGED (strict-only pattern). With `redaction: "strict"`, returns `Context` with `scratch === "<REDACTED>"` |
| **AC-11** | `collectContext` recursively redacts `lastEvent.payload` if it's an object/array. Given `lastEvent: { type: "tool_call", payload: { api_key: "sk-1234567890abcdef1234567890abcdef", safe: "public" } }`, the resulting `Context.lastEvent.payload.api_key === "<REDACTED>"` and `Context.lastEvent.payload.safe === "public"` |
| **AC-12** | `fingerprint({ projectPath: "/tmp/proj", agentId: "claude-code", sessionId: "test-session-abc", gitBranch: "main" })` returns `Promise<{ projectPath: "/tmp/proj", agentId: "claude-code", sessionId: <32-char hex>, gitBranch: "main" }>`. The returned `sessionId` is exactly `hashSha256_16("test-session-abc")` and the literal `"test-session-abc"` is NOT present in any field of the returned object |
| **AC-13** | `hashSha256_16("")` returns `"e3b0c44298fc1c149afbf4c8996fb924"` (NIST SHA-256 of empty, first 16 bytes). `hashSha256_16("abc")` returns `"ba7816bf8f01cfea414140de5dae2223"` (first 32 hex of `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`). 4+ golden vectors asserted in test |
| **AC-14** | `hashSha256_16` is deterministic: same input → same output (verified by 2 calls + equality). Returned string is always `/^[0-9a-f]{32}$/` |
| **AC-15** | `new MemoryStudioClient({ baseURL: "http://127.0.0.1:41823", tenantId: "tenant-abc" }).augment({ prompt: "hi", context: null, fingerprint: { projectPath: "/x", agentId: "claude-code", sessionId: "h", gitBranch: "main" }, activeCatalog: [], schemaVersion: 3 })` issues a `POST http://127.0.0.1:41823/augment` with body `{ prompt: "hi", context: null, fingerprint: { projectPath: "/x", agentId: "claude-code", sessionId: <hash>, gitBranch: "main" }, activeCatalog: [], tenantId: <hash>, schemaVersion: 3 }` and parses the JSON response into `AugmentResponse` |
| **AC-16** | Prompt-only mode: `client.augment({ prompt: "hi", context: null, fingerprint, activeCatalog: [], schemaVersion: 3 })` sends `context: null` in the JSON body (verified by inspecting the request — `body.context === null`, not omitted). The SDK does not crash when server returns empty matched arrays |
| **AC-17** | `client.augment()` does NOT add `cacheHit` to the response (server may include it; SDK passes through if present but does not synthesize it) |
| **AC-18** | `MemoryStudioClient`'s constructor requires `tenantId`. The `tenantId` is hashed via `hashSha256_16` before being attached to outgoing requests. Verified by `request.tenantId === hashSha256_16("tenant-abc")` (the literal `"tenant-abc"` is NOT in the body) |
| **AC-19** | The `agentId` literal `"claude-code"` appears in source code at a discoverable location (e.g., `packages/sdk/src/fingerprint.ts` or `packages/sdk/src/agent-id.ts`). A `grep -r "claude-code" packages/sdk/src/` returns exactly 1 match (the literal) |
| **AC-20** | `npm run build` in `packages/sdk/` produces `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`, and a small `dist/*.d.mts` (or equivalent). Build exits 0. Build script prints the gzipped size of `dist/index.mjs` (e.g., `[SIZE] sdk: 12.3KB gzipped (45.6KB raw)`) and asserts `< 50_000 bytes gzipped`. If over, build exits non-zero with clear error |
| **AC-21** | Smoke test (`packages/sdk/test/smoke.test.mjs`) executes `import("@memory-studio/sdk")` via `await import()` after build, asserts all 3 exports (`collectContext`, `fingerprint`, `MemoryStudioClient`) are `function`s, exits 0. This proves Node 22 can load the package with zero external runtime deps |
| **AC-22** | `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/` returns zero changes (no other source files modified by Phase 3) |
| **AC-23** | `packages/sdk/README.md` exists with sections: Installation, Basic Usage (PRD §5 snippet), API Reference (links to PRD §5 for full contract), License/Notes. Total < 100 lines |
| **AC-24** | All Phase 1 + Phase 2 tests still pass (`npm test` at repo root). Phase 1 baseline (185+ tests) + Phase 2 baseline (~60 detector tests + fingerprint/migration tests) preserved. The 207-test baseline from commit `74b4cdc` is the floor |
| **AC-25** | Root `package.json` `engines` unchanged (`>=22.0.0`). No new production dependencies in root `package.json` (only `devDependencies` may be touched to add `tsup` if root owns it, or `tsup` lives in `packages/sdk/devDependencies` only — preferred) |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: SDK package location** | `packages/sdk/` at repo root (workspace) | SPEC §IMod-1 explicitly says `packages/sdk/`. Clean monorepo pattern. ROADMAP done #1 says `@memory-studio/sdk` package. First workspace — Phase 1+2 are single-package repos | yes (PRD explicit) |
| **A-2: Workspace declaration** | Root `package.json` gains `"workspaces": ["packages/*"]` field | Standard npm 7+ workspaces. `npm install` at root resolves all workspace packages and symlinks them | yes (autonomous) |
| **A-3: Build tool choice** | **`tsup`** (not `rollup`, not `tsc only`) | `tsup` is the modern standard for dual ESM + CJS + d.ts from a single `tsup.config.ts`. Tree-shaking + minification out of the box. Used by tRPC, Prisma, Vue ecosystem. `rollup` needs more plugin config; `tsc` alone can't easily produce dual ESM + CJS. Smaller dev footprint than `rollup` for our needs | yes (autonomous) |
| **A-4: Fingerprint delegation strategy** | **Inline the hash primitive + fingerprint function inside the SDK** with golden-vector tests matching Phase 2's outputs. **NOT** workspace dep on root `memory-studio` (blocked: root is `"private": true` and not a published package; cross-package TypeScript project references for a one-function reuse is overkill) | Hash primitive is ~10 lines + golden vectors = proven correct. Fingerprint function is ~10 lines = trivial to maintain. Zero runtime deps constraint (R-02) is honored. Drift risk is mitigated by sharing the same NIST vectors as Phase 2's tests | yes (autonomous) |
| **A-5: Build size measurement strategy** | **Gzipped size of `dist/index.mjs` is the gate (assert ≤ 50KB gzipped)**. Raw size is reported but not enforced. The 50KB figure in PRD §8 / ROADMAP done #1 is interpreted as gzipped (industry standard for "small bundle" claims — bundlephobia, npm registry, etc.) | Gzipped size is what matters for install/network. Raw size matters less. The phrase "medido, não estimado" applies — the script asserts, not estimates | yes (autonomous) |
| **A-6: Redaction modes — pattern list** | `"minimal"` = 3 patterns (API keys `sk-[A-Za-z0-9]{32,}` + `pk-` + `api_`/`api-` prefixes, .env values `(KEY\|SECRET\|TOKEN\|PASSWORD\|PRIVATE_KEY)=value`, JWT tokens `eyJ…\.eyJ…\.…`). `"strict"` = minimal + GitHub PATs `gh[pousr]_[A-Za-z0-9]{36,}` + AWS access keys `AKIA[0-9A-Z]{16}` + PEM private-key blocks `-----BEGIN [A-Z ]*PRIVATE KEY-----…-----END…-----` | Dispatch lists: API keys, .env values, JWT tokens. Strict adds GitHub PAT (PRD §14 implicit — humans commonly leak these), AWS keys (common cloud credential), PEM blocks (RSA private keys) | yes (autonomous) |
| **A-7: Redaction applies to** | `Context.scratch` (free string) + `Context.lastEvent.payload` (recursive over object/array, redacts string values at any depth) | PRD §5 says "redact secrets in `scratch` and `lastEvent.payload`". `todos` and `recentFiles` are low-risk (structured data); Phase 5a's audit layer can redact further if needed | yes (PRD explicit) |
| **A-8: agentId literal location** | `packages/sdk/src/fingerprint.ts` (inline in fingerprint function body: `agentId: "claude-code"`) OR `packages/sdk/src/agent-id.ts` exporting `const AGENT_ID = "claude-code"` | Single literal is the MVP contract. v3.1+ may make it configurable. Inline keeps it maximally discoverable (`grep -r claude-code packages/sdk/src/` finds it immediately) | yes (autonomous) |
| **A-9: HTTP client implementation** | Native `fetch` (Node 22 built-in). `MemoryStudioClient.augment` calls `fetch(url, { method: "POST", headers: {...}, body: JSON.stringify(req) })` and `await res.json()` | Node 22 has `fetch` as a built-in global (since 18 LTS). Zero deps. Tests mock with `globalThis.fetch = vi.fn()` (or `node:test` mock) — Phase 5a wires real server | yes (autonomous) |
| **A-10: AugmentRequest includes schemaVersion: 3** | Hardcoded literal `schemaVersion: 3` in the request builder | PRD §7.1 explicitly says `schemaVersion: 3`. Phase 1 catalog already exposes `getCatalogSchemaVersion() === 3`. If bumped to 4 in v3.1, the SDK needs a migration; that's a future concern | yes (PRD explicit) |
| **A-11: SDK exports** | Named exports only: `collectContext`, `fingerprint`, `MemoryStudioClient`, plus the public types `CollectContextInput`, `Context`, `FingerprintInput`, `Fingerprint`, `AugmentRequest`, `AugmentResponse`, `RedactionMode`. No default export. No barrel re-exports of Phase 2 modules (SDK is standalone) | Tree-shakeable; matches Phase 2's barrel pattern; no transitive deps | yes (autonomous) |
| **A-12: Error type** | Single `SdkError extends Error` class with `readonly code: string` (e.g., `"redaction_failed"`, `"http_error"`, `"invalid_response"`). Thrown from `augment()` for non-2xx HTTP responses and malformed JSON | Minimal but typed. Matches Phase 1's `CatalogError` pattern | yes (autonomous) |
| **A-13: Test framework** | Node 22 built-in `node --test` (per CLAUDE.md). Tests in `packages/sdk/test/` (separate from root `test/`) so the workspace has its own test boundary. Smoke test invokes `await import("@memory-studio/sdk")` to prove the package loads | Consistent with CLAUDE.md. Per-package tests allow the SDK package to ship independently later | yes (CLAUDE.md explicit) |
| **A-14: `gitBranch` collection** | `fingerprint()` accepts `gitBranch` as a required string parameter. SDK does NOT execute `git rev-parse --abbrev-ref HEAD` (Phase 3 has no `child_process` import). Caller (the agent) is responsible for collecting it. (Future v3.1+ helper may add `collectGitBranch()` for convenience) | Phase 2 design (per R-08 in Phase 2 spec). SDK is a request-builder, not a shell wrapper | yes (autonomous) |
| **A-15: `projectPath` collection** | `fingerprint()` accepts `projectPath` as required string. Caller passes `process.cwd()` | Same logic as A-14 — SDK is a request-builder | yes (autonomous) |
| **A-16: Build script integration** | `packages/sdk/package.json` `"scripts": { "build": "tsup", "size": "tsup --onSuccess 'node -e ...'" }`. Root `package.json` adds `"build:sdk": "npm -w @memory-studio/sdk run build"` for convenience (optional). No change to root `scripts.test` — SDK has its own tests | Each workspace package owns its build script. Root scripts orchestrate cross-workspace concerns only when needed | yes (autonomous) |
| **A-17: Phase 3 source files scope** | ONLY `packages/sdk/**` and root `package.json` `workspaces` field. NO changes to `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`, `tsconfig.json` (workspace-wide tsconfig stays root-only; each package may have its own), `.gitignore` (no SDK files to ignore) | Per dispatch "Touch scope" constraint. Verifier enforces via `git diff <baseline>..HEAD -- src/` returning empty | yes (autonomous) |
| **A-18: Test count baseline** | Phase 3 starts at the 207-test baseline from commit `74b4cdc` (Phase 2 Verifier PASS). SDK tests live at `packages/sdk/test/` and do NOT count toward root `npm test` (which globs `test/**/*.test.mjs`). The 207-root-test floor is preserved by Verifier | Per CLAUDE.md testing contract — root test count is the floor. Workspace package tests are additional (don't replace, don't subtract) | yes (autonomous) |
| **A-19: SDK package's tsconfig** | `packages/sdk/tsconfig.json` extends a minimal root-friendly shape: target ES2022, module NodeNext, strict, noUncheckedIndexedAccess, declaration: true (matching root). The build (`tsup`) reads its own config and emits to `packages/sdk/dist/` | Each workspace package owns its own tsconfig; root tsconfig stays as-is | yes (autonomous) |
| **A-20: SDK smoke test placement** | `packages/sdk/test/smoke.test.mjs` — runs `await import("@memory-studio/sdk")` via the built package (after `npm run build`). Uses `node --test` runner. Asserts all 3 exports are functions, exits 0 | Package-local test; ensures the workspace linkage works AND the package is consumable | yes (autonomous) |

**Open questions:** none — all ambiguities resolved as assumptions above.

---

## Edge Cases (enumerated for tests)

- WHEN `collectContext` is called with empty input (all fields undefined) THEN it returns a `Context` object with all fields undefined/null and serializes to `{}` (empty object literal — server interprets as no state)
- WHEN `collectContext` is called with `redaction: "minimal"` (default) and a `scratch` containing an `sk-…` API key THEN the `sk-…` substring is replaced with `<REDACTED>`. Multiple matches in the same string are all replaced
- WHEN `collectContext` is called with `redaction: "strict"` and an AWS access key (`AKIAIOSFODNN7EXAMPLE`) THEN it is replaced; with `redaction: "minimal"` it is preserved (strict-only pattern)
- WHEN `lastEvent.payload` is a nested object (depth ≥ 3) THEN all string values at all depths are redacted; non-string values pass through
- WHEN `lastEvent.payload` is a primitive (string/number) THEN it is wrapped as `{ type, payload: <primitive> }` and the primitive is redacted if it's a string
- WHEN `lastEvent.payload` is `null` THEN it passes through (no crash)
- WHEN `hashSha256_16` is called with empty string THEN it returns `"e3b0c44298fc1c149afbf4c8996fb924"` (NIST golden vector)
- WHEN `hashSha256_16` is called twice with the same input THEN it returns the same output (determinism)
- WHEN `hashSha256_16` is called with a 1MB string THEN it completes in < 100ms (perf sanity)
- WHEN `fingerprint` is called twice with the same input THEN the returned `sessionId` is equal between calls (hash is deterministic)
- WHEN `fingerprint` is called with a unicode `sessionId` (emoji, CJK, accents) THEN it hashes correctly via UTF-8
- WHEN `fingerprint` is called with a unique `sessionId` (e.g., `"my-very-distinctive-session-id-12345"`) THEN the returned object's `.sessionId` is NOT equal to that literal (anti-leak guard). `Object.values(result).every(v => v !== input.sessionId)` returns `true`
- WHEN `MemoryStudioClient.augment` is called and the server returns 200 with valid JSON THEN the response is parsed and returned
- WHEN `MemoryStudioClient.augment` is called and the server returns 200 with empty matched arrays (`matchedSkills: []`, `emptyReason: "no_active_items"`) THEN the response is parsed without crash
- WHEN `MemoryStudioClient.augment` is called and the server returns 4xx/5xx THEN an `SdkError` is thrown with the HTTP status code in `code` and the response body in `message`
- WHEN `MemoryStudioClient.augment` is called and the server returns malformed JSON THEN an `SdkError` is thrown with `code: "invalid_response"`
- WHEN `MemoryStudioClient.augment` is called with `context: null` THEN the JSON body has `"context": null` (not omitted, not `{}`)

---

## User Stories (consumed from SPEC §C)

Per SPEC `.scratch/memory-studio/spec.md` §C — SDK cliente (coleta de estado):

| Story | Source | Phase 3 Acceptance |
|---|---|---|
| **C.20** — `collectContext({ scratch, todos, recentFiles, lastEvent, redaction })` returns a serialized context object | SPEC §C + PRD §5 | AC-6, AC-7, AC-8, AC-9, AC-10, AC-11 |
| **C.21** — `fingerprint({ projectPath, agentId, sessionId, gitBranch })` returns a 4-component fingerprint | SPEC §C + PRD §5 | AC-12 |
| **C.22** — `MemoryStudioClient.augment({ prompt, context, fingerprint })` calls `/augment` and returns the augmented system message | SPEC §C + PRD §5 | AC-15, AC-17 |
| **C.23** — SDK supports prompt-only mode (v1 compat) when context is null | SPEC §C + PRD §5 | AC-16 |
| **C.24** — SDK hardcodes `agentId = "claude-code"` for MVP | SPEC §C + PRD §14.4 | AC-19 |
| **C.25** — SDK hashes `sessionId` before sending (sha256[0:16]) | SPEC §C + PRD §10.3 item 1 | AC-12, AC-13, AC-14 |
| **C.26** — SDK redacts secrets in `scratch` and `lastEvent.payload` before sending | SPEC §C + PRD §10.3 item 1 | AC-7, AC-8, AC-9, AC-10, AC-11 |

Per SPEC §F — Security/Privacy:

| Story | Source | Phase 3 Acceptance |
|---|---|---|
| **F.49** — Zero persistence of raw context (only redacted) | SPEC §F + PRD §10.3 item 1 | AC-7, AC-8, AC-9, AC-11 (redaction happens before serialization in `collectContext`) |
| **F.50** — `tenantId` hashed in all logs (sha256[0:16]) | SPEC §F + PRD §10.3 item 2 | AC-18 (hashed before request body) |

Per SPEC §K — Nomenclature & invariants:

| Story | Source | Phase 3 Acceptance |
|---|---|---|
| **K.63** — `recentFiles` (camelCase) as canonical term | SPEC §K + PRD §17.2 | AC-5 (TypeScript types use `recentFiles`, not `gitStatus`/`files`) |
| **K.64** — `lastEvent` (camelCase) as canonical term | SPEC §K + PRD §17.2 | AC-5 (TypeScript types use `lastEvent`) |

---

## Requirement Traceability

| Req ID | Story | AC | Status |
|---|---|---|---|
| R-01 | (workspace setup) | AC-1, AC-2, AC-3 | Pending |
| R-02 | (zero runtime deps) | AC-4, AC-21 | Pending |
| R-03 | C.20 | AC-6 | Pending |
| R-04 | K.63, K.64 | AC-5 | Pending |
| R-05 | C.26, F.49 | AC-7, AC-8, AC-9, AC-10, AC-11 | Pending |
| R-06 | C.21, C.25 | AC-12 | Pending |
| R-07 | C.25, F.50 | AC-13, AC-14 | Pending |
| R-08 | C.22 | AC-15, AC-18 | Pending |
| R-09 | C.22 | AC-15, AC-17 | Pending |
| R-10 | C.23 | AC-16 | Pending |
| R-11 | C.24 | AC-19 | Pending |
| R-12 | (npm package conventions) | AC-3 | Pending |
| R-13 | (build) | AC-3, AC-20 | Pending |
| R-14 | (build size) | AC-20 | Pending |
| R-15 | (smoke test) | AC-21 | Pending |
| R-16 | (README) | AC-23 | Pending |
| R-17 | (workspace minimal coupling) | AC-22, AC-4 | Pending |
| R-18 | (scope guard) | AC-22 | Pending |
| AC-1 | (package layout) | — | Pending |
| AC-2 | (workspace field) | — | Pending |
| AC-3 | (package.json shape) | — | Pending |
| AC-4 | (zero deps) | — | Pending |
| AC-5 | (named exports) | — | Pending |
| AC-6 | (collectContext shape) | — | Pending |
| AC-7 | (API key redaction) | — | Pending |
| AC-8 | (.env value redaction) | — | Pending |
| AC-9 | (JWT redaction) | — | Pending |
| AC-10 | (strict-only patterns) | — | Pending |
| AC-11 | (recursive payload redaction) | — | Pending |
| AC-12 | (fingerprint contract) | — | Pending |
| AC-13 | (hash golden vectors) | — | Pending |
| AC-14 | (hash determinism) | — | Pending |
| AC-15 | (augment HTTP shape) | — | Pending |
| AC-16 | (prompt-only mode) | — | Pending |
| AC-17 | (no cacheHit synthesis) | — | Pending |
| AC-18 | (tenantId hashing) | — | Pending |
| AC-19 | (agentId literal) | — | Pending |
| AC-20 | (build + size assertion) | — | Pending |
| AC-21 | (smoke load) | — | Pending |
| AC-22 | (no other src touched) | — | Pending |
| AC-23 | (README) | — | Pending |
| AC-24 | (test baseline preserved) | — | Pending |
| AC-25 | (engines + deps unchanged) | — | Pending |

**Coverage:** 18 R-NN + 25 AC-NN = 43 traceable requirements. All mapped.

---

## Success Criteria

Phase 3 is DONE when:

- [ ] `packages/sdk/` exists with the full structure: `package.json`, `tsconfig.json`, `tsup.config.ts` (or `tsup` in package.json scripts), `src/`, `dist/` (post-build), `test/`, `README.md`
- [ ] Root `package.json` has `"workspaces": ["packages/*"]`
- [ ] `npm install` at root succeeds; `@memory-studio/sdk` resolves via workspace symlink
- [ ] `cd packages/sdk && npm run build` produces `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` (and ESM d.ts equivalents) with **total gzipped size ≤ 50KB** (asserted; build fails if over)
- [ ] All 25 ACs above are observable in test output
- [ ] `npm test` at repo root passes — 207-test baseline (from commit `74b4cdc`) preserved or grown
- [ ] `cd packages/sdk && npm test` (workspace-local tests) passes — smoke test loads the built package
- [ ] `git diff <baseline>..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/` is empty (no other source files modified)
- [ ] `grep -r "claude-code" packages/sdk/src/` returns exactly 1 match (the literal)
- [ ] Verifier independently runs the discrimination sensor (per `tlc-spec-driven` post-Execute step) and reports PASS

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 3](../../ROADMAP.md) — done criteria (lines 271-309)
- [`.specs/architecture/memory-studio.html`](../../architecture/memory-studio.html) — farol stable IDs (`sdk`, `state-json`)
- [`.specs/architecture/memory-studio.architecture.json`](../../architecture/memory-studio.architecture.json) — farol JSON source
- [PRD §5](../../../PRD.md) — SDK cliente (TS shape, fingerprint, agentId="claude-code")
- [PRD §7.1](../../../PRD.md) — `/augment` request + response schemas
- [PRD §8](../../../PRD.md) — stack + invariante "TypeScript puro, zero deps nativas"
- [PRD §10.3](../../../PRD.md) — security (zero raw persistence, tenantId hashed, placeholders)
- [PRD §14.4](../../../PRD.md) — agentId="claude-code" MVP
- [PRD §17.2](../../../PRD.md) — nomenclature (`recentFiles`, `lastEvent`)
- [SPEC §IMod-2](../../../.scratch/memory-studio/spec.md) — SDK API contract
- [SPEC §IMod-3](../../../.scratch/memory-studio/spec.md) — `/augment` request schema
- [SPEC §IMod-4](../../../.scratch/memory-studio/spec.md) — `/augment` response schema
- [SPEC §IMod-20](../../../.scratch/memory-studio/spec.md) — nomenclature rules
- [SPEC §C](../../../.scratch/memory-studio/spec.md) — SDK user stories
- [SPEC §F](../../../.scratch/memory-studio/spec.md) — security invariants
- [SPEC §K](../../../.scratch/memory-studio/spec.md) — nomenclature invariants
- [Phase 2 spec](../../features/phase-2-detector-fingerprint/spec.md) — fingerprint/hash module (server-side reference)
- [Phase 2 fingerprint source](../../../src/fingerprint/fingerprint.ts) — 4-component builder template
- [Phase 2 hash source](../../../src/fingerprint/hash.ts) — `hashSha256_16` template
- [Phase 1 schema source](../../../src/catalog/schema/skill.ts) — `Skill`/`Rule`/`Persona` Zod types (SDK does NOT depend; included for type shape reference only)
- [`package.json`](../../../package.json) — root config (will gain `workspaces` field)
- [`tsconfig.json`](../../../tsconfig.json) — root tsconfig (unchanged)
- [`.gitignore`](../../../.gitignore) — already covers `dist/`, `node_modules/`, `data/`, `models/`
- [`CLAUDE.md`](../../../CLAUDE.md) — testing contract, gate commands