---
date: 2026-07-26
version: 3
supersedes:
  - .specs/archive/memory-studio-v3/PLAN-v1.md
  - .specs/archive/memory-studio-v3/proposal-v2.md
status: ready-to-build
description: "Memory Studio v3 — PRD. Documenta DECISÕES (com justificativa 'por que X e não Y'). Companion do PLAN.md (fases de implementação)."
explanation: |
  v3 é o successor de PLAN-v1 (middleware invisível, prompt-only) e
  proposal-v2 (draft não-autorizado, 41 decisões não-medidas).

  Origem: conversa M3E ↔ humano em 2026-07-26. Crítica: v1 era pequeno
  mas faltava UI + leitura de estado do agente; v2 era grande demais,
  90% especulação sobre 10% problema, e conflitava com a visão do
  humano (UI em vez de CLI/git-centric).

  v3 pega o verde:
  - Tudo de v1 que era invariante sólida (Node-only, sem LLM no hot
    path, cache ephemeral, tenant_id hasheado, threshold duplo,
    detector social, catálogo versionado).
  - Visão revisada do humano: ferramenta COM painel UI, lê estado
    do agente (não só prompt).
  - 3 melhorias enxutas herdadas de v2: SDK de contexto, critical
    rules, response debug-first (pruning_decisions + cache_hit).

  v3 rejeita explicitamente: catálogo 3 camadas, attention tiers,
  relevance-decay, tier escalation, discovery signals, curator LLM,
  handoff middleware-managed, 5 estágios com dedup semântico.
  Tudo isso é v3.1+ e precisa de evidência empírica antes.

  ## Mudança de nomenclatura (2026-07-26)

  PLAN.md → PRD.md (este arquivo). Razão: PRD é o tipo correto
  do documento (decisões, escopo, justificativas). PLAN.md agora
  é o companion de fases (sequência, deliverables, estimates).

  ## Mudança de arquitetura (2026-07-26)

  v3 introduz **Inception Híbrida** (response-first) — ver §3 e §18.
  Esta é arquitetura NOVEL: nenhum routing tool existente
  (OmniRoute, 9Router, LiteLLM, Portkey, OpenRouter) implementa
  fast-agent-over-response. Memory Studio seria o primeiro.
related:
  - PLAN.md
  - .specs/archive/memory-studio-v3/PLAN-v1.md
  - .specs/archive/memory-studio-v3/proposal-v2.md
  - CLAUDE.md
  - History.md
  - .specs/STATE.md
  - .specs/ROADMAP.md
  - handoff-session.md
---

# Memory Studio v3 — PRD

**Data:** 2026-07-26
**Status:** pronto pra construir (após autorização humana)
**Companion:** [PLAN.md](PLAN.md) — fases de implementação (sequência, deliverables, estimates)
**Princípio:** toda decisão vem com "por que X e não Y". PRD documenta decisões, PLAN documenta como.

---

## 0. Em uma frase

Memory Studio é um estúdio de injeção de contexto, com painel UI. Quando um humano envia um prompt pra um agente de código (Claude Code, Aider, Cursor, Cline, Mavis...), o Memory Studio intercepta o pedido, lê o **estado atual do agente** (scratch, todos, arquivos recentes, último evento), avalia o prompt, e injeta no system message as **skills, rules e personas** que combinam com a tarefa — sem quebrar o cache do provedor. O humano controla quais skills/rules/personas estão ativas pelo painel.

**Características-chave:**

- **Inception híbrida (response-first):** Turn N vai plain pro provedor. Fast agent (Haiku) lê response em paralelo com humano. Turn N+1 augmenta usando (intel + prompt + catalog). Latency trick: trabalho do fast agentuality escondido na leitura humana. **Ver §3 e §18.**
- **Cache hit preservado:** system message augmentado é byte-string determinístico. Prefixo (persona) intacto, sufixo (intel + Skills) é a única parte variável.
- **Painel UI:** humano controla Skills/Rules/Personas via UI. Layout em colunas, busca, janela lateral pra leitura.

---

## 1. O que é (escopo)

Memory Studio v3 entrega:

1. **Painel UI** onde o humano vê, liga/desliga e configura quais Skills, Rules e Personas estão ativas por projeto.
2. **Middleware** que intercepta pedido do agente, lê prompt + estado, monta system message augmenté com catálogo ativo.
3. **SDK cliente leve** (~50KB TypeScript) que os agentes usam pra coletar estado (scratch/todos/files/last_event) e enviar pro middleware.
4. **Catálogo versionado** em git (YAML), com campo `critical` em Rules (atomicidade).
5. **Cache do provedor preservado** — system message augmenté é byte-string determinístico mesmo com Skills variáveis.
6. **Audit log** do que foi injetado em cada request, com 5 razões de pruning (debug-first).
7. **Inception híbrida** — fast agent processa response em paralelo com leitura humana; Turn N+1 augmenta com base em (intel + prompt + catalog).
8. **3 modos de integração** com agentes: proxy transparente (preserva cache, zero trabalho no agente), hook (fallback), MCP (futuro).

---

## 2. O que NÃO é

Limites explícitos, pra evitar drift:

- **Não é memória de longo prazo do usuário.** Não guarda "o usuário gosta de X" entre sessões. Isso é módulo separado, schema separado, v3.1+.
- **Não é vector store genérico.** Não substitui Qdrant/Pinecone/Chroma. É roteador específico de skills/rules/personas.
- **Não é agente autônomo.** Não toma decisões, não planeja, não chama tools por conta. Lê estado → match catálogo → injeta.
- **Não extrai fatos com LLM.** Catálogo estático, embedding pré-computado. Sem LLM no loop de extração.
- **Não usa LLM no hot path.** Match = embedding (modelo ONNX local, ~470MB) + FTS5. Sem chamada LLM por turno. (Curator LLM como opt-in fica pra v3.1, **NÃO** MVP.)
- **Não é ferramenta de CLI / git-centric.** v2 draft propôs catálogo em 3 camadas com fork/merge. v3 descarta: o humano controla via UI, não editando YAML+git. Catálogo versionado continua (git = source of truth), mas customização por usuário é via UI, não via fork.
- **Não é orquestrador de sessão.** v2 draft propôs "handoff middleware-managed". v3 descarta: handoff é decisão do agente/SDK, não do middleware Memory Studio.
- **Não tem auto-melhoria.** v2 draft propôs discovery signals + curator. v3 descarta: primeiro ship v3 estável, depois pensa em sinais.
- **Não é orquestrador de fast-agent.** Fast agentuality (=agente rápido que lê response) é **read-only sobre o output do provedor** — não interfere no fluxo do agente, não edita o que o agente disse, só computa intel pra próximo turn.

---

## 3. Como funciona o fluxo (inception híbrida)

**Conceito:** Turn N (sem augmentação) → fast agent processa response em paralelo com humano → Turn N+1 (augmentação cache-friendly).

```
Turn N (cold start, sem augmentação):
  humano escreve prompt P_N
       ↓
  SDK coleta contexto: scratch, todos, files, last_event
       ↓
  SDK monta request: { prompt: P_N, context, fingerprint, tenant_id }
       ↓
  Memory Studio recebe request
       ↓
  P_N vai plain pro provedor (sem augmentação — turno 1 sem intel ainda)
       ↓
  provedor responde R_N
       ↓
  RAMO A (paralelo): humano lê R_N
  RAMO B (paralelo): fast agent (Haiku) lê R_N
       ↓
  fast agent gera intel: "agente tá em X, vai precisar de Y"
       ↓
  intel guardado no store

Turn N+1 (augmentação cache-friendly):
  humano escreve prompt P_{N+1}
       ↓
  SDK atualiza contexto
       ↓
  SDK monta request: { prompt: P_{N+1}, context, fingerprint, tenant_id }
       ↓
  Memory Studio recebe request
       ↓
  scripts: match (intel + P_{N+1} + context + catalog) → qualification
       ↓
  system message augmentado:
    prefixo (persona estável) + sufixo (intel + Skills)
       ↓
  provedor → cache hit no prefixo
```

**Por que response-first (X) e não prompt-first (Y):**

- **X (response-first):** fast agentuality roda durante a leitura humana. Tempo de leitura = orçamento. Zero penalty.
- **Y (prompt-first):** processar prompt antes de enviar adiciona latency sem benefício.
- **Y desperdiça o orçamento "escondido" na leitura humana.**
- **Status:** X é o modelo. Y é v3.1+ se houver evidência empírica de que faz falta.

**Três sinais na augmentação (Turn N+1):**

1. **Intel** (do Turn N, vindo da response) — o que o agente estava fazendo
2. **Prompt P_{N+1}** (entrada do humano) — pra onde o agente vai agora
3. **Catalog** (skills/rules/personas) — o que pode ser injetado

**Intercepção:**

| Modo | Cache preservado | Agentes |
|---|---|---|
| **Proxy (baseURL custom)** | ✅ Sim | Claude Code, Cline, Aider, OpenCode |
| **Hook** | depende | Agentes com hook system |
| **MCP (v3.1)** | ✅ Sim | Cline v2+, Cursor |

