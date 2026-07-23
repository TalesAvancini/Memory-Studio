# ARCHITECTURE.md — Camada A do Memory Studio

> **⚠️ ESTE ARQUIVO É LIDO COMO TEXTO. NÃO abrir `architecture.html` no contexto do sub-agent.**

Este documento é o **farol arquitetural em formato texto**, primário para LLMs e sub-agentes. Ele espelha `.specs/architecture.architecture.json` (a fonte de verdade estruturada) e referencia todos os componentes por **stable IDs** (kebab-case, imutáveis).

O **renderer visual** vive em `.specs/architecture.html` — exclusivo para o humano (semantic lens, route probe, pan/zoom, dark/light).

---

## Dual consumption

| Consumidor | Arquivo | Modo de leitura |
|---|---|---|
| **Sub-agente LLM** (Planner, Implementer, Verifier) | **este `.md`** | Texto puro, parseável, com stable IDs cruzados |
| **Humano** (revisão periódica, re-render) | `.specs/architecture.html` | Visual interativo (zoom, filtros, story beat) |

**Implicação prática:** Planner/Implementer **nunca** "abre no browser" para inspecionar o farol. Eles leem este arquivo. A interatividade visual é privilégio do humano.

---

## Camada produto (Memory Studio)

Componentes que implementam o produto em si — entrada do prompt, injeção no system message, persistência e busca.

| Stable ID | Label | Sublabel | Tipo | Função |
|---|---|---|---|---|
| `llm-provider` | LLM Provider | Claude Code / Cursor / Aider | external | Fonte do prompt; consumidor final |
| `catalog-yaml-files` | Catalog YAML | `config/skills/*.yaml` | external | Catálogo versionado em git; fonte do conhecimento injetável |
| `agents` | Agents | proxy / hook / MCP | backend | Adapter entre o LLM provider e o Memory Studio (3 modos de integração) |
| `server` | Server | Fastify HTTP | backend | Edge HTTP; recebe requests `GET /augment` |
| `augmenter` | Augmenter | prompt → system msg | backend | Componente core: monta o system message aumentado |
| `search` | Search | FTS5 + vec + rerank | backend | Retrieval híbrido (lexical + vetorial + rerank) |
| `catalog` | Catalog | YAML → SQLite + embed | backend | Ingestão: parseia YAML, persiste, gera embeddings |
| `social-detector` | Social Detector | regex de bypass | backend | Guarda contra tentativas de driblar o catálogo via prompt |
| `cache` | Cache | byte-string + sha256 | backend | Cache determinístico por hash do prompt |
| `embedding-model` | Embedding Model | multilingual-e5-small | backend | Modelo ONNX local (~1GB), roda no cold path |
| `sqlite` | SQLite | in-process | database | Persistência do catálogo, vetores e audit log |

---

## Camada orquestração (Loop)

Componentes que governam a execução autônoma das phases do roadmap.

| Stable ID | Label | Sublabel | Tipo | Função |
|---|---|---|---|---|
| `tlc-roadmap-loop` | tlc-roadmap-loop | loop orchestrator | backend | Driver do loop (Camada B); compõe tlc-spec-driven e dispara sub-agentes |
| `tlc-spec-driven` | tlc-spec-driven | base skill | backend | Skill base (Specify → Design → Tasks → Execute → Verify) |
| `planner-subagent` | Planner | spec + design + tasks | backend | Sub-agente que produz `spec.md`, `design.md`, `tasks.md` por phase |
| `implementer-subagent` | Implementer | execute tasks | backend | Sub-agente que executa tasks atomicamente, com commit por task |
| `verifier-subagent` | Verifier | validate + discriminate | backend | Sub-agente independente que valida o trabalho do Implementer |
| `architecture-md` | ARCHITECTURE.md | farol em texto | database | Este arquivo (espelho textual do JSON) |
| `discoveries-log` | DISCOVERIES.md | drift log | database | Append-only log de drift arquitetural (severidade 3 níveis) |

---

