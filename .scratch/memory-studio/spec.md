---
date: 2026-07-28
version: 2
type: comprehensive-spec
description: "Memory Studio v3 — SPEC completa. Síntese unificada de PRD v3.2 + 9 discoveries auto-grill + conversation context + PLAN v2."
explanation: |
  SPEC completa do Memory Studio v3, construída mesclando:

  - PRD.md v3.2 (17 seções, ~830 linhas): decisões estratégicas, escopo,
    schema, stack, invariantes, acceptance criteria, glossário.
  - PLAN.md v2 (7 phases, ~380 linhas): phases, deliverables, estimates,
    acceptance mapping, Phase 6b mandatory (Branch B removido 2026-07-28).
  - .specs/DISCOVERIES.md (D-001 a D-009): 9 decisões auto-grill, todas
    resolvidas em PRD/PLAN post-gate 2026-07-28.
  - Conversation context (Waldemar loop, NotebookLM brainstorm, archive
    handoffs).

  Diferente de v1 deste spec (to-spec output subdimensionado que só
  extraiu User Stories + 10 Impl Decisions, deixando operational detail
  do PRD de fora — §4 Painel UI, §5 SDK shape, §6 YAML schema, §7.2
  endpoints, §8 stack + working set + invariantes, §10 acceptance
  mapping, §14 decisões específicas, §17 caches + nomenclature).

  Esta versão é a SPEC canônica. PRD continua sendo a fonte de decisões
  estratégicas ("por que X e não Y"); esta SPEC é granular + atomic,
  ready-for-agent.

  User Stories expandidas de 41 → 70+. Implementation Decisions
  expandidas de 10 → 25+ (módulos, interfaces, schema, contracts).
  Inclui: stack breakdown completo, working set ~1GB, 10 invariantes
  sólida + 6 invariantes novas, 23 acceptance criteria mapeados,
  arquitetura de cache (provedor vs augmented), nomenclature rules.
related:
  - ../../PRD.md
  - ../../PLAN.md
  - ../../.specs/DISCOVERIES.md
  - ../../CLAUDE.md
  - ../../.specs/auto-grill-output/2026-07-28_023050/
---

# Memory Studio v3 — SPEC completa

**Date:** 2026-07-28
**Version:** 2 (comprehensive rebuild)
**Sources merged:** PRD v3.2 + PLAN v2 + 9 auto-grill decisions + conversation context
**Status:** ready-for-agent

---

## Problem Statement

Code agents (Claude Code, Aider, Cursor, Cline, Mavis) são genéricos. O humano controla comportamento via system prompt + tools + skills locais, mas controle é difuso: skills, rules, personas ficam espalhadas em git, prompts ad-hoc, e configurações do agente. Quando humano digita prompt, o agente recebe system message **inalterado** entre requests que compartilham contexto lógico — então humano paga custo total de raciocínio a cada turn, mesmo quando estado do agente pouco mudou.

**Problema central:** humano quer que agente "já saiba o que importa" pra cada prompt, sem ter que copiar/colar skills ou re-explicar contexto toda vez. Mas:
- **(a)** re-escrever system message a cada turno quebra o cache do provedor (Anthropic `cache_control: ephemeral`).
- **(b)** ferramentas existentes (LiteLLM, Portkey, OpenRouter, 9Router, OmniRoute) só fazem cache estável — nenhum processa response-side pra acumular intel pro próximo turno.

## Solution

**Memory Studio** = middleware local entre agente e provedor. Intercepta request, lê prompt + estado do agente (scratch, todos, recentFiles, lastEvent), monta system message augmenté com catálogo ativo (Skills/Rules/Personas versionadas em git), encaminha pro provedor. Cache hit preservado via byte-string determinístico: prefixo (persona) intacto, sufixo (Skills) é única parte variável.

**Inception híbrida (NOVEL):** Turn N vai plain pro provedor (cold start, sem intel prévia). Fast agent (Haiku-class) lê response em paralelo com humano, gera `intel = { agentState, nextNeeds, recentTopic }`. Turn N+1 augmenta com (intel + prompt + context + catalog). **Latency trick:** fast agentuality roda durante leitura humana — humano leva ~5-30s lendo, fast agent leva ~1-3s processando. Intel pronto antes do humano digitar próximo turn. Zero penalty percebido.

**Painel UI** (HTMX+Alpine, localhost primeira porta livre): humano controla Skills/Rules/Personas ativas por projeto via `.memory-studio/state.json`. Critical Rules atômicas (imunes a toggle off sem confirmação explícita).

**Modos de integração:** proxy transparente (MVP, preserva cache byte-a-byte). Hook e MCP = v3.1+.

**Modo prompt-only** (v1 compat): se contexto é null, augmenta com match só de prompt.

---

## Architecture & Data Flow

### Componentes

| Camada | Componente | Tecnologia |
|---|---|---|
| **Cliente** | `@memory-studio/sdk` (~50KB TypeScript) | TypeScript puro, zero deps nativas |
| **Servidor** | `@memory-studio/server` | Fastify + SQLite (FTS5 + sqlite-vec) + ONNX |
| **UI** | `@memory-studio/ui` (HTMX+Alpine) | browser-side |
| **Storage** | Catálogo (YAML em git) + state (`.memory-studio/state.json`) | filesystem + SQLite |
| **Embedding** | multilingual-e5-small (ONNX, 384d) | local, ~470MB |
| **Reranker** | ms-marco-MiniLM-L-6-v2 (ONNX) | local, ~90MB |
| **Provedor LLM** | Anthropic API (MVP) | `cache_control: ephemeral` |

