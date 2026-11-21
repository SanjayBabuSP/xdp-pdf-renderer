# Implementation plan — comprehensive unit coverage

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-unit-coverage-all-source.md`

## Goal

Every behavior-bearing source file has a direct unit test, and overall unit line
coverage is at least 90%.

## Scope

- In scope: new/expanded unit suites, coverage script, docs/wiki updates.
- Out of scope: source refactors, integration test rewrites, 100% branch
  coverage, tests for type-only/constant-only modules.

## Steps

- [x] Step 1 — Added `"test:coverage"` to `package.json` with `json-summary`
      and `text-summary` reporters; documented in `README.md`.
- [x] Step 2 — Adobe helper tests: bookmarks, acroform, annotations, layers,
      tagged, security, form-flatten, xfa, tab-order, metadata, font sequences,
      namespace validation, crypto.
- [x] Step 3 — Scripting/validation tests: SOM resolver, record/form proxies,
      dependency tracker, FormCalc lexer/parser/evaluator, JS engine, object
      model, property tracker, event dispatcher, binding/structure validation.
- [x] Step 4 — Rendering/utility/layout tests: fill paint, image sniff/
      scale/embed, CFF patch, node UID, opacity, XCI parser, text measure,
      position/table engines, CLI wiring, barrel exports.
- [x] Step 5 — Coverage iterated to 96.5% lines; all behavior-bearing modules
      are directly imported by unit tests. Type-only files remain exempt.
- [x] Step 6 — Updated `AI_WIKI.md` §§9–11 and this plan.

## Tests

- 107 unit suites / 1399 passing tests (1 pre-existing skip).
- Coverage: lines 96.5%, statements 94.44%, functions 95.67%, branches 84.66%.
- Remaining lines are defensive/unreachable guards (union fallbacks, impossible
  catch blocks, shadowed checks); branch coverage is deliberately not gated at
  100%.
- All new/modified test files type-checked explicitly with `npx tsc --noEmit`.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
```

Coverage gate: lines ≥90%; all behavior-bearing source files directly imported
by at least one unit test.

## Rollback

Revert a test group if it is flaky, depends on fixture-specific data, or fails
the exact verification commands. Do not lower the 90% line target.

## Outcome

All targets met. `npm run test:coverage` reports 96.5% line coverage with 107
passing unit suites. Every behavior-bearing source module is directly imported;
only type-only modules and pure re-export barrels are exempt (barrels are still
smoke-tested through directory imports). Wiki, README and this plan updated.
