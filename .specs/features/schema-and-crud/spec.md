# Spec — Phase 2 / schema-and-crud

> **Phase slug:** `schema-and-crud` (ROADMAP Phase 2 — Schema + CRUD de skill)
> **Depends on:** Phase 1 (setup)
> **Done when:** CLI `npm run catalog:load <file.yaml>` lê um YAML de skill, persiste no `skills.sqlite`, gera embedding, retorna o `id` da skill criada. Suite de testes do CRUD passa.

---

## Goal

Entregar o **caminho frio de ingestão** do Memory Studio: dado um arquivo YAML em `config/skills/*.yaml`, validar, normalizar, gerar vetor de embedding, e persistir de forma idempotente no banco SQLite do catálogo. Esta phase estabelece o **domínio `catalog`** no farol (`src/catalog/`) e prepara o terreno para Phase 4 (search/retrieval), que vai ler desse mesmo banco.

---

## Architectural reference (resumo)

Caminho do farol exercitado por esta phase (ver `.specs/ARCHITECTURE.md` § Camada produto):

| Stable ID | Papel nesta phase |
|---|---|
| `catalog-yaml-files` | Fonte externa: `config/skills/*.yaml` (versionado em git, **read-only** aqui) |
| `catalog` | Domínio novo em `src/catalog/` — orquestra loader + embedder + writer |
| `embedding-model` | Interface `Embedder` (multilingual-e5-small, 384d) — stub determinístico nesta phase |
| `sqlite` | Persistência in-process (better-sqlite3) — schema `skills` + `audit_events` |

Edges exercitadas: `catalog → catalog-yaml-files (load)`, `catalog → embedding-model (encode)`, `catalog → sqlite (write)`.

---

## Acceptance Criteria

### Schema (SQLite)

