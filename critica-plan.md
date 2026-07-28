---
date: 2026-07-27
version: 1
status: ready-to-review
description: "Crítica consolidada do PRD.md v3 + PLAN.md v1. Lista contradições internas, inconsistências técnicas, e contradições cruzadas. Companion de auditoria, não substitui PRD/PLAN."
explanation: |
  Origem: sessão 2026-07-27, humano pediu pra "procurar inconsistências
  no PRD/PLAN" e consolidar num doc. Dois relatórios separados foram
  primeiro apresentados em chat; este arquivo é a versão canônica
  persistida.

  Escopo:
  - Cobre PRD.md (v3, 2026-07-26, 17 seções + anexo, 781 linhas)
  - Cobre PLAN.md (v1, 2026-07-26, 7 phases, 293 linhas)
  - Cobre as contradições cruzadas (PRD ↔ PLAN)

  Não escopo:
  - Não propõe edits. Documenta findings com severidade, localização
    e explicação. Decisão de fix fica com humano.
  - Não toca em code (PRD/PLAN não tem code).
  - Não cobre `.specs/STATE.md`, `History.md`, `handoff-session.md`,
    `CLAUDE.md` (auditados separadamente em sessões anteriores).

  Princípio de criticismo: distinguir
  (1) contradição direta = bloqueia implementação
  (2) ambiguidade = gera bug de interpretação
  (3) inconsistência técnica = estimativa/lacuna falha
  (4) polish = cosmético

  Aplica-se regra MEMORY [[metadata-default-required]] (frontmatter YAML).
related:
  - PRD.md
  - PLAN.md
  - CLAUDE.md
  - handoff-session.md
---

# Crítica PRD.md v3 + PLAN.md v1

**Data:** 2026-07-27
**Versão:** 1
**Status:** pronto pra revisão humana
**Companion:** [PRD.md](PRD.md) (decisões) + [PLAN.md](PLAN.md) (fases). Este doc: auditoria.

---

## 0. Resumo executivo

| | PRD | PLAN | Cruzados |
|---|---|---|---|
| **CRITICAL** | 5 | 7 | 3 |
| **HIGH** | 5 | 6 | 2 |
| **MEDIUM** | 5 | 3 | 0 |
| **LOW** | 2 | 1 | 0 |
| **Total** | **17** | **17** | **5** |

**Bloqueadores imediatos (antes de Phase 1):** 12 findings CRITICAL+HIGH que tocam escopo MVP, sequência de phases, e contrato do `/augment`.

**Risco de drift:** PRD §3 e §18 são redundantes sobre inception híbrida; PRD §7.1 `cacheHit` é forward-compat v3.1 sem glosa; PLAN não tem phase de retrieval/match.

**Risco de credibilidade:** "30-40h" prometido em PRD §9 e PLAN linha 45 não fecha a soma das phases (34-49h).

**Recomendação operacional:** antes de Phase 1, fechar os 7 CRITICAL cruzados abaixo. Antes de Phase 6 (inception híbrida), rodar grill em PRD §18.6.

---

## 1. Metodologia

- **Leitura íntegra** de PRD.md (781 linhas, 17 seções + anexo) e PLAN.md (293 linhas, 7 phases + diagramas + cross-refs).
- **Comparação intra-doc:** cada afirmação checada contra o resto do mesmo documento.
- **Comparação cruzada:** claims do PRD checadas contra phases do PLAN (companion).
- **Severidade:** CRITICAL (contradição direta, bloqueia implementação) > HIGH (ambiguidade, gera bug) > MEDIUM (técnico/nomenclatura) > LOW (polish).
- **Localização:** seção + linha (ou intervalo) pra reproducibilidade.
- **Sem alteração de arquivos.** Auditoria não toca em PRD/PLAN.

---

## 2. Findings do PRD.md

### 2.1 CRITICAL — contradição direta

#### PRD-C1. Hook é MVP ou v3.1+?

| Lugar | Diz |
|---|---|
| §1 linha 87 | "3 modos de integração com agentes: proxy transparente (...), **hook (fallback)**, MCP (futuro)" — hook entregue |
| §3 linhas 164-170 | Tabela lista **Hook** sem qualifier de versão |
| §14.3 linhas 603-604 | "**Hook é fallback (v3.1+ se virar necessário)**" — hook é v3.1+ |

