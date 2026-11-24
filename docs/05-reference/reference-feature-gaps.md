# Reference feature gaps — Adobe LiveCycle Designer 11.0 to xdp-pdf-renderer

- Date: 2026-11-24
- Author: opencode
- Status: verified by static inspection; measurements dated 2026-11-24
- Source: `reference/` (Designer 11.0 install copy, Ghidra decompilations,
  configs, fonts, barcode tables, script templates, locale data)
- Companion: [`adobe-parity-assessment.md`](adobe-parity-assessment.md)

## 1. Scope and method

This document inventories the capabilities evidenced by the `reference/` folder
and maps each one to the current implementation under `src/`. It answers three
questions per capability:

1. What does the reference pipeline do?
2. What does this library do today?
3. Why is closing the difference hard?

Evidence sources:

- `reference/README.md`, `reference/RENDERING_BEHAVIOR.md` and
  `reference/analysis/font-metrics-and-advances.md`.
- `reference/decompiled/*_disasm.c` (117 Ghidra output files) and
  `reference/analysis_exports.json` for symbol-level evidence.
- `reference/Adobe-LiveCycle-Designer-11.0/` for shipped configs, fonts,
  barcode engines, script templates, ICU libraries and converters.
- `src/` plus `src/config/supported-features.json` for implementation status.
- Rendered sample forms in `test/fixtures/sample-forms/results/` and the
  Adobe-generated PDFs in `test/fixtures/sample-forms/Adobe-generated-results/`.

Method: static code reading plus read-only PDF measurements. A capability is
marked `implemented` only when a code path is wired end to end and exercised by
the current test suite or sample forms. A capability is `partial` when it works
for a subset, is approximated, or disagrees between layout and paint. A
capability is `missing` when no production path exists. `Out of scope` means the
reference feature belongs to authoring, conversion or non-PDF output and does
not affect the static PDF rendering target.

This is not an Adobe specification. It records what the decompiled behaviour and
the current implementation support, with confidence noted where the evidence is
indirect.

## 2. Status legend

| Status       | Meaning                                                   |
| ------------ | --------------------------------------------------------- |
| Implemented  | Wired end to end; covered by tests or sample forms.       |
| Partial      | Subset, approximation, or layout/paint disagreement.      |
| Missing      | No production code path.                                  |
| Out of scope | Reference feature that does not affect static PDF output. |
| Unknown      | Not enough evidence to classify.                          |

Confidence: **High** means directly evidenced in source, decompilation or an
observable PDF; **Medium** means inferred from code paths or a small number of
fixtures; **Low** means a single observation or an unverified hypothesis.

## 3. Executive summary

The library is a credible static renderer for the common Designer form
workflow: absolute and flow layout, tables, repeats, borders, images, basic
rich text, FormCalc and JavaScript calculation, and a substantial PDF
post-processing API. It is not a port of the Designer XFA runtime.

The largest visible-impact gaps are:

| Priority | Gap                                               | Why it matters                                                                                                |
| -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1        | Per-glyph font fallback and complete font assets  | Missing glyphs are dropped, and Arial bold/italic/narrow are substituted rather than matched.                 |
| 2        | Pagination and reflow fidelity                    | Pagination is coordinate bucketing, not `contentBlockToPage`; page attribution can differ by a row or a line. |
| 3        | Layout measurement for non-base-14 fonts          | Layout measures many families as `0.5 em` while paint uses the real font, so wrapping and alignment disagree. |
| 4        | Overflow leader/follower and table continuation   | Multi-page table headers and continuation fields are not modelled.                                            |
| 5        | Bidi, vertical writing, hyphenation and tab stops | Line order and line breaks differ for RTL, CJK and typographic forms.                                         |
| 6        | 2-D and GS1 barcodes                              | QR, DataMatrix, Aztec, RSS/GS1 and 4-state postal names silently fall back to Code 39.                        |
| 7        | Image codecs                                      | GIF is a solid-colour stub, TIFF is uncompressed-only, and JPX/PDF/CMYK images disappear.                     |
| 8        | Scripting host surface                            | Many FormCalc and Acrobat-host APIs are stubs, and post-layout scripts do not trigger reflow.                 |
| 9        | PDF interactivity and accessibility               | AcroForm actions, radio groups, signatures, tagged-PDF MCIDs and layers are absent or nominal.                |
| 10       | Graphics and colour management                    | Patterns, blend modes, soft masks, CMYK and ICC output intents are not implemented.                           |
| 11       | Rich text and typography                          | Strikeout, small caps, super/subscript and general CSS are ignored.                                           |
| 12       | Data sources and full schema support              | ADO/ODBC, SOAP/WSDL, file import, data windows and most of XSD/XPath are absent.                              |

Already implemented and easy to misreport as missing:

- presence semantics for `visible`, `invisible`, `hidden` and `inactive`;
- the 1.2 line-advance default;
- the ascent clamp `max(A, 1 - D)`;
- 1/1000 pt advance quantization;
- rotation, including the 90-degree anchor normalization;
- BMP embedding for 24/32-bit uncompressed files;
- PDF417 encoding;
- line-range page splitting and the recent straddling-table move-whole rule;
- CFF subset header patching.

## 4. Reference pipeline versus this library

The reference Preview PDF path is a live Windows pipeline:

```text
FormDesigner.exe (F5)
  -> Designer.xci / Designer.xdc
  -> xfa.dll orchestrates xfatemplate / xfadata / xfalayout
  -> xfascripthandler runs FormCalc and JavaScript
  -> xfapresentationagent hands display items to the PDF writer
  -> pdfldriver + AdobePDFL write the PDF byte stream
  -> AcroForm.ppi + EScript.ppi display and script the PDF in Acrobat
```

This library is a static Node.js pipeline:

```text
parseXdp + parseXsd + parseXmlData
  -> resolveBindings / expandRepeats
  -> dispatchScripts (sandboxed FormCalc and JavaScript)
  -> calculatePositions
  -> applyPagination
  -> renderPdfWithDoc (pdf-lib)
  -> optional Adobe-style post-processing
```

The architectural mismatch is the root cause of most feature gaps:

