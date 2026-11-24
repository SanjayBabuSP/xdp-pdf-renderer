# Why Adobe LiveCycle output is not yet 1:1

- Date: 2026-11-24
- Author: opencode
- Status: verified analysis; measurements dated 2026-11-24
- Companion: [`reference-feature-gaps.md`](reference-feature-gaps.md)
- Measurement environment: Node.js renderer in this checkout; Adobe PDFs from
  `test/fixtures/sample-forms/Adobe-generated-results/`

## 1. Verdict

The renderer is not 1:1 with Adobe LiveCycle Designer "Preview as PDF", and
exact pixel equality is not currently achievable or measurable with the
available oracles.

That is not a single bug. It is the result of building a static Node.js
renderer against a live Windows pipeline whose decisive components
(`xfalayout.dll`, `CoolType.dll`, `AGM.dll`, `AdobePDFL.dll`, Acrobat
plug-ins) are proprietary binaries. The current implementation reproduces the
common Designer form model closely enough that page counts match on every
fixture with an Adobe oracle (four of five; Example-2-CN has no oracle), but
several layers remain approximations:

- pagination is coordinate bucketing, not incremental `contentBlockToPage`
  reflow;
- text metrics come from AFM tables and fontkit, not CoolType;
- the Arial family is a small regular-weight subset, not Adobe's installed
  faces;
- missing features fall back silently (notably 2-D barcodes to Code 39 and
  advanced image formats to nothing);
- the available Adobe PDFs were produced by Microsoft Print To PDF, not by
  Preview PDF, so they are a different pipeline and even a perfect renderer
  could not be pixel-identical to them.

The realistic target is **structural and geometric/ink equivalence for static
forms**: same page count and page boxes, same visible text and glyph set,
positions within an agreed tolerance, and raster differences below an agreed
threshold. Interactive and runtime equivalence needs an Acrobat-compatible
host and is out of scope for a static renderer.

## 2. What "1:1" can mean

"1:1" needs a definition. This project uses four levels.

| Level                  | Definition                                                                        | Measurable today                                         | Realistic target                                          |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------- |
| L0 Deterministic input | Same XDP, XSD, XML and frozen dynamic values on both sides                        | Yes, after removing `Date()`-style nondeterminism        | Required baseline                                         |
| L1 Structural parity   | Same page count, page boxes, page attribution, visible text runs and glyph set    | Yes                                                      | Achievable for common forms                               |
| L2 Geometric parity    | Baselines, glyph origins, table rows, borders and images within tolerance         | Partly; Adobe text is outlined in some fixtures          | Achievable with metric and layout work                    |
| L3 Ink parity          | Raster output visually indistinguishable at normal viewing and print resolution   | Partly; depends on rasterizer and font shapes            | Achievable within a stated threshold, not pixel-identical |
| L4 Pixel parity        | Every pixel identical to Adobe Preview PDF                                        | No: no genuine Preview oracle and a different rasterizer | Not a meaningful target                                   |
| L5 Runtime parity      | Same interactive calculations, validation, actions and field behaviour in Acrobat | Only generation-time scripts run                         | Requires Acrobat and is out of scope                      |

A claim of "1:1" without naming the level is not testable. This document uses
L1 and L2 as the default engineering target and treats L3 as an acceptance
threshold, not an identity.

## 3. The seven root causes of visible divergence

### 3.1 The reference is a live pipeline, not a PDF generator

Designer's F5 preview runs a Windows pipeline: the XFA engine parses and lays
out the form, the script handler runs FormCalc or JavaScript, the presentation
agent hands display items to Adobe's PDF writer, and Acrobat plug-ins render
the result and run interactive scripts. The installed fonts, the printer
driver, the Acrobat version and the current date all participate.

This library parses and lays out the form once, runs a sandboxed subset of
scripts, and writes PDF operators through pdf-lib. It is a different product
category: a deterministic batch renderer rather than an authoring preview.

Consequences:

- scripts that depend on the Acrobat host or the file system cannot run;
- layout that depends on installed fonts cannot match a machine without those
  fonts;
