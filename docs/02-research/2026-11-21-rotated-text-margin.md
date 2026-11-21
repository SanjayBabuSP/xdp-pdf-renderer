# Research note — rotated text margin axis

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-rotated-text-margin.md`

## Question

Why are vertical (rotate=90) label baselines ~2–3pt above the Adobe output,
while the gray label boxes themselves are in the correct position?

## Evidence

- `reference/RENDERING_BEHAVIOR.md` §7: for authored `rotate=90`, `x/y` describe
  the unrotated box; visual footprint is `x..x+h` by `y-w..y`. Flow-positioned
  rotated draws receive a visual-top `y`.
- `src/rendering/pdf-renderer.ts` vertical branch computes
  `rotatedY = flipY(pos.y, width, pageH) + margins.bottom`.
- `src/rendering/pdf-renderer.ts` already applies `margins.left` to `x` and
  subtracts top/bottom margins from the short-axis `height`.
- Raster cross-correlation of the Example-3 page-2 `Odaavg` strip
  (PDF x 49–70, y 429–487) gives the lowest pixel difference when the library
  crop is shifted down by 6–7 px at 3x = 2.0–2.3pt.

## Findings

- High confidence: for a rotated box, left/right margins lie along the rotated
  text's vertical axis and top/bottom margins lie across its horizontal axis.
  Adding `margins.bottom` to `rotatedY` is an axis error and shifts every
  rotated label up by one bottom margin (~2.835pt for 1mm insets).
- High confidence: the gray label rectangles are already at the correct
  coordinates in both PDFs (x 49.3–64.2), so the box geometry is not at fault.
- Medium confidence: the same error explains wrapped-label differences
  (e.g. `Anqzjrjknrion` / `c`) because the available vertical extent used by
  `wrapText` is offset by the same margin.

## Open unknowns

- Whether Adobe also excludes left/right insets from the wrap width for
  rotated draws; not measured here.

## Conclusion

Replace `margins.bottom` with `-margins.top` in the rotated text anchor.
Left/right insets already affect the wrap width and `x`; top/bottom insets
affect the short axis. The vertical axis must be inset by `topInset`, not
`bottomInset`. Raster measurement: after the fix the `Odaavg` glyph offset
relative to its gray strip matches Adobe (17.8pt).
