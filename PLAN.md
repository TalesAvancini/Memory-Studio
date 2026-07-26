---
date: 2026-07-26
version: 3
supersedes:
  - .specs/archive/memory-studio-v3/PLAN-v1.md
  - .specs/archive/memory-studio-v3/proposal-v2.md
status: ready-to-build
description: "Memory Studio v3 — estúdio de injeção de contexto com painel UI. Intercepta pós-prompt, lê estado do agente, monta system message augmenté, deixa humano escolher skills/rules/personas."
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

related:
  - .specs/archive/memory-studio-v3/PLAN-v1.md
  - .specs/archive/memory-studio-v3/proposal-v2.md
  - CLAUDE.md
  - History.md
  - .specs/STATE.md
  - .specs/ROADMAP.md
---

# Memory Studio v3

**Data:** 2026-07-26
**Status:** pronto pra construir (após autorização humana)
**Sessão:** atual (M3E)

---

## 0. Em uma frase

Memory Studio é um estúdio de injeção de contexto, com painel UI. Quando um humano envia um prompt pra um agente de código (Claude Code, Aider, Cursor, Cline, Mavis...), o Memory Studio intercepta o pedido, lê o **estado atual do agente** (scratch, todos, arquivos recentes, último evento), avalia o prompt, e injeta no system message as **skills, rules e personas** que combinam com a tarefa — sem quebrar o cache do provedor. O humano controla quais skills/rules/personas estão ativas pelo painel.

```
[Humano escreve prompt]
        ↓
[Agente envia prompt + estado pro Memory Studio]
        ↓
[Memory Studio: lê prompt + estado + catálogo ativo]
        ↓
[Top 3-5 itens (filtrados pelo painel humano) → byte-string determinístico]
        ↓
[System message augmenté vai pro provedor → cache hit do provedor]
        ↓
[Agente responde com o contexto certo]
```

**Diferença crítica vs v1:** v1 lia só o prompt. v3 lê **estado do agente** (scratch, todos, arquivos, último evento). Isso permite match melhor em sessões longas ("tá dando erro 401" depois de 20min implementando OAuth vira "auth-jwt-01", não "debug-401-01").

**Diferença crítica vs v2:** v3 rejeita 90% do proposal v2 (catálogo 3 camadas, attention tiers, discovery signals, curator LLM, handoff middleware-managed). Tinha 41 decisões não-medidas; v3 guarda só 3 que têm ganhofísico mensurável.

---

## 1. O que é (escopo)

Memory Studio v3 entrega:

1. **Painel UI** onde o humano vê, liga/desliga e configura quais Skills, Rules e Personas estão ativas por projeto.
2. **Middleware** que intercepta pedido do agente, lê prompt + estado, monta system message augmenté com catálogo ativo.
3. **SDK cliente leve** (~50KB TypeScript) que os agentes usam pra coletar estado (scratch/todos/files/last_event) e enviar pro middleware.
4. **Catálogo versionado** em git (YAML), com campo `critical` em Rules (atomicidade).
5. **Cache do provedor preservado** — system message augmenté é byte-string determinístico mesmo com Skills variáveis.
6. **Audit log** do que foi injetado em cada request, com 5 razões de pruning (debug-first).
7. **3 modos de integração** com agentes: proxy transparente (preserva cache, zero trabalho no agente), hook (fallback), MCP (futuro).

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

---

## 3. Como funciona o fluxo

```
[Humano escreve prompt no agente]
        ↓
[Agente lê estado local: scratch, todos, arquivos, last_event]
        ↓
[SDK cliente monta request: { prompt, context, fingerprint, tenant_id }]
        ↓
[Memory Studio recebe request]
        ↓
[Filtra catálogo ativo pelo painel humano (state local)]
        ↓
[Embedding do contexto composto (prompt + state)]
        ↓
[Match semântico + lexical (FTS5) contra catálogo ativo]
        ↓
[Threshold duplo: cosine ≥ X + fts_hits ≥ Y]
        ↓
[Aplica regras de seleção: critical rules atomic, persona cap, budget, feedback positivo/negativo]
        ↓
[Orderna determinísticamente (Persona → Rule → Skill por ID)]
        ↓
[Minifica + monta byte-string]
        ↓
[System message 2-blocos: persona estável (cache) + injeções variáveis (re-cacheável)]
        ↓
[Resposta do provedor volta pro agente com cache hit (se Skills variáveis estáveis)]
```

**Intercepção** pode acontecer de 3 jeitos:

| Modo | Como | Cache preservado | Agentes |
|---|---|---|---|
| **Proxy (baseURL custom)** | Agente aponta Memory Studio como provedor | ✅ Sim | Claude Code, Cline, Aider, OpenCode |
| **Hook** | Hook do agente chama `/augment` antes de enviar | depende | Agentes com hook system |
| **MCP (v3.1)** | Memory Studio expõe tools MCP | ✅ Sim | Cline v2+, Cursor |

**Preferência:** proxy. Fallback: hook. MCP é futuro.

---

## 4. Painel UI (a superfície)

