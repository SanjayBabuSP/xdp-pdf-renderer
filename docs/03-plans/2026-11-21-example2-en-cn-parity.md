# Implementation plan — Example-2 EN/CN parity defects

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-example2-en-cn-parity.md`

## Goal

Fix the four Example-2 defects generically: valid CJK font subsets, continuous
table grid lines, line-boundary pagination of multi-line fields, and correct
rich-text paragraph styles.

## Scope

- In scope: font embedding, table row layout, coincident-edge pruning,
  pagination fragments, rich-text CSS parsing, regression tests, docs/wiki.
- Out of scope: faithful `contentBlockToPage` port; new font assets; changing
  Adobe reference PDFs; fixture-specific conditionals.

## Steps

- [x] Step 1 — `src/rendering/cff-subset-patch.ts` (new): wrap the registered
      fontkit instance so CFF subsets emit a valid `offSize` byte; `FontManager`
      registers the wrapper. TrueType subsets are untouched.
- [x] Step 2 — `src/domain/layout/table-engine.ts`: remove the 7mm row-pitch
      floor in `layoutSubformSetRows`; row pitch now equals `result.height`.
- [x] Step 3 — `src/rendering/pdf-renderer.ts`: `collapseTinyGapEdges()` now
      suppresses a parent edge only when visible child edges cover the parent's
      full x-span (3pt tolerance).
- [x] Step 4 — `src/types.ts`: added `textLineRange` to `FieldNode`/`DrawNode`.
- [x] Step 5 — `src/domain/layout/apply-pagination.ts`: line-aware page
      fragments with PDF y-up baseline conversion.
- [x] Step 6 — `src/rendering/pdf-renderer.ts`: field, draw and rich-text paths
      slice `textLineRange` while keeping logical baselines; overflow clipping
      is skipped for pagination fragments.
- [x] Step 7 — `src/rendering/rich-text-parser.ts`: paragraph/span CSS styles
      with state-stack overrides; added `TextRun.fontFamily`.
- [x] Step 8 — `src/rendering/pdf-renderer.ts`: per-run `fontFamily` drives font
      selection and `Tz` horizontal scaling.
- [x] Step 9 — Regression tests added/updated.
- [x] Step 10 — Docs and reference behavior updated; plan completed.

## Tests

- Added `test/unit/rendering/cff-subset.test.ts` — decoded CFF subset header has
  `offSize` 1–4.
- Added subformSet row test to `test/unit/domain/layout/engines.test.ts` — row
  pitch equals shared cell height.
- Added full-width coverage test to
  `test/unit/rendering/border-parity.test.ts`.
- Added line-range test to
  `test/unit/domain/layout/apply-pagination.test.ts`.
- Added paragraph-CSS tests to
  `test/unit/rendering/rich-text-parser.test.ts`.
- Fixed a pre-existing type error in `border-parity.test.ts` (`contentStream`
  already returns a string).
- Test files type-checked explicitly with `npx tsc --noEmit ...`.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

Post-render checks: CJK PDF loads without MuPDF font errors; Example-2-EN table
columns are continuous; item 2 appears once at the break; rich labels carry
bold/underline spans at the authored size.

## Rollback

Revert a step if it breaks existing suites, corrupts non-CFF font embedding,
changes unrelated fixture output unexpectedly, or if the Adobe oracle shows a
fix moved behavior away from parity. Revert the whole change set if sample-form
render signatures regress outside Example-2.

## Outcome

All four fixes shipped. Verified CFF header byte 3 is valid in rendered
`Example-2-CN.pdf`; vertical border runs in `Example-2-EN.pdf` are continuous;
item 2's first line stays on the first page and its continuation starts the next
page before item 3; bold labels now use bold font flags. Regression tests pass
and the wiki/reference docs were updated. Residual: Adobe's leading `-` on the
continuation line is not reproduced; its semantics remain unproven because the
Adobe PDF body is vectorized.
