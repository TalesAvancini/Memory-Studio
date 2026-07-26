# Proposal — Memory Studio v2

**Data:** 2026-07-23
**Status:** draft baseado em entrevista de 41 rounds com NotebookLM (notebook `f235cc21-b876-483e-b8a7-20d6234fa35c`, Matt Pocock Interrogador)
**Origem:** síntese de `Memory-Studio-Discuss.md` + decisões da entrevista
**Decisor final:** humano
**Autoria:** Conselheiro (papel advisor, distinto de M3-CLI/M3-E que implementam)

---

## 0. TL;DR

Memory Studio v2 evolui de **prompt-only augmentation** para **full-context
augmentation** com:

1. **Middleware recebe contexto de trabalho rico** do agente (scratchpad, todos,
   arquivos recentes, last event), não só o prompt.
2. **Pipeline de 5 estágios** com attention-aware pruning, semantic cache 2-tier,
   glossary anchors, leading words hoisting, persona additivity.
3. **Catálogo em 3 camadas** (system < global < local) com shadowing atômico
   e fork CLI pra customização.
4. **Tier escalation on error** + feedback override (Diagnostic Skills bypass
   floor quando erro detectado).
5. **Handoff middleware-managed** pra transição limpa entre sessões saturadas.

**Compatibilidade:** v2 mantém todas as invariantes de v1 (sem LLM no hot path,
self-hosted, cache ephemeral, tenant_id hasheado). Adiciona superfície, não
quebra contrato.

**Custo de implementação:** Phase 2 (Augmenter) do PLAN §8 precisa ser
re-spec'iado. Estimativa adicional: ~12-18h single-dev sobre o MVP original.

---

## 1. Mudanças vs PLAN.md v1

| Aspecto | v1 (PLAN.md) | v2 (este doc) |
|---|---|---|
| Input do middleware | prompt only | prompt + context rico (scratch, todos, files, events) |
| Match semântico | embedding + FTS5 + rerank | + glossary anchors boost + leading words hoist |
| Cache key | exact hash do augmented msg | semantic 2-tier por fingerprint (catalog + augmented) |
| Budget | top-5 fixo | dinâmico por token budget + tier (smart/warm/hot/dumb) |
| Critical Rules | sem distinção | tudo-ou-nada atômico + atomicity guarantee |
| Personas | sem distinção | base + tone_addendum aditivo (cap 3) |
| User-invoked | não existe | precedência absoluta + 10% budget reserve + cap 3 |
| Feedback do user | não existe | positive/negative vote por fingerprint, SQLite local |
| Catalog versioning | não existe | pinning por fingerprint, dev hot-reload opt-in |
| Handoff entre sessões | não existe | middleware-managed, template structured, editável |
| Discovery signals | não existe | passive detection (unknown terms, low-confidence recurring) |

**O que NÃO muda:**

- Stack travada (Node 22, Fastify, SQLite, FTS5, sqlite-vec, ONNX, multilingual-e5-small)
- Sem LLM no hot path (invariante)
- Self-hosted only
- Catálogo versionado em git
- Cache ephemeral
- `tenant_id` hasheado
- Detector social (regex bypass)
- Threshold duplo (cosine + FTS5 hits)
- Modos de integração (proxy/hook/MCP)

---

## 2. Full-Context Augmentation (a grande mudança)

### 2.1 Problema

v1 match baseado em prompt-only. Limitação:

```
[Agente há 20min implementando OAuth]
[working state: scratch sobre JWT, todos ativos, files modificados]
[Usuário digita agora]: "tá dando erro 401"

Match prompt-only → "debug-401-01"     (superficial)
Match útil        → "auth-jwt-01"     (cobre o trabalho real)
```

**Resultado v1:** Skill menos relevante, agente precisa pedir mais contexto, mais turnos.

### 2.2 Solução

Middleware recebe **contexto de trabalho completo**:

```typescript
POST /augment
{
  "prompt": "tá dando erro 401",
  "context": {
    "scratch": "estou implementando OAuth flow completo...",
    "todos": [
      { "status": "done",        "text": "setup JWT lib" },
      { "status": "in_progress", "text": "criar middleware" },
      { "status": "pending",     "text": "testar" }
    ],
    "recent_files": ["src/auth/jwt-utils.ts", "src/middleware/auth.ts"],
    "last_event": {
      "type": "tool_error",
      "severity": "error",
      "payload": { "tool": "test", "exit_code": 1 }
    },
    "session_id": "hashed_xxx"
  },
  "tenant_id": "hashed_xxx"
}
```

