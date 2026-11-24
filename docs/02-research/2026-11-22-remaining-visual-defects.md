# Research note — remaining visual parity defects

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-remaining-visual-defects.md`

## Question

Why do four reported defects remain: Example-3 duplicated bottom-table borders,
Example-2 wrong bold/alignment in the `Ruvlviqd Rjcfqtk:` table, Example-2
overlapping lines and large gaps, and the Example-2 `V-7 YB` page-break gap?

## Evidence

- PyMuPDF measurements of
  `test/fixtures/sample-forms/results/*.pdf` versus
  `test/fixtures/sample-forms/Adobe-generated-results/*.pdf`.
- XDP: `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp:4020-4280,4862-5028,5612-5682`
  and `test/fixtures/sample-forms/Example-3/Example-Datasheet.xdp:14229-14450`.
- Source: `src/rendering/pdf-renderer/border-fill.ts`, `standard-fonts.ts`,
  `text.ts`, `src/domain/layout/position-engine.ts`, `apply-pagination.ts`.

## Findings

- Example-3 duplicates are exactly coincident 1.68 pt subform borders. The
  per-page dedup added earlier only guards `drawEdge()`; uniform boxes take the
  separate `strokeUniformRect()` path, which emits raw `re`/`S` without checking
  the set. Six duplicate full-width strokes remain on page 2. Confidence: high.
- Example-2 `Ruvlviqd Rjcfqtk:` and its table headers are authored
  `weight="bold"`. Adobe renders them bold (ink ratio 0.50–0.57 vs 0.379 for
  regular body text). Our recent blanket `!narrow && isBoldWeight()` rule maps
  every Arial Narrow bold request to regular Helvetica, shortening runs by up to
  7.8 pt and breaking apparent alignment. The earlier spurious-bold footnote
  was a separate tag-balance bug, already fixed; the narrow suppression was a
  misdiagnosis. Confidence: high.
- Example-2 overlapping/gaps: rich draws declare CSS `font-size:12pt` but no
  XDP `<font size>`, so layout/rendering fall back to 10 pt and use 12 pt line
  advance instead of Adobe's 14.4 pt. The authored fixed box heights stay the
  same, leaving ~119 pt of unused space per page. Confidence: high.
- The overlap at page 5 is a pagination-fragment anchoring bug: a clipped rich
  fragment places line index 3 using the fragment's 23.9 pt box rather than the
  original 66.5 pt box, displacing it +42.5 pt onto the next line.
  Confidence: high.
- The `V-7 YB` gap is caused by recursive `hasExplicitKeep()`: every ancestor
  of a kept leaf is treated as atomic and independently pushed to the page top,
  compounding ~270 pt of shift. Keep must apply only to the node that declares
  it. Confidence: high.

## Measurements

| Case | Current | Adobe |
| --- | --- | --- |
| Example-3 duplicate 1.68 pt strokes (p2) | 6 groups | 0 |
| `Ruvlviqd Rjcfqtk:` width | 83.1 pt, regular | 90.2 pt, bold |
| `Hqvxtibtjhe` width | 55.2 pt | 63.0 pt |
| Example-2 rich line pitch | 12.0 pt | ~14.4 pt |
| Example-2 unused space per 7 boxes | ~119 pt | ~40 pt |
| Fragment line displacement | +42.5 pt | 0 |
| `V-7 YB` block | page 3, y≈309 | page 2, y≈704 |

## Open unknowns

- Mixed-size spacer paragraphs: use the largest run size in a paragraph unless
  an explicit `line-height` is authored; this needs full fixture re-diff.
- Adobe thick borders are filled inward; ours are centred strokes. Centre-line
  parity is the achievable target.

## Conclusion

Safe generic fixes: apply the existing per-page edge dedup to uniform rectangle
strokes; honour bold for every family and keep the condensed `Tz` scale
separate; derive rich-text default line advance from the actual run font size;
anchor clipped fragment lines to the original box; and restrict explicit keep
to the declaring node. No fixture strings or constants are needed.
