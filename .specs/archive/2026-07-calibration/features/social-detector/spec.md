# Social Detector Specification

**Status**: Approved for autonomous execution

## Problem Statement

Prompts puramente sociais não precisam consultar o catálogo: fazer retrieval para uma saudação, agradecimento, despedida ou smalltalk desperdiça trabalho e pode injetar contexto técnico irrelevante. O produto precisa de um detector local, determinístico e conservador que reconheça mensagens sociais curtas em PT-BR e EN sem desviar prompts técnicos do fluxo normal.

## Goals

- [ ] Expor `isSocial(prompt: string): boolean` em `src/social-detector/` como função síncrona, pura e sem dependências externas.
- [ ] Retornar `true` para pelo menos 20 famílias regex sociais em PT-BR e EN, incluindo obrigatoriamente `oi`, `valeu`, `obrigado`, `thanks` e `bye`.
- [ ] Retornar `false` para prompts técnicos, usos metalinguísticos de palavras sociais e mensagens mistas que também contenham uma tarefa.
- [ ] Cobrir todos os resultados definidos nesta especificação com testes comportamentais e manter `npm test` abaixo de 10 segundos.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Classificação semântica, embedding ou LLM | A decisão travada do MVP é regex local no hot path. |
| Idiomas além de PT-BR e EN | Não fazem parte do Done When desta fase. |
| Aprendizado automático de novos padrões | O catálogo regex é estático e versionado no código. |
| Wiring real dentro do augmenter | O augmenter ainda não existe; a Phase 5 fará a chamada. Esta fase entrega o hook público puro que essa integração usará. |
| Mensagens compostas arbitrárias, emoji-only e gírias não listadas | O detector privilegia precisão: desconhecido retorna `false` e segue para retrieval. |
| Validação HTTP ou coerção de valores que não sejam `string` | A fronteira HTTP validará o payload em fase posterior; o contrato TypeScript desta função aceita `string`. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| O que conta como social | A mensagem normalizada inteira precisa ser uma expressão social suportada. | Um falso positivo evita retrieval indevidamente; o default seguro é continuar o fluxo técnico. | Yes — derived from roadmap bypass semantics |
| Mensagem social seguida de tarefa | Retorna `false`, por exemplo `Thanks, now refactor the parser`. | A presença de trabalho acionável deve preservar retrieval. | Assumed under autonomous contract |
| Normalização permitida | Unicode NFC, trim externo, colapso de whitespace, comparação sem diferença de caixa e pontuação terminal `.`, `!`, `?` ou `…`. | Aceita variações de digitação sem transformar texto técnico em palavra social. | Assumed under autonomous contract |
| Acentos PT-BR | Variantes explícitas sem acento de padrões suportados também são aceitas (`ola`, `ate mais`). | Teclados e agentes frequentemente omitem diacríticos. | Assumed under autonomous contract |
| Aspas, backticks, vírgula interna e emoji | Não são removidos pela normalização. | Preserva sinais de uso metalinguístico/misto e reduz falsos positivos. | Assumed under autonomous contract |
| Whitelist de falsos positivos | Padrões técnicos explícitos são avaliados antes dos padrões sociais positivos. | Torna a precedência verificável e protege futuras extensões da lista positiva. | Yes — required by roadmap |
| Integração com augmenter nesta fase | Entregar uma única função importável, sem side effects; nenhum arquivo do augmenter será criado ou alterado. | A aresta já existe no farol e a Phase 5 é responsável pelo wiring real. | Assumed under autonomous scope guard |
| Dependências | Usar apenas TypeScript/JavaScript e regex nativa. | Mantém o hot path self-hosted, rápido e determinístico; não requer aprovação de dependency. | Yes — project constraints |

**Open questions:** none — all resolved or logged above.

---

## Implicit-Requirement Dimensions

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | `SD-03` e `SD-06`: o contrato recebe `string`; vazia, whitespace-only, pontuação-only e string longa sem match retornam `false`. Não há limite de tamanho local. |
| Failure / partial-failure states | N/A because the function performs no I/O and has no partial state. |
| Idempotency / retry / duplicate handling | `SD-07`: repeated calls with the same string return the same primitive boolean. |
| Auth boundaries & rate limits | N/A because this is an internal pure function; HTTP/auth boundaries are outside this phase. |
| Concurrency / ordering | `SD-07`: immutable module-level regex data and no mutable shared state make concurrent calls independent. |
| Data lifecycle / expiry | N/A because no data is persisted or cached. |
| Observability | `SD-07`: no logging, metrics, tracing or prompt capture in this privacy-sensitive hot-path helper. |
| External-dependency failure | N/A because there are no external dependencies or service calls. |
| State-transition integrity | N/A because the detector has no state machine. |

