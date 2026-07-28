---
date: 2026-07-27
version: 2
status: ready-to-build
revision: 2 (2026-07-27) — revisão crítica PLAN.md aplicada (17+5 findings de `critica-plan.md`). Aceitos: PLAN-C1 nuance (Phase 3 = consumido externo), C2 (Phase 4 pre-reqs Phase 5), C3 (retrieval em Phase 1 build + Phase 5 query), C4 (inception gated), C5/C6 (nota hook/MCP deferred), C7 (total 35-50h), H1 (cross-ref schema SQLite v1), H2 (cacheHit cross-ref §17.1), H3 (Phase 7 reword), H4 (FTS5/vec explícito), H5 (detector proveniência v1→v3), H6 (Phase 5 done criteria), M2 (schema versioning policy), M3 (byte-string Phase 5 vs prefix-intacto Phase 6 split). Recusados: PLAN-M1 (single-dev sequence já claro), PLAN-L1 (8-12h honesto).
description: "Memory Studio — plano de implementação em fases. Companion da PRD.md (decisões). Cada fase com pre-reqs, deliverables, dependencies, estimate."
explanation: |
  PLAN.md é o companion de implementação da PRD.md.

  - **PRD.md** = O QUÊ. Decisões com justificativa "por que X e não Y".
  - **PLAN.md** = COMO e QUANDO. Sequência de phases, deliverables, estimates.

  Origem: 2026-07-26, junto com PRD v3. Antes era um único doc; separação
  reflete a regra operacional: PRD não muda com frequência (decisões
  estáveis), PLAN muda a cada phase (refinamento de granularidade).

  Estimativas incluem erro, logging estruturado, e 1 round de tuning
  empírico. v1 (PRD) subestimou; este plano não repete o erro.

  Phase 6 (Fast agent + intel pipeline) é a peça NOVEL de v3. Aguarda
  grill em PRD §16.6 antes de iniciar implementação.
related:
  - PRD.md
  - critica-plan.md
  - CLAUDE.md
  - handoff-session.md
---

# Memory Studio — Plano de Implementação

**Data:** 2026-07-26
**Versão:** 1
**Companion:** [PRD.md](PRD.md) — decisões (O QUÊ). Este arquivo: phases (COMO e QUANDO).

---

## Como ler esse plano

Phases em ordem. Cada phase tem:

- **Pre-reqs:** o que precisa estar pronto antes
- **Deliverables:** o que sai no fim
- **Depends-on:** outras phases que dependem dessa
- **Estimate:** tempo single-dev (inclui erro, logging, 1 round de tuning)
- **Por que X e não Y:** justificativa arquitetural (cross-ref PRD quando aplicável)

**Total estimado:** **35-50h single-dev** (consistente com PRD §9). PRD v3.1 prometeu "30-40h" mas soma direta das phases dá 34-49h — v3.2 corrige pra 35-50h honesto.

**Modos de integração cobertos:** só **proxy transparente (MVP)**. Hook e MCP são v3.1+ per PRD §14.3 + §11. PLAN não inclui phases pra eles — deferidos explicitamente.

**Inception híbrida:** arquitetura capturada em PRD §16. Phase 6 do PLAN gated por grill §16.6. PRD §10.1 marca o critério como CONDICIONAL.

---

## Sequência (resumo)

```
                    ┌──> Phase 3 (SDK)
                    │
Phase 1 ──┬──> Phase 2 ──┐         ┌──> Phase 6 (Fast agent) ──┐
          │              │         │                            │
          │              ├─────────┴──> Phase 5 (Proxy) ───────┴──> Phase 7 (Tuning)
          │              │                       │
          └──> Phase 4 (UI) ─────────────────────┘
```

**Paralelização:** Phase 4 (UI) e Phase 5 (Proxy) podem rodar em paralelo com 2 devs. **Single-dev: sequencial** (1 → 2 → 3 → 4 → 5 → 6 → 7). Phase 4 antes de Phase 5 só com mocks do servidor (ver Phase 4 pre-reqs).

**Note sobre Phase 3 (SDK):** Phase 3 é **consumida por agentes externos** (Claude Code etc.), não por outras phases internas. SDK tem Phase 2 como pre-req de tipos (fingerprint schema), mas nenhuma phase interna depende de Phase 3 — não é "floating", é track de entrega.

---

## Phase 1 — Schema + Catálogo

**Pre-reqs:** nenhum.

**Deliverables:**

