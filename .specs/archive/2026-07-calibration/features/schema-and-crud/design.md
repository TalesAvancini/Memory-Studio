# Design — Phase 2 / schema-and-crud

> **Foco:** componentes novos em `src/catalog/`, schema SQLite, fluxo frio de ingestão, e CLI.

---

## Architectural Reference

Componentes do farol (`.specs/ARCHITECTURE.md` § Camada produto) exercitados / adicionados por esta phase:

| Stable ID | Tipo | Papel nesta phase |
|---|---|---|
| `catalog-yaml-files` | external | **Consumido** — fonte: `config/skills/*.yaml` (read-only) |
| `catalog` | backend | **Adicionado** — novo domínio em `src/catalog/`. Orquestra loader + embedder + writer + schema |
| `embedding-model` | backend | **Consumido via interface** — interface `Embedder` em `src/catalog/embedder.ts`; implementação concreta `DeterministicStubEmbedder` (substituível) |
| `sqlite` | database | **Consumido** — `better-sqlite3` driver; schema `skills` + `audit_events` |

Edges do farol exercitadas (todas já mapeadas — não são discovery):

- `catalog → catalog-yaml-files (load)` — default
- `catalog → embedding-model (encode)` — default
- `catalog → sqlite (write)` — default

Regiões tocadas: **Camada produto** (não toca Camada orquestração nem Camada externa).

---

## Visão geral

```
                ┌─────────────────┐
                │  config/skills/ │  catalog-yaml-files (read-only)
                │   *.yaml        │
                └────────┬────────┘
                         │ loadSkillFromFile(path)
                         ▼
        ┌────────────────────────────────────────────┐
        │              src/catalog/                   │
        │                                              │
        │  ┌─────────┐   ┌────────────┐   ┌─────────┐ │
        │  │ loader  │──▶│ embedder   │──▶│ writer  │ │
        │  │ .ts     │   │ (interface)│   │ .ts     │ │
        │  └─────────┘   └────────────┘   └────┬────┘ │
        │       │                              │      │
        │       │ kind ∈ {skill,rule,persona}  │      │
        │       │ sha256(content_yaml)         │      │
        │       ▼                              ▼      │
        │  SkillRecord                  upsertSkill() │
        │                                              │
        │  ┌────────────────────────┐                  │
        │  │ schema.ts              │                  │
        │  │ createSchema(db)       │                  │
        │  └────────────────────────┘                  │
        └────────────────┬─────────────────────────────┘
                         │ better-sqlite3
                         ▼
              ┌─────────────────────┐
              │ data/skills.sqlite  │  sqlite (database)
              │  ├─ skills          │
              │  └─ audit_events    │
              └─────────────────────┘

  CLI (src/catalog/cli.ts):
    npm run catalog:load config/skills/auth-jwt-01.yaml
      → loadSkillFromFile → embed → upsertSkill → stdout: "created skill id=1 slug=auth-jwt-01 hash=..."
```

---

## Componentes novos em `src/catalog/`

### 1. `src/catalog/types.ts` — tipos públicos do domínio

```typescript
export type SkillKind = 'skill' | 'rule' | 'persona';

export interface SkillRecord {
  readonly slug: string;          // kebab-case, único
  readonly kind: SkillKind;
  readonly content: string;       // texto cru do procedimento
  readonly contentYaml: string;   // YAML original serializado (audit trail)
  readonly hash: string;          // sha256(contentYaml), hex 64 chars
  readonly createdAt: number;     // epoch ms, definido no primeiro insert
}

export interface StoredSkill extends SkillRecord {
  readonly id: number;
  readonly updatedAt: number;
}

// Boundary types para YAML cru (antes da validação)
export interface RawSkillYaml {
  slug?: unknown;
  kind?: unknown;
  content?: unknown;
  [key: string]: unknown;
}
```

**Justificativa:** `SkillRecord` é o que loader emite; `StoredSkill` é o que vem do DB (com `id` + `updatedAt`). `RawSkillYaml` é o tipo de boundary (per CLAUDE.md "sem `any` exceto em boundary com JSON dinâmico").

