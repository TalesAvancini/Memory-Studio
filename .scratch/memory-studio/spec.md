---
date: 2026-07-28
version: 1
type: to-spec output
description: "Spec Memory Studio MVP sintetizada via to-spec (post auto-grill)."
explanation: |
  Output do /mattpocock-skills:to-spec invocado 2026-07-28 após gate do
  auto-grill composite (PRD.md v3.2 + PLAN.md v2).

  Fontes:
  - PRD.md (decisões, §14 fechado, §17 glossário)
  - PLAN.md (7 phases + acceptance criteria mapping)
  - .specs/auto-grill-output/2026-07-28_023050/PRD-PLAN.auto-grill.{transcript,decisions,loop-state}.md
  - .specs/DISCOVERIES.md (D-001 a D-009)

  Auto-grill surfaced 9 decisions (todas aprovadas 2026-07-28 pelo humano).
  5 fixes já aplicados em PLAN.md (drift §18→§16, body estimates);
  6 fixes pendentes em PRD/PLAN (decisions 3, 5, 6, 7, 8, 9 — humano
  aplica pós-gate per SKILL.md §Gate contract).

  Esta spec é fresh synthesis do conversation context (não de decisions.md,
  per SKILL.md §Companion skills). Memento behavior: re-invocation gera
  fresh synthesis, não append nem overwrite (memory to-spec-actual-behavior).
related:
  - ../../PRD.md
  - ../../PLAN.md
  - ../../.specs/auto-grill-output/2026-07-28_023050/
  - ../../.specs/DISCOVERIES.md
  - ../../CLAUDE.md
---

# Memory Studio — Spec (post auto-grill)

**Date:** 2026-07-28
**Source:** `/mattpocock-skills:to-spec` após auto-grill gate (run 2026-07-28_023050)
**Companion:** PRD.md v3.2 + PLAN.md v2 + 9 auto-grill decisions approved

---

## Problem Statement

Code agents (Claude Code, Aider, Cursor, Cline, Mavis...) são genéricos. O humano controla o comportamento do agente via system prompt + tools + skills locais, mas o controle é difuso: skills, rules, personas ficam espalhadas em git, prompts ad-hoc, e configurações do agente. Quando o humano digita um prompt, o agente recebe system message **inalterado** entre requests que compartilham contexto lógico — então o humano paga custo total de raciocínio a cada turn, mesmo quando o estado do agente pouco mudou.

**Problema central:** o humano quer que o agente "já saiba o que importa" pra cada prompt, sem ter que copiar/colar skills ou re-explicar contexto toda vez. Mas (a) re-escrever o system message a cada turno quebra o cache do provedor (Anthropic `cache_control: ephemeral`); e (b) ferramentas existentes (LiteLLM, Portkey, OpenRouter, 9Router, OmniRoute) só fazem cache estável — nenhum processa response-side pra acumular intel pro próximo turno.

## Solution

**Memory Studio** = middleware local entre o agente e o provedor. Intercepta request, lê prompt + estado do agente (scratch, todos, recentFiles, lastEvent), monta system message augmenté com catálogo ativo (Skills/Rules/Personas versionadas em git), encaminha pro provedor. Cache hit preservado via byte-string determinístico: prefixo (persona) intacto, sufixo (Skills) é a única parte variável.

**Inception híbrida (NOVEL):** Turn N vai plain pro provedor (sem augmentação — cold start, sem intel prévia). Fast agent (Haiku-class) lê response em paralelo com humano, gera `intel = { agentState, nextNeeds, recentTopic }` (schema definido em PRD §16). Turn N+1 augmenta system message com (intel + prompt + context + catalog). **Latency trick:** fast agentuality roda durante a leitura humana — humano leva ~5-30s lendo, fast agent leva ~1-3s processando. Intel pronto antes do humano digitar próximo turn. Zero penalty percebido.

**Painel UI** (HTMX+Alpine, localhost primeira porta livre): humano controla Skills/Rules/Personas ativas por projeto via state.json (`.memory-studio/state.json`). Critical Rules atômicas (imunes a toggle off sem confirmação explícita).

**Modos de integração:** proxy transparente (MVP, preserva cache byte-a-byte). Hook e MCP = v3.1+.

**Modo prompt-only** (v1 compat): se contexto é null, augmenta com match só de prompt (sem estado do agente). Fallback gracioso.

## User Stories

### A. Configuração inicial

