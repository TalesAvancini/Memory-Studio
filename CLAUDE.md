# Memory Studio

**Estúdio de injeção de contexto pra agentes de código** (Claude Code, Mavis, Cline, Aider, Cursor…).

Lê o prompt → match no catálogo (Skills / Rules / Personas) → injeta no system message sem quebrar o cache do provedor.

> **Plano do produto:** [PLAN.md](PLAN.md) · **Brainstorm de processo:** [conversa-loop.md](conversa-loop.md)

---

## Quick reference

### Comandos essenciais (a definir quando o código entrar)

```bash
npm install              # deps
npm run dev              # sobe o servidor em 127.0.0.1:7788
npm run build-index      # recompila índice FTS5 + embeddings
npm test                 # suíte unitária (precisa rodar em <10s — pré-condição Waldemar #1)
npm run test:integration # testes com SQLite + ONNX reais
npm run test:e2e         # smoke end-to-end com agente mock
npm run lint             # ESLint + Prettier check
npm run typecheck        # tsc --noEmit
```

> **Os comandos acima são placeholders** — serão preenchidos em `.specs/STATE.md` `## Decisions` quando o esqueleto entrar. Não rodar `npm` antes do `package.json` existir.

### Notebooks de referência (NotebookLM)

| Tópico | Notebook ID | Para que serve |
|---|---|---|
| **Loop do Waldemar (tlc-specdriven em cada step do roadmap)** | `6f72e66d-c861-4993-bae1-cbe41808f475` | Estudar o padrão usado como referência de processo. Usar pra brainstorm e alinhar approach antes de features grandes. |

**Como consultar** (sempre via `-n <id>` — NUNCA `use <id>` em paralelo):

```bash
notebooklm auth check --test --json                                # valida auth
notebooklm source list --notebook 6f72e66d-c861-4993-bae1-cbe41808f475 --json
notebooklm ask "pergunta" --notebook 6f72e66d-c861-4993-bae1-cbe41808f475 --json
notebooklm source fulltext <source_id> --notebook 6f72e66d-c861-4993-bae1-cbe41808f475
```

---

## Testing contract

