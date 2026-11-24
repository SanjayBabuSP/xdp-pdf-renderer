# Research note — footer grid, fragment cutoff and NBSP tofu defects

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-footer-fragment-nbsp-defects.md`

## Question

Why does generated Example-3 show doubled/stray footer grid lines, why is the
first continuation line cut off at the top of Example-2-EN page 5, and why do
tofu boxes flank the footer page number in Example-2-EN?

## Evidence

- Source 1: `test/fixtures/sample-forms/results/Example-3.pdf` p2 vs
  `test/fixtures/sample-forms/Adobe-generated-results/Example-3.pdf` p2
  (150dpi pixel rows/columns, drawing segment lists).
- Source 2: `test/fixtures/sample-forms/results/Example-2-EN.pdf` p5 vs
  Adobe p5 (200dpi row profiles; PyMuPDF text bboxes vs rendered pixels).
- Source 3: `test/fixtures/sample-forms/Example-3/Example-Datasheet.xdp`
  `Subform_0123` (line 14294), `Page` (line 14430), `Draw_0073` (line 14295).
- Source 4: `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp`
  `Draw_0062` (line 4935), `Pages` draw (line 1241).
- Source 5: `reference/` Adobe behaviour notes; DejaVu/Arial subset ranges.

## Findings

- Footer grid doubling is an unrotated-height row plus unmerged coincident
  edges: high. `Draw_0073` (`w=4mm h=5.233mm rotate=90`) lays out at h=14.83
  while rendering it 11.34 tall, so the `lr-tb` row is 14.84 vs ~13.1 in
  Adobe and the table bottom (668.4) and outer bottom (671.94) paint as two
  lines 3.5pt apart. Separately the `Page` outer 1.63pt border and the big
  `colSpan=28` field 0.5pt edge share exact endpoints at x≈49.3; the
  per-page dedup keys include thickness, so both paint (extra vertical at
  x≈50.1) while Adobe paints one (single segment at x≈50.2).
- Page-top cutoff is a mid-line split without fragment re-anchoring: high.
  `Draw_0062` (10 rich lines, 14.4pt) straddles the page 3/4 boundary inside
  line 8 (top 2681.1, boundary 2691 in virtual coords). Ownership by
  baseline-minus-descent puts line 8 on page 4, but the renderer paints
  original positions clipped to the band, so the line top (page-local 90.8)
  is cut by the band top (99.0); rendered pixels start at 99. Adobe paints
  the continuation line whole starting at content top (full glyph block at
  oracle y≈102.7).
- Tofu boxes are NBSP emitted as glyph 0: high. The `Pages` footer draw pads
  the page number with U+00A0 spaceruns; the bundled Arial subset lacks
  U+00A0 (`glyphForCodePoint(0xA0) === 0`) while `sanitizeTextForFont`
  preserves all whitespace unconditionally, so the encoder emits `.notdef`.
  Adobe renders the padding as blank space (oracle shows only the digit).

## Measurements

| Case                             | Observed                | Expected               | Delta          |
| -------------------------------- | ----------------------- | ---------------------- | -------------- |
| Example-3 footer row height      | 14.84pt                 | ~13.1pt                | +1.7pt         |
| Example-3 table/outer bottom gap | 3.5pt                   | ~1.8pt                 | +1.7pt         |
| Example-3 x≈50.1 extra vertical  | present                 | absent (oracle single) | 1 stray line   |
| Example-2-EN p5 first line top   | cut at 99.0, drawn 90.8 | whole from ~99         | 8.2pt clipped  |
| Example-2-EN footer `\x005\x00`  | 2 tofu boxes            | blank padding          | 2 stray glyphs |

## Open unknowns

- Whether Adobe centres the shorter table block inside taller `lr-tb` rows
  (adopted top alignment; matches all measured divider positions).
- Exact Adobe rule for coincident different-thickness borders (adopted
  first-painted-wins; render order is outside-in so containers win).

## Conclusion

Three generic fixes: visual-height layout for 90/270-degree rotated draws,
geometry-based first-wins edge dedup across thicknesses, fragment
re-anchoring (first owned line starts at band top, clip extended to last
owned line bottom), and NBSP→space substitution when the font charset is
known to lack the whitespace. Plain-text paths are untouched except for the
shared fragment alignment.
