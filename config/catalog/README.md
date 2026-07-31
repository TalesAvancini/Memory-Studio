---
date: 2026-07-30
version: 1
description: "config/catalog/ — git-tracked source for Memory Studio's catalog (skills, rules, personas). Each entry is a single YAML file; load via `npm run build-index` (Phase 1.4)."
explanation: |
  This directory is the **human-facing authoring surface** for the Memory
  Studio catalog. Each file is one catalog entry: a Skill, a Rule, or a
  Persona. The runtime ingests them on `npm run build-index` (Phase 1.4
  deliverable) and writes rows into the SQLite `catalog` table with
  embeddings + FTS5 + sqlite-vec indexes.

  Phase 1.1 ships the directory + 3 sample files + this README. Phase 1.2
  adds the SQLite schema and migration runner. Phase 1.3 wires the
  multilingual-e5-small embedder. Phase 1.4 ships `npm run build-index`.
---

# config/catalog/

> **Catalog authoring surface.** One YAML file per catalog entry.
> Loaded by `npm run build-index` (Phase 1.4).

## File naming

Use the same kebab-case id as the `id` field:

```
config/catalog/example-skill-01.yaml    ← id: example-skill-01
config/catalog/example-rule-no-secrets.yaml
config/catalog/example-persona-concise.yaml
```

The id field is the **unique key** for idempotent loader updates. Re-running
`npm run build-index` with no changes produces 0 INSERTs, 0 UPDATEs, 0 DELETEs.
Renaming the file's basename without updating the `id` field would create a
duplicate — don't do that.

## Three entry types

### Skill

```yaml
id: example-skill-01            # required, kebab-case, unique
type: skill                     # required, literal "skill"
title: Example Skill — JWT      # required, human-readable
category: procedural            # required enum: procedural | diagnostic | reference | pattern
text: |                         # required, multi-line body, NFC-normalized, non-empty
  Validates JWT tokens ...
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) |
| `type` | `"skill"` | yes | discriminator |
| `title` | string | yes | human-readable label |
| `category` | enum | yes | one of `procedural`, `diagnostic`, `reference`, `pattern` |
| `text` | string | yes | non-empty; NFC normalization applied at parse time |

### Rule

```yaml
id: example-rule-no-secrets-in-prompts
type: rule
critical: true                  # optional, default false; if true, atomic injection in Phase 5
text: |
  Never include raw API keys, ...
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | kebab-case |
| `type` | `"rule"` | yes | discriminator |
| `text` | string | yes | non-empty |
| `critical` | boolean | no | default `false` |

### Persona

```yaml
id: example-persona-concise
type: persona
isDefault: true                 # optional, default false; at most 1 true in active catalog
text: |
  Respond concisely. ...
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | kebab-case |
| `type` | `"persona"` | yes | discriminator |
| `text` | string | yes | non-empty |
| `isDefault` | boolean | no | default `false` |

## How to add a new entry

1. Create `config/catalog/<id>.yaml` matching one of the three shapes above.
2. Validate locally (after Phase 1.4 ships):
   ```bash
   npx tsx src/catalog/cli.ts validate config/catalog/<id>.yaml
   ```
3. Re-index:
   ```bash
   npm run build-index
   ```

## Validation errors

When a YAML file fails Zod validation, `build-index` prints
`[WARN] skipped <file>: <field>: <code>` to stderr with a deterministic code
(`invalid_category`, `<field>_required`, `invalid_<field>_type`). The loader
continues with the remaining files; `build-index` exits non-zero so CI flags it.

## Sample files shipped with Phase 1.1

- `example-skill.yaml` — procedural skill (JWT validation)
- `example-rule.yaml` — critical rule (no secrets in prompts)
- `example-persona.yaml` — default persona (concise responses)

Use these as templates; copy and edit.
