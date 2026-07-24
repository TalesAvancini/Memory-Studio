# Tasks — Phase 2 / schema-and-crud

> **Atomicidade:** cada task = 1 commit. Implementer roda tasks em ordem, commita cada uma, gate (npm test + tsc) tem que passar antes da próxima. **Não batch**.

---

## Resumo

| Campo | Valor |
|---|---|
| Total tasks | **9** (T1 setup deps → T9 final gate) |
| Tasks de código | 7 (T2-T8) |
| Tasks de teste | 1 (T9, mas testes podem ser adicionados incrementalmente em T2-T7) |
| Estimate budget | ~1 batch (≤ 8 tasks × atomic commits) |
| Subchapter breakdown? | **Não** — fase cabe em 1 worker. |
| Gate final | `npm test` < 10s + `tsc --noEmit` exit 0 + coverage ≥ 80% em `src/catalog/` |

---

## Task list (ordenada por dependência)

### T1 — Adicionar dependências e estrutura de diretórios

**Scope:**
- `package.json` (deps): `+ better-sqlite3`, `+ @types/better-sqlite3`, `+ yaml`, `+ tsx`, `+ pino`
- `package.json` (scripts): `+ "catalog:load": "tsx src/catalog/cli.ts"`, `+ "test:catalog": "node --test test/catalog/"` (opcional, helpful)
- Criar diretórios vazios: `src/catalog/`, `test/catalog/`, `config/skills/`, `data/`
- Garantir `.gitignore` cobre `data/` (já cobre per Phase 1)

**Verificação:**
- `npm install` exit 0
- `node -e "require('better-sqlite3')"` exit 0 (sanity check)
- `npx tsx --version` exit 0

**Commit:** `chore(deps): add catalog phase 2 dependencies`

---

### T2 — Tipos públicos + errors tipados

**Scope:**
- `src/catalog/types.ts` — `SkillKind`, `SkillRecord`, `StoredSkill`, `RawSkillYaml` (conforme design.md § 1)
- `src/catalog/errors.ts` — `LoaderError`, `WriterError`, `SchemaError`, `EmbedderError` (uma classe por arquivo de domínio também é OK; consolidado em `errors.ts` é mais simples)

**Verificação:**
- `tsc --noEmit` exit 0 (tipos compilam)
- Test placeholder `test/catalog/types.smoke.test.mjs` apenas com `assert.equal(1, 1)` (evita suite vazia em CI)

**Commit:** `feat(catalog): add public types and error hierarchy`

---

### T3 — Schema SQLite (skills + audit_events)

**Scope:**
- `src/catalog/schema.ts` — `createSchema(db)` idempotente (conforme design.md § 4)

**Verificação (automatizada em `test/catalog/schema.test.mjs`):**
- AC crud-01: tabela `skills` tem colunas esperadas (`PRAGMA table_info(skills)`).
- AC crud-02: tabela `audit_events` tem colunas esperadas.
- AC crud-03: chamar `createSchema` 2× não lança.

**Gate:** `npm test` exit 0, testes schema passam.

**Commit:** `feat(catalog): add sqlite schema with skills and audit_events tables`

---

### T4 — Loader YAML com validação

**Scope:**
- `src/catalog/loader.ts` — `loadSkillFromFile(path)`, `loadSkillFromString(yaml, source)`, `canonicalYamlString(rawObject)` helper (conforme design.md § 2)
- `config/skills/example-jwt-01.yaml` — fixture para testes (kind: skill, slug: example-jwt-01, content: "How to validate JWT tokens...")

**Verificação (automatizada em `test/catalog/loader.test.mjs`):**
- AC crud-04: kind inválido / slug inválido / content ausente / YAML malformado → cada um lança o `LoaderError` correto com `code` correto.
- AC crud-05: campos extras preservados em `contentYaml`.
- AC crud-06: `hash = sha256(content_yaml)`, NFC + trim aplicados em slug.
- Bonus: round-trip `load → JSON.stringify → load` produz mesmo `hash`.

**Gate:** `npm test` exit 0, testes loader passam. Coverage de `loader.ts` ≥ 90%.

