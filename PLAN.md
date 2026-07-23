# Memory Studio — MVP

**Data:** 2026-07-21
**Status:** pronto pra construir
**Sessão:** mvs_d4f27c0b8dfd4eda90723c6f7dd2b3ff

---

## 1. O que é

Memory Studio é um estúdio de injeção de contexto. Quando o humano escreve um prompt pra um agente de código (Claude Code, Antigravity, Cline, Aider, Cursor, ou qualquer outro), o Memory Studio:

1. Lê o prompt
2. Acha no catálogo de metadados o que ajuda o agente a responder
3. Injeta no system message do agente, sem quebrar o cache do provedor

**Em uma frase:** lê → acha no catálogo → injeta.

---

## 2. O que tem no catálogo

O catálogo é uma coleção de metadados estruturados. Hoje tem três tipos, mas a arquitetura aceita qualquer outro:

- **Skills** — conhecimento procedural ("como fazer JWT", "como debugar React", "como otimizar SQL")
- **Rules** — regras de comportamento ("sempre rodar lint antes de commitar", "nunca commitar .env")
- **Personas** — vozes/papéis do agente ("DBA sênior", "frontend obcecado por acessibilidade", "engenheiro de segurança paranoico")

Cada item do catálogo é um arquivo YAML versionado em git. Adicionar uma coleção nova = criar um arquivo YAML + uma tabela no banco. A arquitetura não muda.

---

## 3. Como funciona o fluxo

```
[Humano escreve prompt]
        ↓
[Memory Studio lê o prompt]
        ↓
[Embedding do prompt é comparado com embeddings do catálogo]
        +
[Match lexical no catálogo (FTS5)]
        ↓
[Top 3-5 itens são selecionados e ordenados]
        ↓
[Bloco estruturado é montado pro system message]
        ↓
[Agente recebe o system message aumentado + o prompt original]
        ↓
[Resposta do agente vai pro humano]
```

**A interceptação do prompt** pode acontecer de três jeitos diferentes, dependendo do agente:

- O agente aponta o Memory Studio como provedor de LLM (proxy transparente)
- O agente tem sistema de hooks e o hook chama o Memory Studio antes de enviar
- (v2) O agente fala MCP e o Memory Studio expõe tools nativos

Em todos os casos o produto é o mesmo: lê → acha → injeta. O que muda é só o transporte entre o agente e o Memory Studio.

---

## 4. O que o produto NÃO faz

Pra evitar drift, esses são os limites explícitos:

- **Não é memória de longo prazo do usuário.** Não guarda "o user gosta de X" entre sessões. Isso é módulo separado, schema separado, v2.
- **Não é vector store genérico.** Não substitui Qdrant/Pinecone/Chroma. É um roteador de skills específico.
- **Não é agente autônomo.** Não toma decisões, não planeja, não chama tools por conta própria. Lê → match → injeta.
- **Não extrai fatos com LLM.** O catálogo é estático, com embedding pré-computado. Não tem LLM no loop de extração.
- **Não usa LLM no hot path.** O matching é embedding (modelo pequeno local) + busca lexical. Sem chamada de LLM por turno.

---

## 5. Stack (Node-only, zero Python)

| Componente | Ferramenta | Tamanho |
|---|---|---|
| Runtime | Node.js 22 | já tem |
| HTTP server | Fastify | ~5MB |
| Banco | SQLite + FTS5 + sqlite-vec | ~10MB |
| Embedding local | multilingual-e5-small (ONNX, 384d) | ~470MB |
| Reranker local | ms-marco-MiniLM-L-6-v2 (ONNX) | ~90MB |
| LLM call (curator opcional, v1.1) | M2.7-highspeed via API | 0 local |
| UI | HTML + HTMX + Alpine.js | ~50KB JS |

**Working set total: ~1GB de RAM.** Roda em qualquer máquina com 4GB livres.

**Sem Python no hot path, sem dependência externa pro usuário instalar.** Self-hosted friendly: o cliente só precisa de Node 22 + `npm install`.

**Por que essa stack:**

- **Node-only:** o workload é I/O-bound (esperando API do LLM, lookup em SQLite). Diferença Node vs Python em I/O é 5-10%, irrelevante. Mas Node tem cold start 10x mais rápido, memória 2x menor por worker, e TypeScript end-to-end.
- **SQLite + FTS5 + sqlite-vec:** benchmark independente confirma que pra escala nossa (centenas a milhares de itens), SQLite vence vector DBs dedicadas. ~1ms por query, zero infra externa.
- **Embedding + cross-encoder local:** cobre 85-90% de precisão sem chamar LLM. Modelo ONNX roda offline, 1GB de RAM total.
- **LLM curator fica opt-in v1.1:** quando a gente quiser ganhar os 5-10% de precisão extra via LLM, é via API, não local. Sem custo fixo de RAM.
- **HTML+HTMX+Alpine (não React):** zero build step, auditável, suficiente pro MVP. Dá pra migrar pra React no v2 se a UI virar o foco do produto.

---

## 6. Decisões já travadas

