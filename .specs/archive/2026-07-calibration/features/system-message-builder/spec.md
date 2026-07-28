# System Message Builder Specification

**Phase:** ROADMAP Phase 5 — `system-message-builder`
**Status:** Draft (autonomous planner resolution)
**Scope:** Large

## Problem Statement

The catalog already persists items and FTS5 + vec0 retrieval already returns ranked skills, but the binary output of `search(query, k)` has no consumer that turns it into a system message tailored for an LLM provider. This phase must deterministically compose a structured system message (persona + rules + selected skills) keyed by tenant and prompt kind, so that consecutive calls with the same inputs produce byte-identical augmented messages and cache hits become observable side effects of the same identity. The phase must reuse the existing `social-detector` to short-circuit social prompts and the existing `RankedSkill` shape, without introducing a server, transport adapter, or new farol component.

## Goals

- [ ] Expose a factory `createAugmenter({ tenantId })` that returns the public `buildAugmentedMessage(prompt, rankedSkills, persona?, rules?)` function under `src/augmenter/`, with the exact signature required by the planner dispatch.
- [ ] Emit a deterministic `AugmentedMessage` of shape `{ content: string, ephemeral: true, cacheKey: string }` whose `content` and `cacheKey` are byte-identical for two identical input calls and unchanged across process restarts.
- [ ] Compute the cache key as `sha256(tenantId || sorted_skill_hashes || promptKind)` with `promptKind` derived from `isSocial(prompt) ∈ { 'social', 'technical' }`; sort the skill hashes case-sensitively and de-duplicate before hashing.
- [ ] Reuse the Phase 3 `isSocial` edge: when `isSocial(prompt)` is `true`, emit base persona + rules only, with no skills block and no error.
- [ ] Reuse the Phase 4 threshold semantics: when `rankedSkills` is empty, emit base persona + rules only, with no skills block and no error.
- [ ] Keep the augmenter and cache domains free of network/IO/LLM: no `fetch(`, `http.request`, `import('http')`, `import('https')`, `import('node-fetch')` or external call in `src/augmenter/` or `src/cache/`.
- [ ] Cover the four mandatory scenarios (determinism, social bypass, threshold fail, persona/rules injection) plus persona-only, rules-only, full-blend, alphabetical rules, and empty inputs; reach ≥80% line coverage in `src/augmenter/` and `src/cache/` separately under the documented native coverage gate.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Anthropic `cache_control` serialization and wire format | Farol reserves transport for Phase 6; this phase emits only the `ephemeral: true` marker field. |
| `POST /augment` HTTP route, Fastify server, or any of proxy/hook/MCP-v2 adapters | Phase 6 owns the full transport stack. |
| Persisting the cache across process restarts | The decision is locked: cache is ephemeral and lives in-process; no SQLite edge is added. |
| Reranking candidate order | The RRF-ordered `RankedSkill[]` is the source of truth; the cache key sorts for identity, the content uses the same canonical order. |
| Skill gating ("replace or augment base rules") beyond the four mandatory scenarios | The augmenter's job is composition; gating policy is a Phase 6 / Phase 9 concern. |
| Multi-tenant policy, tenant hash for audit log, or telemetry | Phase 6 forwarder + audit log own those concerns. |
| Editing `src/catalog/**`, `src/social-detector/**`, `src/search/**` | Phase 5 only consumes their public surface. |
| Cross-encoder reranker, embedding simulation, or LLM curator | Deferred to Phase 9. |

## Terms and Precise Semantics