- dynamic fields can differ between two runs even with identical inputs;
- interactive actions are absent from the output unless implemented as static
  PDF features.

### 3.2 The available oracles use a different pipeline

All four sample Adobe PDFs were produced by **Microsoft: Print To PDF**
(`producer: Microsoft: Print To PDF`), not by Designer's Preview PDF or Save As
PDF. Their properties differ from a vector reference:

| Property                   | Adobe sample oracle           | This library                                                 |
| -------------------------- | ----------------------------- | ------------------------------------------------------------ |
| Page box                   | 595.32 x 841.92 pt            | 595.28 x 841.89 pt                                           |
| Example-1 fonts            | CIDFont+F1, F2, F3            | ArialMT subset, Helvetica-Bold, Helvetica-Oblique            |
| Example-2 fonts            | CIDFont+F1 only               | ArialMT subset, Helvetica, Helvetica-Bold                    |
| Example-2 extractable text | 286 characters across 6 pages | 10,151 characters                                            |
| Example-2 drawing objects  | 8,412                         | 100                                                          |
| Example-3 fonts            | CIDFont+F1 to F5              | ArialMT subset, Helvetica, Helvetica-Bold, Helvetica-Oblique |

The print path outlines most body text in Example-2 (hence 286 characters and
8,412 drawing objects) and re-subsets fonts to anonymous CID faces. It also
rounds page boxes. A renderer cannot be pixel-identical to a different
rasterization pipeline, and text extraction cannot serve as glyph-level truth
where text is outlined.

Example-2-CN has no Adobe PDF at all, so CN parity cannot be measured with the
current fixtures.

### 3.3 Layout and pagination are approximations

`apply-pagination.ts` positions content once against the first page's content
area, buckets nodes by `y`, then translates the buckets onto page templates. It
does not re-run layout against the destination content area, does not reflow
following content after a break, and does not implement Adobe's page and
occurrence iterators.

The practical effects:

- a row can stay on page 0 where Adobe moves it to page 1 (Example-3
  `Dpmbtzs`; the break is unchanged by the ascent clamp, so row-height
  accumulation is the cause);
- a heading and its first items can split differently around a boundary;
- line positions can differ by one line when a cut is mid-line;
- table header repetition, overflow leader/follower and continuation fields are
  not modelled at all.

The recent whole-unit shift and whole-table move rules fixed the worst
symptom, a table that straddled a boundary and then shifted twice. They are
targeted rules, not a port of the reference layout engine.

### 3.4 Text metrics and font assets are not Adobe's

The reference text stack is CoolType plus the installed Adobe fonts. This
library uses pdf-lib's AFM widths for base-14 fonts, fontkit for embedded
fonts, and a small set of bundled faces. Three differences remain material.

**Vertical metrics.** The clamp `ascent = max(A, 1 - D)` is implemented, but
the exact CoolType descent for synthesized base-14 faces is unknown. The
residual is about 0.3 to 1.8 pt in dense tables. Example-1 top labels measured
at 23.4, 34.8, 47.5 and 58.9 pt in Adobe versus 22.7, 34.0, 46.8 and 58.1 pt
here, a consistent 0.7 to 0.8 pt difference.

**Glyph advances.** Adobe quantizes each glyph to 1/1000 pt with a small nudge.
The implementation quantizes a whole string by default and only per character
when kerning is disabled. Total widths stay close, but wrap boundaries near a
tolerance can move.

**Font faces and coverage.** Only Arial Regular is bundled. Adobe uses Arial
bold, italic and narrow faces with their own widths and shapes. Bold and
italic therefore use Helvetica base-14 faces. The Arial subset also lacks some
characters: Example-3 renders `R` where Adobe renders `°R` because the degree
sign is dropped by glyph sanitization. Layout measurement is worse for
non-base-14 families: `measureLayoutText` falls back to `0.5 em` per character
while paint uses the real font, so wrapping and alignment can disagree.

### 3.5 Missing feature surface

Some differences are not approximations of a supported feature; the feature is
absent:

