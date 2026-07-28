---
date: 2026-07-27
version: 1
type: ideas-backlog
status: active
description: "Backlog de ideias pós-MVP / não-atuais. Append-only. Captura ideias antes de virarem PRD/PLAN/ADR."
explanation: |
  Este arquivo NÃO é compromisso. É parking lot.

  Distinção canônica (regra de ouro):

  - **PRD.md** = O QUE vamos construir (MVP, com decisões justificadas).
  - **PLAN.md** = COMO e QUANDO construir.
  - **ADR (`docs/adr/`)** = decisão TRAVADA após análise.
  - **STATE.md / handoff** = estado atual executivo.
  - **BACKLOG.md (este)** = ideias que NÃO estão no MVP, v3.1+, ou roadmap atual.
    Capturadas pra não esquecer. Revisitadas quando relevante.

  Quem adicionar ideia aqui DEVE prefixar com "Por que NÃO MVP" — força
  honestidade sobre o motivo de não entrar no escopo.

  Quando uma ideia do BACKLOG virar compromisso:
  1. Mover entrada pro PRD (com decisão) ou PLAN (com fase)
  2. Marcar entrada no BACKLOG como `[promoted → PRD §X]` ou `[promoted → PLAN Phase Y]`
  3. NÃO deletar — append-only preserva histórico

  Append-only: entradas antigas NUNCA são removidas, mesmo que "viradas pra baixo".
  Marcar com `[archived]` se明确 explicitamente descartadas, mas manter no arquivo.
related:
  - PRD.md
  - PLAN.md
  - CLAUDE.md
  - handoff-session.md
---

# Backlog de ideias (pós-MVP)

> **Regra:** se a ideia tem justificativa madura pra entrar no escopo, vai pra PRD/PLAN/ADR, não aqui. Aqui é captura bruta.

---

## Como adicionar uma ideia

```markdown
## I-NNN — <título curto>

**Data:** YYYY-MM-DD
**Tags:** [processo] [feature] [meta] [auto-grill] [v4+] ... (opcional)

**Ideia:** <1-3 parágrafos. O que é, como funcionaria, pra que serve>

**Por que NÃO MVP:** <honesto. Sem justificativa = entrada rejeitada>

**Status:** [open] | [promoted → PRD §X] | [promoted → PLAN Phase Y] | [archived]
```

**Sem `Por que NÃO MVP` = entrada rejeitada.** Não dá pra capturar "ideia boa" sem explicar por que não entra agora.

---

## Entradas

### I-001 — Auto-discovery de personas/skills via hook de PRD

**Data:** 2026-07-27
**Tags:** [processo] [meta] [v4+]

**Ideia:** hook que sempre captura o PRD/PLAN/spec da sessão. Modelo leve (Haiku-class) pesquisa o MVP, extrai personas que podem ser aplicadas ao projeto, busca no catálogo skills associadas às personas + tech stack mencionada no PRD + arquitetura proposta. Resultado vira sugestão no painel UI (não auto-injeta — humano decide).

**Exemplo concreto:** humano abre projeto Node com PostgreSQL + JWT. Hook captura PRD. Modelo extrai `persona=engineer-pragmatic-01`, sugere skills `auth-jwt-01`, `postgres-migrations-01`, `node-async-patterns-01`. Painel mostra como cards "sugestões", humano aceita/recusa/edita.

**Por que NÃO MVP:** depende de (a) PRD/PLAN estáveis com schema parseável, (b) modelo leve integrado ao pipeline (orquestração de prompts), (c) UI com componente de sugestões, (d) pipeline de recomendação com qualidade mínima aceitável. Nenhuma dessas peças existe. Pode virar feature em v4, ou add-on separado, ou ficar como spec viva no `.specs/features/auto-discovery/`.

**Status:** [open]

---

### I-002 — Reranker (ms-marco-MiniLM-L-6-v2)

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** MiMo analysis + remoção do MVP per D-008 (PRD §8 working set reduction)

**Ideia:** adicionar reranker local (ONNX, ms-marco-MiniLM-L-6-v2, ~90MB RAM) após retrieval FTS5 + sqlite-vec + RRF, antes de serializar system message. Re-ordena top-K candidatos por relevância semântica fina, antes do threshold duplo final.