### Fluxo do request (Turn N+1 com augmentação)

```
Humano digita prompt P_{N+1}
   ↓
SDK coleta contexto: scratch, todos, recentFiles, lastEvent
   ↓
SDK monta request: { prompt, context, fingerprint, activeCatalog, tenantId, schemaVersion }
   ↓
Memory Studio /augment recebe
   ↓
Retrieval: query FTS5 + sqlite-vec → RRF fusion → threshold duplo → top-K candidatos
   ↓
Matched arrays ordenados: Array.sort((a,b) => a.id.localeCompare(b.id))
   ↓
System message augmenté montado (2 blocos cache_control: ephemeral):
  - Bloco 1 (prefixo, estável): persona
  - Bloco 2 (sufixo, variável): intel + Skills
   ↓
SHA256(byte-string) calculado; cache key estável
   ↓
Forward pro provedor (Anthropic)
   ↓
Audit log async buffer (não bloqueia request)
   ↓
Response com cacheHit (v3.1+), pruningDecisions, decisionTraceId
```

### Fluxo da inception híbrida (Turn N vs N+1)

```
Turn N (cold start):
  P_N plain → provedor → R_N
  Ramo A (paralelo): humano lê R_N
  Ramo B (paralelo): fast agent (default `MiniMax-M2.7-highspeed`, configurável) lê R_N → gera Intel → persiste

Turn N+1 (augmentação cache-friendly):
  P_{N+1} + Intel(R_N) + contexto + catálogo
  → match pipeline → system message augmentado
  → provedor → cache hit no prefixo (persona)
```

### Active catalog vazio (edge case D-008)

Quando `activeCatalog` é `[]`:
- HTTP 200 (não erro)
- `systemMessage`: byte-string determinístico do persona prefix sozinho
- `matchedSkills/Rules/Personas`: arrays vazios
- `emptyReason: "no_active_items"`
- `warnings`: `["activeCatalog is empty — proceeding with persona only"]`
- Forward unchanged pro provedor

---

## User Stories

### A. Configuração inicial (instalação + setup)

1. As a **developer** setting up Memory Studio, I want to run `npm install` and have it self-configure (SQLite schema, embeddings index, default catalog), so that I can start using it in <5min.
2. As a **developer**, I want the SDK to be a TypeScript package (~50KB, zero native deps), so that I can embed it in any agent without bundler pain.
3. As a **developer**, I want to mount the UI panel at `http://127.0.0.1:<porta-livre>`, so that I don't need to fight a fixed port or container setup.
4. As a **developer**, I want to add a new Skill by editing a YAML file in `config/catalog/<id>.yaml`, so that I can version skills in git like code.
5. As a **developer**, I want `npm run build-index` to regenerate embeddings in <60s for 100 skills, so that adding a skill is fast.
6. As a **developer**, I want to migrate v1 calibration state (`.specs/archive/2026-07-calibration/STATE.md`) into Memory Studio's schema, so that the invariant SQLite design isn't invented from scratch.
7. As a **developer**, I want the SQLite schema to include `catalog`, `embeddings`, and `audit_events` tables, plus FTS5 + sqlite-vec, so that retrieval is unified and vector search works.
8. As a **developer**, I want the catalog versioned in git with `schemaVersion` exposed in the API, so that breaking changes are explicit.

### B. Painel UI (controle do humano)

9. As a **human** working with a code agent, I want a panel that lists Skills/Personas/Rules in columns, so that I can scan what's available at a glance.
10. As a **human**, I want to search by name/keyword across Skills/Personas/Rules, so that I can find relevant items fast.
11. As a **human**, I want a side panel that shows full content of an item when I select it, so that I can read without losing context.
12. As a **human**, I want to toggle a Skill on/off per project (`.memory-studio/state.json`), so that I can scope what each codebase gets.
13. As a **human**, I want Critical Rules shown with a visual warning ("always on, can't toggle off without confirmation"), so that I don't accidentally disable safety rails.
14. As a **human**, I want to toggle confirmation for Critical Rules off, so that I can override atomic rules when I have explicit intent.
15. As a **human**, I want at most 3 Personas active at once, so that the system message stays coherent.
16. As a **human**, I want the Audit tab to show last N augmentations (timestamp, prompt redacted, matched IDs, pruning reasons, latency), so that I can debug what got injected.
17. As a **human**, I want the Settings tab to show threshold (min_cosine_similarity, min_fts_hits), tenant, integration mode, embedding model, so that I can tune retrieval.
18. As a **human**, I want UI stack as HTMX+Alpine (zero build), so that iterating on UI is fast and Node-only invariant holds.
19. As a **human**, I want the UI to live at `http://127.0.0.1:<porta-livre>` (first free port), so that I don't fight port conflicts.

### C. SDK cliente (coleta de estado)

20. As an **agent developer**, I want SDK function `collectContext({ scratch, todos, recentFiles, lastEvent, redaction })` that returns a serialized context object, so that I can hand agent state to Memory Studio with one call.
21. As an **agent developer**, I want SDK function `fingerprint({ projectPath, agentId, sessionId, gitBranch })` that returns a 4-component fingerprint, so that request provenance is captured.
22. As an **agent developer**, I want SDK function `MemoryStudioClient.augment({ prompt, context, fingerprint })` that calls `/augment` and returns the augmented system message, so that I can inject it into the agent's request.
23. As an **agent developer**, I want SDK to support prompt-only mode (v1 compat) when context is null, so that legacy agents keep working.
24. As an **agent developer**, I want SDK to hardcode `agentId = "claude-code"` for MVP, so that the first integration is stable.
25. As an **agent developer**, I want SDK to hash `sessionId` before sending (sha256[0:16]), so that privacy is preserved.
26. As an **agent developer**, I want SDK to redact secrets in `scratch` and `lastEvent.payload` before sending, so that I don't accidentally leak via audit log.

