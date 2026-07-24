# Search / Retrieval Specification

**Phase:** ROADMAP Phase 4 — `search`  
**Status:** Draft (autonomous planner resolution)  
**Scope:** Large

## Problem Statement

O catálogo já persiste itens e embeddings de 384 dimensões, mas ainda não oferece retrieval. Esta phase deve localizar itens relevantes por sinais lexicais e vetoriais, filtrar ruído com dois thresholds e produzir uma ordenação híbrida determinística para consumo posterior pelo augmenter, sem antecipar o servidor HTTP da Phase 6.

## Goals

- [ ] Indexar `skills.content_yaml` em FTS5 e os BLOBs de embedding em uma tabela `sqlite-vec` de 384 dimensões, mantendo ambos sincronizados com `skills`.
- [ ] Entregar uma função de biblioteca com forma de chamada `search(query, k)` que devolve, de modo assíncrono, no máximo `k` `RankedSkill` ordenados por RRF.
- [ ] Aplicar `min_cosine_similarity` ao canal vetorial e `min_fts_hits` ao canal lexical, retornando vazio quando nenhum canal passa.
- [ ] Provar ranking, thresholds, sincronização e falhas com SQLite/FTS5/sqlite-vec reais e corpus seed de pelo menos 10 itens.

## Out of Scope

| Feature | Reason |
| --- | --- |
| `POST /search` ou qualquer rota/servidor HTTP | O transporte pertence à Phase 6; esta phase entrega apenas biblioteca. |
| Integração com augmenter, social-detector ou cache | Pertence à Phase 5. |
| Cross-encoder ONNX real | O item é opcional no v0; modelo e tuning entram na Phase 9. RRF é a ordenação final desta phase. |
| Troca do stub por `multilingual-e5-small` real | Phase 9 mantém a interface de `Embedder` e troca a implementação. |
| UI para editar thresholds | Pertence à Phase 7. |
| Alterar `src/catalog/**` | Os índices serão anexados por schema/triggers no domínio `search`, preservando Phase 2. |
| Busca HTTP síncrona ou contrato JSON | Será definido quando o adapter HTTP existir na Phase 6. |

---

## Terms and Precise Semantics

- **FTS hit:** uma linha distinta de `skills` retornada pelo predicado FTS5 `MATCH` para a expressão lexical segura da query. `min_fts_hits` é comparado ao total de linhas distintas, antes do corte do candidate pool; não é contagem de ocorrências dentro do YAML.
- **Vector pass:** um candidato vetorial cuja similaridade cosseno, calculada como `1 - cosine_distance`, é maior ou igual a `min_cosine_similarity`.
- **FTS channel pass:** o canal lexical inteiro passa quando o total de FTS hits é maior ou igual a `min_fts_hits`; quando não passa, nenhuma posição FTS contribui para RRF.
- **Double threshold:** os canais operam com lógica inclusiva **OR**. Um item pode entrar pela lista vetorial aprovada, pela lista FTS aprovada, ou por ambas. Se as duas listas aprovadas forem vazias, o resultado é `[]`.
- **RRF:** para cada item, `rrfScore = Σ 1 / (60 + rank_c)`, considerando somente os canais aprovados em que o item aparece e ranks iniciados em 1.
- **Candidate depth:** cada canal busca `min(max(4 * k, 20), 100)` candidatos antes dos thresholds e da fusão.

---

## Assumptions & Open Questions

