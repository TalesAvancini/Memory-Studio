---
date: 2026-07-28
version: 1
type: auto-grill-temp-context
description: "CONTEXT.md temp construído para auto-grill composite target (PRD.md + PLAN.md). Combina CLAUDE.md §Glossary + PRD §17 (caches + nomenclatura)."
explanation: |
  Conforme SKILL.md §SETUP pre-flight: "If absent, build from CLAUDE.md §Glossary
  + any product-specific glossary section in target docs (e.g., PRD.md §17,
  PLAN.md §<X>)".

  Sem este arquivo, regra 9 → ABORT. O loop sem ubiquitous language é dois AIs
  confirmando um ao outro (auto-confirmação).

  Origem: 2026-07-28, sessão de composite target test inaugural (PRD + PLAN).
  Aplicável apenas para esta run. Não commitar.
---

# CONTEXT (temp, auto-grill 2026-07-28_023050)

> **Ubiquitous language para grilling composite (PRD.md + PLAN.md).**
> Construído per SKILL.md §SETUP pre-flight. Sub-agentes (Interrogator + Proxy) leem este arquivo PRIMEIRO, depois PRD/PLAN.

---

## 1. Documentos alvo (composite)

- **Doc 1:** `PRD.md` (v3.2, 2026-07-27, 17 sections + annex, ~830 linhas)
- **Doc 2:** `PLAN.md` (v2, 2026-07-27, 7 phases + acceptance criteria mapping, ~330 linhas)
- Tratados como UM ÚNICO spec. Interrogator cross-referencia entre os dois.

---

## 2. Skill foundation terms (de CLAUDE.md §Glossary)

| Termo | Significado |
|---|---|
| **Farol** (Camada 0) | Arquitetura global renderizada pelo Archify; referência cross-phase |
| **Discovery** | Sinal quando `design.md` precisa de componente não-mapeado no farol |
| **Loop / Roadmap** | Modo autônomo do `tlc-roadmap-loop` — sub-agentes em sequência sobre `ROADMAP.md` |
| **Verifier** | Sub-agente fresh e independente que valida o trabalho do Implementer |
| **Subchapter** | Subdivisão de phase grande demais (escape hatch `SUBCHAPTER_BREAKDOWN`) |
| **tlc-roadmap-loop** | Orquestrador que compõe as 3 camadas (v0.2, calibrada) |
| **archify** | Renderer do farol da Camada 0 |

---

## 3. Product terms (de CLAUDE.md §Glossary)

| Termo | Significado |
|---|---|
| **Catalog** | Acervo versionado (skills + rules + personas) — git = source of truth |
| **Skill** | Item do catálogo: como fazer X (procedural/diagnostic/reference/pattern) |
| **Rule** | Item do catálogo: regra (pode ser `critical: true`) |
| **Persona** | Item do catálogo: voz/comportamento do agente (cap 3 selecionáveis) |
| **Augment** | Operação de injetar Skills/Rules/Personas no system message |
| **Hot path** | Caminho síncrono (request → response). Zero LLM, zero fetch não-determinístico |
| **Cold path** | Caminho assíncrono (build index, ingest, etc.) |

---

## 4. PRD §17 Glossário — Caches

| Cache | O que é | Onde mora | Métrica | Status |
|---|---|---|---|---|
| **Cache do provedor** (Anthropic) | `cache_control: ephemeral` no system message augmenté. TTL 5min. Hash byte-string do system message = chave. | Anthropic API (server-side) | Log estruturado de `usage.cache_read_input_tokens` (PRD §14.6): request hit rate + token cache coverage | **MVP** |
| **Cache de augmented** (fingerprint semântico) | Fingerprint sobre byte-string final do system message, pra hit entre inputs semanticamente equivalentes mas byte-diferentes. | Memory Studio (in-memory) | Campo `cacheHit: "exact" \| "semantic" \| "miss"` na response do `/augment` | **v3.1+** (omitido no MVP) |

**Regra:** métricas MVP (PRD §10.2) usam log do cache do provedor, NÃO o campo `cacheHit` da response.

---

## 5. PRD §17 Glossário — Nomenclatura canônica

