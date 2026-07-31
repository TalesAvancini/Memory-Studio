---
date: 2026-07-31
version: 1
description: "Phase 3 atomic tasks. 8 tasks across 3 subchapters (3.1 SDK core, 3.2 HTTP client, 3.3 build + smoke). Each task is one component/file with verification criteria, atomic commit, and traceable to spec R/AC IDs."
explanation: |
  Phase 3 packs into 3 subchapters (8 tasks total, fits single Implementer batch
  per `tlc-spec-driven` ≤ 8-task rule):

    - 3.1 SDK core: T-01 (workspace + scaffold), T-02 (types + redact),
      T-03 (collectContext + fingerprint + agent-id), T-04 (hash primitive)
    - 3.2 HTTP client: T-05 (MemoryStudioClient class), T-06 (HTTP tests)
    - 3.3 Build + smoke: T-07 (tsup config + build), T-08 (smoke + README + size assert)

  Subchapter boundaries are at genuine dependency seams:
    - 3.1: pure SDK logic (no HTTP, no build artifact)
    - 3.2: HTTP client (depends on 3.1 types + hash)
    - 3.3: build packaging + smoke (depends on all above)

  Single Implementer batch fits naturally: 8 tasks = 1 batch.

  Each task has:
    - one file or one logical unit (no bundling)
    - explicit `Depends on` from task bodies
    - verification commands the Implementer must run before commit
    - traceable R-NN / AC-NN from spec.md

related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../../architecture/memory-studio.html
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../features/phase-1-catalog-schema-index/{spec,design,tasks}.md
  - ../../features/phase-2-detector-fingerprint/{spec,design,tasks}.md
  - ../../../src/fingerprint/fingerprint.ts
  - ../../../src/fingerprint/hash.ts
  - ../../../package.json
  - ../../../tsconfig.json
  - ../../../.gitignore
  - ../../../CLAUDE.md
---

# Phase 3 — SDK Cliente — Tasks

**Source spec:** [`./spec.md`](./spec.md)
**Source design:** [`./design.md`](./design.md)
**Branch:** `loop/phase-0` (carried forward; new atomic commits land here)
**Baseline:** commit `74b4cdc` (Phase 2 Verifier PASS — 207 tests)
**Output deliverables:**
- `packages/sdk/` (new workspace package)
- Root `package.json` gains `"workspaces": ["packages/*"]` field
- NO changes to `src/catalog/**`, `src/social-detector/**`, `src/fingerprint/**`, `src/search/**`, `tsconfig.json`, `.gitignore`

---

## Test Coverage Matrix

> Generated from codebase + CLAUDE.md testing contract + spec acceptance criteria.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| **Hash primitive** (`hash.ts`) | unit | 4+ NIST golden vectors (empty string, "abc", "The quick brown fox..."); determinism; 32-char hex shape regex; perf < 100ms for 1MB input | `packages/sdk/test/hash.test.mjs` | `cd packages/sdk && npm test` |
| **Redact module** (`redact.ts`) | unit | 3 minimal patterns × multiple inputs; 3 strict-only patterns; recursive `redactValue` on object/array/primitive; empty/null/undefined pass-through | `packages/sdk/test/redact.test.mjs` | `cd packages/sdk && npm test` |
| **Collect context** (`collect-context.ts`) | unit | Redact applied to `scratch` before serialize; redact applied to `lastEvent.payload` recursively; `todos`/`recentFiles`/`legacyState` pass through unchanged; empty input → empty Context | `packages/sdk/test/collect-context.test.mjs` | `cd packages/sdk && npm test` |
| **Fingerprint** (`fingerprint.ts`) | unit | 4-comp return shape; returned `sessionId` matches `hashSha256_16(input.sessionId)`; raw `sessionId` NOT in result (anti-leak guard); unicode + ASCII; determinism; agentId defaults to "claude-code" if omitted | `packages/sdk/test/fingerprint.test.mjs` | `cd packages/sdk && npm test` |
| **Memory Studio client** (`memory-studio-client.ts`) | unit | HTTP POST shape (URL, method, headers, body); `tenantId` hashed before request; prompt-only sends `context: null`; 200 with empty matches → success; 4xx/5xx → `SdkError("http_error", ...)`; malformed JSON → `SdkError("invalid_response", ...)` | `packages/sdk/test/memory-studio-client.test.mjs` | `cd packages/sdk && npm test` |
| **Smoke test** (built package) | e2e (post-build) | `await import("@memory-studio/sdk")` resolves; 3 named exports are functions; runs against built `dist/index.mjs` | `packages/sdk/test/smoke.test.mjs` | `cd packages/sdk && npm test` (after `npm run build`) |
| **Build size assertion** | e2e (build) | `tsup` `onSuccess` measures `dist/index.mjs` gzipped size; exits 1 if > 50KB | (build script) | `cd packages/sdk && npm run build` |
| **Workspace wiring** | none | `npm install` at root resolves `@memory-studio/sdk` via symlink; verified by `ls -la node_modules/@memory-studio/sdk` | (operational) | `npm install` |
| **TypeScript contract** | none — build/type gate only | All types match PRD §5/§7.1/§17.2; strict mode + `noUncheckedIndexedAccess`; ESM exports field; zero runtime deps | All `packages/sdk/src/*.ts` | `cd packages/sdk && npm run typecheck` (or root `npm run typecheck` if it globs workspaces) |

