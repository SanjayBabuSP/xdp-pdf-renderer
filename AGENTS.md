# Agent instructions

## Read first

- [`docs/01-canonical/AI_WIKI.md`](docs/01-canonical/AI_WIKI.md) — architecture,
  behaviour, rationale and change ledger. Source of truth.
- [`docs/AGENTS.md`](docs/AGENTS.md) — documentation layout, naming scheme, and
  the mandatory research + plan rule.
- [`docs/README.md`](docs/README.md) — documentation index and reading order.
- [`docs/05-reference/API.md`](docs/05-reference/API.md) — public API reference,
  defaults, error codes and security notes.

The codebase deliberately has no explanatory inline comments. Do not add them.
TSDoc on the exported public API is the only exception.

## Mandatory workflow for every AI agent

1. For any non-trivial change (behaviour change, more than one file, new API),
   write a research note in `docs/02-research/` and a plan in `docs/03-plans/`
   **before editing source code**. Use the `_TEMPLATE.md` files in those
   directories and the `YYYY-MM-DD-slug.md` naming scheme.
2. Load the matching installed skill before writing or reviewing JavaScript or
   TypeScript: `best-practices-ts` (all JS/TS),
   `performance-ts` (optimization), `testing-ts` (tests),
   `documentation-ts` (comments/JSDoc), `audit-all-ts`,
   `node` (Node.js runtime, async, streams, errors) and
   `linting-neostandard-eslint9` (ESLint v9 flat config rules).
   For docs work use `architecture-doc` and `readme-writer`.
   `.skills/` is the only canonical copy; `.agents/skills/` contains symlinks
   only. Rebuild links with `bash scripts/sync-agent-skills.sh`. Do not install
   a second skill from another source that duplicates one of these.
3. After changing code, update `docs/01-canonical/AI_WIKI.md` in the same change:
   describe what changed and why, add a dated entry to its Change ledger, and
   record any new or updated regression test.
4. Verify with `npm run lint`, `npm run build`, `npm run test:unit`, and
   `npm run test:integration`.
