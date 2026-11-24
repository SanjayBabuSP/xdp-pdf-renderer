# Implementation plan — footer grid, fragment cutoff and NBSP tofu defects

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-footer-fragment-nbsp-defects.md`

## Goal

Remove the doubled footer grid lines on Example-3, the clipped first
continuation line on Example-2-EN page 5, and the tofu boxes flanking the
Example-2-EN footer page number.

## Scope

- In scope: rotated-draw layout height; geometry-based edge dedup;
  fragment line re-anchoring in rich/plain render paths; NBSP substitution
  in glyph coverage; unit tests for each; Adobe pixel comparisons.
- Out of scope: border paint model (centred strokes stay), pagination
  ownership rule, line-break measure unification, font binary changes.

## Steps

- [x] Step 1 — `src/domain/layout/position-engine.ts` (`layoutLeafDraw`):
      lay out 90/270-degree rotated draws at visual height (authored `w`)
      instead of authored `h`, mirroring `declaredWidth` in flow-engine.
      Pagination measures the same visual height so rows are not stretched
      back by the overflow guard.
- [x] Step 2 — `src/rendering/pdf-renderer/border-fill.ts` (`drawEdge`,
      `strokeUniformRect`): dedup key on geometry+style without thickness so
      the first painted (outside-in: container) edge wins coincident lines.
- [x] Step 3 — shared fragment helper (`alignFragmentBand`) + use in
      `text.ts` (`renderRichText`), `draw.ts` (plain text branch) and
      `field.ts` (value text): shift owned baselines so the first owned line
      top meets the band top and extend the clip to the last owned line
      bottom; top-aligned fragments only, aligned output byte-identical.
- [x] Step 4 — `src/rendering/text/glyph-coverage.ts`: substitute a regular
      space for blank separators missing from a known font charset instead of
      emitting `.notdef`.
- [x] Step 5 — unit tests: rotated layout height; geometry dedup
      first-wins; fragment alignment shift/extend; NBSP substitution; plus
      reference-backed cases (renderCache bounds, oracle pixel positions).
- [x] Step 6 — regenerate sample PDFs, Adobe-compare the three regions,
      update `docs/01-canonical/AI_WIKI.md` (§10 + §11) and
      `docs/README.md`, run full verification.

## Tests

- Regression test that fails without the fix:
  `test/unit/domain/layout/position-engine.test.ts` (rotated visual
  height, NBSP substitution via `glyph-coverage.test.ts`), new fragment
  alignment test, border dedup test.
- Updated tests: any footer/fragment expectations that pinned old geometry.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Revert when any Adobe pixel comparison regresses beyond single-row
anti-aliasing noise or when an existing parity test pins the old geometry
as Adobe-correct.

## Outcome

Shipped: visual-height flow rows + pagination `visualHeight`; geometry
first-wins edge dedup; fragment re-anchoring in all three text paths; NBSP
substitution. Example-3 footer band vs Adobe 18777 → 10104 diff px (-46%);
page 2 overall 72028 → 63593 (-12%). Example-2 page 5 continuation line
renders whole from the band top; footer `□5□` renders as blank-padded `5`.
Full verification green (120 unit suites / 17 integration suites, coverage
thresholds met, size 373,506 < 390,000). Wiki §4/§5/§6/§10/§11 and README
index updated.