| Reference component                                      | Role                                              | Library equivalent                                | Status               |
| -------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- | -------------------- |
| `designer_app/FormDesigner.exe`                          | Authoring UI, F5 host, registry and plug-in setup | None                                              | Out of scope         |
| `xfa_engine/xfa.dll`                                     | Orchestrates parsing, layout and presentation     | `src/workflows/render-pdf.ts` plus domain modules | Partial              |
| `xfa_engine/xfatemplate.dll`                             | Full XFA template object model                    | `src/domain/parsing/parse-xdp`                    | Partial              |
| `xfa_engine/xfadata.dll`                                 | Data packet and data-window handling              | `src/domain/parsing/parse-xml-data.ts`            | Partial              |
| `xfa_engine/xfalayout.dll`                               | Full layout and `contentBlockToPage` reflow       | `src/domain/layout`                               | Partial, approximate |
| `xfa_engine/xfapresentationagent.dll`                    | Display-item bridge                               | `src/rendering`                                   | Partial              |
| `xfa_engine/xfascripthandler.dll`                        | FormCalc and JavaScript lifecycle                 | `src/domain/scripting`                            | Partial              |
| `xfa_engine/xfafontservice.dll`                          | Font resolution and device fonts                  | `src/rendering/font-*`                            | Partial              |
| `xfa_engine/xfaimageservice.dll`                         | Image decoding and placement                      | `src/rendering/image-*`                           | Partial              |
| `xfa_engine/xfalocaleset.dll`                            | Locale data and patterns                          | `src/lib/locale-*`, `xfa-locales.json`            | Partial              |
| `xfa_engine/xfaconnectionsetproxy.dll`                   | Data connections                                  | None                                              | Missing              |
| `pdf_rendering/AdobePDFL.dll`                            | Adobe PDF writer                                  | `pdf-lib` plus `src/adobe`                        | Different engine     |
| `pdf_rendering/pdfldriver.dll`                           | PDF syntax driver                                 | `pdf-lib`                                         | Different engine     |
| `graphics_fonts/AGM.dll`                                 | 2-D graphics model                                | `pdf-lib` operators                               | Partial              |
| `graphics_fonts/ACE.dll`                                 | Colour engine                                     | DeviceRGB and DeviceGray only                     | Missing              |
| `graphics_fonts/CoolType.dll`                            | Font rasterization and metrics                    | `fontkit` plus AFM tables                         | Different engine     |
| `graphics_fonts/SVG.dll` and `AdobeSVGAGM.dll`           | SVG rendering                                     | None                                              | Missing              |
| `graphics_fonts/JP2KLib.dll`                             | JPEG 2000 codec                                   | Image sniff only                                  | Missing in effect    |
| `script_engine/ExtendScript.dll` and `ScCore.DLL`        | Adobe JavaScript runtime                          | Node `vm` sandbox                                 | Partial              |
| `script_engine/jfformcalc.dll`                           | FormCalc interpreter                              | `src/domain/scripting/formcalc`                   | Partial              |
| `script_engine/jfsoap.dll`, `jfwsdl.dll`, `wspolicy.dll` | Web services                                      | None                                              | Missing              |
| `converters/*`                                           | XDP/XF/Word/PDF conversion                        | None                                              | Out of scope         |
| `print_drivers/*`, `printer_configs/*`                   | PCL, ZPL, PostScript, DPL, IPL, TPCL output       | None                                              | Out of scope         |
| `pdf_plugins/*.ppi`                                      | Acrobat form and script host                      | Optional static AcroForm only                     | Missing              |
| `linguistics/*`                                          | Hyphenation and spell-check dictionaries          | None                                              | Missing              |
| `i18n_unicode/icu*.dll`                                  | ICU Unicode services                              | JavaScript `Intl` only                            | Partial              |
| `xfa_toolkit/*.jar`                                      | Schema and FML-to-XSD tooling                     | None                                              | Out of scope         |

## 5. Feature inventory and gap matrix

### 5.1 XFA template and form model

| Capability                                                 | Status      | Evidence                                                                                                           | Why difficult to close                                                                                             |
| ---------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| XFA 2.8, 3.3 and 3.6 namespaces                            | Implemented | `src/domain/parsing/parse-xdp/index.ts`; namespace checks in `src/adobe/xfa-namespace-validation.ts`               | The parser accepts the namespaces but does not implement every version-specific element.                           |
| Author/sibling order                                       | Implemented | `ordered.ts` two-pass parse; `subform.ts` emits preserved order                                                    | Mixed child order is preserved, but nested container ordering still depends on parser coverage.                    |
| `tb`, `lr-tb`, `rl-tb`, `table`, `row`, `position` layouts | Implemented | `src/domain/layout/calculate-positions.ts`, `flow-engine.ts`, `table-engine.ts`                                    | These cover Designer's common output; they are not a full box-model port.                                          |
| `tbrl` vertical layout                                     | Missing     | Advertised as a 3.6 feature in `xfa-namespace-validation.ts`; `SubformNode.layout` has no `tbrl`                   | Vertical writing changes text flow, glyph placement and rotation; no vertical text engine exists.                  |
| `subformSet` ordered, choice and unordered relations       | Partial     | `subform.ts` parses relations; `choice` selects `initial` or the first child statically                            | Runtime relation changes and data-driven occurrence selection are not modelled.                                    |
| `occur` min, max and initial                               | Partial     | `expand-repeats.ts` expands to the bound data length and caps at 10,000; `min` and `initial` are parsed but unused | Honouring minimum rows requires synthesizing empty instances and changing binding, layout and validation together. |
| `exclGroup` and radio groups                               | Partial     | `parse-xdp/subform.ts` and `resolve-bindings.ts` parse group values; `layoutExclGroup` stacks children vertically  | No shared selected-child logic; child positions are ignored; AcroForm output has no radio `/Kids`.                 |
| Presence semantics                                         | Implemented | `evaluate-conditions.ts` removes hidden and inactive; renderer skips painting invisible                            | Matches the reference behaviour, but script-driven presence changes after layout do not reflow.                    |
| `breakBefore`, `breakAfter` and named targets              | Partial     | `helpers.ts` parses basic targets; `apply-pagination.ts` reduces them to page offsets                              | Named page and content areas, even/odd targeting and target predicates are not resolved.                           |
| `keep` modes                                               | Partial     | Any keep object with a non-auto value is treated as atomic                                                         | The reference distinguishes keep-next, keep-previous and keep-together scopes; one boolean over-moves content.     |
| Multiple page and content areas                            | Partial     | `page.ts` reads the first content area per page; pagination cycles page templates                                  | The reference has dedicated page and occurrence iterators; this library uses one page height and bucketing.        |
| Medium stock and page orientation                          | Partial     | Stock media sizes and `short`/`long` are parsed                                                                    | `orientation` and multiple content areas are not applied; pages are always created short by long.                  |
| Overflow leader and follower                               | Missing     | Reference exposes leader/overflow symbols in `analysis_exports.json`                                               | Continuation fields, overflow targets and table header repetition need a page-aware continuation model.            |
| Embedded `datasets` packet                                 | Missing     | `parse-xdp/index.ts` reads template, config and connectionSet only                                                 | The public API requires separate data; embedded data changes validation, binding and package semantics.            |
| `config`, `localeSet`, `connectionSet`, `xdc` and XMP      | Partial     | `parse-xdp/config.ts` handles equates and basic connectionSet; XMP metadata is basic                               | Full localeSet patterns, schema loading from connectionSet and device config semantics are absent.                 |
| Tab stops                                                  | Missing     | Reference has tab-list symbols in `jftext.dll`; no tabStops parser in `src`                                        | Tab alignment requires per-tab stops, leader characters and interaction with wrapping and justification.           |
| Hyphenation                                                | Missing     | Reference ships `AdobeLinguistic.dll`, Hunspell dictionaries and hyphen nodes                                      | Requires dictionaries, locale rules and a line-break model that can break inside words without corrupting offsets. |
| Bidi and vertical text                                     | Missing     | CoolType exposes bidirectional and vertical metrics; no bidi or vertical code in `src`                             | Needs Unicode bidi reordering, shaping integration and a vertical flow model.                                      |
| Autofit and shrink-to-fit                                  | Unknown     | No runtime autofit evidence found in the decompiled template and layout paths                                      | If used, it changes font size before layout, which invalidates measurement and pagination.                         |