### D. Hot path (request flow / cache)

27. As a **Claude Code user**, I want `/augment` to add Skills to my system message before each request, so that my agent already knows context.
28. As a **user**, I want the system message byte-string to be deterministic (same input → same SHA256), so that the Anthropic cache hit works.
29. As a **user**, I want matched arrays (matchedSkills/Rules/Personas) to be deterministically ordered (lexicographic by id tiebreaker), so that RRF ties don't break byte-string silently. **← D-006**
30. As a **user**, I want audit log writes to be async (buffer + batch flush, fail-open on write error), so that request latency stays under p50<50ms. **← D-007 CRITICAL**
31. As a **user**, I want p50 latency <50ms (request without embedding cache miss), so that Memory Studio is invisible in normal flow.
32. As a **user**, I want p99 latency <200ms (with embedding), so that worst-case is bounded.
33. As a **user**, I want working set <1.5GB RAM, so that it runs on any 4GB machine.

### E. Inception híbrida (Phase 6, gated)

34. As a **user**, I want Turn N to go plain to the provider (no augmentação, cold start), so that the first request doesn't suffer latency.
35. As a **user**, I want a fast agent (default `MiniMax-M2.7-highspeed`, configurable via `.memory-studio/state.json` `fastAgent.model`, fallback `claude-3-5-haiku-*`) to read response in parallel with my reading, so that intel is ready when I type the next turn.
36. As a **user**, I want Turn N+1 to augment with `intel = { agentState, nextNeeds, recentTopic }` from previous turn, so that context flows across turns without re-prompting. **← D-005**
37. As a **user**, I want the fast agent (default `MiniMax-M2.7-highspeed`) to finish in <3s (tipicamente <1s com highspeed variant), so that latency trick works (human reads take 5-30s). Latency do fast agent é **arquitetural** (paralelismo natural) — não bloqueia request humano.
37a. As a **user**, I want inception hot path overhead (intel load + concat + template render) <10ms total, so that request p50 stays <50ms (PRD §10.2 budget). **Medido, não estimado.**
38. As a **user**, I want the fast agent to be in-process (no separate daemon), so that there's no extra service to manage.
39. As a **user**, I want Phase 6b inception híbrida mandatory (Branch B removido 2026-07-28) — Phase 6a acts as validation gate (latency trick POC + grill §16.7), and if POC reprova, decision humana is to adjust, not collapse, so that the architecture NOVEL is preserved as a competitive differentiator.

### F. Cache & metrics

40. As a **user**, I want the cache key for the Anthropic provider to be the system message byte-string, so that stable prefixes hit cache.
41. As a **user**, I want structured JSON logs of `usage.cache_read_input_tokens` per request, so that I can measure cache hit rate.
42. As a **user**, I want request hit rate >70% in real session (>10 turns), so that the cache trick actually pays off.
43. As a **user**, I want token cache coverage = Σ cache_read / Σ total_prompt_tokens, so that I can see utilization, not just request count.
44. As a **user**, I want the **provider cache** (Anthropic `cache_control: ephemeral`) and the **augmented cache** (fingerprint semântico, v3.1+) to be clearly distinguished, so that I don't confuse them. **← §17.1**
45. As a **user**, I want the MVP to use **only provider cache** (omit `cacheHit` field from `/augment` response), so that we ship what's validated, not speculate.

### G. Edge cases & contracts

46. As a **user**, I want `/augment` to return 200 with empty match arrays + `emptyReason: "no_active_items"` when active catalog is empty, so that the agent still gets a response. **← D-008**
47. As a **user**, I want forward-on-error (fail-open) for any retrieval or augmentation failure, so that the agent is never blocked.
48. As a **user**, I want mode prompt-only (no agent state) to work as fallback, so that v1-style flow keeps functioning.

### H. Security / Privacy

49. As a **user**, I want zero persistence of raw context (only redacted), so that audit log doesn't leak secrets.
50. As a **user**, I want `tenantId` hashed in all logs (sha256[0:16]), so that observability is privacy-safe.
51. As a **user**, I want no data leaving my machine (proxy = local only), so that I don't accidentally exfiltrate.
52. As a **user**, I want placeholders determinísticos não vazam secret em audit, so that template substitution is safe.

### I. Operational / endpoints

53. As a **developer**, I want `/health` endpoint for liveness/readiness, so that latency gating §10.2 has a heartbeat. **← D-009**
54. As a **developer**, I want `/audit/summary` for daily rollups, so that I can see trends in Phase 7 tuning.
55. As a **developer**, I want `/catalog/rebuild` to be idempotent and safe to run mid-request, so that I can iterate on Skills without downtime.
56. As a **developer**, I want `/catalog` (GET) to return full catalog YAML+embeddings for debugging, so that I can inspect what's loaded.
57. As a **developer**, I want `/audit` (GET) to return last N augmentations (redacted), so that I can debug what got injected.
58. As a **developer**, I want all 5 endpoints (`/augment`, `/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`) owned by Phase 5, so that there's a single owner for endpoint surface.

### J. Critical Rules contract

