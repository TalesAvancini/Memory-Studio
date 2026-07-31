---
date: 2026-07-31
version: 1
description: "Atomic execution plan for Phase 4 UI Panel, split into four roadmap-loop subchapters with acceptance-driven tests and gates."
explanation: |
  Maps 27 UI requirements to 13 sequential tasks. Tests are co-located with each behavior task, and each subchapter is sized for a dedicated Implementer and fresh Verifier.
related:
  - ./spec.md
  - ./design.md
  - ../../ROADMAP.md
  - ../../../CLAUDE.md
---

# Phase 4 — UI Panel Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the per-task cycle, atomic commits, gates, adequacy review, independent Verifier, and discrimination sensor.

**If the skill cannot be activated, STOP and report the blocker.**

The parent `tlc-roadmap-loop` has already approved subchapter delegation. Execute one subchapter per Implementer, sequentially. Each Implementer commits every task atomically; each subchapter receives fresh verification before the next begins.

**Spec**: `.specs/features/phase-4-ui-panel/spec.md`  
**Design**: `.specs/features/phase-4-ui-panel/design.md`  
**Status**: Approved for Execute via autonomous loop

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `CLAUDE.md ## Testing contract`; `.scratch/memory-studio/spec.md ## Testing Decisions`; `package.json`; package-local precedent in `packages/sdk/package.json`; sampled Node tests in `test/catalog/loader.test.mjs`, `test/catalog/schema.test.mjs`, `test/fingerprint/fingerprint.test.mjs`, `test/social-detector.test.mjs`, and `packages/sdk/test/memory-studio-client.test.mjs`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Port discovery and server lifecycle | integration | UI-01–UI-04 plus occupied-first-port, bind race/exhaustion, loopback binding, unknown route/method, clean shutdown | `packages/ui/test/{port,server}.test.mjs` | `npm test --workspace @memory-studio/ui` |
| State schema/store | unit + integration | Missing/default state, schema preservation, malformed/unsupported state, serialized concurrent mutations, atomic write failure, idempotent normalization; all relevant edge cases | `packages/ui/test/state.test.mjs` | `npm test --workspace @memory-studio/ui` |
| Toggle/settings transitions | unit + HTTP integration | 1:1 to UI-09–UI-17 and UI-21–UI-23; happy, edge, direct-bypass, malformed, and no-mutation-on-error paths | `packages/ui/test/{transitions,server}.test.mjs` | `npm test --workspace @memory-studio/ui` |
| Catalog/Audit/Settings partials | unit/contract | 1:1 to UI-05–UI-08, UI-12, UI-18–UI-23; HTML escaping, exact D-004 copy, canonical `recentFiles`, newest-first, empty/error states | `packages/ui/test/partials.test.mjs` | `npm test --workspace @memory-studio/ui` |
| Browser interaction component | integration | Hash fallback/navigation, case-insensitive search, side-panel lifecycle, critical modal exact-token gate, persona cap inline error, HTMX refresh event | `packages/ui/test/browser.test.mjs` | `npm test --workspace @memory-studio/ui` |
| Static CSS/responsive contract | integration/browser | UI-26 at 1024 px: no root horizontal overflow, catalog controls and side panel operable; long text wraps | `packages/ui/test/responsive.test.mjs` | `npm test --workspace @memory-studio/ui` |
| Local load performance | performance/integration | UI-24–UI-25: fresh-process cold and same-process warm first-byte measured with `Date.now()`, both 200 and `<1000 ms`, values reported | `packages/ui/test/performance.test.mjs` | `npm test --workspace @memory-studio/ui -- --test-name-pattern="first-byte"` |
| Package/config/static assets | smoke + typecheck | Workspace discovery preserves `packages/*`; UI package imports; no build prerequisite; local HTMX/Alpine/CSS assets; no remote dependency; SDK scripts remain intact | `packages/ui/test/smoke.test.mjs` | `npm run typecheck --workspace @memory-studio/ui && npm test --workspace @memory-studio/ui` |

## Gate Check Commands

> Generated from repository manifests and CLAUDE.md. Node 22 ESM lesson applies: use `node --test`/package script, not `node --test <dir>`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After a task whose new tests are package-local | `npm test --workspace @memory-studio/ui` |
| Full | After HTTP/browser integration tasks and every subchapter close | `npm test --workspace @memory-studio/ui && npm run typecheck --workspace @memory-studio/ui && npm test && npm run typecheck && npm run catalog:load` |
| Performance | Subchapter 4.4 load gate | `npm test --workspace @memory-studio/ui -- --test-name-pattern="first-byte"` |
| Build/config | Package scaffold or static/config-only change | `npm run typecheck --workspace @memory-studio/ui && npm test --workspace @memory-studio/ui && npm run typecheck` |