Visible impact: most sample forms use `tb`, `lr-tb`, `table` and `position`, so
common output is close. Forms with overflow, vertical writing, tabs,
hyphenation, radio groups, data-driven choices or embedded datasets will diverge
structurally, not just by a few points.

### 5.2 Layout, sizing and pagination

| Capability                               | Status                    | Evidence                                                                                                                     | Why difficult to close                                                                                              |
| ---------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `contentBlockToPage` reflow              | Missing                   | `apply-pagination.ts` buckets already-positioned nodes by `y`; the reference has a page iterator and content-block model     | A faithful port needs incremental layout against the next content area, not a post-pass shift.                      |
| Table column widths and `colSpan`        | Implemented               | `calculate-table-layout.ts`, `table-engine.ts`                                                                               | Standard authored and auto columns work.                                                                            |
| Table row height from wrapped content    | Partial                   | `layoutRow` picks the tallest content cell, then forces every cell to that height; fixed cells do not grow from wrapped text | Growth rules interact with `minH`, `maxH`, borders and page splits; the reference behaviour is not fully evidenced. |
| Table row splitting and repeated headers | Missing                   | No `<overflow>` parse; pagination moves whole rows or whole fitting tables                                                   | Header repetition and row continuation need table-aware page state and continuation content.                        |
| Caption placement left and right         | Implemented               | `pdf-renderer/field.ts` reserves a caption strip and paints label and value on one baseline                                  | This is the common case and is regression-tested.                                                                   |
| Caption placement top, bottom and inline | Partial                   | `captionHeight` reserves space, but value rendering does not offset for top/bottom; inline falls through to full width       | Needs four distinct box models and matching layout height reservation.                                              |
| Caption paragraph metrics in layout      | Partial                   | Caption `<para>` is parsed and painted, but layout height ignores caption paragraph metrics                                  | Caption wrapping and indentation can resize the field after layout.                                                 |
| Horizontal and vertical alignment        | Implemented               | Text and field renderers honour `hAlign` and `vAlign`; rich text supports justification                                      | Justification is a subset and does not implement all CSS spacing rules.                                             |
| Anchors and `anchorType`                 | Partial                   | `position-engine.ts` implements positioned anchors and the 90-degree rotation anchor                                         | The full XFA anchor model for flow and table children is not implemented.                                           |
| Rotation                                 | Partial                   | 90-degree draws and anchor normalization are implemented; 270 and arbitrary angles are partially handled                     | Rotation of flow boxes, clipping and text baselines needs a unified transform model.                                |
| Position-layout repeats                  | Partial                   | `position-engine.ts` stacks same-name repeats by previous height                                                             | It ignores authored gaps and horizontal repeat direction.                                                           |
| `exclGroup` child placement              | Partial                   | `layoutExclGroup` gives children a shared `x` and stacked `y`                                                                | Authored child coordinates are ignored.                                                                             |
| Absolute subform height                  | Implemented, with caveats | Subform height is derived from children when no explicit height exists                                                       | Deeply nested absolute boxes can still under-report before pagination.                                              |
| `maxH` clipping and overflow reporting   | Partial                   | Text boxes clip; `LAY_4001 OVERFLOW` is defined but never emitted                                                            | There is no content-overflow signal for callers or pagination.                                                      |
| Rich-text page ownership                 | Partial                   | Pagination flattens rich text and uses the effective base size; paint uses styled runs                                       | Styled fragment heights can disagree with the ownership metrics at page boundaries.                                 |
| Thick border geometry                    | Partial                   | Renderer strokes a centre line; Adobe print output fills inward bars                                                         | Matching the print-driver raster requires filled-ring geometry, not the XFA stroke model.                           |

Visible impact: pagination and table growth are the main reasons a sample form
can keep one extra row (`Dpmbtzs` in Example-3) or place a heading on a
different page. Thick borders and caption placement account for smaller
geometry differences.

### 5.3 Text, typography and line breaking