§1 e §3 entregam hook no MVP; §14.3 adia. Phase 1-5 do PLAN não pode ser planejada sem saber.

#### PRD-C2. Porta 7788 hardcoded vs "primeira porta livre"

- §5 linha 254 (exemplo SDK): `baseURL: "http://127.0.0.1:7788"`
- §4 linha 212 + §14.2: decisão é **"localhost, primeira porta livre"**

Exemplo do SDK contradiz a decisão finalizada. Quem copiar/colar o exemplo viola o contrato.

#### PRD-C3. Inception híbrida: FINALIZADA mas integração pendente

| Lugar | Status declarado |
|---|---|
| §1 linha 86 (item 7) | entregue no MVP |
| §10.1 linha 482 | critério de aceitação MVP (checkbox) |
| §14.7 | decisão FINALIZADA 2026-07-26 |
| §18.1 linha 667 | "**Pré-grill em §18.6 antes de integrar formalmente em §3** e iniciar Phase 6 do PLAN" |

Três lugares dizem "MVP / finalizada", um diz "integração pendente". Compatível de fato (arquitetura fechada, engenharia pendente), mas não está explicitado.

#### PRD-C4. Lista de agentes suportados no proxy excede MVP

- §3 linha 166: "Proxy (baseURL custom) ✅ Sim — Claude Code, **Cline, Aider, OpenCode**"
- §14.4 linha 608: "MVP = claude-code only"

§3 sugere suporte a 4 agentes; §14.4 diz 1. Schema do `fingerprint.agentId` precisa saber se aceita IDs v3.1 ou rejeita.

#### PRD-C5. `activeCatalog` no request vs `.memory-studio/state.json` server-side

- §7.1 linha 369: request carrega `activeCatalog: string[]`
- §4 linha 222: "Estado de toggle vive em `.memory-studio/state.json` no projeto"

Quem é source of truth? SDK envia + servidor valida? Servidor ignora e lê do filesystem? Muda contrato do `/augment`.

### 2.2 HIGH — ambiguidade

#### PRD-H1. Numeração pula §16 e §17

Documento vai de §15 (Cross-references) direto pra §18 (Inception Híbrida). Gap visível — provável edição incompleta.

#### PRD-H2. §3 e §18 são redundantes

- §3 linhas 107-170: detalha o fluxo da inception híbrida
- §18.1 linha 675: "Detalhamento está em §3"
- §18.6: "Integrar formalmente em §3" (pendente)
- §18.2-§18.5: repetem §3 em formato diferente

Quem é canônico? Dois lugares oficiais = drift.

#### PRD-H3. `cacheHit` no response — qual cache?

- §7.1 linha 383: `cacheHit: "exact" | "semantic" | "miss"  // futuro v3.1`
- §0 linha 71 + §10.1: falam em "cache hit" referindo ao **cache do provedor** (Anthropic)

PRD mistura **cache interno do middleware** vs **cache do provedor** sem distingui-los. Sem glosa, dev implementa o errado.

#### PRD-H4. Como medir cache hit do provedor se `cacheHit` da response é v3.1?

- §10.2 linha 489: "Cache hit rate do provedor > 70% — métrica via `usage.cache_read_input_tokens`"
- §7.1: `cacheHit` marcado v3.1
- §14.6: medição via **log estruturado** separado

A métrica §10.2 **não vem** do campo `cacheHit` da response. Vem de log separado. Não explicado.

#### PRD-H5. MCP é "futuro" ou "v3.1"?

- §1 linha 87: "MCP (futuro)" — vago
- §3 linha 168: "MCP (v3.1)"
- §11 linha 528: "MCP server completo — v3.1"

§3 e §11 batem; §1 é vago.

### 2.3 MEDIUM — técnico / nomenclatura

#### PRD-M1. Working set "~1GB" não fecha a conta

§8 linha 434: "~1GB de RAM". Soma declarada: 470 + 90 + 10 + 5 = 575MB. Outros 425MB são Node + overhead, não discriminados.