59. As a **user**, I want `critical: true` Rules to always be included if active in panel, so that safety rails are guaranteed.
60. As a **user**, I want toggle-off without confirmation to be blocked (server enforça + UI gate), so that Critical Rules can't be accidentally disabled.
61. As a **user**, I want toggle-off WITH explicit confirmation accepted, so that I can override atomic rules when I have explicit intent.
62. As a **user**, I want Critical Rules shown with UI warning "always on, can't toggle off without confirmation", so that UX makes atomicity visible.

### K. Nomenclature & invariants

63. As a **developer**, I want `recentFiles` (camelCase) as canonical term for git status modified files, NOT `gitStatus`/`files`/`recent_files`, so that drift is eliminated.
64. As a **developer**, I want `lastEvent` (camelCase) as canonical term for last agent event, NOT snake_case variants, so that casing is consistent.
65. As a **developer**, I want `intel` to mean specifically `{ agentState: string, nextNeeds: string[], recentTopic: string }` — no other shapes — so that writer-reader contract is precise. **← D-005**
66. As a **developer**, I want `emptyReason` enum to include `"no_active_items"` as a valid value, so that activeCatalog vazio is explicit, not aliased to timeout/null. **← D-008**

### L. Acceptance criteria coverage

67. As a **product owner**, I want PRD §10 acceptance criteria (23 items) mapped to phases, so that every checkbox has owner + validator.
68. As a **product owner**, I want the spec to include a complete working set breakdown (~1GB RAM), so that hardware requirements are explicit.
69. As a **product owner**, I want 10 invariantes sólida (v1 mantidas) + 6 invariantes novas (v3 introduz) documented, so that regressions are detectable.
70. As a **product owner**, I want total estimate 35-50h single-dev documented, so that planning is honest.

---

## Implementation Decisions

### IMod-1: Module breakdown

| Module | Path | Size | Phase |
|---|---|---|---|
| `@memory-studio/sdk` | `packages/sdk/` | ~50KB TypeScript, zero native deps | Phase 3 |
| `@memory-studio/server` | `packages/server/` | Fastify + SQLite + ONNX | Phase 5 |
| `@memory-studio/ui` | `packages/ui/` | HTMX + Alpine, ~50KB browser | Phase 4 |
| `config/catalog/<id>.yaml` | repo root | Skills/Rules/Personas (git-versioned) | Phase 1 |
| `.memory-studio/state.json` | per-project | toggle state per project | Phase 4 |

### IMod-2: SDK API surface

```typescript
// packages/sdk/src/index.ts
export async function collectContext(opts: {
  scratch?: string              // últimos N chars do scratch local
  todos?: { status: string; text: string }[]
  recentFiles?: string[]        // paths modificados (git status)
  lastEvent?: {
    type: "tool_error" | "tool_call" | "tool_result"
    severity?: "warning" | "error" | "critical"
    payload: unknown
  }
  redaction?: "minimal" | "strict"   // default "minimal"
}): Promise<Context>

export async function fingerprint(opts: {
  projectPath: string
  agentId: string               // MVP: "claude-code"
  sessionId: string             // hasheado sha256[0:16] antes de sair
  gitBranch: string
}): Promise<Fingerprint>

export class MemoryStudioClient {
  constructor(opts: { baseURL: string; tenantId: string })
  async augment(req: AugmentRequest): Promise<AugmentResponse>
}
```

### IMod-3: /augment request schema (PRD §7.1)

```typescript
type AugmentRequest = {
  prompt: string                                    // obrigatório
  context?: {                                       // opcional, presente se SDK coletou
    scratch?: string                                // <= 384 tokens
    todos?: { status: string; text: string }[]      // <= 64 tokens serializados
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
    projectPath: string
    agentId: string                                  // "claude-code" (MVP)
    sessionId: string                                // hasheado
    gitBranch: string
  }
  activeCatalog: string[]                            // IDs ativos do .memory-studio/state.json
  tenantId: string                                   // hasheado
  schemaVersion: 3
}
```

### IMod-4: /augment response schema (PRD §7.1)

```typescript
type AugmentResponse = {
  systemMessage: string                            // byte-string cacheável
  matchedSkills: { id: string; score: number; source: "builtin" | "user" }[]
  matchedRules: { id: string; score: number; critical: boolean }[]
  matchedPersonas: { id: string; score: number; isDefault: boolean }[]
  // MVP: cacheHit OMITIDO (v3.1+). Métrica de cache hit é via log estruturado.
  pruningDecisions: {
    rejectedByFloor: { id: string; reason: string }[]
    rejectedByBudget: { id: string; reason: string }[]
    rejectedByAttentionTier: { id: string; reason: string }[]   // MVP: sempre []
    rejectedByNegativeFeedback: { id: string; reason: string }[]
    rejectedByCriticalDropped: { id: string; reason: string }[]
  }
  latencyMs: { embedding: number; retrieval: number; rerank: number; total: number }
  decisionTraceId: string                            // link pro audit log
  warnings: string[]
  emptyReason?: "low_confidence" | "social" | "timeout" | "no_active_items" | null  // ← D-008
  schemaVersion: 3
}
```

### IMod-5: Intel schema (writer-reader contract — D-005)

```typescript
type Intel = {
  agentState: string       // free-text, o que o agente estava fazendo
  nextNeeds: string[]      // structured tags, o que o agente provavelmente vai precisar
  recentTopic: string      // free-text, foco atual
}
```