- Schema YAML pra Skill, Rule, Persona (PRD §6)
- **Schema SQLite do catálogo** (tabelas `catalog`, `embeddings`, `audit_events`)
- **Schema FTS5** (full-text search sobre `text` de cada item)
- **Tabela sqlite-vec** (vetores 384d, multilingual-e5-small)
- Loader de YAML → SQLite (popula catalog + embeddings + FTS5 + vec)
- Embedding pipeline (multilingual-e5-small, ONNX, 384d)
- Command `npm run build-index` regenera embeddings e índices
- Schema versioning policy (catalog versionado em git + `schemaVersion` no API)
- ~19 skills built-in migradas do Mavis

**Cross-ref schema SQLite:** schema v1 (calibração) reside em `.specs/archive/2026-07-calibration/STATE.md`. Phase 1 revisa e migra — **NÃO** inventa schema do zero. Invariante sólida mantida.

**Depends-on:** nenhuma (foundation).

**Estimate:** 3-4h.

**Por que X (SQLite + FTS5 + sqlite-vec) e não Y (Qdrant/Pinecone):**

- X: invariante sólida de v1 (benchmark independente mostrou que SQLite vence na escala nossa).
- Y: vendor lock-in, requer serviço externo.
- Y é descartado.

---

## Phase 2 — Detector social + fingerprint

**Pre-reqs:** Phase 1.

**Deliverables:**

- Detector social (regex, ignora prompts tipo "oi", "valeu")
- Fingerprint 4-componente: projectPath, agentId, sessionId (hasheado), gitBranch
- Hashing/redaction básico (sha256[0:16] pra tenantId/sessionId)
- Audit log schema (estrutura, sem fill ainda)

**Proveniência:** Detector social, fingerprint 4-componente, e hashing básico são **promovidos de v1 phases 0-4 (calibração)** pra produção. Phase 2 **NÃO** implementa do zero — revisa código de calibração, ajusta pro escopo v3, e move pro source tree principal. Invariante sólida de v1 mantida.

**Depends-on:** Phase 1.

**Estimate:** 2-3h.

**Por que X (regex) e não Y (LLM classifier):**

- X: invariante de v1, zero LLM no hot path.
- Y: adiciona latency, viola regra "sem LLM no hot path".

---

## Phase 3 — SDK cliente

**Pre-reqs:** Phase 2.

**Deliverables:**

- Pacote `@memory-studio/sdk` (TypeScript, ~50KB, zero deps nativas)
- `collectContext()`: scratch, todos, recentFiles, lastEvent
- `fingerprint()`: 4-componente
- `MemoryStudioClient`: chamada `/augment`
- Modo prompt-only (v1 compat) funciona sem contexto
- Hardcoded `agentId = "claude-code"` (MVP)

**Depends-on:** Phase 2.

**Estimate:** 3-4h.

**Por que X (novo SDK) e não Y (modificar agente):**

- X: portabilidade entre agentes (Claude Code, Aider, Cline, etc. depois).
- Y: acoplaria Memory Studio a 1 agente específico.
- Y é descartado.

---

## Phase 4 — UI painel

**Pre-reqs:** Phase 1 (schema + loader).

**Pre-reqs condicionais:**

- **Modo A — com mocks:** Phase 1 + interface mock do servidor. UI funciona mas Audit/Settings são stub. Útil pra single-dev que quer ver UI antes de Phase 5.
- **Modo B — com servidor real:** Phase 1 + Phase 5 (proxy). Audit e Settings mostram dados reais.

**Recomendação:** Modo B. UI sem dados reais é inerte (Audit vazio, Settings stub). Single-dev faz Phase 5 antes de Phase 4 — ordem sequencial 1 → 2 → 3 → 5 → 4 → 6 → 7.

**Deliverables:**

- Painel em `http://127.0.0.1:<porta-livre>/ui`
- 5 telas: Skills, Rules, Personas, Audit, Settings (PRD §4)
- Layout: colunas (Skills/Personas/Rules), busca, janela lateral pra leitura
- State em `.memory-studio/state.json` por projeto
- Critical Rules com aviso visual
- Stack: HTMX+Alpine (PRD §14.1)

**Depends-on:** Phase 1.

**Estimate:** 8-12h.

**Por que X (HTMX+Alpine) e não Y (Svelte/Tauri):**

- Constraints do humano: colunas + busca + janela lateral.
- X: alinha com v1 (Node-only), zero build extra.
- Svelte v3.1+ se virar foco do produto.
- Tauri v3.1+ se fricção de "abrir tab no browser" incomodar.

**Paralelização:** pode rodar em paralelo com Phase 5 (devs diferentes, ou single-dev sequencial).

---

## Phase 5 — Proxy transparente

**Pre-reqs:** Phase 1, 2.

**Deliverables:**

