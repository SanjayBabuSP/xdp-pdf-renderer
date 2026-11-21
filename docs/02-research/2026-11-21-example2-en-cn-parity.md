# Research note — Example-2 EN/CN parity defects

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-example2-en-cn-parity.md`

## Question

Why do the Example-2 fixtures show (1) tofu boxes in the CN variant, (2) dashed/missing
table grid lines in EN, (3) wrong page-boundary handling of numbered item 2, and
(4) missing bold/underline labels with a changed reading order?

## Evidence

- Result PDFs: `test/fixtures/sample-forms/results/Example-2-{EN,CN}.pdf`.
- Adobe references: `test/fixtures/sample-forms/Adobe-generated-results/Example-2-EN.pdf`.
- Inputs: `test/fixtures/sample-forms/Example-2/Example-Datasheet-*.xdp`,
  `Example-Schema.xsd`, `Example-Test-Data.xml`.
- Font assets: `assets/fonts/adobe/AdobeSongStd-Light.otf`, DejaVu TTF fallbacks.
- Third-party source: `@pdf-lib/fontkit@1.1.1`, `pdf-lib` CFF embedders.
- Extraction: PyMuPDF span/drawing/text/bbox extraction; direct CFF byte inspection;
  small pdf-lib/fontkit reproduction under `/tmp/opencode`.
- Code: `font-manager.ts`, `rich-text-parser.ts`, `pdf-renderer.ts`,
  `table-engine.ts`, `apply-pagination.ts`, `types.ts`.

## Findings

- **CJK tofu — high confidence.** `SimSun` resolves to
  `AdobeSongStd-Light.otf`, a CFF/OpenType face. `@pdf-lib/fontkit@1.1.1`
  emits a malformed CFF subset header (`offSize: this.cff.length` instead of
  `this.cff.offSize` in `CFFSubset.encode()`). The `/FontFile3` stream starts
  `01 00 04 15`; `0x15` is invalid as `offSize`. Viewers reject the font and
  draw squares. Replacing byte 3 with a valid 1–4 produces pixel-identical
  output to `subset: false`. Latin spans use standard/TrueType fonts and
  render, which is why only `PY` is visible. Defect site:
  `node_modules/@pdf-lib/fontkit/dist/fontkit.es.js:33041`. Trigger:
  `src/rendering/font-manager.ts:216` `doc.embedFont(..., { subset: true })`.
- **Dashed/missing table lines — high confidence.** No authored dashes exist;
  all strokes are solid 0.6pt in both PDFs. The apparent dashes are geometric
  gaps. `src/domain/layout/table-engine.ts:130` forces a 7mm (19.84pt) row
  pitch while `layoutRow()` gives cells ~17.2–17.9pt height, leaving ~2–2.7pt
  gaps between vertical borders. Adobe segments overlap slightly and look
  continuous. Missing horizontal lines are caused by
  `collapseTinyGapEdges()` (`pdf-renderer.ts:186-255`) pruning a row subform's
  full-width edge because a child edge is coincident and at least as thick,
  even when the child covers only part of the row width; the last column has
  hidden cell borders, so its separator disappears.
- **Numbered-item pagination — high confidence.** The active defect is
  geometric fragmentation in `apply-pagination.ts:63-83,270-300`: a multi-line
  field whose box straddles a page is copied into two fragments with the full
  text and a PDF clip. Our PDF draws item 2's first line and number on both
  pages and shows only ascender slivers of the continuation. Adobe splits at
  line boundaries and does not duplicate the number/first line. The
  `<keep intact="contentArea">` whole-unit shift is not active for this field
  because `allowUnitShift=false` under repeats; naively enabling it would move
  the whole item and still be wrong.
- **Bold labels / faded text / order — high confidence for styles, medium for
  order.** `src/rendering/rich-text-parser.ts:100-104` handles `<p>` by only
  inserting `\n`; it ignores the `<p style>` attribute. XFA stores
  `font-weight:bold`, `text-decoration:underline`, `font-size:12pt` and
  `font-family:'Arial Narrow'` on `<p>` for ~15 labels, so all are rendered at
  10pt regular Helvetica. The three headings that do render bold use a
  different XFA `<font weight="bold">` path. "Faded" text is the combination
  of wrong size/face plus whole-run DejaVu fallback triggered by a single
  non-WinAnsi character (curly quotes / U+2029) in a merged run; all spans are
  black, so color/opacity is not involved. No code reorders children; the
  apparent order change comes from the documented coordinate-bucketing
  paginator plus the changed text metrics above.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| CFF subset header byte 3 | `0x15` | 1–4 | invalid font program |
| Table row pitch (ours) | 19.84pt | ~17.2–18pt | 2–2.7pt gaps |
| Vertical border segments | 4 disjoint runs | 1 continuous run | visible dashes |
| Row separator right edge | stops at x≈438 | reaches x≈539 | ~100pt missing |
| Rich label size/weight | 10pt regular | 12pt bold/underline | wrong style |
| Item 2 at page break | number + line duplicated, continuation clipped | split by line, no duplicate | pagination defect |

## Open unknowns

- Whether Adobe's leading `-` on the continuation is a hyphenation marker or a
  list-continuation prefix; raster crop suggests a continuation dash, but the
  Adobe PDF is vectorized and has no extractable text for that line.
- Whether removing the 7mm floor reintroduces numeric-text clipping; the
  shared-cell-height fix should prevent it, but this must be verified after the
  change.
- How much of the block-order drift resolves automatically once rich-text
  metrics are corrected.

## Conclusion

All four fixes can be generic: patch malformed CFF subset output for every CFF
font; use shared content height for subformSet rows and make edge suppression
coverage-aware; add line-range-aware pagination fragments for multi-line
leaves; and parse paragraph-level CSS in rich text with nested-span overrides.
No fix should key off a fixture name or literal text.