**Writer:** fast agent (default `MiniMax-M2.7-highspeed`, configurável) ao final de Turn N. Lê R_N, gera Intel, persiste no store.
**Reader:** match pipeline no início de Turn N+1. Carrega Intel do store.
**Invariante:** schema drift entre writer/reader quebra inception híbrida silenciosamente. Phase 6 implementa contra este shape literal.

### IMod-6: Catalog schema (YAML — PRD §6)

```yaml
# Skill (PRD §6.1)
id: auth-jwt-01
type: skill
title: How to set up JWT auth
category: procedural          # procedural | diagnostic | reference | pattern
text: |
  # Setup
  1. Install `jsonwebtoken`
  2. Generate RS256 keys

# Rule (PRD §6.2)
id: rule-no-secrets-01
type: rule
critical: true               # atômico, sempre injetado se ativo
text: "Never commit secrets, .env files, or API keys to git."

# Persona (PRD §6.3)
id: engineer-pragmatic-01
type: persona
isDefault: true             # 1 slot garantido (se user configurar)
text: |
  You are a pragmatic senior engineer. Write clean, maintainable code.
```

### IMod-7: Retrieval pipeline (Phase 5 runtime — PLAN §5)

```
1. Query FTS5 (text match sobre `text` de cada item)
2. Query sqlite-vec (cosine similarity, 384d)
3. RRF (Reciprocal Rank Fusion) sobre resultados
4. Threshold duplo: min_cosine_similarity + min_fts_hits
5. Top-K candidatos
6. **Tiebreak ordering:** Array.sort((a,b) => a.id.localeCompare(b.id))  ← D-006
7. Serializar system message byte-string determinístico
8. SHA256(byte-string) = cache key do provedor
```

### IMod-8: Audit log boundary (D-007 CRITICAL)

**Async buffer + batch flush + fail-open:**

```typescript
// Pattern (não código final):
const auditBuffer: AuditEvent[] = []
let flushScheduled = false

function enqueueAudit(ev: AuditEvent) {
  auditBuffer.push(ev)
  if (!flushScheduled) {
    flushScheduled = true
    setTimeout(flushAudit, 100)  // ou flush quando N events atingirem
  }
}

async function flushAudit() {
  const batch = auditBuffer.splice(0, auditBuffer.length)
  try {
    await sqlite.insertAuditEvents(batch)
  } catch (err) {
    console.error("[audit] write failed, dropped", batch.length, "events:", err)
    // FAIL-OPEN: request NÃO bloqueia
  } finally {
    flushScheduled = false
  }
}
```

**Invariante:** request nunca bloqueia por audit log. Erro → stderr + continue. Request retorna 200.

### IMod-9: Cache architecture (PRD §17.1)

| Cache | O que | Onde mora | Métrica | Status |
|---|---|---|---|---|
| **Cache do provedor** (Anthropic) | `cache_control: ephemeral` no system message augmenté. TTL 5min. Hash byte-string = chave. | Anthropic API (server-side) | Log estruturado `usage.cache_read_input_tokens` (request hit rate + token cache coverage) | **MVP** |
| **Cache de augmented** (fingerprint semântico) | Fingerprint sobre byte-string final, pra hit entre inputs semanticamente equivalentes mas byte-diferentes | Memory Studio (in-memory) | Campo `cacheHit: "exact" \| "semantic" \| "miss"` na response | **v3.1+** (omitido no MVP) |

**Regra:** métricas de aceitação MVP (§10.2) usam log do cache do provedor, NÃO campo `cacheHit` da response.

### IMod-10: Endpoint surface ownership (D-009)

| Endpoint | Owner Phase | Validation |
|---|---|---|
| `/augment` | Phase 5 | smoke test + SHA256 byte-string equality |
| `/catalog` | Phase 5 (read Phase 1 data) | GET returns full catalog YAML+embeddings |
| `/catalog/rebuild` | Phase 5 (writes Phase 1 index) | idempotent, safe during requests |
| `/audit` | Phase 5 | last N augmentations, redacted |
| `/audit/summary` | Phase 5 (Phase 7 uses) | daily rollups, <100ms for 30 days |
| `/health` | Phase 5 | liveness + readiness, REQUIRED for §10.2 latency gating |
| `/state/toggle` | Phase 5 (consumed by Phase 4 UI) | POST `{itemId, action, critical_confirm?}`; toggle Rule critical sem confirmação → 400 |

### IMod-11: ~~Branch B fallback (D-003)~~ REMOVIDO 2026-07-28

**Branch B eliminado.** Phase 6b agora é mandatório — sem fork condicional.

Rationale:
- §16.4 engineering decisions resolvidas (in-process Haiku / SQLite / embedding pipeline / template / persona anchor).
- Usuário commitou ao produto standalone (não OmniRoute extension) e à arquitetura NOVEL.
- Phase 6a (Grill + POC) funciona como validation gate empírico, não binary fork.
- Se POC reprova, decisão humana é ajustar, não collapsar.
- Total fixo: 45-69h raw / 41-55h canonical (post-MiMo).

D-003 (Branch B ausente, original) foi resolvido na primeira wave adicionando Branch B como hedge. Branch B agora removido por decisão humana 2026-07-28.

### IMod-12: Active catalog vazio contract (D-008)

`/augment` quando `activeCatalog = []`:
- HTTP 200
- `systemMessage`: byte-string determinístico do persona prefix sozinho
- `matchedSkills/Rules/Personas`: arrays vazios `[]`
- `emptyReason: "no_active_items"` (novo enum value)
- `warnings`: `["activeCatalog is empty — proceeding with persona only"]`
- `pruningDecisions`: todas as razões com arrays vazios
- Forward unchanged pro provedor (não inject defaults, não reject)