Match considera pacote inteiro. Skill mais relevante ao trabalho real, não ao pedido isolado.

### 2.3 Pipeline de 5 estágios

```
[Request] → [Stage 1: Context Assembly]
              - Dedup semântico do scratch (score composto: 50% recency +
                30% density + 20% occurrence)
              - Sanitizer 3-layer (regex + entropy + middleware rescan)
              - Placeholders determinísticos (`[REDACTED:<sha256[0:8]>]`)
              - Cache key do embedding = hash do contexto composto

         → [Stage 2: Embedding]
              - e5-small (384d, ONNX local)
              - Cap 1024 tokens (composto: prompt 200 + scratch 384 +
                todos 64 + files 64 + error 200 + reserva 112)
              - Hierarquia de expulsão: files → todos → scratch → error → prompt

         → [Stage 3: Retrieval]
              - sqlite-vec Top-50
              - FTS5 Top-50
              - União + dedup
              - Cross-encoder rerank Top-100
              - Glossário anchors boost (+0.05/match, cap +0.20)

         → [Stage 4: Selection]
              - Apply feedback (positive/negative weights)
              - Apply relevance-decay (-0.05/turn após 3 turns, cap -0.30)
              - Confidence floor por tipo (Skill ≥ 0.60, Rule ≥ 0.55,
                Persona ≥ 0.50)
              - Attention tier multiplier (budget 100/75/50/25% +
                floor progression smart/warm/hot/dumb)
              - Tier escalation on error (+1/+2 tiers)
              - Diagnostic Skills bypass floor on error trigger
              - User-invoked precedência absoluta (10% reserve)
              - Critical Rules tudo-ou-nada (atomicidade)
              - Bundling requires/suggests
              - Tie-breaking 4 níveis (Score → Layer → Sticky → ID)

         → [Stage 5: Assembly]
              - Minificação semântica (build-time, remove metadata)
              - Markdown com markers HTML (`<!-- CRITICAL -->`,
                `<!-- persona-default -->`)
              - Leading words hoisting duplo (per-skill + global steering)
              - Persona base + tone_addendum (cap 3)
              - Ordem determinística (Persona → Rule → Skill por ID)
              - 2 blocos `cache_control: ephemeral` (persona estável +
                injeções variáveis)
              - System Health injection (se tier ≥ warm)
              - Byte-string final determinístico

         → [Response]
              - System message (byte-string cacheável)
              - matched_skills / matched_rules / matched_personas
              - cache_hit: "exact" | "semantic" | "miss"
              - pruning_decisions (5 razões + actions)
              - latency_ms per stage
              - decision_trace_id (link pra visualização)
```

### 2.4 SDK (cliente)

Cliente coleta contexto via SDK leve (~50KB, TypeScript puro):

```typescript
import { collectContext, fingerprint } from "@memory-studio/sdk"

const ctx = await collectContext({
  scratch: readRecentScratch(),       // últimos N chars do scratch local
  todos: readActiveTodos(),           // do todo system do agente
  recentFiles: gitStatus().modified,  // ou equivalent
  redaction: "minimal",               // "minimal" | "strict"
})

const fp = await fingerprint({
  project_path: process.cwd(),
  agent_id: "claude-code-cli",
  session_id: generateSessionId(),
  git_branch: await collectGitBranch(),
})

await memoryStudio.augment({ prompt, context: ctx, fingerprint: fp, tenant_id })
```

SDK abstrai como cada agente coleta. Modo de integração (proxy/hook/MCP)
afeta visibilidade mas não o schema do request.

---

## 3. Schema do catálogo (YAML estendido)

### 3.1 Skill

