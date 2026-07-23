# Handoff — Memory Studio / Roadmap Loop

**Data:** 2026-07-22 (mesmo dia — humano voltou do intervalo, Turno 1 fechado)
**Próxima sessão alvo:** mesmo dia, sequência do Turno 2

---

## TL;DR (5 linhas)

Consolidamos em `proposta-consolidada.md` o padrão Waldemar (Loop Engineering) refinado com **3 camadas**: **A — Architecture Reference** (farol Archify), **B — Roadmap Loop** (`tlc-roadmap-loop`), **C — Phase Graph** (Planner→Implementer→Verifier). Auditoria aplicou **6 fixes** (2 técnicos, 1 conceitual, 3 flags). **Turno 1 fechado nesta sessão**: 3 patches aplicados na cópia local da skill + self-critique §14.5 (4 checks passaram, 2 ambiguidades resolvidas na iteração). **Próximo**: Turno 2 — revisão crítica como Planner sub-agent (ainda não feito).

---

## Estado dos artefatos

| Arquivo | Status | Conteúdo |
|---|---|---|
| [PLAN.md](PLAN.md) | original | spec do produto (9 fases MVP, stack, decisões) |
| [CLAUDE.md](CLAUDE.md) | ✅ expandido | testing contract + authority boundaries + stack conventions + glossary |
| [conversa-loop.md](conversa-loop.md) | ✅ 3 passadas | M3E 1ª + M3-CLI 1ª/2ª + addendum Archify |
| [proposta-consolidada.md](proposta-consolidada.md) | ✅ auditada | guia operacional, 6 fixes aplicados |
| `handoff-session.md` | ✅ este arquivo | estado cross-session |
| `~/.claude/skills/tlc-roadmap-loop/` | ✅ intocado | skill global preservada |
| `.claude/skills/tlc-roadmap-loop/SKILL.md` | ✅ **cópia local patcheada** | 295 linhas (+37 vs global), 3 patches aplicados |
| `.specs/` | ⏸️ não existe | virá no bootstrap (turno 3+) |
| `.agents/skills/archify/` | ✅ instalada | renderer do farol (Camada A) |

---

## Decisões travadas nesta sessão

### Arquitetura (consolidada em proposta §2)

- **3 camadas A/B/C** (não 0/1/2) — A é **fonte** (PRD-level), B é **executor** (ROADMAP), C é **phase graph** (sub-agentes)
- **Consumo dual do farol**: LLM lê `ARCHITECTURE.md` (texto, stable IDs); humano lê `architecture.html` (visual, interativo)
- **Estado do farol NÃO entra no STATE.md** — vive em 3 arquivos coesos (architecture.html + ARCHITECTURE.md + DISCOVERIES.md)
- **Drift arquitetural = discovery, não falha** — append em DISCOVERIES.md, surface no fim da fase

### Patches aplicados (consolidada §5) — **TODOS APLICADOS NESTA SESSÃO**

- ✅ **Patch 1**: input do farol no sub-agent prompt do Planner (refs ARCHITECTURE.md + DISCOVERIES.md + nota explícita que architecture.html é humano-facing) + role-footnote do Planner sobre discovery
- ✅ **Patch 2**: step 8b novo no orchestrator flow (surface de DISCOVERIES pós-Verifier, com comando Archify correto pós-audit)
- ✅ **Patch 3** (§5.3): SUBCHAPTER_BREAKDOWN expandido — 3 gatilhos (`>15 tasks` OU `>=2 discoveries` OU `>=1 critical`) visíveis no template

### Iterações pós-self-critique (Check 4)

- **A1** (Planner em pre-bootstrap): resolvido — footnote do Planner agora tem fallback explícito pra `PLAN.md`/`AGENTS.md` como proxy do farol; nunca bloquear fase por farol ausente
- **A2** (ownership do re-render): resolvido — step 8b explicita "orchestrator owns this, not sub-agents"; regeneração de JSON pode ser delegada a sub-agent fresh se schema fidelity importa
- **A3** (autonomous mode vs y/n no step 8b): flag de leitura, não falha — step 8b é ação do orchestrator, não viola autonomia do sub-agent (sub-agents continuam sem confirmation gates; orchestrator pode perguntar y/n ao humano)

### Convenções novas (decisão local, não vem de fontes externas)

- **Stable IDs do farol**: kebab-case, imutáveis; label mutável
- **Severidade de discovery**: `cosmetic | structural | critical` — operacionalizada em step 8b (critical bloqueia; structural×3 auto-sugere; cosmetic só loga)
- **Auto-re-render policy**: humano-triggered por default; auto só em `critical` ou `structural >= 3`

### Refinamentos R-1 a R-8 (consolidada §8) — todos adotados

---

## O que falta — ordem crítica

### Turno 1 — M3-CLI ✅ FECHADO

- [x] **(a)** resolver flag `lessons.json` em §4.1 (atualizar nota de audit pra "resolvido")
- [x] **(b)** aprofundar rationale da taxonomia de severidade em Apêndice A (alinhar com prática de engenharia)
- [x] **Criar cópia local** da skill em `.claude/skills/tlc-roadmap-loop/SKILL.md` (global intacta)
- [x] **Redigir texto exato dos patches** (Patch 1 + Patch 2 + Patch 3)
- [x] **Aplicar patches na cópia local**
- [x] **Self-critique §14.5** — 4 checks passaram (2 ambiguidades resolvidas na iteração)
- [x] Subir resultado pro humano revisar → Definition of Done atingida

### Turno 2 — Humano (ou M3-CLI a critério) — **PRÓXIMO**