1. As a **developer** setting up Memory Studio, I want to run `npm install` and have it self-configure (SQLite schema, embeddings index, default catalog), so that I can start using it in <5min.
2. As a **developer**, I want to mount the UI panel at `http://127.0.0.1:<porta-livre>`, so that I don't need to fight a fixed port or container setup.
3. As a **developer**, I want the SDK to be a TypeScript package (~50KB, zero native deps), so that I can embed it in any agent without bundler pain.
4. As a **developer**, I want to add a new Skill by editing a YAML file in `config/catalog/<id>.yaml`, so that I can version skills in git like code.
5. As a **developer**, I want `npm run build-index` to regenerate embeddings in <60s for 100 skills, so that adding a skill is fast.
6. As a **developer**, I want to migrate v1 calibration state (`.specs/archive/2026-07-calibration/STATE.md`) into Memory Studio's schema, so that the invariant SQLite design isn't invented from scratch.

### B. Painel UI (controle)

7. As a **human** working with a code agent, I want a panel that lists Skills/Personas/Rules in columns, so that I can scan what's available at a glance.
8. As a **human**, I want to search by name/keyword across Skills/Personas/Rules, so that I can find relevant items fast.
9. As a **human**, I want a side panel that shows full content of an item when I select it, so that I can read without losing context.
10. As a **human**, I want to toggle a Skill on/off per project (`.memory-studio/state.json`), so that I can scope what each codebase gets.
11. As a **human**, I want Critical Rules shown with a visual warning ("always on, can't toggle off without confirmation"), so that I don't accidentally disable safety rails.
12. As a **human**, I want to toggle confirmation for Critical Rules off, so that I can override atomic rules when I have explicit intent.
13. As a **human**, I want at most 3 Personas active at once, so that the system message stays coherent.
14. As a **human**, I want the Audit tab to show last N augmentations (timestamp, prompt redacted, matched IDs, pruning reasons, latency), so that I can debug what got injected.
15. As a **human**, I want the Settings tab to show threshold (min_cosine_similarity, min_fts_hits), tenant, integration mode, embedding model, so that I can tune retrieval.

### C. Hot path (request flow)

16. As a **Claude Code user**, I want `/augment` to add Skills to my system message before each request, so that my agent already knows context.
17. As a **user**, I want the system message byte-string to be deterministic (same input → same SHA256), so that the Anthropic cache hit works.
18. As a **user**, I want matched arrays (matchedSkills/Rules/Personas) to be deterministically ordered (lexicographic by id tiebreaker), so that RRF ties don't break byte-string silently.
19. As a **user**, I want audit log writes to be async (batch flush, fail-open on write error), so that request latency stays under p50<50ms.
20. As a **user**, I want p50 latency <50ms (request without embedding cache miss), so that Memory Studio is invisible in normal flow.
21. As a **user**, I want p99 latency <200ms (with embedding), so that worst-case is bounded.
22. As a **user**, I want working set <1.5GB RAM, so that it runs on any 4GB machine.

### D. Inception híbrida (Phase 6, gated)

23. As a **user**, I want Turn N to go plain to the provider (no augmentação, cold start), so that the first request doesn't suffer latency.
24. As a **user**, I want a fast agent (Haiku-class) to read response in parallel with my reading, so that intel is ready when I type the next turn.
25. As a **user**, I want Turn N+1 to augment with `intel = { agentState, nextNeeds, recentTopic }` from previous turn, so that context flows across turns without re-prompting.
26. As a **user**, I want the fast agent to finish in <3s, so that latency trick works (human reads take 5-30s).
27. As a **user**, I want the fast agent to be in-process (no separate daemon), so that there's no extra service to manage.

### E. Cache & metrics

28. As a **user**, I want the cache key for the Anthropic provider to be the system message byte-string, so that stable prefixes hit cache.
29. As a **user**, I want structured JSON logs of `usage.cache_read_input_tokens` per request, so that I can measure cache hit rate.
30. As a **user**, I want request hit rate >70% in real session (>10 turns), so that the cache trick actually pays off.
31. As a **user**, I want token cache coverage = Σ cache_read / Σ total_prompt_tokens, so that I can see utilization, not just request count.

### F. Edge cases

32. As a **user**, I want `/augment` to return 200 with empty match arrays + `emptyReason: "no_active_items"` when active catalog is empty, so that the agent still gets a response.
33. As a **user**, I want forward-on-error (fail-open) for any retrieval or augmentation failure, so that the agent is never blocked.
34. As a **user**, I want mode prompt-only (no agent state) to work as fallback, so that v1-style flow keeps functioning.

### G. Security / Privacy

35. As a **user**, I want zero persistence of raw context (only redacted), so that audit log doesn't leak secrets.
36. As a **user**, I want `tenantId` hashed in all logs (sha256[0:16]), so that observability is privacy-safe.
37. As a **user**, I want no data leaving my machine (proxy = local only), so that I don't accidentally exfiltrate.

