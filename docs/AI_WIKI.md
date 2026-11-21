# AI Wiki — xdp-pdf-renderer (source of truth)

This file is the **authoritative explanation of why the code is the way it is**.
Source code intentionally contains no explanatory comments. If you change code,
you **must** update this file in the same change.

## 0. Mandatory protocol for AI agents and maintainers

1. **Read this file before editing any code.** Also read
   `reference/RENDERING_BEHAVIOR.md` for the Adobe evidence behind rendering
   decisions, and `README.md` for the public API.
2. **Code contains no inline rationale.** Do not re-add comments to explain
   behaviour. Put the explanation here instead.
3. **Every code change must update this file:**
   - Add or update the relevant section below with *what* changed and *why*.
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

- Public API: `render()` / `renderFormToPdf()` in `src/index.ts`,
  `src/workflows/render-pdf.ts`. CLI in `src/cli.ts`.
- Purity rule: everything under `src/domain/`, `src/lib/`, and `src/config/` is
  pure (no I/O). `src/rendering/` is the PDF I/O boundary.
- Every fallible operation returns `Result<T> = { success: true; data: T } |
  { success: false; error: ErrorResult }` (`src/lib/result-type.ts`).
- Schema/binding problems are warnings by default; `strictValidation: true`
  makes them hard failures. Adobe renders partially mismatched documents.
- Style: use truthiness for nonempty collections (`.length`, not
  `.length > 0`). Explicit zero checks are only for numeric comparisons.

## 2. Repository map

| Path | Responsibility |
| --- | --- |
| `src/workflows/render-pdf.ts` | Orchestrates the full pipeline; only I/O at the end |
| `src/domain/parsing/` | XDP → `LayoutModel`, XSD → schema model, XML → data object |
| `src/domain/validation/` | Structure/schema/binding validation |
| `src/domain/mapping/` | Binding resolution, repeat expansion, conditions, embeds |
| `src/domain/scripting/` | FormCalc + JavaScript engines, SOM resolver, event dispatch, property writes |
| `src/domain/layout/` | Flow / position / table engines, sizing, pagination |
| `src/rendering/` | pdf-lib rendering: text, borders, images, fonts, gradients |
| `src/rendering/text/` | Line metrics, measurement, wrapping, rotation |
| `src/lib/` | Units, XPath, XML helpers, value formatting, results |
| `src/adobe/`, `src/config/` | Adobe compatibility helpers and config-as-data |
| `reference/` | Decompiled DLL evidence and observed rendering behaviour |
| `docs/` | Historical analysis; this wiki is the maintained entry point |
| `test/unit/`, `test/integration/` | Regression suites |
| `test/fixtures/sample-forms/` | Sanitized real forms + Adobe-generated reference PDFs |

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
- Font resolution: `ArialMT` must not resolve to a different face; Arial Narrow
  uses horizontal scaling (`Tz`), not a different font. Font resources are
  de-duplicated per page.
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

## 6. Borders, images and rotation

- Edges: dash patterns scaled by thickness; cap/join map to PDF `J`/`j`; corner
  radius clamped to `min(w,h)/2`. Stroke widths are quantized to 3 decimals.
- A **lone unindexed `<corner radius>`** stamp renders square; indexed or
  multi-corner sets render rounded (`cornerRadii` gate in `parse-xdp.ts`). This
  is a single-fixture observation, not decompiled evidence.
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

## 8. Pagination — known divergence

`apply-pagination.ts` is a coordinate-bucketing approximation of
`contentBlockToPage`, not a faithful port. Example-3 page 0 keeps one extra
table row (`Dpmbtzs`) that Adobe moves to page 1. The break is unchanged by the
ascent clamp, so the cause is row-height accumulation, not font metrics.
Marked as Medium confidence in `reference/RENDERING_BEHAVIOR.md` §8.

## 9. Verification (all must pass)

```bash
npm run lint
npm run build
npm run test:unit          # 63+ suites
npm run test:integration   # 17 suites
node scripts/render-sample-forms.mjs
```

Rendered fixtures live in `test/fixtures/sample-forms/results/`; Adobe reference
PDFs in `test/fixtures/sample-forms/Adobe-generated-results/`. Compare with
`pdftotext -layout`, PyMuPDF word/bbox extraction, or raster crops. Do not add
fixture-specific code to make a diff disappear.

## 10. Regression tests that protect past fixes

| Test file | Protects |
| --- | --- |
| `test/unit/lib/xpath-resolver.test.ts` | Repeat-scoped binding fallback |
| `test/unit/domain/parsing/parse-xml-data.test.ts` | Lexical decimals / `0,006` |
| `test/unit/rendering/line-metrics.test.ts` | Ascent clamp, line advance |
| `test/unit/rendering/condensed-and-dedup.test.ts` | Advance quantization, font dedupe |
| `test/unit/rendering/baseline-and-caption.test.ts` | Shared caption/value baseline |
| `test/unit/rendering/text-parity.test.ts` | Spacerun symbols, single caption draw |
| `test/unit/rendering/border-parity.test.ts` | Per-corner fill/stroke, lone corner gate |
| `test/unit/rendering/adobe-livecycle-parity.test.ts` | Script colour writes, rotation origin, master-page minW/minH |
| `test/unit/domain/scripting/formcalc-golden.test.ts` | FormCalc property access / resolveNode |

## 11. Change ledger (append newest first)

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
  (`eslint-disable`, `@ts-`, shebangs) and comment text that is *test data*
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
  border gate. Evidence and rationale: `docs/FIXES.md`,
  `reference/RENDERING_BEHAVIOR.md`, and the tests listed in §10.

## 12. Open uncertainties (do not "fix" without evidence)

1. Effective base-14 ascent after the CoolType clamp (§5).
2. Whether flag `0x1000` suppresses advance quantization (§5).
3. Pagination fidelity (§8).
4. `spaceAbove`/`spaceBelow` interaction with rich-text pagination splitting.
5. `lineHeight` percentage interpretation.
6. Lone-corner stamp rule rests on one fixture only.
