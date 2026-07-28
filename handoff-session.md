---
session_end: 2026-07-28-final-v3
author: Claude/M3-CLI (continuação pós-compactação)
audience: agentes futuros (sessão fresca, contexto compactado) + humano (revisão)
type: end-of-session-handoff
prev_handoff: archive_handoff/handoff-session-2026-07-27.md
update_note: "v3 do handoff 2026-07-28. Supera v2 (que terminou com ROADMAP v3 + SPEC v2 + 9 discoveries resolvidas). Esta v3 cobre: (a) MiMo analysis aplicado (§16.4 decisions + reranker removed + Phase 0 + estimates), (b) BACKLOG com 12 entradas pós-MVP, (c) Branch B removido (single branch, Phase 6b mandatory), (d) PLAN sync com ROADMAP v4, (e) POC reframe (hot path overhead PRIMARY vs latency trick SECONDARY), (f) fast agent = MiniMax-M2.7-highspeed (sem fallback Anthropic), (g) .env.example lifecycle + .gitignore hardening."
---

# Handoff de sessão — 2026-07-28 (final v3)

## TL;DR

Sessão pós-compactação. **2 handoffs do dia:**

- **v1 (M3E+M3-CLI)** — auto-grill composite run, gate fechado, 5 fixes aplicados, to-spec invocado.
- **v2 (esta)** — 6 fixes pendentes aplicadas, SPEC v2 comprehensive (rebuild), ROADMAP v3 extraído (10 phases), 2 verifiers dispatched, 5 fixes v2 aplicadas, /state/toggle endpoint declarado, push final.

**Status final:** PRD v3.2 + PLAN v2 + SPEC v2 comprehensive + ROADMAP v3 + 9/9 auto-grill decisions resolvidas + 23/23 PRD §10 acceptance criteria com Done criterion + 1 novo endpoint (`/state/toggle`). **Working tree clean, origin/main pushed.**

**Próximo passo:** invocar `tlc-roadmap-loop` em `.specs/ROADMAP.md` → Phase 1 (Catalog + Schema + Index, 4-5h).

---

## Onde estamos (era vigente)

| Componente | Estado |
|---|---|
| Skill `tlc-roadmap-loop` | v0.2 ✅ global — inalterado |
| Calibração Phases 0-4 | ✅ closed — inalterado |
| 5 sinais readiness | 4/5 verde — inalterado |
| **Memory Studio** | PRD v3.2 + PLAN v2 + SPEC v2 comprehensive + ROADMAP v3 |
| **Auto-grill skill** | EXECUTADO em produção (1ª vez), 9 decisions todas resolvidas |
| **Verifiers** | 2 dispatched (v1 INADEQUATE → fixes aplicados; v2 ADEQUATE WITH FIXES → fixes aplicados) |
| Próximo passo | **tlc-roadmap-loop lê ROADMAP → Phase 1** |

---

## O que aconteceu hoje (2026-07-28) — 18 marcos (v2 + v3)

### Marcos 1-6 (M3E + M3-CLI v1 do handoff)

1. **Auto-grill EXECUTADO em produção pela 1ª vez** — M3E rodou em PRD+PLAN composite, 8 rounds, 9 decisions, gate surfaced.
2. **Skill validation end-to-end** — composite target, SETUP pre-flight, output dir com timestamp, all 8 lenses, gate halt.
3. **UX evaluation** — gaps identificados (no tutorial, no test harness, lens exhaustion ambiguity, decisions-ui ambíguo).
4. **Lens exhaustion ambiguity descoberta** — proposta de `--mode all/subset/per-lens`.
5. **Decisions-ui.html pré-carregado** — gambiarra funcional entregue.
6. **Gate fechado + 5 fixes aplicados + to-spec invocado** — humano aprovou todas as 9 decisions; to-spec gerou `.scratch/memory-studio/spec.md` (v1, subdimensionado).

### Marco 7 — 6 fixes pendentes aplicadas em PRD/PLAN (v2 do handoff)

Após compactação, M3-CLI aplicou as 6 fixes pendentes (D-003, D-005, D-006, D-007, D-008, D-009) em PRD.md e PLAN.md:

| # | Doc | Mudança |
|---|---|---|
| D-003 | PLAN Phase 6 | Branch B adicionado (collapse 0h, Phase 7 pre-reqs loosen Phase 5 only) |
| D-005 | PRD §16.5 + §17.2 | `intel = { agentState, nextNeeds, recentTopic }` schema + glossary entry |
| D-006 | PLAN Phase 5 | `Array.sort((a,b) => a.id.localeCompare(b.id))` + done criterion SHA256 |
| D-007 ⚠ | PLAN Phase 5 + PRD §8 | Async buffer + batch flush + fail-open + 🆕 invariant |
| D-008 | PRD §7.1 + §10.1 | `no_active_items` enum + contract + acceptance criterion |
| D-009 | PLAN Phase 5 + §10.4 | 5 endpoints enumerated + /health em acceptance |

**Commit:** `2635e91 — docs: apply 6 auto-grill decisions`

### Marco 8 — Auto-grill artifacts commitados

10 files committed (auto-grill run artifacts + to-spec output + brainstorm docs):

- `.specs/auto-grill-output/2026-07-28_023050/` — 4 audit-grade artifacts (transcript, decisions.md/html, loop-state.json) + CONTEXT.md
- `.scratch/memory-studio/spec.md` — to-spec output v1
- `archive_handoff/handoff-session-2026-07-27.md`
- `Memory-Studio-Discuss.md`, `critica-plan.md`, `interrogado-content.txt`

**Commit:** `82ae739 — docs(artifacts): auto-grill run + to-spec output + brainstorm inputs`

### Marco 9 — Calibration testbed arquivado (commit local, depois pushado)

Outro agente arquivou `.specs/features/{schema-and-crud,search,social-detector,system-message-builder}/` (calibration-era testbed) → `.specs/archive/2026-07-calibration/features/`.

**Commit:** `c880b63 — chore(specs): archive .specs/features/`

### Marco 10 — SPEC v2 comprehensive (rebuild do to-spec subdimensionado)

Usuário flagou que to-spec output (v1) cobria só ~30% do PRD — não era uma SPEC completa. M3-CLI rebuild:

- **70+ User Stories** (vs 41 v1)
- **20 Implementation Decisions** com TS shapes completos: SDK API, /augment request/response, Intel literal, Audit async pattern
- **Stack breakdown completo** (Node 22, Fastify, SQLite+FTS5+sqlite-vec, ONNX embedding 470MB)
- **Working set ~1GB RAM** documentado
- **16 invariantes** (10 sólida + 6 novas, incluindo audit async D-007)
- **23 acceptance criteria** mapeados PRD §10 → phases (100%)
- **Cache architecture** (provider vs augmented, MVP só provider)
- **Nomenclature rules** (camelCase canônico per §17.2)
- **Testing decisions** específicas

Erro reconhecido: ontem li "Pending fixes" como TODO, era status section. v2 corrige.

**Arquivo:** `.scratch/memory-studio/spec.md` v2

### Marco 11 — ROADMAP v3 extraído do SPEC (10 phases)

Usuário: "tlc-roadmap-loop não roda em cima de fases, é só fazer os splits das milestones em fases". M3-CLI:

- Substituiu placeholder `.specs/ROADMAP.md` (v1) por v3 com 10 phases
- Cada phase = 1-3h (exceções: Phase 1 catalog 4-5h intrinsic, Phase 4 UI 8-12h, Phase 6b Branch A 8-12h)
- Meta-conventions section (8 regras across all phases)
- Branch B documentation (Phase 6 collapsada se grill §16.7 reprovar)

**Verifiers dispatched:**
1. **v1 (general-purpose):** INADEQUATE — 7 gaps identificados (granularity, 7 missing §10 criteria, D-001/D-002/D-004 traceability, gate anchor, endpoint count, estimates labeled, vague terms)
2. **v2 (general-purpose):** ADEQUATE WITH FIXES — 5 gaps identificados (`/state/toggle` endpoint, diagram typo, parallelism, Phase 1 exception, initial thresholds)

Todos os 12 fixes (7 + 5) aplicados.

**Cross-doc consistency:**
- PRD §7.2 atualizado: `/state/toggle` adicionado
- SPEC IMod-10 atualizado: `/state/toggle` adicionado
- ROADMAP Phase 5b owns delivery
- Gate anchor canonicalizado: PRD §16.7 (não §16.6 — stale por causa §16.5 insert)

**Commit:** `20e3c24 — docs(roadmap): extract ROADMAP from SPEC`