### H. Operational

38. As a **developer**, I want `/health` endpoint for liveness/readiness, so that latency gating §10.2 has a heartbeat.
39. As a **developer**, I want `/audit/summary` for daily rollups, so that I can see trends in Phase 7 tuning.
40. As a **developer**, I want `/catalog/rebuild` to be idempotent and safe to run mid-request, so that I can iterate on Skills without downtime.

### I. Inception híbrida fallback

41. As a **developer**, I want a clear branch B in PLAN that says "if grill §16.6 reproves, Phase 6 collapses to 0h and Phase 7 pre-reqs loosen to Phase 5 only", so that MVP closes without inception híbrida as a real tree, not a footnote.

## Implementation Decisions

### ID-1: Single seam — `/augment` endpoint

The highest seam in this codebase is the `/augment` HTTP endpoint. Everything else (UI panel, SDK, fast agent, persistence) is internal. Tests should probe `/augment` behavior end-to-end with Claude Code via custom `baseURL`. No new seams needed beyond the existing Fastify router + SQLite.

### ID-2: Inception híbrida — `intel` schema (TypeScript shape)

```typescript
type Intel = {
  agentState: string       // free-text, what the agent was doing
  nextNeeds: string[]      // structured tags, what agent will probably need next
  recentTopic: string      // free-text, current focus
}
```

This is the writer-reader contract between fast agent (§16.2) and match pipeline (§3 Turn N+1). Defined before Phase 6 starts so the implementation has a shape to fill.

### ID-3: Deterministic ordering — lexicographic by id tiebreaker

After RRF fusion, before serializing to system message:

```typescript
matched.sort((a, b) => a.id.localeCompare(b.id))
```

Without this, RRF ties near the cosine threshold cause byte-string drift between identical-input requests, silently breaking the Anthropic cache hit. Verified by Phase 5 done criterion: SHA256(byte-string) equality between two requests with same logical input.

### ID-4: Audit log — async buffer with batch flush + fail-open

Audit log writes are queued to an in-memory buffer. Background worker flushes every N events or T ms (whichever first). On write error, log to stderr and continue — never block the request. This is the only way to honor p50<50ms budget while satisfying §10.1 item 8 (audit every request).

### ID-5: Empty activeCatalog — explicit contract

When `activeCatalog` is empty: return 200 with deterministic unaugmented system message, empty match arrays, `emptyReason: "no_active_items"` (new enum value), warning/audit marker, forward unchanged to provider. Cache key stable because byte-string is deterministic.

### ID-6: Branch B — fallback if inception híbrida grill reproves

