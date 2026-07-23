---
date: 2026-07-22
author: M3E (M3-Executor)
scope: Phase 1 — Scaffold mínimo (fecha pré-condição #1 do Waldemar)
m3_cli_session_audit_by: M3E
version: 1
related_artifacts:
  - brief-m3cli-phase0.md (✅ antecedente)
  - proposta-consolidada.md (§5/§6 — decisões de stack)
  - PLAN.md (§5 — stack)
  - CLAUDE.md (stack conventions: Node 22 LTS, ESM, node:test, TS strict)
  - .specs/ARCHITECTURE.md (farol — referenciar pra naming consistente)
  - handoff-session.md (Turno 3+ — sequência canônica)
preceded_by: brief-m3cli-phase0.md
next_step_brief: brief-m3cli-phase2.md (após pré-cond #1 fechar)
---

# Brief — Phase 1 / Scaffold mínimo (pré-condição #1 do Waldemar)

## Contexto

- **Working dir:** `c:\Users\User\Desktop\AI-Project\Memory-Studio`
- **Objetivo:** fechar a pré-condição #1 do Waldemar (`npm test` < 10s) com o **mínimo de superfície**.
- **Por que Phase 1 manual e fora do loop:** per handoff Turno 3+, o skill loop ainda não foi promovido pra global. Phase 1 também é fora do loop, **sem auto-commit**.
- **Quem audita:** M3E (sessão atual).

## Pré-leitura (apontar, não restatar)

- [CLAUDE.md](CLAUDE.md) — Node 22 LTS, ESM, node:test nativo, TS strict
- [proposta-consolidada.md](proposta-consolidada.md) §5/§6 — decisões travadas
- [PLAN.md](PLAN.md) §5 — stack
- [brief-m3cli-phase0.md](brief-m3cli-phase0.md) — o que já está no `.specs/`
- [.specs/ARCHITECTURE.md](.specs/ARCHITECTURE.md) — farol (stable IDs pra nomear pastas)

## Restrições herdadas do incidente recente

⚠️ **JAMAIS tocar `.claude/settings.json` ou `.claude/settings.local.json`** — são locais por convenção, e o `.gitignore` já os exclui. Esses arquivos podem conter credenciais (vazamento recente de `ANTHROPIC_AUTH_TOKEN`教训ed them). Leia, releia: **read-only**, não copiar, não mover, não recriar.

⚠️ O repositório remoto **já existe** em `https://github.com/TalesAvancini/Memory-Studio` (limpo pós-incidente). **NÃO** criar outro repo. Se for usar git local, `git init` aqui e `git remote add origin <essa URL>`.

## Tarefa — 5 arquivos + 2 comandos + 1 reporte

### 1. `package.json` (root)

```json
{
  "name": "memory-studio",
  "version": "0.0.0",
  "description": "Context injection tool for code agents",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "test": "node --test test/",
    "test:smoke": "node --test test/smoke.test.mjs",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

### 2. `tsconfig.json` (root)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

### 3. `src/index.ts` (root + `src/`)

```ts
/**
 * Memory Studio — entry point placeholder.
 * Implementação real começa em Phase 2 (server + augmenter core).
 * Existe para satisfazer tsconfig e servir de ponto de entrada.
 */

export const VERSION = '0.0.0';

export function placeholder(): string {
  return `Memory Studio v${VERSION} — scaffold`;
}
```

### 4. `test/smoke.test.mjs` (root + `test/`)

**`.mjs` propositalmente, não `.ts`** — mantém zero compile step pro teste, atendendo o SLA < 10s sem tooling extra.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('smoke: runner alive', () => assert.equal(1, 1));
test('smoke: package.json exists', () => assert.ok(existsSync(join(root, 'package.json'))));
test('smoke: tsconfig.json exists', () => assert.ok(existsSync(join(root, 'tsconfig.json'))));
test('smoke: src/index.ts exists', () => assert.ok(existsSync(join(root, 'src', 'index.ts'))));
test('smoke: package.json declares ESM + Node 22', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.engines.node.startsWith('>=22'));
});
```

### 5. Estender `.gitignore` (não sobrescrever)

Garantir que contém (preservar tudo que já tiver):

```
node_modules/
dist/
```

## Comandos (em ordem)

```bash
cd "c:\Users\User\Desktop\AI-Project\Memory-Studio"

# 1. Instalar deps mínimas
npm install

# 2. Smoke + medir tempo (Waldemar pré-cond #1)
time npm test
```

**Esperado:**
- `npm install` exit 0; `typescript` + `@types/node` em `node_modules/`; sem erros críticos. Warnings toleráveis.
- `npm test` exit 0; "5 passed, 0 failed"; **real elapsed < 10s** (alvo Phase 1: < 5s).
- `tsc --noEmit` (não rodar agora — fica pra Phase 2 quando tiver código real; typecheck sem src/ tem pouco valor).

Se travar:
- Rede/registry → **não** rodar `--force` nem trocar registry sem perguntar.
- Erro de import no teste → conferir que é `.mjs` e usa `import` ESM.
- TS errors → irrelevante pra `npm test` se o teste é JS puro, mas pode indicar que `src/index.ts` tem erro de tipo — corrija e re-run.

## Reporte final

Incluir:

- ✅ Lista dos 4 arquivos criados + extensão do `.gitignore`, com tamanhos
- ✅ `npm install` exit code + warnings não-óbvios (se houver)
- ✅ `npm test` exit code + stdout completo ("5 passed, 0 failed")
- ✅ **Tempo real elapsed** do `time npm test` (precisa ser < 10s)
- ✅ `git status` (note que Phase 1 é manual — nada foi commitado sozinho)
- ✅ Decisão sobre `git init` + reconectar ao remoto (se for fazer, documentar; senão, explicitar "deixei local sem git, esperando OK")

## Restrições CRÍTICAS

- ❌ **NÃO** implementar feature nenhuma (server, augmenter, search, catalog, cache, social-detector — nada)
- ❌ **NÃO** tocar `.claude/`, `.specs/`, `.claude/skills/*`, `.agents/`
- ❌ **NÃO** tocar `CLAUDE.md`, `proposta-consolidada.md`, `conversa-loop.md`, `handoff-session.md`, `brief-m3cli-phase0.md`, `brief-m3cli-phase1.md`
- ❌ **NÃO** adicionar deps além de `typescript` + `@types/node`
- ❌ **NÃO** instalar `vitest` / `jest` / `mocha` / qualquer test framework (regra: `node:test` nativo)
- ❌ **NÃO** rodar `git add` / `git commit` / `git push` (Phase 1 manual — user decide)
- ❌ **NÃO** instalar modelos ONNX, embeddings, ou tocar SQLite
- ❌ **NÃO** promover nada a global
- ❌ **NÃO** criar pastas vazias (`src/server/`, `src/augmenter/`, etc) — só `src/index.ts` por enquanto

Se travar em qualquer passo: **parar e reportar** com erro literal + hipótese de causa. Não improvisar.

---

## Gate de auditoria M3E (7 critérios)

1. `package.json` tem `"type": "module"`, `engines.node >=22`, scripts `test`/`test:smoke`/`typecheck`
2. `tsconfig.json` está em strict mode + pelo menos `noUncheckedIndexedAccess` ligado
3. `src/index.ts` é TS válido (sem erros de sintaxe) e exporta algo
4. `test/smoke.test.mjs` tem ≥3 testes, exit 0, zero deps (sem `import` de libs externas)
5. `npm install` exit 0; `node_modules/` populado
6. `npm test` exit 0; **real elapsed < 10s** (atende Waldemar pré-cond #1)
7. Zero side-effects em: `.claude/settings*.json`, `.specs/`, skills, agents, briefs, proposta, conversa, handoff, CLAUDE.md
