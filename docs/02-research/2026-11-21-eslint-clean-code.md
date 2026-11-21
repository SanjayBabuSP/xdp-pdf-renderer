# Research note — ESLint and TypeScript clean-code audit

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-eslint-clean-code.md`

## Question

Which TypeScript issues can be fixed safely to make `npm run lint` a clean,
strict quality gate without changing PDF output?

## Evidence

- `npx eslint src test scripts --ext .ts,.mjs -f json`: 143 errors, 26 warnings.
  Of these, 50 errors are in `src/` and the rest are in scripts/tests.
- `npx eslint . --ext .ts`: 1234 errors because compiled `dist/**` is linted.
- `eslint.config.mjs`: no `ignores`, `no-explicit-any` is a warning.
- Skills loaded: `best-practices-ts` (AGENTS.md + quick-start.md),
  `performance-ts` (AGENTS.md + reduce-looping.md),
  `linting-neostandard-eslint9` (flat-config rules).

## Findings

- High confidence: `src/` has 29 unused imports/variables, 6 `this` aliases,
  3 empty catches, 4 duplicate `switch` cases (dead code), 2 `prefer-const`,
  2 useless regex escapes, 1 loss-of-precision literal, 1 `require()` import
  and 1 lexical declaration in a `case` block.
- High confidence: repeated `Array.includes()` membership checks exist in hot
  paths (`event-dispatcher.ts`, `script-dependency-tracker.ts`,
  `parse-xml-data.ts`, `parse-xdp.ts`, `pdf-form-flatten.ts`).
- High confidence: linting `dist/**` is pure noise; compiled output must be
  ignored by the flat config.
- Medium confidence: converting the 6 `this` aliases in `javascript-engine.ts`
  is safe because most are inside arrow functions; two are inside regular
  Proxy handler methods and need a captured collection instead.
- Low confidence: fixing script/test lint debt is out of scope for this pass;
  it does not affect the published TypeScript library.

## Measurements

| Case | Before | Expected after |
| --- | --- | --- |
| `npm run lint` on `src/` | 0 errors, 0 warnings (non-strict) | 0 with `--max-warnings 0` |
| `npx eslint . --ext .ts` | 1234 errors | 0 on authored TS (dist ignored) |
| Repeated membership lookups | O(n) per call | O(1) via `Set.has()` |

## Open unknowns

- Whether hidden script consumers rely on the dead duplicate `x`/`y`/`w`/`h`
  cases in `xfa-form-proxy.ts` (the earlier group already wins at runtime).
- Whether the broader test/script lint debt should be a follow-up task.

## Conclusion

Fix `src/` only, add ignores for generated output, make lint strict, and replace
repeated `includes()` membership checks with precomputed `Set`s. Keep PDF output
byte-for-byte stable and verify with the full suites.
