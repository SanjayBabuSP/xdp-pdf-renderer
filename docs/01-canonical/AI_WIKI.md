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
| `docs/` | Structured docs: canonical, research, plans, decisions, reference; this wiki is the maintained entry point |
| `.skills/` | Canonical installed JS/TS coding skills; `.agents/skills/` holds discovery links |
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

## 9. Verification (all must pass)

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit          # 107 suites
npm run test:coverage      # ≥90% lines (currently 96.5%)
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
| `test/unit/adobe/*` | Adobe PDF feature helpers, metadata, security, fonts, namespaces |
| `test/unit/domain/scripting/*` | SOM/proxy/dependency/FormCalc/JS engine internals |
| `test/unit/domain/mapping/*`, `test/unit/domain/validation/*` | Repeat expansion, binding and schema/structure validation |
| `test/unit/rendering/*`, `test/unit/lib/*` | Image/fill/font/border/geometry helpers and value formatting |
| `test/unit/workflows/render-pdf.test.ts`, `test/unit/cli.test.ts`, `test/unit/barrels.test.ts` | Workflow options/branches, CLI wiring, public exports |
| Coverage gate | `npm run test:coverage`: 96.5% lines, 94.44% statements, 95.67% functions, 84.66% branches |
| `test/unit/lib/xpath-resolver.test.ts` | Repeat-scoped binding fallback |
| `test/unit/domain/parsing/parse-xml-data.test.ts` | Lexical decimals / `0,006` |
| `test/unit/rendering/line-metrics.test.ts` | Ascent clamp, line advance |
| `test/unit/rendering/condensed-and-dedup.test.ts` | Advance quantization, font dedupe |
| `test/unit/rendering/baseline-and-caption.test.ts` | Shared caption/value baseline |
| `test/unit/rendering/text-parity.test.ts` | Spacerun symbols, single caption draw |
| `test/unit/rendering/border-parity.test.ts` | Per-corner fill/stroke, lone corner gate |
| `test/unit/rendering/adobe-livecycle-parity.test.ts` | Script colour writes, rotation origin, master-page minW/minH |
| `test/unit/rendering/line-breaker.test.ts` | Slash-preferred wrapping |
| `test/unit/rendering/stroke-width.test.ts` | 3-decimal layout width + 0.12pt output grid |
| `test/unit/rendering/border-parity.test.ts` | Per-corner fill/stroke, lone corner gate, thick-edge survival, table cell width and shared row height, full-width edge coverage |
| `test/unit/rendering/cff-subset.test.ts` | Valid CFF `offSize` in embedded subsets |
| `test/unit/domain/layout/engines.test.ts` | SubformSet row pitch equals shared cell height |
| `test/unit/domain/layout/apply-pagination.test.ts` | Multi-line fields split by line range across pages |
| `test/unit/rendering/rich-text-parser.test.ts` | Paragraph-level CSS, nested span overrides |
| `test/unit/domain/scripting/formcalc-golden.test.ts` | FormCalc property access / resolveNode |

## 11. Change ledger (append newest first)

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