If PRD §16.6 grill reproves Phase 6:
- Phase 6 estimate collapses to 0h (no Fast agent work).
- Phase 7 pre-reqs loosen to "Phase 5" (cache hit metric §10.2.4 is reachable via Phase 5's byte-string + cache_control ephemeral + structured log, no Phase 6 needed).
- Total estimate drops from 35-50h to 28-39h.
- MVP closes with `Inception híbrida (CONDICIONAL)` checkbox moved to v3.2 per PRD §10.1.

Branch is a tree, not a footnote.

### ID-7: Endpoint surface — explicit ownership

| Endpoint | Owner Phase | Validation |
|---|---|---|
| `/augment` | Phase 5 | smoke test + SHA256 byte-string equality |
| `/catalog` | Phase 5 (read Phase 1 data) | GET returns full catalog YAML+embeddings |
| `/catalog/rebuild` | Phase 5 (writes Phase 1 index) | idempotent, safe during requests |
| `/audit` | Phase 5 | last N augmentations, redactado |
| `/audit/summary` | Phase 5 (Phase 7 uses) | daily rollups, <100ms for 30 days |
| `/health` | Phase 5 | liveness + readiness, REQUIRED for §10.2 latency gating |

### ID-8: Critical Rules — atomic with explicit override

`critical: true` Rule is always included if active in panel. UI shows warning ("always on, can't toggle off without confirmation"). Server enforces — toggle-off without confirmation returns 400. Toggle-off WITH explicit confirmation accepted. Atomicity is "default-on, overrideable with intent", not "absolute".

### ID-9: Modules to build/modify

- `@memory-studio/sdk` — TypeScript SDK (~50KB, zero native deps). Phase 3.
- `@memory-studio/server` — Fastify + SQLite + ONNX embedder. Phase 5.
- `@memory-studio/ui` — HTMX + Alpine. Phase 4.
- `config/catalog/<id>.yaml` — Skills/Rules/Personas (git-versioned). Phase 1.
- `.memory-studio/state.json` — toggle state per project. Phase 4.

### ID-10: Architectural decisions (per v3 PRD/PLAN, all approved)

- Node-only, zero Python in hot path.
- SQLite + FTS5 + sqlite-vec (vs Qdrant/Pinecone — benchmark interno v1 2026-Q2).
- `cache_control: ephemeral` no system message augmenté.
- Catálogo versionado em git (YAML por item).
- `tenant_id` hasheado no audit log (sha256[0:16]).
- Detector social via regex (promover de v1 phases 0-4 calibração).
- Threshold duplo no retrieval (min_cosine_similarity + min_fts_hits).
- Modos de integração: proxy MVP, hook/MCP v3.1+.
- 2 blocos `cache_control: ephemeral` (persona estável vs Skills variáveis).
- Inception híbrida = arquitetura NOVEL, gated por grill §16.6.

## Testing Decisions

### TD-1: What makes a good test

Test external behavior only, not implementation. For Memory Studio, that means:
- HTTP behavior of `/augment` and the 5 endpoints.
- Cache hit rate measured via structured logs.
- Smoke test with Claude Code via custom baseURL.
- Latency p50/p99 against §10.2 budget.

Do NOT test:
- Internal data structures (`Intel`, `matchedSkills` array layout).
- Specific embedding model behavior.
- ONNX runtime details.

### TD-2: Modules to test

- `@memory-studio/server`: HTTP routing, byte-string determinism, audit log async, all 5 endpoints, fail-open paths.
- `@memory-studio/sdk`: `collectContext`, `fingerprint`, `MemoryStudioClient.augment`.
- Fast agent (Phase 6): latency, intel schema adherence, latency trick validation.

### TD-3: Prior art

- v1 phases 0-4 calibration tests (some may still be valid, others migrated).
- Auto-grill artifact pack (transcript + decisions) used as adversarial test oracle — every claim in PRD/PLAN was grilled by 9 decisions across 8 lenses.
- `critica-plan.md` (2026-07-27) external review pre-auto-grill.

## Out of Scope

- Long-term memory of user preferences (v4+).
- Multi-tenant (v4+).
- Cross-project catalog registry (v4+).
- Adapter OpenAI↔Anthropic (v3.1+).
- Hook integration mode (v3.1+).
- MCP server (v3.1+).
- Catálogo em 3 camadas (system/global/local) — v3.1+ if demand.
- Discovery signals + curator LLM (v3.2+).
- Attention tiers / relevance-decay / tier escalation — v3.1+ if metrics show degradation.
- Semantic cache 2-tier (fingerprint cache sobre byte-string) — v3.1+.
- Persona `tone_addendum` — v3.1+.
- Handoff middleware-managed — **FORA**, handoff é decisão do agente/SDK.

## Further Notes

### Auto-grill gate — what was approved

9 decisions across 8 lenses, all conf≥medium, all approved 2026-07-28. Full table at `.specs/auto-grill-output/2026-07-28_023050/PRD-PLAN.auto-grill.decisions.md`.

### Pending fixes (human applies post-gate per SKILL.md §Gate contract)

6 of 9 decisions need target-doc edits (PRD/PLAN/CLAUDE.md):

- D-003: Add branch B to PLAN.md Phase 6.
- D-005: Add `intel` schema to PRD §16 + glossary §17.2 + CONTEXT.md §5.
- D-006: Add `Array.sort((a,b) => a.id.localeCompare(b.id))` to PLAN.md Phase 5 + done criterion.
- D-007: Add "audit async buffer + batch flush + fail-open" to PLAN.md Phase 5 + invariant in PRD §8.
- D-008: Add `emptyReason: "no_active_items"` to PRD §7.1 + acceptance criterion.
- D-009: Enumerate 5 endpoints in PLAN.md Phase 5 + add /health to acceptance mapping.

### Already-applied edits (5 in PLAN.md, before "calma")

PLAN.md L93: "3-4h" → "4-5h" (Phase 1 body)
PLAN.md L214: "5-7h" → "6-8h" (Phase 5 body)
PLAN.md L241: "§18.6" → "§16.6"
PLAN.md L254: "§18.4" → "§16.4"
PLAN.md L375: "§18.6" → "§16.6"

### Discovery items appended to `.specs/DISCOVERIES.md`

D-001 through D-009 (1 critical, 7 structural, 1 cosmetic).

### Next step per skill (after this spec)

Human applies pending fixes manually. Then potentially `/mattpocock-skills:to-tickets` (mentioned in `.claude/skills/auto-grill/prompts/to-roadmap.md`) to break spec into vertical slices. Phase 1 of PLAN.md can start after that.