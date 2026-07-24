# Issue tracker: Local Markdown

Issues e specs vivem como arquivos markdown em `.scratch/`. **Solo work** — não há remote compartilhado, então não usamos GitHub Issues / GitLab / Jira.

## Convenções

- **1 feature por diretório**: `.scratch/<feature-slug>/`
- **Spec (PRD)**: `.scratch/<feature-slug>/spec.md`
- **Implementation issues**: 1 arquivo por ticket em `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numerado a partir de `01`. Nunca um único arquivo combinado de tickets.
- **Triage state**: linha `Status:` perto do topo de cada issue (papéis: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — ver `triage-labels.md` quando existir).
- **Comments / histórico**: append no fim do arquivo sob heading `## Comments`.

## Quando uma skill diz "publish to the issue tracker"

Cria novo arquivo sob `.scratch/<feature-slug>/` (criando o diretório se necessário).

## Quando uma skill diz "fetch the relevant ticket"

Lê o arquivo no path referenciado. Usuário normalmente passa o path ou número da issue direto.

## Coexistência com `.specs/` (específico deste repo)

O Memory Studio já tem um sistema próprio `.specs/` dirigido pelo `tlc-roadmap-loop`:

- `.specs/features/<phase-slug>/spec.md` (Planner output)
- `.specs/features/<phase-slug>/design.md` (Planner output, se Large/Complex)
- `.specs/features/<phase-slug>/tasks.md` (Planner output)
- `.specs/features/<phase-slug>/validation.md` (Verifier output)
- `.specs/ROADMAP.md` (phase source of truth)
- `.specs/STATE.md` (decisions append-only + handoff overwrite)
- `.specs/ARCHITECTURE.md` (farol textual)
- `.specs/DISCOVERIES.md` (drift log)

**Não sobrescreve.** `.specs/features/` é o pipeline formal do loop; `.scratch/` é a área informal pra:

- Brainstorm descartável antes de virar phase
- Tickets one-off que não justificam phase nova
- Specs externos sendo triados antes de entrar no ROADMAP
- Notas de debugging / experiment

Se uma issue em `.scratch/` cresce o suficiente pra virar phase, mover pra `.specs/features/<slug>/spec.md` e adicionar entry em `.specs/ROADMAP.md`.

## Wayfinding operations

Usado por `/wayfinder`. O **map** é 1 arquivo com 1 **child** file por ticket.

- **Map**: `.scratch/<effort>/map.md` — Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numerado de `01`, com a pergunta no body. Linha `Type:` registra o tipo (`research`/`prototype`/`grilling`/`task`); linha `Status:` registra `claimed`/`resolved`.
- **Blocking**: linha `Blocked by: NN, NN` perto do topo. Ticket é unblocked quando todo arquivo listado está `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` por arquivos abertos, unblocked e unclaimed; primeiro por número wins.
- **Claim**: set `Status: claimed` e save antes de qualquer trabalho.
- **Resolve**: append a resposta sob heading `## Answer`, set `Status: resolved`, depois append context pointer (gist + link) no map's Decisions-so-far em `map.md`.