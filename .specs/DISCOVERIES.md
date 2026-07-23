# Discoveries

Log append-only de drift arquitetural. Append-only — nunca editar entrada existente (severidade pode evoluir em entry nova referenciando a antiga).

## Severidade
- **critical**: boundary change (auth / persistence / authority / concurrency model) — escalates immediately, bloqueia próxima fase
- **structural**: novo componente/edge que muda topologia — acumula; 3+ auto-suggests re-render
- **cosmetic**: label/agrupamento/naming — log only, não surface

## Schema de entrada

| ID    | Severidade                       | Descrição | Fase |
|-------|----------------------------------|-----------|------|
| D-NNN | `cosmetic\|structural\|critical` | …         | F-N  |

---

*(vazio — primeira entrada virá da Phase 1)*
