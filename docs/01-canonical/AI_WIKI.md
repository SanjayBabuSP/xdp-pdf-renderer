# AI Wiki — xdp-pdf-renderer (source of truth)

This file is the **authoritative explanation of why the code is the way it is**.
Source code intentionally contains no explanatory comments. If you change code,
you **must** update this file in the same change.

## 0. Mandatory protocol for AI agents and maintainers

1. **Read this file before editing any code.** Also read
   `reference/RENDERING_BEHAVIOR.md` for the Adobe evidence behind rendering
   decisions, and `README.md` for the public API.
2. **Code contains no inline rationale.** Do not re-add comments to explain
   behaviour. Put the explanation here instead. TSDoc on the exported public
   API is the only exception.
3. **Every code change must update this file:**
   - Add or update the relevant section below with _what_ changed and _why_.
   - Add a dated entry to §11 (Change ledger). Reference the file/function and
     the evidence (fixture diff, decompiled source, test, measurement).
   - If the change fixes a bug that could regress, add a test that fails
     without the fix and record that test in §10.
4. **Do not invent fixture-specific hacks.** Fixes must be generic: derive them
   from XFA semantics, Adobe reference output, or decompiled evidence. A rule
   observed in one fixture must be marked as such and kept isolated.
5. **Verify before finishing:** see §9. All commands must pass.

## 1. Purpose and scope

Render a PDF from three inputs — an XDP/XFA template, an XSD schema, and XML
data — in Node.js with no SAP or Adobe runtime dependency. It is an educational
re-implementation of Adobe LiveCycle Designer's "Preview as PDF" behaviour.

- Public API: `render()`, `validate()`, `compile()`, `inspect()` and
  `ERROR_CODES` in `src/index.ts`; `renderFormToPdf()`, `validateFormInputs()`
  and `compileTemplate()` in `src/workflows/render-pdf.ts`. CLI in `src/cli.ts`.
- `validate()` stops after parse/validation/mapping and pre-layout scripts;
  `compile()` caches parsed template data for repeated data sets.
- Purity rule: everything under `src/domain/`, `src/lib/`, and `src/config/` is
  pure (no I/O). `src/rendering/` is the PDF I/O boundary and `src/adapters/`
  holds runtime adapters such as the `vm` sandbox.
- Every fallible operation returns `Result<T> = { success: true; data: T } |
{ success: false; error: ErrorResult }` (`src/lib/result-type.ts`).
- Schema/binding problems are warnings by default; `strictValidation: true`
  makes them hard failures. Adobe renders partially mismatched documents.
- Style: use truthiness for nonempty collections (`.length`, not
  `.length > 0`). Explicit zero checks are only for numeric comparisons.

## 2. Repository map

| Path                              | Responsibility                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/workflows/render-pdf.ts`     | Orchestrates the full pipeline; only I/O at the end                                                                                    |
| `src/domain/parsing/`             | XDP → `LayoutModel`, XSD → schema model, XML → data object                                                                             |
| `src/domain/validation/`          | Structure/schema/binding validation                                                                                                    |
| `src/domain/mapping/`             | Binding resolution, repeat expansion, conditions, embeds                                                                               |
| `src/domain/scripting/`           | FormCalc + JavaScript engines, SOM resolver, event dispatch, property writes; `formcalc/evaluator/` holds per-function-family builtins |
| `src/domain/layout/`              | Flow / position / table engines, sizing, pagination                                                                                    |
| `src/rendering/`                  | pdf-lib rendering: text, borders, images, fonts, gradients; `pdf-renderer/` holds per-element renderers                                |
| `src/rendering/text/`             | Line metrics, measurement, wrapping, rotation                                                                                          |
| `src/adapters/`                   | Runtime adapters; `vm` sandbox creation and realm hardening                                                                            |
| `src/lib/`                        | Units, XPath, XML helpers, value formatting, results                                                                                   |
| `src/adobe/`, `src/config/`       | Adobe compatibility helpers and config-as-data                                                                                         |
| `reference/`                      | Decompiled DLL evidence and observed rendering behaviour                                                                               |
| `docs/`                           | Structured docs: canonical, research, plans, decisions, reference; this wiki is the maintained entry point                             |
| `.skills/`                        | Canonical installed JS/TS coding skills; `.agents/skills/` holds discovery links                                                       |
| `test/unit/`, `test/integration/` | Regression suites                                                                                                                      |
| `test/fixtures/sample-forms/`     | Sanitized real forms + Adobe-generated reference PDFs                                                                                  |

### Where do I change X

| Change                                   | Start here                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Public options, return type, error codes | `src/types.ts`, `src/errors/error-codes.ts`, `src/index.ts`                                          |
| Compile-once template reuse              | `src/workflows/render-pdf.ts` (`compileTemplate`), `src/types.ts` (`CompiledTemplate`)               |
| CLI flags and output                     | `src/cli.ts`, `test/unit/cli.test.ts`                                                                |
| Pipeline order, cancellation, timeout    | `src/workflows/render-pdf.ts`                                                                        |
| XDP/XSD/XML parsing                      | `src/domain/parsing/`                                                                                |
| Bindings, repeats, conditions, embeds    | `src/domain/mapping/`                                                                                |
| FormCalc or JavaScript scripts           | `src/domain/scripting/`, `src/domain/scripting/formcalc/evaluator/`, `src/adapters/vm-sandbox.ts`    |
| Layout, pagination, table geometry       | `src/domain/layout/`                                                                                 |
| PDF drawing, fonts, images, barcodes     | `src/rendering/`, `src/rendering/pdf-renderer/`                                                      |
| XDP element parsing                      | `src/domain/parsing/parse-xdp/`                                                                      |
| Font loading and subsetting              | `src/rendering/font-manager.ts`, `src/rendering/font-registry.ts`, `scripts/subset-dejavu-fonts.mjs` |
| Package size and PDF417 tables           | `scripts/check-pack-size.mjs`, `scripts/compact-pdf417-tables.mjs`, `src/rendering/pdf417.ts`        |
| Adobe PDF features                       | `src/adobe/`                                                                                         |
| Build, lint, CI, coverage gates          | `package.json`, `eslint.config.mjs`, `jest.config.js`, `.github/workflows/`                          |
| Docs and agent rules                     | `AGENTS.md`, `docs/`                                                                                 |

## 3. Pipeline (exact order matters)

`src/workflows/render-pdf.ts` → `renderFormToPdf()`:

1. **Parse** — `parseXdp`, `parseXsd`, `parseXmlData`. Input size bounded.
2. **Validate** — `validateXdpStructure`, `validateDataAgainstSchema`,
   `validateBindings`. Warnings unless strict.
3. **Map** — `resolveBindings`, `expandRepeats`.
4. **Scripts (pre-layout)** — `dispatchScripts`. Adobe order:
   ready($form) → initialize (+indexChange) → calculate → validate → overlay →
   ready($layout). Runs before positions are committed so layout sees results.
5. **Embeds** — `resolveXfaEmbeds` after scripts, before conditions (conditions
   drop hidden nodes that embeds reference).
6. **Layout** — `computeLayout`: conditions → `calculatePositions` →
   `applyPagination`.
7. **Scripts (post-layout)** — `dispatchPostLayoutScripts` (`docReady`) runs on
   the paginated tree, after layout and before rendering.
8. **Render** — `renderPdfWithDoc` → `renderPage` → master-page children first,
   then content children.
9. **Metadata** — Info/XMP overrides, `/NeedsRendering`, catalog fields.

## 4. Layout and positioning invariants

- `calculatePositions` lays out the root against the **first page's** content
  area; `applyPagination` translates each slice onto that page's own origin.
- Engines selected by `subform.layout`: `tb`/`lr-tb`/`rl-tb` → flow,
  `position` → absolute, `table`/`row` → table. Illegal values fall back to
  position (decompiled evidence: `xfalayout_disasm.c:15853-15926`).
- **Table cell width:** a laid-out table cell's `position.w` is overwritten with
  the computed column width (`table-engine.layoutRow`). Authored `w` on a cell
  only informs `calculateTableLayout`'s auto-column sizing; it must not survive
  into the final box. Example-3 page 2 had a 56.553mm label draw inside a
  48.948mm column, producing a stray border 7.6pt past the column edge.
- **Table cell height:** every cell in a `row` is drawn at the row's shared
  height. Individual `minH`/content heights still determine that maximum, but
  the rendered boxes must agree. Example-3 page 2 had 9.6pt value-cell borders
  in a 14.2pt row, leaving visible gaps under the values; Adobe draws all cells
  at the full row height.
- **SubformSet row pitch:** a table `subformSet` advances by the shared content
  height of its rows, never a hard-coded minimum. Example-2 EN previously used a
  7mm (19.84pt) pitch while its cells were 17.2–17.9pt tall, leaving ~2pt gaps
  that made vertical borders look dashed. `layoutSubformSetRows` now uses
  `result.height` for both the row box and the next row's offset.
- `flow-engine.ts` `declaredWidth()` swaps `w`/`h` for rotated nodes.
  `alignOffset()` honours `'middle'` as centre (only `'center'` worked before,
  which left short `vAlign="middle"` children top-aligned).
- **Rotation origin:** for an authored `rotate="90"` box, XFA `x/y` describe the
  unrotated box; the visual footprint is `x..x+h` by `y-w..y` — authored `y` is
  the **visual bottom**. Flow-positioned rotated draws (only `minH` + `w`) get a
  visual-**top** `y` from the flow cursor. `position-engine.getChildY()`
  subtracts `w` only for authored `rotate=90` positions so both conventions
  converge. Without this, rotated captions render one full cell too low.
- **Master-page children** are rendered directly, not part of the root flow.
  `calculatePositions` lays out each page's `masterPageChildren` in absolute
  page coordinates: position subforms get ctx `(0,0)`; flow subforms and leaf
  nodes get ctx `(position.x, position.y)`.
- **Sizing fallback:** when `w`/`h` are absent, rendering uses authored
  `minW`/`minH`. Master-page widgets skip the layout engine, so without this a
  field with only `minW`/`minH` collapsed to `0 × 18pt` and clipped its caption.
- **Anchor type:** positioned `x`/`y` locate the anchor point named by
  `anchorType`, not always the top-left corner (`getChildX`/`getChildY`
  shift by `w`/`h`: right → `x−w`, center → `x−w/2`, bottom → `y−h`,
  middle → `y−h/2`; unknown extents keep the authored point). Example-3
  `R310` (`anchorType="bottomRight"`) was painted one full height too low
  at y 440–533 while Adobe paints it at y 348–440.
- **Rotated visual height:** a 90/270-degree rotated draw occupies
  `authored w` points of vertical flow space, not authored `h`
  (`layoutLeafDraw` returns the visual height while the laid box keeps the
  renderer's width/height convention). Pagination measures the same visual
  height (`visualHeight` in `apply-pagination`) so rows are not stretched
  back by the overflow guard. Example-3 `Draw_0073` (`w=4mm h=5.233mm
