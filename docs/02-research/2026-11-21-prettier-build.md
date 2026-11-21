# Research note — Prettier in the build pipeline

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-prettier-build.md`

## Question

Should Prettier run as part of `npm run build`, and what scope is safe?

## Evidence

- `prettier@3.10.1` is already a devDependency; `.prettierrc` sets semi,
  singleQuote, es5 trailing commas, 100-column width and 2-space indent.
- `package.json` has `format` = `prettier --write src/ test/` but `build` is
  only `tsc`.
- `sample-forms` and `verify` both call `npm run build`, so a build-time
  format step also applies there.
- Formatting-only changes are exempt from the mandatory research/plan rule, but
  changing the build pipeline is a tooling behaviour change.

## Findings

- High confidence: running Prettier on `src/` and `test/` before `tsc` is
  semantics-preserving; verification is the existing unit/integration suites.
- High confidence: keeping Markdown and skill files out of the write scope
  avoids noisy churn in docs and templates.
- Medium confidence: adding a non-writing `format:check` script is useful for CI
  without changing build behaviour.

## Open unknowns

- Whether contributors expect `npm run build` to be side-effect free. The
  explicit user request overrides that concern here.

## Conclusion

Install/confirm Prettier, make `build` run the same write command as `format`
before `tsc`, add a check-only variant, then run the full build and test suites.