- Forwarder HTTP: recebe request do agente, augmenta, encaminha pro provedor real
- **Retrieval pipeline em runtime:** query FTS5 + sqlite-vec → RRF fusion → threshold duplo (`min_cosine_similarity` + `min_fts_hits`) → top-K candidatos. Schema do índice vem de Phase 1.
- System message augmenté: 2 blocos `cache_control: ephemeral` (persona + Skills)
- **Byte-string determinístico do input completo** (mesma input → mesma saída byte-a-byte). **Sem garantia cross-turn** do prefixo intacto — isso é deliverable de Phase 6.
- Response struct com `pruningDecisions` (5 razões). `cacheHit` da response é v3.1+ (omitido no MVP) — **métrica de cache hit MVP é via log estruturado** (PRD §17.1 + §14.6), NÃO pelo campo da response.
- Audit log preenchido
- Structured JSON logging de `usage.cache_read_input_tokens` por request (PRD §14.6)

**Done criteria (smoke test antes de Phase 6):**

- [ ] Smoke test end-to-end com Claude Code via custom baseURL (PRD §13)
- [ ] Byte-string determinístico validado: mesma input → mesmo SHA256 do system message
- [ ] Cache hit do provedor verificado em log: `cache_read_input_tokens > 0` em 2 requests seguidos com mesmas Skills ativas
- [ ] Retrieval retorna top-K com hit no índice (FTS5 + sqlite-vec)
- [ ] Audit log gravado com prompt redactado + matched IDs + pruning reasons
- [ ] `usage.cache_read_input_tokens` logado por request

**Gating:** Phase 6 (Fast agent) **NÃO começa** sem smoke test verde.

**Depends-on:** Phase 1, 2.

**Estimate:** 5-7h.

**Por que X (proxy) e não Y (hook):**

- X preserva cache melhor (controle byte-a-byte).
- Y adiciona dependência no agente.
- Y é fallback.

---

## Phase 6 — Fast agent + intel pipeline (NOVEL)

**Pre-reqs:** Phase 5.

**Deliverables:**

- Fast agent (Haiku-class) que lê response em paralelo com humano
- Intel store (arquivo ou unix socket)
- Scripts de match e qualification sobre (intel + prompt + context + catalog)
- Suffix injection no system message, prefix intacto
- Latency budget: <100ms P50, <300ms P99
- Validação do latency trick (fast agentuality termina antes do humano digitar próximo turn)

**Depends-on:** Phase 5.

**Estimate:** 8-12h.

**Status:** **pré-grill em PRD §18.6 antes de iniciar.** Esta é a peça NOVEL do v3.

**Por que X (fast-agent-over-response) e não Y (sem pre-fetch):**

- X: latency trick escondido na leitura humana. Diferencial competitivo.
- Y: prompt + state clássicos, sem otimização de latency.
- Y v3.1+ se virar fricção.

**Por que X (Haiku) e não Y (Sonnet/Opus):**

- X: custo, latency, suficiente pra intel pattern matching.
- Y: overkill pra tarefa de extração de intel.

**Engineering decisions (PRD §18.4):**

| Decisão | Trade-off |
|---|---|
| Fast agent: in-process vs sidecar | Latency vs isolation |
| Intel: file vs unix socket | Reliability vs speed |
| Match: regex vs catalog vs embedding | Speed vs precision |
| Suffix injection: template vs raw concat | Cache hit vs flexibility |
| Prefix stability N→N+1 | Core do produto |

**Critério de done (PRD §10.1):**

- [ ] Turn N vai plain (sem augmentação)
- [ ] Fast agent lê R_N em paralelo com humano
- [ ] Turn N+1 augmenta com (intel + prompt + catalog)
- [ ] Cache hit quando prefixo estável
- [ ] Latency trick validado: fast agentuality termina antes do humano digitar

---

## Phase 7 — Tuning empírico

**Pre-reqs:** Phase 5, 6.

**Deliverables:**

- Dashboard mínimo (CLI ou arquivo) com métricas:
  - Request hit rate (`cache_read_input_tokens > 0` / total)
  - Token cache coverage (`Σ cache_read_input_tokens / Σ total_prompt_tokens`)
- 1 semana de sessão real, ajuste de thresholds (min_cosine_similarity, min_fts_hits, persona cap)
- Critério de aceitação (PRD §10.2): cache hit > 70%

**Depends-on:** Phase 5, 6.

**Estimate:** 5-7h de trabalho + 1 semana wall-clock de coleta de dados de produção (sessões reais).

**Por que X (CLI/arquivo) e não Y (Grafana/Prometheus):**

- X: zero setup, alinhado com Node-only.
- Y: adiciona stack de observability, quebra invariante.
- Y v3.1+ se virar dashboards necessários.

---

## Total