```yaml
id: auth-jwt-01                          # kebab-case, versionado
type: skill                              # skill | rule | persona
title: How to set up JWT auth             # human-readable
category: procedural                     # procedural | diagnostic | reference | pattern
critical: false                          # só pra Rules
requires:                                # hard deps (atomic bundle)
  - jsonwebtoken-setup-01
suggests:                                # soft deps (+0.10 boost)
  - git-commit-message-01
triggers_on_errors:                      # override feedback quando erro
  - test_failure
  - build_failure
leading_words:                           # max 8, hoisted per-skill
  - jwt
  - auth
  - RS256
  - credential stuffing
tone_addendum: |                         # modulação de persona (opcional)
  When reviewing: be paranoid, check every input.
disable_model_invocation: false          # flag de roteamento (não vai pro content)
text: |
  # Setup
  1. Install `jsonwebtoken` lib
  2. Generate RS256 keys (`openssl genrsa -out private.pem 2048`)
  ...
metadata:                                # build-time only, removido na minificação
  inherits_from: global                  # se fork
  forked_at: 2026-07-23
  intentionally_diverged: false
  upstream_at_fork:
    catalog_version: "abc123def"
    content_hash: "sha256:789xyz"
```

### 3.2 Rule

```yaml
id: rule-no-secrets-01
type: rule
critical: true                           # imune a decay, atomic, sempre injetada
text: "Never commit secrets, .env files, or API keys..."
```

### 3.3 Persona

```yaml
id: engineer-pragmatic-01
type: persona
is_default: true                         # 1 slot garantido (se user configurar)
text: |
  You are a pragmatic senior engineer. Write clean, maintainable code.
  Prefer simplicity over cleverness. Document non-obvious decisions.
```

### 3.4 Layered catalogs

```yaml
# ~ /system/catalog/auth-jwt-01.yaml        (built-in, read-only)
# ~ /.memory-studio/catalog/auth-jwt-01.yaml (user global)
# ~ ./.memory-studio/catalog/auth-jwt-01.yaml (project local)

# Shadowing atômico: local > global > system
# Fork via: memory-studio skill fork auth-jwt-01
```

---

## 4. Schema do API

### 4.1 POST /augment

Request:

```typescript
{
  prompt: string                                    // obrigatório, sempre presente
  context?: {                                       // opcional, presente se SDK conseguir
    scratch?: string                                // <= 384 tokens
    todos?: TodoItem[]                              // <= 64 tokens serializados
    recent_files?: string[]                         // <= 64 tokens (paths)
    last_event?: {                                  // <= 200 tokens
      type: ErrorType | "tool_call" | "tool_result"
      severity?: "warning" | "error" | "critical"
      payload: unknown
    }
    legacy_state?: string                           // injetado na 1ª turn de nova sessão
    session_id?: string                             // hasheado
  }
  fingerprint: ContextFingerprint                  // obrigatório
  tenant_id: string                                 // obrigatório, hasheado
  schema_version: 2                                 // versioning
}
```

Response:

```typescript
{
  system_message: string                            // byte-string cacheável (2 blocos ephemeral)
  matched_skills: { id: string, score: number, source: "system"|"global"|"local" }[]
  matched_rules: { id: string, score: number, critical: boolean }[]
  matched_personas: { id: string, score: number, is_default: boolean }[]
  cache_hit: "exact" | "semantic" | "miss"
  augmentation_refreshed: boolean                  // sticky context: false = cache hit
  pruning_decisions: {                              // 5 razões
    rejected_by_floor: RejectionDetail[]
    rejected_by_budget: RejectionDetail[]
    rejected_by_attention_tier: RejectionDetail[]
    rejected_by_negative_feedback: RejectionDetail[]
    rejected_by_critical_dropped: RejectionDetail[]
  }
  latency_ms: { embedding: number, retrieval: number, rerank: number, total: number }
  decision_trace_id: string                         // link pra visualização
  warnings: string[]                                // ex.: "prompt_exceeds_budget"
  empty_reason?: "low_confidence" | "social" | "budget_exceeded" | "timeout" | null
  schema_version: 2
}
```

### 4.2 Outros endpoints

| Endpoint | Método | Função |
|---|---|---|
| `/augment` | POST | augmentation principal |
| `/feedback` | POST | registra positive/negative vote |
| `/discoveries` | GET | lista discovery signals acumuladas |
| `/audit` | GET | audit log com filtros |
| `/audit/summary` | GET | summary diário/semanal |
| `/handoff` | POST | gera handoff state |
| `/handoff/:id` | GET | recupera handoff file |
| `/catalog` | GET | lista catálogo (debug) |
| `/catalog/rebuild` | POST | rebuild index (dev/admin) |

---

## 5. Storage (SQLite tables)

### 5.1 catalog.sqlite