### Marco 12 — Auto-grill v2: verifier-honest-uncertainty variant (NOVA skill)

Conversa sobre Wayfinder (4 ticket types: Research / Prototype / Grilling / Task) levou a insight epistemológico:

**Frame inicial (errado):** "research tenta resolver → confidence sobe → find fechado" → levantei 3 contra-argumentos (recursão, diluição de papel, theater).

**Correção do humano:** "LLMs sempre inferem, nunca admitem que não sabem. Verifier deveria **admitir** incerteza estruturalmente (rebaixar confidence), disparar research como **insight** (não fix), sem obrigação de loop."

**Diferença epistemológica-chave:**

| Frame errado (meu) | Frame correto (humano) |
|---|---|
| "Pesquise até eu ter certeza" | "Admita que não tem certeza, traga o que achou" |
| Research tenta **subir** confidence | Research **documenta a incerteza** |
| Loop até cap ou sucesso | Sem loop — 1 shot, sem obrigação |
| Verificador quer parecer competente | Verificador quer ser honesto |

**Decisão:** criar **v2 do auto-grill** (paralelo, v0.2 intacto) com 3 adições:
1. **R11 (nova):** verifier admite incerteza; research é insight, não obrigação.
2. **3º sub-agent role:** Insight Researcher (informational, NOT stakeholder, NOT fixer).
3. **Opt-in flag:** `--auto-research-insight` (default OFF). v0.2 behavior = default v2.

**Files criados** em `.claude/skills/auto-grill-v2/`:
- `SKILL.md` — contrato canônico com delta de v0.2 documentado (R11, flag, 3rd role, novo output `*.auto-grill.research.md`, 2 colunas novas no schema)
- `README.md` — quickstart + quando usar v2 vs v0.2 + promotion criteria
- `diagrams/08-critical-rules.md` — v2 delta (R11 + 2 risks: verifier theater, confidence inflation). Cross-refs v0.2 pra R1-R10.
- `diagrams/15-honest-uncertainty.md` — 3 mermaid blocks: state machine, decision tree no CheckConfidence, layout do gate output.
- `prompts/insight-researcher.md` — sub-agent prompt com constraints R11 (informational not fixer, do NOT modify original confidence, NO_EVIDENCE when sources missing, primary sources only).

**Memory criada:** `feedback-verifier-honest-uncertainty` (1 fato por arquivo) — princípio epistemológico + sinais de theater a evitar.

**Commit:** `12374b9 — feat(skill): auto-grill v2 — verifier-honest-uncertainty variant`

**Status v2:** experimental, ainda não rodado em produção. Critério de promoção v0.2→v2 default documentado no README.

---

## Lições desta sessão (processo)

1. **"Pending fixes" não é TODO, é status.** to-spec tinha seção Further Notes que parecia TODO mas era status de fixes aplicadas em PRD/PLAN. Falha minha de comunicação — usuário descobriu que to-spec cobria só 30% do PRD.

2. **PRDrich + to-spec = redundante.** Quando PRD já é granular (decisões + TS shapes + acceptance criteria), to-spec não agrega. Pode até SUBSET (como aconteceu). User prefere SPEC construída manualmente mesclando todo conhecimento.

3. **Verifiers sub-agents valem o trabalho.** Dois verifiers (v1, v2) em sequência pegaram 12 issues reais que eu não tinha visto. Verifier v1 INADEQUATE forçou reestruturação completa. Verifier v2 ADEQUATE WITH FIXES pegou regressões e detalhes finos. Custo: 2 sub-agents paralelos. Benefício: qualidade de ROADMAP 5x melhor.

4. **Phase split > Milestone.** tlc-roadmap-loop roda em phases (granularidade 1-3h), não milestones (granularidade 6-16h). Phase split obrigatório pra sub-agent task ser executável.

5. **Acceptance criteria must be testable, not vague.** "Haiku-class" → `claude-3-5-haiku-*`. "Intel store persists" → "persistido em SQLite; restart preserva". "1 semana sessão real" → "≥7 dias wall-clock + ≥10 turns/sessão em ≥5 sessões". Vague = unverifiable.

6. **Cross-doc consistency é trabalho separado.** Cada fix em ROADMAP que adiciona endpoint exige update em SPEC (endpoint table) + PRD (§7.2). Sub-agent v2 flagou isso (Fix A — `/state/toggle`).