| Phase | Estimate |
|---|---|
| 1 — Schema + Catalog (incl. FTS5, sqlite-vec, schema versioning) | 4-5h |
| 2 — Detector + fingerprint (promoção v1→v3) | 2-3h |
| 3 — SDK | 3-4h |
| 4 — UI | 8-12h |
| 5 — Proxy (incl. retrieval runtime + done criteria) | 6-8h |
| 6 — Fast agent (NOVEL, gated por grill) | 8-12h |
| 7 — Tuning (5-7h trabalho + 1 semana coleta) | 5-7h |
| **Total** | **36-51h (honesto: 35-50h)** |

**Por que 35-50h e não 30-40h (PRD §9 v3.1):** soma direta das phases dá 36-51h. PRD v3.1 prometeu 30-40h — promessa furada. v3.2 corrige pra 35-50h, mantendo o mesmo perfil (single-dev, inclui erro, logging, 1 round de tuning empírico).

---

## Acceptance criteria mapping (PRD §10 → phases)

> **Origem:** relatório de cobertura 2026-07-27 identificou §10 (22 checkboxes) com ~30% mapeamento. Esta tabela fecha o gap: cada item §10.x → phase que entrega → onde valida.

### §10.1 Funcional (11)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | Lê prompt + estado (scratch, todos, recentFiles, lastEvent) | Phase 3 (SDK coleta) + Phase 5 (proxy recebe) | Phase 5 done (smoke test) |
| 2 | Top 3-5 skills/rules/personas identificados | Phase 5 (retrieval + match) | Phase 5 done |
| 3 | System message byte-string determinístico | Phase 5 | Phase 5 done (SHA256) |
| 4 | `cache_control: ephemeral` em 2 blocos | Phase 5 | Phase 5 done |
| 5 | Cache hit verificado via log | Phase 5 (logging) + Phase 7 (mede) | Phase 7 |
| 6 | UI mostra catálogo + toggle por projeto | Phase 4 | Phase 4 done |
| 7 | Critical Rules: aviso visual + imunes a toggle off | Phase 4 (UI) + Phase 5 (server enforça) | Phase 4 done |
| 8 | Audit log grava tudo (prompt redactado + matched IDs + pruning + latência) | Phase 5 | Phase 5 done |
| 9 | Modo prompt-only funciona (v1 compat) | Phase 3 (SDK: `context: null`) | Phase 5 done |
| 10 | Funciona com 1 agente (Claude Code) | Phase 5 (proxy testado com Claude Code) | Phase 5 done (smoke test) |
| 11 | Inception híbrida (CONDICIONAL grill §16.6) | Phase 6 | Phase 6 done |

### §10.2 Performance (4)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | p50 latência < 50ms | Phase 5 (proxy) | Phase 7 (1 semana real) |
| 2 | p99 latência < 200ms | Phase 5 (proxy) | Phase 7 |
| 3 | Working set < 1.5GB RAM | Phase 5 (deploy) | Phase 7 |
| 4 | Cache hit rate > 70% (>10 turns) via log | Phase 7 (mede + ajusta) | Phase 7 done |

### §10.3 Segurança / Privacidade (4)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | Zero persistência de contexto raw | Phase 2 (SDK redacta) + Phase 5 (audit redacta) | Phase 5 done |
| 2 | `tenantId` hasheado | Phase 2 (sha256[0:16]) + Phase 5 (logging) | Phase 5 done |
| 3 | Placeholders determinísticos não vazam secret | Phase 5 (template substitui) | Phase 5 done |
| 4 | Nenhum dado sai da máquina (proxy local only) | Phase 5 (deploy local) + Phase 4 (UI localhost) | Phase 5 done |

### §10.4 Operacional (3)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | `npm run build-index` < 60s pra 100 skills | Phase 1 | Phase 1 done |
| 2 | UI carrega < 1s local | Phase 4 | Phase 4 done |
| 3 | Audit query < 100ms pra 30 dias | Phase 5 (audit schema) + Phase 7 (valida) | Phase 7 |

**Cobertura:** 22/22 = 100% mapeados. Gaps de **validação** (medir de fato) ficam pras phases correspondentes — não há gap de **ownership** (toda checkbox tem phase que entrega + phase que valida).

---

## Cross-references

- [PRD.md](PRD.md) — decisões + justificativas
- [CLAUDE.md](CLAUDE.md) — authority boundaries
- [handoff-session.md](handoff-session.md) — estado executivo da sessão

---

## Regra operacional

> **Não começar Phase 6 sem grill em PRD §18.6.** Phase 1-5 podem começar antes (com ground truth de PRD §14).

> **Não começar Phase 6 sem smoke test de Phase 5** (proxy funciona end-to-end com Claude Code).

> **Não cotar Phase 7 sem 1 semana de dados reais** (tuning empírico é tuning empírico).
