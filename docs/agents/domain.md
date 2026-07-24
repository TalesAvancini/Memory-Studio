# Domain Docs

Como as engineering skills (mattpocock) consomem a documentação de domínio deste repo quando exploram a codebase.

## Antes de explorar, ler estes

- **`CONTEXT.md`** na raiz do repo, ou
- **`CONTEXT-MAP.md`** na raiz do repo se existir — aponta pra 1 `CONTEXT.md` por context. Ler cada um relevante ao tópico.
- **`docs/adr/`** — ler ADRs que tocam a área onde você vai trabalhar. Em repos multi-context, também checar `src/<context>/docs/adr/` por decisões scoped ao context.

Se qualquer desses arquivos não existir, **proceder silenciosamente**. Não flag a ausência; não sugerir criá-los upfront. O `/domain-modeling` skill (via `/grill-with-docs` e `/improve-codebase-architecture`) cria eles lazy quando termos ou decisões são realmente resolvidos.

## File structure

Single-context repo (este repo):

```
/
├── CONTEXT.md                  ← quando existir, é a glossary canônica
├── docs/adr/                   ← quando existir, ADRs numerados (0001-foo.md)
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence de `CONTEXT-MAP.md` na raiz):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Estado atual deste repo

O Memory Studio **não tem** ainda `CONTEXT.md` nem `docs/adr/` formais. O conteúdo de "glossary + domain context" mora hoje em:

- **`CLAUDE.md`** — sections `## Glossary`, `## Stack conventions`, `## Authority boundaries`, `## Cross-references` servem como de facto context.
- **`PLAN.md`** — product spec original (fonte das decisions travadas).
- **`.specs/ARCHITECTURE.md`** — farol arquitetural (LLM-facing).
- **`.specs/DISCOVERIES.md`** — drift log append-only.

Quando `/domain-modeling` rodar (via `/grill-with-docs` ou `/improve-codebase-architecture`), a glossary canônica vai se materializar em `CONTEXT.md` (extraída do `CLAUDE.md ## Glossary`), e decisões formais viram ADRs em `docs/adr/`. **Não duplicar** o conteúdo em ambos até esse momento.

## Use o vocabulário do glossary

Quando seu output nomeia um conceito de domínio (em título de issue, proposta de refactor, hipótese, test name), usa o termo como definido em `CONTEXT.md` (ou em `CLAUDE.md ## Glossary` enquanto `CONTEXT.md` não existir). Não derive pra sinônimos que o glossary explicitamente evita.

Se o conceito que você precisa não está no glossary ainda, é sinal — ou você está inventando linguagem que o projeto não usa (reconsidere) ou há gap real (anote pra `/domain-modeling`).

## Flag ADR conflicts

Se seu output contradiz um ADR existente, surface explicitamente em vez de silenciosamente sobrescrever:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_

## Relação com outras doc systems

| Sistema | Quem usa | Onde |
|---|---|---|
| `CONTEXT.md` / `docs/adr/` (este doc) | mattpocock engineering skills | raiz do repo |
| `CLAUDE.md` | Claude Code / agents | raiz do repo (já existe) |
| `.specs/ARCHITECTURE.md` + `DISCOVERIES.md` | tlc-roadmap-loop orchestrator | `.specs/` |
| `PLAN.md` | humanos / product | raiz do repo (já existe) |

São 4 sistemas de doc com audiências diferentes. Não consolide.