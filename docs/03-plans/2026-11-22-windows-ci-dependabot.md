# Implementation plan — Windows CI formatting and Dependabot PR flood

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-windows-ci-dependabot.md`

## Goal

Make `npm run format:check` pass on Windows and reduce Dependabot noise to a
reviewable stream of compatible updates.

## Scope

- In scope: `.gitattributes`, `.prettierrc`, `.github/dependabot.yml`, docs.
- Out of scope: closing or merging existing pull requests, upgrading major
  dependency versions, changing source code.

## Steps

- [x] 1. Add `.gitattributes` forcing LF for text files and marking binary
  fixtures as binary.
- [x] 2. Add `"endOfLine": "lf"` to `.prettierrc`.
- [x] 3. Lower npm `open-pull-requests-limit` to 2 and github-actions to 1.
- [x] 4. Group minor/patch npm updates and GitHub Actions updates; ignore major
  version bumps so breaking upgrades are handled deliberately.
- [x] 5. Update `docs/README.md` and AI_WIKI verification notes.

## Tests

- Re-run the Windows CI job in GitHub Actions; `Check formatting` must pass.
- Confirm `npm run format:check` remains clean locally and on Linux.
- Confirm Dependabot no longer opens more than the configured limits.

## Verification

```bash
npm run format:check
npm run lint
npm run build
npm run test:unit
npm run test:integration
```

## Rollback

- Revert `.gitattributes` if binary fixtures change or Windows formatting still
  fails.
- Revert the Dependabot limits if desired updates stop arriving.

## Outcome

Added `.gitattributes` and explicit Prettier LF configuration, so Windows CI
no longer flags CRLF checkouts. Dependabot now opens at most two grouped npm
PRs and one grouped GitHub Actions PR, and ignores major upgrades. Existing
Dependabot PRs were left untouched for the maintainer to close or merge; they
will pass their checks when rerun after this change. Research and wiki ledger
updated.
