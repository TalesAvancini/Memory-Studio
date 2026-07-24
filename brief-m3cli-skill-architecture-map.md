---
date: 2026-07-24
author: M3E (M3-Executor, intellectual leader)
m3_cli_session_audit_by: M3E
version: 1
target_skill: tlc-roadmap-loop
target_skill_version: v0.2 (current in global + local parity)
scope: documentation — README + 9 Mermaid diagrams co-located with skill
language: PT-BR (matches working language; SKILL.md remains EN as-is)
related_artifacts:
  - ~/.claude/skills/tlc-roadmap-loop/SKILL.md (skill v0.2 — NÃO TOCAR)
  - .claude/skills/tlc-roadmap-loop/SKILL.md (local mirror — NÃO TOCAR)
  - .specs/ARCHITECTURE.md (farol textual — referência cruzada, NÃO TOCAR)
  - memory/metadata-default-required.md (M3E directive: frontmatter em tudo)
  - memory/m3e-vs-m3cli-architecture.md (M3E/M3-CLI é casual deste projeto, NÃO incluir na doc geral)
  - .claude/skills/tlc-roadmap-loop/v0.2-SKILL-changelog.md (se existir, ler pra contexto)
preceded_by: brief-m3cli-phase4-recovery.md
signals-alvo: nenhum (este brief NÃO é pra fechar sinal de skill-readiness; é documentação)
---

# Brief — Skill Architecture Map (`tlc-roadmap-loop` v0.2)

## Goal único

Documentar a arquitetura completa da skill `tlc-roadmap-loop` v0.2 em formato **README + 9 diagramas Mermaid modulares**, co-localizado com a skill. Isso externaliza o conhecimento hoje espalhado (SKILL.md, ARCHITECTURE.md, handoffs, conversas) em artefatos de primeira classe que agentes futuros e humanos conseguem consumir sem reconstruir do zero.

## Workflow (sequência exata)

### Passo 1 — Trabalhar GLOBAL primeiro

