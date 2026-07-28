# Memory Studio — Discussão: Full-Context Augmentation

**Data:** 2026-07-23
**Status:** rascunho para discussão (não é decisão)
**Decisor final:** humano
**Autor desta discussão:** Conselheiro (papel advisor, distinto de M3-CLI que implementa)

---

## 0. Contexto e propósito

Este documento captura a intuição de que o middleware do Memory Studio deveria operar com **contexto de trabalho completo do agente**, não só com o prompt do usuário. A discussão está em aberto — serve para iterar antes de virar decisão em `proposta-consolidada.md`.

**Premissa:** prompt-only augmentation é limitada porque o working state do agente é mais rico que a superfície do prompt final.

**Hipótese:** full-context augmentation entrega Skills mais relevantes ao trabalho real, com mesma latência e sem adicionar LLM no hot path.

---

## 1. Problema

### 1.1 Limitação atual (prompt-only)

O middleware recebe **apenas o prompt do usuário** e retorna Skills/Rules/Personas matched contra esse prompt. Assimetria resultante:

| Quem | O que sabe |
|---|---|
| Agente | working state rico (scratch, todos, arquivos recentes, decisões intermediárias) |
| Middleware | só a superfície (prompt final) |
| Skill injetada | baseada em "o que foi pedido", não em "o que está sendo feito" |

### 1.2 Consequência prática — exemplo real

Cenário: agente implementando OAuth há 20 minutos.
- **Working state do agente:** scratch sobre OAuth, todos ativos (JWT lib, middleware, test), arquivos recentes (`auth.ts`, `jwt-utils.ts`).
- **Prompt do usuário agora:** "tá dando erro 401".
- **Match prompt-only:** "debug-401-01" (superficial, baseado no pedido).
- **Match útil:** "auth-jwt-01" (cobre o trabalho real, setup completo de auth, não debug isolado).

**Resultado atual:** Skill menos relevante → agente precisa pedir mais contexto → mais turnos.

### 1.3 Por que isso importa

Memory Studio é vendido como **camada de injeção de conhecimento procedural**. Se a injeção é baseada em superfície rasa, o valor entregue é menor que o potencial.

---

## 2. Proposta

### 2.1 Ideia central

Middleware recebe **contexto de trabalho completo** do agente:
- prompt do usuário (atual)
- scratch recente (o que o agente está pensando)
- todos ativos (o que está em andamento)
- arquivos recentes (o que está sendo tocado)
- última decisão ou erro (estado atual do trabalho)

Match considera o pacote inteiro. Skill retornada é a mais relevante **para o trabalho em curso**, não para o pedido isolado.

### 2.2 Arquitetura (alto nível)

```
[Agente working state]
        ↓
[Coleta contexto: prompt + scratch + todos + files + last_event]
        ↓
[Middleware /augment com contexto rico]
        ↓
[Embedding do contexto completo]  (mesmo pipeline atual)
        ↓
[FTS5 + sqlite-vec query]
        ↓
[Cross-encoder rerank sobre candidatos]
        ↓
[Top-K Skills retornadas]
        ↓
[System message com Skills relevantes ao TRABALHO, não só ao PROMPT]
```

### 2.3 O que muda e o que não muda

**Mantém:**
- Mesmo modelo de embedding (multilingual-e5-small)
- Mesmo vector store (sqlite-vec)
- Mesmo FTS5
- Mesmo cross-encoder rerank
- Mesma latência (50ms p50, 200ms p99)
- Sem LLM no hot path

**Adiciona:**
- Input mais rico ao endpoint `/augment`
- Estratégia de cap/chunking do contexto (limite de tokens)
- Política de privacidade estendida (scratch pode ter secrets)

**Não adiciona:**
- LLM no loop (mantém invariante)
- Infra nova (mesma stack)
- Mudança no catálogo

---

## 3. API surface

### 3.1 Atual (MVP provável)

```typescript
GET /augment?prompt="tá dando erro 401"
→ { skills: ["debug-401-01"], rules: [], personas: [] }
```

### 3.2 Proposta (full-context)

```typescript
POST /augment
Content-Type: application/json

{
  "prompt": "tá dando erro 401",
  "context": {
    "scratch": "estou implementando OAuth flow completo, falta validar token...",
    "todos": [
      { "status": "done",        "text": "setup JWT lib" },
      { "status": "in_progress", "text": "criar middleware" },
      { "status": "pending",     "text": "testar" }
    ],
    "recent_files": [
      "src/auth/jwt-utils.ts",
      "src/middleware/auth.ts"
    ],
    "last_error": "token verification failed: signature mismatch",
    "session_id": "hashed_xxx"
  },
  "tenant_id": "hashed_xxx"
}
```