**Preferência:** proxy. Fallback: hook.

---

## 4. Painel UI (a superfície)

**Por que painel (X) e não middleware invisível (Y):**

- **X:** humano controla o que vai pro agente. Debug + customização possíveis.
- **Y:** v1 era invisível. Difícil de debugar, customizar, ou audit.
- **Y é descartado:** o produto precisa de visibilidade. UI-centric é a visão do humano.

**Constraints do humano (2026-07-26):**

- Colunas (Skills / Personas / Rules / etc.)
- Busca por item
- Janela lateral pra leitura quando item é selecionado
- Humano pode mexer, ver, modificar, adicionar

### Telas (MVP)

| Tela | Função |
|---|---|
| **Skills** | Lista skills do catálogo. Liga/desliga. Toggle persiste por projeto. |
| **Rules** | Lista rules. Toggle on/off. Critical rules sempre on (UI mostra aviso). |
| **Personas** | Lista personas. Cap 3 selecionáveis. Toggle persiste. |
| **Audit** | Últimas N augmentations: timestamp, prompt (redactado), skills injetadas, pruning reasons, latência. |
| **Settings** | Threshold, tenant, modo de integração, modelo de embedding configurado. |

### Stack da UI

**Decisão:** HTMX+Alpine (delegada a esta sessão, com constraints acima).

**Por que X (HTMX+Alpine) e não Y (Svelte/Tauri/embedded):**

- X alinha com invariante "Node-only, zero Python"
- Svelte é v3.1+ se virar foco do produto
- Tauri é v3.1+ se fricção de "abrir tab no browser" incomodar
- Trade-off real: escolha não é técnica, é onde o painel aparece no workflow do humano

### Onde o painel vive

**Decisão:** localhost, primeira porta livre.

**Por que X (porta livre) e não Y (Tauri):**

- X: zero fricção de build/distribuição
- Y: Tauri adiciona complexidade de empacotamento
- Y é v3.1+ se fricção incomodar

### Cache key da UI

Estado de toggle (skills/rules/personas ativas) vive em **`.memory-studio/state.json`** no projeto. Commitado opcionalmente. É input que afeta o byte-string final (e portanto o cache key do provedor).

---

## 5. SDK cliente (coleta de estado)

**Por que SDK (X) e não prompt-only (Y):**

- **X:** coleta estado do agente (scratch, todos, files, last_event). Hit-rate melhora vs prompt-only.
- **Y:** v1 era prompt-only. Match pior em sessões longas ("tá dando erro 401" depois de 20min implementando OAuth vira "auth-jwt-01" via state, não "debug-401-01" via prompt).
- **Y é fallback:** modo prompt-only continua funcionando (v1 compat).

SDK leve (~50KB, TypeScript puro, zero deps nativas) que cada agente embute. Função: **transformar estado local do agente em request pro `/augment`**.

```typescript
import { collectContext, fingerprint, MemoryStudioClient } from "@memory-studio/sdk"

const ctx = await collectContext({
  scratch: readRecentScratch(),           // últimos N chars do scratch local
  todos: readActiveTodos(),               // do todo system do agente
  recentFiles: gitStatus().modified,      // ou equivalente
  lastEvent: readLastEvent(),             // tool error / tool_result / tool_call
  redaction: "minimal",                   // "minimal" | "strict"
})

const fp = await fingerprint({
  projectPath: process.cwd(),
  agentId: "claude-code",                 // MVP: hardcoded
  sessionId: generateSessionId(),         // hasheado antes de sair
  gitBranch: await collectGitBranch(),
})

const ms = new MemoryStudioClient({ baseURL: "http://127.0.0.1:7788", tenantId: "..." })
const augmented = await ms.augment({ prompt, context: ctx, fingerprint: fp })
// augmented.systemMessage → injetado no system message do agente
// augmented.matchedSkills, augmented.cacheHit, augmented.pruningDecisions → log
```

**Lista canônica `fingerprint.agentId` (MVP):**

- `"claude-code"` — Claude Code CLI
- (v3.1: `"aider"`, `"cursor"`, `"cline"`, `"opencode"`)

**Coleta opcional:** se o agente não tem scratchpad, `scratch` é string vazia. SDK degrada graciosamente. **Modo prompt-only** (v1 compat) continua funcionando.

---

## 6. Schema do catálogo (YAML)

**Por que YAML versionado em git (X) e não banco proprietário (Y):**

