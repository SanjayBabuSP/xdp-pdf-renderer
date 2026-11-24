# Implementation plan — visual parity defects

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-visual-parity-defects.md`

## Goal

Fix the reported visual mismatches in Example-1/2/3 using generic XFA/CSS rules.

## Scope

- In scope: draw wrapping/clipping and height measurement, trailing caption
  symbol placement, rich-text tag balance, explicit `keep` inside repeats,
  border suppression/de-duplication, and thin-rule pagination.
- Out of scope: rebooting the whole pagination engine, embedding Arial
  BoldItalic, and byte-identical PDF operators.

## Steps

- [x] 1. `src/rendering/pdf-renderer/draw.ts`: replace the unconditional
  `<textEdit/>` single-line heuristic with a height-aware rule; wrap to the
  authored width when at least two lines fit, otherwise keep one line and add
  horizontal clipping. `src/domain/layout/position-engine.ts`: include node
  insets in `drawValueHeight`.
- [x] 2. `src/rendering/pdf-renderer/helpers.ts` + `field.ts`: make
  `captionTrailingSymbol()` return the measured spacer advance; position the
  symbol after that spacer with `horizontalOffsetX()` using caption `<para>`
  alignment instead of pinning it to the reserve edge.
- [x] 3. `src/domain/mapping/resolve-embeds.ts` + `src/rendering/rich-text-parser.ts`:
  stop consuming sibling closing tags after embeds and make `</p>`/`</div>`
  pop to the matching block state so `font-weight` cannot leak.
- [x] 4. `src/domain/layout/apply-pagination.ts`: honour explicit
  `keep intact="contentArea"` inside repeat instances and keep thin bordered
  rules atomic instead of clipping them to zero height.
- [x] 5. `src/rendering/pdf-renderer/subform.ts` + `border-fill.ts`: make edge
  suppression presence/y-aware and de-duplicate exactly coincident emitted
  edges per page.
- [x] 6. Add unit regression tests for every step and update tests that encode
  the old bugs.
- [x] 7. Regenerate sample PDFs, re-measure the reported defects, update
  `AI_WIKI.md`/`docs/README.md`, and run full verification.

## Tests

- New/extended: `test/unit/rendering/draw-text-wrapping.test.ts`,
  `test/unit/rendering/text-parity.test.ts`,
  `test/unit/rendering/rich-text-parser.test.ts`,
  `test/unit/domain/mapping/resolve-embeds.test.ts`,
  `test/unit/domain/layout/apply-pagination.test.ts`,
  `test/unit/rendering/border-parity.test.ts`,
  `test/unit/rendering/stroke-width.test.ts`.
- Compare regenerated `results/*.pdf` with Adobe for the nine reported cases.

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

Revert a step if it breaks existing test expectations that encode valid Adobe
behaviour, changes page counts, reduces coverage below thresholds, or increases
package size beyond 390 KB.

## Outcome

Shipped height-aware draw wrapping plus horizontal clipping, inset-inclusive
draw height, natural inline placement of trailing caption symbols through the
measured `xfa-spacerun` advance, tag-balanced embeds/rich-text state, recursive
explicit `keep` handling in repeated rows, presence/y-aware edge suppression,
per-page coincident-edge de-duplication, and atomic treatment of thin rules at
page boundaries. XML parsing now preserves literal non-breaking spaces.

Measured: Example-1 `+` moved to x=187.6 pt versus Adobe 189.4 pt (was 215.1);
Example-2 long body paragraph now ends at x≈527 pt instead of 595 pt; table
headers wrap inside their cells; the spurious bold footnote now renders regular;
Example-2 page 2 no longer carries the second numbered bullet's orphan;
Example-3 footer ends at x≈528 pt versus Adobe 530 pt, coincident stroke
duplicates fell from 12 to 0, and thin page-2 separators are no longer dropped.

Verification: 120 unit suites (1,547 passing), 17 integration suites (93
passing), coverage 96.67% lines, package 370,801 bytes, all lint/build/format/
publint/attw/audit/bench gates green.

Residual: Example-1 row pitch already matches Adobe at 11.34 pt; the remaining
baseline skew (0.3–1.8 pt) comes from font ascent/descent differences and would
require a global metric-table change. Adobe thick borders are filled bars while
ours remain strokes; centre lines match. No fixture-specific source constants
were added.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — visual parity
defects across Example-1/2/3.