**Provenance:** guidelines from `CLAUDE.md ## Testing contract` + `package.json` engines (Node 22 LTS, ESM) + Phase 1+2 test patterns (`node --test`, ESM imports).

---

## Gate Check Commands

> Generated from `package.json` + CLAUDE.md testing contract.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| **Quick** | After tasks with unit tests only (T-02, T-03, T-04, T-05) | `cd packages/sdk && npm test` |
| **Full** | After tasks with HTTP/e2e tests (T-06, T-07, T-08) | `cd packages/sdk && npm test` + `cd packages/sdk && npm run build` |
| **Build** | After phase completion (T-08, end of phase) | `cd packages/sdk && npm run build` (asserts size) + `cd packages/sdk && npm test` (all SDK tests green) + root `npm test` (207-test baseline preserved) + root `npm run typecheck` (no other src changes) |
| **Typecheck** | After any TS change | `cd packages/sdk && npx tsc --noEmit` OR root `npm run typecheck` |
| **Workspace verify** | After T-01 | `npm install` at root succeeds; `ls -la node_modules/@memory-studio/sdk` shows symlink to `packages/sdk` |
| **Scope guard** | After T-08 (end of phase) | `git diff 74b4cdc..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/` returns empty |

**Note:** Root `npm test` does NOT include `packages/sdk/test/` (glob is `test/**/*.test.mjs`, workspace-local tests are separate). 207-root-test baseline is preserved by Verifier checking root test count.

---

## Execution Plan

Three subchapters run sequentially. Each subchapter fits within the 8-task Implementer budget. Whole Phase 3 = 1 batch.

```
Subchapter 3.1 (SDK core):       T-01 → T-02 → T-03 → T-04
                                       ↓
Subchapter 3.2 (HTTP client):          T-05 → T-06
                                                  ↓
Subchapter 3.3 (Build + smoke):               T-07 → T-08
```

### Batch packing (Implementer dispatch)

| Batch | Subchapters | Tasks | Worker |
| --- | --- | --- | --- |
| **Batch 1** | 3.1 + 3.2 + 3.3 | T-01..T-08 (8 tasks) | Worker A (Implementer sub-agent) |
| **Validation** | (all) | (all 8) | Worker B (Verifier sub-agent) — fresh, evidence-or-zero |

Single batch runs first; Validation runs once after Batch 1 reports all-tasks-complete.

---

## Task Breakdown

### Subchapter 3.1 — SDK Core

#### T-01: Workspace scaffolding + root package.json wiring

**What:** Create `packages/sdk/` directory with skeleton files: `package.json` (with `"workspaces": ["packages/*"]` declared at root), `tsconfig.json`, `.gitignore`, `tsup.config.ts` (placeholder), `src/index.ts` (empty barrel), `test/.gitkeep`. Add `"workspaces": ["packages/*"]` to root `package.json`. Add `"build:sdk": "npm -w @memory-studio/sdk run build"` to root `scripts` (optional convenience).

**Where:**
- CREATE: `packages/sdk/package.json` (skeleton)
- CREATE: `packages/sdk/tsconfig.json` (extends root-style minimal config)
- CREATE: `packages/sdk/.gitignore` (`dist/`, `node_modules/`)
- CREATE: `packages/sdk/tsup.config.ts` (placeholder — T-07 fills in)
- CREATE: `packages/sdk/src/index.ts` (placeholder `export {};`)
- CREATE: `packages/sdk/test/.gitkeep`
- MODIFY: root `package.json` (add `"workspaces": ["packages/*"]`)

**Depends on:** None (first task)

**Reuses:** None (greenfield scaffolding)

**Requirement:** R-01, R-12, R-13 (partial), AC-1, AC-2, AC-3, AC-4 (partial)

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `packages/sdk/` directory exists with all 7 placeholder files
- [ ] `packages/sdk/package.json` declares `"name": "@memory-studio/sdk"`, `"type": "module"`, `"engines": { "node": ">=22" }`, `"files": ["dist"]`, `"exports": { ".": { "types": "./dist/index.d.mts", "import": "./dist/index.mjs", "require": "./dist/index.cjs" } }` (placeholder paths OK)
- [ ] `packages/sdk/package.json` has `"devDependencies"` with `tsup`, `typescript`, `@types/node`; `"dependencies": {}` (empty)
- [ ] `packages/sdk/package.json` has `"scripts": { "build": "tsup", "test": "node --test test/**/*.test.mjs" }`
- [ ] Root `package.json` has `"workspaces": ["packages/*"]` field added
- [ ] `npm install` at root succeeds (installs `tsup` + workspace symlinks `@memory-studio/sdk`)
- [ ] `ls -la node_modules/@memory-studio/sdk` shows a symlink to `../../packages/sdk`
- [ ] `git diff 74b4cdc..HEAD -- src/` returns empty (no other source touched)