rotate=90`) made its `lr-tb` row 14.84pt tall; Adobe's row is ~11.3pt.
- **Whole-unit page shift:** a container that straddles a page boundary is
  shifted whole to the next page *before* its children are walked
  (`wholeUnitShift` pre-check in `walkContainer`), so children evaluate
  post-shift positions instead of shifting individually and then riding the
  parent a second time. Without this, a straddling child shifted first and
  the parent shift stacked on top, leaving a gap band inside the container
  (Example-2 `Ruvlviqd` table data row sat 13.5pt below its header).
- **Fitting tables move whole:** when table content overflows the page
  bottom but the table fits on a page, `collectTail` moves the whole table
  node instead of splicing loose leaves (`contentEnd` overflows, `visualHeight`
  fits the content area). The previous leaf-splicing left an emptied shell
  with a phantom gap band on the old page and orphan bordered cells on the
  new one; Adobe keeps the `Ruvlviqd` table whole on one page.

## 5. Text, fonts and metrics

- Default line advance is **1.2 × fontSize** (`font_disasm.c:10517`), not the
  XDC `lineHeight` static value. XDC `lineHeight = 1000 + lineGap*1000 = 1200`.
- Vertical metrics: Adobe clamps `ascent = max(A, 1 - D)` em (§2a of the
  reference). Applied in `src/rendering/text/line-metrics.ts`. The exact
  CoolType descent for synthesised base-14 faces is still unknown (~0.79 em
  expected for Helvetica vs pdf-lib's 0.718) — this is the main source of the
  residual ~1–2pt baseline drift.
- Glyph advances are quantized to **1/1000 pt** with a +1.75 nudge
  (`src/rendering/text/measure.ts`). Whether flag `0x1000` suppresses this is
  unmeasured.
- Slash is a **line-break opportunity after the character**: when a token does
  not fit, `line-breaker.ts` tries the longest `/`-terminated prefix before
  pushing the whole token to the next line. Observed in Example-3 page 2:
  Adobe wraps `...Inxvat Nbpiiqg/` / `Ngdrlod`; plain whitespace wrapping
  produced `...Inxvat` / `Nbpiiqg/Ngdrlod`.
- Font resolution: `ArialMT` must not resolve to a different face; Arial Narrow
  uses horizontal scaling (`Tz`), not a different font. Font resources are
  de-duplicated per page.
- Font reads on the render path use `fs/promises`; `FontManager.preload()` loads
  the two DejaVu fallback faces once per process and deduplicates concurrent
  reads. The mtime/size keyed byte cache is unchanged. Bundled DejaVu files are
  reproducible subsets (`npm run fonts:subset`) covering Latin, Greek,
  punctuation, currency, arrows and math; sample-form extracted text is
  unchanged.
- **CFF subset header:** `@pdf-lib/fontkit@1.1.1` writes `offSize: cff.length`
  instead of `cff.offSize` in `CFFSubset.encode()`, producing an invalid
  `/FontFile3` for every CFF/OpenType face. `createPatchedFontkit()`
  (`cff-subset-patch.ts`) patches the first emitted CFF stream byte for CFF
  subsets; TrueType subsets are untouched. Without this, SimSun resolves
  correctly to Adobe Song Std but CJK glyphs render as tofu boxes.
- **Rich-text paragraph CSS:** XFA stores label styling on `<p style>` (e.g.
  `font-weight:bold`, `text-decoration:underline`, `font-size:12pt`,
  `font-family:'Arial Narrow'`), not on `<span>` or `<b>`. `parseRichText()`
  applies CSS from `p`/`div`/`body`/`span` through the state stack, so nested
  spans override and closing tags restore. `TextRun.fontFamily` drives both
  font selection and `Tz` horizontal scaling.
- Caption/value baselines: both use `layoutLines()` on the full value box so a
  caption and its value share one baseline. Clipping the caption to its strip
  prevents "Pos." painting over "Machine location".
- Rich captions with a spacerun + trailing `+`/`-` are painted **once**, split
  into label + right-aligned symbol with an underline; the plain full-text draw
  is skipped (`captionPainted` guard) to avoid double-painting the label.
- Lexical decimals are preserved: float/decimal values stay strings, so
  `0,006` is not truncated to `0` by integer coercion.
- `spaceAbove`/`spaceBelow`, `textIndent`, `marginLeft/Right`, `lineHeight` are
  parsed into `ParaSpec` and applied to values, draws and rich runs. `lineHeight`
  as a percentage is not yet interpreted.
- **Rich text ignores `<para>` lineHeight:** for `richText` values the line
  advance comes from authored CSS `line-height` or the 1.2em font default;
  the draw `<para>` lineHeight only governs plain-text values. Layout
  (`drawValueHeight`) and painting (`renderRichText`) both omit the para
  fallback so box and glyphs agree. Example-2 `Draw_0040` carries
  `<para lineHeight="30pt">` over two 12pt paragraphs (CSS 22.5pt on the
  second, none on the first); the old 30pt pitch overflowed the authored
  16.018mm box so the next draw started 8.2pt above the bold line's bottom
  and the two texts overlapped. Adobe's band for the same lines is 33.3pt,
  matching the CSS/default pitch.
- **Split-fragment re-anchoring:** when pagination splits a text value
  mid-line, the first owned line can start above its page band and the
  renderer used to clip its top (`alignFragmentBand` in
  `line-metrics.ts`). Top-aligned fragments now shift owned baselines so
  the first owned line top meets the band top and extend the clip to the
  last owned line bottom; aligned fragments render byte-identically to
  before. Example-2 `Draw_0062` line 8 straddles the page 3/4 boundary and
  was painted 8.2pt too high with cut glyph tops; Adobe paints the
  continuation line whole from the content top.
- **NBSP without subset coverage:** `sanitizeTextForFont` preserves
  whitespace, but the bundled Arial subset lacks U+00A0, so the encoder
  emitted `.notdef` tofu boxes. Blank separators missing from a known font
  charset are now substituted with a regular space (newlines/tabs keep
  their semantics). Example-2 footer `Pages` draw padded the page number
  with NBSP spaceruns and rendered `□5□`; Adobe renders blank padding.
- **Unicode line/paragraph separators:** `breakLinesInfo` splits paragraphs
  on U+2028 (line break, same paragraph) and U+2029 (paragraph break) in
  addition to CR/LF. A literal U+2028 used to tokenize as whitespace, so
  `Wqxuhgiyni<U+2028>Bbpiy` rendered one clipped line; Adobe breaks it
  into two lines.
- **Plain-text draws always wrap:** `draw.ts` no longer disables wrapping
  when the inner box fits fewer than two lines. Layout already wrapped the
  same text, so the renderer now honours the layout line count and the
  vertical-overflow clip keeps the visible lines inside the cell. Example-2
  table row labels rendered one clipped line in a minH 28.8 row; Adobe
  renders both wrapped lines.
- **Rich inter-line gap uses the current line:** `layoutRunBaselines`
  stacks each baseline by its own advance (pre-advance), not the previous
  line's (post-advance); the block total is unchanged. Example-2 `Draw_0040`
  Kjehye→bold was 14.5 (previous default) vs Adobe 22.4 (bold CSS 22.5),
  and bold→Ssriworga was 23.8 vs Adobe 15.8; totals match (38.2 vs 38.3).
- **Field default lineHeight is container-capped:** an explicit XFA
  `lineHeight` still wins, otherwise a field advances
  `1.2 × min(own size, inherited size)` (`inheritedFontSize` stamped at
  parse time; draws keep the own-size default). Example-2 repeated 12pt
  fields pitched 20.07 vs Adobe 17.67 (1.2 × 10pt parent); 6.5pt fields
  keep their own 7.8. Example-1 caption/value rows stay aligned.

### 5.1 Locale-aware picture formatting

- `src/lib/locale-format.ts` normalizes XFA IDs (`de_DE → de-DE`), rejects
  invalid values without throwing, and caches `Intl` formatters for month/day
  names, meridiem text and number separators.
- Effective locale precedence is `RenderOptions.locale` > field > subform >
  root XDP `locale` > `en-US`. With no locale, every formatter stays on the
  original English path so existing PDFs are byte-stable.
- Locale affects only picture expansion: month/weekday names (`MMMM`, `MMM`,
  `EEEE`, `EEE`), meridiem text (`A`, `AMPM`, `am`), and group/decimal
  separators. Picture grammar tokens, `AD`/`GMT`, `host.language`, `wordNum`,
  ISO/epoch helpers and diagnostics remain English/locale-neutral.
- `renderFormToPdf()` resolves the locale once and supplies it to embeds,
  scripts, layout measurement, pagination and rendering. Using different
  locales for measurement and painting would clip text or split lines wrongly.
- `formatValue` localizes both output and numeric input coercion; FormCalc and
  the JS host carry locale per instance (`FormCalcEnv`, engine config) so
  `Format`/`Parse` and `xfa.host.formatValue`/`unformatValue` stay symmetric.
- XFA `localeSet` authored patterns are not parsed; `Intl` data is the source
  of localized names and separators. There is no message translation layer.

## 6. Borders, images and rotation

- Edges: dash patterns scaled by thickness; cap/join map to PDF `J`/`j`; corner
  radius clamped to `min(w,h)/2`. Stroke widths are quantized to 3 decimals
  for layout/dash purposes (`quantizeStrokeWidth`).
- `collapseTinyGapEdges()` only suppresses a coincident parent edge when the
  visible child edges cover the parent's full x-span (3pt tolerance) and are at
  least as thick. Example-2 EN had a row separator disappear across the last
  column because one partial child edge was enough to prune the full-width
  parent edge.
- **PDF output stroke grid:** Adobe reference PDFs are Microsoft Print To PDF
  output at 600 dpi. Every emitted stroke width is an integer number of
  1/600in = 0.12pt device pixels, rounded **up** (`quantizeDeviceStrokeWidth`):
  0.5pt → 0.6, 1.067 → 1.08, 1.634 → 1.68. Dash patterns still use the authored
  3-decimal thickness so their ratios do not drift. XFA's specification default
  remains 0.5pt; the grid is an output-device property, not a layout value.
- A **lone unindexed `<corner radius>`** stamp renders square; indexed or
  multi-corner sets render rounded (`cornerRadii` gate in `parse-xdp.ts`). This
  is a single-fixture observation, not decompiled evidence.
- **Coincident borders collapse to the first paint:** edges sharing exact
  geometry and style paint once even when thicknesses differ; render order is
  outside-in so container borders win over inner cell edges. Equal-thickness
  repaints keep the fast rectangle path. Example-3's `Page` 1.63pt outer
  border and the big field's 0.5pt edge coincide at x≈49.3 and painted as a
  doubled line; Adobe paints one.
- Rotated rectangles are drawn with `w`/`h` swapped so label backgrounds stay
  in the narrow vertical strip.
- Images: PNG/JPEG/BMP are embedded; `xfa:embed` references are resolved after
  scripts. The gray `DDAZT` watermark is a 125pt caption at 30° in the master
  page; it must render on **both** Example-3 pages.

## 7. Data, XPath and scripting

- Repeat bindings use repeat-occurrence-scoped fallback in
  `src/lib/xpath-resolver.ts`; unindexed lookups must not leak across instances.
- `parseTagValue: false` preserves lexical values in `xml-utils.ts` /
  `parse-xml-data.ts`.
- FormCalc supports `PropAccess` (`.value`, `.rawValue`) on call results and
  `xfa.resolveNode()` reads and writes. SOM expressions resolve through
  `SomExpressionResolver`.
- Script writes to `fillColor`/`fontColor`/`borderColor`/`bgColor` are tracked
  by `PropertyChangeTracker` and applied before rendering. Cascades are capped
  at `ADOBE_MAX_CASCADE_DEPTH = 25`.
- `createSandbox` sets the context globals' prototype to `null` before creating
  the `vm` context. Without it, `(function(){ return this })()` reaches host
  `Object`/`Function` through the global prototype chain. Injected objects are
  still bridged into the sandbox realm, and `vm` remains a trusted-template
  mitigation rather than a hard boundary.

## 8. Pagination — known divergence

`apply-pagination.ts` remains a coordinate-bucketing approximation of
`contentBlockToPage`, not a faithful port. Example-3 page 0 keeps one extra
table row (`Dpmbtzs`) that Adobe moves to page 1. The break is unchanged by the
ascent clamp, so the cause is row-height accumulation, not font metrics.
Multi-line field/draw leaves are now split by whole wrapped lines: each page
fragment carries `textLineRange` and the renderer slices lines while keeping
baselines at their logical indices, so the same line is not drawn twice and a
continuation is not shown as clipped ascender slivers. Coordinates are converted
with the physical page height before comparing PDF baselines to page bands.
Marked as Medium confidence in `reference/RENDERING_BEHAVIOR.md` §8.

- **Mid-line splits grow the fragment band:** when the page grid cuts inside
  a text line, ownership assigns that line to the next page but the sliced
  band is shorter than the owned lines (`ownedBlockHeight` recomputes the
  owned span from the same ownership metrics). `extendFragmentBands` grows
  the band to fit and shifts following siblings down; still-overflowing
  trailing whole leaves move to the next page (nested-aware, span-guarded,
  no re-wrap; containers are never moved whole). Example-2 `Draw_0061` owns
  lines 5–9 in a 45.1pt band; after extension the band fits all five lines
  and `Draw_0062` shifts down instead of overlapping them.

## 9. Verification (all must pass)

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit          # 120 suites, 1571 passing / 1 skipped
npm run test:coverage      # thresholds: 94.2/84.3/95.4/96.3 (currently 96.70% lines)
npm run test:integration   # 17 suites, 92 passing / 1 skipped
node scripts/render-sample-forms.mjs
npm run check:size         # 371,943-byte tarball, budget 390,000
npm run check:publint
npm run check:types
npm audit --omit=dev
npm run bench
```