### 2. `src/catalog/loader.ts` — parse + validação de YAML

```typescript
export class LoaderError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_KIND' | 'INVALID_SLUG' | 'MISSING_CONTENT' | 'YAML_PARSE_ERROR',
    readonly path: string
  ) { ... }
}

export function loadSkillFromFile(path: string): SkillRecord;
export function loadSkillFromString(yaml: string, source: string): SkillRecord;
```

**Comportamento:**
- Parseia YAML com a lib `yaml` (não `js-yaml` — mais leve, mesma cobertura, ESM-native).
- `kind` deve ∈ {`skill`, `rule`, `persona`} — lança `LoaderError('INVALID_KIND')` caso contrário.
- `slug` deve bater `^[a-z0-9]+(-[a-z0-9]+)*$` — lança `LoaderError('INVALID_SLUG')`.
- `content` deve ser `string` não-vazia — lança `LoaderError('MISSING_CONTENT')`.
- `contentYaml = canonicalYamlString(rawObject)` — serializa de volta pra forma canônica (chaves ordenadas, indentação estável). Garante que `hash` é reproduzível byte-a-byte.
- `hash = sha256(contentYaml)` — sha256 puro, hex lowercase.
- `slug`, `kind`, `content` são normalizados (NFC + trim).

**Por que `yaml` e não `js-yalml`:** `js-yaml` ainda funciona mas tem histórico de vulnerabilidades e sintaxe menos previsível em YAML 1.2. `yaml` (eemeli/yaml) é a recomendação moderna da comunidade Node 22 ESM.

### 3. `src/catalog/embedder.ts` — interface + stub

```typescript
export class EmbedderError extends Error { ... }

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: 384;
}

export class DeterministicStubEmbedder implements Embedder {
  readonly dimensions = 384 as const;
  async embed(text: string): Promise<Float32Array> {
    const out = new Float32Array(384);
    // Algoritmo: 384 floats derivados de 12 rounds de SHA-256(text)
    // Cada round gera 32 bytes; 384 floats × 4 bytes = 1536 bytes = 48 rounds.
    // Implementação: ver algoritmo abaixo.
    ...
  }
}
```

**Algoritmo do stub (determinístico, ortogonal, normalizado):**

```typescript
// Gera 384 floats em [-1, 1] derivados deterministicamente de `text`
// Usa SHAKE-256-like extension via SHA-256 em counter mode:
//   bytes[i] = SHA256(text || counterBytes(i*32))  (counterBytes = uint32 BE)
// Concatena todos, agrupa em blocos de 4 bytes, lê como little-endian Float32,
// depois normaliza para variância unitária por linha (zero-mean, std=1).
```

Resultado: mesmo `text` → mesmo `Float32Array` byte-a-byte. `text1 ≠ text2` → vetores com distância coseno ≈ 0.99 (efetivamente ortogonais em 384d, suficiente para testes de discrimination).

**Por que não usar zeros:** vetor zero tem distância coseno indefinida e mascara bugs no writer (qualquer embedding seria aceito). O stub precisa produzir vetores realistas que diferenciem entradas.

**Por que determinístico:** testes precisam de round-trip exato (`embed → write → read → Float32Array` preserva bit-a-bit — ver AC `crud-12`). Embedder real (ONNX) tem float drift entre runs; o stub é determinístico por design.

**Path para ONNX real (Phase 9+):**

```typescript
// src/catalog/embedder-onnx.ts (Phase 9 — cold path)
import { Embedder } from './embedder.js';
export class OnnxEmbedder implements Embedder { ... }
```

A troca acontece em `cli.ts` (constructor injection) e nos testes — **zero** mudança em loader/writer/schema.

### 4. `src/catalog/schema.ts` — DDL idempotente