**Tests:** none (scaffolding)

**Gate:** workspace verify (`npm install` + symlink check) + quick (root `npm run typecheck` still passes)

**Commit:** `feat(phase-3): scaffold @memory-studio/sdk workspace package (T-01)`

---

#### T-02: Public types + redact module

**What:** Implement `packages/sdk/src/types.ts` (all public TS types) and `packages/sdk/src/redact.ts` (regex-based redaction with 3 minimal + 3 strict patterns). Implement `packages/sdk/src/agent-id.ts` (single literal). Add `test/redact.test.mjs` with 3+ minimal pattern tests + 3 strict-only tests + recursive `redactValue` tests + edge cases (null, undefined, primitive, nested object).

**Where:**
- CREATE: `packages/sdk/src/types.ts` (CollectContextInput, Context, FingerprintInput, Fingerprint, AugmentRequest, AugmentResponse, RedactionMode, SdkError)
- CREATE: `packages/sdk/src/redact.ts` (Redactor with 6 patterns + REDACTED constant + redactString + redactValue)
- CREATE: `packages/sdk/src/agent-id.ts` (`export const AGENT_ID = "claude-code" as const;`)
- CREATE: `packages/sdk/test/redact.test.mjs`

**Depends on:** T-01

**Reuses:** Pattern list from design.md §Components 2 (Redact Module)

**Requirement:** R-04, R-05, AC-5 (types), AC-7, AC-8, AC-9, AC-10, AC-11

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `types.ts` exports all 8 public types matching the shapes in design.md §Data Models
- [ ] `Context` type uses camelCase (`recentFiles`, `lastEvent`) per SPEC §IMod-20
- [ ] `AugmentRequest` uses `schemaVersion: 3` literal per PRD §7.1
- [ ] `AugmentResponse` does NOT include `cacheHit` field per PRD §17.1 (MVP)
- [ ] `redact.ts` exports `redactString(input: string, mode: RedactionMode): string`, `redactValue(input: unknown, mode: RedactionMode): unknown`, `REDACTED` constant
- [ ] Minimal patterns redact: API keys (`sk-…`, `pk-…`, `api_key=…`, `api-key=…`), .env values (`(KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)=value`), JWT tokens (`eyJ…\.eyJ…\.…`)
- [ ] Strict-only patterns redact: GitHub PAT (`gh[pousr]_…`), AWS keys (`AKIA…`), PEM blocks (`-----BEGIN …PRIVATE KEY-----…-----END…-----`)
- [ ] Minimal mode does NOT redact strict-only patterns (verified by AC-10)
- [ ] `redactValue` recurses into nested objects/arrays (verified by AC-11)
- [ ] `redactValue` on null/undefined/primitives returns input unchanged
- [ ] `agent-id.ts` exports `AGENT_ID = "claude-code" as const`
- [ ] `test/redact.test.mjs` has:
  - Test 1: `redactString("My API key is sk-1234567890abcdef1234567890abcdef", "minimal")` returns `"My API key is <REDACTED>"`
  - Test 2: `redactString("password=hunter2 in my .env", "minimal")` returns `"<REDACTED> in my .env"`
  - Test 3: `redactString("eyJ…is my JWT", "minimal")` returns `"<REDACTED> is my JWT"`
  - Test 4: `redactString("AKIAIOSFODNN7EXAMPLE", "minimal")` returns `"AKIAIOSFODNN7EXAMPLE"` (preserved)
  - Test 5: `redactString("AKIAIOSFODNN7EXAMPLE", "strict")` returns `"<REDACTED>"`
  - Test 6: `redactValue({api_key: "sk-…", safe: "public"}, "minimal")` returns `{api_key: "<REDACTED>", safe: "public"}`
  - Test 7: `redactValue([{token: "sk-…"}, "safe"], "minimal")` returns `[{token: "<REDACTED>"}, "safe"]`
  - Test 8: `redactValue(null, "minimal")` returns `null`
  - Test 9: `redactValue(undefined, "minimal")` returns `undefined`
- [ ] `cd packages/sdk && npm test` passes
- [ ] `cd packages/sdk && npx tsc --noEmit` exits 0

**Tests:** unit (redact test file)

**Gate:** quick (workspace tests + typecheck)

**Commit:** `feat(phase-3): SDK types + redact module with 6 regex patterns (T-02)`

---

#### T-03: collectContext + fingerprint + hash primitive