#### PRD-M2. `files` vs `recentFiles`

- §3 linha 116: "files"
- §5 linha 240 (código): `recentFiles: gitStatus().modified`
- §7.1 linha 354 (schema): `recentFiles?: string[]`

Três nomes pra mesma coisa.

#### PRD-M3. `fast agent` / `fast agentuality` / `fast-agent-over-response`

- §0 linha 70, §2 linha 103, §18.2 linhas 679-683: **"fast agentuality"**
- §3 linha 126, §5 linha 70, §18.1 linha 672: **"fast agent"**
- §18.3 linha 690: **"fast-agent-over-response"** (padrão arquitetural)

Três grafias, sem glosa.

#### PRD-M4. "Benchmark independente" do SQLite sem referência

§8 linha 441: "SQLite + FTS5 + sqlite-vec (vs Qdrant/Pinecone — **benchmark independente em v1** mostrou que SQLite vence na escala nossa)"

Sem link, data, autor, ou anexo. Para um PRD que promete justificativa em tudo, omissão.

#### PRD-M5. `pruningDecisions.rejectedByAttentionTier` no response MVP

- §7.1 linha 387: campo existe, marcado v3.1+
- §11 linha 513: "4 attention tiers — v3.1"

No MVP, tiers não existem. Sempre `[]`? Removido condicionalmente? Documento não diz.

### 2.4 LOW — polish

#### PRD-L1. §10.1 linha 482 — "Turn N vai plain" sem cold start

Critério MVP perde qualifier "cold start" que §3 tem. Quem lê só §10.1 entende "todo Turn N" (impossível).

#### PRD-L2. §0 linha 70 — mesmo problema

"Turn N vai plain pro provedor" sem qualificar cold start.

---

## 3. Findings do PLAN.md

### 3.1 CRITICAL — sequência, escopo e cobertura

#### PLAN-C1. Phase 3 (SDK) é floating — ninguém depende dela

Diagrama (linhas 51-59):
```
Phase 1 ──┬──> Phase 2 ──┬──> Phase 3
          │              ├──> Phase 5 ──> Phase 6 ──> Phase 7
          └──> Phase 4 ──┘
```

- Pre-reqs declarados (linha 113): Phase 3 depende de Phase 2.
- **Quem depende de Phase 3? Nenhuma phase da lista.**

Phase 5 (Proxy) recebe HTTP do SDK mas **não consome SDK como build dep** (são cliente e servidor). Phase 3 pode ser pulada/atrasada sem quebrar ninguém.

#### PLAN-C2. Phase 4 (UI) pre-req = Phase 1, mas precisa de Phase 5

- Pre-reqs declarados (linha 139): Phase 4 = Phase 1.
- Telas que precisam do servidor Phase 5:
  - **Audit** (PRD §4 linha 196): alimentado por Phase 5 ("Audit log preenchido" linha 174).
  - **Settings** (PRD §4 linha 197): threshold + modo integração vivem em Phase 5.

Phase 4 pode rodar com mocks, mas PLAN não diz. Quem implementar Phase 4 antes de Phase 5 entrega UI inerte.

#### PLAN-C3. Search/Retrieval/Augmenter não tem phase dedicada

PRD §3 linha 141: "scripts: match (intel + prompt + context + catalog) → qualification".
PRD §8 linha 446: "Threshold duplo no retrieval".
PRD §8 linha 442: "SQLite + FTS5 + sqlite-vec" como invariante.

PLAN: **nenhuma phase fala em retrieval**. Phase 1 fala em "Embedding pipeline". Phase 5 fala em "Forwarder HTTP". Quem implementa FTS5 + sqlite-vec + RRF + threshold? Sub-deliverable implícito, sem escopo.

#### PLAN-C4. Inception híbrida é critério §10.1 MAS Phase 6 gated por grill

- PRD §10.1 linha 482: inception híbrida como checkbox MVP
- PLAN Phase 6 linha 206: "**pré-grill em PRD §18.6 antes de iniciar**"
- PLAN linha 288: "Não começar Phase 6 sem grill"

Critério §10.1 não pode ser marcado se Phase 6 não rodar. Grill reprovar = MVP não fecha §10.1. Sem plano B.