---

## User Stories

### P1: Bypass de mensagens puramente sociais — MVP

**User Story**: As an agent adapter, I want to identify a short social prompt before retrieval so that no irrelevant catalog context is injected.

**Why P1**: É o comportamento central e o Done When explícito da Phase 3.

**Acceptance Criteria**:

1. **SD-01** — WHEN `isSocial` receives any of the exact strings `oi`, `valeu`, `obrigado`, `thanks`, or `bye` THEN it SHALL return `true`.
2. **SD-02** — WHEN `isSocial` receives any exact fixture in the Positive Pattern Matrix below THEN it SHALL return `true`; each row SHALL correspond to a distinct tested social pattern family.
3. **SD-03** — WHEN a supported fixture differs only by the normalization rules in this specification THEN `isSocial` SHALL return the exact result listed in the Normalization Matrix.

**Independent Test**: Import the module directly, call `isSocial` for every positive and normalization fixture, and assert the specified primitive boolean without any server, database, mock or augmenter.

#### Positive Pattern Matrix (`true`)

| Pattern | Language | Category | Exact fixture |
| --- | --- | --- | --- |
| POS-01 | PT-BR | greeting | `oi` |
| POS-02 | PT-BR | greeting | `olá` |
| POS-03 | PT-BR | greeting | `bom dia` |
| POS-04 | PT-BR | greeting | `boa tarde` |
| POS-05 | PT-BR | greeting | `boa noite` |
| POS-06 | PT-BR | greeting | `e aí` |
| POS-07 | PT-BR | thanks | `valeu` |
| POS-08 | PT-BR | thanks | `obrigado` |
| POS-09 | PT-BR | thanks | `obrigada` |
| POS-10 | PT-BR | thanks | `muito obrigado` |
| POS-11 | PT-BR | farewell | `tchau` |
| POS-12 | PT-BR | farewell | `até logo` |
| POS-13 | PT-BR | farewell | `até mais` |
| POS-14 | PT-BR | smalltalk | `tudo bem?` |
| POS-15 | PT-BR | smalltalk | `como vai?` |
| POS-16 | EN | greeting | `hi` |
| POS-17 | EN | greeting | `hello` |
| POS-18 | EN | greeting | `hey` |
| POS-19 | EN | greeting | `good morning` |
| POS-20 | EN | greeting | `good afternoon` |
| POS-21 | EN | greeting | `good evening` |
| POS-22 | EN | thanks | `thanks` |
| POS-23 | EN | thanks | `thank you` |
| POS-24 | EN | thanks | `many thanks` |
| POS-25 | EN | thanks | `thx` |
| POS-26 | EN | farewell | `bye` |
| POS-27 | EN | farewell | `goodbye` |
| POS-28 | EN | farewell | `see you` |
| POS-29 | EN | smalltalk | `how are you?` |
| POS-30 | EN | smalltalk | `what's up?` |

#### Normalization Matrix

| Case | Input | Expected |
| --- | --- | --- |
| NORM-01 | `  OI  ` | `true` |
| NORM-02 | `THANKS!!!` | `true` |
| NORM-03 | `Bom   dia.` | `true` |
| NORM-04 | `\nbye\t` | `true` |
| NORM-05 | `ola` | `true` |
| NORM-06 | `ate mais` | `true` |
| NORM-07 | empty string | `false` |
| NORM-08 | whitespace-only string | `false` |
| NORM-09 | `!!!` | `false` |

---

### P1: Preservar prompts técnicos — MVP

**User Story**: As an agent adapter, I want technical and mixed prompts to remain non-social so that retrieval is never bypassed because of an incidental social word.

**Why P1**: Um falso positivo altera o fluxo do produto e pode remover contexto necessário.

**Acceptance Criteria**:

1. **SD-04** — WHEN `isSocial` receives any fixture in the False-Positive Matrix below THEN it SHALL return `false`, with false-positive patterns evaluated before positive social patterns.
2. **SD-05** — WHEN a prompt contains both a social expression and an actionable or technical continuation THEN `isSocial` SHALL return `false`; a leading greeting or thanks SHALL NOT override the technical intent.
3. **SD-06** — WHEN a string is empty, whitespace-only, punctuation-only, unmatched technical text, or 100,000 repeated `x` characters THEN `isSocial` SHALL return `false` without throwing.

