---
date: 2026-07-26
version: 1
status: ready-to-build
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
  grill em PRD §18.6 antes de iniciar implementação.
related:
  - PRD.md
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

**Total estimado:** 30-40h single-dev (consistente com PRD §9).

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

**Paralelização:** Phase 4 (UI) pode rodar em paralelo com Phase 5 (Proxy). Útil se houver 2 devs. Single-dev: sequencial.

---

## Phase 1 — Schema + Catálogo

**Pre-reqs:** nenhum.

**Deliverables:**

- Schema YAML pra Skill, Rule, Persona (PRD §6)
- Loader de YAML → SQLite
- Embedding pipeline (multilingual-e5-small, ONNX, 384d)
- Command `npm run build-index` regenera embeddings
- ~19 skills built-in migradas do Mavis

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

**Pre-reqs:** Phase 1.

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
- System message augmenté: 2 blocos `cache_control: ephemeral` (persona + Skills)
- Byte-string determinístico (mesma input → mesma saída)
- Response struct com `pruningDecisions` (5 razões) + `cacheHit`
- Audit log preenchido
- Structured JSON logging de `usage.cache_read_input_tokens` por request (PRD §14.6)

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

**Estimate:** 5-7h (1 semana de dados de produção).

**Por que X (CLI/arquivo) e não Y (Grafana/Prometheus):**

- X: zero setup, alinhado com Node-only.
- Y: adiciona stack de observability, quebra invariante.
- Y v3.1+ se virar dashboards necessários.

---

## Total

| Phase | Estimate |
|---|---|
| 1 — Schema + Catalog | 3-4h |
| 2 — Detector + fingerprint | 2-3h |
| 3 — SDK | 3-4h |
| 4 — UI | 8-12h |
| 5 — Proxy | 5-7h |
| 6 — Fast agent (NOVEL) | 8-12h |
| 7 — Tuning | 5-7h |
| **Total** | **30-40h** |

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