#### PLAN-C5. Hook (PRD §1, §3) não tem phase; §14.3 diz v3.1+

PLAN **ignora silenciosamente** PRD-C1. Não há phase de hook, nem nota "hook deferido pra v3.1+". Decisão implícita sem rastro.

#### PLAN-C6. MCP (PRD §1) não tem phase; §11 diz v3.1+

Mesma situação: PLAN não menciona MCP, não tem phase, não tem nota. Decisão implícita que contradiz PRD.

#### PLAN-C7. Total 30-40h não fecha a soma

PLAN total (linhas 263-274) e PRD §9 (linha 464): "30-40h".

Soma direta:

| Phase | Range |
|---|---|
| 1 — Schema + Catálogo | 3-4h |
| 2 — Detector + fingerprint | 2-3h |
| 3 — SDK | 3-4h |
| 4 — UI | 8-12h |
| 5 — Proxy | 5-7h |
| 6 — Fast agent | 8-12h |
| 7 — Tuning | 5-7h |
| **Soma** | **34-49h** |

49h estoura em 9h. Promete 40h mas a soma não fecha.

### 3.2 HIGH — lacunas e ambiguidades

#### PLAN-H1. Schema SQLite do catálogo não documentado no PRD

Phase 1 deliverable (linha 73): "Loader de YAML → SQLite".

PRD §6: schema **YAML** (formato do arquivo). PRD §7: schema do **API** (request/response do `/augment`). **Não há schema SQLite do catálogo** (tabelas, índices FTS5, vetor sqlite-vec, audit_events) em lugar nenhum. Phase 1 implementa sem spec. Provavelmente reside em `.specs/archive/2026-07-calibration/STATE.md` — mas PLAN não cross-referencia.

#### PLAN-H2. Phase 5 entrega `cacheHit` sem qualificar ambiguidade

Phase 5 deliverable (linha 173): "Response struct com `pruningDecisions` (5 razões) + `cacheHit`".

Mesmo problema do PRD (PRD-H3, PRD-H4). PLAN herda sem marcar nem distinguir. Implementador entende errado.

#### PLAN-H3. Phase 7 "5-7h (1 semana de dados)" é estimativa confusa

Phase 7 deliverable (linha 244-249): "1 semana de sessão real". Estimate (linha 253): "5-7h (1 semana de dados de produção)".

5-7h de trabalho **ou** 1 semana wall-clock esperando? Para "single-dev 30-40h" deveria explicitar: "5-7h de trabalho + 1 semana wall-clock de coleta".

#### PLAN-H4. FTS5 + sqlite-vec não listados como deliverable de Phase 1

Phase 1 (linha 65-87): schema YAML, loader, embedding pipeline, build-index, ~19 skills. **Não menciona schema FTS5, schema sqlite-vec, RRF fusion.** Provavelmente implícitos em "Loader de YAML → SQLite" mas PRD §8 lista como invariante — Phase 1 deveria entregar a infra explicitamente.

#### PLAN-H5. Detector social Phase 2 — sem nota de proveniência

PRD §8 (linha 446): "Detector social via regex" — **invariante sólida de v1**.
Phase 2 (linha 95): "Detector social (regex, ignora prompts tipo 'oi', 'valeu')" — escrito como novo.

Quem leu só PLAN não sabe que detector foi implementado nas phases 0-4 de calibração. Phase 2 deveria marcar "**promover de calibração pra produção** (v1 → v3)".

#### PLAN-H6. Critério de done só na Phase 6

Phase 6 (linhas 229-235): 5 checkboxes. Phase 1-5, 7: **zero checkboxes**. Phase 6 (gated) tem done; phases que vão rodar amanhã não. Phase 5 deveria ter done criteria (smoke test com Claude Code, byte-string determinístico validado, cache hit verificado) para destravar Phase 6 (regra da linha 290).

### 3.3 MEDIUM

#### PLAN-M1. Paralelização Phase 4 || Phase 5 só com 2 devs

Linha 61: "Útil se houver 2 devs. Single-dev: sequencial."

