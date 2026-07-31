---
date: 2026-07-31
version: 1
description: "Requirements for Phase 4 — UI Panel: local five-tab catalog control, project state, critical-rule enforcement, and measurable local performance."
explanation: |
  Converts ROADMAP Phase 4, PRD §§4/5/6.2/10, and SPEC §B/IMod-1/IMod-20 into testable requirements. Ambiguities are resolved autonomously under the roadmap-loop Planner contract.
related:
  - ./design.md
  - ./tasks.md
  - ../../ROADMAP.md
  - ../../STATE.md
  - ../../../PRD.md
  - ../../../.scratch/memory-studio/spec.md
---

# Phase 4 — UI Panel Specification

## Problem Statement

Memory Studio needs a visible, project-local control surface so a human can inspect catalog items, choose which items are active, understand Critical Rule safeguards, inspect available audit data, and view or edit operational settings. The panel must remain lightweight and immediately usable: a localhost service on the first free port, five responsive screens, HTMX + Alpine with no build step, and measured local loading below one second.

## Goals

- [ ] Serve the panel at the first free `127.0.0.1` port in the inclusive range 41823–42823.
- [ ] Provide Skills, Rules, Personas, Audit, and Settings screens with the exact Phase 4 interactions.
- [ ] Persist project-specific toggle and settings state in `<project-cwd>/.memory-studio/state.json` while preserving schema version 3 fields.
- [ ] Enforce Critical Rule toggle-off confirmation in the server contract, not only in browser state.
- [ ] Measure cold-cache and warm-cache first-byte latency below 1,000 ms.
- [ ] Keep UI delivery buildless and responsive at viewport widths of 1024 px and above.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Retrieval and `POST /augment` | Owned by Phase 5a. |
| Audit event writes, buffering, database query implementation, and summaries | Owned by Phase 5b; Phase 4 displays supplied/empty audit data only. |
| Fastify server or the Phase 5 endpoint module | Phase 4 uses a deliberately lightweight Node 22 HTTP adapter; Phase 5 owns Fastify. |
| Catalog YAML editing/creation or index rebuild | Phase 4 reads catalog data and writes only per-project state. PRD keeps YAML as source of truth. |
| Tauri, Svelte, SPA router, bundler, or compiled frontend | Explicitly excluded by the MVP stack decision. |
| Runtime enforcement that injects active Critical Rules | Phase 5 retrieval/runtime responsibility; Phase 4 enforces the state-transition contract. |
| Full Audit backend | The Audit screen renders the last N events when supplied; Phase 5b later replaces the empty/fixture adapter. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here; autonomous mode has no synchronous confirmation gate.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| `/state/toggle` ownership split | **Option (a): Phase 4 implements the real minimal endpoint and state write; Phase 5b later subsumes the contract unchanged.** | UI toggle and ROADMAP AC explicitly require HTTP status behavior now. Mock/localStorage options would not prove persistence or server enforcement. The handler stays UI-local and framework-free, minimizing later replacement cost. | Assumed from roadmap contract |
| Critical confirmation representation | Request field `critical_confirm` must equal the literal string `CONFIRMAR`; missing, boolean, differently cased, or whitespace-padded values do not confirm. | Gives the server one precise, independently testable explicit-intent token and matches D-004 wording. | Assumed |
| Critical Rule semantics | A critical Rule is normally active but may be deactivated only through the explicit confirmation flow. UI text says: `Rule critical:true — exemplo: toggle off + digitar 'CONFIRMAR' no painel → aceito; sem confirmação → bloqueado`. | Reconciles “always on” warning with PRD/SPEC acceptance of an explicit override. | Assumed |
| State extension | Preserve schema v3 and existing fields; use `activeCatalog: string[]` as the canonical active-item set. Do not introduce a second toggle map. | Existing setup and SPEC already define `activeCatalog`; one source avoids drift. | Assumed |
| Settings writes | Settings controls persist through a minimal `POST /state/settings`; tenant is stored as `tenantId`, embedding model as `embeddingModel`, while existing `thresholds`, `integrationMode`, `agentId`, `fastAgent`, and `ui` remain intact. | The screen must permit operational control, but Phase 4 cannot rely on Phase 5 endpoints. Additive fields preserve schema v3 compatibility. | Assumed |
| Tenant scope | MVP Settings exposes one project-local tenant string; it does not implement multi-tenancy. | PRD excludes multi-tenant support but requires tenant visibility in Settings. | Assumed |
| Catalog source | Server reads `config/catalog/*.yaml` through the Phase 1 schema/loader surface or a small read adapter; fixtures may be injected in tests. | YAML remains source of truth, while this feature must not modify `src/catalog/**`. | Assumed |
| Audit source before Phase 5b | `GET /ui/audit` renders an injected provider or an empty-state partial; no fabricated production events and no database writes. | Enables the required screen without stealing Phase 5b ownership. | Assumed |
| Routing | Hash navigation (`#skills`, `#rules`, etc.) is controlled by one Alpine shell; tab bodies are fetched as HTMX partials and progressively rendered. | No router dependency, direct links remain understandable, and partial contracts remain testable. | Assumed |
| Browser libraries | Vendored static HTMX and Alpine browser assets are served by the UI package, not fetched from a public CDN at runtime. | “No data leaves the machine” and reliable offline/local behavior are stronger project invariants than remote-CDN convenience; zero build step is preserved. | Assumed |
| First-byte performance | Cold = fresh server process and first request; warm = second request to same process. Each is measured with `Date.now()` from immediately before `fetch()` until response headers resolve; both must be `<1000 ms`. | Creates reproducible measured evidence instead of an estimate. | Assumed |
| Responsive threshold | At 1024 px, the shell, list columns, and side panel must fit without horizontal page overflow; below 1024 px is best-effort and not a Phase 4 gate. | Matches ROADMAP’s explicit viewport boundary. | Assumed |
| Concurrent writes | State mutations are serialized in process and use write-temp-then-rename; malformed current state returns an error without overwriting it. | Prevents lost updates and partial JSON while staying inside a single local Node process. | Assumed |
| Server exposure/auth | Bind only to `127.0.0.1`; no authentication or rate limiting in Phase 4. Reject non-JSON mutation requests and bound request body size to 64 KiB. | Local-only server is the stated security boundary; validation prevents trivial accidental misuse. | Assumed |
| Catalog mutation wording in PRD | “Modificar/adicionar” is interpreted as changing activation/settings, not editing YAML content. | PRD §6.4 makes YAML the catalog source of truth and Phase 4 deliverables include state, not an editor. | Assumed |