## Camada externa (renderers + engines)

Componentes externos ao produto e à orquestração, mas que ambos dependem.

| Stable ID | Label | Sublabel | Tipo | Função |
|---|---|---|---|---|
| `archify` | Archify | renderer do farol | external | CLI que renderiza o farol a partir do JSON |
| `sqlite-fts5` | SQLite FTS5 | full-text engine | external | Engine de busca lexical (bundled no SQLite) |
| `sqlite-vec` | sqlite-vec | vector engine | external | Engine de busca vetorial (extensão SQLite) |

---

## Conexões principais

Lista textual das 19 conexões do JSON, agrupadas por fluxo.

### Fluxo do augment request (hot path)

- `llm-provider` → `agents` (prompt) — emphasis
- `agents` → `server` (augment req) — emphasis
- `server` → `augmenter` (delegate) — default
- `augmenter` → `search` (retrieve) — default
- `augmenter` → `cache` (lookup/store) — default
- `augmenter` → `social-detector` (scan) — security

### Fluxo de ingestão (cold path)

- `catalog` → `catalog-yaml-files` (load) — default
- `catalog` → `embedding-model` (encode) — default
- `catalog` → `sqlite` (write) — default
- `search` → `sqlite` (query) — default
- `search` → `sqlite-fts5` (FTS) — default
- `search` → `sqlite-vec` (k-NN) — default

### Fluxo do loop (Camada B + C)

- `tlc-roadmap-loop` → `tlc-spec-driven` (compose) — emphasis
- `tlc-roadmap-loop` → `planner-subagent` (dispatch planner) — emphasis
- `tlc-roadmap-loop` → `implementer-subagent` (dispatch impl) — emphasis
- `tlc-roadmap-loop` → `verifier-subagent` (dispatch verify) — emphasis
- `tlc-roadmap-loop` → `discoveries-log` (writes drift) — dashed
- `planner-subagent` → `architecture-md` (read farol) — default
- `archify` → `architecture-md` (renders) — dashed

---

## Regiões (boundaries)

| Região | Wraps (IDs) |
|---|---|
| **Camada produto** | `agents`, `server`, `augmenter`, `search`, `catalog`, `social-detector`, `cache`, `embedding-model`, `sqlite` |
| **Camada orquestração** | `tlc-roadmap-loop`, `tlc-spec-driven`, `planner-subagent`, `implementer-subagent`, `verifier-subagent`, `discoveries-log`, `architecture-md` |
| **Camada externa** | `llm-provider`, `catalog-yaml-files`, `archify`, `sqlite-fts5`, `sqlite-vec` |

---

## Convenções

- **Stable IDs**: kebab-case, **imutáveis**. Label pode mudar; ID não.
- **Referência cross-phase**: sempre por stable ID. Nunca por label (label é mutável).
- **Drift arquitetural**: novas fronteiras / novos componentes viram entrada em `.specs/DISCOVERIES.md` (severidade: `cosmetic | structural | critical`).
- **Renderer**: `node .agents/skills/archify/bin/archify.mjs render architecture <json> <html>`.

---

## Artefatos da Camada A

| Path | Conteúdo | Quem consome |
|---|---|---|
| `.specs/architecture.architecture.json` | Fonte estruturada (21 components, 19 connections, 3 regions) | archify (renderer) |
| `.specs/architecture.html` | Farol renderizado (visual interativo) | humano |
| `.specs/ARCHITECTURE.md` | Farol em texto (este arquivo) | sub-agentes LLM, design.md, referências cruzadas |
| `.specs/DISCOVERIES.md` | Log append-only de drift arquitetural | orchestrator (step 8b do loop), humano |

---

## Versionamento

- **Versão atual:** v1 (2026-07-22)
- **Fonte estruturada:** `.specs/architecture.architecture.json` (regenerado a partir deste markdown quando humano-triggered)
- **Próxima re-render automática:** após 3+ discoveries `structural` ou 1+ `critical` (ver skill `tlc-roadmap-loop` step 8b).
