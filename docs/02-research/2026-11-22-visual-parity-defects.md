# Research note — visual parity defects in sample forms

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-visual-parity-defects.md`

## Question

What generic renderer/layout rules cause the nine visual defects reported in
Example-1, Example-2 and Example-3, and which fixes are safe to apply without
fixture-specific logic?

## Evidence

- Adobe and generated PDFs in `test/fixtures/sample-forms/Adobe-generated-results/`
  and `results/`, measured with PyMuPDF text spans, glyph origins and drawing
  primitives.
- XDP sources in `test/fixtures/sample-forms/Example-{1,2,3}/`.
- `reference/analysis/font-metrics-and-advances.md` — ascent/descent clamp and
  1/1000 pt advance quantization.
- `reference/RENDERING_BEHAVIOR.md:152-188` — border stroke/dash rules.
- Source audit of `src/rendering/pdf-renderer/draw.ts`, `field.ts`, `text.ts`,
  `border-fill.ts`, `subform.ts`, `src/domain/layout/apply-pagination.ts`,
  `src/domain/layout/position-engine.ts`, `src/rendering/rich-text-parser.ts`,
  `src/domain/mapping/resolve-embeds.ts`.

## Findings

- Example-1 `+`: the caption uses `xfa-spacerun` (56 non-breaking spaces) followed
  by an underlined `+`. Adobe places `+` at the natural inline advance after the
  spacer (189.39 pt); ours pins it to the caption reserve edge (215.10 pt),
  +25.71 pt. `captionTrailingSymbol()` discards the spacer width and
  `field.ts` anchors the symbol to `captionStrip - symW`. Confidence: high.
- Example-1 line pitch is already 11.34 pt in both PDFs and is floored by
  `minH="4mm"`; the visible tightness is baseline/glyph-metric skew (ours
  baselines −0.34 to −0.62 pt in the target row, up to −1.8 pt lower down), not
  row pitch. Confidence: high.
- Draw text wrapping is disabled whenever `<ui><textEdit/></ui>` omits
  `multiLine` (`draw.ts:151`). `<textEdit/>` is the default draw UI, so long
  Example-2 paragraphs and table headers are emitted as one over-wide line.
  `clipOverflow` only checks vertical overflow, so horizontal spill is not even
  clipped. Confidence: high.
- `drawValueHeight()` omits node insets, so a 3-line rich draw in a box with
  3 mm top/bottom insets gets only 26.2 pt of usable height and the third line
  is clipped. Confidence: high.
- The spurious bold footnote is caused by `resolve-embeds` consuming the closing
  `</span>` after an embed; `parseRichText` then pops the wrong stack frame and
  `font-weight:bold` leaks into the following paragraph. Confidence: high.
- Example-2 page 2 shows two bullets because explicit `keep intact="contentArea"`
  is ignored inside repeat instances (`apply-pagination.ts:213-215,247-265`);
  `clipSubtree` then splits the row and leaves the first line plus marker on the
  earlier page. Confidence: high.
- Example-3 page-2 border duplicates come from per-cell edge emission and
  `collapseTinyGapEdges()` suppressing parent edges based only on x-extent. It
  does not exclude invisible children or require the child edge to be on the
  same y. Thin section rules are dropped or split by `clipSubtree` when their
  box is ≤1 pt high. Confidence: medium-high.
- Arial regular is metrically identical to Helvetica (0 advance-width
  differences), so the horizontal overflow defects are not font metric drift.

## Measurements

| Case | Observed | Adobe | Delta |
| --- | --- | --- | --- |
| Example-1 `+` x | 215.10 pt | 189.39 pt | +25.71 pt |
| Example-1 row pitch | 11.34 pt | 11.34 pt | 0 |
| Example-2 `Fdls offqt …` span right | 595.1 pt | ≈520 pt | +75 pt |
| Example-2 header `Zgful Opugtirc` span width | 287.9 pt | cell 141 pt | +147 pt |
| Example-2 footnote density | 0.308 (bold) | 0.200 (regular) | wrong weight |
| Example-3 footer span right | 596.3 pt | 529.6 pt | +66.7 pt |
| Example-3 thin rules | stroked, some dropped | filled bars | representation/split |

## Open unknowns

- The supplied screenshots are crops; exact pixel origins are unavailable, so
  PDF coordinates are used as the authority.
- Adobe's print-to-PDF encodes thick borders as filled bars while ours uses
  strokes; visible centre-line parity is the target, not operator identity.

## Conclusion

Safe generic fixes: wrap draw text to authored width when the box can fit at
least two lines, add horizontal clipping as a safety net, include insets in
draw height, compute trailing-symbol position from the actual spacer advance,
fix rich-text tag balancing, honour explicit `keep` inside repeats, make edge
suppression presence/y-aware, de-duplicate coincident emitted edges, and keep
thin rules atomic through pagination. All are derived from XFA/CSS semantics,
not fixture strings.