| Capability                                 | Status               | Evidence                                                                                              | Why difficult to close                                                                                                  |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Default line advance 1.2                   | Implemented          | `line-metrics.ts` and `reference/RENDERING_BEHAVIOR.md` section 2                                     | The constant is shared by layout and paint.                                                                             |
| Ascent clamp `max(A, 1 - D)`               | Partial              | `fontAscent()` applies the clamp; pagination still calls `defaultAscent()`                            | The exact CoolType descent for synthesized base-14 faces is unknown, so baselines still drift by roughly 0.3 to 1.8 pt. |
| Per-glyph 1/1000 pt quantization           | Partial              | `measure.ts` quantizes a whole string by default and per character only when kerning is disabled      | Adobe quantizes each glyph; whether flag `0x1000` suppresses it is unmeasured.                                          |
| Base-14 widths                             | Implemented          | `standard-fonts.ts`; XDC width tables agree with AFM                                                  | Widths match; vertical metrics do not.                                                                                  |
| Kerning and ligatures                      | Partial              | Embedded fonts go through fontkit layout; base-14 fonts do not kern                                   | Layout and paint do not use a shared shaping engine, and no parity probes exist.                                        |
| Complex script shaping                     | Partial              | fontkit may shape embedded Arabic or Indic runs                                                       | There is no bidi reordering, cluster-aware breaking or vertical shaping.                                                |
| Bidi and RTL order                         | Missing              | No bidi implementation in `src`                                                                       | Requires a Unicode bidi algorithm and interaction with alignment and wrapping.                                          |
| Hyphenation                                | Missing              | Only soft hyphen and slash break opportunities exist                                                  | Needs language dictionaries and a break model that preserves text and offsets.                                          |
| Tab stops                                  | Missing              | No tab-stop parser or tab layout                                                                      | Tabs affect alignment, leaders and wrapping.                                                                            |
| Rich-text CSS subset                       | Partial              | `rich-text-parser.ts` handles weight, style, underline, size, line-height, margins, colour and family | Strikeout, small caps, super/subscript, letter/word spacing, classes, links and general CSS are absent.                 |
| Strikeout, small caps, super and subscript | Missing              | No parser or paint path                                                                               | Each needs metrics, baseline shifts and style synthesis.                                                                |
| Faux bold and italic                       | Missing              | Missing variants resolve to another face instead of synthesizing a style                              | Adobe synthesizes when a variant is absent; stroke or skew synthesis changes widths.                                    |
| Font fallback per glyph                    | Missing              | `getSafeFont` ignores the text; `sanitizeTextForFont` drops uncovered code points                     | A correct fallback needs charset probes per font and per-run segmentation, plus layout remeasurement.                   |
| Layout text measurement                    | Partial              | `measureLayoutText` uses base-14 embedders or `0.5 em` per character                                  | Render paint uses the real embedded font, so wrapping and alignment diverge for custom families.                        |
| Line-break opportunities                   | Implemented, partial | `line-breaker.ts` handles whitespace, slash, soft hyphen, zero-width space, U+2028 and U+2029         | No ICU UAX #14, CJK dictionary breaking or Thai rules.                                                                  |
| CJK and Thai line breaking                 | Missing              | No dictionary or locale break rules                                                                   | Requires ICU or an equivalent line-break engine.                                                                        |
| Legacy encodings and CMaps                 | Partial              | XML input is UTF-8 strings; embedded fonts use Identity-H                                             | Code-page selection and CMap-based CID text are not modelled.                                                           |

Visible impact: glyph loss (for example the missing degree sign in Example-3),
different wrap points, different baseline positions and different line heights
on forms that mix fonts or scripts.

### 5.4 Fonts and font distribution

| Capability                            | Status                            | Evidence                                                                         | Why difficult to close                                                                        |
| ------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Base-14 fonts                         | Implemented                       | `standard-fonts.ts`                                                              | Correct for families that map to Helvetica, Times, Courier, Symbol or ZapfDingbats.           |
| Arial Regular                         | Implemented as a bundled subset   | `assets/fonts/Arial-Regular.ttf`                                                 | The subset is intentionally small, so uncommon glyphs are dropped.                            |
| Arial Bold and Italic assets          | Missing                           | Only Arial Regular is bundled; bold and italic map to base-14 Helvetica          | Adobe uses Arial bold and italic, which have different widths and shapes.                     |
| Arial Narrow                          | Implemented as horizontal scaling | `NARROW_SCALE` and `Tz` scaling                                                  | This matches the reference's condensed handling but not a real narrow face's glyph shapes.    |
| Adobe-shipped OTF/TTF faces           | Partial                           | `assets/fonts/adobe` contains the imported OTF/TTF set when locally generated    | The folder is gitignored and not in the npm package; consumers without it get fallback fonts. |
| Full 362-file font installation       | Partial                           | Reference `fonts/` has 75 OTF, 1 TTF, 3 PFB, 3 PFM and support files             | Type1 faces are excluded by the import script; CMap and TypeSpt data are not used.            |
| CJK/CID fonts and CMaps               | Partial                           | Embedded OTF fonts can emit Identity-H; layout metrics remain approximate        | CMap selection, vertical metrics and CJK punctuation widths are not implemented.              |
| Font equates and forced substitutions | Implemented                       | `font-substitution.ts`, `parse-xdp/config.ts`                                    | Covers the Designer.xci rules used by the fixtures.                                           |
| Font sequences                        | Implemented                       | `adobe/font-sequences.ts`                                                        | Fallback chains work for named families.                                                      |
| Embedding and subsetting              | Implemented for OTF/TTF           | `font-manager.ts`, `cff-subset-patch.ts`                                         | Type1 embedding is absent.                                                                    |
| Faux styles                           | Missing                           | No synthesis path                                                                | See 5.3.                                                                                      |
| Font metrics from CoolType            | Partial                           | Ascent clamp and quantization are approximated from AFM and decompiled constants | The exact CoolType descent and per-face tables are not available in Node.                     |
| Bundled font redistribution           | Missing                           | Adobe fonts are gitignored; `package.json` ships only local TTFs and licences    | Licensing and package size prevent shipping the full Adobe font set.                          |

Visible impact: weight and width differences in bold and italic text, missing
glyphs in the Arial subset, and inconsistent wrapping for any family that is not
one of the base-14 aliases.

### 5.5 Graphics, colour and images