**Independent Test**: Call the same public function for every false-positive, mixed-intent and boundary fixture and observe `false`; no retrieval implementation is needed.

#### False-Positive Matrix (`false`)

| Case | Kind | Exact fixture |
| --- | --- | --- |
| FP-01 | causal use | `thanks to memoization, this function is fast` |
| FP-02 | verb use | `the method thanks the user after saving` |
| FP-03 | quoted token | `write a function that returns "thanks"` |
| FP-04 | metalinguistic token | `create a regex that matches hello` |
| FP-05 | identifier/command | `why does the bye command close the socket?` |
| FP-06 | translation/metalinguistic | `obrigado is Portuguese for thank you` |
| FP-07 | mixed EN task | `thanks, now refactor the parser` |
| FP-08 | mixed PT-BR task | `oi, corrija o bug no parser` |
| FP-09 | mixed PT-BR task | `bom dia, implemente um endpoint` |
| FP-10 | technical prefix collision | `how are you handling database retries?` |
| FP-11 | technical prefix collision | `como vai funcionar o cache?` |
| FP-12 | technical phrase collision | `good morning jobs fail in CI` |

---

### P1: Hook limpo para o augmenter — MVP

**User Story**: As the future augmenter, I want one side-effect-free boolean function so that I can branch before retrieval without coupling to detector internals.

**Why P1**: Esta é a integração permitida pelo scope da fase e pela aresta arquitetural já definida.

**Acceptance Criteria**:

1. **SD-07** — WHEN a caller imports `isSocial(prompt: string): boolean` from `src/social-detector/is-social.ts` THEN the module SHALL synchronously return only a primitive boolean, produce the same result for repeated equal inputs, perform no I/O or logging, mutate no shared state, and import no augmenter/search/server code.
2. **SD-08** — WHEN the phase gates run THEN at least 30 positive pattern cases (therefore at least 20), every listed false-positive and normalization case, default technical cases, the long-input case, and determinism SHALL be asserted as spec-defined outcomes; `npm test` SHALL exit 0 in under 10 seconds, `npm run typecheck` SHALL exit 0, and the social-detector source SHALL meet at least 80% line, branch and function coverage under the native Node coverage gate.

**Independent Test**: Import only `isSocial`, call it repeatedly, inspect the module boundary, then run the documented unit, type and coverage gates.

---

## Edge Cases

- WHEN a social token appears inside quotes, code-like text or a technical sentence THEN the detector SHALL return `false`.
- WHEN a greeting/thanks is followed by a comma and an actionable request THEN the detector SHALL return `false`.
- WHEN capitalization, surrounding whitespace, repeated internal whitespace or allowed terminal punctuation is the only variation THEN the detector SHALL preserve the positive result.
- WHEN a supported PT-BR fixture omits the accent in `olá` or `até mais` THEN the detector SHALL return `true`.
- WHEN input is unsupported or ambiguous THEN the detector SHALL default to `false` so retrieval continues.
- WHEN input is long but valid as a string THEN the detector SHALL not throw or use unsafe nested-quantifier regexes.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SD-01 | Social bypass: mandatory examples | Tasks T1 | In Tasks |
| SD-02 | Social bypass: 30 pattern families | Tasks T1 | In Tasks |
| SD-03 | Social bypass: normalization | Tasks T2 | In Tasks |
| SD-04 | Preserve technical: whitelist | Tasks T3 | In Tasks |
| SD-05 | Preserve technical: mixed intent | Tasks T3 | In Tasks |
| SD-06 | Preserve technical: default/bounds | Tasks T1, T2 | In Tasks |
| SD-07 | Clean augmenter hook contract | Tasks T2 | In Tasks |
| SD-08 | Test and gate contract | Tasks T1-T3 | In Tasks |

**Coverage:** 8 total, 8 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] `isSocial('oi')`, `isSocial('valeu')`, `isSocial('obrigado')`, `isSocial('thanks')` and `isSocial('bye')` each return `true`.
- [ ] All 30 positive fixtures return `true`; all 12 false-positive fixtures return `false`.
- [ ] All normalization, default, long-input and determinism outcomes match this specification.
- [ ] The public module exposes a synchronous pure hook usable by the future augmenter without changing another product domain.
- [ ] Unit, typecheck and native coverage gates pass; `npm test` remains below 10 seconds.