Expected-count rule: record the actual package/root test counts at each task start and require `baseline + task-added tests` at completion. Never hardcode a stale repository count and never allow silent deletion.

---

## Execution Plan and Subchapter Breakdown

Subchapters run strictly in order. The roadmap-loop dispatches a fresh Implementer for each subchapter and a fresh Verifier at the required boundary.

```text
4.1 UI workspace + state schema (4 tasks)
T4.1-1 → T4.1-2 → T4.1-3 → T4.1-4

4.2 Skills + Rules + Personas (4 tasks)
T4.2-1 → T4.2-2 → T4.2-3 → T4.2-4

4.3 Audit + Settings (2 tasks)
T4.3-1 → T4.3-2

4.4 Enforcement integration + performance + responsive closeout (3 tasks)
T4.4-1 → T4.4-2 → T4.4-3
```

**Total: 13 tasks.**

---

## Subchapter 4.1 — UI Workspace + State Schema

### T4.1-1: Scaffold `@memory-studio/ui` and local static shell

**What**: Add the UI workspace package, strict TS config, package scripts, buildless root shell, locally served HTMX/Alpine assets, minimal CSS, and a package smoke test.  
**Where**: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/src/index.ts`, `packages/ui/public/{index.html,styles.css,htmx.min.js,alpine.min.js,app.js}`, `packages/ui/test/smoke.test.mjs`  
**Depends on**: None  
**Reuses**: `packages/sdk/{package.json,tsconfig.json}` workspace conventions; root `package.json` already has `"workspaces": ["packages/*"]`  
**Requirements**: UI-03, UI-04, UI-27  
**Tools**: Skill `tlc-spec-driven`; filesystem; npm/node

**Done when**:

- [ ] Workspace resolves as `@memory-studio/ui` without changing the root `packages/*` glob.
- [ ] Shell exposes five hash anchors and one content target.
- [ ] HTMX and Alpine assets are local static files; root markup has no remote framework/style dependency and no bundler prerequisite.
- [ ] Smoke test asserts package import, five labels/hashes, asset references, and absence of remote CDN URLs.
- [ ] Build/config gate passes with no regression to existing workspace discovery; actual test counts are recorded.

**Tests**: smoke + typecheck  
**Gate**: Build/config  
**Commit**: `feat(ui): scaffold buildless workspace shell`

---

### T4.1-2: Implement first-free-port discovery and server lifecycle

**What**: Add inclusive ascending port scanning, loopback bind, retry-after-probe race handling, typed exhaustion, server start/close API, and the thin project launcher.  
**Where**: `packages/ui/src/port.ts`, `packages/ui/src/server.ts`, `scripts/ui-server.mjs`, `packages/ui/test/{port,server}.test.mjs`  
**Depends on**: T4.1-1  
**Reuses**: Node 22 `node:http`/`node:net`; ESM and `node:test` conventions  
**Requirements**: UI-01, UI-02, UI-04  
**Tools**: Skill `tlc-spec-driven`; Node built-ins; npm/node. **Do not use Fastify.**

**Done when**:

- [ ] Default range is inclusive 41823–42823 and host is exactly `127.0.0.1`.
- [ ] Occupied-first-port test chooses the next numerically free port.
- [ ] Exhaustion test fails with range-identifying error and launcher exits non-zero.
- [ ] Root/static assets return correct status/content type; unknown route and unsupported method return 404/405.
- [ ] Server closes cleanly in tests and launcher prints the selected full URL.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: integration  
**Gate**: Full  
**Commit**: `feat(ui): add lightweight local server lifecycle`

---

### T4.1-3: Implement schema-v3 project state store

**What**: Define `ProjectStateV3` and implement validated default loading, schema-preserving reads, serialized mutations, de-duplication, and temp-write/rename persistence rooted at an injected project cwd.  
**Where**: `packages/ui/src/state.ts`, `packages/ui/test/state.test.mjs`  
**Depends on**: T4.1-2  
**Reuses**: `.memory-studio/setup.md` schema and current `.memory-studio/state.json` field names/defaults  
**Requirements**: UI-09, UI-22 plus state edge cases  
**Tools**: Skill `tlc-spec-driven`; Node filesystem APIs

**Done when**:

- [ ] Type preserves schemaVersion 3, `activeCatalog`, thresholds, fastAgent, integrationMode, agentId, and ui; additive `tenantId`/`embeddingModel` are supported.
- [ ] Missing state initializes defaults only on first successful mutation.
- [ ] Valid updates preserve unrelated fields and normalize duplicate active IDs.
- [ ] Malformed JSON/unsupported schema returns a typed conflict without changing original bytes.
- [ ] Concurrent updates serialize without lost writes; simulated rename/write failure leaves prior target intact and cleans temp residue.
- [ ] Quick gate passes and actual test counts are recorded.

**Tests**: unit + integration  
**Gate**: Quick  
**Commit**: `feat(ui): add atomic project state store`

---

### T4.1-4: Wire read-only state and five HTMX partial routes

**What**: Route `/state` and `/ui/{skills,rules,personas,audit,settings}` to explicit renderer/provider seams with safe loading/error responses, before tab-specific behavior is filled in.  
**Where**: `packages/ui/src/{server,render,audit}.ts`, `packages/ui/test/server.test.mjs`  
**Depends on**: T4.1-3  
**Reuses**: Server lifecycle and state store  
**Requirements**: UI-03, UI-04  
**Tools**: Skill `tlc-spec-driven`; Node HTTP

**Done when**:

- [ ] All five partial URLs return HTML responses and `/state` returns validated JSON.
- [ ] Provider failures render safe error partials without exposing filesystem contents.
- [ ] Shell hash default/unknown-hash normalization is defined for the later browser component.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: HTTP integration  
**Gate**: Full  
**Commit**: `feat(ui): expose state and tab partial routes`

---

## Subchapter 4.2 — Skills + Rules + Personas

### T4.2-1: Add normalized read-only catalog adapter

**What**: Implement injected `CatalogReader` over existing Phase 1 catalog/YAML data, normalize three item variants, and reject/escape unsafe or malformed display inputs without touching catalog modules.  
**Where**: `packages/ui/src/catalog.ts`, `packages/ui/test/catalog.test.mjs`  
**Depends on**: T4.1-4  
**Reuses**: Stable Phase 1 catalog schema/read exports under `src/catalog/**`; `yaml` dependency if an adapter is required  
**Requirements**: UI-05, UI-08, UI-14  
**Tools**: Skill `tlc-spec-driven`; codebase inspection; npm/node

**Done when**:

- [ ] Reader lists and resolves Skill/Rule/Persona records with required metadata.
- [ ] Deterministic ordering and unknown-item behavior are tested.
- [ ] Malformed/unavailable catalog produces a safe error path.
- [ ] No changes occur in `src/catalog/**` or any forbidden module.
- [ ] Quick gate passes and actual test counts are recorded.

**Tests**: unit/integration  
**Gate**: Quick  
**Commit**: `feat(ui): add catalog read adapter`

---

### T4.2-2: Render searchable catalog tabs and safe side panel

**What**: Implement Skills/Rules/Personas partials plus Alpine search/selection behavior, explicit empty states, and full-content reading panel with text-safe rendering.  
**Where**: `packages/ui/src/render.ts`, `packages/ui/public/app.js`, `packages/ui/test/{partials,browser}.test.mjs`  
**Depends on**: T4.2-1  
**Reuses**: Shared catalog view model and root Alpine shell  
**Requirements**: UI-05, UI-06, UI-07, UI-08  
**Tools**: Skill `tlc-spec-driven`; Node test harness/browser test dependency only if required

**Done when**:

- [ ] Each type renders identity/title, active state, metadata, and selectable row.
- [ ] Search covers ID/name/title/category/text case-insensitively and clearing restores all items.
- [ ] Selection displays full content without changing tabs; hidden/disappearing selections clear safely.
- [ ] Empty catalog and no-match states are explicit.
- [ ] HTML-like catalog content is displayed as text and cannot execute/render markup.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: unit + browser integration  
**Gate**: Full  
**Commit**: `feat(ui): render searchable catalog tabs`

---

### T4.2-3: Implement toggle transition service and Critical Rule guard

**What**: Add request validation and real state transitions for known items, including exact `CONFIRMAR` enforcement, no-op idempotency, and no-mutation failures.  
**Where**: `packages/ui/src/transitions.ts`, `packages/ui/test/transitions.test.mjs`  
**Depends on**: T4.2-2  
**Reuses**: CatalogReader and ProjectStateStore  
**Requirements**: UI-09, UI-10, UI-11, UI-14  
**Tools**: Skill `tlc-spec-driven`; npm/node

**Done when**:

- [ ] Non-critical on/off updates canonical `activeCatalog` and returns resulting state.
- [ ] Missing, boolean, padded, or wrong-case confirmation blocks critical off with no byte change.
- [ ] Literal `CONFIRMAR` permits critical off.
- [ ] Unknown item, malformed field, and unsupported action return typed validation errors with no mutation.
- [ ] Repeated current-state action is a successful logical no-op and does not duplicate IDs.
- [ ] Quick gate passes and actual test counts are recorded.

**Tests**: unit  
**Gate**: Quick  
**Commit**: `feat(ui): enforce critical rule state transitions`

---

### T4.2-4: Add Critical Rule modal and Persona cap guards

**What**: Add exact warning/example copy, typed confirmation modal, browser cap-3 block, and server transition guard against a fourth Persona.  
**Where**: `packages/ui/src/{render,transitions}.ts`, `packages/ui/public/app.js`, `packages/ui/test/{partials,browser,transitions}.test.mjs`  
**Depends on**: T4.2-3  
**Reuses**: Shared transition service and Alpine component  
**Requirements**: UI-12, UI-13, UI-15, UI-16, UI-17  
**Tools**: Skill `tlc-spec-driven`; npm/node

**Done when**:

- [ ] Critical Rule markup contains the exact mandated example and visual warning semantics.
- [ ] Modal confirm button enables only for literal `CONFIRMAR`; cancel/incorrect value retains active state.
- [ ] Browser blocks fourth Persona before HTTP and shows inline cap-3 error.
- [ ] Direct server transition also blocks fourth Persona with no mutation.
- [ ] Disabling one Persona releases a slot and the next activation succeeds.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: unit + browser integration  
**Gate**: Full  
**Commit**: `feat(ui): add critical confirmation and persona cap`

---

## Subchapter 4.3 — Audit + Settings

### T4.3-1: Implement Audit partial and canonical `recentFiles` tooltips

**What**: Render injected audit events newest-first with the required fields, limit handling, honest empty state, escaping, and canonical context terminology.  
**Where**: `packages/ui/src/{audit,render}.ts`, `packages/ui/test/partials.test.mjs`  
**Depends on**: T4.2-4  
**Reuses**: Injected provider seam and partial router  
**Requirements**: UI-18, UI-19, UI-20  
**Tools**: Skill `tlc-spec-driven`; npm/node

**Done when**:

- [ ] Supplied fixtures display timestamp, redacted prompt, matched IDs, pruning reasons, and latency newest-first, bounded by N.
- [ ] Absent/empty provider displays “no audit events yet” and never fabricated events.
- [ ] Every relevant Audit tooltip uses `recentFiles`; forbidden aliases do not appear for that concept.
- [ ] Prompt/event markup is escaped.
- [ ] Quick gate passes and actual test counts are recorded.

**Tests**: unit/contract  
**Gate**: Quick  
**Commit**: `feat(ui): render audit evidence partial`

---

### T4.3-2: Implement Settings form and validated persistence

**What**: Render state-backed settings and implement validated `POST /state/settings` updates that preserve unrelated schema-v3 data.  
**Where**: `packages/ui/src/{render,transitions,server}.ts`, `packages/ui/public/app.js`, `packages/ui/test/{transitions,server,partials}.test.mjs`  
**Depends on**: T4.3-1  
**Reuses**: ProjectStateStore mutation queue and JSON error envelope  
**Requirements**: UI-21, UI-22, UI-23  
**Tools**: Skill `tlc-spec-driven`; npm/node

**Done when**:

- [ ] Form displays `minCosineSimilarity`, `minFtsHits`, tenant, integration mode, and embedding model from state.
- [ ] Valid update persists all five and preserves activeCatalog, fastAgent, agentId, ui, and schemaVersion.
- [ ] Cosine bounds, FTS integer/lower bound, integration enum, and non-empty string validation are covered.
- [ ] Every rejected update returns 400 and leaves exact prior state bytes unchanged.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: unit + HTTP/browser integration  
**Gate**: Full  
**Commit**: `feat(ui): add validated project settings`

---

## Subchapter 4.4 — Enforcement Integration, Performance, Responsive Closeout

### T4.4-1: Integrate `/state/toggle` HTTP contract end to end

**What**: Connect bounded JSON HTTP parsing to the transition service and browser actions, with stable success/error payloads and refresh behavior.  
**Where**: `packages/ui/src/server.ts`, `packages/ui/public/app.js`, `packages/ui/test/server.test.mjs`  
**Depends on**: T4.3-2  
**Reuses**: Toggle service, state store, catalog reader, JSON error envelope  
**Requirements**: UI-09, UI-10, UI-11, UI-13, UI-14, UI-16  
**Tools**: Skill `tlc-spec-driven`; npm/node

**Done when**:

- [ ] Valid non-critical and confirmed-critical requests return 200 with resulting active state.
- [ ] Unconfirmed critical and fourth-Persona requests return 400 and exact state bytes remain unchanged.
- [ ] Non-JSON content, >64 KiB body, malformed JSON, and wrong types return bounded 400/413 errors without mutation.
- [ ] UI refreshes the current partial only after success and displays server errors inline.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: HTTP + browser integration  
**Gate**: Full  
**Commit**: `feat(ui): integrate state toggle endpoint`

---

### T4.4-2: Close responsive 1024px and accessibility behavior

**What**: Finalize CSS/layout and interaction semantics for 1024 px+, long content, navigation, side panel, modal focus/status feedback, and no horizontal root overflow.  
**Where**: `packages/ui/public/{styles.css,index.html,app.js}`, `packages/ui/test/{browser,responsive}.test.mjs`  
**Depends on**: T4.4-1  
**Reuses**: Existing shell and five partials  
**Requirements**: UI-03, UI-07, UI-13, UI-15, UI-26, UI-27  
**Tools**: Skill `tlc-spec-driven`; local browser/DOM test harness

**Done when**:

- [ ] At 1024 px the document has no horizontal overflow and all three catalog lists plus side panel controls remain operable.
- [ ] Long IDs/content wrap without widening the page.
- [ ] Hash navigation and unknown-hash fallback work; selected tab state is visible.
- [ ] Dialog has label, keyboard close, focus return; inline errors use an announced status region.
- [ ] Root still has no remote dependency/build requirement.
- [ ] Full gate passes and actual test counts are recorded.

**Tests**: browser/responsive integration  
**Gate**: Full  
**Commit**: `feat(ui): finalize responsive accessible layout`

---

### T4.4-3: Measure load budget and run Phase 4 closeout gates

**What**: Add the fresh-process cold/warm first-byte sensor, report measurements, prove five-tab/static/state smoke flow, and run all repository gates.  
**Where**: `packages/ui/test/performance.test.mjs`, `packages/ui/test/smoke.test.mjs`  
**Depends on**: T4.4-2  
**Reuses**: `scripts/ui-server.mjs`, package server lifecycle  
**Requirements**: UI-01–UI-27 (phase closeout), specifically UI-24, UI-25  
**Tools**: Skill `tlc-spec-driven`; Node `child_process`; npm/node

**Done when**:

- [ ] Test launches a fresh server process rooted at a temporary project, captures URL, and measures first request headers with `Date.now()`.
- [ ] Cold first-byte and immediate warm first-byte are both 200, both `<1000 ms`, and both integer measurements are emitted in evidence.
- [ ] Smoke flow fetches root, five partials, state, and local assets.
- [ ] Performance gate and Full gate pass; actual UI/root test counts are recorded; no existing SDK/catalog script is broken.
- [ ] Implementer reports diff/commits for fresh independent Verifier; Verifier must run spec-anchored checks and discrimination sensor before Phase 4 can close.

**Tests**: performance + integration smoke  
**Gate**: Performance, then Full  
**Commit**: `test(ui): enforce local load budget`

---

## Phase Execution Map

```text
Subchapter 4.1
T4.1-1 ─→ T4.1-2 ─→ T4.1-3 ─→ T4.1-4
                                      │
                                      ▼
Subchapter 4.2
T4.2-1 ─→ T4.2-2 ─→ T4.2-3 ─→ T4.2-4
                                      │
                                      ▼
Subchapter 4.3
T4.3-1 ─→ T4.3-2
                 │
                 ▼
Subchapter 4.4
T4.4-1 ─→ T4.4-2 ─→ T4.4-3 ─→ Fresh Verifier
```

Execution is strictly sequential; no task depends on a later task.

---

## Task Granularity Check

| Task | Atomic deliverable | Status |
| --- | --- | --- |
| T4.1-1 | One workspace/static-shell scaffold | Pass |
| T4.1-2 | One server lifecycle/port component | Pass |
| T4.1-3 | One state-store component | Pass |
| T4.1-4 | One partial-routing integration seam | Pass |
| T4.2-1 | One catalog reader component | Pass |
| T4.2-2 | One shared catalog view interaction | Pass |
| T4.2-3 | One toggle transition service | Pass |
| T4.2-4 | One cohesive guard UI/domain integration | Pass |
| T4.3-1 | One Audit view component | Pass |
| T4.3-2 | One Settings vertical slice | Pass |
| T4.4-1 | One endpoint integration | Pass |
| T4.4-2 | One responsive/accessibility closeout | Pass |
| T4.4-3 | One performance/phase gate sensor | Pass |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T4.1-1 | None | Start | Match |
| T4.1-2 | T4.1-1 | T4.1-1 → T4.1-2 | Match |
| T4.1-3 | T4.1-2 | T4.1-2 → T4.1-3 | Match |
| T4.1-4 | T4.1-3 | T4.1-3 → T4.1-4 | Match |
| T4.2-1 | T4.1-4 | T4.1-4 → T4.2-1 | Match |
| T4.2-2 | T4.2-1 | T4.2-1 → T4.2-2 | Match |
| T4.2-3 | T4.2-2 | T4.2-2 → T4.2-3 | Match |
| T4.2-4 | T4.2-3 | T4.2-3 → T4.2-4 | Match |
| T4.3-1 | T4.2-4 | T4.2-4 → T4.3-1 | Match |
| T4.3-2 | T4.3-1 | T4.3-1 → T4.3-2 | Match |
| T4.4-1 | T4.3-2 | T4.3-2 → T4.4-1 | Match |
| T4.4-2 | T4.4-1 | T4.4-1 → T4.4-2 | Match |
| T4.4-3 | T4.4-2 | T4.4-2 → T4.4-3 | Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T4.1-1 | Package/config/static shell | smoke + typecheck | smoke + typecheck | OK |
| T4.1-2 | Port/server lifecycle | integration | integration | OK |
| T4.1-3 | State schema/store | unit + integration | unit + integration | OK |
| T4.1-4 | HTTP routes/render seam | integration | HTTP integration | OK |
| T4.2-1 | Catalog reader | unit/integration | unit/integration | OK |
| T4.2-2 | Partials/browser component | unit + browser integration | unit + browser integration | OK |
| T4.2-3 | Domain transitions | unit | unit | OK |
| T4.2-4 | Domain/browser guards | unit + browser integration | unit + browser integration | OK |
| T4.3-1 | Audit partial | unit/contract | unit/contract | OK |
| T4.3-2 | Settings transition/route/view | unit + HTTP/browser integration | unit + HTTP/browser integration | OK |
| T4.4-1 | Toggle route/browser integration | HTTP + browser integration | HTTP + browser integration | OK |
| T4.4-2 | Responsive/browser behavior | browser/responsive integration | browser/responsive integration | OK |
| T4.4-3 | Performance and smoke | performance + integration | performance + integration | OK |

---

## Requirement-to-Task Traceability

| Requirements | Tasks |
| --- | --- |
| UI-01–UI-02 | T4.1-2, T4.4-3 |
| UI-03–UI-04 | T4.1-1, T4.1-2, T4.1-4, T4.4-2 |
| UI-05–UI-08 | T4.2-1, T4.2-2 |
| UI-09–UI-11 | T4.1-3, T4.2-3, T4.4-1 |
| UI-12–UI-14 | T4.2-3, T4.2-4, T4.4-1 |
| UI-15–UI-17 | T4.2-4, T4.4-1 |
| UI-18–UI-20 | T4.3-1 |
| UI-21–UI-23 | T4.3-2 |
| UI-24–UI-25 | T4.4-3 |
| UI-26–UI-27 | T4.1-1, T4.4-2, T4.4-3 |

**Coverage:** 27/27 requirements mapped; 0 unmapped.

## Touch-Scope Guard

Allowed implementation scope:

- `packages/ui/**`
- `scripts/ui-server.mjs`
- `.memory-studio/state.json` only when implementation needs to update the project default fixture
- `src/ui/**` only if a justified compatibility seam is required (design expects none)
- Root lockfile/package metadata only as npm workspace installation residue; preserve `"workspaces": ["packages/*"]`

Forbidden:

- `src/catalog/**`
- `src/social-detector/**`
- `src/fingerprint/**`
- `src/search/**`
- `packages/sdk/**`
- Fastify/Phase 5 server implementation