Cache key estável porque byte-string é determinístico.

### IMod-13: Architectural decisions (PRD §8 — 16 invariantes total)

**Invariantes sólidas (v1 mantidas, v3 não toca):**

1. Node-only, zero Python no hot path
2. SQLite + FTS5 + sqlite-vec (vs Qdrant/Pinecone — benchmark v1 2026-Q2)
3. `cache_control: ephemeral` no system message augmenté
4. Catálogo versionado em git (YAML por item)
5. `tenant_id` hasheado no audit log (sha256[0:16])
6. Detector social via regex (prompt bypassa retrieval)
7. Threshold duplo no retrieval (`min_cosine_similarity` + `min_fts_hits`)
8. Modos de integração (proxy/hook/MCP)
9. Mem0 não entra (ortogonal)
10. Catálogo NÃO tem auto-melhoria (no discovery signals, no curator LLM)

**Invariantes novas (v3 introduz):**

11. 🆕 2 blocos `cache_control: ephemeral` (persona estável vs Skills variáveis)
12. 🆕 Critical Rules atômicas (sempre injetadas se ativas no painel)
13. 🆕 Response com `pruning_decisions` (debug-first)
14. 🆕 State local do agente entra no match (`recentFiles`, `scratch`, `todos`, `lastEvent`)
15. 🆕 **Audit log async + fail-open** (D-007): writes bufferizados, batch flush, fail-open em erro. Request **nunca bloqueia** — invariante crítica pra honrar p50<50ms.
16. 🆕 Inception híbrida (response-first + latency trick) — ver §16

### IMod-14: Stack breakdown (PRD §8 — table)

| Componente | Ferramenta | Tamanho |
|---|---|---|
| Runtime | Node.js 22 LTS | já tem |
| HTTP server | Fastify | ~5MB |
| Banco | SQLite + FTS5 + sqlite-vec | ~10MB |
| Embedding local | multilingual-e5-small (ONNX, 384d) | ~470MB |
| ~~Reranker local~~ | ~~ms-marco-MiniLM-L-6-v2 (ONNX)~~ | ~~~90MB~~ (v3.1+ — removido do MVP) |
| UI | HTMX+Alpine (MVP) | ~50KB JS browser |
| SDK cliente | TypeScript puro, ~50KB | 0 deps nativas |

### IMod-15: Working set breakdown (~1GB RAM — PRD §8)

| Componente | Tamanho |
|---|---|
| Embedding (multilingual-e5-small ONNX) | ~470MB |
| ~~Reranker (ms-marco-MiniLM-L-6-v2 ONNX)~~ | ~~~90MB~~ (v3.1+) |
| SQLite cache + sqlite-vec | ~10MB |
| Fastify + Node runtime baseline | ~200MB |
| ONNX runtime overhead + file cache | ~125MB |
| Misc (audit log buffer, catalog cache) | ~100MB |
| **Total** | **~905MB (arredondado ~1GB, sem reranker)** |

Roda em qualquer máquina com 4GB livres.

### IMod-16: Latency budgets (PRD §10.2)

| Métrica | Budget | Phase que honra | Validação |
|---|---|---|---|
| p50 latência | < 50ms | Phase 5 (proxy + audit async) | Phase 7 (1 semana real) |
| p99 latência | < 200ms | Phase 5 (com embedding) | Phase 7 |
| Working set | < 1.5GB | Phase 5 (deploy) | Phase 7 |
| Cache hit rate | > 70% (>10 turns) | Phase 5 (logging) + Phase 7 (mede + ajusta) | Phase 7 |

### IMod-17: Modes of integration (PRD §3 table)

| Modo | Status MVP | Cache preservado | Agentes |
|---|---|---|---|
| **Proxy (baseURL custom)** | ✅ MVP | ✅ Sim | Claude Code (MVP); demais v3.1+ |
| **Hook** | v3.1+ (fallback) | depende | Agentes com hook system (v3.1+) |
| **MCP** | v3.1+ | ✅ Sim | Cline v2+, Cursor (v3.1+) |

### IMod-18: Phase plan (PLAN v2)

| Phase | Estimate | Deliverables |
|---|---|---|
| 0 — Environment Validation (novo, MiMo 2026-07-28) | 1-2h | Node 22, onnxruntime-node, SQLite FTS5 + sqlite-vec, multilingual-e5-small ONNX, permissões filesystem |
| 1 — Schema + Catálogo | 6-8h | YAML schema, SQLite (catalog/embeddings/audit_events/intel), FTS5, sqlite-vec, loader, `npm run build-index`, schema versioning |
| 2 — Detector social + fingerprint | 2-3h | Detector social (regex), fingerprint 4-comp, hashing básico, audit schema |
| 3 — SDK cliente | 3-4h | `@memory-studio/sdk`, `collectContext`, `fingerprint`, `MemoryStudioClient.augment`, prompt-only mode |
| 4 — UI painel | 8-12h | Painel localhost, 5 telas, HTMX+Alpine, `.memory-studio/state.json`, Critical Rules warning |
| 5 — Proxy transparente | 6-8h | Forwarder HTTP, retrieval runtime, byte-string determinístico, tiebreak ordering (D-006), audit async fail-open (D-007), 5 endpoints (D-009) |
| 6 — Fast agent + Intel pipeline (mandatory, MiMo §16.4) | 12-16h | Fast agent (Haiku) in-process, intel store (SQLite WAL), match script (intel + prompt + catalog), suffix injection (template 2-block `cache_control: ephemeral`), latency trick, contract validation |
| 7 — Tuning empírico | 5-7h (+ 1 semana coleta) | Dashboard mínimo, métricas cache hit, threshold tuning, aceitação >70% |
| **Total** | **45-69h raw** (canonical 41-55h) | (Phase 6b mandatory desde 2026-07-28 — Branch B removido) |

