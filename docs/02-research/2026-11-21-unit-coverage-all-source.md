# Research note — comprehensive unit coverage

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-unit-coverage-all-source.md`

## Question

Which source files lack meaningful direct unit tests, and what is the shortest
path to "every source file exercised + at least 90% line coverage"?

## Evidence

- Unit baseline command:
  `npx jest --forceExit --testPathPattern=test/unit --coverage --collectCoverageFrom='src/**/*.ts'`.
- Baseline: statements 68.78% (7412/10775), branches 57.94% (3897/6725),
  functions 68% (965/1419), lines 71.45% (6660/9320).
- 65 unit suites / 778 passing tests exist, but coverage is uneven.
- 18 of 83 covered source files have <50% statement coverage; the lowest are
  `som-expression-resolver.ts`, `pdf-bookmarks.ts`, `pdf-acroform.ts`,
  `pdf-layers.ts`, `pdf-tagged.ts`, `pdf-annotations.ts`, `pdf-security.ts`,
  `pdf-form-flatten.ts`, `fill-paint.ts`, `pdf-xfa.ts`,
  `xfa-record-proxy.ts`, `pdf-tab-order.ts`, `image-sniff.ts`,
  `image-embedder.ts`, `javascript-engine.ts`, `expand-repeats.ts`,
  `font-sequences.ts`, `image-scaler.ts`.
- 38 source modules are never directly imported by a unit test (many are only
  reached indirectly through render/integration tests): 13 `src/adobe/*`
  helpers, CLI/index barrels, `xci-parser`, several layout/scripting helpers,
  validation helpers, node-uid/opacity, and four image/fill helpers.
- `jest.config.js` uses ts-jest with `tsconfig.test.json`, `maxWorkers: 2`,
  `workerIdleMemoryLimit: 512MB`.
- testing-ts skill forbids tests for pure type/constant/barrel-only files; those
  are exempt from "one test file per source file" but must not reduce coverage.

## Findings

- The gap is concentrated in Adobe compatibility helpers, scripting proxy/
  resolver internals, and image/fill rendering helpers (high confidence).
- Existing integration and sample-form tests execute many of these modules, so
  direct unit tests should target exported behavior rather than re-run whole
  renders (high confidence).
- A dedicated `test:coverage` script would make the baseline repeatable and is
  a necessary tooling change (high confidence).
- Reaching 90% lines is realistic; 90% branches is not required by the chosen
  target and would demand tests for defensive/unreachable paths (medium).

## Measurements

| Metric | Baseline | Target |
| --- | --- | --- |
| Lines | 71.45% | ≥90% |
| Statements | 68.78% | ≥90% |
| Functions | 68% | ≥90% |
| Branches | 57.94% | improve, not gated |
| Source files with direct unit import | 51/89 | all behavior-bearing files |
| Unit suites | 65 | + ~20–30 focused suites |

## Open unknowns

- Exact final suite count depends on how many helpers can be tested without
  heavy PDF/font fixtures.
- Some Adobe helpers may require fake `PDFDocument`/`PDFPage` doubles; prefer
  real pdf-lib documents where fast enough.

## Conclusion

Add focused unit suites for every behavior-bearing source file that is currently
uncovered or weakly covered, add a `test:coverage` script, then iterate on the
lowest-coverage files until line coverage reaches 90%. Do not add tests for
type-only files, constant-only files, or pure re-export barrels.