> **Pré-condição crítica do loop (Waldemar #1):** feedback rápido. Se o gate de testes não rodar em **< 10 segundos**, o `tlc-roadmap-loop` queima tokens.

### O que conta como PASS

1. **Unit tests** — toda função exportada tem pelo menos 1 teste de comportamento. Cobertura mínima **80%** em `src/`.
2. **Integration tests** — todo fluxo que toca SQLite ou ONNX tem teste que sobe os serviços reais (não mock). Cobre:
   - Ingestão de YAML → SQLite + embeddings
   - Retrieval FTS5 + sqlite-vec + RRF
   - Cache byte-string determinístico (mesmo input → mesmo byte)
   - Detector social (regex de bypass)
3. **E2E smoke** — 1 cenário por modo de integração (proxy, hook, MCP-v2): prompt → augmented system message → LLM call mock → resposta.

### Como rodar

| Comando | Quando usar | SLA |
|---|---|---|
| `npm test` | todo commit, todo phase PASS | < 10s |
| `npm run test:integration` | fim de cada task atômica | < 60s |
| `npm run test:e2e` | fim de phase, antes de Verifier PASS | < 180s |

**Falha de SLA** = bloqueia o loop (escalation). Não tentar burlar.

### Estrutura de testes

```
test/
├── unit/                    # espelha src/<domínio>/
├── integration/             # sobe SQLite in-memory + ONNX
├── e2e/                     # agent mock + HTTP real
└── fixtures/                # YAMLs de skill, prompts de exemplo
```

### Mutation / discrimination (alinhado ao Verifier do Waldemar)

Cada teste deve **asserir comportamento, não implementação**. Referência: `tlc-spec-driven` rule "tests derive from spec's acceptance criteria and assert spec-defined outcomes — they never mirror the implementation".

---

## Authority boundaries

> **Pré-condição Waldemar #4:** project glue claro. Sub-agentes consultam `CLAUDE.md` — não restatam.

### Quem pode decidir o quê

| Decisão | Autoridade | Requer aprovação humana? |
|---|---|---|
| Adicionar/editar skill no catálogo | humano via `config/skills/<id>.yaml` | não (YAML é versionado) |
| Mudar threshold (`min_cosine_similarity`, `min_fts_hits`) | humano via `.env` + commit | **sim** |
| Trocar modelo de embedding (ex.: e5-small → bge-large) | humano | **sim** — afeta cache e re-index |
| Trocar provedor de LLM (curator v1.1) | humano | **sim** — afeta contrato |
| Mudar schema SQLite (migrations) | humano via `npm run migrate` | **sim** se quebra compat |
| Adicionar dependency nova | humano via PR | **sim** |
| Bugfix trivial (typo, off-by-one) | LLM via commit direto | não |
| Refactor interno sem mudar contrato | LLM via commit direto | não |
| Renomear arquivo ou variável | LLM | não, desde que atualização atômica |
| Modo de integração novo (proxy → hook) | humano | **sim** — muda superfície do produto |

### Camadas de autoridade (reflete a arquitetura 3-camadas da conversa-loop)

| Camada | Nome | Quem decide | Quem valida |
|---|---|---|---|
| 0 | Arquitetura Viva (farol Archify) | humano (re-render sob threshold) | humano revisa DISCOVERIES |
| 1 | Loop Engineering (ROADMAP, STATE) | orquestrador (autônomo) | Verifier por phase |
| 2 | Graph Engineering (Planner→Implementer→Verifier) | sub-agentes | Verifier autor ≠ verificador |

### Regra de ouro

> Mudanças em **decisões travadas** do [PLAN.md §6](PLAN.md) (Mem0 não entra, Node-only, multilingual-e5-small, cache ephemeral, catálogo versionado, tenant_id hasheado, etc.) **exigem PR + revisão humana explícita**.

---

## Stack conventions

> Decisões travadas em [PLAN.md §5](PLAN.md). Sub-agentes consultam, não restatam.

### Linguagem & tipos

- **TypeScript end-to-end.** `tsconfig.json` em strict mode. Sem `any` exceto em boundary com JSON dinâmico.
- **ESM modules** (`"type": "module"` no `package.json`).
- **Node 22 LTS** — usa `node:test` nativo, sem Jest/Vitest.

### Estrutura de diretórios

```
memory-studio/
├── src/
│   ├── server/             # Fastify HTTP server
│   ├── augmenter/          # prompt → augmented system message
│   ├── catalog/            # YAML loader + SQLite writer + embedder
│   ├── search/             # FTS5 + sqlite-vec + reranker
│   ├── cache/              # byte-string determinístico + hash
│   ├── social-detector/    # regex de bypass
│   ├── agents/             # proxy / hook / MCP adapters
│   └── shared/             # types, errors, utils
├── config/
│   └── skills/             # catálogo versionado em git
├── data/                   # SQLite files (gitignored)
├── models/                 # ONNX models (gitignored, ~1GB)
├── test/
├── scripts/
│   ├── migrate.ts
│   ├── build-index.ts
│   └── lessons.py          # se Vier a ter loop (mirror Waldemar)
├── .specs/                 # quando o loop entrar (Camada 0+1+2)
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── ARCHITECTURE.md
│   ├── architecture.html   # farol Archify
│   ├── DISCOVERIES.md
│   ├── LESSONS.md
│   └── features/<feat>/
│       ├── spec.md
│       ├── design.md
│       ├── tasks.md
│       └── validation.md
├── PLAN.md
├── CLAUDE.md               # este arquivo
└── conversa-loop.md
```

### Naming

| O quê | Convenção | Exemplo |
|---|---|---|
| Arquivos | kebab-case | `augmenter.ts`, `match-fts.ts` |
| Funções | camelCase | `buildAugmentedMessage` |
| Classes | PascalCase | `CatalogLoader` |
| Constantes | SCREAMING_SNAKE | `MIN_COSINE_SIMILARITY` |
| Tipos/interfaces | PascalCase, sem prefixo `I` | `Skill`, `AugmentedMessage` |
| DB tables | snake_case, plural | `skills`, `audit_events` |
| YAML skill id | kebab-case, versionado | `auth-jwt-01`, `react-debug-02` |
| Stable IDs do farol | kebab-case, mesmo pattern do phase-slug | `http-server`, `embedding-cache` |

### Imports

- **Absolute via path aliases** (`@server/...`, `@augmenter/...`), sem `../../../`.
- **Sem barrel exports** (`index.ts` que reexporta tudo). Importar direto do arquivo.

### Commits & branches

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- **Branches:** `feature/<slug>`, `fix/<slug>`, `loop/phase-<N>-<slug>` (dentro do `tlc-roadmap-loop`).
- **Auto-commit só dentro do loop** — fora, commita quando fizer sentido.

### Comentários

- **Porquê, não o quê.** Código claro dispensa comentário; comentário explica decisão não-óbvia.
- **Referência ao `spec.md`** em código de produção quando a regra vem de uma AC específica: `// AC-3 from features/auth-jwt-01/spec.md`.

---

## Operational rules

### Logging

- **Estruturado em JSON** (`pino` logger), uma linha por evento.
- **Nível info** em produção, debug em dev.
- **Nunca logar** conteúdo de prompt do usuário (privacy — `tenant_id` hasheado sha256[0:16] já garante).

### Error handling

- **Erros tipados** (`class AugmenterError extends Error`). Sem `throw new Error("...")` cru.
- **HTTP status codes** corretos: 400 (input), 401 (auth), 404 (skill), 422 (validation), 500 (internal).
- **Falha de retrieval ≠ erro.** Se nenhum item do catálogo bate no threshold, retorna augmented message **vazio** (não 500).

### Performance budget

| Operação | SLA |
|---|---|
| `GET /augment` p50 | < 50ms (catálogo em SQLite in-process) |
| `GET /augment` p99 | < 200ms (incluindo embedding se prompt novo) |
| `npm test` | < 10s |
| `npm run build-index` (100 skills) | < 60s |
| Working set de RAM | ≤ 1GB |

### Security

- **`tenant_id` hasheado** (sha256[0:16]) no audit log — nunca plaintext.
- **Catálogo versionado em git** — PR review obrigatório.
- **Sem LLM no hot path** — extração é embedding + FTS5 + cross-encoder local.
- **Self-hosted only** — sem chamada externa no MVP. LLM curator (v1.1) é opt-in via flag.

---

## Glossary

| Termo | Significado |
|---|---|
| **Catalog** | Coleção de Skills + Rules + Personas em `config/skills/*.yaml` |
| **Skill** | Conhecimento procedural ("como JWT", "como debugar React") |
| **Rule** | Regra de comportamento ("sempre rodar lint antes de commitar") |
| **Persona** | Voz/papel do agente ("DBA sênior", "engenheiro de segurança") |
| **Augment** | Operação de injetar o catálogo casado no system message |
| **Hot path** | Caminho de baixa latência (cada chamada do agente). Sem LLM aqui. |
| **Cold path** | Operações batch/build (re-index, migrations). LLM pode entrar. |
| **Farol** (Camada 0) | Arquitetura global renderizada pelo Archify; referência cross-phase |
| **Discovery** | Sinal quando `design.md` precisa de componente não-mapeado no farol |
| **Loop / Roadmap** | Modo autônomo do `tlc-roadmap-loop` — sub-agentes em sequência sobre `ROADMAP.md` |
| **Verifier** | Sub-agente fresh e independente que valida o trabalho do Implementer |
| **Subchapter** | Subdivisão de phase grande demais (escape hatch `SUBCHAPTER_BREAKDOWN`) |

---

## Cross-references

- [PLAN.md](PLAN.md) — product spec completo (o que, pra quê, stack, decisões, MVP scope)
- [conversa-loop.md](conversa-loop.md) — brainstorm de processo (loop do Waldemar, Archify como farol)
- [notebooklm skill](https://github.com/teng-lin/notebooklm-py) — CLI usada pra consultar o notebook acima
- `tlc-spec-driven` (skill global) — base do ciclo Specify→Design→Tasks→Execute→Verify
- `tlc-roadmap-loop` (skill global) — orquestrador que compõe as 3 camadas (patches pendentes — ver conversa-loop.md)
- `archify` (skill instalada em `.agents/skills/archify/`) — renderer do farol da Camada 0
