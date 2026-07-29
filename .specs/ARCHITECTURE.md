# Memory Studio — Arquitetura (Farol)

**Fonte canônica:** [`.specs/architecture/memory-studio.architecture.json`](architecture/memory-studio.architecture.json)
**Renderização:** [`.specs/architecture/memory-studio.html`](architecture/memory-studio.html)
**Versão:** PRD v3.4 · PLAN v3 · SPEC v2 · ROADMAP v5 · 9/9 discoveries resolvidas

> **Escopo deste farol.** Apenas runtime do Memory Studio. Meta-tools (`tlc-roadmap-loop`, `auto-grill`, `archify`, `Planner`) vivem em `.claude/skills/` e **NÃO** aparecem no farol do produto.

---

## Dual consumption

| Consumidor | Arquivo | Modo de leitura |
|---|---|---|
| **Sub-agente LLM** (Implementer, Verifier, auto-grill) | **este `.md`** | Texto puro, parseável, com stable IDs cruzados |
| **Humano** (revisão periódica, re-render) | [`.specs/architecture/memory-studio.html`](architecture/memory-studio.html) | Visual interativo (archify render, dark/light) |

**Implicação prática:** Implementer/Verifier **nunca** "abre no browser" para inspecionar o farol. Eles leem este arquivo. A interatividade visual é privilégio do humano.

---

## Módulo 1 — External (boundary human/machine)

Quem está fora do sistema. Boundary human/machine.

| Stable ID | Label | Sublabel | Tipo | Função |
|---|---|---|---|---|
| `human` | Human | operator | external | Operator — revisa toggles em `state.json` |
| `agents` | Agents | Claude Code (MVP) · v3.1+: Aider, Cursor | external | Coding agents consumidores; MVP = Claude Code only |
| `minimax-api` | MiniMax API | Anthropic-compatible | external | Provider LLM (`https://api.minimax.io/anthropic`) |

**Conexões:**
- `human → agents` (prompts)

---

## Módulo 2 — Phase 0 — Environment Validation

Pré-requisito de Phase 1 (gate de 1-2h via `scripts/verify-env.mjs`).

| Stable ID | Label | Sublabel | Tipo | Função |
|---|---|---|---|---|
| `node22` | Node 22 LTS | runtime ESM | cloud | Runtime host (worker_threads habilitado) |
| `sqlite-ext` | SQLite FTS5+vec | extensões compiladas | cloud | Extensões SQLite compiladas e carregáveis |
| `onnx-rt` | ONNX Runtime | onnxruntime-node | cloud | Inference runtime (OS-specific build) |

**Conexões:**
- `node22 → sqlite-ext` (host process)
- `sqlite-ext → onnx-rt` (host process)
- `agents → sqlite-ext` (host process transit — agentes rodam no Node)
- `sqlite-ext → sdk` (transit)

---

## Módulo 3 — Hot Path (síncrono, p50<50ms)

O caminho quente que bloqueia o humano. Tudo dentro do budget <50ms p50, com overhead de inception híbrida <10ms (PRD §10.2).

| Stable ID | Label | Sublabel | Tipo | Tag | Função |
|---|---|---|---|---|---|
| `ui-panel` | UI Panel | HTMX + Alpine | frontend | control | Painel localhost com 5 telas (toggle state, catalog, audit, metrics, intel) |
| `sdk` | @memory-studio/sdk | TS · ~50KB · zero deps | backend | client | SDK cliente TS (zero deps) — coleta context, chama `/augment` |
| `fast-agent` | Fast Agent | MiniMax-M2.7-highspeed in-process | backend | P6 ⚡ | Fast agent in-process; lê R_N em paralelo com humano (ramo B da inception híbrida) |
| `state-toggle` | /state/toggle | POST endpoint | backend | endpoint | Endpoint de toggle state com critical_confirm enforcement |
| `server` | Server | Fastify · 7 ep | backend | edge | Edge HTTP; Fastify com 7 endpoints expostos |
| `intel-store` | Intel Store | `{agentState,nextNeeds,recentTopic}` | database | P6 ⚡ | Tabela SQLite WAL; persiste Intel entre restarts |
| `state-json` | state.json | git-tracked | database | git | `.memory-studio/state.json` — toggle state versionado em git |
| `audit-buffer` | Audit Buffer | async+batch+fail-open | backend | D-007 | Buffer de auditoria assíncrono, batch flush, fail-open |
| `match-script` | Match Script | intel+prompt+catalog | backend | P6 | Script que combina Intel + prompt + catalog no template 2-block |