**Open questions:** none — all unresolved choices are logged above.

---

## User Stories

### P1: Launch and navigate the local panel

**User Story**: As a developer, I want the UI server to select the first free local port and show five screens so that I can open the control surface without port configuration or a frontend build.

**Acceptance Criteria**:

1. **UI-01** — WHEN the server starts and one or more ports are available in the inclusive range 41823–42823 THEN it SHALL bind to `127.0.0.1` on the numerically first free port and report the full URL.
2. **UI-02** — WHEN every port in 41823–42823 is unavailable THEN startup SHALL fail with a non-zero exit and an error identifying the exhausted range.
3. **UI-03** — WHEN the root URL loads THEN the panel SHALL expose exactly five navigable screens named Skills, Rules, Personas, Audit, and Settings, with hash-based navigation and no client router.
4. **UI-04** — WHEN browser assets and partials are requested THEN the server SHALL deliver static HTML/CSS/JS and five HTMX partials without requiring a build command or Fastify.

**Independent Test**: Occupy the first port, launch the server, observe selection of the next port, fetch `/`, navigate all five hashes, and fetch every partial.

---

### P1: Inspect and filter catalog items

**User Story**: As a human working with a code agent, I want searchable Skills, Rules, and Personas lists with a reading panel so that I can scan and inspect catalog content.

**Acceptance Criteria**:

1. **UI-05** — WHEN Skills, Rules, or Personas is shown THEN the screen SHALL render the matching catalog type as a list with item identity/title, active state, and a selectable row.
2. **UI-06** — WHEN the user enters a name, ID, title, keyword, category, or text fragment THEN the visible catalog list SHALL filter case-insensitively to matching items; clearing the query SHALL restore the full list.
3. **UI-07** — WHEN the user selects a catalog item THEN a side panel SHALL show its full readable content and relevant metadata without leaving the current tab.
4. **UI-08** — WHEN a catalog type has no items or a query has no matches THEN the screen SHALL show an explicit empty state rather than a blank panel or error.

**Independent Test**: Inject one item of each type, search by title and text keyword, select a result, and assert the list and side-panel response.