- **X:** git = source of truth, versionamento gratuito, code review natural.
- **Y:** vendor lock-in, sem versionamento, sem code review.
- **Y é descartado:** invariante sólida de v1.

Skills, Rules, Personas. Um YAML por item, versionado em git.

### 6.1 Skill (sem mudança vs v1)

```yaml
id: auth-jwt-01
type: skill
title: How to set up JWT auth
category: procedural          # procedural | diagnostic | reference | pattern
text: |
  # Setup
  1. Install `jsonwebtoken`
  2. Generate RS256 keys (`openssl genrsa -out private.pem 2048`)
  ...
```

### 6.2 Rule (com `critical` introduzido em v3)

```yaml
id: rule-no-secrets-01
type: rule
critical: true               # atômico, sempre injetado, imune a decay (v3.1+)
text: "Never commit secrets, .env files, or API keys to git."
```

**Por que `critical: true` (X) e não atomicity engine (Y):**

- **X:** lista simples + warning na UI. Sem complexidade de v2.
- **Y:** v2 propôs atomicity engine (decay, promotion, tier escalation). Premature.
- **Y é v3.1+:** se houver evidência empírica de que atomicidade complexa é necessária.

**Comportamento `critical: true`** (MVP):

- Sempre incluído se Rule estiver ativa pelo painel.
- Imune a qualquer pruning futuro (decay não existe no MVP; ganha chão na v3.1).
- UI mostra aviso visual ("always on, can't toggle off sem confirmar").

### 6.3 Persona (sem mudança vs v1)

```yaml
id: engineer-pragmatic-01
type: persona
isDefault: true             # 1 slot garantido (se user configurar)
text: |
  You are a pragmatic senior engineer. Write clean, maintainable code.
  Prefer simplicity over cleverness. Document non-obvious decisions.
```

`tone_addendum` (v2) descartado por ora. v3.1 se houver evidência.

### 6.4 Versionamento

- Catálogo versionado em git: `config/catalog/<id>.yaml`.
- Mudança no YAML → comando `npm run build-index` regenera embeddings.
- Source of truth = YAML. Painel UI lê YAML (read), edita state de toggle em `.memory-studio/state.json` (separado).
- **Não tem catálogo em 3 camadas** (v2 discarded). **Não tem fork CLI** (v2 discarded). Customização por humano é via painel.

---

## 7. Schema do API

**Por que debug-first (X) e não response minimal (Y):**

- **X:** response com `pruningDecisions` (5 razões) + `cacheHit`. Debug trivial.
- **Y:** v1 era minimal. Debug era cego.
- **Y é descartado:** sem observability básica, debugging é inviável.

### 7.1 POST /augment

**Request:**

```typescript
{
  prompt: string                                    // obrigatório, sempre presente
  context?: {                                       // opcional, presente se SDK coletou
    scratch?: string                                // <= 384 tokens
    todos?: { status: string, text: string }[]      // <= 64 tokens serializados
    recentFiles?: string[]                          // <= 64 tokens (paths)
    lastEvent?: {
      type: "tool_error" | "tool_call" | "tool_result"
      severity?: "warning" | "error" | "critical"
      payload: unknown
    }
    legacyState?: string                            // injetado 1ª turn de nova sessão
    sessionId?: string                               // hasheado
  }
  fingerprint: {
    projectPath: string                              // path do projeto
    agentId: string                                  // "claude-code" (MVP)
    sessionId: string                                // hasheado
    gitBranch: string                                // branch atual
  }
  activeCatalog: string[]                            // IDs ativos (do painel)
  tenantId: string                                   // hasheado
  schemaVersion: 3
}
```

**Response (debug-first):**

```typescript
{
  systemMessage: string                            // byte-string cacheável
  matchedSkills: { id: string, score: number, source: "builtin" | "user" }[]
  matchedRules: { id: string, score: number, critical: boolean }[]
  matchedPersonas: { id: string, score: number, isDefault: boolean }[]
  cacheHit: "exact" | "semantic" | "miss"          // futuro v3.1
  pruningDecisions: {                              // 5 razões, todas honestas
    rejectedByFloor: { id: string, reason: string }[]
    rejectedByBudget: { id: string, reason: string }[]
    rejectedByAttentionTier: { id: string, reason: string }[]   // v3.1+
    rejectedByNegativeFeedback: { id: string, reason: string }[]
    rejectedByCriticalDropped: { id: string, reason: string }[]
  }
  latencyMs: { embedding: number, retrieval: number, rerank: number, total: number }
  decisionTraceId: string                            // link pro audit log
  warnings: string[]
  emptyReason?: "low_confidence" | "social" | "timeout" | null
  schemaVersion: 3
}
```