- **`AugmentedMessage`**: the public return shape — `{ content: string, ephemeral: true, cacheKey: string }`. `content` is the rendered system message text; `ephemeral` is the literal boolean `true` (an `as const`, not a runtime flag) marking the block as cache-friendly; `cacheKey` is the lowercase hex sha256 of the canonical cache byte-string.
- **`PromptKind`**: a categorical discriminator of the prompt type — `'social'` when `isSocial(prompt)` is `true`, `'technical'` otherwise. It is part of the cache key so a social prompt and a technical prompt with otherwise identical inputs produce different cache keys.
- **Cache byte-string**: the canonical concatenation of `tenantId`, sorted unique skill hashes, and `promptKind`, joined by `\n` and encoded as UTF-8. The byte-string is the input to `createHash('sha256')` and is itself a deterministic observable (`buildCacheByteString`).
- **Cache key**: `sha256(cacheByteString)` expressed as 64 lowercase hex characters. The dispatch wording "cache key hashes tenant_id + sorted skill hashes + prompt kind" is read literally: the cache key is the hash of those three components in that order.
- **Base persona + rules**: the per-call composable persona block (if `persona` is provided) and rules block (if `rules` is non-empty). The base is always the same skeleton regardless of `isSocial` and regardless of `rankedSkills` length; the skills block is the only section that may be omitted.
- **Sorted skill hashes**: the de-duplicated array of `rankedSkills[i].hash` sorted case-sensitively in ascending order. This is the set identity used for caching; the rendered content also uses the corresponding sorted `RankedSkill` order so the rendered bytes match the cache key identity.
- **Social bypass**: the deterministic branch where `isSocial(prompt)` is `true`; the output omits the skills block but keeps the base persona and rules. This is not an error and never throws.
- **Threshold fail**: the deterministic branch where `rankedSkills.length === 0` (the Phase 4 search returns `[]` when neither channel passes). The output omits the skills block but keeps the base persona and rules. This is not an error and never throws.

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here; the autonomous dispatch removes confirmation gates.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Public API entry point | Factory `createAugmenter({ tenantId })` returns the public `buildAugmentedMessage(prompt, rankedSkills, persona?, rules?)` with the exact signature required by the dispatch. | The dispatch is explicit about the function signature; the cache key requires `tenantId` which is not in the per-call signature, so the factory binds it once. The closure is the same shape the dispatch calls "analogous justified shape" — it mirrors `createSearch` from Phase 4. | Assumed under autonomous contract |
| `tenantId` validation | Non-empty string, exactly as passed by the caller. No internal hashing here. | The audit-log sha256 hash is Phase 6's concern; the cache key uses the raw tenant identifier so two callers with the same tenant stay on the same cache key. | Assumed |
| `promptKind` derivation | `'social'` iff `isSocial(prompt)` is `true`; otherwise `'technical'`. The cache key depends on this branch. | Keeps the cache key honest — a social prompt and a technical prompt with the same skills must not collide. | Assumed |
| Cache key byte-string format | `tenantId + '\n' + sortedHashes.join('\n') + '\n' + promptKind`, encoded as UTF-8. The trailing newline is implicit because the join pattern is `'\n'` between every component. | Explicit separators prevent collisions like `('a', 'bc')` vs `('ab', 'c')`. LF is the canonical newline on every supported platform. | Assumed |
| Render order | Persona → rules → skills. Rules sorted by `slug.localeCompare`. Skills sorted by `hash.localeCompare` (the same order used for the cache key). | Determinism requires the cache key identity and the rendered content to use the same canonical order. | Assumed |
| Empty input | Empty `prompt` is allowed; empty `rankedSkills` is the "threshold fail" branch; `persona` and `rules` undefined are allowed. | The dispatch is explicit that empty `rankedSkills` is a non-error condition. Empty `prompt` cannot occur in the hot path but is also a non-error. | Assumed |
| Persona and Rule types | Lightweight `Readonly<{ slug: string, content: string }>` shapes, not `SkillRecord`. | The augmenter does not need catalog metadata; the persona and rules are caller-supplied slices. Using `SkillRecord` would force the caller to construct unused fields. | Assumed |
| Section format | `<persona>`, `<rules>`, `<skills>` XML-style tags; lines inside each section are sorted and joined by `\n`; sections separated by `\n\n`; no trailing newline. | The tags give an LLM a parseable skeleton; the format is symmmetric across the three sections and is byte-stable. | Assumed |
| Cache key shape | 64 lowercase hex characters (standard sha256 hex digest). | The dispatch's `cacheKey: string` is satisfied without inventing a custom encoding. | Assumed |
| `ephemeral` field | Literal `true` (the type narrows to `true`, not `boolean`). | The dispatch wording "cache_control ephemeral marker" makes the literal intent the contract; `true` is the only valid value. | Assumed |
| `persona` and `rules` validation | Public `buildAugmentedMessage` validates that `persona` is undefined or `{ slug: string, content: string }` and that `rules` is undefined or an array of valid `Rule`. Invalid input throws `AugmenterError`. | Mirrors the search/social-detector defence-in-depth pattern. Validation happens before the cache key is computed so bad inputs cannot poison the cache. | Assumed |
| New component or new edge | None. `cache` and `augmenter` are already stable IDs in the farol; the existing edges (`augmenter → search`, `augmenter → cache`, `augmenter → social-detector`) describe the wiring. | The dispatch forbids new farol components; the existing architecture already covers Phase 5. | Confirmed by farol |
| `cache` ↔ SQLite edge | None. The cache is ephemeral and in-process; no DB persistence in this phase. | The dispatch explicitly avoids a new edge; PLAN.md §6 already locks cache as ephemeral. | Assumed |
| Barrel `src/cache/index.ts` and `src/augmenter/index.ts` | None. Consumers import directly from `src/cache/hash.ts`, `src/augmenter/augmenter.ts`, etc. | CLAUDE.md: "Sem barrel exports (index.ts que reexporta tudo). Importar direto do arquivo." | Confirmed by CLAUDE.md |
| Re-export from `src/index.ts` | Yes. The top-level barrel re-exports the new domains from individual files (no domain barrel). | Mirrors the existing `src/index.ts` discovery pattern (it re-exports from `src/catalog/index.ts`, which is a documented exception). | Assumed |