**Commit:** `feat(catalog): add yaml loader with kind and slug validation`

---

### T5 — Embedder interface + stub determinístico

**Scope:**
- `src/catalog/embedder.ts` — `Embedder` interface + `DeterministicStubEmbedder` (conforme design.md § 3, algoritmo SHA-256 counter-mode → 384 floats normalizados)

**Verificação (automatizada em `test/catalog/embedder.test.mjs`):**
- AC crud-07: `embed('hello')` retorna `Float32Array(384)`.
- AC crud-07: mesmo input → mesmo vetor byte-a-bit.
- AC crud-08: `embedder` é uma interface — criar `class NullEmbedder implements Embedder` em teste, garantir que writer aceita.
- AC crud-09: `Buffer.from(arr.buffer).byteLength === 1536`.
- Bonus: `cosineSimilarity(embed(a), embed(b))` ≈ 0 para `a ≠ b`.

**Gate:** `npm test` exit 0, testes embedder passam. Coverage de `embedder.ts` = 100% (código pequeno).

**Commit:** `feat(catalog): add Embedder interface and deterministic stub (384d)`

---

### T6 — Writer SQLite idempotente

**Scope:**
- `src/catalog/writer.ts` — `upsertSkill(db, record, embedding)` (conforme design.md § 5)

**Verificação (automatizada em `test/catalog/writer.test.mjs`):**
- AC crud-10: 2 calls com mesmo record → 1ª `inserted`, 2ª `unchanged`, mesmo `id`.
- AC crud-11: record com mesmo `hash` mas `slug` diferente → `unchanged` + warning logado (assert pino logs contêm `WriterWarning`).
- AC crud-12: round-trip embedding bit-exato (`upsertSkill → SELECT embedding → Float32Array`).
- AC crud-13: `updated_at` muda em `inserted`, **não** muda em `unchanged`.

**Gate:** `npm test` exit 0, testes writer passam. Coverage de `writer.ts` ≥ 90%.

**Commit:** `feat(catalog): add sqlite writer with idempotent upsert by hash`

---

### T7 — CLI entry point

**Scope:**
- `src/catalog/cli.ts` — script completo (conforme design.md § 6)
- `src/catalog/index.ts` — barrel (exceção justificada em design.md)

**Verificação (automatizada em `test/catalog/cli.test.mjs` via `spawnSync`):**
- AC crud-14: argv inválido → exit 2, stderr contém `usage:`.
- AC crud-15: `npm run catalog:load config/skills/example-jwt-01.yaml` → exit 0, stdout contém `created skill id=1 slug=example-jwt-01 hash=...`. 2ª run com mesmo arquivo → stdout contém `unchanged skill id=1 slug=...`.
- AC crud-16: arquivo inexistente → exit 1, stderr contém mensagem de erro.

> **Implementação dos testes CLI:** usar `child_process.spawnSync('npm', ['run', 'catalog:load', fixture])` apontando `CATALOG_DB_PATH` para `tmp/test-${nanoid}.sqlite`. Cleanup no `finally`. Pino quiet via `MS_CATALOG_LOAD_QUIET=1`.

**Gate:** `npm test` exit 0, testes CLI passam. `npm run catalog:load config/skills/example-jwt-01.yaml` roda em < 2s (stub embedder é instantâneo).

**Commit:** `feat(catalog): add CLI entry point for catalog:load`

---

### T8 — Atualizar `src/index.ts` para reexportar o domínio catalog (opcional, recomendado)

**Scope:**
- `src/index.ts` — adicionar `export * from './catalog/index.js'` (ou imports nomeados específicos)

**Justificativa:** mantém `catalog` discoverable via entry point. Não quebra a regra "sem barrel" porque `src/index.ts` é o entry point histórico do package.

**Verificação:**
- `tsc --noEmit` exit 0
- Smoke test: `node -e "import('./src/index.ts')"` (via tsx) — pelo menos 1 export importável sem erro

**Commit:** `feat(catalog): re-export catalog domain from src/index`

> **Nota:** se o Implementer julgar este step desnecessário (prefere imports diretos), pode pular e remover este commit. Não é blocker.