### IMod-19: Acceptance criteria mapping (PRD §10 → 23 items, 100%)

#### §10.1 Funcional (12)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | Lê prompt + estado (scratch, todos, recentFiles, lastEvent) | Phase 3 + Phase 5 | Phase 5 done |
| 2 | Top 3-5 skills/rules/personas identificados | Phase 5 | Phase 5 done |
| 3 | System message byte-string determinístico | Phase 5 | Phase 5 done (SHA256) |
| 4 | `cache_control: ephemeral` em 2 blocos | Phase 5 | Phase 5 done |
| 5 | Cache hit verificado via log | Phase 5 + Phase 7 | Phase 7 |
| 6 | UI mostra catálogo + toggle por projeto | Phase 4 | Phase 4 done |
| 7 | Critical Rules: aviso visual + imunes a toggle off | Phase 4 + Phase 5 | Phase 4 done |
| 8 | Audit log grava tudo | Phase 5 | Phase 5 done |
| 9 | Modo prompt-only funciona | Phase 3 | Phase 5 done |
| 10 | Funciona com 1 agente (Claude Code) | Phase 5 | Phase 5 done |
| 11 | `activeCatalog` vazio: 200 + emptyReason "no_active_items" + forward unchanged (D-008) | Phase 5 | Phase 5 done |
| 12 | Inception híbrida (CONDICIONAL grill §16.6) | Phase 6 | Phase 6 done |

#### §10.2 Performance (4)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | p50 latência < 50ms | Phase 5 | Phase 7 |
| 2 | p99 latência < 200ms | Phase 5 | Phase 7 |
| 3 | Working set < 1.5GB RAM | Phase 5 | Phase 7 |
| 4 | Cache hit rate > 70% (>10 turns) via log | Phase 7 | Phase 7 done |

#### §10.3 Segurança / Privacidade (4)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | Zero persistência de contexto raw | Phase 2 + Phase 5 | Phase 5 done |
| 2 | `tenantId` hasheado | Phase 2 + Phase 5 | Phase 5 done |
| 3 | Placeholders determinísticos não vazam secret | Phase 5 | Phase 5 done |
| 4 | Nenhum dado sai da máquina | Phase 5 + Phase 4 | Phase 5 done |

#### §10.4 Operacional (4 — incl. /health D-009)

| # | Critério | Phase owner | Validado em |
|---|---|---|---|
| 1 | `npm run build-index` < 60s pra 100 skills | Phase 1 | Phase 1 done |
| 2 | UI carrega < 1s local | Phase 4 | Phase 4 done |
| 3 | Audit query < 100ms pra 30 dias | Phase 5 + Phase 7 | Phase 7 |
| 4 | `/health` endpoint retorna 200 (D-009) | Phase 5 | Phase 5 done |

### IMod-20: Nomenclature rules (PRD §17.2)

**Termos canônicos — camelCase, exato:**

| Termo | Significado | Onde definido |
|---|---|---|
| `recentFiles` | Lista de paths de arquivos recentes (working tree). NÃO `gitStatus`, `files`, `recent_files`. | §5, §7.1 |
| `lastEvent` | Último evento do agente (`tool_error`/`tool_call`/`tool_result`). NÃO snake_case. | §5, §7.1 |
| `scratch` | Scratchpad local (últimos N chars). | §5, §7.1 |
| `todos` | TODOs ativos do agente. | §5, §7.1 |
| `intel` | `{ agentState, nextNeeds, recentTopic }` (D-005). Shape exato. | §16.5 |
| `activeCatalog` | Array de IDs ativos. Source = `.memory-studio/state.json`. | §7.1 |
| `emptyReason` | Enum: `low_confidence \| social \| timeout \| no_active_items \| null`. | §7.1, D-008 |
| `fast agent` | Default `MiniMax-M2.7-highspeed` (configurável via `.memory-studio/state.json` `fastAgent.model`, fallback `claude-3-5-haiku-*`). Anthropic-compatible API via `https://api.minimax.io/anthropic`. Lê response em paralelo com humano. | §16 |
| `fast-agent-over-response` | Padrão arquitetural. | §16.3 |

**Regra:** PRD, PLAN, SPEC, SDK, schema, response — todos usam casing canônico. Drift = discovery.

---

## Testing Decisions

### T-1: What makes a good test

**Test external behavior only, NOT implementation.**

For Memory Studio:
- HTTP behavior of `/augment` + 5 endpoints
- Cache hit rate measured via structured logs
- Smoke test com Claude Code via custom baseURL
- Latência p50/p99 vs §10.2 budget
- Byte-string SHA256 equality entre identical-input requests (D-006)
- Audit log async fail-open sob write error simulado (D-007)
- emptyReason "no_active_items" quando activeCatalog vazio (D-008)

**Do NOT test:**
- Internal data structures (`Intel` literal shape, `matchedSkills` array layout)
- Specific embedding model behavior
- ONNX runtime details
- Pure UI rendering

### T-2: Modules to test