**Por que painel:** humano controla o que vai pro agente. Sem painel, é middleware invisível — bem mais difícil de debugar e customizar.

### Telas (MVP)

| Tela | Função |
|---|---|
| **Skills** | Lista skills do catálogo. Liga/desliga. Toggle persiste por projeto. |
| **Rules** | Lista rules. Toggle on/off. Critical rules sempre on (UI mostra aviso). |
| **Personas** | Lista personas. Cap 3 selecionáveis. Toggle persiste. |
| **Audit** | Últimas N augmentations: timestamp, prompt (redactado), skills injetadas, pruning reasons, latência. |
| **Settings** | Threshold, tenant, modo de integração, modelo de embedding configurado. |

### Stack da UI

**Decisão pendente** (precisa grill com humano):

- **Opção A — Web local (SPA leve):** Svelte ou HTMX+Alpine. Roda em `http://127.0.0.1:7788/ui`. Acessa do browser. Stack alinha com v1 (Node-only).
- **Opção B — Tauri (desktop):** Painel nativo, baixa binário single-file. Mais complexo de buildar, alinhamento com "self-hosted friendly" piora.
- **Opção C — WebView embedded no agente:** Claude Code tem webview? A confirmar.

**Recomendação inicial:** Opção A (Svelte ou HTMX+Alpine). Mais simples, mantém invariante "Node-only, zero Python".

**Trade-off real:** escolha não é técnica, é **onde o painel aparece no workflow do humano**. Painel browser-local significa "abrir tab toda vez". Painel embedded no IDE significa "zero context switch". Vale o grill antes de comprometer.

### Cache key da UI

Estado de toggle (skills/rules/personas ativas) vive em **`.memory-studio/state.json`** no projeto. Commitado opcionalmente. É input que afeta o byte-string final (e portanto o cache key do provedor).

---

## 5. SDK cliente (coleta de estado)

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
  agentId: "claude-code-extension",       // ou "claude-code-cli", "aider", etc
  sessionId: generateSessionId(),         // hasheado antes de sair
  gitBranch: await collectGitBranch(),
})