```typescript
export class SchemaError extends Error { ... }

export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('skill','rule','persona')),
      content_yaml TEXT NOT NULL,
      embedding BLOB NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      tenant_hash TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
  `);
}
```

**Decisões:**
- `IF NOT EXISTS` em ambas — suporta `npm test` rodando múltiplas vezes em `:memory:` (crud-03).
- `CHECK(kind IN ...)` no SQLite — segunda camada de defesa caso loader seja burlado.
- `BLOB` para embedding — sem overhead de serialização JSON (1536 bytes direto).
- Sem índices secundários — Phase 4 adiciona FTS5 virtual table + sqlite-vec table.

### 5. `src/catalog/writer.ts` — upsert idempotente

```typescript
export class WriterError extends Error {
  constructor(message: string, readonly code: 'HASH_COLLISION' | 'DB_ERROR') { ... }
}

export interface UpsertResult {
  readonly skill: StoredSkill;
  readonly action: 'inserted' | 'unchanged';
}

export function upsertSkill(
  db: Database.Database,
  record: SkillRecord,
  embedding: Float32Array
): UpsertResult;
```

**Comportamento (idempotência por hash):**
- SELECT por `hash` primeiro.
- Se não existe → INSERT novo registro com `created_at = updated_at = Date.now()`.
- Se existe e mesmo `hash` → não faz nada, retorna `action: 'unchanged'` (não atualiza `slug`, `kind`, `updated_at` — princípio de imutabilidade de identidade).
- Se existe com mesmo `hash` mas `slug` diferente → emite `WriterWarning` via logger (não exception). Mantém o registro original; caller decide o que fazer (CLI apenas loga).
- Embedding é serializado como `Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)`.
- `updated_at` é SEMPRE `Date.now()` no insert; em `unchanged` permanece o valor original.

**Por que não fazer UPDATE em `unchanged`:** reescrever `updated_at` muda a percepção de freshness e quebra qualquer cache downstream que indexe por ele. Idempotência aqui significa "second call is a no-op", não "second call refreshes timestamp".

### 6. `src/catalog/cli.ts` — entry point do comando

```typescript
#!/usr/bin/env node
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { pino } from 'pino';
import { createSchema } from './schema.js';
import { loadSkillFromFile } from './loader.js';
import { DeterministicStubEmbedder } from './embedder.js';
import { upsertSkill } from './writer.js';

const DEFAULT_DB_PATH = 'data/skills.sqlite';