**Sem fingerprint cache** (descartado de v2). v3 MVP usa byte-string determinístico direto. Semantic cache 2-tier é v3.1+.

### 7.2 Outros endpoints (MVP)

| Endpoint | Método | Função |
|---|---|---|
| `/augment` | POST | augmentation principal |
| `/catalog` | GET | lista catálogo (debug) |
| `/catalog/rebuild` | POST | rebuild index (dev/admin) |
| `/audit` | GET | audit log |
| `/audit/summary` | GET | summary diário |
| `/health` | GET | liveness + readiness |

`/feedback`, `/discoveries`, `/handoff` são v3.1+. Não implementar agora.

---

## 8. Stack (mantém invariantes de v1)

**Por que Node-only (X) e não Python/Go (Y):**

- **X:** self-hosted friendly, zero Python pro user instalar.
- **Y:** Python adiciona dependência externa. Go community menor pro ecosystem.
- **Y é descartado:** invariante sólida de v1 mantida.

| Componente | Ferramenta | Tamanho |
|---|---|---|
| Runtime | Node.js 22 LTS | já tem |
| HTTP server | Fastify | ~5MB |
| Banco | SQLite + FTS5 + sqlite-vec | ~10MB |
| Embedding local | multilingual-e5-small (ONNX, 384d) | ~470MB |
| Reranker local | ms-marco-MiniLM-L-6-v2 (ONNX) | ~90MB |
| UI | HTMX+Alpine (MVP) | ~50KB JS browser |
| SDK cliente | TypeScript puro, ~50KB | 0 deps nativas |

**Working set total: ~1GB de RAM.** Roda em qualquer máquina com 4GB livres.

**Sem Python no hot path, sem dependência externa pro usuário instalar.** Self-hosted friendly.

**Invariantes sólidas (v1 mantidas, v3 não toca):**

- ✅ Node-only, zero Python no hot path
- ✅ SQLite + FTS5 + sqlite-vec (vs Qdrant/Pinecone — benchmark independente em v1 mostrou que SQLite vence na escala nossa)
- ✅ `cache_control: ephemeral` no system message augmenté
- ✅ Catálogo versionado em git (YAML por item)
- ✅ `tenant_id` hasheado no audit log (sha256[0:16])
- ✅ Detector social via regex (prompt bypassa retrieval)
- ✅ Threshold duplo no retrieval (`min_cosine_similarity` + `min_fts_hits`)
- ✅ Modos de integração (proxy/hook/MCP)
- ✅ Mem0 não entra (ortogonal ao propósito)

**Invariantes novas (v3 introduz):**

- 🆕 2 blocos `cache_control: ephemeral` (persona estável vs injeções variáveis)
- 🆕 Critical Rules atômicas (sempre injetadas se ativas no painel)
- 🆕 Response com `pruning_decisions` (debug-first)
- 🆕 State local do agente entra no match (`recentFiles`, `scratch`, `todos`, `lastEvent`)
- 🆕 **Inception híbrida** (response-first + latency trick) — ver §18

---

## 9. O que vai ser construído (referência)

Ver [PLAN.md](PLAN.md) para phases, deliverables, estimates. PRD foca em decisões, PLAN em fases.

**Estimativa total:** 30-40h single-dev (inclui erro, logging, 1 round de tuning empírico).

---

## 10. Critério de aceitação do MVP

### 10.1 Funcional

- [ ] Memory Studio lê prompt + estado do agente (scratch, todos, files, last_event)
- [ ] Top 3-5 skills/rules/personas são identificadas por augmentation
- [ ] System message augmenté é byte-string determinístico (mesma input → mesmo byte-string)
- [ ] `cache_control: ephemeral` em 2 blocos (persona estável + Skills variáveis)
- [ ] Cache do provedor hit quando input é igual (verificado via log de `usage.cache_read_input_tokens`)
- [ ] Painel UI mostra catálogo ativo, permite ligar/desligar por projeto
- [ ] Critical Rules aparecem com aviso visual e são imunes a toggle off sem confirmação
- [ ] Audit log grava todo request com prompt redactado + matched IDs + pruning reasons + latência
- [ ] Modo prompt-only (v1 compat) continua funcionando quando contexto é null
- [ ] Funciona com pelo menos 1 agente (Claude Code MVP)
- [ ] **Inception híbrida:** Turn N vai plain, fast agent lê response, Turn N+1 augmenta com intel

### 10.2 Performance