Toda ambiguidade identificada foi resolvida abaixo; o modo autônomo dispensa gates de confirmação.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Forma assíncrona do contrato | `SearchFunction = (query: string, k: number) => Promise<RankedSkill[]>`, criada por factory com DB/embedder/config injetados | O `Embedder` existente retorna `Promise<Float32Array>`; a notação `search(query, k): RankedSkill[]` do ROADMAP descreve a capacidade, não autoriza bloquear o event loop nem acoplar ao stub. | Assumed from existing contract |
| Significado de `min_fts_hits` | Total de linhas distintas que o FTS5 casou | É a interpretação natural de “hits” de uma busca e permite um gate de confiança do canal mensurável e independente de detalhes de token occurrence. | Assumed |
| Interação dos thresholds | OR entre canais, com gate independente por canal | `PLAN.md` diz “Se nenhum bate, não injeta nada”; exigir ambos eliminaria os casos lexical-only e semantic-only que justificam retrieval híbrido. | Confirmed by PLAN wording |
| Inclusividade na fronteira | `>=` para ambos | Evita excluir um valor configurado exatamente como limite e produz AC determinístico. | Assumed |
| Defaults iniciais | `minCosineSimilarity = 0.75`; `minFtsHits = 1`; injetáveis no factory | Valores seguros para o stub/testes; tuning é Phase 9. Mudanças reais de threshold continuam sujeitas à autoridade humana definida em `CLAUDE.md`. | Assumed |
| RRF constant | `60` | Constante convencional que reduz dominância de uma única posição; fixá-la torna ranking e testes determinísticos. | Assumed |
| Métrica de vec0 | `distance_metric=cosine`; similaridade `1 - distance` | O threshold exigido é de cosine similarity; usar a métrica diretamente evita comparar L2 com threshold cosseno. | Confirmed by ROADMAP intent |
| Query lexical | Tokens Unicode alfanuméricos distintos, cada um escapado/quoted e unidos por `OR` | Aceita PT-BR/EN e impede que pontuação do usuário vire sintaxe FTS5 inválida. | Assumed |
| Sincronização dos índices | Backfill idempotente na inicialização + triggers INSERT/UPDATE/DELETE em `skills` | Indexa corpus preexistente sem modificar `src/catalog/**` e preserva consistência para writes futuros. | Assumed |
| Dependência `sqlite-vec` | Usar o pacote Node oficial `sqlite-vec`, carregado no mesmo `better-sqlite3` | O componente é exigido pelo ROADMAP/PLAN e o brief permite explicitamente essa dependência. O lockfile deve fixar o artefato pre-v1. | Phase-authorized |
| Cross-encoder | Não implementado nesta phase | É opcional para v0 e exigiria modelo/dependências fora do escopo; a ordenação final permanece RRF. | Assumed |

**Open questions:** none — all resolved or logged above.

---

## Implicit-Requirement Dimensions Sweep

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | `query` deve ser string, NFC-normalizada, não vazia após trim e ter no máximo 10.000 UTF-16 code units. `k` deve ser inteiro entre 1 e 100. Config deve ter cosine em `[-1,1]` e FTS hits inteiro entre 1 e 1000. Violações lançam erro tipado antes de consultar o DB. |
| Failure / partial-failure states | Falha de extensão, schema, embedding ou SQL lança `SearchError` tipado; não há resultado parcial. Zero candidatos ou thresholds não atingidos é sucesso com `[]`. |
| Idempotency / retry / duplicate handling | Inicialização do schema é repetível e backfill não duplica linhas. A mesma query sobre o mesmo snapshot/config produz os mesmos IDs, scores e ordem. |
| Auth boundaries & rate limits | N/A porque esta phase é biblioteca local sem transporte ou identidade; Phase 6 define auth/rate limit HTTP. |
| Concurrency / ordering | O caller é dono de uma conexão `better-sqlite3`; DDL/backfill ocorre uma vez antes de expor a função. Consultas SQL são síncronas na conexão e a ordenação final tem desempate estável. |
| Data lifecycle / expiry | Sem TTL. Triggers espelham INSERT/UPDATE/DELETE de `skills` nos dois índices; fechar a conexão permanece responsabilidade do caller. |
| Observability | A biblioteca não loga conteúdo da query. Erros carregam código e causa sem incluir o prompt; logging estruturado do request pertence à Phase 6. |
| External-dependency failure | Se `sqlite-vec` não carregar ou `vec_version()` não responder, a inicialização falha com `VECTOR_EXTENSION_UNAVAILABLE`; não há fallback silencioso para brute force. |
| State-transition integrity | A função só fica utilizável após extensão, tabelas, triggers e backfill concluírem; falha de qualquer etapa aborta a criação da instância. |

---

## User Stories

### P1: Hybrid catalog retrieval — MVP

**User Story:** Como componente augmenter futuro, quero consultar o catálogo com sinais lexical e vetorial para receber os itens mais relevantes sem depender de um LLM remoto.

**Why P1:** É o vertical slice de retrieval exigido para desbloquear a Phase 5.

**Acceptance Criteria:**