```sql
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('skill', 'rule', 'persona')),
  title TEXT NOT NULL,
  content_minified TEXT NOT NULL,
  content_raw TEXT,
  token_count INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('system', 'global', 'local')),
  catalog_version TEXT NOT NULL,
  category TEXT,
  critical BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  requires TEXT,                          -- JSON array
  suggests TEXT,                          -- JSON array
  triggers_on_errors TEXT,               -- JSON array
  leading_words TEXT,                    -- JSON array
  tone_addendum TEXT,
  metadata TEXT,                          -- JSON object (inherits_from, forked_at, etc)
  embedding BLOB NOT NULL,                -- 384d float32
  embedding_dimension INTEGER DEFAULT 384,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_catalog_type ON catalog_items(type);
CREATE INDEX idx_catalog_source ON catalog_items(source);
CREATE INDEX idx_catalog_category ON catalog_items(category);
```

### 5.2 augmentation_state.sqlite

```sql
CREATE TABLE augmentation_state (
  fingerprint_hash TEXT PRIMARY KEY,
  fingerprint JSON NOT NULL,                -- project_path + agent_id + session_id + git_branch
  items JSON NOT NULL,                      -- [{ id, type, score, source }]
  last_refresh_at INTEGER NOT NULL,
  last_refresh_reason TEXT,
  refresh_count INTEGER DEFAULT 0,
  session_turns_since_refresh INTEGER DEFAULT 0,
  cached_system_message TEXT NOT NULL,
  cached_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,             -- TTL
  pinned_catalog JSON                       -- { system, global, local } versions
);

CREATE INDEX idx_aug_state_expires ON augmentation_state(expires_at);
```

### 5.3 skill_usage.sqlite (relevance-decay)

```sql
CREATE TABLE skill_usage_state (
  skill_id TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  last_used_turn INTEGER,
  leading_word_appearances INTEGER DEFAULT 0,
  cumulative_score REAL DEFAULT 0,
  decay_factor REAL DEFAULT 0,
  PRIMARY KEY (skill_id, fingerprint_hash)
);
```

### 5.4 feedback.sqlite

```sql
CREATE TABLE user_feedback (
  feedback_id TEXT PRIMARY KEY,
  tenant_hash TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('negative', 'positive')),
  weight REAL NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  source TEXT NOT NULL DEFAULT 'ui_toggle'
);

CREATE INDEX idx_feedback_lookup ON user_feedback(tenant_hash, fingerprint_hash, skill_id);
```

### 5.5 audit.sqlite

```sql
CREATE TABLE audit_log (
  request_id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  tenant_hash TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  prompt TEXT,
  context_redacted JSON,                   -- contexto já redacted
  retrieval JSON,                          -- candidates stats
  selected_items JSON,
  cache_hit TEXT,
  pruning_decisions JSON,
  augmentation_state JSON,
  latency_ms JSON,
  attention_tier TEXT,
  session_size_tokens INTEGER,
  warnings TEXT,                           -- JSON array
  schema_version INTEGER
);

CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_fingerprint ON audit_log(fingerprint_hash);
CREATE INDEX idx_audit_tenant ON audit_log(tenant_hash);
```

Retention: 30 dias detail, 90 dias summary.

### 5.6 discovery.sqlite

```sql
CREATE TABLE discovery_signals (
  signal_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  payload JSON,
  fingerprint_hash TEXT,
  suggested_action TEXT,
  detected_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolution TEXT
);

CREATE INDEX idx_discovery_severity ON discovery_signals(severity, detected_at);
```

### 5.7 handoffs/ (filesystem)

```
.memory-studio/
└── handoffs/
    ├── 2026-07-23T14-32-00Z.md       # Legacy Session State file
    └── 2026-07-23T16-45-12Z.md
```

Cada handoff é arquivo Markdown editável, versionável em git opcional.

---

## 6. Decisões consolidadas (41 rounds)

A entrevista cobriu 41 rounds de decisões técnicas. Resumo por tema:

### Privacidade e Redaction (3 rounds)
- **R3**: redação 3 camadas (SDK regex + middleware + cache encryption)
- **R11**: audit log redactado visível por default, toggle granular
- **R32**: placeholders hash-based (`[REDACTED:<sha>]`) preservam cache stability

### Cache e Storage (4 rounds)
- **R4**: semantic cache 2-tier, threshold 0.92, caching system message
- **R10**: TTL multi-camada (idle 30min, absolute 4h, drift, explicit, zero-fill)
- **R13**: cache 2-tier (catalog global + augmented por fingerprint)
- **R16**: version pinning por fingerprint, dev mode escape hatch

