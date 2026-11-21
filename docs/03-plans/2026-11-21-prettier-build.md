# Implementation plan — Prettier in the build pipeline

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-prettier-build.md`

## Goal

Make every `npm run build` format authored TypeScript before compiling.

## Scope

- In scope: `package.json` scripts, README development commands, AGENTS/docs,
  wiki ledger.
- Out of scope: Markdown/skill formatting, Prettier rule changes.

## Steps

- [x] Ensure `prettier` is installed as a devDependency.
- [x] Change `build` to `prettier --write src/ test/ && tsc`.
- [x] Add `format:check` with `prettier --check src/ test/`.
- [x] Run `npm run build` and the full verification suites.
- [x] Update README, AGENTS/docs and the wiki ledger.

## Tests

- Existing unit and integration suites; rendered sample PDF content signatures
  must remain unchanged.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Restore the original `build` script if compilation or tests fail after format.

## Outcome

- `npm install --save-dev prettier` confirmed 3.10.1 already installed.
- `npm run build` now runs `prettier --write src/ test/` before `tsc`;
  `format` remains the same write command and `format:check` was added.
- First build needed a second format pass for `parse-xdp.ts`; subsequent
  builds are idempotent and `format:check` is clean.
- Lint, build, 770 unit + 92 integration tests pass. Rendered sample PDF
  text/drawing signatures are unchanged by formatting.
