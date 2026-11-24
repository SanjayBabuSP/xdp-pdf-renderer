# Research note — final Example-2/3 parity defects

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-final-parity-defects.md`

## Question

What generic rules cause the remaining Example-3 URL/order defect and the
Example-2 page 3/4/5 text leaks, overlaps and missing glyphs?

## Evidence

- PyMuPDF measurements of `results/*.pdf` versus
  `Adobe-generated-results/*.pdf`.
- XDP: `test/fixtures/sample-forms/Example-3/Example-Datasheet.xdp:1883-2000,5667-5699`;
  `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp:3779,4293-4812,4948,5146-5621`.
- Source: `src/domain/layout/apply-pagination.ts`, `position-engine.ts`,
  `sizing.ts`, `src/rendering/pdf-renderer/draw.ts`, `text.ts`, `field.ts`,
  `src/rendering/text/glyph-coverage.ts`.

## Findings

- Example-3 URL draw `T126` has `minH=8.86pt` (one line), but
  `drawValueHeight()` grows it to two lines (15.6pt) by wrapping at `/`. The
  renderer then sees a two-line box, wraps, and paints the second line into the
  next field's area (2.76pt overlap). Adobe clips at the authored width.
  Confidence: high.
- The `&` in Example-3 is dropped because the bundled Arial subset's cmap lacks
  `0x26`; `sanitizeTextForFont()` filters it out. All PDF fonts cover printable
  ASCII. Confidence: high.
- Example-2 page 3/4 leaks: ancestor shifts (`+76.07pt` pageArea break,
  `+13.49pt` kept field) happen after leaves were checked for boundary
  crossing. `clipSubtree()` then splits `Draw_0054`/`Draw_0062`; line ownership
  uses `inBand || glyphOverlap`, so one line is painted on both pages and
  clipped into slivers. Confidence: high.
- Example-2 page 5/6 list: the 8-row table is not atomic; it splits 5/3 at the
  content-area boundary. Item 7 has a two-line value in a one-line fixed field;
  `layoutLines()` centres the overflow above its box, producing a 7.7pt
  offset and an overlap with items 6/8; the right clip removes the final `f`.
  Confidence: high.
- `textLineRange` is computed from plain flattened text while rendering uses
  styled runs, so ranges can disagree and omit text. Confidence: high.

## Measurements

| Case | Current | Adobe |
| --- | --- | --- |
| Example-3 URL second line | `805ee9e4`, overlaps next field | `e4` only / visually clipped |
| Example-3 `&` glyph | absent | present |
| Example-2 page 3 stray text | y 721–752 | none |
| Example-2 page 4 duplicate line | y 88–104 | y 115–140 |
| Example-2 list rows | 5 on p5, 3 on p6 with overlap | 8 on p6 |
| Item 7 value offset | −7.69pt | 0 |

## Open unknowns

- Adobe's body text is vectorized, so exact line ownership is inferred from
  raster ink, not OCR.
- Unifying all line measurement may shift earlier pages; must re-diff.

## Conclusion

Safe generic fixes: cap growable draw height to an authored one-line box,
treat printable ASCII as covered, shift post-boundary-straddling leaves whole
when they fit, make line ownership exclusive, keep whole tables that fit a
content area, clamp overflowing centred blocks to the box top, and skip
fragmenting nodes that do not actually straddle a band. No fixture strings.