Mas o diagrama (linhas 51-59) não indica condicional. Single-dev tem que fazer 1-2-3-4-5-6-7 sequencial (Phase 4 não pode rodar antes de Phase 5 ter audit/settings, vide PLAN-C2). Sequência single-dev deveria estar declarada explicitamente.

#### PLAN-M2. `schemaVersion: 3` no /augment sem owner de manutenção

PRD §7.1 (linhas 371, 395): `schemaVersion: 3` em request e response.
PLAN: zero mentions. Quem decide bump pra schemaVersion 4? Phase 1 (catálogo) ou Phase 5 (API)?

#### PLAN-M3. Responsabilidade de "prefix intacto" entre Phase 5 e 6 não clara

PRD §10.1 (linha 475): "System message augmenté é byte-string determinístico".
Phase 5 (linha 172): "Byte-string determinístico (mesma input → mesma saída)".
Phase 6 (linha 198): "Suffix injection no system message, **prefix intacto**".

Quem garante que prefixo fica intacto entre turns? Phase 5 garante determinístico do input, mas Phase 6 é que injeta sufixo. Falta entregável explícito "garantir byte-estabilidade do prefixo entre turns" com critério verificável.

### 3.4 LOW

#### PLAN-L1. Estimativa Phase 4 (8-12h) tem range muito largo

8-12h é 50% de variação. UI é a parte mais subestimada de qualquer produto. Provavelmente 10-14h honesto, ou quebrar em sub-phases (UI leitura + UI edição + UI audit dashboard).

---

## 4. Findings cruzados (PRD ↔ PLAN)

### 4.1 CRITICAL

#### X-C1. Escopo MVP diverge: hook + MCP

- **PRD §1 linha 87:** "3 modos de integração com agentes: **proxy transparente (...), hook (fallback), MCP (futuro)**" — hook e MCP no MVP
- **PRD §14.3 linhas 603-604:** "**Hook é fallback (v3.1+ se virar necessário)**"
- **PRD §11 linha 528:** "**MCP server completo — v3.1**"
- **PLAN:** zero phases pra hook, zero phases pra MCP

PRD §1 (sumário) diz MVP, §14 + §11 dizem v3.1+. PLAN entrega só proxy. Sem alinhamento: §1 precisa ser corrigido, ou PLAN precisa incluir phases.

#### X-C2. Inception híbrida: PRD diz MVP, PLAN diz gated

- **PRD §10.1 linha 482:** inception híbrida como checkbox de aceitação MVP
- **PLAN Phase 6 linha 206:** gated por grill em §18.6
- **PLAN linha 288:** "Não começar Phase 6 sem grill em PRD §18.6"

Critério §10.1 não pode ser satisfeito se grill reprovar Phase 6. Sem plano B explícito. Possível: condicionar §10.1 ao grill (separar "MVP core" vs "MVP+inception") — mas isso não está escrito.

#### X-C3. Total estimado PRD §9 vs soma PLAN não fecha

- **PRD §9 linha 464:** "30-40h single-dev"
- **PLAN linha 45 + linha 263-274:** mesmo "30-40h"
- **Soma direta das phases:** 34-49h

Compromisso numérico entre os dois documentos não sobrevive à aritmética simples. Documento que promete "toda decisão com por que X e não Y" não pode falhar nisso.

### 4.2 HIGH

#### X-H1. Schema SQLite do catálogo mora em lugar nenhum

- **PLAN Phase 1 deliverable (linha 73):** "Loader de YAML → SQLite"
- **PRD:** schema YAML (§6) + schema API (§7), **zero schema SQLite**
- **Provável residência:** `.specs/archive/2026-07-calibration/` (resíduo v1)

PRD não documenta; PLAN não cross-referencia. Phase 1 implementa sem spec, e sem rastro de onde está a spec original.

#### X-H2. `cacheHit` ambíguo atravessa PRD e PLAN

- **PRD §7.1 linha 383:** `cacheHit: "exact" | "semantic" | "miss"  // futuro v3.1`
- **PRD §14.6:** métrica de cache hit via `usage.cache_read_input_tokens` (log do provider)
- **PLAN Phase 5 linha 173:** entrega `cacheHit` na response
- **PLAN Phase 7 linha 246-247:** métrica é `cache_read_input_tokens > 0` (log do provider)