**What:** Implement `packages/sdk/src/hash.ts` (Node `crypto` sha256[0:16] with golden vectors), `packages/sdk/src/collect-context.ts` (`collectContext()` with redact-before-serialize), and `packages/sdk/src/fingerprint.ts` (4-comp builder with sessionId hashed). Add `test/hash.test.mjs`, `test/collect-context.test.mjs`, `test/fingerprint.test.mjs`.

**Where:**
- CREATE: `packages/sdk/src/hash.ts`
- CREATE: `packages/sdk/src/collect-context.ts`
- CREATE: `packages/sdk/src/fingerprint.ts`
- CREATE: `packages/sdk/test/hash.test.mjs`
- CREATE: `packages/sdk/test/collect-context.test.mjs`
- CREATE: `packages/sdk/test/fingerprint.test.mjs`

**Depends on:** T-02 (uses types + REDACTED + RedactionMode)

**Reuses:** Phase 2's `src/fingerprint/{hash,fingerprint}.ts` as template (inlined, not imported)

**Requirement:** R-03, R-06, R-07, R-11, AC-6, AC-12, AC-13, AC-14, AC-19

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `hash.ts` exports `hashSha256_16(input: string): string` and `HASH_HEX_LENGTH = 32`
- [ ] Uses `import { createHash } from "node:crypto"` (no npm deps)
- [ ] `hashSha256_16("")` returns `"e3b0c44298fc1c149afbf4c8996fb924"` (NIST vector)
- [ ] `hashSha256_16("abc")` returns `"ba7816bf8f01cfea414140de5dae2223"` (NIST vector, first 32 hex chars of `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`)
- [ ] `hashSha256_16("The quick brown fox jumps over the lazy dog")` returns `"d7a8fbb307d7809469ca9abcb0082e4f"` (NIST vector, first 32 hex chars)
- [ ] Determinism: `hashSha256_16(x) === hashSha256_16(x)` for any `x`
- [ ] Returned string matches `/^[0-9a-f]{32}$/`
- [ ] `collect-context.ts` exports `async function collectContext(opts: CollectContextInput): Promise<Context>`
- [ ] Applies `redactString` to `opts.scratch` before setting `ctx.scratch`
- [ ] Applies `redactValue` to `opts.lastEvent.payload` recursively
- [ ] Passes through `opts.todos`, `opts.recentFiles`, `opts.legacyState`, `opts.sessionId` unchanged
- [ ] Default `redaction` is `"minimal"` (if omitted)
- [ ] `fingerprint.ts` exports `async function fingerprint(opts: FingerprintInput): Promise<Fingerprint>`
- [ ] Returns object with exactly 4 keys: `projectPath`, `agentId`, `sessionId`, `gitBranch`
- [ ] Returned `sessionId` is `hashSha256_16(opts.sessionId)`
- [ ] Returned `projectPath` and `gitBranch` are pass-through
- [ ] `agentId` defaults to `AGENT_ID` ("claude-code") if `opts.agentId` is undefined
- [ ] Raw `opts.sessionId` is NEVER in the returned object (anti-leak)
- [ ] `test/hash.test.mjs` has 4+ golden vectors + 1 determinism + 1 shape regex + 1 perf (1MB < 100ms)
- [ ] `test/collect-context.test.mjs` has:
  - Test: `collectContext({scratch: "key=secret"})` returns `Context.scratch === "<REDACTED> in my .env"` style (redact applied)
  - Test: `collectContext({scratch: "sk-…", redaction: "strict"})` returns same (no extra patterns in strict that affect `sk-…`)
  - Test: `collectContext({lastEvent: {type: "tool_call", payload: {api_key: "sk-…"}}, redaction: "minimal"})` returns `Context.lastEvent.payload.api_key === "<REDACTED>"`
  - Test: empty input `{}` returns empty Context `{}`
- [ ] `test/fingerprint.test.mjs` has:
  - Test: returned object has exactly 4 keys
  - Test: returned `sessionId` matches `hashSha256_16(input.sessionId)`
  - Test: raw `sessionId` not in result (`!Object.values(result).includes(input.sessionId)`)
  - Test: determinism (call twice, results equal)
  - Test: unicode sessionId hashes correctly
  - Test: omitting `agentId` defaults to "claude-code"
- [ ] `cd packages/sdk && npm test` passes
- [ ] `cd packages/sdk && npx tsc --noEmit` exits 0
- [ ] `grep -r "claude-code" packages/sdk/src/` returns exactly 1 match (in `agent-id.ts`)

**Tests:** unit (3 test files — hash, collect-context, fingerprint)

**Gate:** quick (workspace tests + typecheck + grep)

**Commit:** `feat(phase-3): hash + collectContext + fingerprint with redact-before-serialize (T-03)`

---

### Subchapter 3.2 — HTTP Client

#### T-04: `MemoryStudioClient` class + tenantId hashing

