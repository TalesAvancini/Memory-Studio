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

#### Phase 1.4 — build-index + Perf + API Schema Version [ ]

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

#### Phase 2 — Detector + Fingerprint [ ]

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

#### Phase 3 — SDK Cliente [ ]

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

#### Phase 5a — API + Retrieval + Byte-string [ ]

**Done when:** `/augment` smoke test com Claude Code; byte-string determinístico (SHA256); cache do provedor hit verificado em log; p50<50ms.

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

#### Phase 5b — Audit + Endpoints + Security [ ]

**Done when:** 5 auxiliary endpoints respondendo (catalog/catalog-rebuild/audit/audit-summary/health/state-toggle); audit async+fail-open; security invariants honrados.

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

#### Phase 6a — POC Validation (hot path + fast agent) [ ]

**Done when:** inception híbrida valida overhead hot path <10ms E fast agent <3s em 10 amostras; targets medidos, não estimados.

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