| Capability                                   | Status                      | Evidence                                                                                                                         | Why difficult to close                                                          |
| -------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Solid fills                                  | Implemented                 | `border-fill.ts`                                                                                                                 | Standard backgrounds and edge fills.                                            |
| Linear and radial gradients                  | Partial                     | `fill-paint.ts` supports two-colour axis-aligned or centred shading                                                              | Authored gradient vectors, multi-stop gradients and spread methods are ignored. |
| Pattern fills                                | Missing                     | XDC declares native pattern fill; parser stores only fill type and two colours                                                   | Requires pattern content, tiling and colour-space handling.                     |
| Fill and stroke alpha                        | Implemented                 | `pdf-lowlevel.ts` emits `ca` and `CA` ExtGState values                                                                           | Page transparency groups are added when needed.                                 |
| Blend modes and soft masks                   | Missing                     | Only `BM: Normal` is emitted                                                                                                     | Requires blend-mode resources and soft-mask XObjects.                           |
| Clipping                                     | Partial                     | Field, caption and text clipping only                                                                                            | Arbitrary XFA clip regions are not modelled.                                    |
| ICC colour management and output intents     | Missing                     | `supported-features.json` lists `iccColorManagement` unsupported; `ACE.dll` is in the reference                                  | Needs ICC parsing, colour conversion and OutputIntent objects.                  |
| CMYK and spot colours                        | Missing                     | `parseColor` accepts three components only                                                                                       | Four-component colours fall back to defaults.                                   |
| Dashes, caps, joins and rounded corners      | Implemented                 | `border-style.ts`, `border-fill.ts`                                                                                              | Dash scaling uses a 0.5 pt floor, so sub-0.5 pt authored dashes can differ.     |
| Embossed, etched, raised and lowered borders | Partial                     | All map to solid patterns                                                                                                        | Real 3-D borders need highlight and shadow geometry.                            |
| Arcs and circles                             | Partial                     | `<arc>` start and sweep angles are parsed but ignored; both draw a full ellipse; centre placement is not the authored box centre | A faithful arc model needs path geometry and clipping.                          |
| Line shapes                                  | Partial                     | Parsed but rendered as the border box                                                                                            | Line endpoints, caps and separate stroke parameters are not honoured.           |
| SVG                                          | Missing                     | Reference ships `SVG.dll`, `SVGRE.dll` and `AdobeSVGAGM.dll`                                                                     | Requires an SVG parser, CSS subset and renderer.                                |
| PNG and JPEG images                          | Implemented                 | `image-embedder.ts`                                                                                                              | Standard embedded images.                                                       |
| BMP images                                   | Partial                     | 24/32-bit uncompressed only                                                                                                      | 1/4/8-bit BMPs are rejected and skipped silently.                               |
| GIF images                                   | Partial, effectively a stub | `gifToPng` fills the image with one global palette colour; no LZW decode                                                         | A real GIF decoder needs LZW, palettes, transparency and frame handling.        |
| TIFF images                                  | Partial                     | Uncompressed 8-bit only; compression must be 1                                                                                   | LZW, PackBits, JPEG-in-TIFF and CCITT G4 are absent.                            |
| CCITT Group 4                                | Missing                     | Listed as partial support; no decoder is wired                                                                                   | Needs a fax decoder and PDF image-filter integration.                           |
| JPEG 2000 (JPX)                              | Missing in effect           | Format is sniffed but no JPX embed path exists; errors are swallowed                                                             | Needs a JPX decoder or direct JPX XObject emission, plus colour-space handling. |
| PDF images                                   | Missing                     | Explicit rejection in `image-embedder.ts`                                                                                        | Requires PDF page import or rasterization.                                      |
| CMYK images                                  | Missing                     | No CMYK image path                                                                                                               | Needs CMYK colour handling.                                                     |
| Image rotation                               | Missing                     | `image-scaler.ts` supports a rotated rectangle, but `renderImage` never applies it                                               | Rotation must compose with layout transforms and clipping.                      |
| Thick border centre line versus filled bar   | Partial                     | Printer output fills inward; renderer strokes the authored centre line                                                           | A filled-ring model would change border geometry and tests.                     |
| Coincident border dedup                      | Partial                     | First-paint-wins with a top/bottom parent-edge suppression                                                                       | The exact Adobe rule for unequal thickness or partial overlap is unknown.       |

Visible impact: forms with logos, photos, patterns, CMYK brand colours, SVG or
2-D barcodes lose content or render a different visual weight. The sample forms
use mostly PNG/JPEG and solid fills, which hides most of this gap.

### 5.6 Barcodes

Reference evidence: 13 PMP encoder DLLs, a `BarcodeData.xml` preset file, and
`jftext.dll` classes for the full JetForm barcode set. This library supports a
useful 1-D subset and PDF417.

| Capability                                                     | Status      | Evidence                                                | Why difficult to close                                                           |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Code 39                                                        | Implemented | `encodeCode39`                                          | Logmars is aliased to Code 39, so standards-specific rules differ.               |
| Code 93                                                        | Implemented | `encodeCode93`                                          | Standard encoding.                                                               |
| Code 128 A, B, C and SSCC                                      | Implemented | `encodeCode128A/B/C/Sscc`                               | Standard encoding.                                                               |
| EAN-13, EAN-8, UPC-A and UPC-E                                 | Implemented | `encodeEan13`, `encodeEan8`, `encodeUpcA`, `encodeUpcE` | Add-on symbols are not supported.                                                |
| Codabar                                                        | Implemented | `encodeCodabar`                                         | Standard encoding.                                                               |
| 2-of-5 Interleaved, Industrial and Matrix                      | Implemented | `encode2of5`                                            | Standard aliases.                                                                |
| MSI                                                            | Implemented | `encodeMsi`                                             | Plessey is aliased to MSI, which is not the same symbology.                      |
| POSTNET and PLANET                                             | Implemented | `encodePostnet`, `encodePlanet`                         | 2-height postal bars only.                                                       |
| PDF417                                                         | Implemented | `pdf417.ts`, `pdf417-tables.json`                       | Error correction 0-8 and layout options work.                                    |
| QR Code                                                        | Missing     | Name is normalized but falls through to `encodeCode39`  | Needs Reed-Solomon, masking, version selection and module placement.             |
| DataMatrix                                                     | Missing     | Same fallback                                           | Needs ECC200, region placement and encoding modes.                               |
| Aztec                                                          | Missing     | Same fallback                                           | Needs mode selection, layers and Reed-Solomon.                                   |
| RSS-14, Stacked, Stacked Omni, Truncated, Limited and Expanded | Missing     | Present in the XDC device list; no encoder              | GS1 DataBar needs its own finder, checks and linkage rules.                      |
| UPS MaxiCode                                                   | Missing     | `upsmaxicodepmp.dll` exists in the reference            | Needs hexagon module placement and structured carrier message rules.             |
| RFID                                                           | Missing     | `rfidpmp.dll` exists in the reference                   | Not a printable symbology in the same sense; likely out of scope for static PDF. |
| USPS Intelligent Mail, Australia Post, RM4SCC and Japan Post   | Missing     | Present in `jftext` classes and the XDC                 | 4-state postal symbols need three-position bar tables and bar-type placement.    |
| Code 11 and Code 49                                            | Missing     | Normalized but no encoder                               | Each has its own alphabet, checks and row structure.                             |
| UPC/EAN 2-digit and 5-digit add-ons                            | Missing     | Present in the XDC device list                          | Add-on placement and checks differ from the main symbol.                         |
| Module height                                                  | Partial     | `moduleHeight` is parsed but not passed to the renderer | Barcode height follows the field box instead of the authored module.             |
| Checksum and print-check-digit options                         | Partial     | Parsed but not consumed                                 | Some encoders always add mandatory checks, so authored options are ignored.      |
| Human-readable text placement                                  | Partial     | Only above versus below is distinguished                | Embedded variants use the same placement.                                        |
| PaperFormsBarcode presets                                      | Partial     | Only PDF417 error correction is consumed                | QR and DataMatrix presets are ignored.                                           |

