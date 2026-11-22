# Documentation rules for AI agents and maintainers

This file is binding for every AI agent and human maintainer working in this
repository. The docs tree is part of the product: unmaintained docs cause wrong
code.

## Layout

| Path | Purpose | Who owns it |
| --- | --- | --- |
| `docs/README.md` | Index and reading order | Maintainer |
| `docs/AGENTS.md` | This rule file | Maintainer |
| `docs/01-canonical/` | Single source of truth (AI_WIKI) | Code author |
| `docs/02-research/` | Evidence, analysis, observations | Research author |
| `docs/03-plans/` | Implementation and parity plans | Plan author |
| `docs/04-decisions/` | Historical decisions and fix rationale | Code author |
| `docs/05-reference/` | External/Adobe behaviour evidence | Research author |

Filenames are lowercase kebab-case. Dated working documents use
`YYYY-MM-DD-slug.md` (for example `2026-11-21-table-row-height.md`).

`02-research/`, `03-plans/`, `04-decisions/` and `05-reference/` each contain a
`_TEMPLATE.md`. Use the decisions template when a choice needs justification,
and the reference template when a source needs to be quoted as evidence.

## Mandatory research + plan rule

**No non-trivial code change without two markdown files.**

Before writing or modifying source code for any task that changes behaviour,
touches more than one file, or introduces a new API, create:

1. a research note in `docs/02-research/YYYY-MM-DD-slug.md`, and
2. an implementation plan in `docs/03-plans/YYYY-MM-DD-slug.md`.

Use the templates `_TEMPLATE.md` in each directory. Both files must exist before
the first source edit. Exempt: typo fixes, formatting-only changes, and changes
that only rename files/directories.

Research notes must record: question, evidence sources (fixture, PDF, decompiled
code, spec, measurement), findings with confidence, and open unknowns. Plans
must record: goal, scope, file-by-file steps, tests to add, verification
commands, and rollback conditions.

After implementation:

- tick the plan steps that were completed and add an `Outcome` section;
- update `docs/01-canonical/AI_WIKI.md` with what changed and why, plus a dated
  ledger entry (root `AGENTS.md` already requires this for code changes);
- update `docs/README.md` if a new document becomes canonical or long-lived.

## Code-writing skills

Canonical skill content is committed in `.skills/`. Agent discovery links
live in `.agents/skills/`. Source:
`gohypergiant/agent-skills` (installed with `npx skills add`).

Load the matching skill before writing or reviewing code:

- `best-practices-ts` — all JS/TS authoring and review
- `performance-ts` — optimization and hot-path work
- `testing-ts` — tests and test architecture
- `documentation-ts` — JSDoc/comment quality
- `audit-all-ts` — combined audit
- `node` — Node.js runtime, async, streams, error handling, graceful shutdown
- `linting-neostandard-eslint9` — ESLint v9 flat config and neostandard rules
- `architecture-doc` — architecture documentation changes
- `readme-writer` — README changes

### Deduplication policy

`.skills/` is the single canonical copy. Every other location is a
symlink produced by `bash scripts/sync-agent-skills.sh`. Overlapping skills
from other sources are deliberately not installed: `typescript-magician`
(duplicates `best-practices-ts`), `documentation` (duplicates
`documentation-ts` / `readme-writer`) and `init` (duplicates
this file). `skills-lock.json` records only installed skills.

Skill guidance overrides ad-hoc style preferences. The repository still forbids
explanatory inline comments in source; rationale belongs in the wiki. TSDoc on
the exported public API is the only exception.