- bidi and RTL reordering, vertical writing (`tbrl`), hyphenation and tab
  stops;
- table overflow, repeated headers and continuation fields;
- QR, DataMatrix, Aztec, GS1 DataBar and 4-state postal barcodes (they silently
  render as Code 39);
- GIF decoding (solid colour only), compressed TIFF, JPX, PDF and CMYK images;
- SVG, pattern fills, blend modes, soft masks, ICC colour management and
  CMYK colours;
- strikeout, small caps, super/subscript and general rich-text CSS;
- AcroForm field actions, radio groups, signatures, tagged-PDF marked content
  and functional layers;
- ADO/ODBC, SOAP/WSDL, file import, data windows and embedded datasets;
- most of XSD and XPath.

The full inventory with evidence and difficulty ratings is in
[`reference-feature-gaps.md`](reference-feature-gaps.md).

### 3.6 Non-determinism and runtime state

Some visible differences have nothing to do with rendering quality. Example-1
contains a field with `$.rawValue = Num2Date(Date(), "DD-MM-YYYY")`. The Adobe
PDF shows `04-11-2026` because it was generated on 4 November 2026; the current
render shows the current date. This is correct behaviour for a live form and
wrong input for a parity comparison.

Other runtime effects:

- scripts that change geometry in `docReady` set `layoutDirty`, but layout and
  pagination are not re-run, so content does not move;
- `xfa.layout` returns template page information before pagination, so early
  scripts see placeholder pages;
- many host and application APIs are stubs by design;
- the sandbox is a mitigation, not a hard security boundary, which limits
  running untrusted host-like behaviour.

### 3.7 PDF and interactive features

The output is a static visual rendering with optional flat AcroForm widgets.
It does not emit field calculation, validation or format actions, radio kids,
signatures, XFA-authored annotations or bookmarks, real layer membership,
tagged-PDF marked content, output intents or PDF/A metadata. These do not
affect a printed sheet, but they are part of what "Preview PDF" means as an
interactive document.

## 4. Measured gap snapshot

Method: PyMuPDF at 110 dpi, per-page raster difference at a per-channel
threshold of 60 out of 255, plus text and font extraction. This threshold
counts visible ink differences, not every anti-aliasing pixel. The measurement
is a smoke signal, not an acceptance gate; it is useful for ranking pages and
catching regressions.

### 4.1 Document-level facts

| Fixture       | Pages Adobe / ours | Adobe text chars | Ours text chars | Adobe drawings | Ours drawings |
| ------------- | ------------------ | ---------------- | --------------- | -------------- | ------------- |
| Example-1     | 1 / 1              | 1,476            | 1,472           | 199            | 195           |
| Example-2-EN  | 6 / 6              | 286              | 10,151          | 8,412          | 100           |
| Example-2-ESP | 6 / 6              | 295              | 11,233          | 9,262          | 100           |
| Example-3     | 2 / 2              | 4,829            | 5,031           | 570            | 396           |
| Example-2-CN  | No oracle          | n/a              | n/a             | n/a            | n/a           |

### 4.2 Raster difference by page

| Fixture       | p0    | p1     | p2     | p3     | p4     | p5    |
| ------------- | ----- | ------ | ------ | ------ | ------ | ----- |
| Example-1     | 7.47% |        |        |        |        |       |
| Example-2-EN  | 6.45% | 10.27% | 9.63%  | 15.46% | 13.27% | 2.15% |
| Example-2-ESP | 9.31% | 10.37% | 10.05% | 16.84% | 15.26% | 5.72% |
| Example-3     | 6.01% | 11.52% |        |        |        |       |

Ink-overlap analysis found a global shift near one raster pixel at 110 dpi
(about 0.65 pt) on Example-1 page 0 and Example-3 page 1. On Example-3 page 1
the overlap score improved from 0.485 to 0.624 when shifted by one pixel,
which indicates a systematic baseline offset rather than random glyph
differences. Other pages were best aligned at zero shift.

