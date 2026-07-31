---
date: 2026-07-31
version: 1
description: "Phase 2 — Detector + Fingerprint spec. Promotes calibration detector to PRD-aligned module structure, adds minimal 'ok' bypass pattern (ROADMAP done #1), adds fingerprint module with sha256[0:16] hashing, and renames `audit_events.tenant_hash` → `tenantId_hashed` (PRD §10.3) via migration `002_*.sql`."
explanation: |
  Phase 2 delivers three artifacts on the security/provenance side of
  the runtime: (a) a promoted social-detector module that keeps the
  calibration algorithm intact (`isSocial(prompt): boolean`) and adds
  two minimal patterns so the ROADMAP done criterion (`ok` bypass) is
  covered; (b) a fingerprint module with a 4-component provenance
  object where `sessionId` is hashed before leaving the SDK boundary;
  and (c) a `002_audit_events_tenant_id_rename.sql` migration that
  aligns the existing `audit_events.tenant_hash` column name with the
  PRD §10.3 contract (`tenantId_hashed`).

  The detector promotion is **not a rewrite** per dispatch constraint
  + `.specs/CALIBRATION-RESIDUE.md` — the regex catalog and helper
  function move to the new path verbatim, plus two regex additions for
  `ok` / `okay` (minimal, additive, non-behavior-changing for existing
  POS-01..POS-30 fixtures).

  The fingerprint module is greenfield (no calibration residue) and
  uses Node 22 built-in `node:crypto` — no new dependencies. Hash
  semantics lock to **first 16 BYTES of SHA256** (= 32 hex chars),
  matching PRD §8 "sha256[0:16]" Python-style byte slicing and the
  ROADMAP done criterion ("32-char hex").

  The audit_events column rename is a single `ALTER TABLE` statement
  applied through the Phase 1.2 migration runner; no writer code lands
  in Phase 2 (write runtime is Phase 5b per ROADMAP done criteria).

  Scope is intentionally narrow: NO Fastify server, NO SDK package
  structure (`packages/sdk/` is Phase 3), NO UI, NO retrieval runtime
  queries (Phase 5a). The detector + fingerprint + audit schema are
  the only deliverables. Phase 3 (SDK) and Phase 5a/5b (server +
  audit write) will consume these modules.

  The Verifier should expect:
  - `src/social-detector/` to be moved/renamed but with the calibration
    algorithm preserved (`isSocial` is the public hook).
  - `src/fingerprint/` to be new greenfield.
  - `audit_events.tenant_hash` column renamed to `tenantId_hashed`
    via migration `002_*.sql` (the existing column is otherwise
    untouched; only the name changes).
  - The 185+ test baseline from Phase 1 to be preserved or grown.

  Touch ONLY files under `.specs/features/phase-2-detector-fingerprint/`
  for this planning artifact. Implementation tasks live in `tasks.md`
  and will be executed in a separate Planner→Implementer dispatch.
related:
  - ../../ROADMAP.md
  - ../../ARCHITECTURE.md
  - ../../CALIBRATION-RESIDUE.md
  - ../../../PRD.md
  - ../../../PLAN.md
  - ../../STATE.md
  - ../../../CLAUDE.md
  - ../../../src/social-detector/is-social.ts
  - ../../../src/catalog/migrations/001_init.sql
  - ../../archive/2026-07-calibration/features/social-detector/{spec,design,tasks,validation}.md
  - ../../features/phase-1-catalog-schema-index/{spec,design,tasks}.md
---

# Phase 2 — Detector + Fingerprint — Spec