### Catálogo e Versionamento (4 rounds)
- **R20**: 3 camadas (system < global < local), shadowing explícito
- **R30**: atomic shadowing + fork CLI + validation warnings
- **R31**: upstream sync notifier + 3-way merge via git
- **R38**: branch-aware fingerprinting (4 componentes)

### Pipeline e Selection (8 rounds)
- **R6**: dynamic budget por token (4000 default)
- **R7**: confidence floor por tipo (Skill 0.60, Rule 0.55, Persona 0.50)
- **R12**: bug fix — orçamento 1280 → 1024
- **R15**: hierarchy Critical > Persona default > Rules > Skills
- **R17**: atomicity de Critical Rules + graceful degradation
- **R22**: minificação semântica em build-time, Markdown com markers
- **R27**: bundling `requires` (atomic) + `suggests` (boost)
- **R37**: tie-breaking 4 níveis (Score → Layer → Sticky → ID)

### Attention e Pruning (4 rounds)
- **R21**: 4 tiers (smart/warm/hot/dumb), floor progression
- **R23**: sticky context + 4 gatilhos de refresh
- **R26**: tier escalation on error (+1/+2 tiers, não full reset)
- **R36**: relevance-decay (-0.05/turn, cap -0.30, exceções)

### User Control e State (4 rounds)
- **R9**: detector social bypass estrito (prompt-based)
- **R29**: user-invoked precedência absoluta + 10% reserve + cap 3
- **R34**: decision traces com 5 razões + action suggestions
- **R41**: handoff middleware-managed, template structured

### Catalog Mechanics (5 rounds)
- **R5**: schema unificado + enriquecimento progressivo + versioning
- **R24**: glossary anchors boost (+0.05/match, cap +0.20)
- **R25**: leading words hoisting duplo (per-skill + global)
- **R28**: stripping total de descriptions + disable_model_invocation respeitada
- **R39**: feedback override via `triggers_on_errors` metadata

### Persona e Tom (1 round)
- **R40**: persona additivity com `tone_addendum`, cap 3

### Discovery e Otimização (4 rounds)
- **R14**: feedback persistente (positive/negative) por fingerprint
- **R18**: isolation por 4-component fingerprint
- **R19**: discovery signals passivos (TF-IDF, sem LLM)
- **R33**: scratchpad dedup com score composto (50/30/20)
- **R35**: context health injection (bloco separado, opt-out)

### Schema e Bootstrap (3 rounds)
- **R1**: caminho C híbrido (schema completo desde dia 1)
- **R2**: client-side + SDK helper
- **R8**: ordenação determinística (tipo + ID)

---

## 7. Compatibilidade com v1

### O que se mantém

- Endpoint `GET /augment?prompt=X` (v1) continua funcionando — middleware
  degrada gracefully para prompt-only quando `context` é null
- Schema YAML básico (id, type, title, text) é compatível
- Catálogo v1 pode ser carregado sem migração
- Cache hit do provedor preservado em ambos os modos
- Detector social funciona idêntico

### Migration path

Usuário com v1 instalado:

1. Atualiza Memory Studio binary (v2 roda v1 logic + extended features)
2. Adiciona context_fingerprint no SDK init
3. Context collector roda opcionalmente — fallback prompt-only se indisponível
4. Schema YAML: campos opcionais (`requires`, `suggests`, `triggers_on_errors`,
   `leading_words`, `tone_addendum`) ignorados se ausentes

### Breaking changes

**Nenhum.** v2 é aditiva.

---

## 8. Critério de aceitação do v2

### 8.1 Funcional

- [ ] SDK coleta contexto rico (scratch, todos, files, events) com redação 3-layer
- [ ] Pipeline 5 estágios completo (assembly → embedding → retrieval → selection → assembly)
- [ ] Schema YAML estendido com 7 campos opcionais novos
- [ ] Cache 2-tier com fingerprint isolation
- [ ] Attention-aware pruning com 4 tiers
- [ ] User-invoked precedência absoluta
- [ ] Handoff middleware-managed funciona end-to-end
- [ ] Discovery signals passivos detectam unknown terms

### 8.2 Performance

