# Implementation plan — final parity defects

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-final-parity-defects.md`

## Goal

Fix the remaining Example-3 URL/glyph defect and Example-2 pagination/overlap
defects with generic rules.

## Scope

- In scope: authored one-line draw height, printable-ASCII glyph coverage,
  post-shift boundary re-resolution, exclusive line ownership, atomic tables,
  overflow alignment, and fast-path non-straddling fragments.
- Out of scope: full incremental reflow and Arial BoldItalic assets.

## Steps

- [x] 1. `src/domain/layout/position-engine.ts`/`sizing.ts`: cap a growable
  draw to its authored `h`/`minH` when that box fits fewer than two lines, so
  `draw.ts` keeps it single-line and clips horizontally.
- [x] 2. `src/rendering/text/glyph-coverage.ts`: treat printable ASCII as
  covered by every PDF font, so `&` survives.
- [x] 3. `src/domain/layout/apply-pagination.ts`: re-resolve leaves that
  straddle a band after ancestor shifts by moving them whole when they fit;
  make line ownership exclusive; make tables that fit a content area atomic;
  fast-path nodes that do not straddle a band.
- [x] 4. `src/rendering/text/line-metrics.ts`: when `blockHeight > boxHeight`,
  top-align instead of centring above the box.
- [x] 5. Add/extend unit tests for each rule; regenerate PDFs and compare the
  reported cases.
- [x] 6. Update `AI_WIKI.md`/`docs/README.md`; run full verification.

## Tests

- `test/unit/rendering/glyph-coverage.test.ts`
- `test/unit/rendering/draw-text-wrapping.test.ts`
- `test/unit/rendering/line-metrics.test.ts`
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

Revert a step if page counts change, valid line-splits are merged incorrectly,
coverage drops, or package size exceeds 390 KB.

## Outcome

Authored one-line draw boxes are no longer grown by wrapping, so the Example-3
URL stays on one clipped line instead of overlapping the following field. The
bundled Arial subset was regenerated with full Basic Latin coverage (including
`&`), so `Hpojfn & Xefury` renders correctly. Pagination now re-resolves leaves
shifted across page bands, assigns each line exclusively to one page, keeps
fitting tables whole, and skips fragmenting nodes that do not cross a band.
Overflowing centred blocks top-align instead of painting above their box.

Measured: Example-3 URL is one line, `&` count 1, no NUL glyph; Example-2
`Draw_0054`/`Draw_0062` are whole on pages 3/4; the 8-row list is whole on page
6 with no overlap; all four oracle page counts remain 1/6/6/2. Issue template
moved to `docs/06-issue-templates/`.

Verification: 120 unit suites (1,571 passing), 17 integration suites (93
passing), coverage 96.70% lines, package 371,943 bytes, all gates green.

Residual: Example-3 URL clipped one character later than Adobe (ours
`805ee9e`, Adobe `805ee9`); thick borders remain centred strokes rather than
Adobe filled rings.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — final parity
defects and issue-template move.