1. **SEARCH-01 — FTS schema and synchronization.** WHEN o schema de search é inicializado sobre uma tabela `skills` existente THEN o sistema SHALL criar uma virtual table FTS5 chamada `content_fts`, indexar `content_yaml`, fazer backfill de todas as linhas existentes e refletir INSERT, UPDATE e DELETE posteriores por triggers, sem duplicar documentos em reinicializações.
2. **SEARCH-02 — Vector schema and synchronization.** WHEN o schema de search é inicializado após carregar `sqlite-vec` THEN o sistema SHALL criar `skill_embeddings` como `vec0` com primary key ligada a `skills.id` e coluna `float[384] distance_metric=cosine`, fazer backfill dos BLOBs existentes e refletir INSERT, UPDATE e DELETE posteriores.
3. **SEARCH-03 — Lexical ranking.** WHEN uma query contém pelo menos um token lexical THEN o canal FTS SHALL executar `MATCH`, calcular `bm25(content_fts)`, ordenar BM25 ascendente, devolver ranks 1-based e contar o total de linhas distintas; caracteres especiais e aspas do usuário SHALL NOT causar erro de sintaxe FTS.
4. **SEARCH-04 — Vector ranking.** WHEN o embedder retorna um `Float32Array` finito de 384 dimensões THEN o canal vetorial SHALL executar a query k-NN de `sqlite-vec`, ordenar distância cosseno ascendente, expor `cosineSimilarity = 1 - distance` e ranks 1-based.
5. **SEARCH-05 — RRF fusion.** WHEN uma ou duas listas aprovadas são fornecidas THEN o sistema SHALL calcular exatamente `Σ 1/(60+rank)` por skill, ordenar score decrescente e desempatar por melhor rank ascendente e depois `id` ascendente.
6. **SEARCH-06 — Double threshold.** WHEN os canais retornam candidatos THEN o sistema SHALL remover do ranking vetorial cada item com cosine abaixo do limite e SHALL incluir a lista FTS somente se seu total de hits atingir o limite; o resultado SHALL ser a união RRF das listas restantes e SHALL ser `[]` quando nenhuma restar.
7. **SEARCH-07 — Library contract.** WHEN um consumidor cria a busca com uma conexão aberta, um `Embedder` e config válida THEN o sistema SHALL devolver uma função assíncrona chamável somente com `(query, k)`, sem criar servidor, rota ou dependência de Fastify.
8. **SEARCH-08 — Result shape and limit.** WHEN a busca encontra mais de `k` itens aprovados THEN ela SHALL retornar exatamente os top `k`; cada `RankedSkill` SHALL conter `id`, `slug`, `kind`, `contentYaml`, `hash`, `rrfScore`, ranks/métricas disponíveis, e SHALL NOT conter o BLOB/array de embedding.
9. **SEARCH-09 — Determinism.** WHEN a mesma query, snapshot de DB, embedder e config são usados repetidamente THEN IDs, ranks, métricas, RRF scores e ordem SHALL ser iguais.

**Independent Test:** Sem HTTP, criar SQLite `:memory:`, carregar extensão real, inserir corpus controlado, construir `search` e observar ranking híbrido e metadata retornada.

---

### P1: Threshold-safe retrieval — MVP

**User Story:** Como operador do Memory Studio, quero que sinais fracos sejam descartados para não poluir o system message com contexto irrelevante.

**Why P1:** Retrieval sem confidence gate degrada a resposta e viola a decisão travada de threshold duplo.

**Acceptance Criteria:**

1. **SEARCH-10 — Vector-only pass.** WHEN um item não tem match FTS mas tem cosine exatamente igual ou superior ao limite THEN o item SHALL ser elegível pelo canal vetorial.
2. **SEARCH-11 — FTS-only pass.** WHEN nenhum item atinge cosine mas o total de FTS hits é exatamente igual ou superior a `minFtsHits` THEN os itens FTS SHALL ser elegíveis.
3. **SEARCH-12 — Neither passes.** WHEN todos os cosines ficam abaixo do limite e o total lexical fica abaixo de `minFtsHits` THEN `search` SHALL retornar `[]`, não lançar erro.
4. **SEARCH-13 — Invalid input/config.** WHEN query, `k`, threshold ou embedding viola os bounds desta spec THEN a operação SHALL falhar antes da fusão com `SearchError` e um código dentre `INVALID_QUERY`, `INVALID_K`, `INVALID_CONFIG` ou `INVALID_EMBEDDING`, sem incluir o texto da query na mensagem.

**Independent Test:** Executar três buscas sobre o mesmo seed alterando apenas thresholds e observar vector-only, FTS-only e empty outcome, incluindo valores exatamente na fronteira.

---

### P1: Verifiable real-engine integration — MVP

**User Story:** Como mantenedor, quero provas contra os engines reais para que o ranking não passe apenas por mocks que divergem de FTS5/sqlite-vec.

**Why P1:** SQLite e sqlite-vec são o núcleo da phase e o testing contract exige integração real para fluxos que tocam SQLite.

**Acceptance Criteria:**