Resposta:

```typescript
{
  "skills": [
    "auth-jwt-01",            // matched via scratch (OAuth in progress)
    "express-middleware-02",  // matched via todos + recent_files
    "debug-401-01"            // matched via prompt
  ],
  "rules": ["verify-jwt-server-side"],
  "personas": []
}
```

---

## 4. Pipeline de embedding com contexto rico

### 4.1 Estratégia de input

Limite duro: **1024 tokens** de input total (cap do e5-small é 512; 1024 cobre input + output do embedding).

Composição por prioridade:

| Slot | Tokens máx | Regra |
|---|---|---|
| Prompt | 256 | sempre presente, nunca corta |
| Scratch recente | 512 | corta mais antigo se overflow |
| Todos ativos | 128 | serializa como lista |
| Arquivos recentes | 128 | paths + comentários breves |
| Last error / event | 256 | sempre presente |

### 4.2 Chunking

Se contexto > 1024 tokens:
1. Prompt preservado integralmente.
2. Scratch: pega últimos N tokens por ordem cronológica reversa.
3. Todos: sempre inclui (lista cabe em 128 tokens).
4. Files: trunca paths longos, mantém apenas nomes.
5. Last error: sempre inclui.

### 4.3 Embedding

- 1 embedding do input concatenado (não múltiplos embeddings).
- Mesma latência que prompt-only (mesma chamada ao modelo).
- Mesma dimensionalidade (e5-small = 384 dims).

### 4.4 Match

- Embedding do contexto → query sqlite-vec (Top-50 candidatos).
- FTS5 sobre texto bruto do contexto (Top-50 candidatos).
- União + dedup.
- Cross-encoder rerank sobre Top-100 candidatos.
- Retorna Top-5 Skills (configurável).

---

## 5. Compatibilidade com decisões travadas

Verificação contra `proposta-consolidada.md §Operational rules` e §5 (stack):

| Decisão | Compatível? | Notas |
|---|---|---|
| Sem LLM no hot path | ✓ | mesmo embedding pipeline |
| p50 < 50ms | ✓ | embedding de 1024 tokens ≈ embedding de 50 tokens |
| Catálogo versionado | ✓ | Skills vêm do catálogo inalterado |
| Cache ephemeral | ✓ | cache key = hash do contexto completo |
| Tenant ID hasheado | ✓ | contexto + tenant_id hasheados |
| Self-hosted only | ✓ | mesma stack |
| Detector social (regex bypass) | ✓ | roda no prompt do usuário, não no contexto |

**Conclusão:** extensão, não revisão. Todas as invariantes mantidas.

---

## 6. Trade-offs honestos

### 6.1 Ganhos

- **Skills mais relevantes ao trabalho real** (não ao pedido isolado).
- **Menos "injection noise"** (Skills inúteis ou tangenciais).
- **Menos turnos pra chegar à solução** (agente já tem contexto certo no system message).
- **Cache hit rate maior** (mesmo trabalho, prompts diferentes → mesmo contexto embedded).
- **Persona match melhor** (se contexto mostra tom/decisão do agente, persona match pode ser mais preciso).

### 6.2 Perdas / Riscos

| Risco | Mitigação |
|---|---|
| Diluição do embedding (contexto grande = média sem foco) | cap em 1024 tokens + priorização |
| Signal vs noise (nem todo scratch é útil) | ranking por recência + overlap com prompt |
| Privacy ampliada (scratch pode ter secrets) | hashing/redaction no boundary (extensão da política de tenant_id) |
| Orquestração cliente-side | SDK helper ou hook do provider (cada modo de integração coleta differently) |
| Cache key menos hit-friendly (contextos variam muito) | cache por similaridade semântica (não exact match), com threshold |

### 6.3 Custos

| Item | Custo |
|---|---|
| Texto extra a embedar | marginal (e5-small é barato) |
| Latência | igual |
| Storage de cache | cresce com diversidade de contextos (mitigação: LRU + cap) |
| Privacidade | precisa política clara antes de ativar |

---

## 7. Caminhos de implementação

### 7.1 Caminho A — MVP-first ("rodinha de equilibrista")

**Sequência:**
1. Implementar prompt-only primeiro.
2. Validar com uso real (medir latência, hit rate, relevância).
3. **Se evidência de limitação** → implementar full-context.
4. Se não evidência → parar em prompt-only.