Cache interno do middleware (campo `cacheHit`) e cache do provedor (métrica §10.2) estão batendo de frente sem glosa em nenhum dos dois documentos.

---

## 5. Recomendações operacionais

### 5.1 Antes de Phase 1 (bloqueadores)

Resolver ou marcar como "aceito":

1. **X-C1:** fechar escopo MVP de integração — remover hook/MCP de PRD §1, ou adicionar phases ao PLAN.
2. **X-C2:** condicionar PRD §10.1 ao grill §18.6, ou separar "MVP core" vs "MVP+inception".
3. **X-C3:** ajustar "30-40h" pra "30-50h" honesto, ou reduzir Phase 4+6.
4. **PLAN-C1:** decidir se Phase 3 (SDK) entra no MVP ou vira v3.1 (se for cliente, mover pro final do grafo depois de Phase 5).
5. **PLAN-C2:** explicitar Phase 4 com 2 modos (com mocks pré-Phase 5 / com servidor pós-Phase 5) e critério de aceite.
6. **PLAN-C3:** criar phase (ou sub-deliverable explícito de Phase 5) pro retrieval/match/qualifier.
7. **PRD-C2:** fixar porta 7788 ou tornar dinâmica no exemplo SDK.
8. **PRD-C5:** fechar quem é source of truth do `activeCatalog` (request body ou `.memory-studio/state.json` server-side).

### 5.2 Antes de Phase 6 (inception híbrida)

- Fechar §18.6 do PRD (5 itens do pré-grill).
- Fechar §3 vs §18 (PRD-H2): definir qual é canônico.
- Fechar `cacheHit` ambiguity (X-H2).

### 5.3 Cosmético (não bloqueia, mas degrada)

- Resolver numeração §16/§17 (PRD-H1).
- Sincronizar nomenclatura `files`/`recentFiles` (PRD-M2), `fast agent`/`fast agentuality` (PRD-M3).
- Cross-referenciar schema SQLite do catálogo (X-H1).
- Adicionar critério de done em cada phase (PLAN-H6).
- Discriminar overhead de runtime no working set "~1GB" (PRD-M1).
- Anexar referência do "benchmark independente" do SQLite (PRD-M4).

### 5.4 Sugestão de processo

- Tratar PRD como contrato — mudanças precisam de ADR.
- Tratar PLAN como roadmap vivo — pode refinar entre phases.
- Antes de cada phase, revisar PRD + este `critica-plan.md` pra não descobrir findings em código.

---

## 6. Cross-references

- [PRD.md](PRD.md) — alvo da auditoria (v3, 2026-07-26)
- [PLAN.md](PLAN.md) — alvo da auditoria (v1, 2026-07-26)
- [CLAUDE.md](CLAUDE.md) — authority boundaries (decisões em PRD §6 = travadas)
- [handoff-session.md](handoff-session.md) — executivo de sessão 2026-07-26
- [BACKLOG.md](BACKLOG.md) — ideias pós-MVP (este doc NÃO é BACKLOG; é auditoria de docs vigentes)
- [.specs/STATE.md](.specs/STATE.md) — spec state vigente (`2026-07-foundation-complete`)
- [History.md](History.md) — narrativa + north star

---

## 7. Anexo — mapa de findings por localização

### PRD.md