These percentages are not directly comparable to a design review. Example-2
has thousands of outlined glyph paths in Adobe's PDF and a different page box,
so a large part of its difference is text shape and rasterization, not layout.

### 4.3 Concrete residuals on the sample forms

| Fixture   | Residual                                                                  | Evidence                                                                                                                                                                                   | Likely cause                                                                   |
| --------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Example-1 | Labels sit 0.7 to 0.8 pt above Adobe's baselines                          | First four label lines at 22.7/34.0/46.8/58.1 versus 23.4/34.8/47.5/58.9                                                                                                                   | CoolType ascent and font metric model                                          |
| Example-1 | Bold labels use Helvetica-Bold, not Arial bold                            | Extracted fonts; only Arial Regular is bundled                                                                                                                                             | Missing Arial bold asset and faux-style synthesis                              |
| Example-1 | Date value differs (`04-11-2026` versus the render date)                  | XDP `Num2Date(Date(), "DD-MM-YYYY")`                                                                                                                                                       | Live runtime value, not a fidelity bug                                         |
| Example-2 | Body text is outlined in Adobe, so text extraction is not a usable oracle | 286 versus 10,151 characters; 8,412 drawings                                                                                                                                               | Microsoft Print To PDF path                                                    |
| Example-2 | Page 3 and page 4 carry the largest deltas                                | 15.46% and 13.27% EN; 16.84% and 15.26% ESP                                                                                                                                                | Downstream shifts from corrected paragraph pitches and pagination              |
| Example-2 | Table heading and table split was fixed                                   | Heading on page 4, whole table on page 5, header 99.0-115.5 and data 115.5-129.5 contiguous                                                                                                | Recent whole-table move; residual is page-placement risk, not the old gap band |
| Example-3 | Degree signs dropped in the regular Arial runs                            | Adobe has six `°R` runs on page 0 (three at 5.88 pt and three at 6.48 pt) and six at 6.48 pt on page 1; ours keeps the 5.9 pt oblique `°R` runs but renders the 6.5 pt regular runs as `R` | Arial subset coverage plus glyph sanitization                                  |
| Example-3 | URL wraps one character later                                             | Adobe `...805ee9`, ours `...805ee9e`                                                                                                                                                       | Font width and break opportunity differences                                   |
| Example-3 | One extra table row on page 0                                             | Extra `Dpmbtzs` and related cell values                                                                                                                                                    | Pagination row-height accumulation                                             |
| Example-3 | Watermark is text in our output and outlined in Adobe's                   | `DDAZT` extractable here, not in Adobe                                                                                                                                                     | Print outline path and font substitution                                       |
| Example-3 | Footer rows offset by about 1.3 to 1.8 pt                                 | Recorded in the remaining-visual-defects plan                                                                                                                                              | Table minH and row-height rules                                                |
| Example-3 | Thick borders centre-stroked instead of filled inward                     | Border extraction and prior research                                                                                                                                                       | Different border geometry model                                                |
| All       | Page box differs by 0.04 x 0.03 pt                                        | 595.32 x 841.92 versus 595.28 x 841.89                                                                                                                                                     | Print driver rounding versus A4 definition                                     |
| CN        | No comparison possible                                                    | No Adobe-generated CN PDF                                                                                                                                                                  | Missing oracle                                                                 |

## 5. What is fundamentally unattainable

These items cannot be made 1:1 with a static Node.js renderer alone:

1. **Acrobat runtime behaviour.** `AcroForm.ppi` and `EScript.ppi` depend on
   Acrobat's plug-in host, registry entries and JavaScript environment. Running
   the same interactive scripts, dialogs, file I/O and field actions requires
   Acrobat or an equivalent host.
2. **CoolType rasterization and hinting.** Even with identical font files, a
   different rasterizer produces different anti-aliasing and subpixel
   placement.
3. **Adobe font versions.** Arial bold, italic, narrow, CJK and symbol faces
   are not distributable with this package. Metric-compatible substitutes
   change glyph shapes and sometimes widths.