**Phase:** 2
**Slug:** `phase-2-detector-fingerprint`
**Source:** `.specs/ROADMAP.md` lines 234-256 (Phase 2 entry)
**Goal:** runtime security + provenance — promote the calibration social detector intact (with minimal `ok` expansion per ROADMAP done #1), add a 4-component fingerprint module with `sha256[0:16]` session-id hashing, and align the `audit_events.tenant_hash` column name with PRD §10.3 (`tenantId_hashed`) via migration `002_*.sql`.
**Estimate:** 2-3h (per ROADMAP)

---

## Architectural Reference

> Farol nodes (`.specs/ARCHITECTURE.md`) consumed by Phase 2:

> **Módulo 4 — Pipeline (retrieval core):**
> - `social-detector` — Regex bypass guard (PRD §8 invariante sólida 6). **Phase 2 promotes** the calibration implementation intact, with minimal `ok`/`okay` pattern additions.

> **Módulo 5 — Storage:**
> - `sqlite` — Audit events storage substrate. **Phase 2 renames** `audit_events.tenant_hash` → `tenantId_hashed` via migration `002_*.sql`. The audit write runtime lands in Phase 5b.

> **Módulo 3 — Hot Path (consumers — out of scope for Phase 2):**
> - `sdk` — `@memory-studio/sdk` will import `fingerprint()` from `src/fingerprint/` in Phase 3 (SPEC §IMod-2 SDK API).
> - `augmenter` — Will import `isSocial()` from `src/social-detector/` in Phase 5a (SPEC §IMod-7 retrieval runtime).

**Edges built by Phase 2 (Implementer's TODO list):**
- `social-detector` (module) — promoted to `src/social-detector/social.ts` with types + barrel; existing `is-social.ts` removed.
- `fingerprint` (module) — greenfield at `src/fingerprint/`; exports `hashSha256_16()` and `fingerprint()`.
- `sqlite` (storage) — migration `002_audit_events_tenant_id_rename.sql` applied through Phase 1.2 migration runner.

**Edges NOT built by Phase 2 (consumers in later phases):**
- `sdk → fingerprint` — Phase 3 re-exports `fingerprint` from `@memory-studio/sdk`.
- `augmenter → social-detector` — Phase 5a wires `isSocial` into the retrieval short-circuit (`emptyReason: "social"`).
- `augmenter → audit_events` — Phase 5b writes rows; Phase 2 only owns the column rename.

---

## Requirements (traceable)

| Req ID | Statement | Source |
|---|---|---|
| **R-01** | Module `src/social-detector/social.ts` exports `isSocial(prompt: string): boolean` (synchronous, pure, side-effect-free). Module is importable from a future `@memory-studio/sdk` barrel and from Phase 5a's augmenter wiring without touching the file | ROADMAP done #1, #2 + calibration SD-07 (preserved) |
| **R-02** | The promoted social pattern catalog covers all POS-01..POS-30 fixtures from calibration (no regression) **AND** adds minimal patterns for `ok` / `okay` so the ROADMAP done #1 example list (`["oi", "valeu", "thanks", "obrigado", "ok", "..."]`) returns `true` for `ok`/`okay` | ROADMAP done #1 + calibration spec SD-01/SD-02 + dispatch "calibration is correct, promote" |
| **R-03** | Function `fingerprint({ projectPath, agentId, sessionId, gitBranch }): Promise<Fingerprint>` returns `{ projectPath, agentId, sessionId: <hashed>, gitBranch }` where `sessionId` is replaced by `hashSha256_16(sessionId)` **before** the return (the raw sessionId never leaves the SDK boundary) | ROADMAP done #3 + PRD §5 + PRD §10.3 item 1 (zero raw persistence) |
| **R-04** | Hash function `hashSha256_16(input: string): string` returns a **32-char lowercase hex string** (first 16 bytes of SHA-256 digest). Verified by golden vectors (NIST/RFC test vectors for SHA-256) | ROADMAP done #4 + PRD §8 invariante sólida "tenant_id hasheado (sha256[0:16])" |
| **R-05** | SQLite migration `002_audit_events_tenant_id_rename.sql` renames column `audit_events.tenant_hash` → `audit_events."tenantId_hashed"` so the 8 ROADMAP done #5 columns (`id`, `ts`, `tenantId_hashed`, `fingerprint`, `matched_ids`, `pruning_reasons`, `latency_ms`, `redacted_prompt_hash`) are all present **and** `tenantId_hashed` is the canonical column name per PRD §10.3 | ROADMAP done #5 + PRD §10.3 item 2 |
| **R-06** | Migration runner from Phase 1.2 applies `002_*.sql` idempotently (re-run is no-op). The schema_migrations table records version `2` after apply | Phase 1.2 spec + ROADMAP done #5 |
| **R-07** | Module `src/fingerprint/` uses **only Node 22 built-ins** (`node:crypto`) — no new npm dependencies. Modules are importable as ESM and pass `tsc --noEmit` under strict + `noUncheckedIndexedAccess` | dispatch "no new deps" + CLAUDE.md testing contract |
| **R-08** | Public fingerprint API is synchronous in its return shape from the caller's POV (`async` allowed internally; the awaited result is a literal object with all 4 components). The signature accepts `agentId` as a parameter (default `"claude-code"` literal per PRD §14.4 + SPEC §C, MVP-hardcoded) so the SDK can re-export `fingerprint` with `agentId` pre-bound | PRD §5 + PRD §14.4 + SPEC §IMod-2 |
| **R-09** | Calibration residue policy preserved: the 60-test baseline from calibration (`test/social-detector.test.mjs`) survives the detector promotion. Tests are moved to a co-located location with updated import path; no fixture removed or weakened | AD-002 + CALIBRATION-RESIDUE.md + CLAUDE.md testing contract |
| **R-10** | A new test fixture file (`test/social-detector/fixtures.yaml`) holds **20 social + 20 real prompts** for the ROADMAP done #2 false-positive rate assertion. The detector test loads the fixture and asserts FP rate ≤ 5% on the real set | ROADMAP done #2 |
| **R-11** | The detector's empty/punctuation behavior (NORM-07..NORM-09) is preserved — pure punctuation like `"..."`, `"!!!"`, `"???"` continues to return `false` from `isSocial` (intentional per calibration NORM-09). The ROADMAP done #1 example list `["ok", "..."]` is read as `"ok"` is a bypass example; `"..."` is illustrative shorthand for "etc.", not a literal string the detector must match | dispatch "calibration is correct" + ROADMAP done #1 |
| **R-12** | No Fastify server, no API endpoint, no SDK package layout, no UI in Phase 2 deliverables. Only the modules + tests + migration listed above | dispatch scope + ROADMAP done |

### Out of scope (explicit non-goals)

- **Fastify server / `/augment` endpoint** (Phase 5a) — consumer of `isSocial()`.
- **`@memory-studio/sdk` package** (Phase 3) — will re-export `fingerprint()` from `src/fingerprint/`.
- **Audit write runtime** (Phase 5b) — Phase 2 only renames the column; writers land later.
- **Retrieval queries at runtime** (Phase 5a) — FTS5 + sqlite-vec unchanged in Phase 2.
- **UI panel** (Phase 4).
- **Intel store + fast agent** (Phase 6).
- **Byte-string determinism / tiebreak ordering** (Phase 5a).
- **`/state/toggle` endpoint** (Phase 5b) — no consumer wiring yet.
- **`audit_events` INSERT/UPDATE/DELETE code** — Phase 5b.
- **Multi-agent fingerprint support** (v3.1+) — `agentId` is hardcoded `"claude-code"` per PRD §14.4 MVP.
- **Hashing anything other than `sessionId` and `tenantId`** — Phase 5b writes `tenantId_hashed`; Phase 2 only provides the primitive.

---

## Acceptance Criteria

| AC ID | Criterion (observable, verifier-checkable) |
|---|---|
| **AC-1** | `import { isSocial } from "../src/social-detector/social.ts"` (or barrel `../src/social-detector/index.ts`) returns `true` for **at least** these exact strings: `"oi"`, `"olá"`, `"valeu"`, `"obrigado"`, `"obrigada"`, `"thanks"`, `"thank you"`, `"thx"`, `"bye"`, `"goodbye"`, `"hi"`, `"hello"`, `"hey"`, `"good morning"`, `"how are you?"`, `"what's up?"` (covering POS-01..POS-30 from calibration, no regression) |
| **AC-2** | `isSocial("ok")` and `isSocial("okay")` each return `true` (new minimal patterns for ROADMAP done #1 coverage) |
| **AC-3** | `isSocial("...")` returns `false` (NORM-09 preserved — pure punctuation is intentional non-bypass) |
| **AC-4** | Test fixture file `test/social-detector/fixtures.yaml` exists with exactly 20 social prompts (e.g., `{oi, valeu, thanks, obrigado, ok, bye, ...}` covering PT-BR + EN) and 20 real prompts (e.g., `{refatora o parser, write tests for X, fix the auth bug, ...}`) |
| **AC-5** | Detector test loads the fixture file and asserts: every social prompt returns `true`, every real prompt returns `false`, FP rate on the 20 real prompts is **≤ 5%** (≤ 1 of 20 real prompts classified as social — a single mismatch is the maximum tolerated, 0 mismatches is the target) |
| **AC-6** | `import { fingerprint } from "../src/fingerprint/fingerprint.ts"` accepts an object `{ projectPath, agentId, sessionId, gitBranch }` and returns a `Promise<{ projectPath: string, agentId: string, sessionId: string, gitBranch: string }>` where the returned `sessionId` field is `hashSha256_16(input.sessionId)` — the raw sessionId never appears in the return |
| **AC-7** | `import { hashSha256_16 } from "../src/fingerprint/hash.ts"` returns a 32-char lowercase hex string. Verified by golden vectors: `hashSha256_16("")` = `"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"`.substr(0, 32) = `"e3b0c44298fc1c149afbf4c8996fb924"`. At least 3 golden vectors are asserted in test |
| **AC-8** | `hashSha256_16` is **deterministic**: same input always returns same output. Verified by test that calls twice and asserts equality. The function uses `node:crypto` `createHash("sha256")` and slices the first 16 BYTES (= 32 hex chars) of the digest |
| **AC-9** | SQLite migration `src/catalog/migrations/002_audit_events_tenant_id_rename.sql` exists with content `ALTER TABLE audit_events RENAME COLUMN tenant_hash TO "tenantId_hashed";` |
| **AC-10** | After running the Phase 1.2 migration runner on a fresh DB, the schema includes version `2` in `schema_migrations` AND `audit_events` schema has columns: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `ts INTEGER NOT NULL`, `"tenantId_hashed" TEXT NOT NULL`, `event_type TEXT NOT NULL`, `payload TEXT NOT NULL`, `fingerprint TEXT`, `matched_ids TEXT`, `pruning_reasons TEXT`, `latency_ms INTEGER`, `redacted_prompt_hash TEXT` — verified by `PRAGMA table_info(audit_events)` returning all 10 rows (5 calibration + 5 PRD §10.3, with `tenant_hash` renamed) |
| **AC-11** | The `tenant_hash` column **does not exist** in `audit_events` after migration `002` is applied (verified by `PRAGMA table_info` — 0 rows match `name = 'tenant_hash'`) |
| **AC-12** | `npm test` and `npm run typecheck` keep passing throughout Phase 2. Baseline from Phase 1 (the entire test count from `d6ff85b`) is preserved or grown — no test deleted except the explicit move of `test/social-detector.test.mjs` if its location changes |
| **AC-13** | Throughout Phase 2, `src/catalog/**` files are byte-identical to Phase 1's commit `d6ff85b` (`git diff d6ff85b..HEAD -- src/catalog/` shows only the new `002_audit_events_tenant_id_rename.sql` file added; no other catalog source changes) |
| **AC-14** | No new npm dependencies are added to `package.json` — the fingerprint module uses Node 22 built-in `node:crypto` only |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
|---|---|---|---|
| **A-1: Detector module location** | `src/social-detector/social.ts` (renamed from `is-social.ts`) + `src/social-detector/types.ts` + `src/social-detector/index.ts` (barrel) | Parallel structure to existing `src/catalog/schema/{skill,rule,persona,shared}.ts` pattern from Phase 1.2. Keeps `src/social-detector/` as a stable directory so Phase 3's SDK can re-export from there. Avoids the larger move of relocating to `src/catalog/detector/social.ts` which would require updating the import path in Phase 3 too | yes (autonomous) |
| **A-2: Detector test file location** | Keep `test/social-detector.test.mjs` (top-level) — only update the import path inside the test | Phase 1 calibration uses this path; no need to move it. Adding the 20+20 fixture to `test/social-detector/fixtures.yaml` co-locates with the test file | yes (autonomous) |
| **A-3: Minimal `ok`/`okay` pattern addition** | Add `/^ok$/u` and `/^okay$/u` to `SOCIAL_PATTERNS` in the promoted module. Two regex entries, not a rewrite | ROADMAP done #1 example list includes `"ok"`. The dispatch says "calibration is correct, promote" but the ROADMAP done criterion is the higher-priority source — minimal addition (2 entries, ~30 chars total) is the smallest change that satisfies the criterion without rewriting the catalog. Calibration NORM-09 (`"!!!"` → false) is preserved — only `ok`/`okay` are added | yes (autonomous) |
| **A-4: "..." in the ROADMAP done #1 list** | Interpreted as **illustrative shorthand for "etc."**, NOT a literal string the detector must classify as social. `"..."` continues to return `false` per NORM-09 calibration (pure punctuation is intentional non-bypass). If Phase 5a needs to classify "..." as bypass, that's a separate addition there, not Phase 2 | Calibration NORM-09 is deliberate; the ROADMAP's use of `...` in the list is consistent with shorthand for "more examples" | yes (autonomous) |
| **A-5: Hash function semantics — bytes vs hex chars** | `hashSha256_16(input)` returns the first **16 BYTES** of the SHA-256 digest as hex = 32 lowercase hex chars. The `sha256[0:16]` notation is Python-style byte slicing on the raw digest (not on the hex string) | PRD §8 says "tenant_id hasheado no audit log (sha256[0:16])" — Python `bytes[0:16]` slicing. ROADMAP done #4 explicitly says "32-char hex" which matches 16 bytes = 32 hex chars. Consistent with the convention used in many security libs (e.g., `hashlib.sha256(x).digest()[:16].hex()`) | yes (autonomous) |
| **A-6: Hash input encoding** | UTF-8 encoding for the `sessionId` string before hashing. `node:crypto` `createHash("sha256").update(input, "utf8").digest()` | Standard convention for hashing strings; matches multilingual-e5-small pipeline behavior on the same node runtime | yes (autonomous) |
| **A-7: Fingerprint module location** | `src/fingerprint/` (new top-level dir) with `src/fingerprint/{hash,fingerprint,types,index}.ts` | The fingerprint is a separate concern from the social detector (security/provenance vs retrieval bypass). `src/fingerprint/` parallels `src/social-detector/` and `src/catalog/`. Phase 3 (`@memory-studio/sdk` package) will re-export from here | yes (autonomous) |
| **A-8: Fingerprint function signature** | `fingerprint(input: { projectPath: string; agentId: string; sessionId: string; gitBranch: string }): Promise<Fingerprint>` — async to allow future extension (e.g., git branch lookup if not provided). Returns `Fingerprint = { projectPath: string; agentId: string; sessionId: string; gitBranch: string }` where the returned `sessionId` is the hash, not the raw value | ROADMAP done #3 specifies the input shape. The return field name stays `sessionId` (not `sessionIdHashed`) because the hash IS the sessionId from the caller's POV — the SDK never sees the raw value. This is consistent with PRD §10.3 item 1 ("hash substitui raw em storage") | yes (autonomous) |
| **A-9: Audit_events column rename — camelCase in SQL** | The new column name is `"tenantId_hashed"` (camelCase with underscore) — quoted in SQL because SQLite's default identifier rules treat it as case-sensitive when quoted. The migration uses `ALTER TABLE audit_events RENAME COLUMN tenant_hash TO "tenantId_hashed";` | PRD §10.3 item 2 uses `tenantId_hashed` literally. ROADMAP done #5 column list uses the same. SQLite `ALTER TABLE ... RENAME COLUMN` requires the target name to be quoted if it's not a pure uppercase identifier (case-sensitivity rules). Verified against the calibration PRD §10.3 reference: this is the canonical column name | yes (autonomous) |
| **A-10: Migration runner compatibility** | Phase 1.2's `applyMigrations` runner applies `002_*.sql` automatically because it reads all `migrations/*.sql` files in lexical order. No runner changes needed | Phase 1.2's runner is generic — it picks up any `00N_*.sql` file. Phase 2's `002_audit_events_tenant_id_rename.sql` lands in the same directory and is auto-discovered | yes (Phase 1.2 spec) |
| **A-11: Migration is forward-only** | The `002` migration does NOT include a `DOWN` script. The codebase has no migration rollback mechanism; forward-only matches Phase 1.2's policy | Standard SQLite migration pattern; rollback would require a `002_audit_events_tenant_id_rename_down.sql` which is out of scope for Phase 2. The migration is also low-risk (column rename, no data transformation) | yes (autonomous) |
| **A-12: Test fixture format** | YAML format (`test/social-detector/fixtures.yaml`) with two top-level keys `social_prompts:` (list of 20) and `real_prompts:` (list of 20). Parsed via the existing `yaml` package from Phase 1 | Reuses the Phase 1 YAML dependency. Human-readable, easy to extend. Format mirrors the calibration `test/social-detector.test.mjs` style (POS-01..POS-30 are individually listed; the fixture file is a bulk set of additional prompts) | yes (autonomous) |
| **A-13: `gitBranch` collection in fingerprint** | The fingerprint function accepts `gitBranch` as a **required string parameter** (not auto-collected from the shell). The SDK (Phase 3) is responsible for collecting `gitBranch` via `git rev-parse --abbrev-ref HEAD` and passing it in | Phase 2 doesn't add shell execution (no `child_process` import). Phase 3's `collectContext` (SPEC §IMod-2) is the right place for git branch collection. The signature is the **contract** between Phase 2 and Phase 3 | yes (autonomous) |
| **A-14: `projectPath` collection in fingerprint** | Same as A-13 — `projectPath` is a required string parameter, collected by the SDK (typically `process.cwd()`) | Keeps Phase 2 free of `process.cwd()` assumptions; the SDK is the integration boundary | yes (autonomous) |
| **A-15: Phase 2 source files are touched ONLY in `src/social-detector/`, `src/fingerprint/`, `src/catalog/migrations/002_*.sql`, plus matching test files** | Scope is minimal. No changes to `src/catalog/{schema,embedder,loader,db,index}.ts`, `scripts/build-index.ts`, `package.json`, or any other file | Per dispatch scope guard. The Phase 1 baseline (`d6ff85b`) is the reference; diff should show only the new + moved files | yes (autonomous) |
| **A-16: Calibration test count baseline** | Phase 2's start baseline is the Phase 1 final test count from commit `d6ff85b` (the full Phase 1, including all 4 subchapters 1.1..1.4). Detector promotion moves `test/social-detector.test.mjs` (still passes — same fixtures, same expected outputs) | The detector's algorithm doesn't change; tests still pass. The test file's import path is the only update needed | yes (autonomous) |

**Open questions:** none — all ambiguities resolved as assumptions above.

---

## Edge Cases (enumerated for tests)

- WHEN `isSocial` is called with `"ok"` or `"okay"` THEN it SHALL return `true` (new minimal patterns).
- WHEN `isSocial` is called with `"OK!"` (uppercase + terminal punctuation) THEN it SHALL return `true` (normalization preserves the `ok` match).
- WHEN `hashSha256_16` is called with the empty string THEN it SHALL return `"e3b0c44298fc1c149afbf4c8996fb924"` (NIST SHA-256 of empty input, first 16 bytes).
- WHEN `hashSha256_16` is called twice with the same input THEN it SHALL return the same output (determinism).
- WHEN `hashSha256_16` is called with a 1MB string THEN it SHALL complete in <100ms (perf sanity; the function is in the SDK hot path).
- WHEN `fingerprint` is called with a `sessionId` containing only ASCII THEN it SHALL hash via UTF-8 and return the 32-char hex.
- WHEN `fingerprint` is called with a `sessionId` containing unicode (emoji, CJK, accented chars) THEN it SHALL hash via UTF-8 (NFC normalized implicitly by JS string handling) and return the 32-char hex.
- WHEN `fingerprint` is called twice with the same input THEN it SHALL return objects whose `sessionId` field is equal (determinism) but the raw input `sessionId` is never present in the returned object (verified by `Object.values(result).includes(input.sessionId) === false`).
- WHEN the audit_events migration is applied to a DB that already has rows in `audit_events` THEN the rename SHALL succeed and all rows retain their `tenant_hash` value under the new column name (ALTER TABLE RENAME COLUMN preserves data).
- WHEN the audit_events migration is re-applied (idempotency) THEN the runner SHALL record version `2` once and skip on subsequent runs (verified by `schema_migrations` having exactly one row with `version: 2`).

---

## User Stories (consumed from SPEC §C — SDK + Fingerprint + Tenant hashing)

Per SPEC `.scratch/memory-studio/spec.md` §C — SDK functions:

| Story | Source | Phase 2 Acceptance |
|---|---|---|
| **C.SDK-fingerprint** — Agent collects fingerprint with `projectPath`, `agentId`, `sessionId`, `gitBranch`; `sessionId` is hashed before leaving SDK boundary | SPEC §C + PRD §5 | AC-6, AC-7, AC-8 |
| **C.tenantId-hashing** — All audit log entries use `tenantId_hashed` (sha256[0:16]) instead of raw `tenantId` | SPEC §C + PRD §10.3 item 2 | AC-9, AC-10, AC-11 |

Per SPEC §A — Config inicial:
- No Phase 2 user stories from §A (those are Phase 1 catalog concerns).

Per SPEC §F — Security:
- **F.security.tenant-hashed** — `tenantId` is never persisted raw; only `tenantId_hashed` (32-char hex) | AC-9, AC-10, AC-11

---

## Requirement Traceability

| Req ID | Story | AC | Status |
|---|---|---|---|
| R-01 | (calibration preserved) | AC-1, AC-12 | Pending |
| R-02 | (calibration + minimal expansion) | AC-1, AC-2, AC-3 | Pending |
| R-03 | C.SDK-fingerprint | AC-6, AC-8 | Pending |
| R-04 | (hash primitive) | AC-7, AC-8 | Pending |
| R-05 | F.security.tenant-hashed | AC-9, AC-10, AC-11 | Pending |
| R-06 | (migration runner) | AC-10 | Pending |
| R-07 | (no new deps) | AC-14 | Pending |
| R-08 | (signature contract) | AC-6 | Pending |
| R-09 | (test baseline) | AC-12 | Pending |
| R-10 | (FP rate fixture) | AC-4, AC-5 | Pending |
| R-11 | (calibration behavior preserved) | AC-3 | Pending |
| R-12 | (scope) | (verified by Verifier) | Pending |
| AC-1 | (preserved calibration) | — | Pending |
| AC-2 | (ROADMAP done #1 expansion) | — | Pending |
| AC-3 | (NORM-09 preserved) | — | Pending |
| AC-4 | (fixture file) | — | Pending |
| AC-5 | (FP rate assertion) | — | Pending |
| AC-6 | (fingerprint contract) | — | Pending |
| AC-7 | (hash golden vectors) | — | Pending |
| AC-8 | (hash determinism + Node crypto) | — | Pending |
| AC-9 | (DDL existence) | — | Pending |
| AC-10 | (column list after migration) | — | Pending |
| AC-11 | (tenant_hash gone) | — | Pending |
| AC-12 | (test baseline preservation) | — | Pending |
| AC-13 | (catalog src unchanged except 002) | — | Pending |
| AC-14 | (no new deps) | — | Pending |

**Coverage:** 12 R-NN + 14 AC-NN = 26 traceable requirements. All mapped to spec sections.

---

## Success Criteria

Phase 2 is DONE when:

- [ ] `src/social-detector/social.ts` (or barrel `index.ts`) exports `isSocial(prompt: string): boolean` with the calibration algorithm preserved AND `ok`/`okay` patterns added.
- [ ] `src/fingerprint/hash.ts` exports `hashSha256_16(input: string): string` returning 32 lowercase hex chars, verified by NIST golden vectors.
- [ ] `src/fingerprint/fingerprint.ts` exports `fingerprint(input: FingerprintInput): Promise<Fingerprint>` returning a 4-component object with `sessionId` replaced by the hash.
- [ ] `src/catalog/migrations/002_audit_events_tenant_id_rename.sql` exists with the `ALTER TABLE ... RENAME COLUMN ...` statement.
- [ ] `test/social-detector/fixtures.yaml` holds 20 social + 20 real prompts; `test/social-detector.test.mjs` asserts FP rate ≤ 5% on the real set.
- [ ] `test/fingerprint/{hash,fingerprint}.test.mjs` cover the hash primitive and fingerprint function with golden vectors + determinism + hash-before-return assertions.
- [ ] Migration runner (Phase 1.2) applies `002_*.sql` cleanly; `audit_events` schema has `tenantId_hashed` (NOT `tenant_hash`) after apply.
- [ ] `npm test` passes; `npm run typecheck` exits 0; Phase 1 baseline (commit `d6ff85b` test count) is preserved or grown.
- [ ] No new npm dependencies added.
- [ ] `git diff d6ff85b..HEAD -- src/catalog/` shows only `migrations/002_audit_events_tenant_id_rename.sql` added; no other catalog source file changed.
- [ ] Verifier independently runs the discrimination sensor (per `tlc-spec-driven` post-Execute step) and reports PASS.

---

## Cross-references

- [`.specs/ROADMAP.md` Phase 2](../../ROADMAP.md) — done criteria (6 checkboxes, lines 234-256)
- [`.specs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — farol stable IDs (Módulos 3, 4, 5)
- [`.specs/CALIBRATION-RESIDUE.md`](../../CALIBRATION-RESIDUE.md) — promotion vs. rewrite policy
- [PRD §5](../../../PRD.md) — SDK cliente (fingerprint + hashing)
- [PRD §8](../../../PRD.md) — invariante sólida "tenant_id hasheado (sha256[0:16])"
- [PRD §10.3 items 1 + 2](../../../PRD.md) — zero raw persistence + tenantId hashed
- [PRD §14.4](../../../PRD.md) — `agentId` hardcoded `"claude-code"` MVP
- [SPEC §IMod-2](../../../.scratch/memory-studio/spec.md) — SDK API (fingerprint import path)
- [SPEC §C](../../../.scratch/memory-studio/spec.md) — SDK user stories
- [SPEC §F](../../../.scratch/memory-studio/spec.md) — security invariants
- [Phase 1 spec](../../features/phase-1-catalog-schema-index/spec.md) — migration runner dependency
- [Phase 1 tasks](../../features/phase-1-catalog-schema-index/tasks.md) — `applyMigrations` interface
- [Calibration spec](../../archive/2026-07-calibration/features/social-detector/spec.md) — original SD-01..SD-08 preserved
- [Calibration validation](../../archive/2026-07-calibration/features/social-detector/validation.md) — 60-test baseline proof
- [`src/social-detector/is-social.ts`](../../../src/social-detector/is-social.ts) — promotion source
- [`src/catalog/migrations/001_init.sql`](../../../src/catalog/migrations/001_init.sql) — `tenant_hash` column being renamed
- [`package.json`](../../../package.json) — no new deps
- [`CLAUDE.md`](../../../CLAUDE.md) — testing contract, authority boundaries