**Open questions:** none — all resolved or logged above.

---

## Implicit-Requirement Dimensions Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | `AugmenterInput` validation throws `AugmenterError(INVALID_INPUT)` if `prompt` is not a string, `rankedSkills` is not an array, `persona` is not undefined or a valid `Persona`, or `rules` is not undefined or an array of valid `Rule`. `createAugmenter` throws `AugmenterError(INVALID_TENANT_ID)` if `tenantId` is not a non-empty string. |
| Failure / partial-failure states | The hot path has no I/O and no failure state. The `isSocial` input is trusted by contract; the catalogue and `RankedSkill` shape are already validated upstream. The function never returns `null`/`undefined` and never throws on the social-bypass or threshold-fail branches. |
| Idempotency / retry / duplicate handling | `AUG-07` plus `C1`: two calls with identical inputs produce `===` equal `content` and `===` equal `cacheKey`. Re-running after a process restart produces the same bytes because the byte-string is a pure function of the inputs. |
| Auth boundaries & rate limits | N/A because the function is library-only and does not see the network. The factory is the only audit-relevant seam and receives `tenantId` directly. |
| Concurrency / ordering | The factory and the closure are pure; `AugmenterOptions` is closed over rather than mutated. Multiple concurrent calls share no mutable state. |
| Data lifecycle / expiry | The cache is in-process and per-tenant. The lifecycle is the caller's concern; Phase 5 returns the cache key in the public shape so the caller can decide. |
| Observability | No logging in the augmenter or cache. The contract is library-only and the privacy rule in `CLAUDE.md` (no prompt content in logs) is upheld by default. |
| External-dependency failure | None — the cache uses only Node's `crypto` module; the augmenter uses only the local `isSocial` function. The dispatch's `C2` no-LLM/no-network guarantee is enforced by a static test. |
| State-transition integrity | None — the function is a pure pipeline. |

---

## User Stories

### P1: Deterministic system message composition — MVP

**User Story:** As a hot-path caller, I want `buildAugmentedMessage(prompt, rankedSkills, persona, rules)` to return the same bytes for the same inputs so that the provider cache can hit deterministically.

**Why P1:** This is the central deliverable of the phase and the hard constraint `C1` plus the dispatch "Done when" line.

**Acceptance Criteria:**

