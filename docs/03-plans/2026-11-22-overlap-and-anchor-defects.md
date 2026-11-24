# Implementation plan — rich-text line fallback and anchorType defects

- Date: 2026-11-22
- Author: opencode
- Status: in-progress
- Research: `docs/02-research/2026-11-22-overlap-and-anchor-defects.md`

## Goal

Remove the Example-2 heading/body overlap and the misplaced Example-3 R310
rule by using font-derived default advances for rich text and honouring XFA
`anchorType` on positioned objects.

## Scope

- In scope: rich-text paragraph fallback in layout + rendering; `anchorType`
  parsing and positioned-placement adjustment; regression tests; doc updates.
- Out of scope: plain-text `<para>` handling, flow-layout anchor centring,
  border dedup changes, pagination changes.

## Steps

- [x] Step 1 — `src/types.ts`, `src/domain/parsing/parse-xdp/helpers.ts`:
      add `Position.anchorType` and parse the attribute.
- [x] Step 2 — `src/domain/layout/position-engine.ts` (`getChildX`/`getChildY`):
      shift authored x/y to the top-left corner from the anchor using authored
      w/h (right → x−w, center → x−w/2, bottom → y−h, middle → y−h/2); unknown
      extents keep current behaviour.
- [x] Step 3 — `src/domain/layout/position-engine.ts` (`drawValueHeight`
      rich-text branch) and `src/rendering/pdf-renderer/text.ts`
      (`renderRichText`): stop seeding `paragraph.lineAdvance` from
      `<para>` so CSS/default advances apply; keep para margins/indents.
- [x] Step 4 — regression tests: anchorType bottomRight placement;
      rich-text advance ignoring `<para>` lineHeight in layout and run flow.
- [x] Step 5 — regenerate sample PDFs, pixel-compare against Adobe
      references, update `docs/01-canonical/AI_WIKI.md` (§10 + §11) and
      `docs/README.md`, run full verification.

## Tests

- Regression test that fails without the fix: new anchorType placement test
  in `test/unit/domain/layout/position-engine.test.ts` (or parsing test);
  new rich-text fallback test asserting `drawValueHeight`/run advance does
  not use `<para>` lineHeight.
- Updated tests: any existing rich-text expectations that pinned the
  `<para>` fallback.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Revert when any Adobe pixel comparison regresses outside anti-aliasing noise
(single-row sub-point edges) or when an existing parity test pins the old
fallback as Adobe-correct.

## Outcome

Shipped: `anchorType` parsing + top-left conversion; rich-text line advances
from CSS/default only. Example-2 heading/body overlap removed (bold pitch
30.1pt → 14.5/22.5pt, Adobe band 33.3pt); Example-3 R310 at Adobe position
(y 348–440, x337.5 darkfrac 0.015 at y440–533). Example-3 page 1 vs Adobe
18235 → 17866 diff px; Example-2 page 3 change confined to y 625–644.
Two existing tests updated to the Adobe behaviour (`text-parity`,
`para-rendering`); wiki §10/§11 and README index updated.