**Endpoints expostos pelo Server (7 total):**
`/augment` · `/catalog` · `/catalog/rebuild` · `/audit` · `/audit/summary` · `/health` · `/state/toggle`

**Conexões internas do Hot Path:**
- `ui-panel → state-toggle` (toggle UI)
- `fast-agent → intel-store` (write Intel)
- `sdk → server` (**POST /augment**)
- `state-toggle → state-json` (write toggle)
- `intel-store → match-script` (read Intel — ramo B)
- `server → fast-agent` (forward augmented)
- `fast-agent → minimax-api` (call provider — in-process, não daemon)
- `minimax-api → fast-agent` (read R_N — paralelismo ramo B)
- `augmenter → audit-buffer` (log retrieve — D-007 fail-open)
- `match-script → augmenter` (suffix inject)

---

## Módulo 4 — Pipeline (retrieval core)

Camada fria/semi-fria de retrieval. Executada por turno (cache hit não bloqueia humano depois do primeiro).

| Stable ID | Label | Sublabel | Tipo | Tag | Função |
|---|---|---|---|---|---|
| `augmenter` | Augmenter | byte-string · 2-block | backend | core ⚡ | Componente core: monta system message aumentado (byte-string determinístico, 2-block cache_control:ephemeral) |
| `search` | Search | FTS5+vec+RRF D-006 | backend | core ⚡ | Retrieval híbrido: FTS5 + vec + RRF + tiebreak ordering (D-006) |
| `social-detector` | Social Detector | regex bypass | backend | guard | Detector de tentativas de driblar o catálogo via prompt (v1 promoted) |
| `catalog` | Catalog | YAML→SQLite+embed | backend | ingest | Ingestão: parseia YAML, persiste, gera embeddings (cold path) |
| `cache` | Cache | SHA256(byte-string) | backend | hot | Cache determinístico por SHA256 do byte-string |
| `fts5-vec` | FTS5+vec | search engine | database | engine | Search engine combinado (FTS5 + sqlite-vec) |

**Conexões internas do Pipeline:**
- `augmenter → search` (retrieve candidates)
- `search → social-detector` (guard)
- `augmenter → cache` (lookup SHA256)
- `search → cache` (write through)
- `cache → fts5-vec` (FTS5+vec query)
- `catalog → sqlite` (ingest YAML — cold path)
- `catalog → embed-model` (compute embeddings — cold path)

---

## Módulo 5 — Storage (runtime data)

Persistência runtime. Cold path (build-index) + hot path (queries).

| Stable ID | Label | Sublabel | Tipo | Tag | Função |
|---|---|---|---|---|---|
| `sqlite` | SQLite | catalog+audit+intel | database | data | Tabelas: catalog + audit_events + intel |
| `embed-model` | Embedding Model | multilingual-e5-small ONNX 384d | cloud | ONNX | Modelo ONNX local; embeddings 384d |
| `catalog-yaml` | Catalog YAML | `config/catalog/<id>.yaml` | external | versioned | Catálogo versionado em git; fonte do conhecimento |

**Conexões internas do Storage:**
- `fts5-vec → sqlite` (vector query)
- `sqlite → embed-model` (lookup embeddings)
- `embed-model → catalog-yaml` (read YAML)
- `catalog-yaml → sqlite` (load cold via waypoint `via`)

---

## Conexões inter-módulo (fluxo canônico)

### Hot path (bloqueia humano, budget <50ms p50)

```
agents → sqlite-ext → sdk → server → fast-agent → minimax-api
                                              ↑          ↓
                                       (read R_N)  (in-process call)
                                              ↓          ↓
                                       intel-store   (stream response)
                                              ↓
                                       match-script (suffix inject → augmenter)
                                              ↓
                                         server ← response
```

### Cold path (build-index)

```
catalog-yaml → sqlite (ingest YAML)
catalog → embed-model (compute embeddings)
catalog → sqlite (write rows)
```

### Audit (D-007, async + fail-open)

```
augmenter → audit-buffer → sqlite (batch flush)
```

---

## Regiões (boundaries)

| Região | Wraps (Stable IDs) |
|---|---|
| **Módulo 1 — External** | `human`, `agents`, `minimax-api` |
| **Módulo 2 — Phase 0** | `node22`, `sqlite-ext`, `onnx-rt` |
| **Módulo 3 — Hot Path** | `ui-panel`, `sdk`, `fast-agent`, `state-toggle`, `server`, `intel-store`, `state-json`, `audit-buffer`, `match-script` |
| **Módulo 4 — Pipeline** | `augmenter`, `search`, `social-detector`, `catalog`, `cache`, `fts5-vec` |
| **Módulo 5 — Storage** | `sqlite`, `embed-model`, `catalog-yaml` |