- [ ] p50 latência < 50ms (request sem embedding cache miss)
- [ ] p99 latência < 200ms (com embedding)
- [ ] Working set < 1.5GB de RAM
- [ ] Cache hit rate do provedor > 70% em sessão real (>10 turns) — **métrica via `usage.cache_read_input_tokens`**

### 10.3 Segurança / Privacidade

- [ ] Zero persistência de contexto raw (audit só com redactado)
- [ ] `tenantId` hasheado em todos os logs
- [ ] Placeholders determinísticos não vazam secret em audit
- [ ] Nenhum dado sai da máquina do usuário (proxy mode = local only)

### 10.4 Operacional

- [ ] `npm run build-index` regenera 100 skills em < 60s
- [ ] UI carrega em < 1s local
- [ ] Audit query retorna em < 100ms para 30 dias de dados

---

## 11. O que NÃO está no MVP (v3.1+)

**Tudo de v2 que foi cortado + decisões adiadas explicitamente:**

- ❌ Catálogo em 3 camadas (system/global/local) — v3.1 se houver demanda real
- ❌ Shadowing atômico + fork CLI + 3-way merge — fora, customização via UI
- ❌ Upstream sync notifier — fora, YAML é source of truth em git
- ❌ 4 attention tiers (smart/warm/hot/dumb) — v3.1 se métricas mostrarem degradação
- ❌ Relevance-decay (-0.05/turn) — v3.1, não premature
- ❌ Tier escalation on error (+1/+2) — v3.1
- ❌ Discovery signals (TF-IDF, recurring unknown) — v3.2+
- ❌ Curator LLM (opt-in) — v3.2+
- ❌ Glossary anchors boost — v3.1
- ❌ Leading words hoisting — v3.1
- ❌ Persona `tone_addendum` — v3.1
- ❌ Semantic cache 2-tier (fingerprint por augmented) — v3.1
- ❌ Handoff middleware-managed — **FORA**, handoff é do agente/SDK
- ❌ User-invoked precedência absoluta — v3.1
- ❌ Per-turn feedback vote persistente — v3.1
- ❌ Decision trace visualization interativa — v3.2
- ❌ Multi-tenant — v4+
- ❌ Long-term memory do usuário — v4+, schema separado
- ❌ MCP server completo — v3.1
- ❌ Cross-project catalog registry — v4+
- ❌ Adapter OpenAI↔Anthropic — v3.1

**Regra:** nada disso entra sem **evidência empírica** de que faz falta. Cada um vira ADR quando bate na porta.

---

## 12. Como instalar skills (workflow de catálogo)

Antes do MVP: ambiente atual do humano (Mavis, 19 skills built-in) já tem skills utilizáveis. Pra planejar o MVP, usar skill `tlc-spec-driven` direto.

Durante MVP: skill = arquivo YAML em `config/catalog/<skill_id>.yaml`. Workflow:

```bash
# 1. Adicionar/editar uma skill
code config/catalog/auth_jwt_01.yaml

# 2. Recompilar o índice (gera embeddings e atualiza o SQLite)
npm run build-index

# 3. Servidor pega mudanças no próximo request
```

Pós-MVP: o painel UI lê catálogo automaticamente (read) e o toggle state em `.memory-studio/state.json` (separado). CLI `memory-studio skill install <path>` pode entrar como v3.1 se virar fricção.

---

## 13. Como testar durante desenvolvimento

Como esse é o ambiente onde rodo agora, vou testar com Mavis (ou Claude Code) que é um dos agentes alvo. End-to-end:

1. Subir Memory Studio em `127.0.0.1:<porta-livre>`
2. Instalar SDK no agente / configurar proxy baseURL
3. Mandar prompt real
4. Conferir system message augmenté via UI / audit
5. Conferir cache hit quando mesmas Skills/persona são reutilizadas
6. Medir latência vs SLA (10.2)

Produto é agnóstico de Mavis. Quando ficar estável, testar com Claude Code via custom baseURL sem mudar linha do Memory Studio.

---

## 14. Decisões (FINALIZADAS 2026-07-26)

Decisões fechadas após grill com humano. Justificativa "por que X e não Y" registrada em cada uma.

### 14.1 Stack da UI

**Decisão:** HTMX+Alpine (delegada a esta sessão, com constraints).

**Por que X (HTMX+Alpine) e não Y (Svelte/Tauri/embedded):**

- Constraints do humano: colunas (Skills/Personas/Rules), busca, janela lateral.
- X alinha com v1 (Node-only, zero Python).
- Svelte é v3.1+ se virar foco do produto.
- Tauri é v3.1+ se fricção de "abrir tab no browser" incomodar.

