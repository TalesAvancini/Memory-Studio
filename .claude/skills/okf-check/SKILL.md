---
name: okf-check
description: Enforce OKF (Open Knowledge Format) v0.1 compliance on markdown files under docs/. Use when creating, editing, or reviewing any docs/**/*.md file. Triggers on phrases like "add a doc", "criar doc", "edit documentation", or any Write/Edit on docs/.
---

# OKF Check Skill

This project treats every `.md` file under `docs/` as an OKF v0.1 concept. This skill enforces that.

## When to invoke

Invoke this skill whenever you:

- Create a new file under `docs/**`
- Edit an existing file under `docs/**`
- Are about to commit documentation changes
- Want to know if a doc complies with OKF

## The contract (OKF v0.1 — minimally opinionated)

Every non-reserved `.md` file MUST have parseable YAML frontmatter at the top:

```yaml
---
type: <Type>              # REQUIRED — non-empty string
title: <Display name>     # recommended
description: <1-line>     # recommended — short summary
resource: <Canonical URI> # optional, auto-set for governance docs
tags: [tag1, tag2]        # optional
timestamp: <ISO 8601>     # optional, updated by scripts
---
```

**Reserved filenames** (do NOT use for concepts):
- `index.md` — directory listings
- `log.md` — change history

A bundle is conformant iff:
1. Every non-reserved `.md` has parseable YAML frontmatter.
2. Every frontmatter has a non-empty `type`.
3. Reserved filenames, if present, follow their structure rules.

## Project conventions (the opinionated part)

- **Custom types** (not BigQuery style): `Tool`, `Command`, `Workflow`, `Concept`, `Decision`, `SSOT`, `Reference`
- **Type inference by path**:
  - `docs/governanca/**` → `Concept` (or `SSOT` if pointing to external notebook)
  - `docs/tools/<name>/**` → `Reference`
  - `docs/conhecimento/**` → `Concept`
  - `docs/decisoes/**` → `Decision`
- **`resource`** auto-points to `https://notebooklm.google.com/notebook/a67802e8-1954-4136-8ab3-187fd334d4fc` for any governance doc
- **Tags** come from path segments, plus `okf` is appended automatically
- **Filenames**: lower-kebab-case, filename = concept identity

## Cross-linking

OKF defines two internal link styles:
- Bundle-relative: `/tables/customers.md` (recommended, stable)
- Relative: `./other.md` or `../bundle/x.md` (standard markdown)

Relationship TYPE (uses/depends-on/etc.) is NOT encoded in OKF — convey it in surrounding prose.

**Broken links MUST be tolerated** by consumers; that is intentional. Don't refuse to write a doc because a target doesn't exist yet.

## The two scripts

| Script | Use |
|--------|-----|
| `python scripts/enrich_okf_frontmatter.py` | One-shot enrichment: adds missing frontmatter to all docs/**/*.md. Idempotent. |
| `python scripts/validate_okf_frontmatter.py` | Read-only check. Exit 0 = clean, exit 1 = errors. Use before commits. |

Both use **pure stdlib** (no PyYAML required).

## Self-check before declaring done

Before saying "I created/updated the doc", run:

```bash
python scripts/validate_okf_frontmatter.py <file>
```

If exit code is 1, fix the issues. If exit code is 0 (or no errors reported), you're good. Warnings (timestamp, resource) are soft.

## Common pitfalls

1. **Don't hand-write the YAML** if you can avoid it — let the enrich script generate it, then tweak only what you need.
2. **Don't strip frontmatter** when reformatting a doc — re-validate after.
3. **`type` is required.** "Tool" and "Reference" are different things. Pick the closest match, don't leave empty.
4. **Path-based inference is naive.** If a doc's real semantic type doesn't match its path (e.g., a `docs/governanca/okf/decisoes/X.md`), override `type` manually.

## Related

- `docs/governanca/okf/README.md` — full OKF spec captured locally
- `docs/governanca/okf/aplicacao-projeto.md` — how this project applies OKF
- NotebookLM SSOT: `a67802e8-1954-4136-8ab3-187fd334d4fc` (use `notebooklm ask` to confirm any spec interpretation)
