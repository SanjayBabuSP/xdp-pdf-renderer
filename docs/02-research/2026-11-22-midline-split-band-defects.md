# Research note — mid-line page split overlap on Example-2 page 5

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-midline-split-band-defects.md`

## Question

Why does generated Example-2-EN.pdf page 5 (index 4) show overlapping text
(`Qrepf sonyhjjqriue:` jammed into the `bfbsjupp...`/`n XQ.` lines) and a
cut-off first line, while the Adobe reference shows cleanly separated lines?

## Evidence

- Source 1: `test/fixtures/sample-forms/results/Example-2-EN.pdf` p5 vs
  `test/fixtures/sample-forms/Adobe-generated-results/Example-2-EN.pdf` p5
  (200dpi/150dpi ink profiles, PyMuPDF bboxes, content-stream Tm baselines).
- Source 2: `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp`
  `Draw_0061` (line 4939, `h="43mm"`, three rich-text paragraphs).
- Source 3: layout debug via the full pipeline (parse/bind/expand/scripts/
  embeds/conditions/table/positions/paginate): page-4 fragment
  `pos.y=99.0 h=45.1 range={start:5,end:10}` with the following draw at y=144.1.
- Source 4: pre-fix staged PDF showing the same overlap (user screenshot matches).

## Findings

- The page break falls mid-line, not between lines: high. Draw_0061's block
  is 144pt (10 rich lines at 14.4pt); the virtual grid cuts it 76.8pt into
  page 3 and 45.1pt into page 4. Page 4 owns lines 5-9 (72pt of content in a
  45.1pt band) because ownership is decided by baseline-minus-descent
  crossing the boundary, and line 5 straddles it (top 4.8pt above the band).
- The band is too short for its owned lines: high. `clipSubtree` sizes the
  fragment band by virtual slicing (`min(y1,bottom)-max(y0,top)`), ignoring
  that owned lines extend past both edges. The renderer then either clips
  glyph tops (band too short at the top — the reported cutoff) or, after
  re-anchoring, paints into the next draw (the reported overlap).
- The following draw starts at the band bottom: high. Draw_0062 sits at
  y=144.1 with no gap for owned lines that extend past the 45.1pt band, so any
  re-anchored lines collide with its header.
- No nested overflow beyond the extended band: medium. The extending draw is
  a leaf; recursive content-end scans show page 4's remaining content fits
  after the extension, so no tail moves are required in this fixture.

## Measurements

| Case                                        | Observed              | Expected     | Delta   |
| ------------------------------------------- | --------------------- | ------------ | ------- |
| Example-2 p5 owned lines vs band            | 5 lines / 45.1pt band | 72pt content | −26.9pt |
| Example-2 p5 line-8 bottom vs Draw_0062 top | overlap ~4pt          | gap ≥ 0      | overlap |
| Example-2 p5 first line top vs band top     | cut ~8pt              | flush        | cut off |
| Oracle p5 equivalents                       | full lines, separated | same         | —       |

## Open unknowns

- Whether Adobe snaps page breaks to line boundaries or reflows greedily;
  adopted the minimal band-extension + sibling-shift that reproduces Adobe's
  visible result (whole lines, no overlap) without full reflow.
- Rich vs flattened advance parity inside ownership (both 14.4pt here);
  `drawValueHeight` and `leafLineBaselines` agree on this fixture.

## Conclusion

Pagination must grow a mid-line fragment's band to its owned block height and
shift following siblings down; when the page has no room, trailing whole
nodes move to the next page. Both are generic layout rules driven by measured
owned geometry, not fixture-specific constants.