**Pipeline proposto:** query → FTS5 → sqlite-vec → RRF (top-K=20) → rerank (top-5) → threshold duplo → matched arrays ordenados.

**Por que NÃO MVP:** (a) sem Phase do ROADMAP integra reranker (Pipeline Phase 5a é FTS5+vec+RRF+threshold+tiebreak, sem etapa de reranking). (b) adiciona ~90MB RAM ao working set (~905MB → ~995MB). (c) latência de inferência ONNX (~10-50ms) viola budget p50<50ms. (d) SPEC §17.2 não tem latência budget pra reranker. Reintroduzir se métricas Phase 7b mostrarem recall top-5 insuficiente (medir `pruning_rejected_by_floor` count).

**Status:** [open]

---

### I-003 — Augmented cache (fingerprint semântico, v3.1+)

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §17.1 distinction cache do provedor vs cache de augmented

**Ideia:** cache in-memory que detecta inputs semanticamente equivalentes mas byte-diferentes. Fingerprint semântico sobre o system message final + prompt — hit entre inputs similares sem precisar do cache do provedor. Campo `cacheHit: "exact" | "semantic" | "miss"` na response do `/augment` (omitido no MVP).

**Por que NÃO MVP:** (a) MVP usa só cache do provedor (Anthropic `cache_control: ephemeral`), suficiente pra hit >70%. (b) cache de augmented adiciona complexidade de fingerprint hashing semântico + eviction policy + invalidation. (c) PRD §10.2 métrica cache hit é via log estruturado de `usage.cache_read_input_tokens`, NÃO campo `cacheHit` da response. Implementar quando métricas do MVP mostrarem gaps ou quando outros providers sem cache estável exigirem.

**Status:** [open]

---

### I-004 — Hook integration mode

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §3 modos de integração table

**Ideia:** agente embed hook que invoca Memory Studio em pontos específicos (ex: antes de tool_call, depois de tool_result). Alternativa ao proxy transparente — preserva cache parcialmente mas depende de hook system do agente.

**Por que NÃO MVP:** (a) proxy transparente preserva cache melhor (controle byte-a-byte). (b) Hook adiciona dependência no agente — Aider, Cursor, Cline têm hook systems diferentes, cada um exige adapter. (c) MVP é focado em Claude Code via custom baseURL — hook não é necessário. Implementar quando outros agentes sem suporte a baseURL proxy entrarem em foco (v3.1+).

**Status:** [open]

---

### I-005 — MCP server completo

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §11 v3.1+ lista

**Ideia:** Memory Studio como MCP (Model Context Protocol) server, expondo `augment`, `catalog`, `state/toggle`, `audit` como tools. Agentes MCP-native (Cline v2+, Cursor) consomem direto.

**Por que NÃO MVP:** (a) MVP é proxy-based (PRD §14.3 decisão). (b) MCP server adiciona mais uma superfície de integração a manter. (c) foco atual é Claude Code. Implementar quando demanda real de MCP-native agents surgir (v3.1+).

**Status:** [open]

---

### I-006 — Adapter OpenAI↔Anthropic

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §11 v3.1+ lista

**Ideia:** adapter que traduz request/response entre OpenAI API e Anthropic API. Memory Studio vira provider-agnostic.

**Por que NÃO MVP:** (a) MVP foca em Anthropic (cache_control: ephemeral é Anthropic-specific). (b) cache strategy do provedor é diferente em OpenAI (não tem ephemeral TTL). (c) byte-string determinístico + cache hit >70% são métricas Anthropic-specific. Implementar quando demanda de multi-provider surgir, com estudo separado de OpenAI cache semantics.

**Status:** [open]

---

### I-007 — Persona `tone_addendum`

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §6.3 (rejeitado de v2, deferido)

**Ideia:** campo adicional na persona YAML (`toneAddendum: "Be concise. Use markdown tables."`) que injeta modificador de tom no system message, sem reescrever persona base.

**Por que NÃO MVP:** (a) persona base já cobre tom principal. (b) addendum adiciona complexidade de merge de system message. (c) sem demanda empírica — humanos ajustam persona base direto. Reintroduzir se painel UI mostrar que humanos querem tweak frequente sem reescrever persona.

**Status:** [open]

---

### I-008 — Discovery signals + curator LLM (v3.2+)

