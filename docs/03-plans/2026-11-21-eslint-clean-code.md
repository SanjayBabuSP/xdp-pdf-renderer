# Implementation plan — ESLint and TypeScript clean-code pass

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-eslint-clean-code.md`

## Goal

Make ESLint a strict, clean quality gate for authored TypeScript and remove
safe clean-code/performance anti-patterns without changing rendering output.

## Scope

- In scope: `src/**/*.ts`, `eslint.config.mjs`, `package.json` lint script.
- Out of scope: lint debt in `scripts/` and `test/`; behavioural changes;
  compiled `dist/**`.

## Steps

- [x] Add `dist/**`, `coverage/**`, `.opencode/**` ignores to the flat config.
- [x] Make `npm run lint` use `--max-warnings 0`; add `lint:fix` script.
- [x] Remove unused imports/variables from `src/` flagged by ESLint.
- [x] Replace empty catch blocks with explicit control flow.
- [x] Fix `prefer-const`, `no-loss-of-precision`, `no-useless-escape`,
      `no-case-declarations` and duplicate `switch` cases.
- [x] Replace `require()` in `src/cli.ts` with a static import.
- [x] Refactor `this` aliases in `javascript-engine.ts` to lexical `this` or
      captured collections.
- [x] Replace repeated `Array.includes()` membership checks with `Set.has()`.
- [x] Run ESLint, build, unit and integration suites; compare rendered PDFs.

## Tests

- Existing suites: `test/unit/**`, `test/integration/**`.
- Regression guard: rendered PDFs in `test/fixtures/sample-forms/results/`
  must remain unchanged by this refactor.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Revert any file whose change alters a test result or a rendered PDF byte count.

## Outcome

- All 24 `src/` ESLint errors resolved; `npm run lint` is strict
  (`--max-warnings 0`) and clean.
- Flat config now ignores `dist/**`, `coverage/**` and local agent dirs.
- Repeated `includes()` lookups replaced with precomputed `Set`s in five files.
- No new regression test: this was a behaviour-preserving refactor, verified by
  770 unit + 92 integration tests and by comparing text/drawing signatures of
  all five rendered sample PDFs before and after (identical).