4. **The print-driver device grid.** The Adobe references were printed through
   Microsoft Print To PDF, which rounds page boxes, quantizes strokes and
   outlines text. Matching that output exactly would mean reproducing a
   specific Windows printer driver, not Designer.
5. **Cross-rasterizer pixel equality.** Two renderers with different font
   shaping, hinting and anti-aliasing cannot produce identical pixels even
   from the same vector description.
6. **Full XFA and Acrobat object model.** The complete form DOM, XPath engine,
   connection sets, web services and host APIs are a platform, not a PDF
   feature.

## 6. What is attainable: phased roadmap

Effort scale: **S** is days, **M** is one to three weeks, **L** is a month or
more, **XL** is a multi-month engine effort. Estimates assume one experienced
engineer familiar with the codebase.

### P0 — Oracle and measurement hygiene

**Goal:** make parity claims testable before changing layout.

- Freeze non-deterministic fields for comparison (for example `Date()`) or
  record the render timestamp alongside the oracle.
- Obtain at least one genuine Preview PDF or Designer "Save As PDF" oracle for
  each fixture, including CN. Treat print-driver PDFs as a separate oracle tier.
- Wire `reference/tools/make-probes.mjs`, `extract-pdf-facts.py` and
  `derive-metrics.py` into a documented local verification workflow.
- Add a page-attribution and geometry regression harness: page count, page box,
  text-run positions, drawing bounds, raster difference and font list.
- Define acceptance tolerances (see section 7) and a baseline report.

Effort: M. Dependencies: a machine with Designer and the Adobe fonts.
Risk: without genuine oracles, P1 and P2 gains cannot be proven.

### P1 — Metrics, fonts and text parity

**Goal:** make text measurement and painting agree with each other and with
Adobe more closely.

- Pin the effective ascent and descent for each synthesized base-14 face using
  probe forms and Adobe output; unify `fontAscent`, `defaultAscent` and
  pagination on one model.
- Implement per-glyph 1/1000 pt quantization and determine whether flag
  `0x1000` suppresses it.
- Use real font metrics for layout measurement of every embedded or
  user-supplied face; remove the `0.5 em` fallback from the production path.
- Add Arial Bold, Italic and BoldItalic assets with acceptable licensing, or
  implement a documented metric-compatible strategy and test the widths.
- Implement per-glyph font fallback with charset probes, so missing glyphs are
  substituted instead of dropped.
- Fix the bundled Arial subset so common symbols such as the degree sign are
  covered.
- Add strikeout, small caps, super/subscript and the missing rich-text CSS
  properties that affect visible output.
- Add hyphenation and ICU-compatible line breaking for CJK and Thai, and bidi
  reordering for RTL scripts.

Effort: M for metrics and fallback; L for bidi and shaping; L for full
hyphenation. Dependencies: font assets, ICU or equivalent, shaping library.
Risk: font licensing and metric differences can block exact matches.

### P2 — Layout, pagination and table parity

**Goal:** replace coordinate bucketing with a page-aware layout pass.

- Implement incremental layout against the destination content area so content
  after a break is re-measured rather than shifted.
- Port or reimplement the visible parts of `contentBlockToPage`: break targets,
  keep scopes, page and content-area selection, page and occurrence iterators.
- Implement table overflow, repeated headers, row continuation and
  leader/follower fields.
- Model table row growth from wrapped content and reconcile fixed, min and max
  heights.
- Make layout height reservation match caption placement for top, bottom and
  inline captions.
- Unify rich-text ownership metrics with styled run metrics at page breaks.
- Implement 270-degree and arbitrary rotation transforms consistently in
  layout, clipping and paint.

Effort: L to XL. Dependencies: P0 oracles and P1 metrics. Risk: this is the
largest behavioural change and can regress every fixture.

### P3 — Graphics, images and barcodes

**Goal:** stop silent wrong output and cover common print assets.

- Replace the GIF stub with a real LZW decoder; add compressed TIFF, CCITT G4
  and JPX decoding or direct JPX XObject emission; reject unsupported images
  with a warning instead of silence.