const ms = new MemoryStudioClient({ baseURL: "http://127.0.0.1:7788", tenantId: "..." })
const augmented = await ms.augment({ prompt, context: ctx, fingerprint: fp })
// augmented.systemMessage → injetado no system message do agente
// augmented.matchedSkills, augmented.cacheHit, augmented.pruningDecisions → log
```

**O que o SDK NÃO faz:**

- Não decide o que injetar (decisão é do middleware).
- Não coleta estado fora do escopo explicitamente pedido.
- Não envia prompt ou contexto pra fora sem redação aplicada.

**Coleta opcional:** se o agente não tem scratchpad, `scratch` é string vazia. SDK degrada graciosamente. **Modo prompt-only** (v1 compat) continua funcionando.

---

## 6. Schema do catálogo (YAML)

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

**Comportamento `critical: true`** (MVP):

- Sempre incluído se Rule estiver ativa pelo painel.
- Imune a qualquer pruning futuro (decay não existe no MVP; ganha chão na v3.1).
- UI mostra aviso visual ("always on, can't toggle off sem confirmar").

**Sem atomicity engine** (o de v2 era overkill). MVP: lista simples + warning.

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
    agentId: string                                  // "claude-code-extension" | "aider" | ...
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
  pruningDecisions: {                              // 5 razões, todas honesta
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

| Componente | Ferramenta | Tamanho |
|---|---|---|
| Runtime | Node.js 22 LTS | já tem |
| HTTP server | Fastify | ~5MB |
| Banco | SQLite + FTS5 + sqlite-vec | ~10MB |
| Embedding local | multilingual-e5-small (ONNX, 384d) | ~470MB |
| Reranker local | ms-marco-MiniLM-L-6-v2 (ONNX) | ~90MB |
| UI | Svelte (ou HTMX+Alpine) | ~50KB JS browser |
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

---

## 9. O que vai ser construído (MVP)

Estimativa: **30-40h single-dev** (v1 era 22-30h, v3 adiciona UI + contexto de agente). Em ordem:

1. **Setup** — Node 22, npm init, deps, scaffold (2h)
2. **Schema + CRUD de skill/rule/persona** — ler YAML, salvar no SQLite, gerar embeddings (3-4h)
3. **Detector social** — ignora prompts tipo "oi", "valeu" (1-2h)
4. **Coleta de contexto** — SDK cliente, hashing/redaction básico, fingerprint 4-componente (3-4h)
5. **Search** — FTS5 + sqlite-vec + RRF + threshold duplo (4-5h)
6. **Selection** — aplica `critical` em rules, ordering determinístico, budget check (2-3h)
7. **System message builder** — 2 blocos ephemeral, byte-string determinístico, response struct com `pruningDecisions` (2-3h)
8. **Forwarder (proxy mode)** — recebe request, augmenta, encaminha pro provedor real, devolve resposta (3-4h)
9. **Hook adapter** — script HTTP que agente chama antes de enviar prompt (1-2h)
10. **UI (painel)** — Svelte ou HTMX+Alpine, 5 telas, state em `.memory-studio/state.json` (8-12h)
11. **Audit log** — grava por request, queryable, summary endpoint (2-3h)
12. **Migration das skills built-in** — mover ~19 skills do Mavis pro schema novo (2-3h)
13. **Teste + tuning** (5-7h)

**Aviso honesto:** v1 subestimou. v3 não repete o erro. Estimativas acima incluem tratamento de erro, logging estruturado, e 1 round de tuning empírico (medir latência real e ajustar thresholds).

---

## 10. Critério de aceitação do MVP

### 10.1 Funcional

- [ ] Memory Studio lê prompt + estado do agente (scratch, todos, files, last_event)
- [ ] Top 3-5 skills/rules/personas são identificadas por augmentation
- [ ] System message augmenté é byte-string determinístico (mesma input → mesmo byte-string)
- [ ] `cache_control: ephemeral` em 2 blocos (persona estável + Skills variáveis)
- [ ] Cache do provedor hit quando input é igual (verificado via header `cache-control` ou log do provedor)
- [ ] Painel UI mostra catálogo ativo, permite ligar/desligar por projeto
- [ ] Critical Rules aparecem com aviso visual e são imunes a toggle off sem confirmação
- [ ] Audit log grava todo request com prompt redactado + matched IDs + pruning reasons + latência
- [ ] Modo prompt-only (v1 compat) continua funcionando quando contexto é null
- [ ] Funciona com pelo menos 2 agentes diferentes (Claude Code + 1)

### 10.2 Performance

- [ ] p50 latência < 50ms (request sem embedding cache miss)
- [ ] p99 latência < 200ms (com embedding)
- [ ] Working set < 1.5GB de RAM
- [ ] Cache hit rate do provedor > 70% em sessão real (>10 turns)

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

1. Subir Memory Studio em `127.0.0.1:7788`
2. Instalar SDK no agente / configurar proxy baseURL
3. Mandar prompt real
4. Conferir system message augmenté via UI / audit
5. Conferir cache hit quando mesmas Skills/persona são reutilizadas
6. Medir latência vs SLA (10.2)

Produto é agnóstico de Mavis. Quando ficar estável, testar com Claude Code via custom baseURL sem mudar linha do Memory Studio.

---

## 14. Decisões a fechar ANTES de começar a codar

Essas perguntas precisam de grill com humano (autônomo ou você mesmo):

1. **Stack da UI.** Svelte vs HTMX+Alpine? Trade-off = polish vs simplicidade. Recomendação: começar HTMX+Alpine (mais simples), promover Svelte se virar o foco do produto.
2. **Onde o painel vive.** Browser local (`http://127.0.0.1:7788/ui`) vs Tauri (desktop nativo) vs webview embedded. Recomendação: browser local primeiro.
3. **Modo de integração prioritário.** Proxy transparente vs hook? Proxy preserva cache melhor. Hook é fallback.
4. **Quem emite `fingerprint.agentId`.** Cada agente tem identificador único string. Lista canônica precisa ser definida.
5. **Onde guarda `state.json` do painel.** Por projeto (`.memory-studio/state.json`) ou global (`~/.memory-studio/state.json`)? Recomendação: por projeto, commitável opcional.
6. **Critério exato de "cache hit do provedor > 70%".** Como medir? Via header? Via log? Definir antes de tuning.

**Regra:** grill primeiro, codar depois. Essa ordem é **não-negociável** dado histórico recente.

---

## 15. Cross-references

- [.specs/archive/memory-studio-v3/PLAN-v1.md](.specs/archive/memory-studio-v3/PLAN-v1.md) — PLAN original (middleware invisível, prompt-only)
- [.specs/archive/memory-studio-v3/proposal-v2.md](.specs/archive/memory-studio-v3/proposal-v2.md) — draft 41-rounds (descartado)
- [CLAUDE.md](CLAUDE.md) — project glue + authority boundaries
- [History.md](History.md) — north star narrativa
- [.specs/STATE.md](.specs/STATE.md) — spec state vigente
- [.specs/ROADMAP.md](.specs/ROADMAP.md) — phase roadmap
- [handoff-session.md](handoff-session.md) — estado executivo da sessão

---

## Anexo — o que mudou vs v1 e v2

### v1 → v3 (preserva + adiciona)

**Preserva:** tudo da §3 a §11 de v1 (read→match→inject, catálogo YAML, threshold duplo, detector social, tenant_id hasheado, cache ephemeral, sem LLM hot path, Node-only, 3 modos de integração, $10 invariantes em §6).

**Adiciona:**

- Visão explícita de **painel UI** (v1 era middleware invisível)
- **SDK cliente** que coleta estado do agente (scratch, todos, files, last_event)
- **Campo `critical` em Rules** com UI warning
- **Response debug-first** com `pruningDecisions` e 5 razões
- **2 blocos de `cache_control: ephemeral`** (persona estável vs Skills variáveis)

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

---

**Próximo passo concreto:** grill com você nas 6 decisões da §14. Depois disso, brief pra implementação.