async function main(argv: string[]): Promise<number> {
  // 1. Parse args (espera 1 path)
  if (argv.length !== 3 || argv[0] !== 'catalog:load' && argv[2] === '--help') {
    process.stderr.write('usage: npm run catalog:load <path-to-yaml>\n');
    return 2;
  }
  const yamlPath = resolve(argv[2]);

  // 2. Logger (info em CLI real, silencioso em testes)
  const log = pino({ level: process.env.MS_CATALOG_LOAD_QUIET ? 'silent' : 'info' });

  // 3. Open / create DB + schema
  const dbPath = resolve(process.env.CATALOG_DB_PATH ?? DEFAULT_DB_PATH);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    createSchema(db);

    // 4. Load + embed + upsert
    const record = loadSkillFromFile(yamlPath);
    const embedding = await new DeterministicStubEmbedder().embed(record.content);
    const result = upsertSkill(db, record, embedding);

    // 5. Report
    process.stdout.write(`${result.action} skill id=${result.skill.id} slug=${result.skill.slug} hash=${result.skill.hash}\n`);
    return 0;
  } catch (err) {
    if (err instanceof LoaderError || err instanceof WriterError || err instanceof SchemaError) {
      log.error({ code: err.code ?? 'UNKNOWN', path: yamlPath, msg: err.message }, 'catalog:load failed');
    } else {
      log.error({ err: String(err) }, 'catalog:load failed');
    }
    process.stderr.write(`catalog:load failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  } finally {
    db.close();
  }
}

main(process.argv).then((code) => process.exit(code));
```

**Decisões:**
- Pino logger em modo `silent` quando `MS_CATALOG_LOAD_QUIET=1` (para testes de integração da CLI não poluirem stdout).
- `data/skills.sqlite` como path default, `CATALOG_DB_PATH` env var como override (Phase 6/7 podem usar).
- Exit codes: `0` sucesso, `1` erro runtime, `2` usage error (convenção Unix).
- `db.close()` em `finally` — garante flush mesmo em erro.

### 7. `src/catalog/index.ts` — barrel (só pra este domínio)

Diferente da regra "sem barrel exports" (CLAUDE.md), este **único** `index.ts` é justificado porque o domínio `catalog` é a superfície pública da Phase 2 — outros domínios vão importar daí. Mas o spec/Implementer vai preferir imports diretos (`from '../catalog/loader.js'`) para manter tree-shaking. O `index.ts` existe só pra conveniência da CLI.

```typescript
export { loadSkillFromFile, LoaderError } from './loader.js';
export { upsertSkill, WriterError } from './writer.js';
export { createSchema, SchemaError } from './schema.js';
export { DeterministicStubEmbedder, EmbedderError } from './embedder.js';
export type { SkillRecord, StoredSkill, SkillKind } from './types.js';
```

> **NOTA:** esta é uma exceção pontual ao "sem barrel". Justificativa registrada em DISCOVERIES se Implementer questionar — manteremos imports diretos preferencialmente.

---

## Dependências adicionadas (Justificativa por dep)

| Pacote | Tipo | Justificativa |
|---|---|---|
| `better-sqlite3` | runtime | Sync API (zero async no cold path), FTS5 built-in, sqlite-vec suporta como host. Maturidade: usado em produção por Notion, Linear, etc. |
| `@types/better-sqlite3` | dev | Types — strict mode exige. |
| `yaml` (eemeli/yaml) | runtime | Parser YAML 1.2 compliant; ESM-native; seguro contra YAML bombs. |
| `tsx` | dev | Rodar `.ts` direto sem build step — `npm run catalog:load` simplifica para `tsx src/catalog/cli.ts <path>`. |
| `pino` | runtime | Logger estruturado (CLAUDE.md § Logging). JSON-line, 1 linha por evento. |

**Versões:** minor fixadas em `^x.y.0` na primeira instalação; PR futuro bumpará major se necessário (autoridade humana per CLAUDE.md § Authority boundaries).

---

## Testes (estratégia)

### `test/catalog/schema.test.mjs` (≥ 4 testes)

- T1: `createSchema(:memory:)` cria `skills` com schema esperado (assert column metadata).
- T2: `createSchema(:memory:)` cria `audit_events` com schema esperado.
- T3: `createSchema` chamado 2× não lança (idempotente).
- T4: `INSERT INTO skills (kind='invalid')` falha via `CHECK` constraint.

### `test/catalog/loader.test.mjs` (≥ 4 testes)

- T5: `loadSkillFromString` com YAML válido retorna `SkillRecord` com `hash = sha256(contentYaml)`.
- T6: kind inválido lança `LoaderError('INVALID_KIND')`.
- T7: slug com uppercase ou caractere especial lança `LoaderError('INVALID_SLUG')`.
- T8: `content` ausente lança `LoaderError('MISSING_CONTENT')`.
- T9: Round-trip `loadSkillFromString → JSON.stringify(record) → loadSkillFromString` produz mesmo `hash`.

### `test/catalog/embedder.test.mjs` (≥ 4 testes)

- T10: `embed('hello')` retorna `Float32Array(384)`.
- T11: `embed('hello') === embed('hello')` bit-a-bit (determinismo).
- T12: `cosineSimilarity(embed(a), embed(b)) ≈ 0` para `a ≠ b`.
- T13: Round-trip `Buffer.from(arr.buffer)` preserva bytes exatos (1536 bytes).
- T14: `embed('a').every(x => x >= -1 && x <= 1)` — normalização em [-1, 1].

### `test/catalog/writer.test.mjs` (≥ 4 testes)

- T15: `upsertSkill` em `:memory:` retorna `action: 'inserted'`, `id >= 1`.
- T16: 2ª chamada com mesmo record retorna `action: 'unchanged'`, mesmo `id`.
- T17: record com mesmo `hash` mas `slug` diferente retorna `unchanged` + warning logado (não re-batiza).
- T18: round-trip embedding (`upsertSkill → SELECT embedding → Float32Array`) bit-exato.
- T19: 2 records com hashes diferentes criam 2 rows distintas.

### `test/catalog/cli.test.mjs` (≥ 4 testes)

- T20: `spawnSync('npm', ['run', 'catalog:load', fixture])` retorna exit 0, stdout contém `created skill id=`.
- T21: rodar 2× com mesmo fixture → 2ª stdout contém `unchanged skill id=`.
- T22: caminho inválido → exit ≠ 0, stderr contém mensagem.
- T23: `--help` → exit 2, stderr contém usage.
- T24: `CATALOG_DB_PATH=:memory:` não funciona (SQLite file path required) — documenta limitação ou usa `file::memory:?cache=shared` se desejado.

> **Performance:** suite toda roda em `:memory:` + stub embedder → < 10s. CLI tests usam `spawnSync` em `:memory:` SQLite apontando pra `tmp/`.

**Total:** ≥ 24 testes, cobertura estimada ≥ 85% (loader, embedder, writer são 100% line-coverable; schema é trivial; CLI é testado via process boundary).

---

## File layout final

```
src/
├── catalog/                            # NOVO domínio (esta phase)
│   ├── cli.ts                          # entry point do `npm run catalog:load`
│   ├── embedder.ts                     # interface + DeterministicStubEmbedder
│   ├── index.ts                        # barrel (exceção pontual)
│   ├── loader.ts                       # parse + validação YAML
│   ├── schema.ts                       # DDL (skills + audit_events)
│   ├── types.ts                        # SkillRecord, StoredSkill, SkillKind
│   └── writer.ts                       # upsert idempotente
├── index.ts                            # (intocado — placeholder da Phase 1)
└── social-detector/                    # (intocado — Phase 3 intacta)

test/
├── catalog/                            # NOVO
│   ├── cli.test.mjs
│   ├── embedder.test.mjs
│   ├── loader.test.mjs
│   ├── schema.test.mjs
│   └── writer.test.mjs
├── smoke.test.mjs                      # (intocado)
└── social-detector.test.mjs            # (intocado)

config/
└── skills/                             # NOVO — diretório vazio + 1 fixture
    └── example-jwt-01.yaml             # fixture para testes da CLI

data/                                    # gitignored (Phase 1 já tem no .gitignore)
└── skills.sqlite                       # criado on-demand pela CLI

package.json                            # + deps, + script "catalog:load"
```

---

## Decisões travadas (que NÃO mudam sem PR humano)

1. **Driver SQLite = `better-sqlite3`** (não `node:sqlite` — ainda experimental).
2. **Embedder = interface + stub determinístico** (não ONNX real — fora de escopo por brief).
3. **CLI runner = `tsx`** (não `tsc build + node dist/`, não `--experimental-strip-types`).
4. **YAML parser = `yaml` (eemeli)** (não `js-yaml` — menos seguro, menos moderno).
5. **Logger = `pino`** (CLAUDE.md § Logging já trava).
6. **Idempotência por `hash = sha256(content_yaml)`** (não por slug — slug é mutável; hash é estável).
7. **Barrel `src/catalog/index.ts`** como exceção pontual (registrar em DISCOVERIES se contestado).

---

## Cross-references

- `.specs/ROADMAP.md` Phase 2 (lines 28-42)
- `.specs/ARCHITECTURE.md` § Camada produto (stable IDs: `catalog`, `catalog-yaml-files`, `embedding-model`, `sqlite`)
- `.specs/features/social-detector/validation.md` (referência de formato de validação)
- `CLAUDE.md` § Stack conventions, § Authority boundaries, § Testing contract, § Logging, § Error handling
- `brief-m3cli-phase4.md` § Phase 2 (linha 71 — "Não inventar embedding model download se o brief não pede")