1. **AUG-01 — Public factory and function shape.** WHEN `createAugmenter({ tenantId: 'tenant-a' })` is called with a non-empty string THEN it SHALL return a function `buildAugmentedMessage(prompt: string, rankedSkills: readonly RankedSkill[], persona?: Persona, rules?: readonly Rule[]): AugmentedMessage`; `AugmentedMessage` SHALL be `{ content: string, ephemeral: true, cacheKey: string }` and SHALL be the only public surface for the domain.
2. **AUG-02 — Deterministic byte output.** WHEN `buildAugmentedMessage` is called twice with the same `prompt`, `rankedSkills`, `persona`, and `rules` on the same `tenantId` THEN the returned `content` strings SHALL be `===` and the returned `cacheKey` strings SHALL be `===`; the assertion SHALL be a strict equality test, not `deepEqual`.
3. **AUG-03 — Cache key composition.** WHEN `buildAugmentedMessage` computes the cache key THEN it SHALL hash `tenantId`, the lexicographically sorted unique `rankedSkills[i].hash` values, and `promptKind` in that order, joined by `\n` and encoded as UTF-8, using sha256 hex (64 lowercase chars); ten controlled-input fixtures SHALL verify the exact key.
4. **AUG-04 — `promptKind` branch.** WHEN `isSocial(prompt)` is `true` THEN `promptKind` SHALL be `'social'`, the cache key SHALL differ from the same `rankedSkills` with `promptKind = 'technical'`, and the returned `content` SHALL NOT contain a `<skills>` block.
5. **AUG-05 — `ephemeral` literal.** WHEN `buildAugmentedMessage` returns a message THEN `message.ephemeral` SHALL be the literal `true` (the type narrows to `true`, not `boolean`); any returned value with `ephemeral !== true` SHALL fail the discriminator.
6. **AUG-06 — Base persona + rules structure.** WHEN `persona` is provided THEN the rendered `content` SHALL include a `<persona>` section containing the persona's `content`; WHEN `rules` contains one or more rules THEN the rendered `content` SHALL include a `<rules>` section listing each rule sorted by `slug` in the `[slug] content` form; WHEN both are provided THEN the persona section SHALL precede the rules section.
7. **AUG-07 — Determinism across restarts.** WHEN the same factory is recreated twice with the same `tenantId` and the same inputs are passed THEN the byte-string outputs (both `content` and `cacheKey`) SHALL be identical; the test SHALL assert this without using any persisted state.
8. **AUG-08 — `RankedSkill` reuse.** WHEN `buildAugmentedMessage` is called with `rankedSkills` produced by `createSearch(...)(prompt, k)` from Phase 4 THEN the function SHALL NOT inspect the embeddings BLOB, SHALL NOT mutate the input array, and SHALL read `id`, `slug`, `hash`, `contentYaml` (and other readonly fields) from the `RankedSkill` shape.
9. **AUG-09 — Social bypass branch.** WHEN `isSocial(prompt)` is `true` THEN the rendered `content` SHALL contain the base persona and rules (when provided) and SHALL NOT contain a `<skills>` block; the function SHALL NOT throw.
10. **AUG-10 — Threshold fail branch.** WHEN `rankedSkills` is an empty array THEN the rendered `content` SHALL contain the base persona and rules (when provided) and SHALL NOT contain a `<skills>` block; the function SHALL NOT throw.
11. **AUG-11 — Cache key isolation.** WHEN two calls share the same `rankedSkills` and `promptKind` but differ in `tenantId` THEN the `cacheKey` SHALL differ; the same SHALL hold for differing `promptKind` and differing `rankedSkills` sets; the test SHALL assert cross-isolation.
12. **AUG-12 — Hot-path purity.** WHEN `src/augmenter/` is scanned statically THEN `grep -E 'fetch\(|http\.request|require\(.http.\)|require\(.https.\)|require\(.node-fetch.\)'` over the directory SHALL return zero matches; the test SHALL read the source files directly and assert zero hits.
13. **AUG-13 — Coverage and gate contract.** WHEN the phase is verified THEN `src/augmenter/` and `src/cache/` SHALL each meet at least 80% line coverage under the documented native coverage gate; `npm test` SHALL exit 0 in under 10 seconds; `npm run typecheck` SHALL exit 0; every exported function in the new domains SHALL have at least one behavior assertion; the baseline 184 tests SHALL remain green.