---

## Decisões travadas refletidas no farol

| Decisão | Onde aparece no farol |
|---|---|
| **MiniMax-M2.7-highspeed** (não Anthropic Haiku) | `fast-agent` sublabel |
| **Fast agent in-process** (não daemon) | `fast-agent` sublabel |
| **2-block cache_control:ephemeral** | `augmenter` sublabel |
| **Schema intel `{agentState,nextNeeds,recentTopic}`** | `intel-store` sublabel |
| **FTS5 + vec + RRF + tiebreak (D-006)** | `search` sublabel |
| **Social Detector regex bypass (v1 promoted)** | `social-detector` sublabel |
| **D-007 audit async + batch + fail-open** | `audit-buffer` sublabel + tag |
| **Catalog YAML versionado em git** | `catalog-yaml` sublabel + tag |
| **Multilingual-e5-small ONNX 384d** | `embed-model` sublabel |
| **MVP = Claude Code only** | `agents` sublabel |
| **7 endpoints total** | `server` sublabel |
| **Phase 6b mandatory (sem Branch B)** | (decisão de roadmap; fast-agent + intel-store marcados P6 ⚡) |
| **Inception híbrida (response-first)** | Edges `fast-agent ↔ minimax-api` + `intel-store → match-script` |
| **Hot path p50<50ms** | Boundary "Módulo 3 — Hot Path" label |

---

## Convenções

- **Stable IDs**: kebab-case, **imutáveis**. Label pode mudar; ID não.
- **Referência cross-phase**: sempre por stable ID. Nunca por label (label é mutável).
- **Drift arquitetural**: novos componentes / fronteiras / decisões viram entrada em [`.specs/DISCOVERIES.md`](DISCOVERIES.md) (severidade: `cosmetic | structural | critical`).
- **Renderer**: `node .claude/skills/archify/bin/archify.mjs render architecture <json> <html>`.

---

## Artefatos da Camada A

| Path | Conteúdo | Quem consome |
|---|---|---|
| [`.specs/architecture/memory-studio.architecture.json`](architecture/memory-studio.architecture.json) | Fonte estruturada (25 components, 26 connections, 5 boundaries) | archify (renderer) |
| [`.specs/architecture/memory-studio.html`](architecture/memory-studio.html) | Farol renderizado (visual interativo) | humano |
| `.specs/ARCHITECTURE.md` (este) | Farol em texto (markdown) | sub-agentes LLM, design.md, referências cruzadas |
| [`.specs/DISCOVERIES.md`](DISCOVERIES.md) | Log append-only de drift arquitetural | orchestrator (loop step 8b), humano |

---

## Cross-references

- [PRD.md §7 endpoints](../PRD.md) — contrato de `/augment`
- [PRD.md §10 acceptance](../PRD.md) — critérios de aceitação do MVP
- [PRD.md §16.4 engineering decisions](../PRD.md) — 5 decisões locked
- [PRD.md §17 nomenclature](../PRD.md) — casing canônico
- [PLAN.md §16.4 overhead](../PLAN.md) — breakdown por phase
- [`.scratch/memory-studio/spec.md §IMod-5`](../scratch/memory-studio/spec.md) — schema intel
- [`.scratch/memory-studio/spec.md §IMod-7`](../scratch/memory-studio/spec.md) — Search FTS5+vec+RRF
- [`.scratch/memory-studio/spec.md §IMod-13`](../scratch/memory-studio/spec.md) — invariantes sólida
- [`.specs/ROADMAP.md Phase 6b`](ROADMAP.md) — fast agent mandatory

---

## Versionamento

- **v2 (2026-07-28)** — reescrito do zero refletindo a arquitetura canônica unificada (5 módulos runtime-only, 25 componentes, 26 conexões). Remove meta-tools (`tlc-roadmap-loop`, `auto-grill`, `archify`, `Planner/Implementer/Verifier`) do farol do produto. Substitui tentativas fragmentadas por layer (`external.json`, `phase0.json`, `produto-hot.json`, `produto-pipeline.json`, `storage-specs.json`) e o farol antigo em `.specs/archive/architeture/` que misturava Produto + Orquestração + Externa.
- **v1 (2026-07-22)** — versão antiga com 3 camadas (Produto + Orquetração + Externa) incluindo meta-tools. Arquivada em `.specs/archive/architeture/architecture.html` (referência histórica).
