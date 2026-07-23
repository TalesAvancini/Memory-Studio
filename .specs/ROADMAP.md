# Roadmap: Memory Studio

> **Autonomous loop source of truth.** O `tlc-roadmap-loop` lê este arquivo a cada iteração pra escolher a próxima phase. Status = checkbox no fim do `####`.

---

## Hard dependency order

Follow the `Depends on:` lists below. Phases sem dependência rodam primeiro; phases com dependência esperam o(s) predecessor(es) virarem `[x]`.

---

#### Phase 1 — Setup [x]

**Phase slug:** `setup`
**Done when:** `npm test` roda em < 10s e exit 0; `tsc --noEmit` passa; `package.json` declara `type: module` + Node 22.

**Depends on:** none

- [x] `package.json` com `type: module`, `engines.node >=22`, scripts `test`/`test:smoke`/`typecheck`
- [x] `tsconfig.json` strict + `noUncheckedIndexedAccess`
- [x] `src/index.ts` placeholder (exporta `VERSION` + `placeholder()`)
- [x] `test/smoke.test.mjs` com 5 testes (ESM, `node:test` nativo)
- [x] `.gitignore` cobre `node_modules/`, `dist/`, `.env*`, `.claude/settings*.json`

---

#### Phase 2 — Schema + CRUD de skill [x]

**Phase slug:** `schema-and-crud`
**Done when:** CLI `npm run catalog:load <file.yaml>` lê um YAML de skill, persiste no `skills.sqlite`, gera embedding via ONNX, retorna ID da skill criada. Suite de testes do CRUD passa.

**Depends on:** Phase 1

- [x] Schema SQLite: tabela `skills` (id, slug, kind, content_yaml, embedding BLOB, hash, created_at, updated_at)
- [x] Schema SQLite: tabela `audit_events` (id, ts, tenant_hash, event_type, payload)
- [x] Loader YAML com validação (kind ∈ {skill, rule, persona})
- [x] Writer SQLite (insert/update idempotente por hash do YAML)
- [x] Embedder ONNX via `embedding-model` (multilingual-e5-small, 384d) — stub determinístico (real ONNX Phase 9)
- [x] CLI `npm run catalog:load <path>` funcional
- [x] Testes unitários: schema, loader, writer, embedder (≥ 4 testes, coverage 80%)

---

#### Phase 3 — Detector social [x]

**Phase slug:** `social-detector`
**Done when:** Função `isSocial(prompt)` retorna `true` para "oi", "valeu", "obrigado", "thanks", "bye"; retorna `false` para prompts técnicos. Testes cobrem ≥ 20 padrões regex.

**Depends on:** Phase 1

- [x] Regex de bypass social (saudação, agradecimento, despedida, smalltalk)
- [x] Função `isSocial(prompt: string): boolean` em `src/social-detector/`
- [x] Whitelist de "false positives" (ex: "thanks" como verbo em contexto técnico)
- [x] Testes: ≥ 20 casos cobrindo PT-BR + EN + edge cases
- [x] Integração com hook do augmenter (interface limpa, sem side-effects)

---

#### Phase 4 — Search / retrieval [ ]

**Phase slug:** `search`
**Done when:** `POST /search {q: "como debugar React", k: 5}` retorna até 5 skills rankeadas por RRF (combina FTS5 + sqlite-vec). Threshold duplo respeitado.

**Depends on:** Phase 2

- [ ] Schema FTS5 virtual table indexando `content_yaml`
- [ ] Schema sqlite-vec para embeddings (384d)
- [ ] Query FTS5 com `bm25(content_fts)`
- [ ] Query vec com `sqlite-vec` (k-NN)
- [ ] Fusão RRF (Reciprocal Rank Fusion) combinando os dois rankings
- [ ] Threshold duplo: `min_cosine_similarity` (vector) + `min_fts_hits` (FTS5)
- [ ] Função `search(query: string, k: number): RankedSkill[]` em `src/search/`
- [ ] Testes: corpus seed (≥ 10 skills), asserts de ranking, asserts de threshold
- [ ] Cross-encoder local opcional pra rerank (v0 do MVP)

---

#### Phase 5 — System message builder [ ]

**Phase slug:** `system-message-builder`
**Done when:** Função `buildAugmentedMessage(prompt, skills)` retorna string do system message com `cache_control: ephemeral` no bloco injetado, byte-string determinístico por (tenant, skills selecionadas).