The fallback to Code 39 is the most dangerous part: an unsupported symbology
still produces a plausible-looking barcode, so silent wrong output can reach a
production form.

### 5.7 Scripting and form runtime

| Capability                                        | Status      | Evidence                                                                                                                            | Why difficult to close                                                                       |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| FormCalc parsing and evaluation                   | Implemented | `src/domain/scripting/formcalc`                                                                                                     | The common language features are covered.                                                    |
| FormCalc built-ins                                | Partial     | All 62 signatures from `FormCalc_fn.ini` have names, but `Get`, `Post`, `Put`, `MessageBox`, `Page`, `presence` and `ref` are stubs | Side-effecting and host-dependent functions cannot be reproduced without a host environment. |
| JavaScript execution                              | Implemented | `src/domain/scripting/js-engine` uses Node `vm`                                                                                     | The sandbox is a mitigation, not a security boundary.                                        |
| JavaScript host, app and util objects             | Partial     | Many methods are no-ops or fixed values                                                                                             | Acrobat-specific dialogs, file I/O, printing and URL actions do not exist.                   |
| `xfa.form`, record, datasets, template and layout | Partial     | Proxy objects cover basic traversal and property access                                                                             | The full XFA object model, collections and XML DOM behaviour are absent.                     |
| Lifecycle events                                  | Implemented | `event-dispatcher.ts` runs initialize, calculate, validate, ready, layout ready, doc ready and doc open                             | Interactive and post-save/print/submit events are parsed but not dispatched automatically.   |
| Interactive events                                | Partial     | Names normalize; dispatch requires an explicit API call                                                                             | A static PDF does not emit Acrobat field actions.                                            |
| Calculation dependency graph                      | Implemented | `script-dependency-tracker.ts`; cascade limit is 100                                                                                | The exported Adobe depth constant is 25, so the documentation and code disagree.             |
| SOM expressions                                   | Partial     | `som-expression-resolver.ts` handles `$`, `this`, `$$`, `$form`, `$record`, indexes and wildcards                                   | Predicates, axes and namespace-qualified references are absent.                              |
| Instance manager                                  | Implemented | JS proxy and hooks                                                                                                                  | Works within the parsed model; not a full XFA manager.                                       |
| Form DOM writes                                   | Partial     | Value, rawValue, presence, geometry, colours and children                                                                           | Methods and properties outside the proxy surface are missing.                                |
| `xfa.layout` timing                               | Partial     | Page count comes from template pages before pagination; page maps exist only for doc ready                                          | Scripts that query pages during initialize or calculate see placeholder values.              |
| Relayout after post-layout scripts                | Missing     | `layoutDirty` is computed but never used to re-run layout and pagination                                                            | A script that changes geometry in doc ready does not move content.                           |
| Acrobat JavaScript APIs                           | Missing     | No `getField`, `AFNumber_*`, `AFSimple_Calculate`, `SOAP`, `Net` or document actions                                                | These live in Acrobat, not in a static renderer.                                             |
| FormCalc date/time locale coverage                | Partial     | Gregorian `Date` only; local date formats use a small hard-coded table                                                              | Non-Gregorian calendars, DST and time zones need a locale database.                          |
| Data sources, SOAP, WSDL and file import          | Missing     | Reference ships `xfasourceset`, `xfaconnectionsetproxy`, `jfsoap`, `jfwsdl`, `FileImport`                                           | Network and database access are out of the static rendering model.                           |

Visible impact: calculated and formatted fields that rely on supported paths
are close. Scripts that use host APIs, change layout after layout-ready, query
pages early, or import data produce different visible output or fail silently.

### 5.8 Data binding, schema and validation

| Capability                   | Status               | Evidence                                                           | Why difficult to close                                                            |
| ---------------------------- | -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| XSD parsing                  | Partial              | `parse-xsd.ts` handles a root element and `xs:sequence`            | No `choice`, `all`, attributes, named types, restrictions, imports or namespaces. |
| XPath data references        | Partial              | `xpath-resolver.ts` supports dot paths, indexes and wildcards      | No predicates, axes, functions or namespace-qualified paths.                      |
| Binding resolution           | Partial              | `resolve-bindings.ts` handles dataRef and repeats                  | Global binding scopes and complex SOM references are not modelled.                |
| Binding validation           | Partial              | `validate-bindings.ts` checks `$`-refs and schema paths            | Complex references can produce false positives.                                   |
| Schema validation            | Partial              | Required, repeating and basic type checks                          | No facets, choice models, attributes, keys or identity constraints.               |
| Lexical decimal preservation | Implemented          | `parse-xml-data.ts` uses `parseTagValue: false`                    | Keeps authored `0,006` strings intact.                                            |
| Picture and format patterns  | Implemented, partial | `value-format.ts` implements numeric, text and date picture tokens | Obscure clauses and locale currencies remain approximate.                         |
| Locale-aware formatting      | Partial              | `locale-format.ts` uses `Intl` for names and separators            | No localeSet patterns, alternate calendars or currency tables.                    |
| Embedded datasets            | Missing              | XDP datasets packet is ignored                                     | Callers must pass data separately.                                                |
| Data windows                 | Missing              | No data-window parser or layout model                              | Record ranges cannot be selected from the data packet.                            |
| ADO and ODBC data sources    | Missing              | Reference has `xfasourceset.dll` and ADO strings                   | Requires a database host and is outside a static file-to-PDF renderer.            |
| SOAP, WSDL and WS-Policy     | Missing              | Reference ships the DLLs                                           | Requires network services and a SOAP stack.                                       |
| File import                  | Missing              | `FileImport.dll`; JS `host.importData` is a no-op                  | Requires file-system and script host integration.                                 |
| FML-to-XSD and XFA toolkit   | Out of scope         | Reference ships Java toolkit JARs                                  | Authoring and schema-generation tooling, not rendering.                           |