| Module | Tests |
|---|---|
| `@memory-studio/server` | HTTP routing, byte-string determinism + tiebreak (D-006), audit log async fail-open (D-007), 5 endpoints (D-009), emptyReason "no_active_items" (D-008), fail-open paths |
| `@memory-studio/sdk` | `collectContext`, `fingerprint` (hashing), `MemoryStudioClient.augment`, prompt-only fallback |
| Fast agent (Phase 6) | latency <3s, intel schema adherence (D-005), latency trick validation |
| UI | toggle state, Critical Rules warning, search, audit/summary display |
| Retrieval | FTS5 + sqlite-vec query, RRF fusion, threshold duplo |

### T-3: Prior art

- v1 phases 0-4 calibration tests (alguns ainda válidos, outros migrados)
- Auto-grill artifact pack (transcript + decisions) usado como adversarial test oracle — toda claim em PRD/PLAN foi grilled por 9 decisions across 8 lenses
- `critica-plan.md` (2026-07-27) external review pre-auto-grill — 37 findings (17 PRD + 17 PLAN + 5 crossed), 32 aplicados

### T-4: Done criteria Phase 5 (smoke test antes de Phase 6)

- [ ] Smoke test end-to-end com Claude Code via custom baseURL
- [ ] Byte-string determinístico validado: SHA256(byte-string) **igual** entre 2 requests com mesma input lógica
- [ ] **Tiebreak ordering testado** (D-006): 2 requests com cosine scores empatando no threshold produzem mesmo SHA256
- [ ] Cache hit do provedor verificado em log: `cache_read_input_tokens > 0` em 2 requests seguidos
- [ ] Retrieval retorna top-K com hit no índice (FTS5 + sqlite-vec)
- [ ] **Audit async boundary testado** (D-007): simulando SQLite write error → request continua 200
- [ ] `usage.cache_read_input_tokens` logado por request
- [ ] **5 endpoints respondendo** (D-009): `/augment`, `/catalog`, `/catalog/rebuild`, `/audit`, `/audit/summary`, `/health`

---

## Out of Scope (v3.1+ ou v4+)

- Long-term memory of user preferences (v4+)
- Multi-tenant (v4+)
- Cross-project catalog registry (v4+)
- Adapter OpenAI↔Anthropic (v3.1+)
- Hook integration mode (v3.1+)
- MCP server (v3.1+)
- Catálogo em 3 camadas (system/global/local) — v3.1+ if demand
- Discovery signals + curator LLM (v3.2+)
- Attention tiers / relevance-decay / tier escalation — v3.1+ if metrics show degradation
- Semantic cache 2-tier (fingerprint cache sobre byte-string) — v3.1+
- Persona `tone_addendum` — v3.1+
- Handoff middleware-managed — **FORA**, handoff é decisão do agente/SDK
- User-invoked precedência absoluta — v3.1+
- Per-turn feedback vote persistente — v3.1+
- Decision trace visualization interativa — v3.2+
- Glossário anchors boost — v3.1+
- Leading words hoisting — v3.1+

**Regra:** nada disso entra sem **evidência empírica** de que faz falta.

---

## Discovery Resolutions (D-001 a D-009)

Todas as 9 discoveries do auto-grill composite run 2026-07-28_023050, aplicadas em PRD/PLAN post-gate 2026-07-28:

| ID | Severidade | Descrição | Resolução |
|---|---|---|---|
| D-001 | structural | Drift §18→§16 em PLAN.md:241,254,375 | ✅ aplicado: §18.x → §16.x (3 ocorrências) |
| D-002 | structural | Drift interno PLAN Phase 1/5 body vs table estimates | ✅ aplicado: L93, L214 body alinhados com tabela |
| D-003 | structural | Branch B ausente | ✅ aplicado: PLAN Phase 6 Branch B + Phase 7 pre-reqs loosen |
| D-004 | cosmetic | Critical Rules redação ambígua | ✅ contrato já coerente (3 docs concordam); optional example em §6.2 |
| D-005 | structural | `intel` sem schema formal | ✅ aplicado: PRD §16.5 typed schema + §17.2 glossary |
| D-006 | structural | Tiebreak policy ausente | ✅ aplicado: PLAN Phase 5 `Array.sort` + SHA256 done criterion |
| D-007 | critical | Audit log sync/async não declarado | ✅ aplicado: PLAN Phase 5 async buffer + fail-open + PRD §8 invariant |
| D-008 | structural | Empty activeCatalog sem contrato | ✅ aplicado: PRD §7.1 enum + contract + §10.1 criterion |
| D-009 | structural | 5 endpoints sem ownership | ✅ aplicado: PLAN Phase 5 enumerated + §10.4 /health |

Severidade: 1 critical (D-007), 7 structural, 1 cosmetic.

---

## Cross-references

- [PRD.md v3.2](../../PRD.md) — decisões estratégicas ("por que X e não Y")
- [PLAN.md v2](../../PLAN.md) — phases + estimates + acceptance mapping
- [.specs/DISCOVERIES.md](../../.specs/DISCOVERIES.md) — 9 entries (D-001 a D-009)
- [.specs/auto-grill-output/2026-07-28_023050/](../../.specs/auto-grill-output/2026-07-28_023050/) — auto-grill run artifacts
- [CLAUDE.md](../../CLAUDE.md) — authority boundaries + glossary
- [BACKLOG.md](../../BACKLOG.md) — ideias pós-MVP

---

**Próximo passo:** Phase 1 do PLAN pode começar. Implementer + Verifier loop (Waldemar pattern) lê PRD + PLAN + esta SPEC.