Caminho base: `~/.claude/skills/tlc-roadmap-loop/` (no Windows: `C:\Users\User\.claude\skills\tlc-roadmap-loop\`)

Criar:
- `README.md` (entrada principal)
- `diagrams/` (diretório novo)
- `diagrams/01-triple-camada.md`
- `diagrams/02-loop-flow.md`
- `diagrams/03-skill-composition.md`
- `diagrams/04-subagent-contracts.md`
- `diagrams/05-verdict-handling.md`
- `diagrams/06-discovery-surface.md`
- `diagrams/07-authority-boundaries.md`
- `diagrams/08-memory-architecture.md`
- `diagrams/09-stop-conditions.md`

**Total: 1 README + 9 diagram files = 10 arquivos novos**.

### Passo 2 — Mirror LOCAL depois

Após o global estar completo e validado, copiar TUDO para o local:
- `c:\Users\User\Desktop\AI-Project\Memory-Studio\.claude/skills/tlc-roadmap-loop\README.md`
- `c:\Users\User\Desktop\AI-Project\Memory-Studio\.claude/skills/tlc-roadmap-loop\diagrams\*.md`

Verificar com `diff -r` (ou `git diff --no-index`) que **global == local** byte-a-byte. Exit 0 obrigatório.

### Passo 3 — Atomic commit + report

- 1 commit só (tudo junto — `docs(skill): add README + 9 Mermaid diagrams to tlc-roadmap-loop v0.2`)
- NÃO fazer push (M3E audita e push depois)

## ⚠️ REGRA CRÍTICA — Metadata em TUDO (M3E directive 2026-07-24)

**TODO arquivo `.md` que você criar DEVE ter frontmatter YAML no topo**, contendo no mínimo:

```yaml
---
date: 2026-07-24         # YYYY-MM-DD da criação
version: 1               # semver local (1, 2, 3...) ou vN
description: <1 linha>   # o que é este arquivo
explanation: <1-2 parágrafos>  # por que existe, contexto, decisão
---
```

**Não confiar em "ah, é óbvio".** Sempre escrever frontmatter. User ODEIA esquecer metadata — é padrão, não opcional.

Para diagramas, adicionar também:
```yaml
related:
  - ../README.md
  - ./02-loop-flow.md  # cross-refs
mermaid_count: 2       # quantos blocos ```mermaid tem
```

## Os 9 diagramas — escopo detalhado

| # | Arquivo | Tipo Mermaid | Foco | Conteúdo esperado |
|---|---|---|---|---|
| **1** | `01-triple-camada.md` | `flowchart TB` | Visão geral | Camada A (archify farol) ↔ Camada B (orchestrator: tlc-roadmap-loop) ↔ Camada C (sub-agents: Planner/Implementer/Verifier). Setas: quem lê de quem, quem escreve em quem. |
| **2** | `02-loop-flow.md` | `stateDiagram-v2` | Ciclo principal | Estados: `load_state` → `pick_phase` → `dispatch_planner` → `dispatch_implementer` → `dispatch_verifier` → `verdict` (PASS/FAIL) → loop ou stop. |
| **3** | `03-skill-composition.md` | `flowchart LR` | Composição | `tlc-spec-driven` (base: Specify→Design→Tasks→Execute→Verify) é reusado. `tlc-roadmap-loop` (orchestrator) adiciona: phase picker, ROADMAP, loop, verdict gate. Mostrar o que cada um faz vs delega. |
| **4** | `04-subagent-contracts.md` | `sequenceDiagram` | Contratos | Orchestrator → Planner (in: ROADMAP excerpt + farol ref; out: spec/design/tasks). → Implementer (in: tasks; out: commits). → Verifier (in: commits + spec; out: validation.md + verdict). |
| **5** | `05-verdict-handling.md` | `stateDiagram-v2` | v0.2 com step 8a | PASS (flip [x], commit, loop). FAIL → **step 8a failure diagnostics** (compare FAIL atual vs anterior, same-fixture-fail-2x trigger) → 3 strategy alternatives (refine test / escalate / skip signal) → strategy shift reseta iter. 3x cap → escalate. SUBCHAPTER_BREAKDOWN. |
| **6** | `06-discovery-surface.md` | `flowchart` | step 8b | Verifier/Implementer detectam drift → append DISCOVERIES.md (severity: cosmetic/structural/critical) → orchestrator surface to user → re-render farol decision (Y/N) → archify regenera architecture.html. |
| **7** | `07-authority-boundaries.md` | `flowchart` + tabela | Quem decide o quê | **Humano**: PRD, decisions travadas, farol re-render. **Orchestrator**: brief, dispatch, audit, STATE updates, decisions append. **Sub-agents**: scoped work (Planner: spec/design/tasks; Implementer: code+commits; Verifier: validation+verdict). **CRÍTICO: NÃO mencionar M3E/M3-CLI** — esse split é casual deste projeto de calibração, não da skill geral. |
| **8** | `08-memory-architecture.md` | `flowchart` | MEMORY.md | Index MEMORY.md (carregado todo início de sessão) → individual `.md` files (1 fato por arquivo). Tipos: user, feedback, project, reference. Quando escrever (feedback dado, decisão tomada, project milestone) vs quando ler (início de sessão). |
| **9** | `09-stop-conditions.md` | `flowchart` | Escape hatches | 3× FAIL consecutivo, hard blocker (missing tool/ambiguous AC), user interrupt (Ctrl-C/explicit "stop loop"), SUBCHAPTER_BREAKDOWN (Planner/Implementer detecta phase grande demais), step 8a failure diagnostics (strategy shift). Cada um → ação concreta. |

## Estrutura do README

```markdown
---
date: 2026-07-24
version: 1
description: "README principal da skill tlc-roadmap-loop v0.2 — entrada para novos agentes e humanos."
explanation: "Documentação arquitetural canônica. Substitui a necessidade de ler histórico de conversa para entender a stack. README indexa os 9 diagramas modulares em diagrams/."
---

# tlc-roadmap-loop v0.2 — Architecture Map

## TL;DR
[1 parágrafo: skill é orchestrator que compõe tlc-spec-driven + archify + 3 sub-agents (Planner/Implementer/Verifier) por phase. Lê ROADMAP.md, dispatcha sub-agents em sequência, gateia no Verdict, loopa até phases `[x]` ou escalation.]

## Quando usar
[Triggers: "advance the roadmap", "run the next phase", "loop the roadmap", "/loop roadmap", "build the next feature", "implement next feature"]

## Quando NÃO usar
- Feature única (use tlc-spec-driven direto)
- Decomposição cross-stack (use archify sozinho)
- Code review (use code-review skill)
- Multi-agent fan-out (phases são sequenciais por design)

## Arquitetura (índice dos 9 diagramas)
[Lista numerada com link pra cada diagrams/*.md]

## v0.2 delta (mudou de v0.1)
- **Step 8a — failure diagnostics pre-flight**: antes de re-dispatch em FAIL, compara Verifier FAIL atual vs anterior. Se mesma fixture falhou 2× sem mudança de comportamento, surface 3 strategy alternatives (refine test design / escalate / skip signal) ao orchestrator ao invés de retry cego. Iter count reseta após strategy shift.

## Companion skills
- `tlc-spec-driven` — base SDD (Specify → Design → Tasks → Execute → Verify)
- `archify` — renderer do farol arquitetural (Camada A)
- `notebooklm` — opcional, pra seed lessons de research externo

## Arquivos relacionados
- `SKILL.md` — definição da skill em si (v0.2, 17.675 bytes)
- `../specs/ARCHITECTURE.md` — farol textual (LLM-facing)
- `../specs/architecture.architecture.json` — farol estruturado (fonte)
- `../specs/architecture.html` — farol renderizado (humano-facing)
- `../specs/DISCOVERIES.md` — log append-only de drift arquitetural

## Contribuindo
[Onde adicionar diagramas novos, versionar atomicamente, e linkar pelo README]

## Lições aplicadas (referências)
[Link pros memory entries mais relevantes — ex: skill-readiness-needs-evidence, sub-agent-runaway-observation, loop-v2-failure-diagnostics]
```

## Constraints (HARD)

### C1 — NÃO modificar SKILL.md
O skill v0.2 (17.675 bytes) está funcional. README + diagrams são **documentação ao lado**, não substituição. Não toque `SKILL.md` em nenhuma das duas localizações (global OU local).

### C2 — Frontmatter em TUDO
Todos os 10 arquivos novos (README + 9 diagrams) DEVEM ter frontmatter YAML válido. Sem exceção. Verificar via grep antes do commit.

### C3 — Mermaid syntax válido
Cada bloco ```mermaid``` DEVE renderizar sem erro. Testar com `npx -y @mermaid-js/mermaid-cli@latest -i diagram.md -o test.svg` se disponível, OU validar via https://mermaid.live.

### C4 — Mirror global == local byte-a-byte
Após copiar global → local, `diff -r` deve retornar exit 0. Sem diferenças. M3E audita isso antes do push.

### C5 — PT-BR (não EN)
Texto dos arquivos em PT-BR (matches working language). SKILL.md permanece EN (não tocar). Blocos ```mermaid``` ficam em inglês nos IDs/nodes (Mermaid parser chato com PT-BR em labels).

### C6 — NÃO mencionar M3E/M3-CLI
A divisão M3E/M3-CLI foi workaround deste projeto de calibração. **NÃO incluir** na documentação da skill geral. Diagram #7 (authority boundaries) usa: humano / orchestrator / sub-agents.

### C7 — Cross-references explícitas
README indexa todos os 9 diagrams. Diagrams se referenciam entre si onde relevante (ex: #2 cita #5, #5 cita #6, #7 cita #8).

## Scope-guard (HARD)

✅ Toca APENAS:

- `~/.claude/skills/tlc-roadmap-loop/README.md` (criar)
- `~/.claude/skills/tlc-roadmap-loop/diagrams/` (criar diretório + 9 arquivos)
- `c:\Users\User\Desktop\AI-Project\Memory-Studio\.claude/skills/tlc-roadmap-loop\README.md` (mirror, copy)
- `c:\Users\User\Desktop\AI-Project\Memory-Studio\.claude/skills/tlc-roadmap-loop\diagrams\*.md` (mirror, copy)
- `package.json` (se Mermaid CLI for declarado como devDep pra validação — justifique em comentário no commit)
- Working tree git (commit único, sem push)

❌ NÃO TOCA:

- `~/.claude/skills/tlc-roadmap-loop/SKILL.md` (skill em si — intocada)
- `.claude/skills/tlc-roadmap-loop/SKILL.md` (local mirror — intocada)
- Qualquer `src/`, `test/`, `scripts/` (código de produto)
- `.specs/architecture.html`, `.specs/ARCHITECTURE.md`, `.specs/architecture.architecture.json` (farol — intocado)
- `.specs/STATE.md`, `.specs/ROADMAP.md`, `.specs/DISCOVERIES.md` (specs do produto)
- Qualquer arquivo fora do escopo ✅
- MEMORY.md ou memories individuais (M3E gerencia)
- Push remoto (M3E push depois de auditar)

## Output expectations

### Arquivos criados (10)

| Path | Tipo | Frontmatter | Mermaid blocks |
|---|---|---|---|
| `~/.claude/skills/tlc-roadmap-loop/README.md` | índice | sim | 0 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/01-triple-camada.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/02-loop-flow.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/03-skill-composition.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/04-subagent-contracts.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/05-verdict-handling.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/06-discovery-surface.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/07-authority-boundaries.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/08-memory-architecture.md` | diagrama | sim | ≥1 |
| `~/.claude/skills/tlc-roadmap-loop/diagrams/09-stop-conditions.md` | diagrama | sim | ≥1 |

Plus 9 mirrors locais (cópia byte-a-byte).

### Validações

- `diff -r ~/.claude/skills/tlc-roadmap-loop/{README.md,diagrams/} c:\Users\User\Desktop\AI-Project\Memory-Studio\.claude/skills/tlc-roadmap-loop\{README.md,diagrams/` → exit 0
- `grep -L "^---$" **/*.md` em cada conjunto → vazio (todos têm frontmatter)
- (Opcional) `npx -y @mermaid-js/mermaid-cli@latest -i diagrams/01-triple-camada.md -o /tmp/test.svg` para validar sintaxe — mas isso é best-effort, não bloqueia

## Reporte final (formato)

1. ✅ Lista dos 10 arquivos criados (path global + path local mirror) com tamanhos
2. ✅ `diff -r` exit code (0 = byte-idênticos, 1 = diff existe)
3. ✅ Validação frontmatter: `grep -L "^---$"` retornou vazio? (sim/não)
4. ✅ Se Mermaid CLI disponível: resultado da validação de sintaxe
5. ✅ Resumo de 1 linha por diagrama (o que mostra)
6. ✅ Confirmação: SKILL.md intocado em ambas localizações (`git diff` em ambos paths = vazio)
7. ✅ Conventional commit: `docs(skill): add README + 9 Mermaid diagrams to tlc-roadmap-loop v0.2`
8. ❌ NÃO fazer push — M3E audita e push

## Stop conditions

| Condição | Ação |
|---|---|
| Mermaid sintaxe inválida em qualquer arquivo | Corrigir antes de reportar. Não usar fallback de imagem. |
| `diff -r` exit ≠ 0 (mirror não bate) | Recopiar e re-validar |
| SKILL.md foi tocado (acidente) | Reverter, reportar violação |
| Arquivo sem frontmatter | Adicionar frontmatter antes de finalizar |
| Mirror local == global mas global foi modificado depois | Re-mirror, re-validar |
| Tempo > 90 min sem clear progress | Reportar com hypothesis, parar |

**Tempo alvo:** 60-90 min total (10 arquivos × ~6 min cada, considerando escrever Mermaid + texto).

## Gate M3E (auditoria)

Critérios pra validar antes do push:

1. 10 arquivos criados global + 9 mirrors locais (= 19 paths novos totais)
2. `diff -r` exit 0 (parity global/local)
3. Todos têm frontmatter válido
4. SKILL.md intocado (`git status` no local mostra zero modificações em SKILL.md)
5. Commit único atômico, conventional (`docs(skill): ...`)
6. Mermaid sintaxe válida (best-effort validar com mermaid-cli OU visual review)
7. PT-BR no texto, EN nos labels Mermaid
8. Zero side-effects em arquivos fora do scope ✅

---

**M3-CLI: lê brief do filesystem, executa, reporta. M3E audita e push.**

**Working directory:** `c:\Users\User\Desktop\AI-Project\Memory-Studio` (e paralelo global `C:\Users\User\.claude\skills\tlc-roadmap-loop\`)

**Não fazer push.** Aguardar M3E.