---

### P1: Persist active catalog and protect Critical Rules

**User Story**: As a human, I want per-project toggles with an explicit Critical Rule safeguard so that accidental changes cannot remove safety rails.

**Acceptance Criteria**:

1. **UI-09** — WHEN a non-critical Skill, Rule, or Persona toggle request is valid THEN `POST /state/toggle` SHALL update the project’s `activeCatalog`, atomically persist `.memory-studio/state.json`, and return HTTP 200 with the resulting active state.
2. **UI-10** — WHEN a request attempts to turn off a Rule whose catalog record has `critical: true` without `critical_confirm` exactly equal to `CONFIRMAR` THEN `POST /state/toggle` SHALL return HTTP 400 and SHALL NOT change the state file.
3. **UI-11** — WHEN the same critical toggle-off request supplies `critical_confirm: "CONFIRMAR"` THEN the endpoint SHALL return HTTP 200 and atomically persist the Rule as inactive.
4. **UI-12** — WHEN a Critical Rule is rendered THEN the UI SHALL show a visual warning and the exact example: `Rule critical:true — exemplo: toggle off + digitar 'CONFIRMAR' no painel → aceito; sem confirmação → bloqueado`.
5. **UI-13** — WHEN the user attempts a critical toggle-off in the UI THEN the UI SHALL require a text input and enable confirmation only for the literal `CONFIRMAR`; cancellation or an incorrect value SHALL leave the Rule active.
6. **UI-14** — WHEN a toggle request names an unknown item, unsupported action, malformed JSON, or wrong field type THEN the endpoint SHALL return HTTP 400 and SHALL NOT mutate state.

**Independent Test**: Perform non-critical, blocked-critical, and confirmed-critical HTTP requests against a temporary project and compare the file before and after each request.

---

### P1: Limit active Personas

**User Story**: As a human, I want at most three Personas active so that the assembled system message remains coherent.

**Acceptance Criteria**:

1. **UI-15** — WHEN three Personas are active and the user tries to activate a fourth THEN the browser UI SHALL block the request and show an inline cap-3 error.
2. **UI-16** — WHEN `POST /state/toggle` receives a request that would activate a fourth Persona THEN the server SHALL return HTTP 400 and SHALL NOT mutate state, even if the browser guard is bypassed.
3. **UI-17** — WHEN an active Persona is disabled THEN another Persona SHALL become selectable and may be persisted normally.

**Independent Test**: Seed three active personas, attempt a fourth in browser logic and directly over HTTP, then disable one and retry successfully.

---

### P1: Inspect Audit and canonical context labels

**User Story**: As a human, I want an Audit screen that can display recent augmentation evidence so that I can understand what was injected without exposing raw prompts.

**Acceptance Criteria**:

1. **UI-18** — WHEN audit events are supplied THEN the Audit screen SHALL display the last N events in newest-first order with timestamp, redacted prompt, matched IDs, pruning reasons, and latency.
2. **UI-19** — WHEN no audit provider or no audit events are available before Phase 5b THEN the Audit screen SHALL render an explicit “no audit events yet” state and SHALL NOT fabricate events.
3. **UI-20** — WHEN the Audit screen explains collected context THEN all tooltips SHALL use the canonical camelCase term `recentFiles` and SHALL NOT use `gitStatus`, `recent_files`, or generic `files` as an alias for that concept.

**Independent Test**: Inject ordered audit fixtures and an empty provider, then inspect generated partial text and ordering.

---

### P1: View and persist Settings

**User Story**: As a human, I want project settings visible and editable so that I can tune retrieval and understand the current runtime configuration.

**Acceptance Criteria**:

1. **UI-21** — WHEN Settings loads THEN it SHALL show `minCosineSimilarity`, `minFtsHits`, tenant, integration mode, and embedding model values sourced from project state.
2. **UI-22** — WHEN a valid settings update is submitted THEN the server SHALL atomically persist the changed settings while retaining unrelated schema-version-3 fields.
3. **UI-23** — WHEN threshold values are non-finite/out of range (`minCosineSimilarity` outside 0–1; `minFtsHits` not an integer ≥0), integration mode is unsupported, or a required string is empty THEN the server SHALL return HTTP 400 and SHALL NOT modify the state file.

**Independent Test**: Update every editable field in a temporary state file, verify retained fields, and then submit each invalid boundary.

---

