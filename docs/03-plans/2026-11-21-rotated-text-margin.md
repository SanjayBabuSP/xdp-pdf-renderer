# Implementation plan — rotated text margin axis

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-rotated-text-margin.md`

## Goal

Align vertical text inside rotated boxes with Adobe without moving the boxes.

## Scope

- In scope: vertical text branch of `src/rendering/pdf-renderer.ts`, reference
  note, regression test, wiki ledger.
- Out of scope: horizontal text, border geometry, font metrics.

## Steps

- [x] Remove the bottom-margin offset from `rotatedY` for rotate=90/270 text.
- [x] Add a regression test that renders a rotated draw with asymmetric
      top/bottom insets and checks the text baseline does not move vertically
      with the bottom inset.
- [x] Re-render Example-3 and compare rotated-label crops with the Adobe PDF.
- [x] Update `reference/RENDERING_BEHAVIOR.md` and the wiki ledger.

## Tests

- New test in `test/unit/rendering/` for rotated margin axis.
- Existing unit/integration suites; sample PDF content signatures may change
  only in rotated text positions.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Restore the margin term if rotated labels move down too far or tests regress.

## Outcome

- Vertical text anchor now uses `flipY(pos.y, width, pageH) - margins.top`
  instead of `+ margins.bottom`.
- `test/unit/rendering/rotated-text-margin.test.ts` proves bottom insets do not
  move the rotated baseline and top insets inset it by their exact point value.
  Both directions fail with the old formula.
- `reference/RENDERING_BEHAVIOR.md` records the rotation-inset rule with
  Medium confidence. Example-3 page-2 `Odaavg` glyph offset relative to the
  strip now matches the Adobe PDF; absolute ~2pt section drift remains.