**Independent Test:** Drive the factory with controlled inputs, assert strict equality between two calls, scan the new source files for forbidden imports, and run the documented gates.

---

### P2: Section composition and sort order — MVP

**User Story:** As an LLM consumer, I want each augmented message section to be self-describing and predictable so that the model can reason about the injected context.

**Why P2:** Without deterministic section composition, two runs with the same logical context can produce different bytes, defeating the cache.

**Acceptance Criteria:**

1. **AUG-14 — Person-only output.** WHEN the only non-empty input is `persona` THEN the rendered `content` SHALL be exactly `<persona>\n{persona.content}\n</persona>` and SHALL NOT contain `<rules>` or `<skills>` tags.
2. **AUG-15 — Rules-only output.** WHEN the only non-empty input is `rules` THEN the rendered `content` SHALL list each rule in `slug` ascending order; the test SHALL assert a rules array supplied in reverse-alphabetical order renders in alphabetical order.
3. **AUG-16 — Skills-only output.** WHEN the only non-empty input is `rankedSkills` THEN the rendered `content` SHALL list each skill in `hash` ascending order; the test SHALL assert a skills array supplied in reverse-hash order renders in hash-ascending order; the cache key SHALL use the same sorted order.
4. **AUG-17 — Full blend.** WHEN all inputs are non-empty THEN the rendered `content` SHALL contain `<persona>`, `<rules>`, and `<skills>` sections in that order, separated by `\n\n`, with no trailing newline; the test SHALL assert the exact rendered string against a known-good fixture.
5. **AUG-18 — Section omission.** WHEN a section would be empty (no `persona`, no `rules`, no non-empty `rankedSkills`) THEN the corresponding tag SHALL be omitted entirely; the test SHALL assert no spurious tags appear for the empty case.
6. **AUG-19 — No trailing newline.** WHEN the full blend is rendered THEN the final byte of `content` SHALL NOT be `\n`; the test SHALL assert `content.endsWith('\n') === false`.

**Independent Test:** Build a fixed corpus of `Persona`, `Rule`, and `RankedSkill` objects, run the composer, and compare the output against a frozen expected string.

---

### P3: Static guard — no hot-path LLM/network

**User Story:** As a maintainer, I want a static guard that fails the suite if any future change introduces a network or LLM dependency in the new domains.

**Why P3:** The hot-path purity constraint is enforced by policy; if the policy is encoded as a test, regressions are caught before they reach the gateway.

**Acceptance Criteria:**

1. **AUG-20 — No-network guard.** WHEN the static guard reads `src/augmenter/**` and `src/cache/**` THEN it SHALL assert no file contains `fetch(`, `http.request`, `require('http')`, `require('https')`, `require('node-fetch')`, `from 'http'`, or `from 'https'`; the test SHALL fail with a clear list of offending files if any forbidden pattern is found.
2. **AUG-21 — Domain-isolation guard.** WHEN the static guard reads the source tree THEN it SHALL assert that `src/augmenter/` does not import any catalog-write path, server module, or `node-fetch`/`@anthropic-ai/sdk`; the allow-list is restricted to `node:crypto`, `src/social-detector/`, `src/search/types`, and `src/cache/**`.

**Independent Test:** Run the static guard as a regular `node:test` test, not as a manual review step.

---

## Edge Cases