### P1: Meet local load and responsive-layout gates

**User Story**: As a human, I want the local panel to appear immediately and remain usable on a 1024 px viewport so that it does not interrupt agent work.

**Acceptance Criteria**:

1. **UI-24** — WHEN measured from immediately before `fetch(rootUrl)` until response headers resolve on a fresh server process THEN cold first-byte time SHALL be `<1000 ms`.
2. **UI-25** — WHEN the same measurement is repeated against the running server THEN warm first-byte time SHALL be `<1000 ms`.
3. **UI-26** — WHEN rendered at 1024 px viewport width THEN Skills, Rules, and Personas list layouts plus the reading side panel SHALL remain operable without horizontal page overflow.
4. **UI-27** — WHEN the root document is inspected THEN it SHALL contain no bundler-generated dependency requirement and no remote stylesheet/framework dependency; UI behavior SHALL be provided by HTMX + Alpine static assets and templates.

**Independent Test**: Run the performance sensor with `Date.now()` against a fresh process and use a 1024 px DOM/layout test to assert no root overflow and usable controls.

---

## Edge Cases and Implicit-Requirement Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | UI-14, UI-16, UI-23; JSON bodies capped at 64 KiB; exact confirmation token. |
| Failure / partial-failure states | Port exhaustion fails clearly; malformed state and failed atomic rename return errors without corrupting/overwriting the prior file; unavailable audit source renders empty state. |
| Idempotency / retry / duplicate handling | Setting an item to its existing state returns 200 with unchanged canonical state; duplicate `activeCatalog` IDs are normalized to one ID on successful writes. |
| Auth boundaries & rate limits | N/A because Phase 4 binds only to loopback and is a local single-user tool; request size validation is included. |
| Concurrency / ordering | Mutations are serialized in-process and atomically replaced; audit events render newest-first. |
| Data lifecycle / expiry | N/A because Phase 4 owns durable project state only; audit retention belongs to Phase 5b/7. |
| Observability | Startup reports selected URL; mutation errors use status + structured JSON body; performance test records cold/warm milliseconds. |
| External-dependency failure | Browser libraries are local static assets; no runtime CDN dependency. Audit provider absence is an explicit empty state. |
| State-transition integrity | Critical Rule confirmation and Persona cap are enforced at both UI and server boundaries; invalid mutations are no-ops. |

Additional edge behavior:

- WHEN `.memory-studio/state.json` is absent THEN the state service SHALL create the directory/file from schema-v3 defaults on the first successful mutation.
- WHEN the state file contains invalid JSON or an unsupported `schemaVersion` THEN mutation endpoints SHALL return an error and preserve the original bytes.
- WHEN a toggle is repeated with the already-current action THEN the response SHALL be HTTP 200 and the logical state SHALL remain unchanged.
- WHEN catalog content includes HTML-like text THEN the side panel SHALL render it as text, not executable markup.
- WHEN the selected item disappears after a search THEN the side panel SHALL clear or show a non-selected state, not stale content.

---

## Requirement Traceability

| Requirement ID | Story | Source | Status |
| --- | --- | --- | --- |
| UI-01–UI-04 | Launch/navigation | ROADMAP done 1, 2, 12; PRD §§4–5 | In Design |
| UI-05–UI-08 | Catalog inspection | ROADMAP done 3; SPEC §B 9–11 | In Design |
| UI-09–UI-14 | Toggle/Critical Rules | ROADMAP done 8–10; PRD §6.2/§10.1; D-004 | In Design |
| UI-15–UI-17 | Persona cap | ROADMAP done 5; SPEC §B 15 | In Design |
| UI-18–UI-20 | Audit | ROADMAP done 6; SPEC §IMod-20 | In Design |
| UI-21–UI-23 | Settings | ROADMAP done 7–8 | In Design |
| UI-24–UI-27 | Performance/responsive/stack | ROADMAP done 11–12; PRD §10.4 | In Design |

**Coverage:** 27 requirements; 27 mapped to design and tasks; 0 unmapped.

## Success Criteria

- [ ] All 27 UI requirements have automated acceptance evidence.
- [ ] Five screens are independently fetchable and navigable.
- [ ] Critical Rule and Persona server guards reject invalid transitions without state mutation.
- [ ] Cold and warm first-byte measurements each record `<1000 ms`.
- [ ] Existing root gates and package-workspace behavior remain green.