---

### T9 — Gate final + coverage report

**Scope:**
- Rodar `npm test` e medir tempo real
- Rodar `npx tsc --noEmit`
- Gerar coverage report (script nativo Node 22 `node --test --experimental-test-coverage` ou `c8` se preferir)
- Atualizar `package.json` com script `test:coverage` (opcional)

**Verificação:**
- `npm test` exit 0, **< 10s real** (pré-cond Waldemar #1)
- `npx tsc --noEmit` exit 0
- Coverage em `src/catalog/`: linhas ≥ 80%, branches ≥ 75%, functions ≥ 80%
- Nenhum teste de smoke/social-detector foi quebrado (suite inteira: 5 smoke + 60 social-detector + ≥ 24 catalog = ≥ 89 testes)

**Se coverage < 80%:** adicionar testes extras (não cobertos por este task list — Implementer decide se faz sentido atomicamente ou se agrupa). **Não** baixar threshold pra "passar".

**Commit:** `chore(catalog): verify phase 2 gates pass and document coverage`

---

## Test Coverage Matrix (ACs ↔ testes)

| AC | Test ID | File | Comportamento esperado (assert) |
|---|---|---|---|
| **crud-01** | T-SCHEMA-01 | `test/catalog/schema.test.mjs` | `PRAGMA table_info(skills)` lista colunas esperadas (id, slug, kind, content_yaml, embedding, hash, created_at, updated_at) |
| **crud-02** | T-SCHEMA-02 | `test/catalog/schema.test.mjs` | `PRAGMA table_info(audit_events)` lista colunas esperadas (id, ts, tenant_hash, event_type, payload) |
| **crud-03** | T-SCHEMA-03 | `test/catalog/schema.test.mjs` | `createSchema(db); createSchema(db)` não lança |
| **crud-04** | T-LOADER-01..04 | `test/catalog/loader.test.mjs` | kind inválido, slug inválido, content ausente, YAML malformado → `LoaderError` com `code` correto |
| **crud-05** | T-LOADER-05 | `test/catalog/loader.test.mjs` | campos extras preservados no `contentYaml` (snapshot YAML re-serializado contém chaves extras) |
| **crud-06** | T-LOADER-06 | `test/catalog/loader.test.mjs` | `hash` = primeiros 64 chars hex de `sha256(contentYaml)`; slug normalizado (NFC + trim) |
| **crud-07** | T-EMBED-01..02 | `test/catalog/embedder.test.mjs` | `embed('hello').length === 384`; `Buffer.compare(embed(a), embed(a)) === 0` |
| **crud-08** | T-EMBED-03 | `test/catalog/embedder.test.mjs` | `class FakeEmbedder implements Embedder` compila + `upsertSkill(db, record, fakeEmbed())` aceita (validates interface compliance) |
| **crud-09** | T-EMBED-04 | `test/catalog/embedder.test.mjs` | `Buffer.from(arr.buffer).byteLength === 1536` |
| **crud-10** | T-WRITER-01..02 | `test/catalog/writer.test.mjs` | 1ª call `action === 'inserted'`, 2ª `action === 'unchanged'`, mesmo `id` |
| **crud-11** | T-WRITER-03 | `test/catalog/writer.test.mjs` | record com `hash` igual mas `slug` diferente → `unchanged` + log pino contém `WriterWarning` com `slug_diff` |
| **crud-12** | T-WRITER-04 | `test/catalog/writer.test.mjs` | round-trip: `upsertSkill(db, record, emb)` + `SELECT embedding FROM skills WHERE id = ?` + `new Float32Array(buf)` === `emb` bit-a-bit |
| **crud-13** | T-WRITER-05 | `test/catalog/writer.test.mjs` | 1ª call `updated_at === created_at`; 2ª call `updated_at` permanece o valor original (não atualiza) |
| **crud-14** | T-CLI-01 | `test/catalog/cli.test.mjs` | `spawnSync('npm', ['run', 'catalog:load'])` (sem path) → exit 2, stderr contém `usage:` |
| **crud-15** | T-CLI-02 | `test/catalog/cli.test.mjs` | rodar com fixture válida → exit 0, stdout `created skill id=1 slug=example-jwt-01 hash=...`; 2ª run → `unchanged skill id=1 ...` |
| **crud-16** | T-CLI-03 | `test/catalog/cli.test.mjs` | path inexistente → exit 1, stderr contém mensagem de erro |
| **crud-17** | (cross-cutting) | — | coverage ≥ 80% em `src/catalog/` (medido em T9) |
| **crud-18** | (cross-cutting) | — | `npm test` < 10s real (medido em T9) |
| **crud-19** | T-LOADER-04, T-WRITER-06 | `loader.test.mjs`, `writer.test.mjs` | errors lançados são `instanceof LoaderError` / `instanceof WriterError` (não `Error` cru) |
| **crud-20** | T-CLI-04 | `test/catalog/cli.test.mjs` | `spawnSync(..., { env: { MS_CATALOG_LOAD_QUIET: '1' } })` → stdout pino vazio (sem JSON-line poluindo) |

---

## Gate Check Commands

```bash
# Gate por task (rodar antes do commit):
cd "c:\Users\User\Desktop\AI-Project\Memory-Studio"

# Gate geral (T9 — final):
npm test                                  # < 10s, exit 0, ≥ 89 passed
npx tsc --noEmit                          # exit 0
npm run test:smoke                        # 5 smoke tests passam (não regrediu)
node --test --experimental-test-coverage test/catalog/  # ≥ 80% linhas em src/catalog/

# Smoke manual da CLI (opcional, mas recomendado em T7):
npm run catalog:load config/skills/example-jwt-01.yaml
# esperado: created skill id=1 slug=example-jwt-01 hash=<64-hex-chars>

# Smoke de idempotência (T7):
npm run catalog:load config/skills/example-jwt-01.yaml
# esperado: unchanged skill id=1 slug=example-jwt-01 hash=<same-64-hex-chars>

# Verificar DB:
node -e "const d=require('better-sqlite3')('data/skills.sqlite'); console.log(d.prepare('SELECT id,slug,kind,length(embedding) AS emb_bytes FROM skills').all());"
# esperado: [{id:1, slug:'example-jwt-01', kind:'skill', emb_bytes:1536}]
```

---

## Atomicidade & commits

Cada task = 1 commit. Mensagens em Conventional Commits (`feat:`, `chore:`, `test:`, `fix:`).

**Nunca** batch de múltiplas tasks em um commit. Se um teste falha mid-batch, é trivial reverter com `git reset --hard HEAD~1` e tentar de novo.

**Nunca** modificar `src/social-detector/**`, `test/smoke.test.mjs`, `test/social-detector.test.mjs`, `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json`, `CLAUDE.md`, `package-lock.json` (a não ser gerado por `npm install`), ou qualquer arquivo fora do escopo declarado acima.

**Nunca** rodar `git push` — orchestrator decide quando promover (CLAUDE.md § Authority boundaries).

---

## Discovery signals (gate pós-phase)

Após T9, Implementer reporta ao orchestrator. Orchestrator checa `.specs/DISCOVERIES.md`:

- Se Implementer adicionou entrada `cosmetic` (ex: "path de data/ não cabe em Windows CI") → log only.
- Se Implementer adicionou entrada `structural` (ex: "FTS5 virtual table precisou entrar nesta phase") → orchestrator surface pra humano, decide se Phase 2 se expande ou se escopo vai pra Phase 4.
- Se Implementer adicionou entrada `critical` (ex: "schema versionamento é obrigatório antes de qualquer dado real") → **bloqueia próxima phase**, escala humano.

Expectativa: **0 discoveries** (decisões já travadas em design.md § Decisões travadas; nada estruturalmente novo aparece).

---

## Cross-references

- `spec.md` — ACs e traceability
- `design.md` — decisões arquiteturais e componentes
- `.specs/features/social-detector/validation.md` — referência de formato de validação (Phase 3 PASS)
- `.specs/ROADMAP.md` Phase 2 (lines 28-42)
- `CLAUDE.md` § Authority boundaries (o que Implementer pode decidir vs. precisa de humano)