**Prós:**
- Validação barata do conceito antes de investir.
- Build incremental, fácil de reverter.
- Atende SLA desde dia 1.

**Contras:**
- 2 iterações se full-context for necessário.
- Breaking change no schema `/augment` (cliente tem que atualizar).
- Aparenta "meia-bicicleta".

### 7.2 Caminho B — Full-context direto ("bicicleta toda")

**Sequência:**
1. Implementar full-context desde o início.
2. Validar com uso real.
3. Iterar com base em feedback.

**Prós:**
- Sem re-trabalho.
- Arquitetura completa desde dia 1.
- Atende visão total.

**Contras:**
- Mais risco se algo der errado (mais código pra debugar).
- Premissa: full-context é claramente melhor (precisa de evidência).
- Pode over-engineer se uso real mostrar que prompt-only bastava.

### 7.3 Caminho C — Híbrido (schema completo, ativação gradual)

**Sequência:**
1. Definir schema do input `/augment` aceitando contexto rico desde dia 1.
2. Pipeline aceita contexto, mas trata como **opcional** com fallback pra prompt-only.
3. Validação progressiva: testa prompt-only primeiro, depois liga full-context por feature flag.
4. Medir diferença. Decidir com dados.

**Prós:**
- Schema final desde dia 1 (sem breaking change depois).
- Roll-out gradual, baseado em evidência.
- Fallback sempre disponível (degrada gracefully).

**Contras:**
- Implementa 2 caminhos no dia 1 (mais código).
- Mais complexo de testar.

---

## 8. Questões abertas

### Q1 — Coleta de contexto: client-side ou server-side?

| Opção | Prós | Contras |
|---|---|---|
| Client-side (agente envia contexto) | flexível, controle do agente | responsabilidade no cliente |
| Server-side (middleware scrape logs/files) | cliente simples, opaco | opaco, acopla a paths |

### Q2 — Privacidade do scratch

- Quais campos são hasheados vs redactados vs preservados?
- Tenant_id hashing se aplica a contexto inteiro?
- Que nível de redaction para secrets detectados?

### Q3 — Cache key com contexto

| Opção | Hit rate | Storage |
|---|---|---|
| Hash exato do contexto | baixo | mínimo |
| Hash do embedding (semantic cache) | alto | mais (precisa guardar embeddings) |

### Q4 — Threshold de injeção

- Quantas Skills retornar? Top-3? Top-5? Top-10?
- Depende do system message budget do provedor (Anthropic, OpenAI, etc).

### Q5 — Modo de integração (proxy/hook/MCP)

- Cada modo coleta contexto de forma diferente?
- Hook tem acesso a mais estado que proxy (post-tool-call state)?

---

## 9. Recomendação do Conselheiro

**A intuição de "ter tudo na mão" está correta e vale o investimento.**

Razões:

1. **Epistemologicamente:** "o que o usuário pediu" é proxy fraca de "o que o agente precisa saber". O working state é onde o knowledge procedural se aplica.

2. **Arquiteturalmente:** mudança é **extensão, não revisão**. Mesma stack, mesmo pipeline, mesma latência.

3. **Economicamente:** custo incremental é baixo (mesmo embedding). Ganho de UX (menos turnos, Skills mais relevantes) é alto.

**Recomendação operacional:**

Considerando a preferência explícita do humano por "bicicleta toda quando arquitetura está clara":

- **Adotar Caminho B (full-context direto)** se você aceita o risco de re-trabalho caso uso real mostre que prompt-only bastava.
- **Adotar Caminho C (híbrido)** se quer prudência sem abrir mão da visão completa.
- **Não adotar Caminho A (MVP puro):** schema do `/augment` muda depois, gerando breaking change pros clientes.

**Próximos passos sugeridos:**

1. Validar Q1-Q5 (especialmente privacidade e cache key).
2. Atualizar `proposta-consolidada.md §11` (decisões abertas) com a escolha.
3. Spec'iar Phase 2 (Augmenter) com a decisão.

---

## 10. Anexo — referências

- `proposta-consolidada.md` — decisões travadas do Memory Studio.
- `PLAN.md §5` — stack e arquitetura de produto.
- `handoff-session.md` — estado de Turno 1 (patches) e Turno 2 (revisão crítica).
- NotebookLM "Loop" — ID `6f72e66d-c861-4993-bae1-cbe41808f475` (referência conceitual, não relacionada a esta decisão).

---

**Próxima ação:** revisar este documento, decidir entre Caminho B ou C, validar Q1-Q5, mover para `proposta-consolidada.md §11` quando virar decisão.
