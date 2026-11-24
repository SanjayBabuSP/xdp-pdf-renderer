# Research note — Adobe style parity gaps in sample forms

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-adobe-style-parity-gaps.md`

## Question

Which concrete style/formatting differences between the Adobe-generated and
current sample-form PDFs can be fixed generically, and does `quorbe/xfa.js`
provide useful logic for those fixes?

## Evidence

- `quorbe/xfa.js` clone at `/tmp/opencode/xfa.js` (README, `src/parser`,
  `src/renderer/viewer`, `docs/`). Its visual viewer maps XFA flow containers to
  CSS, but has no implementation for `hAlign`/`vAlign`, paragraph indentation,
  font weight/posture resolution, or picture formatting. Its own
  `docs/writer.md:85-86` explicitly declines picture reformatting. The only
  reusable ideas are an empty-draw-as-hairline heuristic and checkbox truthiness
  aliases; both are low impact here.
- Adobe oracle PDFs in
  `test/fixtures/sample-forms/Adobe-generated-results/` versus current
  `test/fixtures/sample-forms/results/`. Page counts match for all four forms
  that have an oracle. `Example-2-CN` has no oracle.
- PyMuPDF text/glyph geometry, pdf-lib content-stream inspection and raster
  comparison. Key observations:
  - Example-1: two fields render `200.00` where Adobe renders `200`. The XDP
    fields carry `bind/picture = num{zzzzzzz9.zzz}` and
    `format/picture = num{zzzzzzz9.zz}`; data value is the string `"200"`.
  - Example-3: Adobe retains double spaces in
    `Ktprfjeo ... bfbsjupp  jd ...` and `Fdls offqt wjli  np rpgqs`; the current
    PDF has single spaces.
  - Example-2 EN/ESP: section and item page breaks differ; Adobe keeps a whole
    heading+items block on page 6 while ours splits it across pages 5/6.
  - Border stroke geometry differs on all forms, including extra full-box
    strokes and shifted table headers; this is a layout-level divergence.
  - Font families differ: Adobe embeds Arial/Arial Narrow subsets; the library
    falls back to Helvetica/DejaVu because Arial files are not bundled.
  - Example-3 contains literal `ξ`/`Ξ` characters in the XDP/XML that Adobe
    omits; the library's DejaVu fallback renders them.
- `src/lib/value-format.ts:263-284` always emits a decimal separator and
  fractional digits whenever a numeric picture has any fractional placeholder,
  even when every fractional placeholder is optional (`z`) and the value has no
  fractional part.
- `src/rendering/pdf-renderer/draw.ts:88` passed plain `<text>` draw values
  through `stripHtml()`, whose `replace(/\s+/g, ' ')` at
  `src/rendering/pdf-renderer/helpers.ts:47-51` collapsed internal double spaces.
  The fix introduces `stripHtmlTags()` for this path: it removes markup but
  leaves whitespace untouched.
- `test/unit/lib/value-format.test.ts:59-71` shows mandatory `0`/`9`
  placeholders must keep `.00`; the fix must therefore be limited to optional
  placeholders.

## Findings

- The `200.00` defect is a generic optional-placeholder bug in
  `renderNumberTemplate`; confidence: high.
- The double-space defect is a generic layering bug: HTML stripping is being
  applied to plain XFA text; confidence: high.
- `xfa.js` does not provide a better approach for the four most visible gaps
  (alignment, paragraph spacing, fonts, picture formatting); confidence: high.
- Pagination, border geometry, font substitution and omitted non-WinAnsi glyphs
  are real but broader layout/font-engine gaps that need dedicated spikes;
  confidence: high.
- Empty-draw hairlines and checkbox value aliases from `xfa.js` are not
  evidenced as defects in these fixtures, so porting them now would add risk
  without measured benefit; confidence: medium.

## Measurements

| Case | Adobe | Current | Delta |
| --- | --- | --- | --- |
| Example-1 numeric field | `200` | `200.00` | 2 forced decimal digits |
| Example-3 double space | two U+0020 chars | one U+0020 char | 1 space lost |
| Example-2 EN section split | heading+items on p6 | heading on p5, item 8 on p6 | page-break mismatch |
| Example-1 outer stroke x-range | 18.8–574.9 | 19.0–574.6 | ~0.2–0.3pt |
| Example-3 extra Greek glyphs | absent | `ξ`/`Ξ` present | glyph substitution difference |

## Open unknowns

- Whether omitting a decimal separator for all-zero optional fractional
  placeholders matches Adobe for negative/zero values in other fixtures.
  Explicit regression tests and the full suite will bound this.
- Whether preserving all internal whitespace in plain draws affects wrapping in
  other forms; line-breaker already tracks whitespace tokens, so the full suite
  should reveal regressions.
- A faithful fix for pagination and border geometry requires the missing
  `xfalayout.dll` behaviour; it is out of scope here.

## Conclusion

Implement two safe generic fixes: omit optional fractional placeholders when
their digits are all zero, and stop HTML-stripping plain `<text>` draw values.
Defer pagination, border geometry, font substitution and glyph omission to
dedicated research because they are either layout-engine-scale changes or
dependent on missing Arial/Adobe font assets. No `xfa.js` code is copied; its
review confirmed the current implementation is ahead on the relevant semantics.