- Add SVG rendering for the subset used by Designer forms.
- Implement pattern fills, blend modes, soft masks, CMYK colours and ICC output
  intents if colour-managed output is required.
- Implement QR, DataMatrix, Aztec and the GS1/4-state barcode families used by
  the target forms; until then, fail loudly instead of falling back to Code 39.
- Fix arc, circle and line geometry; support image rotation.

Effort: M for image and barcode correctness; L for SVG and colour management.
Dependencies: decoder libraries or vendored tables; barcode specifications.
Risk: native codecs or large tables conflict with the package size budget.

### P4 — PDF interactivity and accessibility

**Goal:** make the generated PDF behave more like a LiveCycle document when
opened in a viewer.

- Emit field calculation, validation and format actions and field hierarchies;
  consider Acrobat-compatible JavaScript only after a security review.
- Implement radio groups with `/Kids` and selected-child state.
- Generate XFA-authored links, annotations and bookmarks.
- Make optional content groups own their content.
- Add tagged-PDF marked content and structure mapping.
- Add AES-256 and certificate security if required.
- Support output intents and PDF/A only if a consumer needs them.

Effort: L to XL. Dependencies: an interactive oracle and Acrobat testing.
Risk: actions and scripting expand the security surface.

## 7. Acceptance gates

A parity change should not merge unless it meets these gates.

| Gate                    | Threshold                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Page count and page box | Exact page count; page box within 0.1 pt of the chosen oracle tier                                |
| Page attribution        | Every table row and text block on the same page as the oracle                                     |
| Text content            | Same visible text and glyph set; no missing or duplicated characters                              |
| Baseline position       | Within 0.5 pt of the oracle where the oracle has extractable text                                 |
| Horizontal position     | Within 0.5 pt for left-aligned runs and within 1 pt for centred or justified runs                 |
| Border centre line      | Within 0.5 pt; do not compare filled-bar geometry to centre strokes                               |
| Raster difference       | Below a threshold agreed per fixture at 300 dpi; record the baseline at the same dpi and renderer |
| Regression suite        | No existing unit or integration failure; new regression test fails without the fix                |
| Documentation           | Gap table status and `AI_WIKI.md` ledger updated in the same change                               |

The raster threshold should be expressed as a percentage of non-background
pixels, not as a raw pixel count, because page area varies. It should be
calibrated once with a known-good change and reviewed when fonts change.

## 8. Recommended definition of done

For static forms:

1. L0 deterministic input is enforced for every comparison.
2. L1 structural parity holds for all fixtures with an oracle, including CN
   once an oracle exists.
3. L2 geometric parity holds within the gates above for text runs, table rows,
   borders and images.
4. L3 raster parity holds within the agreed threshold at normal viewing and
   print resolution.
5. Unsupported features fail with a warning or error code instead of silent
   fallback.
6. The gap inventory marks each closed item with a regression test.

Do not claim L3 pixel parity or L5 runtime parity. Do not claim L1 parity for a
fixture without an oracle.

## 9. What not to do

- Do not chase pixel equality with Microsoft Print To PDF. That target measures
  a Windows print driver, not Designer's layout.
- Do not port or link the Adobe DLLs. They are Windows proprietary binaries and
  the reference folder is evidence only.
- Do not bundle all Adobe fonts without a licence. The current package
  deliberately ships only redistributable faces.
- Do not hard-code fixture offsets to make one form match. The repository rules
  forbid fixture-specific constants and the next form will regress.
- Do not treat `supported-features.json` as truth until its overstated entries
  are corrected.
- Do not claim full XFA, Acrobat scripting or accessibility support while the
  implementation remains a static subset.

## Appendix A — Measurement details

Commands used for this snapshot:

```bash
# Page count, fonts, text and drawing counts
python3 - <<'PY'
import pymupdf
for name in ['Example-1','Example-2-EN','Example-2-ESP','Example-3']:
    a = pymupdf.open(f'test/fixtures/sample-forms/Adobe-generated-results/{name}.pdf')
    r = pymupdf.open(f'test/fixtures/sample-forms/results/{name}.pdf')
    for label, doc in [('adobe', a), ('ours', r)]:
        chars = sum(len(p.get_text('text')) for p in doc)
        drawings = sum(len(p.get_drawings()) for p in doc)
        print(name, label, len(doc), chars, drawings)
PY

# Per-page raster difference at 110 dpi, threshold 60/255
python3 - <<'PY'
import pymupdf, numpy as np
for name in ['Example-1','Example-2-EN','Example-2-ESP','Example-3']:
    a = pymupdf.open(f'test/fixtures/sample-forms/Adobe-generated-results/{name}.pdf')
    r = pymupdf.open(f'test/fixtures/sample-forms/results/{name}.pdf')
    for i in range(min(len(a), len(r))):
        pa, pr = a[i].get_pixmap(dpi=110), r[i].get_pixmap(dpi=110)
        A = np.frombuffer(pa.samples, np.uint8).reshape(pa.height, pa.width, pa.n)[..., :3]
        R = np.frombuffer(pr.samples, np.uint8).reshape(pr.height, pr.width, pr.n)[..., :3]
        diff = (abs(A.astype(int) - R.astype(int)).max(axis=2) > 60).mean() * 100
        print(name, i, round(float(diff), 2))
PY
```

The exact numbers can change with the rasterizer and the render date. Record
the date, dpi and threshold with every baseline.

## Appendix B — Evidence map

| Topic                                      | Primary evidence                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Reference pipeline                         | `reference/README.md`, `reference/analysis/analysis.md`                                         |
| Font metrics and quantization              | `reference/analysis/font-metrics-and-advances.md`, `reference/RENDERING_BEHAVIOR.md`            |
| Presence, borders, rotation and sizing     | `reference/RENDERING_BEHAVIOR.md`                                                               |
| Template, layout, data and script binaries | `reference/analysis_exports.json`, `reference/decompiled/*_disasm.c`                            |
| Barcode surface                            | `reference/Adobe-LiveCycle-Designer-11.0/barcode_data/`, `jftext_disasm.c`                      |
| Script signatures                          | `reference/Adobe-LiveCycle-Designer-11.0/script_templates/FormCalc_fn.ini`, `JavaScript_fn.ini` |
| Locale data                                | `reference/Adobe-LiveCycle-Designer-11.0/EN/LocalesList.xml`, `src/config/xfa-locales.json`     |
| Current layout and pagination              | `src/domain/layout/apply-pagination.ts`, `table-engine.ts`, `position-engine.ts`                |
| Current text and fonts                     | `src/rendering/text/`, `src/rendering/font-manager.ts`, `standard-fonts.ts`                     |
| Current images and barcodes                | `src/rendering/image-embedder.ts`, `barcode-renderer.ts`, `pdf417.ts`                           |
| Current PDF features                       | `src/adobe/`                                                                                    |
| Feature claims                             | `src/config/supported-features.json`                                                            |
| Existing parity history                    | `docs/02-research/2026-11-2*.md`, `docs/03-plans/2026-11-2*.md`, `docs/01-canonical/AI_WIKI.md` |

## Appendix C — Glossary

| Term                     | Meaning                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| ADS                      | Adobe Document Services, SAP-hosted LiveCycle output                   |
| CoolType                 | Adobe's font rasterization and metrics engine                          |
| AGM                      | Adobe Graphics Model, the 2-D drawing layer                            |
| AdobePDFL                | Adobe PDF Library, the PDF writer used by Designer and Acrobat         |
| XFA                      | XML Forms Architecture, the form model inside XDP                      |
| XDP                      | XML Data Package containing template, data, config and related packets |
| Content area             | The region of a page in which flowed content is laid out               |
| `contentBlockToPage`     | The reference layout operation that assigns content blocks to pages    |
| Overflow leader/follower | Fields or subforms that continue content on a later page               |
| Keep scope               | Rules that keep related content together across a break                |
| L1, L2, L3               | Structural, geometric and ink parity levels defined in section 2       |