- [ ] **Revisão crítica como Planner sub-agent**: ler a skill patcheada e perguntar "se eu fosse o Planner recebendo este prompt, saberia o que fazer?"
- [ ] Considerar **spawnar sub-agent fresh** com a skill patcheada + instrução "produza spec.md para phase-1-setup" → valida template na prática
- [ ] Iterar até o loop ficar sólido (não só funcionar)

### Turno 3+ — Só após Turno 2 fechar

- [ ] Bootstrap do farol (Phase 0): gerar `architecture.architecture.json` → validar → renderizar HTML → gerar ARCHITECTURE.md → criar DISCOVERIES.md vazio
- [ ] Phase 1 manual do Memory Studio via `tlc-spec-driven` direto (fora do loop, sem auto-commit)
- [ ] Capturar discoveries, calibrar threshold de severidade
- [ ] **Só então** promover patches pra skill global `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (com OK humano)

---

## Pendências / flags abertos

| # | Pendência | Bloqueia? |
|---|---|---|
| **D1** | Aplicar patches na skill global | sim — mas só após Turno 2 |
| **D5** | Estado do farol em STATE.md | **não** (decidido: não incluir) |
| **D10** | Phase mapping do PLAN §8 → ROADMAP.md (consolidada §10) | não, validar no bootstrap |
| **Threshold de re-render** | severidade vs contagem | calibrado na proposta §5.2; falta piloto |
| **Precedência de skills** | confirmar `.claude/skills/` (local) > `~/.claude/skills/` (global) | ✅ **resolvido** — comportamento padrão Claude Code |
| **A3** (autonomous mode vs y/n) | flag de leitura | não bloqueia — step 8b é orchestrator-owned |

---

## Contexto crítico pra retomar

**Não apressar.** O foco é **otimizar o loop skill**, não começar a desenvolver Memory Studio. Bootstrap valida o loop, não o contrário. Se bootstrap rodar antes do loop estar otimizado, qualquer defeito aparece como problema do Memory Studio quando é problema de orquestração.

**Cópia local, não global.** Patches vão em `.claude/skills/tlc-roadmap-loop/SKILL.md`. Skill global em `~/.claude/` fica intocada até validação final — protege outros projetos.

**Archify não consome PRD.** É renderer de JSON estruturado. O fluxo correto: LLM/humano lê PRD → escreve `.specs/architecture.architecture.json` (segue schema em `.agents/skills/archify/schemas/architecture.schema.json`) → `node .agents/skills/archify/bin/archify.mjs render architecture <json> <html>`. **Comando exato (passos 3-4 do step 8b):**
```
node .agents/skills/archify/bin/archify.mjs validate architecture .specs/architecture.architecture.json
node .agents/skills/archify/bin/archify.mjs render architecture .specs/architecture.architecture.json .specs/architecture.html
```

**AGENTS.md no Claude Code = CLAUDE.md.** Já criado e expandido. Falta seção "Testing Contract" explícita (single-paragraph) antes do primeiro Implementer — pré-condição Waldemar #4.

**Distância descrição↔implementação > parece.** Os 3 patches eram 3 bullets curtos na proposta; aplicação forçou 2 iterações (A1: pre-bootstrap fallback; A2: orchestrator ownership). Self-critique como Planner é o único mecanismo que pegou isso — descrição top-down não pega.

---

## Skills envolvidas

| Skill | Tipo | Estado |
|---|---|---|
| `tlc-spec-driven` | global (`~/.claude/skills/`) | base, não tocar |
| `tlc-roadmap-loop` | global | **intocado** (proteção) |
| `tlc-roadmap-loop` | local (`.claude/skills/`) | **patcheada, awaiting Turno 2 review** |
| `archify` | local (`.agents/skills/archify/`) | instalada, ok |
| `notebooklm` | global | CLI consultada no início |

---

## Links e referências externas

- **NotebookLM** "Loop" (Waldemar + Archify): ID `6f72e66d-c861-4993-bae1-cbe41808f475` — sempre via `-n <id>`, NUNCA `use <id>`
- [archify skill](https://github.com/tt-a1i/archify) — renderer do farol
- [tlc-roadmap-loop skill](https://github.com/...) — orquestrador (3 camadas)
- Waldemar vídeo "Loop Engineering: 500 mil linhas migradas" — fonte da abordagem

---

## Histórico desta sessão (2026-07-21 → 2026-07-22)

1. M3E — criou CLAUDE.md com notebook ID, apresentou 1ª passada do loop Waldemar
2. M3-CLI — adicionou skill global `tlc-roadmap-loop`, 5 omissões + 1 discordância + 3 adições
3. M3E — consultou notebook no NotebookLM, apresentou entendimento da Camada 0 (Archify como farol)
4. M3-CLI — corroborou + adicionou refinamentos (severidade, etc)
5. Humano — expandiu CLAUDE.md pra formato completo de project glue (testing contract, authority, conventions)
6. M3-CLI — escreveu `proposta-consolidada.md` (12 seções + 3 apêndices)
7. M3E — auditou proposta, aplicou 6 fixes (Archify CLI, consumo dual, 200 jogadores, lessons.json, severidade)
8. Humano — pushback no "nj-mmo como caso": corrigido §1.3 (Memory Studio É o caso)
9. M3-CLI — propôs bootstrap; M3E — contra-propus (otimizar loop primeiro); M3-CLI — concordou
10. **Humano em descanso, fila Turno 1+2+3 documentada**
11. M3-CLI — **voltou no mesmo dia** (2026-07-22), fechou Turno 1 (3 patches + 4 checks). Aguarda Turno 2.