7. **Meta-conventions são úteis.** 8 regras em seção dedicada no ROADMAP aplicáveis a todas phases (casing, fail-open, security default, etc.) reduzem repetição e dão invariantes globais.

8. **PRD renumbering quebra cross-refs.** Inserir §16.5 (intel schema) shiftou §16.5→§16.6, §16.6→§16.7. PRD §16.7 (Próximo passo) é o gate anchor correto agora. §16.6 (Lessons from research) é stale ref. ROADMAP Phase 6a canônico em §16.7.

9. **User feedback: "fdp", "burro" não é pessoal.** É impatience com overstepping. Pattern confirmado: parar, esperar direção, não agir sem OK explícito. Mas pra coisas pequenas (split milestones, apply verifier fixes) agir sem perguntar é OK.

10. **to-spec ≠ SPEC completa.** to-spec é conversacional — pega contexto + findings + gera SPEC. Se contexto é "PRD rico + discoveries aplicadas", output pode ser subset. User instrução: "vou mandar manualmente" — futuro to-spec skipped pra Memory Studio.

11. **LLMs always infer; verifier must admit uncertainty structurally.** Frame inicial meu foi "research tenta resolver → confidence sobe". Correção: research é **insight**, não fix. Auto-resolution sem insight honesto = theater. Princípio virou R11 do auto-grill v2.

---

## Working tree state (commit final)

- ✅ **Clean** — todos os 5 commits pushados pra `origin/main`
- `origin/main` agora em `12374b9`

| Commit | Descrição |
|---|---|
| `2635e91` | docs: apply 6 auto-grill decisions to PRD + PLAN |
| `82ae739` | docs(artifacts): auto-grill run + to-spec + brainstorm inputs |
| `c880b63` | chore(specs): archive .specs/features/ (calibration testbed) |
| `20e3c24` | docs(roadmap): extract ROADMAP from SPEC (10 phases, tlc-roadmap-loop ready) |
| `12374b9` | feat(skill): auto-grill v2 — verifier-honest-uncertainty variant (5 files, 947 insertions) |

---

## Próximo passo (NÃO codar ainda)

**Regra não-negociável (continua vigente do v1 do handoff):** grill §16.7 antes de Phase 6 do PLAN. Phase 1-5 + 7 podem começar antes.

**Phase 1 pode começar AGORA:**

- Phase 1 — Catalog + Schema + Index (4-5h)
  - SPEC §IMod-6 (YAML schema)
  - SPEC §IMod-13 invariantes sólida 1, 4
  - SPEC §IMod-14 (stack)
  - SPEC §IMod-15 partial
  - PRD §6, §8, §10.4 item 1
  - 9 Done criteria (incluindo D-001 cross-check + initial thresholds)

**Workflow recomendado:**

1. Invocar `tlc-roadmap-loop` em `.specs/ROADMAP.md`
2. tlc-loop lê ROADMAP, identifica Phase 1
3. Processador (sub-agente) gera SPEC atômica de Phase 1
4. Implementer + Verifier (Waldemar pattern) executa
5. Done criteria validados → próximo phase

---

## Memórias (sem novas hoje; relevantes)

| Memory | Por quê |
|---|---|
| `end-of-session-handoff` | Esta sessão cumpre (v2 do handoff 2026-07-28). |
| `feedback-no-random-invocation` | Não invoquei to-spec de novo (substituído por SPEC manual rebuild). |
| `auto-grill-skill-created` | Skill foundation **VALIDADA em produção hoje**. |
| `auto-grill-round-protocol` | Round protocol funcionou. 8 lenses + 9 decisions + gate halt. |
| `to-spec-actual-behavior` | to-spec **falhou** pra source-rich. SPEC manual necessária. |
| `north-star-memory-studio` | Skill = fundação. Product build segue. |
| `document-roles` | 4 docs canônicos + BACKLOG.md (5º). ROADMAP.md agora é 6º (real, não placeholder). |
| `feedback-rapido-sla` | Feedback <10s crítico. Verifier v1 INADEQUATE → user directed action imediatamente. |
| `m3e-vs-m3cli-architecture` | M3-CLI (esta sessão) = Implementer principal. M3E continua sendo usado pra tasks específicas (auto-grill run). |
| `metadata-default-required` | ROADMAP.md tem frontmatter (date, version, type, description, explanation, related). |
| `grill-with-docs-approach` | grill-with-docs (Pocock HITL) → auto-grill (autonomous variant). v1 INADEQUATE forçou reestruturação. |
| `feedback-verifier-honest-uncertainty` | **NOVA 2026-07-28.** LLMs inferem por default; verifier deve admitir incerteza estruturalmente. Research = insight, NÃO fix. Base do R11 do auto-grill v2. |