| Termo | Significado | Onde definido |
|---|---|---|
| **fast agent** | Agente rápido (Haiku-class) que lê response do provedor em paralelo com humano. Gera intel pra próximo turn. | PRD §16 |
| **fast-agent-over-response** | Padrão arquitetural: o fast agentuality roda sobre a response, não sobre o prompt. | PRD §16.3 |
| **fast agentuality** | Sinônimo informal de "fast agent" (uso descritivo, não técnico). Evitar em PRD/PLAN. | — |
| **recentFiles** | Lista de paths de arquivos recentes do working tree do agente (`git status modified`, ou equivalente). **Padrão canônico** — usar este nome em PRD, SDK, schema, response. NÃO usar `gitStatus`, `files`, `recent_files`. | PRD §5, §7.1 |
| **scratch** | Scratchpad local do agente (últimos N chars). | PRD §5, §7.1 |
| **todos** | Lista de TODOs ativos do agente. | PRD §5, §7.1 |
| **lastEvent** | Último evento do agente (`tool_error`, `tool_call`, `tool_result`). camelCase canônico. | PRD §5, §7.1 |

---

## 6. Doc roles (de CLAUDE.md cross-references)

| Doc | Papel | Compromisso? |
|---|---|---|
| **PRD.md** | Decisões + justificativas "por que X e não Y" + escopo | ✅ |
| **PLAN.md** | Implementation phases (sequência, deliverables, estimates) | ✅ |
| **BACKLOG.md** | Ideias pós-MVP (append-only, formato I-NNN) | ❌ |
| **History.md** | Narrativa cronológica + north star | Append-only |
| **handoff-session.md** | Executivo de sessão (overwrite por sessão) | Por sessão |
| **MEMORY.md** | Patterns de processo, lessons | Append-only |
| **STATE.md** | Spec state vigente (AD-NNN + handoff) | Append-only |
| **critica-plan.md** | Auditoria externa (2026-07-27, congelada) | Audit-grade |
| **.scratch/** | Local-only feature work | ❌ local |
| **docs/adr/** | Decisão TRAVADA após análise | ✅ |

---

## 7. Decisões PRD §14 (FINALIZADAS 2026-07-26, atualizadas em v3.1/v3.2)

- §14.1 UI: HTMX+Alpine (delegada, com constraints)
- §14.2 Painel vive em: localhost, primeira porta livre
- §14.3 Integração: **proxy transparente (MVP)**; hook/MCP = v3.1+
- §14.4 `fingerprint.agentId`: MVP = `"claude-code"` only; demais v3.1+
- §14.5 state.json: por projeto (`.memory-studio/state.json`)
- §14.6 Cache hit metric: structured JSON log de `usage.cache_read_input_tokens`
- §14.7 Inception híbrida: arquitetura NOVEL, integração gated por grill §16.6

---

## 8. PRD §16.6 — Pré-grill checklist (inception híbrida)

Antes de Phase 6 do PLAN:

- [ ] Validar latency trick em POC (1 turno simulado)
- [ ] Definir fast agent: in-process vs sidecar
- [ ] Definir intel store: file vs unix socket
- [ ] Definir match strategy: regex vs catalog vs embedding
- [ ] Medir cache hit em sessão real (>10 turns)

---

## 9. Farol

`.specs/ARCHITECTURE.md` **NÃO existe**. Regra 10 → skip farol stable-ID check. Orphan IDs (se houver) vão pra `.specs/DISCOVERIES.md` com `conf=medium`.

---

## 10. Authority boundaries (de CLAUDE.md)

| Decisão | Autoridade | Aprovação humana? |
|---|---|---|
| Bugfix trivial | LLM via commit direto | não |
| Refactor interno sem mudar contrato | LLM via commit direto | não |
| Renomear arquivo ou variável | LLM | não, desde que atualização atômica |
| Mudanças em decisões travadas (PRD §6) | exige PR + revisão humana | sim |

---

**Fim do CONTEXT.md temp.** Sub-agentes: leiam este arquivo inteiro ANTES de questionar. Citações `path:line` em PRD.md ou PLAN.md são evidência válida. Citações neste CONTEXT.md também. Dúvidas → `NO_EVIDENCE` no Proxy, conf=low, escalate.