**Depends on:** Phase 2, Phase 4

- [ ] Template do system message (persona + skills + rules) — formato estruturado
- [ ] Componente `cache` (byte-string determinístico + sha256) — entrada do cache é `(tenant_id, sorted_skill_hashes, prompt_kind)`
- [ ] Função `buildAugmentedMessage(prompt, rankedSkills, persona, rules)` em `src/augmenter/`
- [ ] Integração com `social-detector` (se social, retorna system message sem skills)
- [ ] Output marca `cache_control: ephemeral` no bloco injetado
- [ ] Testes: determinismo (mesmo input → mesmo byte-string), social bypass, threshold fail (sem skills retorna vazio)

---

#### Phase 6 — Forwarder + agent adapters [ ]

**Phase slug:** `forwarder`
**Done when:** `POST /augment {prompt}` recebe o system message aumentado e encaminha pro provedor de LLM real (Anthropic-compatible), devolve resposta. Suporta 3 modos: proxy (custom baseURL), hook (chamada explícita), MCP-v2 (tool).

**Depends on:** Phase 3, Phase 5

- [ ] Server Fastify boot em `127.0.0.1:7788` com rotas: `POST /augment`, `POST /search`, `GET /health`
- [ ] Adapter proxy: cliente LLM (Anthropic-compatible) que injeta system message e encaminha
- [ ] Adapter hook: handler explícito que retorna só o system message (pro agente injetar)
- [ ] Adapter MCP-v2: tools `memory_augment`, `memory_search` (estrutura JSON-RPC)
- [ ] Logger estruturado pino (JSON, uma linha por evento, sem conteúdo de prompt)
- [ ] `tenant_id` hasheado (sha256[0:16]) no audit log
- [ ] Testes: e2e proxy com LLM mock, e2e hook, smoke MCP-v2

---

#### Phase 7 — UI mínima [ ]

**Phase slug:** `ui`
**Done when:** UI HTML/HTMX em `GET /` permite listar skills ativas, ligar/desligar, ver audit log paginado, editar settings (thresholds, tenant_id).

**Depends on:** Phase 6

- [ ] Rota `GET /` retorna HTML com HTMX (zero build step)
- [ ] Página "Skills": lista, toggle on/off, busca
- [ ] Página "Audit": tabela paginada (eventos, timestamp, tenant_hash)
- [ ] Página "Settings": editar `min_cosine_similarity`, `min_fts_hits`, tenant_id
- [ ] Audit log também recebe ações da UI (toggle, settings change)
- [ ] Testes: smoke render das 3 páginas, asserts de mutação

---

#### Phase 8 — Migration de skills built-in [ ]

**Phase slug:** `migration-builtin-skills`
**Done when:** Script `npm run catalog:migrate-builtins` popula o `skills.sqlite` com as ~19 skills do Mavis no schema novo. Verificação: `SELECT count(*) FROM skills` retorna ≥ 19, todas com embedding.

**Depends on:** Phase 2

- [ ] Inventário das skills built-in (lista manual baseada no Mavis)
- [ ] Conversão YAML (formato Memory Studio) pra cada built-in
- [ ] Script de migração idempotente (re-roda sem duplicar)
- [ ] Validação pós-migração: contagem, embedding presente, FTS5 indexado
- [ ] Testes: dry-run mode, contagem final ≥ 19

---

#### Phase 9 — Teste + tuning [ ]

**Phase slug:** `test-and-tuning`
**Done when:** Coverage ≥ 80% em `src/`. Suite integration (`npm run test:integration`) sobe SQLite + ONNX real. Suite e2e (`npm run test:e2e`) cobre 3 cenários proxy/hook/MCP. Waldemar pré-cond #1 mantida (npm test < 10s).

**Depends on:** Phase 7

- [ ] Coverage report (`c8` ou nativo) ≥ 80% em `src/`
- [ ] Suite integration: SQLite in-memory + ONNX real, sem mocks
- [ ] Suite e2e: 3 cenários (proxy, hook, MCP-v2) com agente mock
- [ ] Tuning de thresholds: dataset sintético (≥ 50 prompts), mede precision/recall
- [ ] Performance: `GET /augment` p50 < 50ms, p99 < 200ms
- [ ] Documentação em `README.md`: install, run, modos, exemplos

---

**Status legend:** `[ ] pending · [~] in progress · [x] done`