### 14.2 Onde o painel vive

**Decisão:** localhost, primeira porta livre.

**Por que X (porta livre) e não Y (Tauri):**

- X: zero fricção de build/distribuição.
- Y: Tauri adiciona complexidade de empacotamento.
- Y é v3.1+ se fricção incomodar.

### 14.3 Modo de integração prioritário

**Decisão:** proxy transparente.

**Por que X (proxy) e não Y (hook):**

- X preserva cache melhor (controle byte-a-byte).
- Hook é fallback (v3.1+ se virar necessário).

### 14.4 Lista canônica fingerprint.agentId

**Decisão:** MVP = `"claude-code"` only.

**Por que X (Claude Code only) e não Y (multi-agent):**

- X: foco no MVP, evita drift.
- Y: outros agentes (Aider, Cursor, Cline, OpenCode) são v3.1+.

### 14.5 Onde fica state.json do painel

**Decisão:** por projeto (`.memory-studio/state.json`), commitável opcional.

**Por que X (per-project) e não Y (global):**

- X: estado isolado por codebase, sem conflito.
- Y: global é v3.1+.

### 14.6 Como medir cache hit > 70%

**Decisão:** structured JSON logging de `usage.cache_read_input_tokens` por request.

**Métricas:**

1. **Request hit rate** = requests com `cache_read_input_tokens > 0` ÷ total
2. **Token cache coverage** = `Σ cache_read_input_tokens ÷ Σ total_prompt_tokens`

**Por que X (log nativo) e não Y (LiteLLM/Prometheus):**

- X: zero overhead operacional, baixo setup.
- Y adiciona proxy extra (quebra invariante Node-only).
- Y é v3.1+ se virar dashboards.

### 14.7 Inception híbrida (response-first)

**Decisão:** arquitetura nova — ver §3 e §18.

**Por que X (response-first) e não Y (prompt-first):**

- X: fast agentuality roda durante a leitura humana. Zero penalty.
- Y: latency extra sem benefício.
- Y é descartado: orçamento escondido seria desperdiçado.

**Diferencial:** nenhum routing tool existente (OmniRoute, 9Router, LiteLLM, Portkey, OpenRouter) implementa fast-agent-over-response. Memory Studio seria o primeiro.

---

## 15. Cross-references

- [PLAN.md](PLAN.md) — implementation phases (sequência, deliverables, estimates)
- [.specs/archive/memory-studio-v3/PLAN-v1.md](.specs/archive/memory-studio-v3/PLAN-v1.md) — PLAN original (middleware invisível, prompt-only)
- [.specs/archive/memory-studio-v3/proposal-v2.md](.specs/archive/memory-studio-v3/proposal-v2.md) — draft 41-rounds (descartado)
- [CLAUDE.md](CLAUDE.md) — project glue + authority boundaries
- [History.md](History.md) — north star narrativa
- [.specs/STATE.md](.specs/STATE.md) — spec state vigente
- [.specs/ROADMAP.md](.specs/ROADMAP.md) — phase roadmap
- [handoff-session.md](handoff-session.md) — estado executivo da sessão

---

## 18. Inception Híbrida (response-first) — arquitetura NOVEL

**Status:** definida 2026-07-26. Pré-grill em §18.6 antes de integrar formalmente em §3 e iniciar Phase 6 do PLAN.

### 18.1 Conceito

Memória curta:
- **Turn N:** prompt plain → provedor → response. Fast agent (Haiku) lê response em paralelo com humano.
- **Turn N+1:** scripts fazem match (intel + prompt + context + catalog) → system message augmentado (prefixo estável + sufixo dinâmico) → cache hit.

Detalhamento está em §3.

### 18.2 Latency trick

**Orçamento de trabalho do fast agentuality:**

- Humano lê R_N: ~5-30s (típico).
- Fast agent processa R_N: ~1-3s.
- **Ambos em paralelo.** Fast agentuality termina **antes** do humano terminar de ler.
- Quando humano digita P_{N+1}, intel já está pronto.

**Esta é a peça central.** Sem isso, fast agentuality adiciona latency. Com isso, latency zero.

### 18.3 Novelty (vs o que existe)

Nenhum routing tool existente implementa fast-agent-over-response. Comparação:

| Tool | Padrão | Tem fast-agent-over-response? |
|---|---|---|
| **OmniRoute** ([repo](https://github.com/diegosouzapw/OmniRoute)) | combo chaining, reasoning cache, system prompt injection, role normalization | ❌ Não — async work é entre requests, não sobre response |
| **9Router** ([repo](https://github.com/decolua/9router), ~23.7k stars) | 3-tier cascade, Ponytail/Caveman token savers (system prompt injection), fail-open semantics | ❌ Não — stateless, sem pre-fetch |
| **LiteLLM** | auto-inject `cache_control` breakpoints | ❌ Não — sem response-side processing |
| **Portkey** | `cache_control` explícito + semantic cache | ❌ Não — sem response-side processing |
| **OpenRouter** | sticky routing + caching | ❌ Não — sem response-side processing |

**Memory Studio seria o primeiro** com fast-agent-over-response. **Diferencial competitivo, não overhead.**

### 18.4 Engineering decisions (a desenrolar)

| Decisão | Trade-off |
|---|---|
| Fast agent: in-process vs sidecar | Latency vs isolation |
| Intel: file vs unix socket | Reliability vs speed |
| Match: regex vs catalog vs embedding | Speed vs precision |
| Suffix injection: template vs raw concat | Cache hit vs flexibility |
| Prefix stability N→N+1 | Core do produto |

### 18.5 Lessons from research

| Necessidade | Padrão equivalente (reaproveitar) |
|---|---|
| Prefix estável → cache hit | OmniRoute reasoning cache, OpenRouter sticky routing, LiteLLM cache_control |
| System-message augmentation | 9Router Ponytail/Caveman |
| Fail-open (augmentação é advisory) | 9Router: erro → forward unmodified (nunca quebra sessão) |
| Cache TTL (5-min window) | Anthropic `cache_control: { ttl: "5m" }` faz async pre-fetch custo-effective |
| Role normalization | OmniRoute: `developer` → `system` |

### 18.6 Próximo passo

**Pré-grill antes de Phase 6 do PLAN.md:**

- [ ] Validar latency trick em POC (1 turno simulado)
- [ ] Definir fast agent: in-process vs sidecar
- [ ] Definir intel store: file vs unix socket
- [ ] Definir match strategy: regex vs catalog vs embedding
- [ ] Medir cache hit em sessão real (>10 turns)

**Após grill aprovado:**

- Integrar formalmente em §3
- Iniciar Phase 6 (Fast agent + intel pipeline) do PLAN.md

---

## Anexo — o que mudou vs v1 e v2

### v1 → v3 (preserva + adiciona)

**Preserva:** tudo da §3 a §11 de v1 (read→match→inject, catálogo YAML, threshold duplo, detector social, tenant_id hasheado, cache ephemeral, sem LLM hot path, Node-only, 3 modos de integração, 10 invariantes em §8).

**Adiciona:**

- Visão explícita de **painel UI** (v1 era middleware invisível)
- **SDK cliente** que coleta estado do agente (scratch, todos, files, last_event)
- **Campo `critical` em Rules** com UI warning
- **Response debug-first** com `pruningDecisions` e 5 razões
- **2 blocos de `cache_control: ephemeral`** (persona estável vs Skills variáveis)
- **Inception híbrida** (response-first + latency trick) — arquitetura NOVEL

### v2 → v3 (descarta + enxerta)

**Descarta explicitamente:** 38 das 41 decisões de v2 (ver §11 lista completa de cortes).

**Enxerta só 3:**

- SDK coleta contexto (§5, enxuto)
- Critical Rules (§6.2, sem atomicity engine)
- Response com `pruningDecisions` (§7.1, debug-first)

**Justificativa do enxerto (não das outras 38):**

- SDK é **ganho mensurável**: hit-rate melhora com contexto vs prompt-only. Validável empiricamente.
- Critical Rules é **correção semântica**: v1 tratava Rules como iguais a Skills; v3 distingue atomicidade.
- Response debug-first é **observability básica**: sem ela, debugging do sistema é cego.

**Por que as outras 38 ficaram fora:** cada uma das 38 precisa de evidência empírica antes de comprometer arquitetura. v2 tratou 41 decisões como fechadas; v3 trata como **especulação estruturada** que vira ADR quando bater na porta.

### Mudança de nomenclatura (2026-07-26)

PLAN.md → PRD.md (este arquivo). Razão: PRD é o tipo correto do documento (decisões, escopo, justificativas). PLAN.md agora é o companion de fases (sequência, deliverables, estimates).

**Toda decisão neste PRD vem com "por que X e não Y".** Esta é a regra operacional.

---

**Próximo passo concreto:** grill com você (sessão futura) na §18.6 antes de Phase 6 do PLAN.md. Phase 1-5 podem começar antes.
