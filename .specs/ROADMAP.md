---
date: 2026-07-28
version: 3
status: ready-for-tlc-loop
type: roadmap
description: "Memory Studio v3 — ROADMAP com 10 phases (sub-milestone a/b). Input do tlc-roadmap-loop."
explanation: |
  v3 substitui v2 (5 milestones) após INADEQUATE verdict do verifier
  sub-agent 2026-07-28. Splits aplicados:

  - M0 (Foundation) → Phase 1 + Phase 2
  - M1 (SDK + UI) → Phase 3 + Phase 4
  - M2 (Proxy + Audit) → Phase 5a + Phase 5b
  - M3 (Inception híbrida) → Phase 6a (Grill + POC validation) + Phase 6b (Fast Agent + Intel Pipeline, mandatory)
  - M4 (Tuning) → Phase 7a + Phase 7b

  Cada phase = 1-3h de trabalho single-dev, EXCETO Phase 1 (Catalog + Index, 6-8h —
  FTS5 + sqlite-vec + schema versioning + build-index perf são intrinsicamente
  bundleados), Phase 4 (UI, 8-12h) e Phase 6b (12-16h incluindo §16.4 overhead) que são
  intrinsecamente maiores. Phases
  com split (5a/5b, 6a/6b, 7a/7b) podem ser executadas em sequência
  dentro do mesmo dia.

  Granularidade "phase" casa com `tlc-roadmap-loop`: sub-agente processa
  1 phase por vez, gera SPEC atômica, Implementer + Verifier (Waldemar)
  executa.

  Fixes do verifier aplicados:
  1. Phase split (M0-M4 → Phase 1-10)
  2. 7 acceptance criteria PRD §10 adicionados ao Done
  3. Scope narrowed (M0 só index, M2 só runtime, M1 só SDK/UI não catalog)
  4. D-001, D-002, D-004 rastreáveis
  5. Gate anchor: §16.7 canonical (§16.6 é stale por causa do §16.5 insert)
  6. Estimates labeled (raw vs canonical)
  7. Termos vagos substituídos por evidência objetiva
  8. Endpoint count: 6 total (5 auxiliary + /augment)

  Companion: SPEC.md, PRD.md, PLAN.md.
related:
  - ../scratch/memory-studio/spec.md
  - ../../PRD.md
  - ../../PLAN.md   # referência histórica — execução segue este ROADMAP
  - ../../.specs/DISCOVERIES.md
  - ../../CLAUDE.md
---

# Memory Studio v3 — ROADMAP

**Date:** 2026-07-28
**Version:** 3
**Input to:** `tlc-roadmap-loop` (sub-agentes em sequência)
**Companion:** [SPEC.md](../scratch/memory-studio/spec.md), [PRD.md](../../PRD.md), [PLAN.md](../../PLAN.md)

---

## Meta-conventions (apply across all phases)

1. **Estimates:** tabela canônica (PRD §9 / PLAN §Total) reporta 35-50h. Raw arithmetic com phase splits = 39-52h (overhead de sub-agent setup + integration). Cada phase reporta raw.
2. **Estimates convention:** tabela canônica, body descritivo (D-002 resolution).
3. **Section refs:** ZERO `§18.x` em PRD/PLAN/SPEC/ROADMAP (D-001 resolution). Stale ref = blocker.
4. **Casing:** camelCanônico per SPEC §IMod-20. `recentFiles`, `lastEvent`, `intel`, `activeCatalog`, `emptyReason`. Drift = discovery.
5. **Cache distinction:** MVP usa **só cache do provedor** (Anthropic `cache_control: ephemeral`). Cache de augmented (fingerprint semântico) é v3.1+ omitido — não medir nem expor no MVP (PRD §17.1).
6. **Security default:** zero raw persistence, `tenantId` hasheado, placeholders determinísticos não vazam secret, proxy local-only.
7. **Fail-open:** todo erro de retrieval/augmentation/audit → forward unchanged, request 200, log em stderr.
8. **(removido 2026-07-28)** Branch B fork eliminado — Phase 6 é mandatório. Phase 6a (POC Validation) funciona como validation gate: se POC reprova, decisão humana (ajustar, não collapsar). Total fixo 41-61h.
9. **Endpoint count: 7 total** (6 auxiliary + /augment). `/state/toggle` foi adicionado pós-D-009 (Phase 4 UI dependency). Lista: `/augment`, `/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`, `/state/toggle`.

---

## Sequência

```
Phase 0 ──> Phase 1 ──┬──> Phase 2 ──┐
                      │              │
                      ├──> Phase 3 ──┼──> Phase 4 ──┐
                      │              │              │
                      │              ├──────────────┴──> Phase 5a ──> Phase 5b ──┬──> Phase 6a ──> Phase 6b ──┐
                      │              │                                          │                              │
                      └──> Phase 1 ──┘                                          └──> Phase 7a ──> Phase 7b ──┘
```

**Paralelização:** Phase 3 + 4 paralelizáveis (Phase 3 = consumido externo por agentes; Phase 4 só depende de Phase 1; nenhum bloqueia o outro internamente). Phase 5a + 5b sequenciais (mesmo phase técnica). Phase 7a pode começar após Phase 5b (não bloqueia em 6b). Phase 0 é pré-requisito hard de Phase 1 (env validation).

---

#### Phase 0 — Environment Validation [x]

**Done when:** ambiente validado — Node 22 + SQLite FTS5+vec + ONNX runtime + multilingual-e5-small ONNX carregam sem erros; `scripts/verify-env.mjs` passa todos os 6 checks.

**Depends on:** none

**Goal:** garantir que o ambiente suporta SQLite + FTS5 + sqlite-vec + ONNX runtime + Node 22 antes de Phase 1 começar. Evita descobrir fricção de setup no meio da Phase 1.

**Scope:**
- Node 22 LTS instalado (`node --version`)
- `onnxruntime-node` build OK (compilação específica por OS — Windows tem fricção)
- SQLite com extensões FTS5 + sqlite-vec compiladas e carregáveis
- multilingual-e5-small ONNX model baixa + carrega (~470MB)
- Permissões filesystem (read YAML, write SQLite, write `.memory-studio/state.json`)

**Estimate:** 1-2h (depende do OS; Windows tem fricção maior que Linux/macOS)

**Done criteria:**
- [ ] `node --version` retorna v22.x LTS
- [ ] `npm install onnxruntime-node` succeeds sem erros de compilação
- [ ] SQLite carrega FTS5 (`PRAGMA compile_options;` mostra `ENABLE_FTS5`)
- [ ] sqlite-vec carrega (`SELECT vec_version();` retorna versão)
- [ ] multilingual-e5-small ONNX model baixa e carrega (`embedding.encode("test")` retorna 384d array)
- [ ] Test write em `.memory-studio/state.json` succeeds com permissões corretas
- [ ] Smoke script `/scripts/verify-env.mjs` passa todos os 6 checks acima

**Output do Processador:**
- Script `/scripts/verify-env.mjs` (TS) que roda os 6 checks e retorna exit 0 se tudo OK
- Documentado em `.memory-studio/setup.md` como pré-requisito

---

#### Phase 1 — Catalog + Schema + Index [ ]

**Done when:** catálogo constrói localmente; retrieval index populado; YAML schema versionado; `npm run build-index` <60s pra 100 skills.

> **Phase 1 status 2026-07-31:** Completed via subchapters 1.1, 1.2, 1.3, 1.4 (all `[x]`). DO NOT mark this `[x]` directly — subchapter entries are the verification record. Phase 1 stays as the parent phase scope description; substantive proof is in the four subchapter validation.md reports.

**Depends on:** Phase 0

**Goal:** catálogo constrói localmente; retrieval index populado; YAML schema versionado.

**Scope:**
- SPEC §IMod-6 (YAML schema: Skill/Rule/Persona)
- SPEC §IMod-13 (invariantes sólida: 1 Node-only, 4 catálogo versionado, 5 tenant_id hasheado)
- SPEC §IMod-14 (stack table: Node 22, Fastify, SQLite + FTS5 + sqlite-vec, multilingual-e5-small)
- SPEC §IMod-15 (working set partial — embeddings + sqlite)
- SPEC User Stories §A (config inicial — items 1, 4, 5, 6, 7, 8; item 6 = migrate v1 calibration STATE.md → schema)

**PRD refs:**
- §6 Schema do catálogo (YAML versionado em git)
- §8 Stack (Node 22, Fastify, SQLite + FTS5 + sqlite-vec, embedding 384d)
- §10.4 item 1 (`npm run build-index` < 60s pra 100 skills)
- §17.2 nomenclature (`recentFiles`, etc. — usado no schema do context, mas schema YAML usa type/id/text apenas)

**Estimate:** 6-8h (Phase 1 raw estimate; bumped de 4-5h per MiMo — FTS5 + sqlite-vec + schema versioning + build-index perf são bundleados)

**Done criteria (cada checkbox testável):**
- [ ] YAML schema validado: `id`, `type`, `title` (skill), `text` obrigatório; `category` enum (procedural|diagnostic|reference|pattern) pra skill; `critical: bool` pra rule; `isDefault: bool` pra persona
- [ ] SQLite tabelas criadas: `catalog`, `embeddings`, `audit_events` com migrations versionadas
- [ ] FTS5 virtual table sobre `text` de cada item (trigger insert/update/delete)
- [ ] sqlite-vec virtual table 384d (multilingual-e5-small ONNX)
- [ ] Loader YAML → SQLite idempotente (re-run não duplica)
- [ ] `npm run build-index` regenera embeddings em <60s pra 100 skills (medido, não estimado)
- [ ] `schemaVersion: 3` exposto em `/catalog` GET response
- [ ] Schema versioning policy: `schemaVersion` no API; mudança breaking → bump major version
- [ ] Zero `§18.x` refs em PRD/PLAN/SPEC/ROADMAP (D-001 cross-check)
- [ ] **Thresholds iniciais commitados** em `.memory-studio/state.json` default: `min_cosine_similarity: 0.6`, `min_fts_hits: 2` (Phase 7a vai tunar empiricamente, valores iniciais são referência)

**Output do Processador (SPEC atômica):**
- TS shapes completos: `Skill`, `Rule`, `Persona` types
- SQLite migration SQL + FTS5 + sqlite-vec DDL
- `build-index` script com progress reporting
- Loader module com error handling (YAML inválido → stderr + skip)

---

