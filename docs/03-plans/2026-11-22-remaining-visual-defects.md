# Implementation plan — remaining visual parity defects

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-remaining-visual-defects.md`

## Goal

Fix the four remaining reported visual mismatches with generic XFA/CSS rules.

## Scope

- In scope: uniform-rectangle edge de-duplication, bold weight mapping,
  rich-text effective font size and fragment anchoring, and non-recursive keep.
- Out of scope: filled-ring border representation, full incremental reflow.

## Steps

- [x] 1. `src/rendering/pdf-renderer/border-fill.ts`: route the four sides of
  `strokeUniformRect()` through the existing per-page `edgeKey()`/`emittedKeysFor()`
  registry so identical uniform boxes are emitted once.
- [x] 2. `src/rendering/standard-fonts.ts`: restore bold for all families,
  including condensed ones; keep horizontal condensation as a separate `Tz`
  scale. Update `font-resolution.test.ts`.
- [x] 3. Rich-text sizing: in `position-engine.ts` `drawValueHeight()` and
  `pdf-renderer/text.ts`, derive the paragraph fallback size from the largest
  parsed run `fontSize` before computing `paraMetrics`; keep authored
  `line-height` authoritative. Apply the same rule in `leafLineBaselines()`.
- [x] 4. Fragment anchoring: carry original box position/height on clipped
  leaves so `renderRichText()` and `renderField()` place `textLineRange` lines
  at their authored offsets within the original box, and clip to the fragment
  band instead of disabling clipping for ranged nodes.
- [x] 5. `src/domain/layout/apply-pagination.ts`: replace recursive
  `hasExplicitKeep()` with the declaring node's own `keep`; remove compounding
  ancestor shifts. Update the recursive-keep test.
- [x] 6. Add/extend unit tests for each step; regenerate sample PDFs and
  re-measure the reported cases.
- [x] 7. Update `AI_WIKI.md`/`docs/README.md` and run full verification.

## Tests

- `test/unit/rendering/stroke-width.test.ts`, `border-parity.test.ts`
- `test/unit/rendering/font-resolution.test.ts`
- `test/unit/rendering/rich-text-parser.test.ts`, `text-parity.test.ts`,
  `draw-text-wrapping.test.ts`
- `test/unit/domain/layout/apply-pagination.test.ts`, `pagination.test.ts`

## Verification

```bash
npm run format
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
node scripts/render-sample-forms.mjs
npm run check:size
npm run check:publint
npm run check:types
npm audit --omit=dev
npm run bench
```

## Rollback

Revert any step that changes page counts away from 1/6/6/6/2, breaks existing
valid bold/wrapping assertions, reduces coverage, or exceeds the 390 KB budget.

## Outcome

Uniform rectangle strokes now use the same per-page edge registry as individual
edges, removing all six duplicate 1.68 pt Example-3 page-2 rules. Bold weight is
restored for every family, including Arial Narrow, while `Tz` condensation stays
separate. Rich text uses the effective CSS run size for line advance (14.4 pt
instead of 12 pt), and clipped fragments anchor lines to their original box and
clip to the fragment band, removing the overlap. Explicit `keep` applies only to
the declaring node, removing the compounding ~270 pt shift that pushed the V-7
block to page 3.

Measured: Example-3 thick duplicate groups 6 → 0; `Ruvlviqd Rjcfqtk:` width
83.1 → 145.8 pt in Helvetica-Bold (Adobe 90.2 pt band), table headers bold;
Example-2 rich line pitch 12 → 14.4 pt and overlap gone; `V-7 YB` page 2 y=694
(Adobe ≈704) and `V-6 YB` page 3 y=161 (Adobe ≈150). Page counts unchanged.

Verification: 120 unit suites (1,560 passing), 17 integration suites (93
passing), coverage 96.69% lines, package 371,307 bytes, all gates green.

Residual: thick borders remain centred strokes rather than Adobe filled rings;
the Example-3 footer rows are ~1.3–1.8 pt offset due to minH/row-height rules.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — remaining
visual parity defects.
