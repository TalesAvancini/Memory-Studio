---
date: 2026-07-24
version: 1
description: "MEMORY.md como índice + arquivos .md individuais (1 fato por arquivo). Tipos: user / feedback / project / reference."
explanation: "Sistema de memória persistente do agente: índice leve carregado a cada início de sessão, arquivos individuais com frontmatter carregados só quando relevantes. Disciplina de 'quando escrever vs quando ler'."
related:
  - ../README.md
  - ./07-authority-boundaries.md
mermaid_count: 1
---

# 08 — Memory Architecture

## Resumo

Sistema de memória persistente do agente (não confundir com `.specs/STATE.md` que é específico desta skill). `MEMORY.md` é índice leve carregado automaticamente a cada início de sessão. Arquivos individuais `.md` (1 fato por arquivo, com frontmatter) são carregados sob demanda.

## Diagrama

```mermaid
flowchart TB
    session_start([Session start]) --> load_index

    load_index[Load MEMORY.md<br/>1-line per memory<br/>auto-injected into context]

    load_index --> relevant_check{Memory<br/>relevant to<br/>current task?}

    relevant_check -->|NO| skip[skip — index entry<br/>alone is enough]
    relevant_check -->|YES| load_file[Read full<br/>individual .md file]

    load_file --> apply[Apply fact to reasoning]

    apply --> task_in_progress[Task in progress]

    task_in_progress --> signal_check{Signal<br/>detected?}

    signal_check -->|feedback given| write_feedback[Write feedback memory<br/>type: feedback<br/>Why: + How to apply:]
    signal_check -->|decision made| write_project[Write project memory<br/>type: project<br/>Why: + How to apply:]
    signal_check -->|user fact learned| write_user[Write user memory<br/>type: user]
    signal_check -->|external resource| write_reference[Write reference memory<br/>type: reference]
    signal_check -->|no signal| skip2[no write<br/>memory is for facts<br/>not conversation]

    write_feedback --> update_index[Update MEMORY.md<br/>1-line pointer]
    write_project --> update_index
    write_user --> update_index
    write_reference --> update_index

    update_index --> session_continue([Session continues])

    style session_start fill:#e8f4f8,stroke:#1e88e5
    style load_index fill:#fff3e0,stroke:#fb8c00
    style signal_check fill:#fce4ec,stroke:#d81b60
    style update_index fill:#e8f5e9,stroke:#43a047
```

## Os 4 tipos

| Tipo | Quando escrever | Exemplo |
|---|---|---|
| `user` | Quem é o usuário (role, expertise, preferences) | "user prefere PT-BR em replies" |
| `feedback` | Guidance que o usuário deu sobre **como trabalhar** | "skill-readiness-needs-evidence: ready só é ready com evidência fim-a-fim" |
| `project` | Trabalho em andamento, goals, constraints não-deriváveis do código | "Memory Studio v2 — production work ongoing, separate from META-tool" |
| `reference` | Pointer pra recurso externo (URL, ticket, dashboard) | "NotebookLM loop notebook ID: 6f72e66d-..." |

**Regra fundamental**: feedback deve incluir **Why** e **How to apply**. Sem isso, é fato solto.

## Anatomia de um arquivo de memória

```markdown
---
name: short-kebab-case-slug
description: one-line summary — used to decide relevance during recall
metadata:
  type: user | feedback | project | reference
---

<the fact; for feedback/project, follow with **Why:** and **How to apply:** lines.>

[link to related memories with [[name]]]
```

## MEMORY.md (índice)

```markdown
- [Title](file.md) — one-line hook
- [Title](file.md) — one-line hook
```

**Regras**:

- Carregado automaticamente a cada início de sessão.
- 1 linha por memória (descrição curta).
- Sem frontmatter (é só índice).
- Sem conteúdo de memória (link é o suficiente).

## Quando escrever (PT-BR)

### Escrever feedback quando:

- Usuário corrige approach (ex: "nao inicie, peça direção primeiro").
- Usuário confirma preferência (ex: "user prefere PT-BR").
- Usuário dá regra reusable (ex: "skill-readiness-needs-evidence").

### Escrever project quando:

- Decisão de roadmap tomada (ex: "Phase 4 BLOCKED, recovery brief committed").
- Constraint descoberto (ex: "Node 22 ESM quirk em node --test").
- Milestone fechado (ex: "Sinais 2+3+5 verdes 2026-07-23").

### Escrever user quando:

- Role identificado (ex: "user é technical lead com expertise em TypeScript").
- Preferência explícita (ex: "user odeia esquecer metadata").

### Escrever reference quando:

- URL externa que vai ser reusada (ex: "NotebookLM loop notebook ID").
- Ticket / dashboard que vale acompanhar.

### NÃO escrever:

- Conversation transcript (ruído).
- Decisões já no código (derivable).
- Estado de sessão atual (já em STATE.md).

## Quando ler

- **Auto-load**: `MEMORY.md` carregado a cada início de sessão.
- **On-demand**: arquivo individual lido quando description bate com task atual.
- **Cross-link**: dentro de uma memory, link pra outras com `[[name]]` — leitura sob demanda.

## Disciplina crítica

- **Não duplicar**: se repo já registra (CLAUDE.md, git history), não escrever memory.
- **Verificar antes de recomendar**: memory pode estar stale. Sempre verificar antes de agir com base nela.
- **Deletar memory errada**: se fact turn out wrong, deletar o arquivo. Index entry sai junto.
- **Append-only índice**: MEMORY.md cresce ao longo do tempo; nunca remover entries a menos que memory foi deletada.

## Ver também

- [07-authority-boundaries](07-authority-boundaries.md) — MEMORY.md é autoridade humana, não orchestrator.
- [SKILL.md §Project glue](../SKILL.md) — referências que sub-agents leem **on demand**, não restate.