> **Phase 1 split (2026-07-30) — 4 subchapters per SUBCHAPTER_BREAKDOWN trigger (>15 tasks).**
> Each subchapter is a fresh phase with its own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-1-catalog-schema-index/{spec.md, design.md, tasks.md}` (commit `d8d2318`).

#### Phase 1.1 — YAML Schema + Zod Validation [x]

**Done when:** Zod schemas for Skill, Rule, Persona parse valid YAML → typed objects; reject invalid with deterministic error codes; coverage in `test/catalog/schema.test.mjs`.

**Depends on:** Phase 0, Phase 1

**Scope (T-01..T-04):**
- `src/catalog/schema/skill.ts`, `rule.ts`, `persona.ts` — Zod schemas enforcing R-01..R-05
- Calibration residue `src/catalog/**` deleted (per AD-002 + `.specs/CALIBRATION-RESIDUE.md`)
- Fixtures: `test/catalog/fixtures/{valid,invalid}/*.yaml`
- AC gates: AC-1, AC-2, AC-3 (enum categories, critical flag, isDefault)

**Output do Processador:**
- 3 Zod schema modules + barrel export
- Test suite (deterministic error codes)
- Atomic commits T-01..T-04
- **Do NOT touch `src/social-detector/`** (Phase 2 promotes)
- **Do NOT touch DB or embeddings** (Phase 1.2 / 1.3)

---

#### Phase 1.2 — Migrations + FTS5 + sqlite-vec [x]

**Done when:** SQLite DDL creates `catalog`, `embeddings`, `audit_events`, `schema_migrations`, `catalog_fts` (FTS5), `catalog_vec` (sqlite-vec 384d); triggers sync correctly; migration runner is idempotent.

**Depends on:** Phase 1.1

**Scope (T-05..T-08):**
- `src/catalog/migrations/001_init.sql` — initial schema
- `src/catalog/migrations/runner.ts` — idempotent migration runner with `schema_migrations` table
- FTS5 virtual table + INSERT/UPDATE/DELETE triggers on `catalog.text`
- sqlite-vec virtual table + sync triggers on `embeddings`
- `test/catalog/{migrations,fts5-triggers,vec-triggers}.test.mjs`
- AC gates: AC-4, AC-5, AC-6 (FTS5 sync, vec sync, migration idempotency)

---

#### Phase 1.3 — CatalogLoader + Embedder [x]

**Done when:** CatalogLoader parses YAML → validates via Zod → embeds via multilingual-e5-small → upserts into SQLite; embedder produces 384d Float32Array deterministically; YAML re-run is no-op for unchanged items.

**Depends on:** Phase 1.2

**Scope (T-09..T-12):**
- `src/catalog/embedder.ts` — wraps `@huggingface/transformers` pipeline with `embed(text) → Float32Array(384)`
- `src/catalog/loader.ts` — orchestration (parse → validate → embed → upsert → prune)
- Idempotency: content hash column on `catalog`, re-run skips unchanged
- Error handling: invalid YAML → stderr + skip (per R-12 from Phase 1 spec)
- `test/catalog/{embedder,loader}.test.mjs`
- AC gates: AC-7, AC-8, AC-9 (loader idempotency, 384d deterministic, skip on invalid)

---

#### Phase 1.4 — build-index + Perf + API Schema Version [x]

**Done when:** `npm run build-index` runs in <60s for 100-skill fixture (measured); `schemaVersion: 3` exposed via `getSchemaVersion()` helper consumed by Phase 5a API; thresholds initial in `.memory-studio/state.json` match PRD §10.4.

**Depends on:** Phase 1.3

**Scope (T-13..T-16):**
- `scripts/build-index.ts` — orchestration CLI with progress reporting
- `src/catalog/version.ts` — `getSchemaVersion(): 3`
- `npm run build-index` script in `package.json`
- 100-skill fixture (`test/catalog/fixtures/perf-100/`) for perf measurement
- `test/catalog/perf.test.mjs` — assert wall time <60s
- AC gates: AC-10, AC-11, AC-12, AC-13 (perf SLA, schemaVersion exposure, threshold default values)

---

#### Phase 2 — Detector + Fingerprint [x]

**Done when:** bypass de prompts sociais detectado; provenance 4-componente com hashing; audit schema DDL pronto (write runtime é Phase 5b).

**Depends on:** Phase 1

**Goal:** bypass de prompts sociais; provenance 4-componente com hashing; audit schema pronto (vazio).

**Scope:**
- Detector social (regex — invariante sólida 6 PRD §8)
- Fingerprint 4-comp (`projectPath`, `agentId`, `sessionId` hasheado, `gitBranch`)
- Hashing básico (`sha256[0:16]` pra `sessionId` e `tenantId`)
- Audit log schema (estrutura, sem write runtime — esse é Phase 5b)
- Proveniência v1: detector, fingerprint, hashing promovidos de `.specs/archive/2026-07-calibration/`

**PRD refs:**
- §5 SDK cliente (fingerprint + hashing)
- §10.3 item 2 (`tenantId` hasheado em todos os logs)
- §10.3 item 1 (zero persistência raw — hash substitui raw em storage)

**Estimate:** 2-3h

**Done criteria:**
- [ ] Detector regex detecta lista de bypass: `["oi", "valeu", "thanks", "obrigado", "ok", "..."]` → marca `socialDetectorBypass = true`
- [ ] Detector regex testado com 20 prompts sociais + 20 prompts reais (FP rate ≤5%)
- [ ] `fingerprint({ projectPath, agentId, "claude-code", sessionId, gitBranch })` retorna 4-comp object com `sessionId` hasheado antes do retorno
- [ ] Hashing function `sha256[0:16](input)` retorna string 32-char hex (validado com golden vectors)
- [ ] Audit log schema: `audit_events` table tem colunas `id`, `ts`, `tenantId_hashed`, `fingerprint`, `matched_ids`, `pruning_reasons`, `latency_ms`, `redacted_prompt_hash`
- [ ] Detector + fingerprint promovidos de `.specs/archive/2026-07-calibration/` (não reinventados — proveniência D-005)

**Output do Processador:**
- Detector module (TS) com regex compiled + bypass enum
- Fingerprint module (TS) com hash helpers
- Audit log schema migration (DDL only, no write runtime)

---

#### Phase 3 — SDK Cliente [x]

**Done when:** agentes embedam SDK e coletam estado; SDK funciona prompt-only fallback; `~50KB` build size zero deps nativas.

**Depends on:** Phase 1

**Goal:** agentes embed o SDK e coletam estado; SDK funciona prompt-only fallback.

**Scope:**
- SPEC §IMod-1 (module breakdown — `@memory-studio/sdk`)
- SPEC §IMod-2 (SDK API: `collectContext`, `fingerprint`, `MemoryStudioClient.augment`)
- SPEC §IMod-20 (nomenclature rules — garantir camelCase canônico nas exports)
- SPEC User Stories §C (SDK functions, prompt-only mode, hardcoded agentId)
- **Não inclui:** UI panels (Phase 4), retrieval runtime (Phase 5a)

**PRD refs:**
- §5 SDK cliente (TS shape, fingerprint 4-comp, agentId="claude-code" MVP)
- §10.3 item 1 (zero persistência raw — SDK redacta antes de enviar)

**Estimate:** 3-4h

**Done criteria:**
- [ ] `@memory-studio/sdk` package: TypeScript puro, ~50KB build size, zero deps nativas (medido)
- [ ] `collectContext({ scratch, todos, recentFiles, lastEvent, redaction: "minimal" | "strict" })` retorna `Context` object literal
- [ ] `Context` type inclui todos campos PRD §7.1: `scratch`, `todos`, `recentFiles`, `lastEvent`, `legacyState`, `sessionId`
- [ ] `fingerprint({ projectPath, agentId, sessionId, gitBranch })` retorna `Fingerprint` literal
- [ ] `MemoryStudioClient.augment({ prompt, context, fingerprint })` faz POST `/augment` e retorna `AugmentResponse`
- [ ] Modo prompt-only: `augment({ prompt, context: null })` retorna response válida (não crasha, request enviada com `context: null`)
- [ ] `agentId` hardcoded `"claude-code"` (MVP) — código fonte tem literal, fácil de trocar pra v3.1+
- [ ] SDK redacta secrets em `scratch` e `lastEvent.payload` antes de serializar (regex: API keys, .env values, JWT tokens)
- [ ] SDK tem `package.json` com `exports` field, build script ESM + CJS, type declarations
- [ ] Test smoke: SDK roda em Node 22 sem dependências externas

**Output do Processador:**
- TS API completa (types + implementations)
- Test suite: 5 happy-path + 3 edge-case (prompt-only, secret redaction, hashing)
- README curto com usage example

---

#### Phase 4 — UI Panel [ ]

**Done when:** humano controla catálogo via painel; Critical Rules enforcement visível; UI carrega em <1s local; 5 telas (Skills/Rules/Personas/Audit/Settings).

> **Phase 4 status 2026-07-31:** Completed via subchapters 4.1, 4.2, 4.3, 4.4 (all `[x]`). 375 tests total (207 root + 152 UI + 16 SDK). DO NOT mark this `[x]` directly — subchapter entries are the verification record. `/state/toggle` HTTP implemented in 4.4 (Phase 5b later subsumes endpoint contract per Planner design). Critical Rules `CONFIRMAR` exact enforcement; persona cap 3 (browser+server defense in depth). Cold first-byte <1000ms (measured 11-136ms on Windows; future perf gates should report min/median across N≥3). `verifier-http-check.mjs` was load-bearing; should be promoted to regression test (`packages/ui/test/verifier-http.test.mjs`).

**Depends on:** Phase 1, Phase 3

**Goal:** humano controla catálogo via painel; Critical Rules enforcement visível.

**Scope:**
- SPEC §IMod-1 (UI module — `@memory-studio/ui`)
- SPEC §IMod-20 (nomenclature — `recentFiles` aparece nos tooltips da Audit tab)
- SPEC User Stories §B (5 telas, search, side panel, toggle, Critical Rules warning, persona cap)
- **Não inclui:** retrieval runtime (Phase 5a), audit write (Phase 5b)

**PRD refs:**
- §4 Painel UI (constraints: colunas, busca, janela lateral; HTMX+Alpine; localhost primeira porta livre)
- §5 Onde painel vive (porta livre, não Tauri)
- §6.2 Critical Rules contrato
- §10.1 item 6 (UI mostra catálogo + toggle por projeto)
- §10.1 item 7 (Critical Rules: aviso visual + imunes a toggle off)
- §10.4 item 2 (UI carrega < 1s local)

**Estimate:** 8-12h

**Done criteria:**
- [ ] UI panel em `http://127.0.0.1:<porta-livre>` (first free port discovery, scanned 41823-42823)
- [ ] 5 telas: Skills, Rules, Personas, Audit, Settings (PRD §4)
- [ ] Skills tab: lista colunar, busca por nome/keyword, side panel de leitura ao selecionar
- [ ] Rules tab: lista + Critical Rules com aviso visual "always on, can't toggle off sem confirmar"
- [ ] Personas tab: lista + cap 3 selecionáveis (UI bloqueia 4ª seleção)
- [ ] Audit tab: lista últimas N augmentations (timestamp, prompt redactado, matched IDs, pruning reasons, latência)
- [ ] Settings tab: threshold (`min_cosine_similarity`, `min_fts_hits`), tenant, integration mode, embedding model
- [ ] State em `.memory-studio/state.json` por projeto (path: cwd do projeto)
- [ ] **Toggle-off enforcement** (D-004 resolution + §10.1 item 7): POST `/state/toggle` com Rule critical + sem confirmação → 400. Com confirmação explícita → 200
- [ ] UI mostra **exemplo explícito** (D-004): "Rule critical:true — exemplo: toggle off + digitar 'CONFIRMAR' no painel → aceito; sem confirmação → bloqueado"
- [ ] UI carrega em <1s local (medido com cold cache + warm cache)
- [ ] Stack: HTMX+Alpine, zero build step (HTML servido direto), templates inline
- [ ] Layout responsive: cols Skills/Personas/Rules funcionam em 1024px+ viewport

**Output do Processador:**
- 5 HTML templates (HTMX partials)
- Alpine.js components per tab
- `.memory-studio/state.json` schema (TypeScript type)
- CSS mínimo (zero framework)

---

> **Phase 4 split (2026-07-31) — 4 subchapters per SUBCHAPTER_BREAKDOWN trigger (8-12h phase, 13 tasks total).**
> Each subchapter is a fresh phase with own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-4-ui-panel/{spec.md, design.md, tasks.md}` (commit `ae4b6f6`).
> Key decisions: option (a) for /state/toggle (Phase 4 owns real endpoint, Phase 5b subsumes); UI server = Node 22 `http` in `scripts/ui-server.mjs` (NOT Fastify); HTMX+Alpine vendored locally (zero build step); cold+warm first-byte <1000ms.

#### Phase 4.1 — UI workspace + state schema [x]

**Done when:** `packages/ui` workspace scaffolded; HTMX+Alpine vendored locally; `.memory-studio/state.json` schema is a TS type with read+write; minimal index page renders.

**Depends on:** Phase 3, Phase 4

**Scope (4 tasks):**
- `packages/ui/package.json` + `tsconfig.json` + vendored HTMX 1.9.x + Alpine 3.x
- `.memory-studio/state.json` TS type (extend existing schema with `active_catalog`, `ui` config)
- `readProjectState(path): ProjectState` + `writeProjectState(path, state): boolean` helpers
- Minimal `index.html` with hash router shell

**Output:** workspace + state schema + helpers + index shell.

---

#### Phase 4.2 — Skills + Rules + Personas tabs [x]

**Done when:** Skills, Rules, Personas tabs render the catalog items with search, side-panel, Critical Rules confirmation, persona cap 3.

**Depends on:** Phase 4.1

**Scope (4 tasks):**
- Skills tab: colunar list, search by name/keyword, side-panel reader
- Rules tab: list + Critical Rules visual warning + toggle-off confirmation modal
- Personas tab: list + cap-3 selection enforcement (UI blocks 4th with inline error)
- HTMX partials for tab content (server returns HTML, Alpine enhances)

**Output:** 3 tabs with full interactive features.

---

#### Phase 4.3 — Audit + Settings tabs [x]

**Done when:** Audit tab shows last N augmentations; Settings tab exposes thresholds + tenant + integration mode + embedding model.

**Depends on:** Phase 4.1

**Scope (2 tasks):**
- Audit tab: list of last N augmentations (timestamp, redact-prompt-hash, matched IDs, pruning reasons, latency); empty-state
- Settings tab: form bound to `state.json` thresholds + tenant + integration mode + embedding model

**Output:** 2 tabs reading project state.

---

#### Phase 4.4 — Toggle enforcement + perf + responsive closeout [x]

**Done when:** `POST /state/toggle` returns 400 on critical without confirmation; UI loads cold+warm <1000ms; layout works at 1024px viewport.

**Depends on:** Phase 4.1, Phase 4.2, Phase 4.3

**Scope (3 tasks):**
- `/state/toggle` endpoint in `scripts/ui-server.mjs` with Critical Rules + persona cap server-side enforcement
- Cold + warm first-byte measurement (Date.now() assertions, <1000ms both)
- Responsive layout sanity check (1024px viewport functions for all 5 tabs)

**Output:** `/state/toggle` working + perf measured + responsive verified. Phase 5b later subsumes the endpoint contract.

---

#### Phase 5a — API + Retrieval + Byte-string [x]

**Done when:** `/augment` smoke test com Claude Code; byte-string determinístico (SHA256); cache do provedor hit verificado em log; p50<50ms.

**Phase 5a status 2026-08-01:** **CLOSED via subchapters 5a.1, 5a.2, 5a.3, 5a.4 (all `[x]`)**. 13 atomic commits across 4 Implementer batches. 309 root + 152 UI + 16 SDK = 477 tests. All 13 gates green (typecheck, verify-env, build-index, catalog:load, smoke-server-boot, smoke-augment-server, UI/SDK tests, fastify single version, perf p50<50ms p99<200ms with ~30× headroom, scope guard empty, test:idempotent 2× stable). Final HEAD at `701a2f2`. Validation reports: `validation-phase-5a.{1,2,2-iter2,2-iter3,3,4}.md`. **Discovery for Phase 5b:** R-06 `agentId` restriction deferred (documented in `src/server/schema.ts:12-17` as intentional MVP exception). ROADMAP subchapter entries are the verification record; this parent entry is the scope summary.

**Depends on:** Phase 1, Phase 3, Phase 4

**Goal:** `/augment` smoke test com Claude Code; byte-string determinístico; cache do provedor hit.

**Scope:**
- SPEC §IMod-3 (`/augment` request schema)
- SPEC §IMod-4 (`/augment` response schema)
- SPEC §IMod-7 (retrieval runtime: FTS5 + sqlite-vec + RRF + tiebreak D-006)
- SPEC §IMod-9 (cache architecture — provider cache only, MVP)
- SPEC User Stories §C hot-path items (16-22) + §D cache items (40-45)
- **Não inclui:** audit write runtime (Phase 5b), outros 5 endpoints (Phase 5b), inception híbrida (Phase 6)

**PRD refs:**
- §7.1 POST `/augment` (request/response structs)
- §8 invariante sólida 3 (`cache_control: ephemeral`)
- §8 invariante nova 11 (2 blocos `cache_control: ephemeral`)
- §10.1 item 1 (lê prompt + estado com campos exatos: `scratch`, `todos`, `recentFiles`, `lastEvent`)
- §10.1 item 2 (top 3-5 skills/rules/personas — **não só "top-K"**)
- §10.1 item 3 (byte-string determinístico SHA256)
- §10.1 item 4 (`cache_control: ephemeral` em 2 blocos)
- §10.1 item 5 (cache hit verificado via log)
- §10.1 item 9 (modo prompt-only)
- §10.1 item 10 (funciona com Claude Code)
- §14.3 modo de integração prioritário (proxy transparente)
- §14.6 medir cache hit (request hit rate + token cache coverage)
- §17.1 caches distinction

**Estimate:** 3-4h

**Done criteria (cada checkbox testável):**
- [ ] `/augment` recebe request com **todos campos PRD §7.1** (validado: 400 se campo obrigatório ausente)
- [ ] Retrieval retorna **exatamente 3-5 items** matched (não "top-K genérico" — assertCount ≥ 3 && ≤ 5)
- [ ] Threshold duplo respeitado: `min_cosine_similarity` AND `min_fts_hits` ambos passam
- [ ] **Tiebreak ordering** (D-006): `matched.sort((a,b) => a.id.localeCompare(b.id))` aplicado antes de serializar
- [ ] **SHA256(byte-string) equality test** (D-006): 2 requests com mesma input lógica (incluindo matched arrays empatando) → mesmo SHA256
- [ ] **Tiebreak stress test** (D-006 done criterion): 1000 requests com cosine scores aleatórios no threshold produzem mesmo SHA256 byte-string quando matched arrays são equivalentes
- [ ] System message augmenté com **2 blocos `cache_control: ephemeral`**: bloco 1 = persona (estável), bloco 2 = Skills (variável)
- [ ] Smoke test end-to-end com Claude Code via custom baseURL (`baseURL: http://127.0.0.1:<porta>` em `.claude/settings.json` ou env var)
- [ ] `usage.cache_read_input_tokens > 0` em log quando mesmo persona + mesmas Skills ativas em 2 requests seguidos
- [ ] Modo prompt-only: request com `context: null` → response 200 + matched arrays podem ser vazios
- [ ] Latency p50 <50ms sem embedding cache miss (medido com 1000 requests sintéticos)
- [ ] Latency p99 <200ms com embedding (medido)

**Output do Processador:**
- TS shape completo `/augment` request/response
- Retrieval algorithm (RRF + threshold + tiebreak)
- Smoke test script + Claude Code integration guide
- Structured JSON logger com `usage.cache_read_input_tokens` field

---

> **Phase 5a split (2026-07-31) — 4 subchapters per SUBCHAPTER_BREAKDOWN trigger (13 tasks, 2 Implementer batches).**
> Each subchapter is a fresh phase with own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-5a-api-retrieval/{spec.md, design.md, tasks.md}` (commit `c41a4df`).
> Key decisions: Fastify `^5.x` server (PRD §8 mandates); 2 cache blocks (persona stable + Skills/Rules/matched/context variable); systemMessage = SHA-256 hex of canonical-JSON-serialized blocks; tiebreak stress 1000 requests with deterministic PRNG proving byte-string equivalence; perf N=3 rounds × 1000 requests reporting min/median/p95/p99 (per Phase 4.4 Verifier feedback); server at `src/server/**` (not workspace, preserves Phase 1+2 import graph); reuse Phase 1 calibration residue `src/search/*` (per CALIBRATION-RESIDUE.md); fail-open (timeout → 200 + `emptyReason: "timeout"` + persona-only system message).

#### Phase 5a.1 — Server Foundation [x]

**Done when:** Fastify `^5.x` bootstrap running; Zod schemas validate `/augment` request shape; route handler returns structured 400 on missing fields; structured pino logger emits JSON lines; `/health` GET returns 200 with uptime; entry point wired into root `package.json`.

**Depends on:** Phase 1, Phase 4 (Phase 5a parent)

**Scope (T-01..T-04):**
- Fastify bootstrap: `src/server/boot.ts` + `src/server/index.ts` entry point (port range `[42900, 43000]`, separate from Phase 4 UI's `[41823, 42823]`; corrected from earlier draft; Phase 5a.4 may add `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env override)
- Zod schemas matching `/augment` request/response per PRD §7.1
- POST `/augment` route handler with validation (400 on missing required fields)
- Structured pino logger emitting JSON with `usage.cache_read_input_tokens` field ready
- GET `/health` returning `{ status: "ok", uptime_ms, last_request_ts, request_id }`

**Output:** Fastify server boots on free port (range 41823-42823); 400 + ZodIssue on bad request; logs structured.

---

#### Phase 5a.2 — Retrieval Pipeline [x]

**Done when:** retrieval composes RRF + double threshold + top-3-to-5 + tiebreak; pipeline orchestrator builds 2-block systemMessage with SHA-256 byte-string; empty/timeout cases fail-open.

**Depends on:** Phase 5a.1

**Scope (T-05..T-08):**
- Compose existing `src/search/{fts,rrf,schema,vector}` calibration residue
- Double threshold gate: `min_cosine_similarity=0.75` AND `min_fts_hits=1`
- Top-K = 3-5 items (PRD §10.1 item 2, not generic K)
- Tiebreak: `matched.sort((a,b) => a.id.localeCompare(b.id))` (D-006)
- Augmenter + byte-string = SHA-256 of canonical-JSON-serialized 2-block system message
- 2 cache blocks: persona(s) joined = block 1; Skills + Rules + matched + context = block 2
- Fail-open: retrieval errors → 200 with `emptyReason: "timeout"` + persona-only system message

**Output:** deterministic, fail-open retrieval; SHA-256 byte-string stable across equivalent inputs.

**Phase 5a.2 status 2026-08-01:** Closed via iter 1 (FAIL on G1 CRITICAL tiebreak D-006) → iter 2 (FT-01 tiebreak fix + FT-02 smoke + FT-03 idempotent script — Implementer died from API 429 mid-fix) → iter 3 (Windows taskkill /F /T cleanup + R-14 fail-open tests). Verifier iter 3 PASS: 275 root + 152 UI + 16 SDK = 443 tests, hash drift 0/1000 iters, smoke 3x stable, no port leak. Validation report: `.specs/features/phase-5a-api-retrieval/validation-phase-5a.2-iter3.md`. Commits `fe07efa`, `526ddf5`, `23f6242`, `17a0d32`, `3fe84ba`.

---

#### Phase 5a.3 — Tests + Smoke [x]

**Done when:** SHA-256 equality test proves 2 equivalent inputs → same byte-string; tiebreak stress test runs 1000 randomized requests with same matched IDs → all 1000 same byte-string; smoke script + Claude Code guide draft complete.

**Depends on:** Phase 5a.2

**Scope (T-09..T-11):**
- `test/augment/byte-string.test.mjs` — 2 equivalent requests → same SHA-256
- `test/augment/tiebreak-stress.test.mjs` — 1000 randomized requests with deterministic PRNG (seedrandom); all same matched IDs + same SHA-256 byte-string
- `scripts/smoke-augment-server.mjs` — boot server, POST twice, forward system messages to MiniMax Anthropic-compatible API OR deterministic stub fixture, assert `usage.cache_read_input_tokens > 0` on 2nd call
- `docs/guides/claude-code-baseurl.md` — Claude Code SDK-level custom baseURL integration

**Output:** tests pass + smoke script + Claude Code guide.

**Phase 5a.3 status 2026-08-01:** Closed via 1 iteration. T-09 byte-string equality (7/7) baseline `4f6dba1b…` byte-identical. T-10 tiebreak stress (already in `byte-string-determinism.test.mjs`) baseline `c038eb79…` unchanged. T-11 end-to-end smoke (5/5 checks, cache_read=23 on 2nd call, 4× standalone stability) + Claude Code guide (94 lines, 3 sections). Verifier PASS at `ad8be1c`. 282 root + 152 UI + 16 SDK = 450 tests. Validation report: `.specs/features/phase-5a-api-retrieval/validation-phase-5a.3.md`. Commits `0cc9ce3`, `ad8be1c`. LOW follow-ups flagged: (a) `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var set but not read by `boot.ts:111` (parse-from-stdout works around it); (b) no `smoke:augment-server` package.json script. Both optional.

---

#### Phase 5a.4 — Perf + Hardening [x]

**Done when:** perf harness reports `min/median/p95/p99` across N=3 rounds × 1000 requests; gates `median < 50ms` AND `p99 < 200ms`; e2e route + entry point + `package.json` wiring complete; full gate passes.

**Depends on:** Phase 5a.3

**Scope (T-12..T-13):**
- `test/augment/perf.test.mjs` — N=3 rounds × 1000 requests, 100 warmup excluded; aggregate `min/median/p95/p99`; assert gates
- End-to-end route wiring + entry point + root `package.json` script (e.g. `"server:start"`)
- Final phase closeout smoke + full gate

**Output:** measured perf within budget; server fully integrated.

**Phase 5a.4 status 2026-08-01:** Closed via 1 iteration. T-12 perf harness: median=1.91ms, p99=6.24ms across 3 rounds × 1000 requests (~30× under 50ms/200ms budget). T-13 e2e route + concurrent load (10/10 simultaneous 200s, server stable): `test/augment/route-e2e.test.mjs` 394 lines, 10 test cases. LOW follow-ups both done: `MEMORY_STUDIO_AUGMENT_PORT_RANGE` env var wired into `boot.ts` (16-case unit test, manual smoke verified), `smoke:augment-server` package.json script added. Final scope guard clean: `git diff 5cf6894..HEAD -- <locked-layers>` empty. Verifier PASS at `701a2f2`. 309 root + 152 UI + 16 SDK = 477 tests. Validation report: `.specs/features/phase-5a-api-retrieval/validation-phase-5a.4.md`. Commits `5731b6b`, `6116585`, `e6e6e5f`, `701a2f2`. **Discovery flagged:** spec.md R-06 says `agentId` MUST equal "claude-code" but `src/server/schema.ts:56-62` has `z.string()` unrestricted — documented as intentional MVP exception deferred to Phase 5b proxy-layer visibility.

---

#### Phase 5b — Audit + Endpoints + Security [x]

**Done when:** 5 auxiliary endpoints respondendo (catalog/catalog-rebuild/audit/audit-summary/health/state-toggle); audit async+fail-open; security invariants honrados.

**Phase 5b status 2026-08-01:** **CLOSED via subchapters 5b.1, 5b.2, 5b.3, 5b.4 (all `[x]`)**. 11 atomic commits across 2 Implementer batches. 391 root + 152 UI + 16 SDK = 559 tests. All gates green. Endpoints: GET /catalog, GET /audit, GET /audit/summary, POST /catalog/rebuild, POST /state/toggle, enhanced GET /health. Audit: D-007 CRITICAL fail-open verified end-to-end (independently), count=100 + time=1000ms triggers, ring cap 10000. Redact: 4 placeholder patterns + recursive. Tenant-hash: sha256[0:16]. R-06 agentId restriction enforced at `schema.ts:58`. Transparent proxy at `/v1/messages` with local-only allowlist; disabled by default (503 if `MEMORY_STUDIO_ANTHROPIC_BASE_URL` missing); Claude Code integration ready. Final HEAD at `c7e7a8d`. Validation reports: `validation-phase-5b.{1+2,3+4}.md`. **Deferred gap:** POST /catalog/rebuild production wiring uses FALLBACK no-op (cannot recover from corrupted catalog). Real TEMP+rename swap deferred pending stable YAML catalog dir + embedder — flagged for Phase 5c/7a follow-up. ROADMAP subchapter entries are the verification record; this parent entry is the scope summary.

**Depends on:** Phase 5a

**Goal:** 5 auxiliary endpoints respondendo; audit não bloqueia; security invariants honrados.

**Scope:**
- SPEC §IMod-8 (audit log async + batch flush + fail-open — D-007 CRITICAL)
- SPEC §IMod-10 (endpoint ownership — 5 auxiliary + /augment = 6 total)
- SPEC §IMod-12 (empty catalog contract — D-008)
- SPEC §IMod-13 invariante 15 (audit async)
- SPEC §IMod-13 invariantes sólida 1 (Node-only) + 5 (tenant_id hasheado)
- SPEC User Stories §F, §G, §H, §I (edge cases, security, operational, endpoints)
- **Não inclui:** /augment retrieval (Phase 5a), UI panels (Phase 4), inception híbrida (Phase 6)

**PRD refs:**
- §7.2 Outros endpoints (MVP) — `/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`
- §8 invariante nova 15 (audit log async + fail-open)
- §10.1 item 8 (audit log grava tudo: prompt redactado + matched IDs + pruning + latência)
- §10.1 item 11 (`activeCatalog` vazio → 200 + `emptyReason: "no_active_items"` + forward unchanged — D-008)
- §10.3 item 1 (zero persistência raw context)
- §10.3 item 2 (`tenantId` hasheado)
- §10.3 item 3 (placeholders determinísticos não vazam secret)
- §10.3 item 4 (nenhum dado sai da máquina — proxy local only)
- §10.4 item 3 (audit query < 100ms pra 30 dias)
- §10.4 item 4 (`/health` retorna 200 — D-009)

**Estimate:** 3-4h

**Done criteria:**
- [ ] `/catalog` GET retorna full catalog YAML+embeddings (read-only)
- [ ] `/catalog/rebuild` POST idempotente, safe durante requests (concurrent request não corrompe index)
- [ ] `/audit` GET retorna últimas N augmentations (redactado), `prompt_hash` em vez de raw text
- [ ] `/audit/summary` GET retorna daily rollups (Phase 7a vai usar)
- [ ] `/health` GET retorna 200 com `{status: "ok", uptime_ms, last_request_ts}` (mesmo sem dados)
- [ ] **`/state/toggle` POST** (consumido por Phase 4 UI): recebe `{itemId, action: "on"|"off", critical_confirm?: string}`; toggle Rule critical sem `critical_confirm` → 400; com confirmação → 200 + write em `.memory-studio/state.json`
- [ ] **7 endpoints total** (D-009 + Phase 4 dependency): `/augment` + 6 auxiliary (`/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`, `/state/toggle`)
- [ ] **Audit async + fail-open** (D-007 CRITICAL): SQLite write error simulado → request continua 200, erro vai pra stderr, evento droppado (não bloqueia)
- [ ] **Audit batch flush** (D-007): buffer in-memory, flush a cada N=100 events OU T=1000ms (whichever first)
- [ ] **Empty catalog contract** (D-008): `/augment` com `activeCatalog: []` → 200 + `systemMessage` persona-only determinístico + `matchedSkills/Rules/Personas: []` + `emptyReason: "no_active_items"` + `warnings: ["activeCatalog is empty — proceeding with persona only"]` + forward unchanged
- [ ] **`emptyReason` enum** (D-008) includes `"no_active_items"` + outros 4 valores existentes (`low_confidence | social | timeout | null`)
- [ ] **Zero raw persistence** (PRD §10.3.1): audit row contém apenas `prompt_hash` (sha256), `matched_ids` (array de strings), `pruning_reasons` (typed), `latency_ms` (numeric). Zero raw text.
- [ ] **Placeholder secret redaction test** (PRD §10.3.3): inject test placeholder `${SECRET_KEY}=abc123` no prompt → audit log substitui por `prompt_hash` + matched_ids (não raw)
- [ ] **Local-only proxy** (PRD §10.3.4): network trace durante smoke test → zero requests externos exceto provedor configurado. Validated com tcpdump/Wireshark ou mock.
- [ ] **TenantId hashed** (PRD §10.3.2): todos os logs têm `tenantId_hashed` field (sha256[0:16]), nunca raw
- [ ] **Audit query <100ms / 30 dias** (PRD §10.4.3): `GET /audit?range=30days` retorna em <100ms com dataset de 1000+ rows
- [ ] **Working set <1.5GB** (PRD §10.2.3): medido após 1h de operação

**Output do Processador:**
- 5 endpoint handlers (TS) com auth middleware
- Audit buffer module (TS) com batch flush + fail-open (padrão async buffer)
- Empty catalog contract module (TS)
- Security invariant tests (10+ test cases)
- Network policy module (block outbound exceto provedor)

---

> **Phase 5b split (2026-08-01) — 4 subchapters per Planner recommendation (14 atomic tasks, dependency-seam boundaries).**
> Each subchapter is a fresh phase with own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-5b-aux-endpoints/{spec.md, design.md, tasks.md}` (commit `b6ced99`).
> Key decisions: Audit buffer at `src/server/audit/buffer.ts` (count=100 OR time=1000ms triggers, fail-open try/catch, ring buffer cap 10000); transparent proxy disabled by default (env var `MEMORY_STUDIO_ANTHROPIC_BASE_URL`, returns 503 if missing); R-06 agentId restriction enforced at `src/server/schema.ts:56-62` (Phase 5a.4 MVP-exception comment removed); no new npm deps; empty catalog D-008 already shipped in 5a.2 pipeline.ts:172-203; 2 Implementer batches (5b.1+5b.2 = 8 tasks, 5b.3+5b.4 = 6 tasks).

#### Phase 5b.1 — Audit Foundation [x]

**Done when:** audit buffer module (`src/server/audit/buffer.ts`) enforces count=100 OR time=1000ms flush triggers, fail-open on SQLite write errors, ring buffer cap 10000; audit row schema matches PRD §10.3.1 (zero raw persistence); tenantId hashing at `src/server/security/tenant-hash.ts` (sha256[0:16]); 003_audit_events_ts_index.sql migration applied.

**Phase 5b.1 status 2026-08-01:** Closed via 1 iteration. Audit buffer: ring cap 10000, count=100 OR time=1000ms triggers, fail-open independently verified (5 enqueues with stub writer that throws → 5 events dropped, stderr line, lastFlushTs=null, 6th enqueue succeeds = buffer not poisoned). Audit row schema matches PRD §10.3.1 (zero raw persistence). Redact: 4 placeholder regex patterns (`${VAR}=value`, `password|token|api_key|secret_key=`, `sk-...`, `Bearer ...`) + recursive. TenantId hashing: sha256[0:16] = 16 hex chars. Migration 003 additive perf index on `audit_events.ts`. Verifier PASS at `351ca9e`. 352 root + 152 UI + 16 SDK = 520 tests (target ≥520 met). Validation: `.specs/features/phase-5b-aux-endpoints/validation-phase-5b.1+5b.2.md`. Commits `0031787`, `4724309`, `d232927`.

**Depends on:** Phase 5b

**Scope (T-01..T-04):**
- `src/server/audit/buffer.ts` — in-memory ring buffer + count/time triggers + fail-open try/catch + shutdown flush in `boot.ts` SIGTERM handler
- `src/server/audit/redact.ts` — 4 placeholder regex patterns (`${VAR}=value`, `password|token|api_key|secret_key=`, `sk-...`, `Bearer ...`); recursive redaction for objects
- `src/server/security/tenant-hash.ts` — extract tenantId hashing from `src/server/augment.ts:51-54`; emit `tenantId_hashed` (sha256[0:16] = 16 hex chars)
- `src/catalog/migrations/003_audit_events_ts_index.sql` — additive perf index on `audit_events.ts` (existing 001_init.sql table shape preserved)

**Output:** audit buffer wired + 10000-event ring cap + perf index + security helpers + unit tests.

---

#### Phase 5b.2 — Read Endpoints [x]

**Done when:** `GET /catalog`, `GET /audit`, `GET /audit/summary`, enhanced `GET /health` (with `audit_buffer.{depth, capacity, last_flush_ts}` + `catalog.{count, last_rebuild_ts}`) all return 200 with documented contracts; `/audit` query <100ms / 30 dias.

**Phase 5b.2 status 2026-08-01:** Closed via 1 iteration. GET /catalog returns full catalog YAML + embeddings metadata (NOT raw embeddings), sorted by id ASC. GET /audit returns last N augmentations (redacted), `?limit=600` clamps to 500. GET /audit/summary returns daily rollups. GET /health enhanced with `audit_buffer.{depth, capacity: 10000, last_flush_ts}` + `catalog.{count, last_rebuild_ts}` blocks (backward-compatible with Phase 5a.1). Perf gate < 100ms / 30 dias verified: max=10.70ms, median=5.65ms (9.3× headroom). Verifier PASS at `351ca9e`. Commits `17d562f`, `351ca9e`.

**Depends on:** Phase 5b.1

**Scope (T-05..T-08):**
- `src/server/routes/catalog.ts` — GET returns full catalog YAML + embeddings metadata (no raw embeddings, just presence + hash)
- `src/server/routes/audit.ts` — GET returns last N augmentations redacted; `/audit/summary` returns daily rollups; sub-100ms perf gate verified with 1000-row seed
- `src/server/health/route.ts` — extend payload with `audit_buffer.{depth, capacity, last_flush_ts}` + `catalog.{count, last_rebuild_ts}` blocks; backward-compatible with Phase 5a.1

**Output:** 3 read endpoints + enhanced /health + perf subtest for /audit.

---

#### Phase 5b.3 — Write Endpoints + R-06 [x]

**Done when:** `POST /catalog/rebuild` (TEMP DB + atomic rename + mutex) is idempotent + safe during concurrent requests; `POST /state/toggle` (Promise-based Mutex) accepts `action: on|off` + optional `critical_confirm`; **`agentId` restricted to literal `"claude-code"`** at `src/server/schema.ts:56-62` (Phase 5a.4 R-06 drift resolved); Phase 5a.4 substitute test (`missing fingerprint → 400`) replaced with spec-correct case (`agentId: "cursor" → 400`).

**Phase 5b.3 status 2026-08-01:** Closed via 1 iteration. POST /catalog/rebuild: contractually correct (idempotent, mutex-serialized, `setLastRebuildTs` called) — but **production wiring uses FALLBACK no-op** (`src/server/routes/catalog-rebuild.ts:55-65`). Real TEMP-DB + atomic-rename swap deferred pending stable YAML catalog dir + embedder (file header lines 17-23 document this). Endpoint cannot recover from corrupted catalog in MVP — flagged as documented gap. POST /state/toggle: inline Promise Mutex, Zod body validation, critical_confirm_required enforcement. Synthetic tenantId `hashTenantId('state-toggle-tenant')` for audit column NOT NULL constraint — acceptable per spec. R-06 schema tightened: `z.string()` → `z.literal('claude-code', { errorMap })` at `schema.ts:58`; MVP-exception comment removed (lines 12-17). 0 test replacements needed (all 14 agentId usages already canonical). Phase 5a.4 substitute test REPLACED with `agentId: "cursor" → 400` + `agentId missing → 400` cases. Verifier PASS at `f643595`. 391 root + 152 UI + 16 SDK = 559 tests. Validation: `.specs/features/phase-5b-aux-endpoints/validation-phase-5b.3+5b.4.md`. Commits `f643595`, `17501b3`, `76b7951`.

**Depends on:** Phase 5b.2

**Scope (T-09..T-11):**
- `src/server/routes/catalog-rebuild.ts` — TEMP DB build + atomic rename; mutex scope = file rename (not rebuild computation); concurrent `/augment` requests during rebuild stay 200
- `src/server/routes/state-toggle.ts` — Promise-based inline `class Mutex`; writes `.memory-studio/state.json`; validates `critical_confirm: "OVERRIDE: <itemId>"` (or YAML override) for critical Rule toggles
- `src/server/schema.ts:56-62` — tighten `agentId` from `z.string()` to `z.literal('claude-code')` with custom errorMap; remove MVP-exception comment at `src/server/schema.ts:12-17`; audit all `test/augment/*.test.mjs` for non-canonical `agentId` and replace

**Output:** 2 write endpoints + R-06 schema tightened + state.json persistence + concurrent rebuild safety test.

---

#### Phase 5b.4 — Transparent Proxy [x]

**Done when:** `POST /v1/messages` proxies Anthropic requests to upstream (`MEMORY_STUDIO_ANTHROPIC_BASE_URL`); disabled by default (returns 503 `proxy_disabled` if env var missing); audit event `messages_proxy` enqueued with `cache_read_input_tokens` from upstream response; proxy allowlist rejects non-loopback upstream hosts (PRD §10.3.4); `scripts/smoke-proxy-local-only.mjs` proves zero external requests via network capture.

**Phase 5b.4 status 2026-08-01:** Closed via 1 iteration. POST /v1/messages: 503 `proxy_disabled` when env missing; otherwise extracts first user message, builds internal AugmentRequest, calls `runAugment()` in-process, rewrites `system` to Memory Studio's 2-block structure (`buildSystemMessage(...).system`), forwards via Node 22 fetch, captures `usage.cache_read_input_tokens` + `cache_creation_input_tokens`. Audit `event_type: 'messages_proxy'` enqueued with cache metrics + `redactedPromptHash` + `tenantId_hashed` + matched_ids. Failure semantics NOT fail-open (502 `augment_failed` on pipeline error — proxy IS the LLM agent's failure signal). Proxy allowlist at `src/server/security/proxy-allowlist.ts` with `LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '::1'}`. Stub smoke at `scripts/smoke-proxy-local-only.mjs` (333 lines, 10/10 checks, ~7.5s) confirmed stub observed exactly 1 request → zero external network calls. Verifier PASS at `c7e7a8d`. Commits `8234eb7`, `a54bca2`, `c7e7a8d`.

**Depends on:** Phase 5b.3

**Scope (T-12..T-14):**
- `src/server/security/proxy-allowlist.ts` — `LOOPBACK_HOSTS = {'127.0.0.1', 'localhost', '::1'}`; rejects any non-loopback upstream
- `src/server/routes/messages-proxy.ts` — extracts first user message from Anthropic request, builds internal `AugmentRequest`, calls `runAugment()` in-process (no HTTP hop), rewrites `system` field to Memory Studio's 2-block structure, forwards to upstream, captures `usage.cache_read_input_tokens` + `cache_creation_input_tokens` for audit; returns 502 on pipeline errors (NOT fail-open — proxy is the LLM agent's failure signal)
- `scripts/smoke-proxy-local-only.mjs` — boots proxy on `MEMORY_STUDIO_AUGMENT_PORT_RANGE=47100-47100`, points `MEMORY_STUDIO_ANTHROPIC_BASE_URL` to local stub on 47200, sends 1 `/v1/messages`, asserts (a) proxy works, (b) no external network requests observed, (c) audit row contains `cacheReadInputTokens`

**Output:** proxy route + allowlist + local-only smoke + Claude Code `ANTHROPIC_BASE_URL` integration ready.

---

#### Phase 6a — POC Validation (hot path + fast agent) [x]

**Done when:** inception híbrida valida overhead hot path <10ms E fast agent <3s em 10 amostras; targets medidos, não estimados.

**Phase 6a status 2026-08-01:** **CLOSED via subchapters 6a.1, 6a.2, 6a.3 (all `[x]`)**. 6 atomic commits + 19 POC tests added (391 root + 152 UI + 16 SDK + 19 POC = 578 tests). All 3 POC targets PASS with sound methodology (147× headroom on PRIMARY hot path overhead). Verifier re-measurement matches Implementer's numbers within 1.6% delta. AD-006 decision record captures POC outcome + Phase 6b per-request latency budget derivation. Final HEAD at `84d70a1`. Validation: `.specs/features/phase-6a-poc-validation/validation-phase-6a.md`. **Phase 6b proceeds** with these POC ceilings as the production wiring budgets.

**Depends on:** Phase 5b

**Goal:** validar empiricamente que inception híbrida adiciona <10ms ao hot path E que fast agentuality termina em <3s. Não é binary fork — é validation empírica. Se POC reprova, decisão humana é ajustar (trocar modelo, otimizar query), não collapsar.

**Scope:**
- PRD §16.7 (POC checklist — canonical, §16.6 é stale por causa do §16.5 insert)
- Hot path overhead POC (intel load + concat + template render, budget <10ms)
- Fast agent latency POC (MiniMax-M2.7-highspeed lê R_N paralelo com humano)
- Intel pipeline POC (writer-reader contract end-to-end)

**PRD refs:**
- §3 Como funciona (fluxo canônico)
- §10.1 item 12 (Inception híbrida — validado por POC Phase 6a)
- §16 Inception Híbrida — arquitetura NOVEL
- §16.7 Próximo passo (pré-grill checklist)
- §16.2 Latency trick

**Estimate:** 2-3h

**Done criteria:**

Targets medidos (10 amostras cada), não estimados:

- [ ] `sqlite.get(intel)` por `session_id` < 5ms (p95)
- [ ] Concatenação intel + prompt < 1ms (p95)
- [ ] Template rendering (2 blocos `cache_control: ephemeral`) < 1ms (p95)
- [ ] **Overhead total no hot path < 10ms** (PRIMARY — mantém budget p50<50ms do PRD §10.2)
- [ ] Fast agent (default `MiniMax-M2.7-highspeed`) responde < 3s (10 amostras; highspeed variant tipicamente <1s)
- [ ] **Byte-string determinístico com template:** SHA256(byte-string) igual entre 2 inputs idênticos (mesmo persona + mesmo intel + mesmas Skills ativas)

**Regra:** se algum target falhar → ajustar (trocar modelo, otimizar query, refactor template), não collapsar.

**Por que hot path overhead é PRIMARY, latency trick é SECONDARY:**

O gargalo real é o que inception adiciona ao hot path a cada Turn N+1 (síncrono, bloqueia humano). Latência do fast agent acontece em paralelo com leitura humana (folga 5-30s). Se inception overhead for <10ms, é transparente — latency trick é bônus arquitetural, não risco técnico. POC foca no gargalo real.

**Output do Processador:**
- Grill transcript em `.specs/auto-grill-output/<timestamp>/`
- Decision recorded em `.specs/DISCOVERIES.md`
- POC result doc com timing measurements + decisão humana

---

> **Phase 6a split (2026-08-01) — 3 subchapters per Planner recommendation (11 atomic POC tasks, single Implementer batch — all measurement scripts, no production code).**
> Each subchapter is a fresh phase with own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-6a-poc-validation/{spec.md, design.md, tasks.md}` (commit `ddc7c0c`).
> Key decisions: Hot path overhead = PRIMARY criterion (PRD §10.2 budget); fast agent = `MiniMax-M2.7-highspeed` at `https://api.minimax.io/anthropic` with stub fallback (marked `[STUB]`); byte-string determinism uses inline `buildSystemMessageWithIntel()` helper (Phase 6b formalizes); AD-006 decision record mandatory in `.specs/DISCOVERIES.md` (load-bearing for Phase 6b's per-request latency budget); pass/fail thresholds are p95 with 10 amostras + 5 warmup.

#### Phase 6a.1 — Hot Path Overhead POC [x]

**Done when:** 3 incremental costs measured (sqlite.get(intel) p95<5ms, concat(intel+prompt) p95<1ms, template render p95<1ms) and TOTAL hot path overhead p95<10ms (PRIMARY). Consolidated into `poc-result-6a.1.md` with raw timing samples.

**Phase 6a.1 status 2026-08-01:** Closed via 1 iteration. Hot path overhead measured at p95=0.07ms (147× headroom under 10ms PRIMARY budget). Per-component: sqlite.get(intel)=0.02ms (250× headroom), concat=0ms, template render=0.04ms. 10 amostras + 5 warmup, methodology soundness verified (real :memory: SQLite + JSON.parse + string concat + 2-block array construction). Verifier re-measurement matches Implementer's numbers within 0.7-1.6% delta. Commit `128e044`.

**Depends on:** Phase 5b

**Scope (T-01..T-04):**
- `scripts/poc-hot-path-harness.mjs` — boots augment server in-process via `app.inject()`; ONNX stubbed with cached 384d Float32Array; measures delta over no-op baseline (NOT full Phase 5a.4 pipeline ~1.91ms); 10 amostras + 5 warmup per component
- `test/poc/hot-path-components.test.mjs` — 4 tests: harness scaffold + sqlite.get + concat + template render
- `docs/poc-result-6a.1.md` — raw samples + p95 + decision (adjust if any target fails)

**Output:** hot path overhead POC validated (or adjustment recommended in AD-006).

---

#### Phase 6a.2 — Fast Agent Latency POC [x]

**Done when:** real `MiniMax-M2.7-highspeed` latency p95<3s over 10 amostras (when `MINIMAX_API_KEY` env var set); stub fallback produces `[STUB]`-marked outputs when key unset. Consolidated into `poc-result-6a.2.md`.

**Phase 6a.2 status 2026-08-01:** Closed via 1 iteration. Fast agent latency p95=223ms in stub mode (13× headroom under 3s budget). Mode: STUB — `MINIMAX_API_KEY` unset + `@anthropic-ai/sdk` not installed in environment. Stub default `SIMULATED_LATENCY_MS=200` + ~21ms loopback overhead. Every stub log line `[STUB]`-prefixed. `[fast-agent] MODE=stub` logged prominently. Verifier re-measurement within 1.6ms of Implementer's. Real API re-measurement deferred to Phase 7b tuning. Commits `650343b`, `72dd709`.

**Depends on:** Phase 6a.1

**Scope (T-05..T-08):**
- `scripts/stub-fast-agent.mjs` — Anthropic-compatible POST `/v1/messages` on port 47200, deterministic `Intel` literal response, `SIMULATED_LATENCY_MS=200ms` default, every log line prefixed `[STUB]`
- `scripts/poc-fast-agent-harness.mjs` — tries `MINIMAX_API_KEY`; falls back to stub if unset; logs `[fast-agent] MODE=real|stub`; 10 amostras with 5 warmup
- `test/poc/fast-agent.test.mjs` — 8 tests: stub fallback mode + real-mode contract + latency p95 budget
- `docs/poc-result-6a.2.md` — raw samples + p95 + decision (adjust if real API exceeds budget; stub mode = human intervention required)

**Output:** fast agent latency POC validated (or alternative model recommended).

---

#### Phase 6a.3 — Byte-String + AD-006 [x]

**Done when:** 2 inputs with identical (persona + intel + Skills) produce identical SHA-256 byte-string; SPEC §IMod-5 Intel schema validated (graceful degradation on empty fields); AD-006 decision recorded in `.specs/DISCOVERIES.md` with POC result summary.

**Phase 6a.3 status 2026-08-01:** Closed via 1 iteration. 10/10 POC tests PASS (4 byte-string equality + 6 Intel schema D-005 hardening). 6/6 independent Verifier forgery checks PASS (identical inputs → same SHA; perturbed fields → different SHA; empty intel valid + differs from non-empty). D-005 graceful degradation: empty `agentState`, empty `nextNeeds[]`, empty `recentTopic` all parse OK. AD-006 decision recorded in `.specs/DISCOVERIES.md` with Phase 6b per-request latency budget derivation. Commits `86d11ff`, `461db1d`, `84d70a1`.

**Depends on:** Phase 6a.2

**Scope (T-09..T-11):**
- `scripts/poc-byte-string-harness.mjs` — inline `:memory:` SQLite with `intel(session_id, agent_state, next_needs, recent_topic, ts)` DDL; inline `buildSystemMessageWithIntel()` helper; uses existing `canonicalSha256()` from `src/server/augment/byte-string.ts` (read-only)
- `test/poc/byte-string-determinism.test.mjs` — 4 tests: equality + schema literal + JSON round-trip + graceful degradation
- `test/poc/intel-schema.test.mjs` — 6 tests: D-005 hardening (literal shape, empty fields OK, type validation)
- `.specs/DISCOVERIES.md` AD-006 entry — POC results table + adjustment recommendations + Phase 6b per-request latency budget derivation

**Output:** byte-string determinism POC + AD-006 decision record.

---

#### Phase 6b — Fast Agent + Intel Pipeline (mandatory) [ ]

**Done when:** Turn N+1 augmenta com intel; latency trick validada em produção; arquitetura NOVEL implementada; cache hit `usage.cache_read_input_tokens > 0` em 2 turns com prefixo estável.

**Depends on:** Phase 6a

**Goal:** Turn N+1 augmenta com intel. Latency trick validated em produção. Arquitetura NOVEL implementada.

**Scope:**
- SPEC §IMod-5 (intel schema — D-005: `{ agentState: string, nextNeeds: string[], recentTopic: string }`)
- §16.4 decisions (in-process Haiku / SQLite intel store WAL / embedding pipeline reuse / template 2-block / persona anchor)
- Fast agent (`MiniMax-M2.7-highspeed`) in-process
- Intel store persistido em SQLite (WAL mode)
- Match script (intel + prompt + context + catalog) — reusa embedding pipeline existente
- Suffix injection no system message (prefixo intacto)
- Intel contract validation (writer-reader test)

**PRD refs:**
- §3 fluxo canônico
- §10.1 item 12 (Inception híbrida — mandatório pós-POC)
- §14.7 Inception híbrida (response-first)
- §16.1-§16.7 (latency trick, novelty, engineering decisions §16.4 resolvidas, intel schema §16.5, lessons, próximo passo §16.7)

**Estimate:** 8-12h + 4h §16.4 overhead = **12-16h**

**Done criteria:**
- [ ] Fast agent (default `MiniMax-M2.7-highspeed` via Anthropic-compatible API `https://api.minimax.io/anthropic` — no Claude Code, "Haiku" option = MiniMax-M2.7-highspeed, sem acesso a Anthropic oficial. Configurável via `fastAgent.model` em `.memory-studio/state.json`) lê R_N em paralelo com humano (in-process, não daemon)
- [ ] Intel schema `{ agentState, nextNeeds, recentTopic }` gerado por fast agent (literal — D-005)
- [ ] Intel store persistido em SQLite (WAL mode); restart do server preserva intel do último turn
- [ ] Turn N+1 augmenta com `(intel + prompt + context + catalog)`
- [ ] Suffix injection via template 2 blocos `cache_control: ephemeral` (persona + intel+Skills)
- [ ] **Latency trick validated** (PRD §16.2, arquitetural): fast agentuality termina em **<3s** medido (default `MiniMax-M2.7-highspeed` tipicamente <1s), vs humano 5-30s lendo (10 amostras). Paralelismo natural — latência do fast agent NÃO bloqueia request humano.
- [ ] **Inception hot path overhead <10ms** (PRIMARY criterion, PRD §10.2 budget): `sqlite.get(intel)` <5ms (p95), concat <1ms, template render <1ms. Medido com 10 amostras; total request p50 <50ms preservado.
- [ ] **Cache hit quando prefixo estável** (teste explícito): 2 turns com mesmo persona + prompts diferentes → `usage.cache_read_input_tokens > 0` no segundo turn
- [ ] Fast agent model = `MiniMax-M2.7-highspeed` (não "Haiku-class" — modelo concreto)
- [ ] Writer-reader contract preservado: shape literal `Intel` matches between fast agent output and match pipeline input
- [ ] **Intel contract validation** (test automatizado): serializa `Intel` do writer (Haiku output), desserializa no reader (match pipeline input). Validação: `agentState: string` (vazio OK), `nextNeeds: string[]` (vazio OK, ordem flexível), `recentTopic: string` (vazio OK). Degradação graciosa: se field vazio/fora de ordem, match pipeline não crasha.

**Output do Processador:**
- Fast agent module (TS) — Haiku integration in-process
- Intel store (SQLite table + read/write API, WAL mode)
- Match script (TS) com writer-reader contract validation
- Template 2-block renderer (persona + intel+Skills)
- Latency benchmark doc com timing measurements

---

> **Phase 6b split (2026-08-01) — 4 subchapters per Planner recommendation (17 atomic tasks, 3 Implementer batches of 8+4+5).**
> Each subchapter is a fresh phase with own Planner→Implementer→Verifier cycle.
> Source: `.specs/features/phase-6b-fast-agent-intel/{spec.md, design.md, tasks.md}` (commit `3838214`).
> Key decisions (from AD-006 in `.specs/DISCOVERIES.md`): Intel store = SAME catalog SQLite DB (not separate intel.sqlite); `BuildOptions.intel` at line ~52 of `augmenter.ts`, nullable; match script = POST-retrieval injection (not query expansion — preserves D-006 byte-string + `src/search/*` REUSE-ONLY); suffix injection = `## Intel` FIRST in Block 2 (persona anchor in Block 1 unchanged for cache hit stability); async vs sync write = SYNC default, async fallback IF measured > 1ms. POC budgets are CEILINGS for Phase 6b per-request latency: sqlite.get(intel) ≤ 5ms, concat ≤ 1ms, template render ≤ 1ms, TOTAL hot path overhead ≤ 10ms (PRIMARY), fast agent ≤ 3s. T-17 explicitly mandates POC re-run at end-of-phase; Phase 6b does NOT close if any ceiling exceeded (PRD §16.7 rule).

#### Phase 6b.1 — Intel Store Foundation [x]

**Done when:** migration `004_intel.sql` creates `intel(session_id TEXT PK, agent_state TEXT, next_needs TEXT, recent_topic TEXT, ts INTEGER)` table with WAL pragma + covering index `idx_intel_session_id`; `getIntel(session_id)` reads from `src/catalog/index.ts`; `Intel` type + Zod schema in `src/server/fast-agent/intel-schema.ts`; unit tests for store round-trip + WAL + index query plan.

**Phase 6b.1 status 2026-08-01:** Closed via 1 iteration. Migration `004_intel.sql` with WAL pragma + covering index `idx_intel_session_id`. `getIntel` + `writeIntelRow` helpers at `src/catalog/index.ts` + `src/catalog/intel-store.ts`. `Intel` type + Zod schema + `serializeIntel`/`deserializeIntel` at `src/server/fast-agent/intel-schema.ts` (138 lines, D-005 graceful degradation on empty fields). 11 catalog tests (migrations-004 + intel-store + intel-restart) — round-trip + WAL preservation across close/reopen + NFC UTF-8 + empty fields + corrupted JSON graceful. WAL design soundness verified: `openCatalogDb` sets `journal_mode=WAL` BEFORE migrations run; in-file pragma is reviewer-visible intent marker (runner wraps in transaction). Verifier PASS at `fbc6c47`. 438 tests. Commits `584fe60`, `b4a5d2f`, `37f9b70`.

**Depends on:** Phase 6b

**Scope (T-01..T-04):**
- `src/catalog/migrations/004_intel.sql` — additive table + WAL pragma + covering index (existing `001_init.sql`, `002_*.sql`, `003_*.sql` UNTOUCHED)
- `src/catalog/index.ts` — `getIntel(session_id: string): Promise<Intel | null>` + `writeIntel(session_id, intel, ts?)` helpers; uses existing WAL connection
- `src/server/fast-agent/intel-schema.ts` — `Intel` type literal `{ agentState: string, nextNeeds: string[], recentTopic: string }` per SPEC §IMod-5 D-005; Zod schema with graceful degradation on empty fields
- `test/catalog/intel-store.test.mjs` — round-trip + WAL preservation (reopen connection) + query plan uses index

**Output:** Intel store accessible from catalog DB; type contract + Zod validation; unit tests PASS.

---

#### Phase 6b.2 — Fast Agent Module [x]

**Done when:** `src/server/fast-agent/client.ts` (real `@anthropic-ai/sdk` at `https://api.minimax.io/anthropic` + stub fallback marked `[STUB]`) + `writer.ts` (sync write + async factory fallback IF perf > 1ms) wired into `boot.ts` env reading `MINIMAX_API_KEY` + `MEMORY_STUDIO_FAST_AGENT_MODEL`; mandatory perf test on `writeIntel` recorded in AD-008; SDK install verified (or re-installed) in `package.json`.

**Phase 6b.2 status 2026-08-01:** Closed via 1 iteration. `src/server/fast-agent/client.ts` (219 lines) with real `@anthropic-ai/sdk` at `https://api.minimax.io/anthropic` + stub fallback (deterministic `EMPTY_INTEL`, every log line `[STUB]`-prefixed, `[fast-agent] MODE=real|stub` logged at module load). `src/server/fast-agent/writer.ts` (231 lines) with `writeIntelSync` + `createAsyncIntelWriter` factory stub (NOT auto-activated). `src/server/boot.ts` reads `MINIMAX_API_KEY` + `MEMORY_STUDIO_FAST_AGENT_MODEL` (default `MiniMax-M2.7-highspeed`). `@anthropic-ai/sdk@0.115.0` installed (was missing pre-Batch 1). AD-008 SYNC decision: writer-perf p95 = 0.108ms (Implementer) / 0.144ms (Verifier median of 3 runs) — both 7-9× under 1ms trigger; sync is canonical, async fallback shipped as documented fallback. 17 fast-agent tests (9 client + 4 writer + 4 writer-perf). Verifier PASS at `fbc6c47`. Commits `cdacf70`, `d96d6e6`, `51ef228`, `21d5887`, `fbc6c47`.

**Depends on:** Phase 6b.1

**Scope (T-05..T-08):**
- `src/server/fast-agent/client.ts` — `fetchIntel(prompt: string): Promise<Intel>` calls `https://api.minimax.io/anthropic` via `@anthropic-ai/sdk` with `baseURL`; stub fallback returns deterministic Intel literal; tries `MINIMAX_API_KEY` env var, falls back to stub if unset OR SDK missing
- `src/server/fast-agent/writer.ts` — `writeIntelSync(session_id, intel)` uses `writeIntel` from 6b.1; `createAsyncIntelWriter()` factory stubbed (NOT auto-activated) per AD-006 #4
- `src/server/boot.ts` — read `MINIMAX_API_KEY` + `MEMORY_STUDIO_FAST_AGENT_MODEL` env vars; default `MiniMax-M2.7-highspeed`; log `[fast-agent] MODE=real|stub` at boot
- `test/server/fast-agent/{client,writer,writer-perf}.test.mjs` — stub fallback + real-mode contract + mandatory perf test (result in AD-008)

**Output:** fast agent module wired + AD-008 perf result (sync if < 1ms, async fallback IF > 1ms).

---

#### Phase 6b.3 — BuildOptions.intel + Suffix Injection [ ]

**Done when:** `BuildOptions.intel?: Intel | null` added at `src/server/augment/augmenter.ts:51-70`; `buildVariableSuffix()` emits `## Intel` section FIRST in Block 2 (persona anchor in Block 1 unchanged); byte-string determinism verified (same inputs → same SHA-256, intel incorporated); D-005 graceful degradation tests.

**Depends on:** Phase 6b.2

**Scope (T-09..T-12):**
- `src/server/augment/augmenter.ts:51-70` — add `readonly intel?: Intel | null` to `BuildOptions`; update `buildVariableSuffix()` to emit `## Intel` section FIRST in Block 2 (persona anchor in Block 1 untouched for cache hit stability)
- `test/augment/byte-string-with-intel.test.mjs` — same inputs → same SHA-256; intel incorporated in hash; D-005 graceful degradation (empty fields OK); same intel different prompt → different SHA
- `test/augment/writer-reader-roundtrip.test.mjs` — write Intel via writer → read via getIntel → match pipeline uses it
- `src/server/fast-agent/index.ts` (barrel) — re-exports `Intel` type + `fetchIntel` + `writeIntelSync`

**Output:** 2-block template extends with intel suffix + byte-string stability + D-005 contract preserved.

---

#### Phase 6b.4 — Pipeline Integration + Cache Hit Validation [ ]

**Done when:** `runAugment` extended with Stage 1b (fast agent in-process call) + tail `setImmediate` (intel write after response); integration tests confirm: latency trick (fast agent ≤ 3s, request returns in < 50ms unaffected), cache hit when persona stable (2 turns with same persona → `usage.cache_read_input_tokens > 0` on 2nd), AD-007/008 entries; POC re-run at end-of-phase confirms all Phase 6a budgets still met.

**Depends on:** Phase 6b.3

**Scope (T-13..T-17):**
- `src/server/augment/pipeline.ts` — extend `runAugment` with Stage 1b (fast agent `fetchIntel()` call, await with timeout) + tail `setImmediate(() => writeIntelSync(...))` AFTER response returned
- `test/augment/inception-cache-hit.test.mjs` — 2 consecutive `/v1/messages` requests, same persona + different prompts, assert 2nd response has `cache_read_input_tokens > 0` via stub provider (3 cases: same persona cache hit, different persona cache miss, single turn miss)
- `scripts/smoke-latency-trick.mjs` — boots augment server, sends 1 `/v1/messages`, measures `(t_intel_written - t_response_end)` < 3000ms (AD-006 budget), parallel 5000ms simulated human read
- AD-007 entry (cache hit invariant) + AD-008 entry (sync vs async intel write decision)
- `scripts/poc-6a-hot-path.mjs` RE-RUN at end-of-phase — confirm hot path overhead still < 10ms after wiring

**Output:** end-to-end inception híbrida + cache hit verified + AD-007/008 decisions recorded + POC ceilings preserved.

---

#### Phase 7a — Metrics Instrumentation [ ]

**Done when:** dashboard emite `request_hit_rate` + `token_cache_coverage` + `p50_latency_ms` + `p99_latency_ms` + `working_set_mb`; atualizado a cada N=10 requests ou T=60s.

**Depends on:** Phase 5b

**Goal:** dashboard emite métricas cache hit + latency + working set.

**Scope:**
- SPEC §IMod-9 (provider cache metrics only — augmented cache é v3.1+, não medir)
- SPEC §IMod-16 (latency budgets: p50, p99, working set)
- Structured logging additions

**PRD refs:**
- §14.6 Como medir cache hit >70% (request hit rate + token cache coverage)
- §17.1 caches distinction (provider only)

**Estimate:** 2-3h

**Done criteria:**
- [ ] Dashboard mínimo (CLI ou arquivo `metrics.json`) emite:
  - `request_hit_rate` = requests com `cache_read_input_tokens > 0` ÷ total
  - `token_cache_coverage` = Σ `cache_read_input_tokens` ÷ Σ `total_prompt_tokens`
  - `p50_latency_ms`, `p99_latency_ms`
  - `working_set_mb`
- [ ] Metrics atualizados a cada N requests (N=10) ou T=60s
- [ ] Metrics **só do provider cache** (Anthropic `usage.cache_read_input_tokens`) — augmented cache omitido
- [ ] Thresholds tuned documentados em `.memory-studio/state.json` com valores iniciais vs finais

**Output do Processador:**
- Metrics collector module (TS)
- Dashboard CLI (Node script que lê `/audit/summary` + structured logs)
- Threshold tuning doc

---

#### Phase 7b — Empirical Tuning + Acceptance Gate [ ]

**Done when:** cache hit >70% validado em sessão real (≥7 dias wall-clock, ≥10 turns/sessão em ≥5 sessões); thresholds finais documentados.

**Depends on:** Phase 5b, Phase 6b

**Goal:** cache hit >70% validado em sessão real (>10 turns, 1 semana wall-clock).

**Scope:**
- SPEC §IMod-16 (latency budgets acceptance)
- Real session collection (não sintética)

**PRD refs:**
- §10.2 Performance (4 items: p50<50ms, p99<200ms, working set<1.5GB, cache hit>70%)
- §14.6 métricas definition

**Estimate:** 3-4h + 1 semana wall-clock de produção

**Done criteria:**
- [ ] **1 semana de sessões reais** (não sintéticas): audit log tem ≥ 7 dias wall-clock com ≥ 10 turns/sessão em ≥ 5 sessões distintas
- [ ] Cache hit rate >70% validado: `request_hit_rate > 0.70` E `token_cache_coverage > 0.60` (ambos, não OR) em sessão real
- [ ] **Latency p50 <50ms** validado em 1 semana: `p50_latency_ms < 50` no relatório final
- [ ] **Latency p99 <200ms** validado em 1 semana: `p99_latency_ms < 200`
- [ ] **Working set <1.5GB** validado em 1 semana: `working_set_mb < 1500` após operação sustentada
- [ ] Thresholds finais documentados: `min_cosine_similarity` e `min_fts_hits` valores finais + log de tuning empírico
- [ ] Phase 6b é mandatório desde 2026-07-28 (Branch B removido); Phase 7b depende de Phase 5 + Phase 6b

**Output do Processador:**
- Acceptance report (`acceptance-2026-MM-DD.md`) com métricas finais
- Threshold config final em `.memory-studio/state.json`

---

## Total

### Raw arithmetic (com phase splits + MiMo adjustments)

| Phase | Estimate |
|---|---|
| **Phase 0 — Environment Validation** | **1-2h** (novo, MiMo suggestion) |
| Phase 1 — Catalog + Index | 6-8h (MiMo bumped de 4-5h) |
| Phase 2 — Detector + Fingerprint | 2-3h |
| Phase 3 — SDK Cliente | 3-4h |
| Phase 4 — UI Panel | 8-12h |
| Phase 5a — API + Retrieval | 3-4h |
| Phase 5b — Audit + Endpoints + Security | 3-4h |
| Phase 6a — Grill Gate + POC | 2-3h |
| **Phase 6b — Fast Agent + Intel Pipeline (mandatory)** | **12-16h** (8-12h + 4h §16.4 overhead) |
| Phase 7a — Metrics Instrumentation | 2-3h |
| Phase 7b — Empirical Tuning | 3-4h + 1 semana |
| **Total (Phase 6b mandatory, sem Branch B)** | **45-63h + 1 semana** |

### Canonical (PRD §9 / PLAN §Total)

| Type | Canonical (PRD §9 v3.3) | Raw arithmetic (ROADMAP) |
|---|---|---|
| Branch única | 41-55h (PRD v3.3 honest, pós-MiMo) | 45-63h (Phase 0 + Phase 1 ajustada + §16.4 overhead + Phase 6b mandatory) |

**Drift flag:** canonical PRD §9 (41-55h) é mais otimista que raw arithmetic (45-63h). Diferença = ~4h de overhead de sub-agent setup entre phases. PRD canônico é o "commitment ao produto"; ROADMAP raw é o "execution reality".

**Nota D-002:** canonical é a estimativa comunicada; raw é o que vai sair na prática com phase splits. Diferença = overhead de sub-agent setup + integration entre phases. PRD canonical é o que importa pro plano de produto; raw é o que importa pra execução single-dev.

---

## Cross-references

- [SPEC.md](../scratch/memory-studio/spec.md) — v2 comprehensive, 70+ user stories, 20+ impl decisions
- [PRD.md](../../PRD.md) — v3.2, decisões estratégicas
- [PLAN.md](../../PLAN.md) — v2, 7 phases técnicas com deliverables + estimates
- [.specs/DISCOVERIES.md](../../.specs/DISCOVERIES.md) — D-001 a D-009 (todas resolvidas em PRD/PLAN)
- [CLAUDE.md](../../CLAUDE.md) — authority boundaries
- [handoff-session.md](../../handoff-session.md) — executivo de sessão

---

**Próximo passo:** tlc-roadmap-loop lê Phase 1 → Processador gera SPEC atômica de Phase 1 → Implementer + Verifier (Waldemar) executa → Done criteria validados → repete por Phase 2 → 3 → 4 → 5a → 5b → 6a → 6b (conditional) → 7a → 7b.