### 5.9 PDF output and post-processing

| Capability                       | Status                   | Evidence                                                                       | Why difficult to close                                                                                      |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| AcroForm fields                  | Partial, opt-in          | `pdf-acroform.ts`; `NeedAppearances` is true                                   | Flat widgets with no field hierarchy, no per-field default appearance, no calculation order and no actions. |
| Radio groups and checkbox styles | Partial                  | Check buttons draw Unicode boxes; widgets are independent                      | No `/Kids`, `/Parent` or selected-child logic; authored mark styles are ignored.                            |
| Digital signatures               | Missing                  | Signature fields render nothing; a `Sig` widget can be emitted without a value | Real signatures need a signing certificate, ByteRange and Contents.                                         |
| Annotations                      | API only                 | `pdf-annotations.ts`; no XFA annotation parsing                                | XFA-authored links, highlights and notes are not exported.                                                  |
| Bookmarks and outlines           | API only                 | `pdf-bookmarks.ts`; caller-supplied                                            | Designer-authored outline entries are not parsed.                                                           |
| Optional content and layers      | Stub                     | `pdf-layers.ts` creates a catalog but `addContentToLayer` is a no-op           | Content is not tagged with OCGs, so layer toggles do not work.                                              |
| Tagged PDF                       | Stub                     | `pdf-tagged.ts` writes a basic structure tree with no marked content           | Accessibility needs MCIDs, BDC/EMC, alt text and structure mapping.                                         |
| Metadata and XMP                 | Implemented, basic       | `pdf-metadata.ts`; XDP XMP parsing                                             | Title, author, producer, dates and basic XMP match; arbitrary custom schemas are not preserved.             |
| Security and encryption          | Partial                  | RC4-40, RC4-128 and AES-128                                                    | No AES-256, certificate security or every Acrobat permission nuance.                                        |
| XFA package embedding            | Implemented, opt-in      | `pdf-xfa.ts`                                                                   | Packets are preserved when requested.                                                                       |
| Form flattening                  | Implemented, with caveat | `pdf-form-flatten.ts` removes fields; visible content comes from the renderer  | It does not rely on generated widget appearances.                                                           |
| PDF JavaScript actions           | Missing                  | No `/AA`, `/JS` or field action writing                                        | Interactive calculation, formatting and validation would need Acrobat-compatible actions.                   |
| Output intents and PDF/A         | Missing                  | No ICC or OutputIntent objects                                                 | Requires colour profiles and PDF/A validation.                                                              |
| PDF version and extensions       | Implemented              | `pdf-catalog.ts`; XDP config drives version                                    | Matches authored version and extension level.                                                               |
| Viewer preferences               | Implemented, basic       | `pdf-metadata.ts` sets display title when a title exists                       | Other viewer preferences are not modelled.                                                                  |

### 5.10 Localization and internationalization

| Capability                                | Status      | Evidence                                                     | Why difficult to close                                                |
| ----------------------------------------- | ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Locale catalog                            | Partial     | `xfa-locales.json` has 114 LCIDs; the reference list has 117 | A few Serbian variants resolve to defaults.                           |
| Month, weekday, AM/PM and separator names | Implemented | `locale-format.ts` uses `Intl`                               | Node's ICU data can differ from Adobe's ICU 4.0 tables.               |
| Locale picture patterns                   | Partial     | Numeric, text and date formats are implemented               | XFA `localeSet` authored patterns are not parsed.                     |
| Currencies                                | Partial     | Currency symbols are treated as literal characters           | No locale currency symbol or placement tables.                        |
| Calendars                                 | Missing     | Gregorian only                                               | Hijri, Buddhist and other calendars need locale calendar data.        |
| Time zones                                | Partial     | Local and UTC `Date`; `Num2GMTime` exists                    | No time-zone database.                                                |
| Collation and normalization               | Missing     | No ICU collation or Unicode normalization in the layout path | Affects sorting, comparisons and script results.                      |
| Line-break rules                          | Partial     | Basic punctuation and slash rules                            | No UAX #14, CJK dictionary breaking or Thai rules.                    |
| Legacy encodings and code pages           | Partial     | UTF-8 strings only                                           | Reference supports ISO-8859 variants, Shift-JIS, KSC-5601 and others. |
| RTL and message translation               | Missing     | Locale plan explicitly excludes RTL and translation          | Needs bidi and a message catalog.                                     |

### 5.11 Verification and tooling

| Capability                         | Status         | Evidence                                                                                                                                               | Why difficult to close                                                   |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Observable oracle for sample forms | Partial        | Adobe PDFs exist for Example-1, Example-2 EN/ESP and Example-3                                                                                         | They are `Microsoft: Print To PDF` exports, not genuine Preview PDFs.    |
| Example-2-CN oracle                | Missing        | No Adobe PDF in `Adobe-generated-results/`                                                                                                             | Cannot measure CN parity at all.                                         |
| Automated visual regression        | Partial        | `scripts/verify-pdf.mjs` looks only in absent `test/final-test` and `test/oracles` directories                                                         | The CI path reports success without comparing anything.                  |
| Page-attribution tests             | Missing        | Integration tests assert page counts and data presence only                                                                                            | A row moving to the wrong page still passes.                             |
| Geometry and baseline tests        | Partial        | Unit tests cover internal metrics                                                                                                                      | No end-to-end tolerance test against Adobe output.                       |
| Reference measurement tools        | Not integrated | `reference/tools/make-probes.mjs`, `extract-pdf-facts.py`, `derive-metrics.py`                                                                         | The tools exist but are not part of the repository's verification chain. |
| Feature matrix accuracy            | Partial        | `supported-features.json` lists GIF, TIFF, JPX and border styles that are stubs or partial                                                             | Callers cannot distinguish real support from fallback behaviour.         |
| Documentation freshness            | Partial        | `reference/RENDERING_BEHAVIOR.md` still says ascent and quantization are unimplemented; `docs/05-reference/rendering-behavior.md` is a stale duplicate | Agents can try to re-fix already implemented behaviour.                  |