| Linha / seção | Finding | Severidade |
|---|---|---|
| §1 linha 87 | PRD-C1 (hook) | CRITICAL |
| §1 linha 87 | PRD-H5 (MCP vago) | HIGH |
| §3 linha 116 | PRD-M2 (files) | MEDIUM |
| §3 linha 164-170 | PRD-C1 (hook sem versão) | CRITICAL |
| §3 linha 166 | PRD-C4 (4 agentes no proxy) | CRITICAL |
| §3 vs §18 | PRD-H2 (redundância) | HIGH |
| §4 linha 212 | PRD-C2 (porta 7788) | CRITICAL |
| §4 linha 222 | PRD-C5 (activeCatalog) | CRITICAL |
| §5 linha 240 | PRD-M2 (recentFiles) | MEDIUM |
| §5 linha 254 | PRD-C2 (porta 7788) | CRITICAL |
| §7.1 linha 369 | PRD-C5 (activeCatalog) | CRITICAL |
| §7.1 linha 383 | PRD-H3 (cacheHit ambíguo) | HIGH |
| §7.1 linha 387 | PRD-M5 (rejectedByAttentionTier) | MEDIUM |
| §8 linha 434 | PRD-M1 (1GB não fecha) | MEDIUM |
| §8 linha 441 | PRD-M4 (benchmark sem ref) | MEDIUM |
| §10.1 linha 482 | PRD-L1 (cold start perdido) | LOW |
| §11 linha 528 | PRD-H5 (MCP v3.1) | HIGH |
| §14.3 | PRD-C1 (hook v3.1+) | CRITICAL |
| §14.4 linha 608 | PRD-C4 (claude-code only) | CRITICAL |
| §15→§18 | PRD-H1 (gap §16/§17) | HIGH |
| §18.1 linha 667 | PRD-C3 (integração pendente) | CRITICAL |
| §18.2-5 | PRD-H2 (redundância) | HIGH |
| §0 linha 70 | PRD-L2 (Turn N sem cold start) | LOW |
| §0, §2, §18 | PRD-M3 (fast agent) | MEDIUM |

### PLAN.md

| Linha / seção | Finding | Severidade |
|---|---|---|
| Diagrama 51-59 | PLAN-C1 (Phase 3 floating) | CRITICAL |
| Linha 45 + 263-274 | PLAN-C7 / X-C3 (30-40h não fecha) | CRITICAL |
| Linha 61 | PLAN-M1 (paralelização single-dev) | MEDIUM |
| Phase 1 linha 65-87 | PLAN-H4 (FTS5 + sqlite-vec faltando) | HIGH |
| Phase 1 linha 73 | PLAN-H1 (schema SQLite) | HIGH |
| Phase 2 linha 95 | PLAN-H5 (detector proveniência) | HIGH |
| Phase 3 linha 113 | PLAN-C1 (pre-req sem dependentes) | CRITICAL |
| Phase 4 linha 139 | PLAN-C2 (UI pre-req Phase 1) | CRITICAL |
| Phase 4 linha 151 | PLAN-L1 (estimate range largo) | LOW |
| Phase 5 linha 167-179 | PLAN-C3 (retrieval sem dono) | CRITICAL |
| Phase 5 linha 173 | PLAN-H2 (cacheHit ambíguo) | HIGH |
| Phase 5 + 6 | PLAN-M3 (prefix intacto) | MEDIUM |
| Phase 5, 7 | PLAN-H6 (done criteria) | HIGH |
| Phase 6 linha 206 | PLAN-C4 / X-C2 (gated) | CRITICAL |
| Phase 6 linha 229-235 | PLAN-H6 (única com done) | HIGH |
| Phase 7 linha 253 | PLAN-H3 (5-7h vs 1 semana) | HIGH |
| Phase 3 + 5 + 6 | PLAN-M2 (schemaVersion) | MEDIUM |
| PLAN inteiro | PLAN-C5 + C6 (hook + MCP) | CRITICAL |

### Cruzados

| Locais | Finding | Severidade |
|---|---|---|
| PRD §1 vs §14.3 vs §11 vs PLAN inteiro | X-C1 (escopo MVP integração) | CRITICAL |
| PRD §10.1 vs PLAN Phase 6 | X-C2 (inception híbrida gated) | CRITICAL |
| PRD §9 vs PLAN soma | X-C3 (30-40h não fecha) | CRITICAL |
| PRD §6+§7 + PLAN Phase 1 | X-H1 (schema SQLite) | HIGH |
| PRD §7.1 + §14.6 + PLAN Phase 5+7 | X-H2 (cacheHit ambíguo) | HIGH |

---

**Próximo passo (a definir pelo humano):** incorporar findings em PRD/PLAN via edits, ou marcar como "aceito" e seguir. Recomenda-se rodar `auto-grill` (skill instalada, ainda não invocada — ver `feedback-no-random-invocation`) sobre PRD+PLAN se quiser uma passagem autônoma com múltiplas lenses.