- [ ] p50 latência < 50ms com contexto rico
- [ ] p99 latência < 200ms (incluindo embedding)
- [ ] Augmentation timeout em 250ms com bypass graceful
- [ ] Cache hit rate do provedor > 80% em sessões longas
- [ ] Memory footprint working set < 1.5GB

### 8.3 Segurança / Privacidade

- [ ] Zero persistência de contexto raw (audit only redactado)
- [ ] tenant_id hasheado em todos os logs
- [ ] Placeholders determinísticos não vazam secret
- [ ] Encryption at rest do cache
- [ ] Audit log access-controlled

### 8.4 Operacional

- [ ] Build-index regenera embeddings em < 60s (100 skills)
- [ ] Catalog shadowing atômico entre 3 layers
- [ ] Upstream sync notifier detecta drift
- [ ] Fork CLI cria local copy com 1 comando
- [ ] Handoff CLI preview + edit + apply

---

## 9. Pendências e future work

### v2.0 (este proposal)

Tudo listado nas decisões. Implementação estimada: 12-18h adicionais ao MVP.

### v2.1 (post-MVP)

- **Curator LLM (opt-in)**: extrair leading_words, sugerir mappings
  `triggers_on_errors`, sugerir Skills a partir de discovery signals
- **Decision trace visualization** interativa (não só log)
- **Auto-detected feedback** (LLM-assisted pattern detection em output do agente)
- **Custom transforms** em minificação (regex-based)
- **Multi-agent orchestration** (coordenador que dispatcha sub-agentes)

### v3 (futuro)

- **Multi-tenant** (Memory Studio como serviço compartilhado)
- **Long-term memory** do usuário (schema separado, integração opcional)
- **MCP server completo** (Memory Studio como provider MCP nativo)
- **Cross-project catalog** (Skills compartilhadas via registry)

---

## 10. Próximos passos

### Imediato (próxima sessão)

1. **Mover 41 decisões** deste proposal para `proposal-consolidada.md §11`
   (transformar de "abertas" em "fechadas")
2. **Spec'iar Phase 2 (Augmenter)** do PLAN §8 com base neste proposal
3. **Atualizar `Memory-Studio-Discuss.md`** marcando itens como resolvidos
   (passa a ser histórico da decisão, não documento vivo)

### Curto prazo

4. **Validar decisões em Phase 0 (bootstrap)**:
   - Implementar manualmente 1 phase
   - Medir latência real vs SLA
   - Medir hit rate do semantic cache
   - Calibrar thresholds com dados reais

5. **Spec'iar Phase 4 (Search)** com SQLite schema proposto

### Antes de implementar v2 de fato

6. **Validar pre-flight** com smoke test:
   - SDK coleta contexto mínimo
   - Middleware processa request básico
   - Augmentation retorna system message determinístico
   - Cache hit funciona no segundo request

---

## Anexo A — Referências

- `Memory-Studio-Discuss.md` — discussão inicial (10 seções)
- `proposta-consolidada.md` — guia do Loop (META-tool, não este produto)
- `PLAN.md` — spec v1 (referência base, mantida para compatibilidade)
- `CLAUDE.md` — testing contract + authority boundaries + stack conventions
- NotebookLM interview report (Anexo B) — 41 rounds transcript

---

## Anexo B — Report da entrevista (resumo)

**Data:** 2026-07-22/23
**Notebook:** `f235cc21-b876-483e-b8a7-20d6234fa35c`
**Total de rounds:** 41
**Wall-clock:** ~50min
**Tokens usados:** ~50K

**Persona NotebookLM:** Matt Pocock Interrogador. Fez 41 perguntas sequenciais,
sempre com recomendação estruturada.

**Onde concordei (~85%):** semantic cache, 3 camadas de catálogo, shadowing
atômico, atomic Critical Rules, Diagnostic Skills bypass floor, attention-aware
pruning, glossary anchor, stripping total, persona additivity, handoff
middleware-managed.

**Onde refinei (~15%):** Top-5 fixo → dinâmico por budget; parallel phases
descartado (já em v1); atomic shadowing com fork CLI; grace degradation em
vez de abort; relevance-decay com exceções; feedback override via metadata
(over hardcoded mapping); branch-aware fingerprinting 4-component (não 3).

**Conclusão:** ~40 decisões concretas com schema, audit log, edge cases.

---

**Próxima ação:** revisar este proposal, validar com smoke test, mover
decisões para `proposta-consolidada.md §11`.