## 6. Cross-cutting reasons these gaps are hard

1. **The decisive algorithms are proprietary binaries.** `xfalayout.dll`,
   `CoolType.dll`, `AGM.dll` and `AdobePDFL.dll` are Windows PE binaries with
   decompiled pseudocode only. The reference folder is evidence, not a library
   that can be linked into Node.js. Reimplementing them means rebuilding layout,
   font metrics, rasterization and PDF writing from behaviour.

2. **Observable evidence is weaker than the code surface.** The available Adobe
   PDFs come from a print driver, so text is outlined, fonts are re-subset to
   anonymous CID faces and page boxes are rounded. There is no genuine Preview
   PDF oracle for every fixture, and no CN oracle at all. Many behaviours can
   only be inferred from decompilation.

3. **Fonts are both a technical and a licensing problem.** Adobe ships 362 font
   files, but only the local OTF/TTF import is usable. The npm package cannot
   redistribute the Adobe set, and the bundled Arial is a small subset. Exact
   glyph shapes and widths for Arial bold, italic, narrow and CJK faces are not
   available by default.

4. **The reference is a live runtime, not a batch converter.** Preview PDF uses
   Acrobat plug-ins, the ExtendScript host, installed fonts and the current
   date. Output can change with the environment. A static renderer cannot
   reproduce every runtime side effect without embedding a compatible host.

5. **Layout is coupled.** Changing pagination affects table growth, caption
   placement, rich-text ownership, borders and page top alignment. A fix in one
   area usually needs matching changes in layout, pagination and paint; the
   project's regression suite exists for that reason.

6. **The project deliberately forbids shortcut fixes.** `AGENTS.md` requires
   generic XFA semantics, no fixture-specific constants and no explanatory
   inline comments. That rules out the quickest route to visual parity
   (hard-coded offsets for one form) and raises the cost of every change.

7. **The package has size, purity and security constraints.** The package size
   budget, pure `Result<T>` domain layer, sandboxed scripts and no native
   dependencies restrict solutions that would otherwise be easy, such as
   bundling a full ICU, HarfBuzz or a font rasterizer.

## 7. Implemented features that must not be "fixed" again

These are present in the current source even though older notes or a surface
reading of the reference suggest otherwise:

- presence semantics, including invisible nodes occupying layout space;
- default line advance `1.2`;
- ascent clamp `max(A, 1 - D)`;
- 1/1000 pt advance quantization;
- 90-degree rotation and anchor normalization;
- page-top fragment alignment and line-range slicing;
- rich-text paragraph CSS from `<p style>`;
- field default line height `1.2 x min(own size, inherited size)`;
- U+2028 and U+2029 line and paragraph breaks;
- NBSP substitution when a known font lacks the glyph;
- BMP embedding for 24/32-bit uncompressed files;
- PDF417 encoding;
- straddling tables that fit move whole;
- CFF subset header patching;
- XFA package embedding, basic AcroForm, security and metadata.

## 8. Reference component coverage appendix

| Reference area                                 | Contents                                                    | Relevance to static Preview PDF                               | Library status                 |
| ---------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| `designer_app/`                                | FormDesigner.exe, arh.exe                                   | Authoring and preview host                                    | Out of scope                   |
| `xfa_engine/`                                  | 17 XFA orchestration and service DLLs                       | Parsing, layout, scripts, fonts, images, locales, connections | Partial                        |
| `pdf_rendering/`                               | AdobePDFL, pdfldriver, pdfdocument, renderers, JetForm DLLs | PDF byte stream and graphics                                  | Replaced by pdf-lib            |
| `graphics_fonts/`                              | AGM, ACE, CoolType, SVG, JP2K, XMP, BIB, MPS                | Graphics, colour, fonts, images                               | Partial or missing             |
| `script_engine/`                               | ExtendScript, FormCalc, ScCore, XSLT, SOAP and WSDL         | Scripts and data connections                                  | Partial or missing             |
| `script_templates/`                            | FormCalc and JavaScript function metadata                   | Built-in name and signature references                        | Used as a checklist            |
| `converters/` and `converter_configs/`         | Word, XF, PDF, IFD and image converters                     | Input conversion                                              | Out of scope                   |
| `print_drivers/` and `printer_configs/`        | PCL, ZPL, PostScript, DPL, IPL and TPCL drivers             | Non-PDF output                                                | Out of scope                   |
| `barcode_data/`                                | PMP encoders and `BarcodeData.xml`                          | Barcode symbologies and presets                               | Partial                        |
| `fonts/`                                       | 362 font and support files                                  | Font matching and embedding                                   | Partial                        |
| `i18n_unicode/`                                | ICU libraries and data                                      | Unicode, locales and encodings                                | Partial                        |
| `linguistics/`                                 | Hunspell and hyphenation dictionaries                       | Hyphenation and spell check                                   | Missing                        |
| `xml_parsing/`                                 | Expat and XMP parsers                                       | XML parsing and metadata                                      | Replaced by JavaScript parsers |
| `xfa_toolkit/`                                 | Java schema and XSD tooling                                 | Authoring tooling                                             | Out of scope                   |
| `pdf_plugins/`                                 | AcroForm.ppi, EScript.ppi, PDFLibPI.ppi                     | Acrobat rendering and scripting                               | Missing                        |
| `config_files/`                                | XCI and XDC device configs                                  | Destination, fonts, borders, media                            | Partial                        |
| `app_meta/`, `conversation/`, `image_formats/` | Splash, manifests, prior analysis                           | No rendering behaviour                                        | Out of scope                   |

## 9. Maintaining this document

When a gap is closed:

1. update the status and evidence in the relevant table;
2. add the regression test to the row or to the companion assessment;
3. remove the item from the "must not fix again" list only if the behaviour
   genuinely regresses;
4. record the change in `docs/01-canonical/AI_WIKI.md` in the same change as
   the code;
5. re-run the acceptance gates described in
   [`adobe-parity-assessment.md`](adobe-parity-assessment.md).

Documented but intentionally not corrected here: stale claims in
`src/config/supported-features.json`, `reference/RENDERING_BEHAVIOR.md`,
`docs/05-reference/rendering-behavior.md` and the root `README.md` known-gaps
list. They are recorded in this inventory and in the companion assessment as
findings for a separate clean-up change.
