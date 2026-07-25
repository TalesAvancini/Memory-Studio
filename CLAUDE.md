# Memory Studio

**Estúdio de injeção de contexto pra agentes de código** (Claude Code, Mavis, Cline, Aider, Cursor…).

> **Objetivo final.** Antes de construir o produto, construímos a **fundação**: skill `tlc-roadmap-loop` v0.2 (calibrada) + integração archify (farol) + `tlc-spec-driven` (base SDD). Produção do produto SÓ após PRD fechado via `grill-with-docs`. Ver `History.md ## A história que norteia este repo`.

Lê o prompt → match no catálogo (Skills / Rules / Personas) → injeta no system message sem quebrar o cache do provedor.

> **Plano do produto:** [PLAN.md](PLAN.md)

---

## Quick reference

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

## Authority boundaries

> **Quem decide o quê, AGORA.** Decisões sobre o **produto Memory Studio** (catalog YAML, thresholds, embedding model, schema, integration modes) vão pra PRD quando finalizado via `grill-with-docs`.

### Decisões vigentes (foundation + skill)

| Decisão | Autoridade | Aprovação humana? |
|---|---|---|
| Bugfix trivial (typo, off-by-one) | LLM via commit direto | não |
| Refactor interno sem mudar contrato | LLM via commit direto | não |
| Renomear arquivo ou variável | LLM | não, desde que atualização atômica |

### Regra de ouro

> Mudanças em **decisões travadas** do [PLAN.md §6](PLAN.md) (Mem0 não entra, Node-only, multilingual-e5-small, cache ephemeral, catálogo versionado, tenant_id hasheado, etc.) **exigem PR + revisão humana explícita** — quando o produto entrar em produção.

---

## Documentation lifecycle (regra operacional)

Quatro documentos canônicos servem papéis distintos. **Não confundir.**

| Doc | Conteúdo | Quando ler | Quando escrever |
|---|---|---|---|
| **History.md** | "Históriinha" (north star) + fatos cronológicos da sessão (numbered) | Início de sessão — entender o passado | Append-only quando marco novo |
| **handoff-session.md** | Estado executivo atual: phase, próximos passos, blockers, decisions | Toda transição entre sessões | **Fim de CADA sessão (obrigatório)** |
| **MEMORY.md** | Patterns de processo, lições, feedback (1 fato por arquivo, auto-injetado pelo sistema) | Início de sessão (carregado auto) | Quando lesson nova emerge |
| **STATE.md** | Decisions (AD-NNN append-only) + Handoff state + validation | Pra ver spec state atual | Quando decisao/spec muda |

**Regra de fim de sessão:** TODA sessão termina com `handoff-session.md` atualizado.

- **Ferramenta preferida:** skill `handoff` do Matt Pocock (plugin `mattpocock/skills`, configurada em `## Agent skills` abaixo).
- **Fallback manual:** template em `archive_handoff/handoff-session-2026-07-23.md`.

**Arquivamento:**

- Handoffs antigos → `archive_handoff/handoff-session-YYYY-MM-DD.md` (nunca deletar — append-only).
- Specs/STATE.md/ROADMAP.md de eras anteriores → `.specs/archive/<era>/` (e.g., `.specs/archive/2026-07-calibration/`). STATE.md só reflete o estado vigente, não histórico de calibração.

**Meta-narrativa (north star):** ver topo de `History.md` — Memory Studio é objetivo final, skill é fundação, fases 0-4 foram calibração.

---

## Glossary

Termos da **skill foundation** (ativos AGORA):

| Termo | Significado |
|---|---|
| **Farol** (Camada 0) | Arquitetura global renderizada pelo Archify; referência cross-phase |
| **Discovery** | Sinal quando `design.md` precisa de componente não-mapeado no farol |
| **Loop / Roadmap** | Modo autônomo do `tlc-roadmap-loop` — sub-agentes em sequência sobre `ROADMAP.md` |
| **Verifier** | Sub-agente fresh e independente que valida o trabalho do Implementer |
| **Subchapter** | Subdivisão de phase grande demais (escape hatch `SUBCHAPTER_BREAKDOWN`) |

Termos do **produto Memory Studio** (não usar até PRD fechar): Catalog, Skill, Rule, Persona, Augment, Hot path, Cold path — todos vão pra PRD.

---

## Cross-references

- [PLAN.md](PLAN.md) — product spec completo (o que, pra quê, stack, decisões, MVP scope)
- [History.md](History.md) — histórico narrativo + north star
- [handoff-session.md](handoff-session.md) — executivo de sessão
- [.specs/STATE.md](.specs/STATE.md) — spec state vigente (era `2026-07-foundation-complete`)
- [.specs/ROADMAP.md](.specs/ROADMAP.md) — placeholder de roadmap (próxima phase: grill-with-docs → PRD)
- [conversa-loop.md](conversa-loop.md) — brainstorm de processo (loop do Waldemar, Archify como farol)
- [notebooklm skill](https://github.com/teng-lin/notebooklm-py) — CLI usada pra consultar o notebook acima
- `tlc-spec-driven` (skill global) — base do ciclo Specify→Design→Tasks→Execute→Verify
- `tlc-roadmap-loop` (skill global) — orquestrador que compõe as 3 camadas (v0.2, calibrada)
- `archify` (skill instalada em `.agents/skills/archify/`) — renderer do farol da Camada 0
- `mattpocock/skills` (plugin) — engineering skills (code-review, tdd, research, domain-modeling, **grill-with-docs**, etc.). Configuração em `docs/agents/*.md` (ver `## Agent skills` abaixo).

---

## Agent skills

Configuração para engineering skills externas (mattpocock/skills).

### Issue tracker

Issues e specs vivem como arquivos markdown em `.scratch/<feature>/` (local-only, solo work, sem GitHub Issues). See `docs/agents/issue-tracker.md`.

### Domain docs

Layout single-context: `CONTEXT.md` + `docs/adr/` na raiz quando criados. Currently o conteúdo de glossary/domain context mora em `CLAUDE.md` (sections Glossary / Authority boundaries / Cross-references) — não duplicar até `/domain-modeling` materializar. See `docs/agents/domain.md`.