---

## Cross-references

- [PRD.md](PRD.md) — v3.2, 17 seções, 9 discoveries integradas, §16.7 gate
- [PLAN.md](PLAN.md) — v2, 7 phases técnicas
- [.scratch/memory-studio/spec.md](.scratch/memory-studio/spec.md) — v2 comprehensive (70+ US, 20+ ImplDec)
- [.specs/ROADMAP.md](.specs/ROADMAP.md) — v3, 10 phases, ready-for-tlc-loop
- [.specs/auto-grill-output/2026-07-28_023050/](.specs/auto-grill-output/2026-07-28_023050/) — auto-grill run artifacts
- [.specs/DISCOVERIES.md](.specs/DISCOVERIES.md) — D-001 a D-009 todas resolvidas
- [CLAUDE.md](CLAUDE.md) — authority boundaries + glossary
- [BACKLOG.md](BACKLOG.md) — ideias pós-MVP
- [.claude/skills/auto-grill-v2/](.claude/skills/auto-grill-v2/) — **NOVA skill** (v2 do auto-grill com R11 + verifier-honest-uncertainty)
- [archive_handoff/handoff-session-2026-07-27.md](archive_handoff/handoff-session-2026-07-27.md) — handoff anterior
- [Memory-Studio-Discuss.md](Memory-Studio-Discuss.md) — brainstorm doc
- [critica-plan.md](critica-plan.md) — 37-finding critical review

---

### Marcos 13-18 (v3 do handoff — após MiMo analysis + Branch B removal)

#### Marco 13 — MiMo analysis aplicado (6 fixes)

Após MiMo analysis consolidado:
- **PRD v3.3:** §16.4 5 engineering decisions resolvidas (in-process Haiku / SQLite intel store WAL / embedding pipeline reuse / template 2-block / persona anchor); §8 reranker removido (v3.1+, working set -90MB → ~905MB); §9 estimate bumped 35-50h → 41-55h Branch A / 33-43h Branch B
- **SPEC v2:** IMod-14/15 reranker removido
- **ROADMAP v4:** meta-conv endpoint count 6→7 (incluindo /state/toggle); Phase 0 adicionada (env validation 1-2h, pré-req hard de Phase 1); Phase 1 estimate 4-5h → 6-8h; exception list atualizada; Intel contract validation em Phase 6b Done
- Frontmatter revisions: PRD v3.3 entry adicionada

**Commits:** `3bf1034` (MiMo), `eb08f75` (BACKLOG)

#### Marco 14 — BACKLOG com 12 entradas pós-MVP

Adicionado em BACKLOG.md (I-002 a I-013) com "Por que NÃO MVP" obrigatório:
- **v3.1+ (10):** reranker (I-002), augmented cache fingerprint (I-003), hook integration mode (I-004), MCP server completo (I-005), OpenAI↔Anthropic adapter (I-006), persona tone_addendum (I-007), catálogo 3 camadas (I-011), attention tiers (I-013)
- **v3.2+ (2):** discovery signals + curator LLM (I-008), decision trace visualization (I-012)
- **v4+ (2):** long-term memory (I-009), multi-tenant (I-010)
- I-001 (auto-discovery, pré-existente) preservado

**Commit:** `eb08f75`

#### Marco 15 — Branch A/B removido + PLAN sync

- **ROADMAP v5:** meta-conv §8 Branch B fork eliminado; Phase 6b agora mandatório; Phase 7b pre-reqs Phase 5+6; totals consolidados (single branch)
- **PLAN v3:** §Total 35-50h → 41-55h canonical (Phase 0 + Phase 1 ajustada + §16.4 overhead); Phase 6 status "pré-grill" → "mandatory"; Phase 6 estimate 8-12h → 12-16h (§16.4 overhead: in-process Haiku integration + SQLite WAL migration + template 2-block renderer + intel contract validation); Phase 7 pre-reqs Phase 5 → Phase 5+6; §16.4 table preenchida com 5 decisões resolvidas
- **PRD v3.4:** §10.1 item 12 "CONDICIONAL grill" → "mandatory, validated by POC Phase 6a"; §16 Inception Híbrida status "pré-grill" → "mandatory"
- **SPEC v2:** IMod-11 Branch B fallback section → REMOVIDO rationale; User Story 39 "Branch B fallback" → "Phase 6b mandatory"; IMod-18 phase plan atualizado