**What:** Implement `packages/sdk/src/memory-studio-client.ts` with `MemoryStudioClient` class. Constructor hashes `tenantId` via `hashSha256_16`. `augment()` method issues `POST {baseURL}/augment` with JSON body (includes hashed tenantId), parses response, throws `SdkError` on 4xx/5xx or malformed JSON.

**Where:**
- CREATE: `packages/sdk/src/memory-studio-client.ts`

**Depends on:** T-03 (uses `hashSha256_16`, types)

**Reuses:** Native `fetch` (Node 22 built-in)

**Requirement:** R-08, R-10, R-17, AC-15, AC-16, AC-17, AC-18

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `memory-studio-client.ts` exports `class MemoryStudioClient`
- [ ] Constructor: `(opts: { baseURL: string; tenantId: string })` — strips trailing slash from baseURL
- [ ] Constructor stores `hashSha256_16(opts.tenantId)` in private field `tenantIdHashed`
- [ ] `async augment(req: AugmentRequest): Promise<AugmentResponse>` method exists
- [ ] Method calls `fetch(`${baseURL}/augment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...req, tenantId: this.tenantIdHashed, schemaVersion: 3 }) })`
- [ ] Method awaits `res.json()` and returns the result (cast to `AugmentResponse`)
- [ ] On `!res.ok`, throws `new SdkError("http_error", "HTTP {status}: {body}")` after reading body as text
- [ ] On JSON parse error, throws `new SdkError("invalid_response", ...)`
- [ ] `SdkError` class is defined in `types.ts` (per A-12) with `readonly code: string` field
- [ ] `cd packages/sdk && npx tsc --noEmit` exits 0

**Tests:** none (T-05 covers behavior)

**Gate:** quick (typecheck)

**Commit:** `feat(phase-3): MemoryStudioClient class with hashed tenantId (T-04)`

---

#### T-05: HTTP client tests with mocked fetch

**What:** Create `packages/sdk/test/memory-studio-client.test.mjs` that mocks `globalThis.fetch` (via `node:test` `mock.method()` or direct override) and asserts: (1) POST URL/method/headers/body shape, (2) `tenantId` is hashed before send, (3) prompt-only sends `context: null` (not omitted), (4) 200 with empty matches → success, (5) 4xx/5xx → `SdkError("http_error", ...)`, (6) malformed JSON → `SdkError("invalid_response", ...)`.

**Where:**
- CREATE: `packages/sdk/test/memory-studio-client.test.mjs`

**Depends on:** T-04 (uses `MemoryStudioClient`)

**Reuses:** Node 22 `node:test` `mock` API

**Requirement:** AC-15, AC-16, AC-17, AC-18

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `test/memory-studio-client.test.mjs` exists with 6+ test cases
- [ ] Test 1: POST `{baseURL}/augment` with method POST, Content-Type application/json, body includes `tenantId: hashSha256_16("tenant-abc")` (NOT raw `"tenant-abc"`)
- [ ] Test 2: prompt-only — `client.augment({prompt: "hi", context: null, fingerprint, activeCatalog: [], schemaVersion: 3})` sends body with `"context": null` (literal `null` in JSON, not omitted)
- [ ] Test 3: 200 with full response → returns parsed `AugmentResponse`
- [ ] Test 4: 200 with empty `matchedSkills: []`, `emptyReason: "no_active_items"` → returns parsed response without crash
- [ ] Test 5: 4xx (e.g., 400) → throws `SdkError` with `code === "http_error"` and message includes status
- [ ] Test 6: 5xx (e.g., 500) → throws `SdkError` with `code === "http_error"`
- [ ] Test 7: 200 with malformed JSON → throws `SdkError` with `code === "invalid_response"`
- [ ] `fetch` is mocked via `mock.method(globalThis, 'fetch', ...)` and restored in `t.mock.restore()` after each test (or `afterEach`)
- [ ] `cd packages/sdk && npm test` passes

**Tests:** unit (this IS the test file)

**Gate:** quick (workspace tests)

**Commit:** `test(phase-3): MemoryStudioClient HTTP tests with mocked fetch (T-05)`

---

### Subchapter 3.3 — Build + Smoke

#### T-06: tsup config + build script (dual ESM/CJS + d.ts)

**What:** Implement `packages/sdk/tsup.config.ts` with dual ESM + CJS builds, declaration files, minification, tree-shaking, and `onSuccess` hook that measures gzipped size of `dist/index.mjs` and asserts ≤ 50KB. Implement `packages/sdk/src/index.ts` barrel re-exporting all 3 functions + types + SdkError + REDACTED + AGENT_ID + hashSha256_16 + HASH_HEX_LENGTH. Run `cd packages/sdk && npm run build` and verify all 4 output files exist + size assertion passes.

**Where:**
- CREATE: `packages/sdk/tsup.config.ts` (full impl per design.md)
- MODIFY: `packages/sdk/src/index.ts` (full barrel re-exporting everything)
- MODIFY: `packages/sdk/package.json` (verify `exports` field paths match tsup output)

**Depends on:** T-01, T-03, T-04 (all source files in place)

**Reuses:** `tsup` (devDep added in T-01), Node `zlib.gzipSync`

**Requirement:** R-13, R-14, AC-3, AC-5, AC-20

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `tsup.config.ts` exports `defineConfig({...})` with: `entry: ['src/index.ts']`, `format: ['esm', 'cjs']`, `dts: true`, `clean: true`, `target: 'node22'`, `minify: true`, `treeshake: true`, `splitting: false`, `sourcemap: false`, `outExtension({format}) { return { js: format === 'cjs' ? '.cjs' : '.mjs' } }`
- [ ] `onSuccess` hook reads `dist/index.mjs`, gzips via `zlib.gzipSync`, prints `[SIZE] sdk: {gzKB}KB gzipped ({rawKB}KB raw)` to stderr
- [ ] `onSuccess` exits 1 if gzipped size > 50_000 bytes
- [ ] `src/index.ts` exports: `collectContext`, `fingerprint`, `MemoryStudioClient` (functions/classes); `CollectContextInput`, `Context`, `FingerprintInput`, `Fingerprint`, `AugmentRequest`, `AugmentResponse`, `RedactionMode` (types); `SdkError` (class); `REDACTED` (constant); `AGENT_ID` (constant); `hashSha256_16`, `HASH_HEX_LENGTH` (functions/constants)
- [ ] `cd packages/sdk && npm run build` exits 0
- [ ] `packages/sdk/dist/` contains: `index.mjs`, `index.cjs`, `index.d.ts` (or `.d.mts`)
- [ ] Build stderr prints `[SIZE] sdk: {X}KB gzipped ({Y}KB raw)` with X ≤ 50.00
- [ ] `cd packages/sdk && npx tsc --noEmit` exits 0

**Tests:** none (build is its own verification)

**Gate:** full (build exits 0 + size asserted)

**Commit:** `feat(phase-3): tsup dual ESM/CJS build with 50KB gzipped size assertion (T-06)`

---

#### T-07: Smoke test (loads built package via `await import`)

**What:** Create `packages/sdk/test/smoke.test.mjs` that runs AFTER `npm run build`. Does `await import("@memory-studio/sdk")` via the built package (resolved via the workspace symlink at `node_modules/@memory-studio/sdk` → `packages/sdk/`). Asserts all 3 named exports are functions/classes. Proves the package is consumable from Node 22 with zero external runtime deps.

**Where:**
- CREATE: `packages/sdk/test/smoke.test.mjs`

**Depends on:** T-06 (build must produce the package)

**Reuses:** Node 22 dynamic `import()`, built `dist/index.mjs`

**Requirement:** R-15, AC-21

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `test/smoke.test.mjs` exists
- [ ] Test uses `await import("@memory-studio/sdk")` (resolves via workspace symlink)
- [ ] Asserts `typeof collectContext === "function"`
- [ ] Asserts `typeof fingerprint === "function"`
- [ ] Asserts `typeof MemoryStudioClient === "function"` (class is a function in JS)
- [ ] `cd packages/sdk && npm run build && npm test` exits 0 (build must run before smoke test — verify by running sequence)
- [ ] If smoke test is run WITHOUT prior build, it fails with clear error message ("package not built — run npm run build first")

**Tests:** e2e (post-build smoke)

**Gate:** full (build + test sequence)

**Commit:** `test(phase-3): smoke test loads built @memory-studio/sdk package (T-07)`

---

#### T-08: README + final scope guard verification

**What:** Write `packages/sdk/README.md` with sections: (a) Installation (`npm install @memory-studio/sdk`), (b) Basic Usage (PRD §5 snippet verbatim), (c) API Reference (link to PRD §5 for full contract), (d) Notes (workspace package, MVP scope). Run final verification: root `npm test` (207-test baseline preserved), `cd packages/sdk && npm test` (all SDK tests pass), `cd packages/sdk && npm run build` (size assertion passes), `git diff 74b4cdc..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/` returns empty, `grep -r "claude-code" packages/sdk/src/` returns exactly 1 match.

**Where:**
- CREATE: `packages/sdk/README.md`

**Depends on:** T-06, T-07

**Reuses:** PRD §5 snippet

**Requirement:** R-16, R-18, AC-22, AC-23, AC-24, AC-25

**Tools:**
- MCP: `filesystem`
- Skill: NONE

**Done when:**
- [ ] `packages/sdk/README.md` exists with < 100 lines
- [ ] README has 4 sections: Installation, Basic Usage, API Reference, Notes
- [ ] Basic Usage section includes the verbatim PRD §5 snippet (with `collectContext`, `fingerprint`, `MemoryStudioClient`)
- [ ] API Reference section links to PRD §5
- [ ] Notes section mentions: workspace package, MVP scope (Claude Code only), zero runtime deps
- [ ] Final verification suite ALL passes:
  - [ ] `cd packages/sdk && npm run build` exits 0 (size ≤ 50KB gzipped)
  - [ ] `cd packages/sdk && npm test` exits 0 (all SDK tests green)
  - [ ] Root `npm test` exits 0 (207-test baseline preserved)
  - [ ] Root `npm run typecheck` exits 0
  - [ ] `git diff 74b4cdc..HEAD -- src/catalog/ src/social-detector/ src/fingerprint/ src/search/` returns empty
  - [ ] `grep -r "claude-code" packages/sdk/src/` returns exactly 1 match
  - [ ] `grep -E "(better-sqlite3|onnxruntime-node|sqlite-vec|yaml|zod)" packages/sdk/package.json` returns zero matches in `dependencies` block
  - [ ] `cat packages/sdk/package.json | jq '.dependencies'` returns `{}` (empty)

**Tests:** none (operational verification + README)

**Gate:** build (final verification suite)

**Commit:** `docs(phase-3): SDK README + final scope guard verification (T-08)`

---

## Phase Execution Map

```
Subchapter 3.1 (SDK core):           T-01 → T-02 → T-03 → T-04
                                              ↓
