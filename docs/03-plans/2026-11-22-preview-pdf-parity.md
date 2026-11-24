# Implementation plan — Adobe Preview PDF parity

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-preview-pdf-parity.md`

## Goal

Make generated PDFs match Adobe LiveCycle Designer Preview PDF geometry,
style, alignment and visible glyphs through generic XFA rules rather than
sample-form special cases.

## Scope

- In scope: effective stroke width and table/border geometry; caption `<para>`
  and value alignment; glyph coverage and Arial metric-compatible subsets;
  shared URL break opportunities; rich-text spacer/paragraph vertical metrics;
  break/keep target handling and pagination alignment consistency.
- Out of scope: byte-identical PDF operators (the oracle is a print-to-PDF),
  full incremental flow reflow, Arial BoldItalic/Arial Narrow metric assets,
  `Example-2-CN` validation (no oracle), and date fields (runtime values).

## Steps

- [x] 1. Add Latin-1 Arial regular/bold/italic subsets derived from the supplied
  oracle font programs to `assets/fonts/` and resolve them absolutely from
  `src/config/default-fonts.json` + `src/rendering/font-manager.ts`.
- [x] 2. Add per-glyph coverage filtering in
  `src/rendering/text/glyph-coverage.ts`; use it in `measureText`,
  `drawScaledText`, and draw/field/rich-text sources so unmappable glyphs are
  omitted consistently before wrapping, measurement and painting.
- [x] 3. Replace the 0.1778 mm table constant and fixed 3 pt edge-collapse
  tolerance with one effective-stroke-width authority in
  `src/rendering/border-style.ts`, `table-engine.ts`, `border-fill.ts`,
  `subform.ts` and `draw.ts`; guard non-finite widths at emission.
- [x] 4. Parse caption `<para>` into `CaptionSpec` and apply its margins,
  alignment and line advance in `field.ts`; use `mapJustV` in
  `apply-pagination.ts` so `center`/`middle` agree.
- [x] 5. Share URL break opportunities between `line-breaker.ts` and
  `run-flow.ts`: always break after a path slash, never inside `scheme://`,
  and honour soft hyphen/ZWSP.
- [x] 6. Parse rich-text paragraph `line-height` and `margin-top/bottom`;
  treat `xfa-spacerun`-only paragraphs as authored vertical gaps and use
  per-paragraph advances in `layoutRunLines`/`drawValueHeight`.
- [x] 7. Handle `pageFront`/`pageArea`/`contentArea` break targets and trailing
  `breakAfter` consistently in `apply-pagination.ts`; use the same height for
  bands and baseline conversion.
- [x] 8. Add unit/integration regression tests for each generic rule and
  update existing tests whose old expectations encoded the bugs.
- [x] 9. Regenerate sample PDFs, compare borders/style/alignment with Adobe,
  update `AI_WIKI.md` and `docs/README.md`, then run full verification.

## Tests

- New: `test/unit/rendering/glyph-coverage.test.ts`
- New: `test/unit/rendering/font-manager-coverage.test.ts` (or extend
  `font-manager.test.ts`)
- New: `test/unit/rendering/caption-para.test.ts`
- New: `test/unit/rendering/url-break-opportunities.test.ts`
- Extended: `test/unit/rendering/border-style.test.ts`,
  `test/unit/rendering/border-parity.test.ts`,
  `test/unit/rendering/stroke-width.test.ts`,
  `test/unit/domain/layout/engines.test.ts`,
  `test/unit/domain/layout/apply-pagination.test.ts`,
  `test/unit/rendering/text-parity.test.ts`,
  `test/unit/rendering/para-metrics.test.ts`,
  `test/unit/rendering/font-resolution.test.ts`,
  `test/integration/workflow/font-subsetting.test.ts`
- Comparison: regenerate `test/fixtures/sample-forms/results/*.pdf` and check
  text spans, stroke centre-lines and page attribution against Adobe.

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

Revert any step that breaks existing border/path expectations, reduces
coverage below thresholds, increases package size beyond 390 KB, changes page
counts away from the oracle, or introduces fixture-specific literals in source.
If Arial subsets fail font embedding, fall back to Helvetica aliases and keep
the remaining generic fixes.

## Outcome

Shipped generic stroke-width authority (`effectiveStrokeWidth`/`halfStrokeWidth`),
caption `<para>` parsing and rendering, per-glyph coverage filtering, bundled
Arial regular subset for normal weight, shared URL/ZWSP/shy break opportunities,
CSS-aware rich-text paragraph metrics, and improved break-target/alignment
consistency. Added 12 regression tests across border, font, caption, text and
pagination suites; updated the test helper to decode CID ToUnicode maps.

Measured parity: Example-1 caption x moved from 26.1 pt to 43.1 pt (Adobe 43.2);
Example-1 page count, stroke widths and numeric formatting unchanged; Example-3
Greek `Ξ`/`ξ` now omitted like Adobe; Example-3 URL renders on one line instead
of wrapping after the slash; all four oracle forms retain 1/6/6/2 pages.
Page counts, font sizes and colours otherwise match Adobe.

Residual gaps: Example-2 still splits the eight-row table across pages 5/6
(Adobe keeps it on page 6); border centre-line drift of up to ~12.5 pt remains
on some Example-2 page-3 rules; Arial bold/italic use metric-compatible base-14
variants because full Arial Bold/Italic assets are not present in `reference/`;
full incremental flow reflow is still out of scope.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — Preview PDF
geometry, font coverage and text layout parity.