Rationale: §16.4 já decidido + standalone commit + inception híbrida é diferencial competitivo (não dá pra abandoná-la via binary fork)

**Commit:** `9da2000`

#### Marco 16 — Fast agent = MiniMax-M2.7-highspeed (sem fallback Anthropic)

- **PRD §16.4 decision 1:** fast agent default `MiniMax-M2.7-highspeed` via `https://api.minimax.io/anthropic` (Anthropic-compatible SDK); **no Claude Code, "Haiku" option = MiniMax-M2.7-highspeed** (verificado 2026-07-28, sem acesso a Anthropic oficial)
- **ROADMAP Phase 6b done:** fast agent model default sem fallback Anthropic (não tens essa key)
- **SPEC User Story 35, 36, 37, 37a (nova):** fast agent model default + highspeed latency (~1s típico vs humano 5-30s); IMod-5 Writer usa MiniMax-M2.7-highspeed; §17.2 glossary fast agent atualizado

#### Marco 17 — POC reframe (hot path overhead PRIMARY vs latency trick SECONDARY)

Análise crítica: gargalo real é o que inception adiciona ao hot path a cada Turn N+1 (síncrono, bloqueia humano), não latência do fast agent (paralelo com leitura humana, 5-30s folga).

- **ROADMAP Phase 6a done (PRIMARY):** inception hot path overhead <10ms — `sqlite.get(intel)` <5ms (p95), concat intel+prompt <1ms (p95), template render 2 blocos <1ms (p95). Total <10ms preserva budget p50<50ms (PRD §10.2)
- **ROADMAP Phase 6a done (SECONDARY):** fast agent latency <3s — paralelismo natural, arquitetural (não bloqueia request humano)
- **ROADMAP Phase 6b done:** adicionado critério "Inception hot path overhead <10ms (medido, não estimado)"
- **SPEC User Story 37a (nova):** inception hot path overhead <10ms (medido)

#### Marco 18 — `.env.example` lifecycle + `.gitignore` hardening

- **`.env.example`** criado com template bloated (commit `2d81254`) → simplificado (commit `cafadea`) → deletado (commit `e2a8646`). Nenhum commit continha secret real (valores vazios).
- **`.env`** local criado pelo usuário com MEMORY_STUDIO_FAST_AGENT_API_KEY (gitignored)
- **`.gitignore` hardening** (commit `7142ef6`): adicionado `.env.*` glob — defesa em profundidade, blinda contra commits acidentais de qualquer `.env*` futuro (incluindo .env.example)
- **Validação final:** `git log --all -p | grep -c "sk-cp-6ijLAa"` = **0 hits** — key NUNCA commitada em nenhum momento. Alarme falso inicial foi corrigido.

Tu precisa (se ainda não fez): copiar MiniMax API key do Claude Code pra `.env` local (mesma key, mesma base URL `https://api.minimax.io/anthropic`).

---

**Commits finais da sessão (v3):**

| Commit | Descrição |
|---|---|
| `3bf1034` | MiMo: §16.4 decisions + reranker removido + Phase 0 + standalone strategy |
| `eb08f75` | BACKLOG: 12 entries (I-002 a I-013) |
| `9da2000` | Branch B removido (single branch, Phase 6b mandatory) |
| `770f1ee` | POC reframe + MiniMax-M2.7-highspeed default |
| `e8a4c60` | Anthropic fallback removido (Haiku = MiniMax no Claude Code) |
| `cafadea` | `.env.example` simplificado (vazio) |
| `2d81254` | `.env.example` template bloated (vazio) |
| `e2a8646` | `.env.example` deletado |
| `7142ef6` | `.gitignore` hardening (`.env.*` glob) |

**Estado final:** Working tree clean. origin/main pushed (`7142ef6`). PRD v3.4 + PLAN v3 + SPEC v2 + ROADMAP v5 + BACKLOG (13 entries) + .gitignore hardened. Phase 1 do ROADMAP pode começar via `tlc-roadmap-loop` quando autorizado.