Subchapter 3.2 (HTTP client):               T-05 → T-06
                                                        ↓
Subchapter 3.3 (Build + smoke):                    T-07 → T-08
```

Execution is strictly sequential — no intra-subchapter parallelism.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T-01: Workspace scaffold | 6 file creates + 1 root package.json modify | OK (scaffolding is cohesive) |
| T-02: Types + redact + agent-id | 3 file creates + 1 test file | OK (one logical unit: public surface) |
| T-03: hash + collectContext + fingerprint | 3 file creates + 3 test files | OK (one logical unit: request builders) |
| T-04: MemoryStudioClient class | 1 file create | OK |
| T-05: HTTP client tests | 1 test file | OK |
| T-06: tsup config + build + barrel | 1 config file + 1 barrel file + 1 package.json verify | OK (one logical unit: build) |
| T-07: Smoke test | 1 test file | OK |
| T-08: README + final verification | 1 file + verification suite | OK (one logical unit: docs + scope guard) |

**Granularity check:** all 8 tasks are atomic (1 component / 1 function / 1 logical unit). No restructuring needed.

---

## Diagram-Definition Cross-Check

| Task | Depends on (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T-01 | None | (root) | OK |
| T-02 | T-01 | T-01 → T-02 | OK |
| T-03 | T-02 | T-02 → T-03 | OK |
| T-04 | T-03 | T-03 → T-04 | OK |
| T-05 | T-04 | T-04 → T-05 | OK |
| T-06 | T-01, T-03, T-04 | T-03/T-04 → T-06 | OK |
| T-07 | T-06 | T-06 → T-07 | OK |
| T-08 | T-06, T-07 | T-06/T-07 → T-08 | OK |

All `Depends on` arrows match the diagram. No task depends on a later task.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T-01 | Workspace scaffold | none | none | OK |
| T-02 | Types + redact | unit (redact) | unit | OK |
| T-03 | hash + collectContext + fingerprint | unit (3 test files) | unit | OK |
| T-04 | MemoryStudioClient source | none (T-05 tests) | none | OK |
| T-05 | HTTP tests | unit (mocked fetch) | unit | OK |
| T-06 | tsup build | e2e (build itself) | none | OK |
| T-07 | Smoke test | e2e (post-build) | e2e | OK |
| T-08 | README + verification | none (operational) | none | OK |

All tasks satisfy the Test Coverage Matrix. No `Tests: none` for code layers that require tests.

---

## Requirement Coverage

| Requirement | Planned task(s) | Outcome evidence |
| --- | --- | --- |
| R-01 | T-01 | Workspace + root package.json field |
| R-02 | T-01, T-08 | Empty `dependencies` block verified |
| R-03 | T-03 | `collectContext()` returns Context shape |
| R-04 | T-02 | Context type uses camelCase (`recentFiles`, `lastEvent`) |
| R-05 | T-02, T-03 | Redact applied in `collectContext` before serialize |
| R-06 | T-03 | `fingerprint()` returns 4-comp with hashed sessionId |
| R-07 | T-03 | `hashSha256_16` returns 32-char hex; NIST golden vectors |
| R-08 | T-04, T-05 | `MemoryStudioClient.augment()` issues POST /augment |
| R-09 | T-04, T-05 | `AugmentRequest` + `AugmentResponse` types match PRD §7.1 |
| R-10 | T-05 | Prompt-only sends `context: null` |
| R-11 | T-03, T-08 | `agentId` literal in `agent-id.ts`; grep returns 1 match |
| R-12 | T-01, T-06 | `package.json` `exports` field with dual entries |
| R-13 | T-06 | tsup dual ESM + CJS + d.ts build |
| R-14 | T-06 | tsup `onSuccess` measures gzipped size; asserts ≤ 50KB |
| R-15 | T-07 | Smoke test loads built package |
| R-16 | T-08 | README with 4 sections |
| R-17 | T-01, T-02, T-03 | No workspace dep on root; inlined primitives |
| R-18 | T-08 | `git diff` shows only `packages/sdk/**` + root `package.json` changes |
| AC-1 | T-01 | `packages/sdk/` directory with all files |
| AC-2 | T-01 | Root workspace field; symlink resolves |
| AC-3 | T-01, T-06 | `package.json` shape with dual exports |
| AC-4 | T-01, T-08 | Empty `dependencies` block |
| AC-5 | T-02, T-06 | Named exports resolved |
| AC-6 | T-03 | `collectContext` returns Context shape |
| AC-7 | T-02, T-03 | API key redaction |
| AC-8 | T-02, T-03 | .env value redaction |
| AC-9 | T-02, T-03 | JWT redaction |
| AC-10 | T-02, T-03 | Strict-only patterns (AKIA) |
| AC-11 | T-02, T-03 | Recursive payload redaction |
| AC-12 | T-03 | `fingerprint` 4-comp + hash + no-leak |
| AC-13 | T-03 | NIST golden vectors |
| AC-14 | T-03 | Hash determinism + shape regex |
| AC-15 | T-04, T-05 | HTTP POST shape |
| AC-16 | T-05 | Prompt-only `context: null` |
| AC-17 | T-05 | No `cacheHit` synthesis |
| AC-18 | T-04, T-05 | `tenantId` hashed |
| AC-19 | T-03, T-08 | `agentId` literal location |
| AC-20 | T-06 | Build + size assertion |
| AC-21 | T-07 | Smoke test loads |
| AC-22 | T-08 | No other src touched |
| AC-23 | T-08 | README |
| AC-24 | T-08 | Root test baseline preserved |
| AC-25 | T-08 | Engines + deps unchanged |

**Coverage:** 18 requirements + 25 ACs = 43 mapped to tasks, 0 unmapped.

---

## Cross-references

- [`./spec.md`](./spec.md) — Phase 3 spec (18 R-NN + 25 AC-NN requirements)
- [`./design.md`](./design.md) — architecture + module layout + tech decisions
- [`.specs/ROADMAP.md` Phase 3](../../ROADMAP.md) — done criteria (10 checkboxes, lines 271-309)
- [`.specs/architecture/memory-studio.html`](../../architecture/memory-studio.html) — farol stable IDs (`sdk`, `state-json`)
- [PRD §5](../../../PRD.md) — SDK cliente (TS shape, fingerprint, agentId="claude-code")
- [PRD §7.1](../../../PRD.md) — `/augment` request + response schemas
- [PRD §8](../../../PRD.md) — stack + invariante "TypeScript puro, zero deps nativas"
- [PRD §10.3](../../../PRD.md) — security (zero raw persistence, tenantId hashed)
- [PRD §14.4](../../../PRD.md) — agentId="claude-code" MVP
- [PRD §17.2](../../../PRD.md) — nomenclature (`recentFiles`, `lastEvent`)
- [SPEC §IMod-2](../../../.scratch/memory-studio/spec.md) — SDK API contract
- [SPEC §IMod-3](../../../.scratch/memory-studio/spec.md) — `/augment` request schema
- [SPEC §IMod-4](../../../.scratch/memory-studio/spec.md) — `/augment` response schema
- [SPEC §IMod-20](../../../.scratch/memory-studio/spec.md) — nomenclature rules
- [SPEC §C](../../../.scratch/memory-studio/spec.md) — SDK user stories
- [SPEC §F](../../../.scratch/memory-studio/spec.md) — security invariants
- [SPEC §K](../../../.scratch/memory-studio/spec.md) — nomenclature invariants
- [Phase 1 spec](../../features/phase-1-catalog-schema-index/spec.md) — 185-test baseline reference
- [Phase 2 spec](../../features/phase-2-detector-fingerprint/spec.md) — fingerprint/hash module (server-side reference)
- [Phase 2 fingerprint source](../../../src/fingerprint/fingerprint.ts) — 4-component builder template
- [Phase 2 hash source](../../../src/fingerprint/hash.ts) — `hashSha256_16` template
- [`package.json`](../../../package.json) — root config (will gain `workspaces` field)
- [`tsconfig.json`](../../../tsconfig.json) — root tsconfig (unchanged)
- [`.gitignore`](../../../.gitignore) — already covers `dist/`, `node_modules/`, `data/`, `models/`
- [`CLAUDE.md`](../../../CLAUDE.md) — testing contract, gate commands
- [`scripts/lessons.py`](../../../scripts/lessons.py) — `quarantine <id>` for calibration residue drift findings (AD-002)