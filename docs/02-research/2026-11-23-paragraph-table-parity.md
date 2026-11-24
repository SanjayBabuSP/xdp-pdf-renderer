# Research note — paragraph spacing and table render vs Adobe (Example-2-EN)

- Date: 2026-11-23
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-23-paragraph-table-parity.md`

## Question

Why do Example-2-EN `/results` differ from `Adobe-generated-results` in (1) paragraph line/pitch spacing
(Field_0149 block, Draw_0040/Draw_0041 rich block) and (2) the data table (row-label cells clipped to one
line, rows visually gapped)?

## Evidence

- `test/fixtures/sample-forms/results/Example-2-EN.pdf` p2/p3 vs
  `test/fixtures/sample-forms/Adobe-generated-results/Example-2-EN.pdf` p2/p3 (vector glyph boxes via
  `get_drawings`, glyph-top precision ~0.1pt).
- XDP: `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp` (Field_0149, Draw_0040, Draw_0041,
  Subform_0092 table, row-label text with U+2028 at line 4485).
- Data: `test/fixtures/sample-forms/Example-2/Example-Test-Data.xml` (Field_0149 values, Element_2662 values).
- Layout dump of Subform_0092 via `parseXdp` + `applyTableLayouts` + `calculatePositions`
  (data row h=29.10, all cells clamped at minH 10.16mm=28.8).
- `layoutRunLines`/`layoutRunBaselines` scratch run on Draw_0010 body (advances correct, 7.2).

## Findings

- U+2028 is not a line break in `breakLinesInfo` (splits only on `\r\n|\r|\n`): high. The row-label source
  `Wqxuhgiyni\u2028Bbpiy` is treated as spaces, renders one clipped line; Adobe breaks it into two lines.
- `draw.ts` disables wrapping (`singleLine ? Infinity`) when the inner box fits fewer than two lines, so the
  renderer draws one clipped line even though layout wrapped the same text to two lines: high. Adobe renders
  both wrapped lines inside the minH 28.8 row.
- Repeated single-line field instances use 1.2em content (14.4 at 12pt + 5.67 margins = 20.07 pitch) while
  Adobe uses 17.67 = 12.0 + 5.67, i.e. a 1.2x default applied to the 10pt parent context, not the own 12pt:
  high. Element_2662 block corroborates (Adobe pitch 19.84 = minH 7mm, only possible if content < 19.84).
- Table row-label pitch is 14.4 for 11pt text (cap-top deltas 627.4 -> 641.8, 656.2 -> 670.4): high. No 12pt
  ancestor exists, so this datum is unexplained; draws keep the own-size 1.2 default (13.2, within ~1pt).
- `layoutRunBaselines` advances by the previous line (`baselines[i-1] - lines[i-1].advance`) while Adobe gaps
  by the current line: Kjehye->bold 14.5 vs 22.4 (bold CSS line-height 22.5), totals 38.2 vs 38.3: high.
- With pre-advance, bold->Ssri becomes R + 1.42 + F where the authored-fixed Draw_0040 box absorbs the shift
  (gap 23.9 -> 15.8, Adobe 15.8): high. No CSS-ignoring rule is needed for positioning.
- First-line offsets cancel out of every inter-box gap (ascent-based in both plain and rich paths): high.
  Implementation keeps the current first-offset convention.
- Draw_0010 "joined lines" alarm was a false positive: it lives in hidden `FooterText`; the rendered single
  line is the data-bound Element_2647 field: high.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Field_0149 pitch (12pt, 1mm margins) | 20.07 | 17.67 | +2.40/line |
| Element_2662 pitch (12pt, minH 7mm) | 20.06 | 19.84 (minH) | content must be < 19.84 |
| Kjehye -> bold gap (Draw_0040) | 14.5 | 22.4 (CSS 22.5) | -7.9 |
| bold -> Ssri gap (Draw_0041) | 23.8 | 15.8 | +8.0 |
| Kjehye -> Ssri total span | 38.3 | 38.2 | +0.1 (redistribution only) |
| Row-label lines (U+2028 / wrap) | 1 clipped | 2 | truncation |
| Data row height | 29.10 | 28.8 (minH) | +0.3 |
| Table label pitch, 11pt text | 13.2 (own 1.2em) | 14.4 | -1.2 (accepted residual) |

## Open unknowns

- What produces exactly 14.4 pitch for 11pt table-label text (no 12pt ancestor; not own 1.2em). Left as a
  ~1pt residual; row geometry is minH-clamped either way so the visible defect (clipping) is fixed regardless.
- Whether table rows should ever grow from wrapped content (Adobe row = minH here). Untouched by this change.

## Conclusion

Safe to implement generically: U+2028/U+2029 forced breaks; draw renderer always wrapping to the content
width; rich inter-line gap from the current line (pre-advance); field default lineHeight from the
parent-context font size. Draws keep the own-size default. Table row heights and the `oneLineBox` clamp stay
as-is.