- WHEN `prompt` is the empty string or whitespace-only THEN the function SHALL return a persona + rules only message (or an empty content if no inputs are provided) and SHALL NOT throw.
- WHEN `rankedSkills` contains items with identical `hash` values THEN the cache key SHALL include the hash only once and the rendered `<skills>` section SHALL list each hash once; the test SHALL assert this uniqueness.
- WHEN `persona.slug` equals a rule's slug THEN both sections SHALL be rendered independently — the slug is not a deduplication key.
- WHEN `rules` contains entries that are not strings (e.g., a number in the `content` field) THEN the function SHALL throw `AugmenterError` before the cache key is computed.
- WHEN `rankedSkills` contains items whose `hash` is the empty string THEN the function SHALL still deduplicate and sort normally; the cache key SHALL be deterministic.
- WHEN the user passes `tenantId` containing a newline or other separator-like character THEN the cache key SHALL still be deterministic because the byte-string is delimited by `\n` between each component, not by ad-hoc separator logic.
- WHEN `isSocial(prompt)` is `false` and `rankedSkills` is empty THEN the rendered `content` SHALL contain only the base persona and rules (or empty if none) and the `cacheKey` SHALL be derived from the empty skill hash list.
- WHEN the rendered `content` is empty (no `persona`, no `rules`, social prompt, empty skills) THEN the function SHALL still return `{ content: '', ephemeral: true, cacheKey: <hash> }` and SHALL NOT throw.

---

## Requirement Traceability

| Requirement ID | Story | ROADMAP item | Status |
| --- | --- | --- | --- |
| AUG-01 | Public shape | `buildAugmentedMessage` factory + persona+rules+skills template | In Design |
| AUG-02 | Determinism | `buildAugmentedMessage` public function | In Design |
| AUG-03 | Cache key composition | `cache` byte-string + sha256 | In Design |
| AUG-04 | `promptKind` branch | Social-detector integration | In Design |
| AUG-05 | `ephemeral` literal | `ephemeral: true` marker | In Design |
| AUG-06 | Persona + rules structure | Template composer | In Design |
| AUG-07 | Determinism across restarts | Pure function property | In Design |
| AUG-08 | `RankedSkill` reuse | Phase 4 surface | In Design |
| AUG-09 | Social bypass | Social-detector integration | In Design |
| AUG-10 | Threshold fail | Phase 4 contract | In Design |
| AUG-11 | Cache key isolation | Cache key uniqueness | In Design |
| AUG-12 | Hot-path purity | No LLM / no network | In Design |
| AUG-13 | Coverage + gate | 80% coverage + SLA | In Design |
| AUG-14 | Persona-only output | Template composer | In Design |
| AUG-15 | Rules-only output | Sort by slug | In Design |
| AUG-16 | Skills-only output | Sort by hash | In Design |
| AUG-17 | Full blend | Section ordering | In Design |
| AUG-18 | Section omission | Empty section handling | In Design |
| AUG-19 | No trailing newline | Byte-stable output | In Design |
| AUG-20 | No-network guard | Static test | In Design |
| AUG-21 | Domain-isolation guard | Static test | In Design |

**Coverage:** 21 total, 21 mapped to design/tasks, 0 unmapped.

---

## Success Criteria

- [ ] `createAugmenter({ tenantId: 'tenant-a' })` returns a `buildAugmentedMessage` that produces `===` equal `content` and `cacheKey` for two identical calls.
- [ ] Social prompts (`oi`, `obrigado`, `thanks`, `bye`, `valeu`) produce augmented messages with no `<skills>` block and a `cacheKey` derived from `promptKind = 'social'`.
- [ ] Empty `rankedSkills` produces augmented messages with no `<skills>` block and a `cacheKey` derived from the empty hash list.
- [ ] The base persona + rules structure is rendered in the order persona → rules → skills, with rules sorted by slug and skills sorted by hash.
- [ ] Cross-tenant, cross-prompt-kind, and cross-skill-set inputs produce different cache keys.
- [ ] The static guard asserts zero `fetch(`, `http.request`, or `require('http')` matches in `src/augmenter/` and `src/cache/`.
- [ ] `src/augmenter/` and `src/cache/` each meet at least 80% line coverage under the documented native coverage gate; `npm test` exits 0 in under 10 seconds; `npm run typecheck` exits 0.
- [ ] The baseline 184-test suite remains green; no protected phase files (`src/catalog/**`, `src/social-detector/**`, `src/search/**`, `src/server/**`, `src/agents/**`) are touched.