1. **SEARCH-14 — Real corpus ranking.** WHEN um corpus seed de pelo menos 10 itens contém `react-debug-01` com conteúdo lexical e vetor mais relevantes para `como debugar React` THEN `search(query, 5)` SHALL retornar entre 1 e 5 itens, com `react-debug-01` em primeiro lugar, usando SQLite FTS5 e sqlite-vec reais.
2. **SEARCH-15 — Typed engine failures.** WHEN FTS5, extensão vetorial, schema ou query SQL falha THEN o sistema SHALL lançar `SearchError` com código `VECTOR_EXTENSION_UNAVAILABLE`, `SCHEMA_ERROR`, `QUERY_ERROR` ou `EMBEDDING_FAILED`, preservando a causa e sem logar o prompt.
3. **SEARCH-16 — Quality gates.** WHEN a phase é verificada THEN toda função exportada em `src/search/` SHALL ter ao menos um teste comportamental, coverage de linhas em `src/search/` SHALL ser pelo menos 80%, `npm test` SHALL sair 0 em menos de 10 segundos, e `npm run typecheck` SHALL sair 0.

**Independent Test:** Rodar a suíte search com banco in-memory e extensão nativa, seguida pelos gates do projeto e relatório nativo de coverage.

---

## Edge Cases

- WHEN `query` é vazia/whitespace ou excede 10.000 code units THEN SHALL lançar `SearchError(INVALID_QUERY)` antes do embedder/DB.
- WHEN `query` contém somente pontuação THEN o canal lexical SHALL produzir zero hits sem erro; o canal vetorial ainda pode qualificar itens.
- WHEN `query` contém aspas, operadores FTS, diacríticos ou tokens repetidos THEN o sanitizador SHALL tratar tudo como texto, deduplicar tokens e nunca executar sintaxe arbitrária.
- WHEN `k` é `0`, negativo, fracionário, `NaN` ou maior que 100 THEN SHALL lançar `SearchError(INVALID_K)`.
- WHEN o catálogo está vazio THEN SHALL retornar `[]`.
- WHEN a query vector tem dimensão diferente de 384 ou contém `NaN`/`Infinity` THEN SHALL lançar `SearchError(INVALID_EMBEDDING)`.
- WHEN um item aparece em só um canal aprovado THEN seu rank/métrica do outro canal SHALL ficar ausente e seu RRF SHALL usar apenas um termo.
- WHEN scores RRF empatam THEN melhor rank e `id` SHALL garantir ordem determinística.
- WHEN `createSearchSchema` roda duas vezes THEN contagens de FTS e vec SHALL continuar iguais à contagem de `skills`.
- WHEN uma linha de `skills` é removida THEN ela SHALL deixar de ser recuperável nos dois canais.

---

## Requirement Traceability

| Requirement ID | Story | ROADMAP item | Status |
| --- | --- | --- | --- |
| SEARCH-01 | Hybrid retrieval | Schema FTS5 | In Design |
| SEARCH-02 | Hybrid retrieval | Schema sqlite-vec 384d | In Design |
| SEARCH-03 | Hybrid retrieval | Query FTS5 + bm25 | In Design |
| SEARCH-04 | Hybrid retrieval | Query vec k-NN | In Design |
| SEARCH-05 | Hybrid retrieval | Fusão RRF | In Design |
| SEARCH-06 | Hybrid retrieval | Threshold duplo | In Design |
| SEARCH-07 | Hybrid retrieval | Função em `src/search/`; library-only | In Design |
| SEARCH-08 | Hybrid retrieval | RankedSkill + top k | In Design |
| SEARCH-09 | Hybrid retrieval | Determinismo | In Design |
| SEARCH-10 | Threshold safety | min cosine | In Design |
| SEARCH-11 | Threshold safety | min FTS hits | In Design |
| SEARCH-12 | Threshold safety | nenhum bate → vazio | In Design |
| SEARCH-13 | Threshold safety | validação/bounds | In Design |
| SEARCH-14 | Real integration | corpus ≥ 10 + ranking | In Design |
| SEARCH-15 | Real integration | failure paths | In Design |
| SEARCH-16 | Real integration | testes/coverage/SLA | In Design |

**Coverage:** 16 total, 16 mapped to design/tasks, 0 unmapped.

---

## Success Criteria

- [ ] Uma função de biblioteca `search(query, k)` retorna `react-debug-01` em primeiro para o corpus de aceitação e nunca retorna mais que `k` itens.
- [ ] Casos vector-only, FTS-only, boundary-equality e neither-passes têm outcomes explícitos e verdes.
- [ ] FTS5 e sqlite-vec reais indexam o mesmo conjunto de IDs de `skills` após backfill e mutações.
- [ ] RRF e desempate são reprodutíveis byte-for-byte nos campos numéricos para o mesmo snapshot.
- [ ] Coverage de `src/search/` ≥ 80%, toda exportação coberta, `npm test` < 10s e typecheck verde.
- [ ] Nenhum servidor, rota HTTP, cross-encoder, alteração em `src/catalog/**` ou novo componente arquitetural é introduzido.