`.gitattributes` forces LF for text files and Prettier declares
`endOfLine: 'lf'`, so `format:check` behaves the same on Linux, macOS and Windows.

Rendered fixtures live in `test/fixtures/sample-forms/results/`; Adobe reference
PDFs in `test/fixtures/sample-forms/Adobe-generated-results/`. Compare with
`pdftotext -layout`, PyMuPDF word/bbox extraction, or raster crops. Do not add
fixture-specific code to make a diff disappear.

## 10. Regression tests that protect past fixes

| Test file                                                                                      | Protects                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/adobe/*`                                                                            | Adobe PDF feature helpers, metadata, security, fonts, namespaces                                                                                                                 |
| `test/unit/domain/scripting/*`                                                                 | SOM/proxy/dependency/FormCalc/JS engine internals                                                                                                                                |
| `test/unit/domain/mapping/*`, `test/unit/domain/validation/*`                                  | Repeat expansion, binding and schema/structure validation                                                                                                                        |
| `test/unit/rendering/*`, `test/unit/lib/*`                                                     | Image/fill/font/border/geometry helpers and value formatting                                                                                                                     |
| `test/unit/workflows/render-pdf.test.ts`, `test/unit/cli.test.ts`, `test/unit/barrels.test.ts` | Workflow options/branches, CLI wiring, public exports                                                                                                                            |
| Coverage gate                                                                                  | `npm run test:coverage`: 96.70% lines, 94.65% statements, 95.63% functions, 85.09% branches                                                                                      |
| `test/unit/lib/xpath-resolver.test.ts`                                                         | Repeat-scoped binding fallback                                                                                                                                                   |
| `test/unit/domain/parsing/parse-xml-data.test.ts`                                              | Lexical decimals / `0,006`                                                                                                                                                       |
| `test/unit/rendering/line-metrics.test.ts`                                                     | Ascent clamp, line advance                                                                                                                                                       |
| `test/unit/rendering/condensed-and-dedup.test.ts`                                              | Advance quantization, font dedupe                                                                                                                                                |
| `test/unit/rendering/baseline-and-caption.test.ts`                                             | Shared caption/value baseline                                                                                                                                                    |
| `test/unit/rendering/text-parity.test.ts`                                                      | Spacerun symbols, single caption draw                                                                                                                                            |
| `test/unit/rendering/border-parity.test.ts`                                                    | Per-corner fill/stroke, lone corner gate                                                                                                                                         |
| `test/unit/rendering/adobe-livecycle-parity.test.ts`                                           | Script colour writes, rotation origin, master-page minW/minH                                                                                                                     |
| `test/unit/rendering/line-breaker.test.ts`                                                     | Slash-preferred wrapping                                                                                                                                                         |
| `test/unit/rendering/stroke-width.test.ts`                                                     | 3-decimal layout width + 0.12pt output grid                                                                                                                                      |
| `test/unit/rendering/border-parity.test.ts`                                                    | Per-corner fill/stroke, lone corner gate, thick-edge survival, table cell width and shared row height, full-width edge coverage                                                  |
| `test/unit/rendering/cff-subset.test.ts`                                                       | Valid CFF `offSize` in embedded subsets                                                                                                                                          |
| `test/unit/domain/layout/engines.test.ts`                                                      | SubformSet row pitch equals shared cell height                                                                                                                                   |
| `test/unit/domain/layout/apply-pagination.test.ts`                                             | Multi-line fields split by line range across pages                                                                                                                               |
| `test/unit/rendering/rich-text-parser.test.ts`                                                 | Paragraph-level CSS, nested span overrides                                                                                                                                       |
| `test/unit/domain/scripting/formcalc-golden.test.ts`                                           | FormCalc property access / resolveNode                                                                                                                                           |
| `test/unit/lib/locale-format.test.ts`                                                          | Locale normalization, localized names, meridiem, separators                                                                                                                      |
| `test/unit/lib/value-format.test.ts`                                                           | XFA-style IDs, localized AM/PM and number separators                                                                                                                             |
| `test/unit/domain/scripting/evaluator-formats.test.ts`                                         | FormCalc localized format/parse round-trips                                                                                                                                      |
| `test/unit/domain/scripting/javascript-engine.test.ts`                                         | JS host localized numeric/meridiem formatting                                                                                                                                    |
| `test/unit/workflows/render-pdf.test.ts`                                                       | Normalized `RenderOptions.locale` reaches rendering                                                                                                                              |
| `test/unit/domain/scripting/js-sandbox-escape.test.ts`                                         | Host `process` cannot be reached from script globals                                                                                                                             |
| `test/unit/cli.test.ts`                                                                        | CLI version from `package.json` and validate wiring without PDF output                                                                                                           |
| `test/unit/barrels.test.ts`                                                                    | Root exports, error hints and typed error codes                                                                                                                                  |
| `test/unit/rendering/font-manager.test.ts`                                                     | Font byte cache and `FONT_NOT_FOUND` path                                                                                                                                        |
| `test/unit/workflows/fuzz-inputs.test.ts`                                                      | Malformed inputs never throw out of `render()`                                                                                                                                   |
| `test/unit/lib/locale-format.test.ts`                                                          | Idempotent locale normalization property                                                                                                                                         |
| `test/unit/domain/scripting/js-sandbox-escape.test.ts`                                         | Global-object escape via null-prototype context and every injected object                                                                                                        |
| `test/unit/workflows/validate-only.test.ts`                                                    | `validate()` never enters PDF generation and keeps strict failure semantics                                                                                                      |
| `test/unit/workflows/compile.test.ts`                                                          | Compiled template output matches `render()`, with no data leakage between renders                                                                                                |
| `test/unit/rendering/font-manager.test.ts`                                                     | Async font reads and one shared default-font preload                                                                                                                             |
| `test/unit/rendering/font-registry.test.ts`                                                    | Async manifest loading and directory scanning                                                                                                                                    |
| `test/unit/rendering/pdf417.test.ts`                                                           | Compact base64 cluster tables decode to the dumped patterns                                                                                                                      |
| `test/unit/domain/scripting/formcalc-properties.test.ts`                                       | Arbitrary FormCalc source only raises typed parse errors                                                                                                                         |
| `test/unit/lib/value-format-properties.test.ts`                                                | Locale grouping preserves digits and pass-through stays verbatim                                                                                                                 |
| `test/unit/lib/value-format.test.ts`                                                           | Optional `z`/`#` fractions omit all-zero decimal separators                                                                                                                      |
| `test/unit/rendering/draw-text-whitespace.test.ts`                                             | Plain `<text>` draw values keep internal double spaces                                                                                                                           |
| `test/unit/rendering/glyph-coverage.test.ts`                                                   | Per-glyph omission against the resolved PDF font charset                                                                                                                         |
| `test/unit/rendering/font-manager.test.ts`                                                     | Arial regular subset, base-14 bold/italic variants, no whole-run DejaVu promotion                                                                                                |
| `test/unit/rendering/caption-para.test.ts`                                                     | Caption `<para>` parses and offsets painted caption text                                                                                                                         |
| `test/unit/rendering/url-break-opportunities.test.ts`                                          | Slash/ZWSP/SHY breaks without splitting `scheme://`                                                                                                                              |
| `test/unit/rendering/para-metrics.test.ts`, `run-flow.test.ts`                                 | Per-paragraph CSS line advances and spacer-only gaps                                                                                                                             |
| `test/unit/rendering/border-style.test.ts`, `border-parity.test.ts`                            | Effective stroke width, half-stroke and partial-coverage edge survival                                                                                                           |
| `test/unit/domain/layout/apply-pagination.test.ts`                                             | `pageFront`, `pageArea`/`contentArea`, trailing `breakAfter`, `vAlign=center`                                                                                                    |
| `test/unit/rendering/draw-text-wrapping.test.ts`                                               | Height-aware draw wrapping, insets and horizontal clipping                                                                                                                       |
| `test/unit/rendering/text-parity.test.ts`                                                      | Natural inline trailing-symbol position after `xfa-spacerun`                                                                                                                     |
| `test/unit/domain/mapping/resolve-embeds.test.ts`, `rich-text-parser.test.ts`                  | Tag-balanced embeds; font-weight cannot leak to following paragraphs                                                                                                             |
| `test/unit/domain/layout/pagination.test.ts`                                                     | Recursive explicit `keep` inside repeats; thin rules not dropped at page boundaries; straddling tables that fit move whole instead of splitting rows |
| `test/unit/rendering/border-parity.test.ts`, `stroke-width.test.ts`                            | Presence/y-aware edge suppression and coincident-edge de-duplication                                                                                                             |
| `test/unit/lib/xml-utils.test.ts`                                                              | Literal non-breaking spaces preserved in XML text nodes                                                                                                                          |
| `test/unit/rendering/stroke-width.test.ts`                                                     | Uniform-rectangle edge de-duplication across identical boxes                                                                                                                     |
| `test/unit/rendering/font-resolution.test.ts`                                                  | Condensed bold weight preserved and `Tz` scaling kept separate                                                                                                                   |
| `test/unit/rendering/draw-text-wrapping.test.ts`, `text-parity.test.ts`                        | CSS run-size line advance and clipped-fragment line anchoring                                                                                                                    |
| `test/unit/domain/layout/pagination.test.ts`                                                   | Leaf-only explicit `keep` avoids compounding ancestor shifts                                                                                                                     |
| `test/unit/rendering/draw-text-wrapping.test.ts`, `position-engine.test.ts`                    | Authored one-line draw height and URL clipping                                                                                                                                   |
| `test/unit/rendering/glyph-coverage.test.ts`                                                   | Full printable ASCII coverage including `&`                                                                                                                                      |
| `test/unit/domain/layout/apply-pagination.test.ts`                                             | Post-shift straddlers, exclusive line ownership and atomic tables                                                                                                                |
| `test/unit/rendering/line-metrics.test.ts`                                                     | Overflowing centred blocks top-align instead of shifting upward; fragment band alignment cases                                                                                   |
| `test/unit/domain/layout/apply-pagination.test.ts`                                             | Mid-line fragment band extension with sibling shift and tail move                                                                                                                |
| `test/unit/domain/layout/position-engine.test.ts`                                              | Rotated visual-height flow contribution; `anchorType` shifts positioned children to the top-left corner; rich text sizes from CSS/default advances, ignoring `<para>` lineHeight |
| `test/unit/rendering/text-parity.test.ts`                                                      | Protruding rich fragments re-anchor to the band top; rich-text line advance uses the font default when `<para>` lineHeight is authored                                           |
| `test/unit/rendering/glyph-coverage.test.ts`                                                   | Blank separators missing from a known charset become spaces; covered NBSP kept; tabs/newlines preserved                                                                          |
| `test/unit/rendering/border-parity.test.ts`                                                    | Coincident different-thickness borders paint once; partial overlaps repaint unseen sides                                                                                         |
| `test/integration/workflow/para-rendering.test.ts`                                             | Rich-text pitch ignores `<para>` lineHeight but keeps its margins and indent                                                                                                     |
| `test/unit/rendering/line-breaker.test.ts`                                                     | Slash-preferred wrapping; U+2028 line break and U+2029 paragraph break                                                                                                            |
| `test/unit/rendering/run-flow.test.ts`                                                         | Gap-by-own-advance baselines on top of per-paragraph CSS advances                                                                                                                  |
| `test/unit/rendering/para-metrics.test.ts`                                                     | Inherited-size default advance capped at the own size                                                                                                                             |
| `test/unit/domain/parsing/inherit-font-size.test.ts`                                           | Parse-time parent font-size stamping through subforms and groups                                                                                                                   |
| `test/unit/domain/layout/position-engine.test.ts`                                              | Rotated visual-height flow contribution; `anchorType` shifts positioned children to the top-left corner; rich text sizes from CSS/default advances, ignoring `<para>` lineHeight |
| `test/unit/rendering/field-inherited-spacing.test.ts`                                          | Repeated 12pt fields pitch at 1.2 × 10pt plus margins                                                                                                                             |
| `test/unit/rendering/field-caption-baseline.test.ts`                                           | Caption and value share one baseline in a fixed-height field                                                                                                                       |

## 11. Change ledger (append newest first)

### 2026-11-23 — straddling table double-shift and leaf-split

- `src/domain/layout/apply-pagination.ts`: `walkContainer` pre-checks a
  whole-unit page shift (`wholeUnitShift`: straddle + atomic + fits) before
  descending into children, so a straddling container moves whole and its
  children never shift twice; the post-walk block reuses the same helper.
  Reason: the last row of Example-2's `Ruvlviqd` table shifted +13.6 on its
  own, then rode the table's +30 whole shift, landing 13.6 below its header
  with a gap band; the table also grew to contain the shifted row.
- Same file `collectTail`: a straddling table that fits on a page moves whole
  instead of splicing loose leaves. Reason: leaf-splicing left an emptied
  shell plus a gap band on the old page and orphan bordered cells on the new
  page; Adobe keeps the table whole on one page.
- Tests: `pagination.test.ts` straddling-fitting-table case; all existing
  pagination/table tests unchanged.
- Sample PDFs regenerated. Oracle pixel diff: Example-2 EN p5 table now
  contiguous (header + data row, no gap band, no p4 shell); other diffs are
  downstream shifts from the corrected paragraph pitches.

### 2026-11-23 — paragraph spacing and table render parity

- `src/rendering/text/line-breaker.ts`: split on U+2028 (line break,
  `paragraphEnd: false`) and U+2029 (paragraph break). Reason: U+2028
  tokenized as whitespace, so Example-2 table row labels rendered one
  clipped line; Adobe breaks them into two.
- `src/rendering/pdf-renderer/draw.ts`: removed the `singleLine` bypass
  that disabled wrapping when the inner box fit fewer than two lines.
  Reason: the renderer disagreed with layout's wrapped line count and
  clipped labels the layout had already wrapped; Adobe renders the wrapped
  lines (vertical-overflow clip keeps them in the cell).
- `src/rendering/text/run-flow.ts` `layoutRunBaselines`: baseline gaps
  use the current line's advance. Reason: mixed-advance sequences gapped by
  the previous line (Kjehye→bold 14.5 vs Adobe 22.4); block totals are
  unchanged so uniform text is unaffected.
- `src/types.ts` + `src/domain/parsing/parse-xdp/inherit-font-size.ts`
  (new): stamp `inheritedFontSize` on draws/fields at parse time.
  `paraMetrics` takes it as the default-advance base, capped by the own
  size (`1.2 × min`). Field call sites (`position-engine`
  `valueLineHeight`/`nodeValueHeight`, `field.ts` value render,
  `apply-pagination` leaf baselines) pass it; draws keep own-size.
  Reason: repeated 12pt Example-2 fields pitched 20.07 vs Adobe 17.67
  (1.2 × 10pt context), while 6.5pt Example-1 fields keep 7.8 and stay
  aligned with their captions.
- Tests: `line-breaker.test.ts` (U+2028/U+2029),
  `run-flow.test.ts` (gap-by-own-advance),
  `para-metrics.test.ts` (inherited fallback + own-size cap),
  `inherit-font-size.test.ts` (stamp walker),
  `position-engine.test.ts` (field content heights),
  `field-inherited-spacing.test.ts` (repeated-field pitch end to end),
  `field-caption-baseline.test.ts` (caption/value shared baseline);
  `draw-text-wrapping.test.ts` and `single-line-wrap.test.ts` now expect
  wrapped overflow instead of one clipped run.
- Sample PDFs regenerated. Oracle pixel diffs: Example-1 p0 and
  Example-2 EN p0/p4/p5 and Example-3 p0 move toward Adobe; remaining
  whole-page deltas on EN/ESP p1–p3 are downstream shifts from the
  corrected pitches (line structures verified exact at Tm precision).
  Residual: table label pitch stays 13.2 (own default) vs Adobe 14.4
  (~1pt, row geometry is minH-clamped either way).

### 2026-11-22 — mid-line split band defects

- `src/domain/layout/apply-pagination.ts`: new `ownedBlockHeight`,
  `extendFragmentBands`, `collectTail` and recursive content-end helpers.
  Mid-line fragment bands grow to their owned lines, followers shift, and
  overflowing trailing whole nodes move to the next page. Example-2 page 5
  overlap and cutoff removed; verified by Tm pitch (uniform 14.4pt) and
  pixel-profile gaps against staged output and the Adobe reference.
- Tests: `fragment band extension` case in `apply-pagination.test.ts`;
  §10 row added.

### 2026-11-22 — footer grid, fragment cutoff and NBSP tofu defects

- `src/domain/layout/position-engine.ts` (`layoutLeafDraw`): 90/270-degree
  rotated draws contribute their visual height (authored `w`) to flow rows.
- `src/domain/layout/apply-pagination.ts`: new `visualHeight` helper drives
  box/page extents and straddler decisions so rows are not stretched back.
- `src/rendering/pdf-renderer/border-fill.ts`: geometry+style edge dedup
  across thicknesses (first paint wins); partial overlaps fall back to
  per-side lines. Example-3 footer doubling removed.
- `src/rendering/text/line-metrics.ts`: new `alignFragmentBand`; applied in
  `text.ts`, `draw.ts` and `field.ts` for top-aligned fragments. Example-2
  page-5 cutoff removed.
- `src/rendering/text/glyph-coverage.ts`: blank separators missing from a
  known charset become regular spaces. Footer `□5□` tofu removed.
- Tests: rotated height, fragment alignment, NBSP substitution,
  geometry-dedup and a protruding-fragment render case; §10 rows added.

### 2026-11-22 — rich-text line fallback and anchorType placement

- `src/types.ts`, `src/domain/parsing/parse-xdp/helpers.ts`: `Position`
  gains `anchorType`, parsed from the authored attribute.
- `src/domain/layout/position-engine.ts`: `getChildX`/`getChildY` convert the
  authored anchor point to the top-left corner (`R310`
  `anchorType="bottomRight"` moves from y 440–533 to the Adobe position
  y 348–440); rich-text `drawValueHeight` no longer seeds
  `paragraph.lineAdvance` from `<para>`.
- `src/rendering/pdf-renderer/text.ts`: `renderRichText` uses the same
  CSS/default fallback so painted glyphs agree with layout boxes
  (Example-2 bold/next-line pitch 30.1pt → 14.5/22.5pt, overlap removed).
- Tests: anchorType cases and a para-lineHeight-ignoring rich-text case in
  `position-engine.test.ts`; updated `text-parity.test.ts` and
  `test/integration/workflow/para-rendering.test.ts` to the Adobe behaviour.
  Regression rows added to §10.

### 2026-11-22 — final parity defects and issue-template move

- Moved `.github/ISSUE_TEMPLATE/quarterly-major-upgrade-review.md` to
  `docs/06-issue-templates/` and indexed the new directory in `docs/README.md`
  and `docs/AGENTS.md`.
- Authored one-line draw boxes are no longer grown by wrapping, so Example-3's
  URL stays on one clipped line instead of overlapping the next field. The
  bundled Arial subset now covers full Basic Latin, restoring `&`.
- Pagination re-resolves leaves that straddle a band after ancestor shifts,
  gives each line exclusive page ownership, keeps fitting tables whole, and
  skips fragmenting non-straddling nodes. Example-2 `Draw_0054`/`Draw_0062` and
  the 8-row list now stay whole on their pages.
- Overflowing centred blocks top-align instead of painting above their box.
- Research/plan: `docs/02-research/2026-11-22-final-parity-defects.md`,
  `docs/03-plans/2026-11-22-final-parity-defects.md`.

### 2026-11-22 — remaining visual parity defects

- `strokeUniformRect()` now participates in the per-page edge registry, so
  identical uniform border boxes are emitted once. Example-3 page-2 thick
  duplicate groups fell from 6 to 0.
- Restored bold weight for every family, including Arial Narrow; condensation
  remains a separate `Tz` scale. `Ruvlviqd Rjcfqtk:` and its table headers are
  bold again and their widths match Adobe.
- Rich text uses the effective CSS run font size for default line advance
  (14.4 pt instead of 12 pt for 12 pt text), removing ~80 pt of excess
  whitespace per page. Clipped fragments anchor lines to the original box and
  clip to the fragment band, removing the overlapping continuation line.
- Explicit `keep intact="contentArea"` now applies only to the declaring node.
  The V-7 block stays on page 2 at y≈694 pt (Adobe ≈704 pt) instead of being
  pushed ~270 pt into page 3.
- Research/plan: `docs/02-research/2026-11-22-remaining-visual-defects.md`,
  `docs/03-plans/2026-11-22-remaining-visual-defects.md`.

### 2026-11-22 — visual parity defects across Example-1/2/3

- Draw text now wraps to its authored width when the box can fit two lines;
  short single-line draws remain unwrapped but are clipped horizontally. This
  fixes Example-2 body/header overflow and Example-3 footer overflow.
  `drawValueHeight()` now includes node insets so all rich-text lines fit.
- Caption trailing symbols use the measured `xfa-spacerun` advance and caption
  `<para>` alignment instead of the reserve edge. Example-1 `+` moved from
  x=215.1 pt to x=187.6 pt (Adobe 189.4 pt). Literal NBSP is preserved through
  XML parsing so the spacer survives.
- Embed replacement no longer unbalances rich-text tags, and paragraph closes
  pop to their matching block state, so `font-weight:bold` cannot leak into the
  following paragraph. Arial Narrow bold requests stay on the regular condensed
  face because no bold narrow asset exists.
- Explicit `keep intact="contentArea"` is now honoured recursively inside
  repeated instances, so page 2 of Example-2 no longer shows an orphaned second
  numbered bullet. Thin bordered rules are kept atomic at page boundaries.
- Edge suppression now ignores invisible children and requires coincident y;
  exactly coincident emitted edges are de-duplicated per page. Example-3 has
  zero duplicate strokes and its thin page-2 separators survive pagination.
- Research/plan: `docs/02-research/2026-11-22-visual-parity-defects.md`,
  `docs/03-plans/2026-11-22-visual-parity-defects.md`.

### 2026-11-22 — Preview PDF geometry, font coverage and text layout parity

- Added one effective-stroke-width authority shared by borders, tables and edge
  suppression. The sample-specific 0.1778 mm row-height constant and fixed 3 pt
  edge-collapse tolerance are gone; non-finite widths are skipped at emission.
- Caption `<para>` is parsed and applied. Example-1's three captions now land at
  x=43.1 pt versus Adobe 43.2 pt (previously 26.1 pt). Caption and value share
  one baseline even when their resolved fonts differ.
- Arial normal now embeds a Latin-1 subset reconstructed from the embedded
  Arial program in the supplied oracle PDFs; bold/italic use metric-compatible
  base-14 variants because full assets are absent from `reference/`. Text is
  filtered per glyph against the resolved font charset, so unmappable Greek
  `Ξ`/`ξ` is omitted like Adobe instead of promoting the whole run to DejaVu.
- URL wrapping shares one break-opportunity rule (`scheme://` is never split);
  single-line draws no longer wrap, so Example-3's URL stays on one line.
  Rich-text paragraph `line-height`/margins and `xfa-spacerun`-only paragraphs
  now use their authored vertical metrics instead of a full base-size line.
- Pagination now distinguishes `pageFront`/`pageArea`/`contentArea`, honours a
  trailing `breakAfter`, aligns `center`/`middle` consistently, and includes
  glyph extents in line-range membership. Example-2's eight-row table still
  splits across pages 5/6; full incremental flow reflow remains open.
- Research/plan: `docs/02-research/2026-11-22-preview-pdf-parity.md`,
  `docs/03-plans/2026-11-22-preview-pdf-parity.md`.

### 2026-11-22 — optional numeric fractions and plain-text whitespace parity

- `renderNumberTemplate` now omits the decimal separator when every fractional
  placeholder is optional (`z`/`#`) and the rounded fraction is all zero.
  Mandatory `0`/`9` placeholders still force digits, so `$z,zz9.99` keeps
  `.00`. Evidence: Example-1 Adobe renders `200` where the library rendered
  `200.00` for `num{zzzzzzz9.zz}`.
- Plain `<text>` draw values now use `stripHtmlTags()`, which removes markup
  without collapsing internal spaces, matching Adobe in Example-3. Rich-text
  HTML fallback still uses `stripHtml()`.
- Reviewed `quorbe/xfa.js`; it has no better rules for alignment, paragraph
  spacing, font resolution or picture formatting, so no external code was
  copied. Remaining Adobe gaps (pagination, border geometry, Arial substitution,
  Greek glyph omission, URL wrap and spacer height) need dedicated oracle work.
- Research/plan: `docs/02-research/2026-11-22-adobe-style-parity-gaps.md`,
  `docs/03-plans/2026-11-22-adobe-style-parity-gaps.md`.

### 2026-11-22 — sandbox escape fix and v0.5.0 follow-ups

- `createSandbox` now sets the context globals' prototype to `null` before
  `vm.createContext`. `test/unit/domain/scripting/js-sandbox-escape.test.ts`
  adds probes that return the host Node version without the fix and covers every
  injected object. `docs/04-decisions/2026-11-22-null-prototype-globals.md`
  records why worker/isolated-vm isolation is still deferred.
- `validate()` no longer renders a PDF: `validateFormInputs()` stops after
  parse/validation/mapping and pre-layout scripts and returns `Result<void>`.
  New `compile()` / `CompiledTemplate` caches parsed XDP/XSD data and clones the
  layout per render; `scripts/bench-render.mjs` compares both modes on minimal
  and Example-3. Measured medians: minimal 5.65 ms vs 2.86 ms, Example-3
  461.51 ms vs 294.01 ms.
- Package size fell from 952,860 to 356,342 bytes. DejaVu fonts are reproducible
  subsets via `npm run fonts:subset`; PDF417 tables are a base64 compact JSON
  decoded lazily by `loadPdf417Tables()` and removed from `dist` in pretty form.
  `check:size` budget is now 390,000 bytes. Sample-form extracted text is
  byte-for-byte identical to the pre-subset results.
- Font reads on the render path use `fs/promises`; `FontManager.preload()` shares
  one process-wide DejaVu read and async manifest/directory scans. `timeoutMs`
  and `signal` are documented as cooperative, not hard interrupts.
- CI adds publint and Are The Types Wrong checks; `fast-check` property tests
  cover FormCalc parsing and locale number formatting; coverage thresholds rose
  to 94.2/84.3/95.4/96.3; a quarterly major-upgrade issue template covers
  ignored Dependabot majors.
- Large files were split behind unchanged entry points: FormCalc evaluator
  builtins by function family, `pdf-renderer.ts` by element, and `parse-xdp.ts`
  by element group. `where do I change X` in §2 now points to the new modules.
- Research/plan: `docs/02-research/2026-11-22-sandbox-fix-and-followups.md`,
  `docs/03-plans/2026-11-22-sandbox-fix-and-followups.md`.

### 2026-11-22 — Windows CI formatting and Dependabot limits

- Added `.gitattributes` with LF enforcement and binary fixture markers, and
  set `endOfLine: 'lf'` in `.prettierrc`. Windows checkouts no longer fail
  `format:check` on every text file.
- Reduced Dependabot to two grouped npm PRs and one grouped GitHub Actions PR
  per week, ignoring major version bumps so breaking upgrades are reviewed
  deliberately instead of auto-opened.
- Research/plan: `docs/02-research/2026-11-22-windows-ci-dependabot.md`,
  `docs/03-plans/2026-11-22-windows-ci-dependabot.md`.

### 2026-11-22 — library hardening and developer experience

- Script sandbox moved behind `src/adapters/vm-sandbox.ts`. `vm` contexts now
  disable string/WASM code generation and every injected value is rebased onto
  sandbox-realm prototypes, closing the `constructor.constructor` escape. A
  new ESLint boundary rule forbids `fs`, `path` and `vm` under `src/domain/`.
- Public API gained `validate()`, `inspect()`, typed `ErrorCode`, error hints,
  `AbortSignal`/`timeoutMs`, `Uint8Array` output and TSDoc. All render failures,
  including unexpected throws, now return `Result` instead of rejecting.
- Package hardening: `exports` map, lazy Adobe/barcode/PDF417 loading, explicit
  `FONT_NOT_FOUND`, process-wide font-byte cache, CLI version from
  `package.json`, build no longer rewrites sources, no forced Jest exit, and
  release provenance. `fast-xml-parser` moved to 5.x and `@types/node` to 22.x;
  production audit is clean. CI adds format/lint/coverage/audit/size/benchmark
  gates and a three-OS matrix.
- Documentation: script-isolation decision, API reference, README security
  section, where-to-change-X map. Research and plan:
  `docs/02-research/2026-11-22-library-improvements.md`,
  `docs/03-plans/2026-11-22-library-improvements.md`.

### 2026-11-22 — locale-aware XFA formatting

- Added `src/lib/locale-format.ts` and threaded a normalized locale from
  `RenderOptions.locale` / XDP `locale` through embeds, scripts, layout,
  pagination and rendering. XFA IDs are converted (`de_DE → de-DE`) once;
  invalid values are ignored and the default path remains `en-US`.
- `formatValue`, FormCalc and the JS picture engine now use the same helpers
  for localized month/weekday names, meridiem text and number separators.
  Formatting and parsing were updated together so `Format`/`Parse` and host
  `formatValue`/`unformatValue` round-trips stay symmetric.
- No translation framework or message catalog was added: captions/data stay
  verbatim, diagnostics stay English, and `host.language`, `wordNum`, ISO/epoch
  helpers and picture grammar tokens are unchanged.
- Research/plan: `docs/02-research/2026-11-22-locale-aware-formatting.md`,
  `docs/03-plans/2026-11-22-locale-aware-formatting.md`.

### 2026-11-21 — CI-safe CFF subset regression test

- Replaced the Adobe OTF dependency in `cff-subset.test.ts` with a mocked
  fontkit subset in `cff-subset-patch.test.ts`. CI checkouts do not include
  `assets/fonts/adobe/*.otf` (they are imported locally via `fonts:import`), so
  the old `fs.readFileSync` assertion failed with `ENOENT` on both Node matrices.
- The mocked test still reproduces the malformed `01 00 04 15` header and
  asserts the wrapper writes the subset's real `offSize`; a non-CFF control
  case verifies passthrough. The committed DejaVu TrueType test remains.
- Research/plan: `docs/02-research/2026-11-21-ci-cff-test-asset.md`,
  `docs/03-plans/2026-11-21-ci-cff-test-asset.md`.

### 2026-11-21 — comprehensive unit coverage

- Added `npm run test:coverage` (Jest unit coverage with `json-summary` and
  `text-summary`) and documented it in `README.md`.
- Added/expanded 42 unit suites covering every behavior-bearing source module,
  including Adobe helpers, scripting proxies/engines, mapping/validation,
  image/fill/font helpers, layout helpers, workflow branches, CLI wiring and
  barrel exports. Type-only modules (`engine-types.ts`, `script-types.ts`,
  `formcalc/ast.ts`, `types.ts`) are intentionally exempt.
- Coverage moved from 71.45% to **96.5% lines** (statements 94.44%, functions
  95.67%, branches 84.66%). Unit suite count 65 → 107; tests 778 → 1399.
- Research/plan: `docs/02-research/2026-11-21-unit-coverage-all-source.md`,
  `docs/03-plans/2026-11-21-unit-coverage-all-source.md`.
- Remaining uncovered lines are defensive/unreachable guards (e.g. union
  exhaustiveness fallbacks); branch coverage is deliberately not gated at 100%.

### 2026-11-21 — Example-2 EN/CN parity defects

- `cff-subset-patch.ts` wraps the registered fontkit instance so CFF subsets
  emit a valid `offSize` byte. Reason: `@pdf-lib/fontkit@1.1.1` writes
  `cff.length` into the CFF header, so every Adobe CFF face produced an invalid
  `/FontFile3`; Example-2-CN showed tofu boxes while Latin spans rendered.
  Verified by patching the byte: the rendered CJK font now loads without errors.
- `table-engine.ts` no longer forces a 7mm pitch in `layoutSubformSetRows`.
  Evidence: Example-2 EN sub-item rows had 19.84pt pitch vs ~17.2pt cells,
  leaving ~2pt gaps that looked like dashed vertical borders. After the change
  the measured column border is one continuous run.
- `pdf-renderer.ts` `collapseTinyGapEdges()` now suppresses a parent edge only
  when visible child edges cover the full x-span (3pt tolerance). Evidence: the
  last column's hidden cell borders left a ~100pt gap in the row separator.
- `apply-pagination.ts` + `pdf-renderer.ts` split multi-line leaves by whole
  wrapped lines via `textLineRange`, with PDF y-up baseline conversion. The
  item-2 field in Example-2 EN no longer duplicates its first line across pages
  or clips the continuation to ascender slivers; the continuation now starts the
  next page before item 3.
- `rich-text-parser.ts` now applies `p`/`div` CSS styles through the state stack
  and adds `TextRun.fontFamily`; `pdf-renderer.ts` consumes it for per-run
  `Tz`. Evidence: ~15 Example-2 labels use `<p style="font-weight:bold">` and
  rendered 10pt regular before the fix; they now render bold/underlined with
  Arial Narrow compression.
- Tests: added `cff-subset.test.ts`, a subformSet row test in `engines.test.ts`,
  a coverage test in `border-parity.test.ts`, a line-range test in
  `apply-pagination.test.ts`, and paragraph-CSS tests in
  `rich-text-parser.test.ts`. Research/plan:
  `docs/02-research/2026-11-21-example2-en-cn-parity.md`,
  `docs/03-plans/2026-11-21-example2-en-cn-parity.md`.
- Residual: Adobe's leading `-` on the continuation line is not reproduced; the
  Adobe PDF is vectorized so its exact semantics remain unproven.

### 2026-11-21 — rotated text inset axis corrected

- `src/rendering/pdf-renderer.ts` vertical text anchor now uses
  `- margins.top` instead of `+ margins.bottom`. Reason: in a rotated box the
  insets are defined in the unrotated frame; the vertical text axis must be
  inset by the top inset, not the bottom one. Evidence: raster measurement of
  the Example-3 page-2 `Odaavg` strip — the glyph offset relative to the gray
  box now matches Adobe (17.8pt) instead of being ~1 inset too high.
- Added `test/unit/rendering/rotated-text-margin.test.ts`: bottom-inset
  independence plus exact top-inset shift; both assertions fail with the old
  formula.
- Updated `reference/RENDERING_BEHAVIOR.md` §7 with the rule and confidence.
  Research/plan: `docs/02-research/2026-11-21-rotated-text-margin.md`,
  `docs/03-plans/2026-11-21-rotated-text-margin.md`.
- Absolute ~2pt cumulative row drift on the lower table remains a separate
  known limitation.

### 2026-11-21 — Prettier runs as part of build

- `npm run build` now runs `prettier --write src/ test/` before `tsc`;
  `format:check` was added for a non-writing CI check. Prettier 3.10.1 is the
  installed devDependency and `.prettierrc` is unchanged.
- Reason: formatting should be a default quality gate, not an optional step.
  Evidence/plan: `docs/02-research/2026-11-21-prettier-build.md`,
  `docs/03-plans/2026-11-21-prettier-build.md`.
- Verification: lint, build, `format:check`, 770 unit and 92 integration tests
  pass. Rendered sample PDF text/drawing signatures are unchanged.
- Note: the first build pass left `parse-xdp.ts` needing a second format pass;
  a second `format`/build made output idempotent.

### 2026-11-21 — skill names and docs templates normalized

- Renamed the installed skills to a consistent suffix pattern and removed the
  `accelint` prefix: `best-practices-ts`, `performance-ts`, `testing-ts`,
  `documentation-ts`, `audit-all-ts`, `architecture-doc`, `readme-writer`.
  `node` and `linting-neostandard-eslint9` are unchanged. Updated each
  `SKILL.md` frontmatter name, `skills-lock.json`, `.agents/skills/` symlinks,
  root `AGENTS.md`, `README.md` and the docs rule files.
- Added `_TEMPLATE.md` to `docs/04-decisions/` and `docs/05-reference/` so all
  four working directories have a template; linked them from `docs/README.md`
  and `docs/AGENTS.md`.
- `eslint.config.mjs` now ignores `.skills/**` (renamed from `agent/skills/**`)
  and no longer ignores the removed `.claude/**`.
- `scripts/sync-agent-skills.sh` removes broken symlinks before rebuilding, so
  renamed skills do not leave stale links.
- Full consistency sweep: no broken markdown links, lock keys match `.skills/`
  directories, all 9 discovery links are valid symlinks, lint and build pass.

### 2026-11-21 — skill layout simplified to two directories

- Moved canonical skill content from `agent/skills/` to `.skills/`.
- Removed `.claude/skills/` and `.opencode/skills/` link trees; OpenCode
  documents `.agents/skills/` as a project compatibility source, so only one
  discovery directory is needed. Claude Code-specific auto-discovery is no
  longer maintained; skills remain available through `.skills/` and
  `.agents/skills/`.
- `scripts/sync-agent-skills.sh` now rebuilds only `.agents/skills/`. Docs and
  AGENTS instructions updated; no duplicate skill content remains.

### 2026-11-21 — strict ESLint gate and TypeScript clean-code pass

- `eslint.config.mjs` now ignores generated/local directories; `npm run lint`
  uses `eslint src --ext .ts --max-warnings 0` and a `lint:fix` script exists.
  This also fixes the previous shell-glob gap that silently skipped
  `src/domain/**`. `no-explicit-any` is now an error.
- Removed 29 unused imports/variables, 3 empty catch blocks, 4 dead duplicate
  `switch` cases, an unused function, a `require()` import and two useless
  regex escapes. Replaced `this` aliases with lexical `this` or captured
  collections, fixed `prefer-const` and a loss-of-precision literal.
- Performance: repeated `Array.includes()` membership checks in
  `event-dispatcher.ts`, `script-dependency-tracker.ts`, `parse-xml-data.ts`,
  `parse-xdp.ts` and `pdf-form-flatten.ts` now use precomputed `Set.has()`.
- Evidence/skills: `docs/02-research/2026-11-21-eslint-clean-code.md`,
  `docs/03-plans/2026-11-21-eslint-clean-code.md`,
  `best-practices-ts`, `performance-ts`,
  `linting-neostandard-eslint9`.
- Verification: lint, build, 770 unit and 92 integration tests pass. Rendered
  sample PDF text/drawing signatures are byte-identical before/after (only PDF
  timestamp metadata changes). No new regression test because behaviour is
  unchanged.

### 2026-11-21 — Node.js and ESLint skills added; duplicates removed

- Installed `node` and `linting-neostandard-eslint9` from `mcollina/skills`
  into `.skills/`. Reason: Node-specific async/streams/error guidance and
  ESLint 9 flat-config rules were missing.
- Deduplicated the skill set: `.skills/` is the only canonical copy; all
  other discovery paths are symlinks rebuilt by
  `scripts/sync-agent-skills.sh`. Removed stale `typescript-advanced-types`
  from `skills-lock.json`. Deliberately did not install `typescript-magician`,
  `documentation` or `init` because they duplicate existing skills or the docs
  rules. Root/docs `AGENTS.md` and README now list the curated set.

### 2026-11-21 — docs restructured; JS/TS skills installed

- Installed 7 project skills from `gohypergiant/agent-skills` with the `skills`
  CLI: `best-practices-ts`, `performance-ts`, `testing-ts`,
  `documentation-ts`, `audit-all-ts`, `architecture-doc` and
  `readme-writer`. Canonical content is committed in `.skills/`;
  discovery links are in `.agents/skills/`. Reason: a shared, explicit standard for clean and
  optimized JS/TS authored by any agent.
- Reorganized `docs/` into `01-canonical`, `02-research`, `03-plans`,
  `04-decisions`, `05-reference`, with lowercase kebab-case filenames and a
  `YYYY-MM-DD-slug.md` convention for working documents. Added `docs/README.md`
  (index), `docs/AGENTS.md` (rules), and research/plan templates.
- Made the research + plan rule mandatory: non-trivial changes require a dated
  research note and plan before source edits. Root `AGENTS.md` and `README.md`
  now reference the new paths and installed skills.
- All markdown links verified; no broken links.

### 2026-11-21 — ESLint config loads as ESM

- Renamed `eslint.config.js` to `eslint.config.mjs` so ESLint 9 loads it without
  the CommonJS/ESM module-type warning in this CommonJS package. `npm install`,
  `npm run lint` and `npm run build` verified.

### 2026-11-21 — table cells share the row height

- `src/domain/layout/table-engine.ts` now rewrites every laid-out cell's
  `position.h` to the computed row height. Evidence: Example-3 page 2 value
  cells rendered 9.6pt borders inside 14.2pt rows, while the Adobe PDF gives
  every cell in a row the same full-height box. Regression:
  `border-parity.test.ts` ("draws all table cells in a row at the shared row
  height"), verified to fail without the change.

### 2026-11-21 — Example-3 page 2 parity gaps (generic fixes)

- `src/domain/layout/table-engine.ts`: table cells now take the computed
  column width instead of retaining an oversized authored `w`. Evidence:
  Example-3's 56.553mm label draw sat in a 48.948mm column and drew an extra
  vertical border; Adobe uses the column width. Regression:
  `border-parity.test.ts` ("clamps table cell borders ..."), verified to fail
  without the change.
- `src/rendering/border-style.ts` / `pdf-renderer.ts`: emitted stroke widths are
  rounded up to the 600dpi printer grid (0.12pt). Evidence: every line in the
  Adobe reference PDFs has width 0.24/0.36/0.48/0.6; our thin edges were 0.5.
  Dash patterns still use the authored width. Updated
  `stroke-width.test.ts` and `border-rendering.test.ts` expectations.
- `src/rendering/text/line-breaker.ts`: `/` is a break opportunity so a long
  compound token can fill the current line. Evidence: page-2 wrap of
  `Nbpiiqg/Ngdrlod` in the Adobe PDF. Regression: `line-breaker.test.ts`.
- Updated `test/unit/domain/layout/engines.test.ts` so auto-column cells share
  the computed column width, and removed reintroduced explanatory comments in
  `border-parity.test.ts`.
- Remaining known divergence: cumulative ~2pt vertical drift in lower tables
  and slightly different row-height accumulation; no generic rule established
  yet.

### 2026-11-21 — README rewritten as the package front page

- `README.md` now follows a standard npm-package layout (badges, contents,
  features, install, quick start, CLI, API, architecture, concepts, limits,
  development, license) and includes Mermaid diagrams of the pipeline, layered
  architecture, layout dispatch, page render order and script lifecycle.
  Reason: make the project understandable at a glance for users and AI models;
  the wiki remains the deeper source of truth.

### 2026-11-21 — truthiness for nonempty collections

- Replaced all 60 `.length > 0` comparisons with `.length` across `src/`,
  `test/`, and `scripts/`. Reason: JavaScript treats any nonzero length as
  truthy; the comparison is redundant. No behaviour change. Lint, build, unit
  and integration suites still pass.

### 2026-11-21 — thick section borders no longer suppressed

- `src/rendering/pdf-renderer.ts` `collapseTinyGapEdges()`: a subform edge is
  now suppressed only when a coincident child edge is at least as thick.
  Reason: the 3pt "gap" rule was hiding the 0.5764mm section borders on
  Example-3 page 2 wherever a 0.1764mm cell edge sat on the same line — the
  table top and several bottoms rendered thin or with gaps. Test:
  `border-parity.test.ts` ("thick top border wins ..."), verified to fail
  without the change. Adobe draws these separators as filled ~1.6pt bars.

### 2026-11-21 — wiki becomes the source of truth; comments removed from code

- Added this file, `AGENTS.md`, and a README pointer. Reason: rationale must
  live in one AI-readable place; source files must stay free of explanatory
  comments. The change protocol in §0 is mandatory for all future edits.
- Stripped explanatory comments from all `src/`, `test/` and `scripts/` files
  using the TypeScript AST comment ranges. Preserved functional directives
  (`eslint-disable`, `@ts-`, shebangs) and comment text that is _test data_
  inside a template literal (e.g. the sanitizer fixture's `// owner: Jane Doe`).
- Replaced comment-only `catch {}` blocks with explicit `continue`/`return`
  control flow and made image embedding use promise `.catch()` so `no-empty`
  lint stays clean. No behaviour changed.
- Verification: lint, build, unit and integration suites all pass.

### 2026-11-21 — master-page widgets and watermark

- `src/rendering/pdf-renderer.ts`: `renderField`/`renderDraw` fall back to
  `minW`/`minH` when `w`/`h` are absent. Reason: master-page fields never pass
  through layout, so the 125pt `DDAZT` caption had a 0×18pt box and clipped to
  one glyph. Tests: `adobe-livecycle-parity.test.ts` gap 5.
- `src/domain/layout/calculate-positions.ts`: lay out every page's
  `masterPageChildren` in absolute page coordinates. Reason: flow subforms on a
  page area produced children without `x/y`, so they were silently skipped
  (page-2 watermark missing).
- Removed dead `strokeRoundedRectangle`/`fillRoundedRectangle` helpers and two
  unused imports so `npm run lint` is clean.

### 2026-11-21 — rotated label alignment

- `src/domain/layout/position-engine.ts` `getChildY()`: authored `rotate=90`
  positions are normalized by subtracting `w`. Reason: Adobe treats authored
  `y` as the visual bottom; flow-positioned rotated draws use visual top. The
  mismatch shifted every gray-column label one cell down. Test:
  `adobe-livecycle-parity.test.ts` gap 4.

### 2026-11-21 — caption double-paint

- `src/rendering/pdf-renderer.ts`: `captionPainted` guard skips the plain
  caption draw after the rich-symbol branch. Reason: the label was painted
  twice (bolder glyphs, duplicated extraction). Test: `text-parity.test.ts`.

### Earlier session fixes (retained rationale)

- Repeat-aware absolute binding, lexical decimals, ascent clamp, 1/1000pt
  advance quantization, FormCalc `PropAccess`/`xfa.resolveNode`, per-corner
  border gate. Evidence and rationale: `docs/04-decisions/fixes.md`,
  `reference/RENDERING_BEHAVIOR.md`, and the tests listed in §10.

## 12. Open uncertainties (do not "fix" without evidence)

1. Effective base-14 ascent after the CoolType clamp (§5).
2. Whether flag `0x1000` suppresses advance quantization (§5).
3. Pagination fidelity beyond line-level leaf splitting (§8).
4. `spaceAbove`/`spaceBelow` interaction with rich-text pagination splitting;
   line ranges now slice lines, but paragraph spacing at a break is unvalidated.
5. `lineHeight` percentage interpretation.
6. Lone-corner stamp rule rests on one fixture only.
7. Table label pitch for 11pt text in an unsized context (Adobe 14.4 vs the
   own-size 13.2 default); no ancestor carries 12pt, so the source of
   Adobe's pitch is unidentified. Row geometry is minH-clamped either way.