**Data:** 2026-07-28
**Tags:** [feature] [v3.2+]
**Origem:** PRD §11 v3.2+ lista

**Ideia:** sinais de discovery (TF-IDF, recurring unknown patterns) + curator LLM (opt-in) que sugere novas skills pro catálogo baseado em padrões de prompts não-matchados. Humano aceita/recusa via painel.

**Por que NÃO MVP:** (a) MVP é catálogo curado pelo humano. Discovery inverte o modelo. (b) curator LLM viola invariante "no LLM no hot path". (c) precisa de feature de audit/signals primeiro. (d) v3.2+ explicitamente — sem pressa. Implementar quando catálogo estático mostrar lacunas reais.

**Status:** [open]

---

### I-009 — Long-term memory of user preferences (v4+)

**Data:** 2026-07-28
**Tags:** [feature] [v4+]
**Origem:** PRD §11 v4+ lista

**Ideia:** schema separado que persiste preferências de longo prazo do humano (ex: "user prefers concise responses", "user dislikes TypeScript") entre sessões. Cross-session memory.

**Por que NÃO MVP:** (a) MVP é per-session (state em `.memory-studio/state.json` por projeto). (b) cross-session memory tem privacy implications (LGPD/GDPR). (c) schema separado, produto separado. (d) v4+ — ortogonal ao propósito MVP. Implementar como add-on separado se virar demanda.

**Status:** [open]

---

### I-010 — Multi-tenant (v4+)

**Data:** 2026-07-28
**Tags:** [feature] [v4+]
**Origem:** PRD §11 v4+ lista

**Ideia:** suporte multi-tenant — múltiplos usuários/organizações compartilhando Memory Studio server, com audit log isolado, RBAC, billing.

**Por que NÃO MVP:** (a) MVP é single-user single-machine (proxy local only). (b) MVP atende workflow humano-agente individual. (c) multi-tenant requer auth, RBAC, billing — overhead desproporcional ao MVP. (d) v4+ — produto separado se virar SaaS.

**Status:** [open]

---

### I-011 — Catálogo em 3 camadas (system/global/local) (v3.1+)

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** v2 draft rejeitado, deferido pra v3.1+ per PRD §11

**Ideia:** catálogo com 3 camadas — system (built-in core), global (humano-wide), local (projeto-specific). Cada camada tem toggle independente. Local override global.

**Por que NÃO MVP:** (a) MVP é single-layer (catálogo versionado em git). (b) 3 camadas adiciona complexidade de merge + precedence rules. (c) workflow do humano (UI toggle per projeto) já cobre maioria dos casos. (d) v2 draft propôs isso, v3 rejeitou explicitamente. Reintroduzir se usuários pedirem (v3.1+).

**Status:** [open]

---

### I-012 — Decision trace visualization interativa (v3.2+)

**Data:** 2026-07-28
**Tags:** [feature] [v3.2+]
**Origem:** PRD §11 v3.2+ lista

**Ideia:** painel UI com grafo interativo da decisão trace de cada augmentation — `decisionTraceId` link mostra pruning decisions, matched IDs com scores, RRF contributions, threshold aplicado. Debug visual.

**Por que NÃO MVP:** (a) MVP tem Audit tab textual (PRD §4). (b) grafo interativo requer componente front-end pesado (D3, vis-network, etc.). (c) debug-first response struct (PRD §7.1) já dá info via JSON. Implementar quando humanos precisarem visualizar pruning decisions em vez de ler JSON (v3.2+).

**Status:** [open]

---

### I-013 — Attention tiers / relevance-decay (v3.1+)

**Data:** 2026-07-28
**Tags:** [feature] [v3.1+]
**Origem:** PRD §11 v3.1+ lista (4 attention tiers + relevance-decay + tier escalation)

**Ideia:** items matched têm tier (smart/warm/hot/dumb) baseado em uso. Decay temporal (-0.05/turn). Tier escalation on error (+1/+2). Atomicity engine.

**Por que NÃO MVP:** (a) v2 draft propôs, v3 rejeitou explicitamente (PRD §6.2: "premature"). (b) MVP é "todos items matched são tratados igualmente". (c) tiers + decay + escalation = atomicity engine complex. (d) sem evidência empírica de que faz falta. Implementar se métricas Phase 7b mostrarem degradação por atenção não-priorizada (v3.1+).

**Status:** [open]