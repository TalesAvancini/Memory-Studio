# Auto-Grill Decisions — PRD.md + PLAN.md (composite)

**Date:** 2026-07-28
**Run ID:** 2026-07-28_023050
**Confidence floor:** 0.7
**Rounds run so far:** 8
**Outcome:** human-gate → **all 9 decisions approved 2026-07-28** → skill halted

**Status:** skill stopped. Per SKILL.md §Gate contract, target doc (PRD/PLAN) NEVER modified by skill — human applies edits post-gate. Waiting for downstream handoff (to-spec, manual edits, or stop).

---

| # | Lens | Pergunta | Decisão | Analogia (não-especialista) | Tracer Bullet | Confiança |
|---|------|----------|---------|----------------------------|---------------|-----------|
| 1 | Fog of War | PRD §10.1 marca inception híbrida como CONDICIONAL ao grill §16.6, mas PLAN hardcode Phase 6 (8-12h) e Phase 7 pre-reqs (Phase 5, 6). Qual fallback existe? | **NENHUM.** PLAN não define branch B. Se grill reprovar, PRD §10.1 manda "mover pra v3.2" mas PLAN não codifica. Cache hit §10.2.4 derivável só de Phase 5 (byte-string + cache_control ephemeral + log estruturado) — Phase 6 não é necessário pra essa validação. Estimativa: drop Phase 6 (8-12h) → Total 28-39h. | É como uma casa com planta de 2 andares mas fundação que aguenta só 1. Se o 2º andar reprovar, a planta diz "tira o 2º andar" mas a fundação ainda exige o pilar extra. | → branch B explícito no PLAN (manual edit post-gate) | alta |
| 2 | Fog of War (drift) | Após v3.1 renumber §18→§16, o PLAN.md foi sincronizado? | **NÃO.** 3 referências stale confirmadas: PLAN.md:241 ("§18.6"), PLAN.md:254 ("§18.4"), PLAN.md:375 ("§18.6"). PRD v3.1 frontmatter registra o renumber mas PLAN não acompanhou. | É tipo atualizar o índice de um livro mas esquecer de renumerar os capítulos — leitor segue índice e cai no lugar errado. | → fix manual: substituir §18.x → §16.x em PLAN.md (3 ocorrências) | alta |
| 3 | Contradictions | PLAN.md tem drift interno: Phase 1 body L93 diz 3-4h mas table L302 diz 4-5h. Phase 5 body L214 diz 5-7h mas table L306 diz 6-8h. Qual é canônico pro total 35-50h? | **Tabela é canônica.** Caption explica os +1h (FTS5/sqlite-vec/schema versioning em Phase 1; retrieval runtime + done criteria em Phase 5). Total 36-51h deriva da tabela, então body sections estão stale. **Process gap:** spec não define convenção body-vs-table quando conflitam. | É como uma planilha onde o resumo diz X mas as linhas somam Y — e ninguém documentou qual é fonte de verdade. | → fix: PLAN.md L93 "3-4h" → "4-5h"; L214 "5-7h" → "6-8h". Adicionar nota em CLAUDE.md §Doc roles: PLAN table é canônica pra estimates, body é descritivo. | alta |
| 4 | Vague Decisions | Critical Rules: sempre ativas (imutáveis) ou desativáveis com confirmação? | **Contrato é coerente, NÃO vago.** 3 locais (PRD §6.2, §10.1; PLAN §10) concordam: toggle off SEM confirmação é bloqueado; com confirmação explícita, é permitido. Server enforça (Phase 5) + UI gate (Phase 4). Recomendar "sempre imutáveis" é MAIS restritivo que o spec diz. | É como um botão de pânico — não pode ser apertado sem querer, mas com intenção clara, funciona. | → nenhuma action (contrato já está claro); opcional: explicitar §6.2 com exemplo ("Rule critical:true, usuário digita 'CONFIRMAR' no painel → toggle off aceito") pra eliminar ambiguidade | alta |
| 5 | Semantic Anchors | "intel" aparece 20+ vezes (verificado: 21 = PRD:15 + PLAN:6) como estrutura central mas nunca formalmente definido. É free-text, tags, classificação? | **NENHUMA definição formal.** Única "descrição" é frase livre em PRD §3:134 ('agente tá em X, vai precisar de Y'). Schema ausente de PRD §16, §17.2, CONTEXT.md §5. **Writer-reader contract:** fast agent (§16.2) escreve intel; match pipeline (§3 Turn N+1) lê. Sem schema, Phase 6 vai inventar e quebrar contrato. | É como combinar que o garçom traz "a comida" sem definir se é pizza ou sushi — cliente espera um, garçom traz outro. | → adicionar typed schema em PRD §16: `intel = { agentState: string, nextNeeds: string[], recentTopic: string }` + adicionar termo ao glossary §17.2 + CONTEXT.md §5 antes de Phase 6 começar | alta |
| 6 | Cache Determinism | Spec manda byte-string determinístico do system message mas NÃO manda ordering canônico dos arrays matchedSkills/Rules/Personas. RRF ties podem quebrar byte-differently entre runs? | **SIM — gap real.** Schema §7.1 declara arrays sem 'sorted by' / 'insertion order' / stable-sort annotation. RRF ties com cosine 384d perto do threshold são comuns; sem tiebreak explícito, V8 ordering varia entre processes/versions. Cache key do provider = byte-string (CONTEXT §4), então ordering gap quebra cache silenciosamente. | É como ordenar uma lista de músicas por score mas não definir o que fazer com empates — playlist muda entre execuções. | → adicionar tiebreaker explícito: `Array.sort((a,b) => a.id.localeCompare(b.id))` em top-K (Phase 5). Adicionar done criterion: SHA256 byte-string equality entre identical-input requests que probe ordering stability. | alta |
| 7 | Latency Hot-Path | O `/augment` aguarda a persistência SQLite do audit log antes de encaminhar ao provedor? | **NÃO explicitamente, mas é gap implícito.** Docs não usam 'sync'/'await'/'blocking' para audit. Budget p50<50ms/p99<200ms (PRD §10.2) é incompatível com sync write por request. Audit aparece como done-criterion (PLAN:198,207), não pré-condição. §10.3 (security) não exige tamper-evidence via sync. **Recomendação:** buffer assíncrono + batch flush + fail-open consistente com budget. | É como anotar uma ligação no caderno antes de atender — atrasa o cliente sem benefício. | → declarar explicitamente em PLAN.md Phase 5: 'audit log via async buffer com batch flush (a cada N events ou T ms), fail-open em erro de write (request não bloqueia)'. Adicionar invariant em PRD §8. | média |
| 8 | Edge Cases | WHEN `activeCatalog` is empty, qual é o comportamento exato de `/augment`? Forward unchanged, inject defaults, ou reject? | **GAP — sem contrato definido.** Enum `emptyReason` atual: `low_confidence \| social \| timeout \| null`. Não cobre activeCatalog vazio. Modo prompt-only (PRD §10.1#9) cobre context null, não catalog state. Phase 5 requer top-K retrieval sem zero-match branch. Princípio fail-open (erro → forward unmodified) suporta unchanged forward. | É como chegar no restaurante e o cardápio estar vazio — sem regra do que servir (ou não servir). | → declarar contrato: 200 + system message determinístico unaugmented + matched arrays vazios + `emptyReason: "no_active_items"` (novo enum value) + warning/audit marker + forward unchanged. Cache key estável porque byte-string é determinístico. | média |
| 9 | Tracer Bullets | PRD §7.2 lista 5 endpoints MVP (/catalog, /catalog/rebuild, /audit, /audit/summary, /health) mas nenhuma PLAN phase os owns explicitamente. Onde entregam? | **GAP — ownership implícito.** Phase 1 constrói catalog DATA (schema, FTS5, sqlite-vec, build-index) sem endpoint surface. Phase 5 constrói forwarder HTTP, então todos os 5 endpoints devem sair lá. Acceptance mapping cobre audit mas não menciona /health — que é crítico pra §10.2 (latency gating). | É como anunciar 5 portas num prédio mas esquecer de colocar as portas na planta — quem chega, fica do lado de fora. | → declarar ownership explícito em PLAN.md Phase 5 deliverables: '/catalog, /catalog/rebuild (Phase 5 routes + Phase 1 data), /audit, /audit/summary, /health (Phase 5)'. Adicionar /health ao acceptance mapping §10 mapping. | alta |

---

## Rejected items (restart loop with focus)
*(none yet — all 4 decisions have evidence + high confidence)*

## Research tickets (AFK)
*(none yet)*

---

## Loop summary

- **Rounds run:** 8 (8 lenses: fog-of-war, contradictions, vague-decisions, semantic-anchors, cache-determinism, latency-hot-path, edge-cases, tracer-bullets)
- **Decisions:** 9 accepted, 0 rejected, 0 research tickets
- **Confidence:** 7 high (≥ 0.9), 2 medium (~0.7-0.9) — all pass floor
- **Halt reason:** human-gate (all 8 lenses exhausted)
- **Artifacts:**
  - `PRD-PLAN.auto-grill.transcript.md` (full A2A log)
  - `PRD-PLAN.auto-grill.decisions.md` (this file)
  - `PRD-PLAN.auto-grill.loop-state.json` (resume state)
  - `.specs/DISCOVERIES.md` (9 entries appended: D-001 to D-009)

**Per SKILL.md §Gate contract:** orchestrator does NOT modify PRD/PLAN. All target-doc edits are manual, post-gate. No auto-invoke of `to-spec` / `to-roadmap` / `to-tickets`.

**Severity distribution of discoveries:**
- 1 critical (D-007: audit log boundary)
- 7 structural (D-001, D-002, D-003, D-005, D-006, D-008, D-009)
- 1 cosmetic (D-004)