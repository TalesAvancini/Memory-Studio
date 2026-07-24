---
purpose: Histórico de handoffs de sessão preservados para referência futura
created: 2026-07-23
created_by: M3E
---

# Archive — Handoffs de sessão

Este diretório preserva `handoff-session.md` antigos. Cada arquivo é datado
(YYYY-MM-DD) e representa o estado da skill + roadmap ao final daquela sessão.

## Convenção

| Arquivo | Quando | Por que arquivado |
|---|---|---|
| `handoff-session-2026-07-23.md` | Fim da sessão de calibração da skill | Substituído por novo handoff em raiz após decisão de Loop v2 escopo = failure diagnostics |

## Como usar

Quando um agente futuro precisar entender decisões históricas:

1. Ler o handoff ATUAL na raiz (`handoff-session.md`) — estado vigente.
2. Se a decisão parecer inexplicável, ler o handoff ARQUIVADO relevante.
3. Nunca sobrescrever um arquivo arquivado — append-only é regra. Se
   aparecer nova evidência, criar novo arquivo datado.

## Por que arquivar e não deletar

Decisões de escopo (ex: "Loop v2 = 2 itens, não 6") são triviais no momento
mas podem virar dúvida 6 meses depois. Arquivar preserva o raciocínio
completo (incluindo candidatos rejeitados) sem poluir o handoff ativo.

**Regra:** o handoff da raiz é EXECUTIVO (1-2 páginas, só o que importa).
O handoff arquivado é COMPLETO (estado + raciocínio + alternativas).