- **crud-01** — `createSchema(db)` cria a tabela `skills` com colunas: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `slug TEXT NOT NULL UNIQUE`, `kind TEXT NOT NULL CHECK(kind IN ('skill','rule','persona'))`, `content_yaml TEXT NOT NULL`, `embedding BLOB NOT NULL`, `hash TEXT NOT NULL UNIQUE`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`. Re-rodar é idempotente (sem erro).
- **crud-02** — `createSchema(db)` cria a tabela `audit_events` com colunas: `id INTEGER PRIMARY KEY AUTOINCREMENT`, `ts INTEGER NOT NULL`, `tenant_hash TEXT NOT NULL`, `event_type TEXT NOT NULL`, `payload TEXT NOT NULL` (JSON serializado). Re-rodar é idempotente.
- **crud-03** — `createSchema(db)` é `IF NOT EXISTS` (re-criável sem perda de dados; válido para `npm test` rodar múltiplas vezes em `:memory:`).

### Loader YAML

- **crud-04** — `loadSkillFromFile(path)` parseia YAML e retorna `SkillRecord` validado com `kind ∈ {'skill','rule','persona'}`. Lança `LoaderError` com mensagem clara se kind ausente/inválido, se YAML malformado, ou se `content_yaml` (campo de texto cru do procedimento) ausente.
- **crud-05** — Loader aceita campos obrigatórios `slug` (kebab-case) + `kind` + `content` (string). Campos extras são preservados no `content_yaml` (não descartados).
- **crud-06** — Loader normaliza NFC + trim no slug e computa `hash = sha256(content_yaml)`.

### Embedder

- **crud-07** — Interface `Embedder` exporta `async embed(text: string): Promise<Float32Array>` retornando vetor de **384 dimensões** (`multilingual-e5-small`). Implementação concreta `DeterministicStubEmbedder` produz vetor **determinístico** derivado de `sha256(text)` (mesmo input → mesmo vetor byte-a-byte; ortogonal entre inputs distintos).
- **crud-08** — Stub embedder é trocável pela mesma interface — substituição por ONNX real (Phase 9+) **não exige** mudanças em writer/loader/CLI.
- **crud-09** — Vetor gerado tem `Math.fround`-estável: serializar via `Buffer.from(new Float32Array(...).buffer)` produz BLOB de **1536 bytes** (384 × 4).

### Writer SQLite

- **crud-10** — `upsertSkill(db, record, embedding)` insere nova skill se `hash` não existe; se já existe (mesmo `hash`), **não duplica** e **não atualiza** `slug`/`kind` (idempotência por conteúdo, não por slug).
- **crud-11** — Se `hash` existe mas `slug` mudou (rename externo), writer emite `WriterWarning` (log estruturado) e **não** rebatiza — versionamento de slug é responsabilidade de migração (Phase 8).
- **crud-12** — `embedding` é persistido como `BLOB` (4 bytes × 384 dims = 1536 bytes). Round-trip `embed → write → read → Float32Array` preserva **bit-a-bit** os valores.
- **crud-13** — `updated_at` é sempre `Date.now()` no insert; `created_at` é congelado no primeiro insert.

### CLI

- **crud-14** — `npm run catalog:load <path>` aceita 1 argumento (caminho do YAML) e mais nenhum obrigatório. Falha com exit code 2 + mensagem em stderr se argumentos errados.
- **crud-15** — CLI cria (se necessário) o `skills.sqlite` em `data/skills.sqlite` (relativo ao CWD do repo), roda `createSchema`, parseia o YAML, gera embedding, persiste, e imprime no stdout: `created skill id=<N> slug=<slug> hash=<hash>` (em caso de insert) ou `unchanged skill id=<N> slug=<slug> hash=<hash>` (em caso de idempotência).
- **crud-16** — CLI retorna exit code 0 em sucesso (insert ou unchanged). Em qualquer erro de I/O / validação / SQL, retorna exit code != 0 e escreve a causa em stderr.

### Cross-cutting

- **crud-17** — Toda função exportada do domínio `catalog` tem **pelo menos 1 teste de comportamento** (asserts de outcome, não de implementação). Cobertura mínima **80%** em `src/catalog/`.
- **crud-18** — `npm test` permanece **< 10s** após a phase (pré-cond Waldemar #1). Embedder stub + SQLite `:memory:` garantem que testes não dependem de I/O lento nem de modelo ONNX.
- **crud-19** — Erros são tipados: `class LoaderError extends Error`, `class WriterError extends Error`, `class EmbedderError extends Error`. Sem `throw new Error('...')` cru em código de produção.
- **crud-20** — Logger `pino` configurado em **modo silencioso durante testes** (sem stdout poluído), em modo info em CLI real (uma linha JSON por evento). **Nunca** loga conteúdo do YAML/prompt (privacy).

---

## Out of scope (explícito)

1. **Download / execução real do modelo ONNX multilingual-e5-small** — vetor de 384 dims é stub determinístico nesta phase. Real ONNX entra em Phase 9 (test-and-tuning) ou em cold-path migration script (Phase 8). **Justificativa:** brief-m3cli-phase4 veda "inventar embedding model download"; o stub satisfaz o AC `gera embedding` sem dependência externa de ~1GB.
2. **Search / retrieval (FTS5 + sqlite-vec + RRF)** — Phase 4.
3. **Endpoints HTTP** (`/augment`, `/search`) — Phase 6.
4. **Hot path do augment** (montagem de system message, cache, social-detector) — Phase 5.
5. **Migrations versionadas** (tracking de `schema_version`) — Phase 2 usa `CREATE TABLE IF NOT EXISTS`, suficiente para idempotência no MVP. Migration script (Phase 8) será adicionado quando schema precisar evoluir.
6. **Writes em `audit_events`** — schema criado (crud-02), mas nada escreve nele nesta phase. Eventos de auditoria entram em Phase 5/6 quando houver augment request real.

---

## Assumptions & Open Questions

| # | Assunção | Por quê | Plano B se errada |
|---|---|---|---|
| A1 | Stub embedder satisfaz o AC `gera embedding` da ROADMAP | ROADMAP usa verbo `gera`, não `gera via modelo real treinado`. Stub determinístico = mesmo vetor byte-a-byte a cada execução, validável por round-trip. | Phase 9 (test-and-tuning) substitui stub por ONNX real mantendo a interface. |
| A2 | `better-sqlite3` é OK apesar de ser módulo nativo | Sync API (sem overhead de async no cold path), FTS5 built-in, suporte maduro a extensões (sqlite-vec na Phase 4). `node:sqlite` (built-in Node 22) ainda é experimental atrás de flag. | Trocar por `node:sqlite` em Phase 4 se o gate de performance exigir; a interface `db` será abstraída num adapter fino. |
| A3 | `tsx` como devDep para rodar `.ts` direto (sem `tsc` build) | Simplifica o script `npm run catalog:load` (zero build step). TypeScript end-to-end preservado (CLAUDE.md § Stack conventions). | Adicionar `tsc` build + script `prestart` que compila antes de rodar. |
| A4 | Schema é gerenciado por `createSchema(db)` in-process, sem migration tracking | Phase 2 é MVP; `IF NOT EXISTS` é suficiente para idempotência. Phase 8 (migration-builtin-skills) é onde entra versionamento sério. | Adicionar `schema_version` table + script `migrate.ts` em Phase 8. |
| A5 | `data/skills.sqlite` (relativo ao CWD) é o path padrão | CLI roda do root do repo. Hardcoded path é OK no MVP. | Phase 6 (forwarder) lê de env var `CATALOG_DB_PATH` quando precisar. |
| A6 | Hash de idempotência = `sha256(content_yaml)` | Detecta mudança de conteúdo; mesmo conteúdo = mesma skill. Não detecta rename de slug (intencional — versionamento). | Phase 8 introduz `content_hash + slug` juntos como natural key composta se necessário. |

---

## Constraints (herdados, não negociáveis)

- **TypeScript strict** (CLAUDE.md § Stack conventions) — `noUncheckedIndexedAccess`, sem `any` exceto em boundary de YAML/JSON dinâmico.
- **ESM modules** (`"type": "module"` no package.json).
- **Node 22 LTS** — usa `node:test` nativo, sem Jest/Vitest (escolha da Phase 1).
- **Naming:** arquivos `kebab-case`, funções `camelCase`, tipos `PascalCase`, tabelas `snake_case` plural (`skills`, `audit_events`).
- **Imports:** absolute via path aliases (`@catalog/...`), sem `../../../`. Sem barrel exports.
- **Performance budget:** `npm test` < 10s, working set ≤ 1GB (não-impactante nesta phase).
- **Security:** `tenant_id` hasheado (`sha256[0:16]`) no audit log quando aplicável — não há escrita de audit_events nesta phase, mas a coluna está pronta.

---

## Traceability (ACs ↔ ROADMAP sub-items)

| ROADMAP sub-item (Phase 2) | ACs que o cobrem |
|---|---|
| Schema SQLite: tabela `skills` | crud-01, crud-12, crud-13 |
| Schema SQLite: tabela `audit_events` | crud-02 |
| Loader YAML com validação (kind ∈ {skill, rule, persona}) | crud-04, crud-05, crud-06 |
| Writer SQLite (insert/update idempotente por hash do YAML) | crud-10, crud-11, crud-12, crud-13 |
| Embedder ONNX via `embedding-model` (multilingual-e5-small, 384d) | crud-07, crud-08, crud-09 (stub; ONNX real = Phase 9) |
| CLI `npm run catalog:load <path>` funcional | crud-14, crud-15, crud-16 |
| Testes unitários: schema, loader, writer, embedder (≥ 4 testes, coverage 80%) | crud-17, crud-18, crud-19, crud-20 |

---

## Discovery signals (preemptivos)

Nenhum esperado — o caminho `catalog → catalog-yaml-files (load)`, `catalog → embedding-model (encode)`, `catalog → sqlite (write)` já está mapeado no farol atual (`.specs/ARCHITECTURE.md` § Camada produto). Esta phase **adiciona componentes, não edges** — não muda topologia.

Se o Implementer encontrar:
- Necessidade de FTS5 ou sqlite-vec já nesta phase → **structural** discovery (antecipa Phase 4 — bloquearia ou moveria escopo).
- Path do SQLite não-cabe em `data/` (permissões, CWD) → **cosmetic** (renomear path).
- Stub embedder revela-se insuficiente (vetores não-distinguíveis) → **cosmetic** (mudar algoritmo de stub).