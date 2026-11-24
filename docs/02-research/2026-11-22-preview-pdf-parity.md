# Research note — Adobe Preview PDF parity gaps

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-preview-pdf-parity.md`

## Question

Which generic XFA/LiveCycle rules can close the remaining Adobe vs generated
PDF differences (pagination, borders, style, alignment, Arial, Greek glyphs,
URL wrapping and spacer height) without encoding sample-form-specific logic?

## Evidence

- `test/fixtures/sample-forms/Adobe-generated-results/*.pdf` vs
  `test/fixtures/sample-forms/results/*.pdf`: page/text/stroke/font measurements
  using PyMuPDF.
- `test/fixtures/sample-forms/Example-1/Example-Datasheet.xdp:31697-31734`:
  caption `<para marginLeft="17.008pt">`, ignored by the caption renderer.
- `test/fixtures/sample-forms/Example-2/Example-Datasheet-EN.xdp:5171,5633`:
  table and grid blocks that reflow to the wrong page.
- `test/fixtures/sample-forms/Example-3/Example-Datasheet.xdp:1961-1963,10712-11541`:
  URL clipping and literal Greek `Ξ`/`ξ` that Adobe omits.
- `reference/README.md:386-423`,
  `reference/Adobe-LiveCycle-Designer-11.0/conversation/preview_pdf_analysis.md:149-186`:
  F5 Preview PDF pipeline (`Designer.xci` → XFA layout → PDFL) and author-order
  flow rules.
- `reference/RENDERING_BEHAVIOR.md:152-188`: border dash patterns, stroke
  multiplier 1, cap/join enum, edge draw order and corner clamp.
- `reference/Adobe-LiveCycle-Designer-11.0/config_files/Designer.xci:9-40,49-79`:
  exact Helvetica→Arial equate rules (`force="0"`).
- `reference/analysis/font-metrics-and-advances.md:248-315`: 1/1000 pt advance
  quantization and ±1.75 nudge.
- Extracted font programs from the supplied oracle PDFs: `Arial`, `Arial Bold`
  and `Arial Italic` are embedded as CIDFont Type0; subsetting them without
  hinting yields 10.7 KB / 7.3 KB / 4.5 KB for Latin-1 coverage.
- Source audit: `src/domain/layout/`, `src/rendering/pdf-renderer/`,
  `src/rendering/text/`, `src/rendering/font-manager.ts`,
  `src/rendering/standard-fonts.ts` and existing unit tests.

## Findings

- Adobe and generated PDFs have matching page counts: 1/6/6/2 for the four
  oracle forms. `Example-2-CN` has no oracle. Confidence: high.
- Example-1 has three captions shifted 17.1 pt left because caption `<para>`
  margins are not parsed or applied. This is a generic XFA rule gap. Confidence:
  high.
- Example-3 page 1 drifts upward about 0.23 pt per table row; Example-2 page 5
  contains rows that Adobe keeps on page 6. The current layout post-pass
  (`calculate-positions` then `apply-pagination`) never re-measures content in
  the destination content area and conflates break targets. Confidence: high.
- Border strokes have three different width domains: authored 0.5 pt, a
  sample-derived 0.1778 mm row-height constant, and a device-grid round-up to
  0.12 pt. `collapseTinyGapEdges` also deletes edges using fixed 3 pt
  tolerances. Confidence: high.
- Arial requests resolve to base-14 Helvetica because `DEFAULT_FONTS` points at
  nonexistent files and `hasFontFor()` counts the alias as availability.
  Confidence: high.
- A single non-WinAnsi character promotes an entire run to DejaVu; Adobe instead
  omits unmappable glyphs such as `Ξ`. Coverage must be decided per glyph
  against the resolved PDF font. Confidence: high.
- URL wrapping uses different break rules in `line-breaker.ts` and
  `run-flow.ts`; a slash break is only attempted when the line already has
  text. Confidence: high.
- Spacer-only rich-text paragraphs are counted as full base-size lines because
  `xfa-spacerun` becomes a visible NBSP word and per-paragraph CSS
  `line-height`/`margin-top` is dropped. Confidence: medium (CSS semantics are
  clear; exact Adobe height still needs oracle validation).
- Preview PDF is layout/rendering, not a screenshot; supplied `Designer.xci`
  equates and `adobepdf.xdc` stroke tables are the correct generic sources.
  Confidence: high.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Example-1 caption `BPCIRN FHS BSPL` x | 26.1 pt | 43.2 pt | −17.1 pt |
| Example-1 196 stroke widths | 159×0.6, 35×0.36, 2×0.24 | same | 0 |
| Example-1 row pitch | 9.5 pt | 9.24 pt | +0.26 pt/row |
| Example-2 EN black table y (page 0) | 384.7–419.8 | 395.2–430.6 | −10.5 pt |
| Example-2 EN page 5/6 rows | 7 + 1 | 0 + 8 | wrong page split |
| Example-2 EN page-3 rule y | 121.99 pt | 109.3 / 157.6 pt | +12.7 / −35.6 |
| Example-3 page-1 text span cluster | −3.2 pt | 0 | −3.2 pt |
| Example-3 URL `805ee9e4` | renders `805ee9e` | `805ee9` | +1 char |
| Example-3 `ΞF mqx` | `ΞF mqx` | `F mqx` | extra glyph |

## Open unknowns

- Arial BoldItalic and Arial Narrow metric assets are not present in the
  supplied reference; bolditalic will reuse the italic subset and narrow will
  keep the existing condensation factor.
- Exact Adobe spacer height and `line-height:%` handling have no published
  oracle; the fix uses the authored CSS value where available.
- The Adobe oracle is a print-to-PDF, so borders are encoded as thin filled
  rectangles while ours uses strokes; visual centre-line equivalence is the
  practical target, not byte-identical operators.

## Conclusion

It is safe to implement generic rules from the XDP model and reference tables:
one effective stroke-width authority, caption `<para>`, per-glyph font coverage,
Arial equate data with real subset assets, shared break opportunities, and
CSS-aware rich-text vertical metrics. Full byte-for-byte PDF identity is not a
valid target because the oracle was produced by a different PDF producer; the
achievable target is matching geometry, style, alignment, page attribution and
visible glyph set.
