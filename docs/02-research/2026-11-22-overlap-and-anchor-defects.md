# Research note — hidden Example-2 text and Example-3 border defects

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-overlap-and-anchor-defects.md`

## Question

Why does generated Example-2-EN.pdf overlap the bold `Neijcurx flmgz:` line with
the following `Ssriworga qeijcurx ...:` line, and why does generated
Example-3.pdf draw a vertical rule at x≈337pt (y 440–533) that the Adobe
reference omits while placing the same rule at y≈348–440?

## Evidence

- Source 1: `test/fixtures/sample-forms/results/Example-2-EN.pdf` page 3 vs
  `test/fixtures/sample-forms/Adobe-generated-results/Example-2-EN.pdf` page 3
  (100dpi horizontal-projection bands; PyMuPDF text bboxes).
- Source 2: `test/fixtures/sample-forms/results/Example-3.pdf` page 1 vs
  `test/fixtures/sample-forms/Adobe-generated-results/Example-3.pdf` page 1
  (pixel-diff clusters, 200dpi column darkness at x 335–339).
- Source 3: `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp`
  `Draw_0040` (line 4355) and `Draw_0041` (line 4368).
- Source 4: `test/fixtures/sample-forms/Example-3/Example-Datasheet.xdp`
  `R310` (line 3405), `R360` (line 3855), `Subform_0093` (line 4382).

## Findings

- Draw overlap is a line-advance fallback error, not a growth/clipping error:
  high. `Draw_0040` holds two rich-text paragraphs; the first `<p>` has no CSS
  `line-height`, the second has `line-height:22.5pt`, and the draw `<para>`
  sets `lineHeight="30pt"`. `resolveAdvance` (`src/rendering/text/run-flow.ts`)
  uses the first authored CSS advance on a line and falls back to
  `paragraph.lineAdvance`, which both layout
  (`src/domain/layout/position-engine.ts`) and rendering
  (`src/rendering/pdf-renderer/text.ts`) seed from `<para>` (30pt). Measured
  pitch in our PDF is 30.1pt (bold line y0 634.4 after first line y0 604.3);
  the Adobe band for the same two lines spans 596.3–629.6pt (33.3pt), i.e. a
  ~20–22pt pitch consistent with the CSS 22.5pt advance and a font-derived
  default for the unstyled paragraph. Adobe therefore ignores `<para>`
  `lineHeight` for rich-text values; our 30pt pitch overflows the authored
  16.018mm box so the next flow draw starts 8.2pt below the bold line.
- Stray Example-3 vertical is an unhandled `anchorType`, not a dedup failure:
  high. `R310` is the only positioned object with `anchorType="bottomRight"`;
  the parser drops the attribute and layout treats x/y as top-left, drawing
  the 0.38×32.632mm bar at y 440.1–532.6. Column darkness at x 337.5 is 0.992
  in ours vs 0.015 in Adobe for y 440–533, while Adobe is dark (0.658) at the
  same x for y 348–440 — exactly the bottom-right-anchored span
  (y 155.23mm − h 32.632mm = 122.6mm ≈ 347.6pt to 440.1pt). `R360` carries the
  same hidden 5.08mm corner but is drawn by both engines, ruling the corner
  out. `anchorType` occurs 7 times in fixtures (`bottomRight` once,
  `middleCenter` on flow-layout tables without x/y); no source file reads it.
- Coincident-edge dedup is not the culprit for the reported grid: medium.
  Direct rect comparison is invalid because Adobe merges the grid into
  compound fill paths, but pixel rows/columns agree for every other rule in
  the y 400–600 band (e.g. R380 at y≈420 present in both; doublet partners at
  y 441.3/649.2 present in both). Remaining diff clusters are single-row
  anti-aliasing edges from sub-point y offsets, not missing geometry.

## Measurements

| Case                               | Observed        | Expected           | Delta          |
| ---------------------------------- | --------------- | ------------------ | -------------- |
| Example-2 bold→next-line pitch     | 8.2pt (overlap) | ~22pt (Adobe band) | −14pt          |
| Example-2 two-line block height    | 46.6pt          | 33.3pt             | +13.3pt        |
| Example-3 x337.5 y440–533 darkness | 0.992           | 0.015              | extra rule     |
| Example-3 x337.0 y348–440 darkness | 0.047           | 0.658              | rule misplaced |

## Open unknowns

- Whether Adobe ever applies `<para>` lineHeight to rich-text lines that lack
  CSS (no fixture evidence; pitched entirely from CSS/default here).
- Whether `middleCenter` should horizontally centre flow-layout tables (left
  unchanged: no x/y and no visible defect).

## Conclusion

Both defects have generic fixes: rich-text line layout must fall back to the
font-derived default advance instead of `<para>` lineHeight, and positioned
layout must honour `anchorType` when converting authored x/y to the top-left
corner. Neither fix touches plain-text layout, flow layout, or border dedup.