- ✅ **Mem0 não entra.** Ortogonal ao nosso caso (Mem0 é long-term memory com LLM extraction, a gente é roteador estático), metadata filtering limitado no OSS, plataforma é cloud (mata self-hosted).
- ✅ **Cross-encoder local pro rerank.** LLM rerank é opt-in v1.1 (não-determinístico quebra cache).
- ✅ **Embedding multilingual-e5-small (384d).** Multilíngue, leve, suficiente pro MVP. Upgrade opcional pro v2.
- ✅ **`cache_control:ephemeral` no system message aumentado.** Histórico do user fica fora, não invalida o cache.
- ✅ **Stack Node-only, zero Python no hot path.** Self-hosted friendly, sem dependência externa.
- ✅ **Catálogo separado de long-term memory desde o dia 1.** DBs diferentes (`skills.sqlite` e `memory.sqlite`).
- ✅ **Skills como YAML versionado em git.** Plugáveis, auditáveis, fácil de fazer fork.
- ✅ **`tenant_id` hasheado no audit log** (sha256[0:16]) pra privacidade.
- ✅ **Detecção de conversa social** (regex simples) — prompts tipo "oi", "valeu", "obrigado" bypassam o retrieval, não injetam nada.
- ✅ **Threshold duplo no retrieval** — `min_cosine_similarity` (vector) + `min_fts_hits` (FTS5). Se nenhum bate, não injeta nada.

---

## 7. Como os agentes conectam (deployment, não produto)

O Memory Studio é o produto. O jeito que cada agente conecta a ele é detalhe de deployment, não do produto em si. Em ordem de preferência:

| Modo | Como funciona | Cache preservado | Agentes que usam |
|---|---|---|---|
| **Proxy (custom baseURL)** | Agente aponta o Memory Studio como provedor de LLM. Memory Studio intercepta, injeta, encaminha pro provedor real. | ✅ Sim | Claude Code, Cline, Aider, OpenCode |
| **Hook (augment)** | Hook do agente chama o Memory Studio antes de enviar o prompt, recebe o bloco, injeta. | Depende do hook | Agentes com hook system (a maioria) |
| **MCP (v2)** | Memory Studio expõe tools MCP que o agente chama nativamente. | ✅ Sim | Cline v2+, Cursor |

**Regra:** o modo preferido é o proxy (cache preservado + zero trabalho no agente). Hook é fallback quando o agente não aceita custom baseURL. MCP é o futuro.

O Memory Studio funciona com qualquer agente que fale HTTP. Os três modos são instâncias do mesmo produto.

---

## 8. O que vai ser construído (MVP)

Estimativa: 22-30h single-dev. Em ordem:

1. **Setup** — Node 22, npm init, deps, scaffold (1-2h)
2. **Schema + CRUD de skill** — ler YAML, salvar no SQLite, gerar embeddings (2-3h)
3. **Detector social** — ignora prompts tipo "oi", "valeu" (1-2h)
4. **Search** — FTS5 + sqlite-vec + RRF (4-5h)
5. **System message builder** — monta o bloco estruturado pro system (1-2h)
6. **Forwarder** — recebe request, injeta, encaminha pro provedor, devolve resposta (3-4h)
7. **UI mínima** — gerenciar skills, ver audit, settings (6-8h)
8. **Migration das skills built-in** — mover as ~19 skills do Mavis pro schema novo (2-3h)
9. **Teste + tuning** (4-6h)

---

## 9. Critério de aceitação do MVP

- [ ] Memory Studio lê um prompt de teste
- [ ] Top 3-5 skills relevantes são identificadas
- [ ] System message com persona + skills + regras é montado
- [ ] Cache do provedor hit (mesmas skills → mesmo byte string)
- [ ] UI mostra skills ativas, permite ligar/desligar, mostra audit log
- [ ] Nenhum dado sai da máquina do usuário
- [ ] Funciona com pelo menos 3 agentes diferentes (Mavis, Claude Code, e um terceiro)

---

## 10. O que NÃO está no MVP (v2+)

- Long-term memory do usuário (módulo separado, schema separado)
- Adapter OpenAI↔Anthropic (necessário pra Cursor/Windsurf/Aider)
- LLM curator como opt-in
- Multi-tenant
- MCP server
- Descoberta automática de agentes instalados
- Treinamento de embedding customizado
- Gráfico de dependências entre skills (v2: "skill A requer skill B")

---

## 11. Instalação de skills (workflow)

**Agora, antes do MVP:** o ambiente onde rodo (Mavis, dentro do Minimax Code) tem 19 skills built-in já disponíveis. Pra planejar a implementação do MVP, dá pra usar a skill `tlc-spec-driven` direto.

**Depois do MVP, no Memory Studio:** skill = arquivo YAML em `config/skills/<skill_id>.yaml`. Workflow:

```bash
# 1. Adicionar/editar uma skill
code config/skills/auth_jwt_01.yaml

# 2. Recompilar o índice (gera embeddings e atualiza o SQLite)
npm run build-index

# 3. Servidor pega as mudanças no próximo request
```

v1.1: comando CLI `memory-studio skill install <path>` pra automatizar o copy + build-index.

---

## 12. Como testar o MVP durante o desenvolvimento

Como esse é o ambiente onde rodo agora, vou testar com Mavis (que é um dos agentes que o Memory Studio vai suportar). O teste end-to-end:

1. Subir o Memory Studio em `127.0.0.1:7788`
2. Instalar um hook no Mavis que chama `/augment`
3. Mandar um prompt real
4. Conferir que o system message augmentado chega corretamente no LLM
5. Conferir que o cache hit acontece quando as mesmas skills são reutilizadas

Mas o produto em si é agnóstico de Mavis. Quando ficar estável, dá pra testar com Claude Code via custom baseURL sem mudar uma linha do Memory Studio.
