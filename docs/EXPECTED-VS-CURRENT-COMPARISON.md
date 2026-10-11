# Expected vs. Current Output — Comparison Report (3 real-world forms)

**Audience:** an AI coding agent (or developer) picking up this repo next, with no
prior context beyond the code and this document.

**Scope:** visual + structural comparison of three real production forms rendered
by this engine, against their Adobe LiveCycle Designer–produced reference PDFs.
Fixtures live in `test/final-test/{DGS,IPQT,MechanicalSeal}/` (XDP+XSD+XML) and
`test/final-test/Expected/*.pdf` (oracle) vs `test/final-test/results/*.pdf`
(this engine's current output). **Those files are not reproduced here** — they
contain real customer/commercial data (names, prices, quotation numbers) that
must not leave the workspace. Everything below is either a structural/numeric
fact extracted from the PDFs (font metrics, page counts, operator counts — none
of this is confidential) or a description of the layout symptom, written
generically.

| Form | Template | Expected pages | Current pages | Visual verdict |
|---|---|---|---|---|
| `DGS` | Gas Seal Data Sheet (single-page technical datasheet + diagram) | 1 | **2** | Badly broken: fields overlap, table header row shredded into unreadable fragments, diagram/table positions lost |
| `IPQT` | Multi-page commercial cover letter (quotation table, T&Cs, signature block) | 6 | **5** | Badly broken: paragraphs run together, quotation table columns collapse/overlap, header/footer bleed into body text |
| `MechanicalSeal` | 2-page technical datasheet (grid table + vertical section labels) | 2 | 2 | Badly broken: captions/values overlap pervasively, vertical margin labels unreadable, DRAFT watermark renders correctly |

All three share the **same underlying defect class** (see §2), which is why a
single fix is likely to resolve most of the symptoms across all three forms
simultaneously, rather than needing three separate investigations.

---

## 1. What the images show (symptom inventory)

### 1.1 `DGS` — Gas Seal Data Sheet

**Expected (Designer oracle, 1 page):** a clean single-page technical datasheet.
Header block of label:value pairs (`PROJECT`, `CUSTOMER`, `GAS SEAL TYPE`,
`ARRANGEMENT`, `DIRECTION OF ROTATION`, `TEST PROCEDURE`, …), an embedded
diagram image, a "GAS SEAL PERFORMANCE" table with a numbered case-column
header row (`1 2 3 4 5 6 7 8`) and several data rows (`Operating Point`,
`Speed`, `Seal chamber pressure`, …, `RESULTS` sub-header, `Primary seal gas
leakage`, …), a "GAS SEAL DESIGN CONDITIONS" two-column section, a "GAS SEAL
MATERIALS" list, and a footer block (`TSD No.`, `PRO No.`, `PREPARED BY`,
`ISSUE DATE`). Every field sits inside a visible bordered box; the table has a
full grid.

**Current output (2 pages):**
- Content that fits on Designer's single page now **spills onto a second
  page**, which strongly suggests the engine is measuring text taller/wider
  than Designer did and triggering an unwanted page break (see §2.1, §2.4).
- The table header row (`1 2 3 4 5 6 7 8` case columns) renders as unreadable
  single/double-character fragments stacked vertically instead of 8 evenly
  spaced column headers — consistent with column width being computed for text
  rendered in the wrong font (narrower/wider glyphs than authored) or with
  cell content overflowing its authored box height and being pushed down into
  the next row.
- Several header fields overlap each other (e.g., a short label and the field
  box immediately below it visually collide), and the border grid around the
  performance table is incomplete/misaligned relative to the text sitting in
  it.
- The diagram image and the "Draft only!" callout are visible but displaced
  relative to their expected position.

### 1.2 `IPQT` — Commercial cover letter (multi-page)

**Expected (Designer oracle, 6 pages):** page 1 is a cover letter with a
sender/recipient block, a quotation summary table (`Pos.` / `Description` /
`Total Quantity` / `Total Price` / `Lead Time`) with 3-4 line items and a
totals row, plus an offer-validity note. Pages 2-3 contain prose paragraphs
(scope clarifications, a numbered list, a delivery-time table broken out by
phase). Page 4 repeats the delivery-time table in a different shape plus
packing/incoterm paragraphs. Page 5 is pricing/warranty/export-control prose
plus a tri-column signature block (3 names) and a numbered attachments list.
Page 6 is a near-blank closing page with a small "Revision History" table.
Every page carries a running header (logo) and footer (company registration
block + page number). Paragraph text is justified, wraps cleanly within its
column, and headings/body text never collide.

**Current output (5 pages):**
- One fewer page than Designer produced. Candidate causes: (a) the trailing
  near-blank revision-history page is being suppressed because its estimated
  content height rounds to ~0 (pagination treats it as not worth a page), or
  (b) a `breakBefore` on that closing subform isn't firing, or (c) upstream
  text now wraps to *fewer* lines somewhere (if a substituted font is
  *narrower* than the authored one for some run) and content that spanned 6
  pages now packs into 5. This is the one page-count divergence that runs
  opposite to the "content got bigger" story in §2.1, so it needs its own
  isolated check — see §4, item 5.
- The quotation table's columns (`Pos.` / `Description` / `Total Quantity` /
  `Total Price` / `Lead Time`) are visibly compressed: numeric values are
  pushed hard against the right edge of their cells and some column headers
  overlap the data beneath them instead of sitting in a clean header row.
- Body paragraphs that should wrap onto several short lines appear to run
  together with inconsistent line breaks, and in several places a line of
  running text visually overlaps the line above or below it — classic
  symptom of a field/paragraph box whose authored height assumed fewer wrapped
  lines than the substituted font actually produces (or vice-versa).
- Header/footer decorations (logo strip, footer company-info row) overlap
  body content on some pages instead of sitting in their own margin band.

### 1.3 `MechanicalSeal` — Technical data sheet (2 pages)

**Expected (Designer oracle, 2 pages):** a dense bordered grid table
(`Quotation no.`, `Customer reference`, `PRO No.`, `Machine/Pump type/size`,
`Seal type`, `Arrangement`, process-data rows with `min`/`rated`/`max` triples,
etc.), with thin vertical section-group labels running down the left margin
in a shaded strip (`General`, `Pump/Machine`, `Seal Data`, `Type`, `Supply
Systems`, `Specifications`, `Process Data`, …), a product photo, and a light
diagonal "DRAFT" watermark across the page. Every label:value pair is legible
and confined to its own cell.

**Current output (2 pages, correct page count):**
- Page count and the DRAFT watermark are both now correct (prior fixes
  documented in [docs/PDF-OUTPUT-ISSUES.md](./PDF-OUTPUT-ISSUES.md) hold up —
  see §3 for what's confirmed fixed vs. not).
- But most label:value pairs still visibly overlap — e.g. a short caption like
  `Pos.` sits on top of the adjacent value instead of beside/above it, and
  several `min`/`rated`/`max` numeric triples are hard to read because
  adjacent cells' text bleeds into each other.
- The vertical section-group labels down the left margin are effectively
  unreadable (either not rendered at a legible position, or compressed/
  overlapping each other) — this area did get `rotate` support added (§3.3),
  but something downstream is still wrong.
- The grid border lines are present but the text inside the cells frequently
  extends past them.

---

## 2. Root-cause analysis (ranked by how much damage each one plausibly explains)

### 2.1 ★ PRIMARY SUSPECT — font substitution gaps change every text metric

All three XDPs declare Windows fonts that Designer had installed locally:

```
MechanicalSeal : Arial, ArialMT, Calibri
DGS            : Arial, Calibri, Segoe UI
IPQT           : Arial Narrow, Arial, Calibri, Segoe UI, SimSun-ExtB
```

This engine has **no Windows/Adobe font files bundled or imported**
(`assets/fonts/` only ships `DejaVuSans.ttf` / `DejaVuSans-Bold.ttf` — see
[assets/fonts/](../assets/fonts/)); `npm run fonts:import` was never run, so
`assets/fonts/adobe/manifest.json` does not exist and
[`loadManifest()`](../src/rendering/font-registry.ts#L59-L75) always returns
`null`. Every font request therefore falls through to substitution logic in
[`src/rendering/font-manager.ts`](../src/rendering/font-manager.ts#L80-L128)
and [`src/rendering/standard-fonts.ts`](../src/rendering/standard-fonts.ts).
Tracing each family actually used by these forms:

| Requested family | What actually backs it today | Metric match to the real font? |
|---|---|---|
| `Arial`, `ArialMT` | `standard-fonts.ts` `FAMILY_ALIASES['arial'] = 'helvetica'` → PDF base-14 Helvetica | Good — Arial and Helvetica are metric-compatible by design |
| `Arial Narrow` | **Same alias, `FAMILY_ALIASES['arial narrow'] = 'helvetica'`** → full-width Helvetica | **Bad** — Arial Narrow is ~82% the width of Arial/Helvetica; rendering it at full width means every Arial-Narrow text run is measured and wrapped ~20% too wide |
| `Calibri` | No `FAMILY_ALIASES` entry, no entry in [`src/adobe/font-sequences.ts`](../src/adobe/font-sequences.ts) `DEFAULT_FONT_SEQUENCES`, `default-fonts.json` points at `./fonts/Calibri.ttf` which **does not exist on disk** → falls through every lookup tier to the bundled Unicode fallback, **DejaVu Sans** | **Bad** — DejaVu Sans has a materially different average advance width and line-height than Calibri |
| `Segoe UI` | Same story — no alias, no sequence rule, no font file → **DejaVu Sans** | **Bad** |
| `SimSun-ExtB` (IPQT, CJK) | No rule → DejaVu Sans (not a CJK font) | Bad, but likely low-impact (probably used for a small amount of text) |

Code path confirming this (`src/rendering/font-manager.ts`):

```ts
// loadFont(): 1. embeddable file (manifest/user dirs) → 2. base-14 alias →
// 2b. Adobe <seq> fallback chain → 3. bundled Unicode fallback (DejaVu Sans)
const file = this.fileFor(targetFamily, targetWeight, targetPosture);
if (file) return this.loadCustomFont(file);
for (const candidate of [targetFamily, requested]) {
  const standardName = mapToStandardPdfFont(candidate, ...);
  if (standardName) { /* embed base-14 */ }
}
const sequencedStandard = await this.tryFontSequence(targetFamily, ...);
if (sequencedStandard) return sequencedStandard;
return this.loadUnicodeFallback(...);   // <- Calibri and Segoe UI land here
```

```ts
// src/rendering/standard-fonts.ts — the only Windows aliases registered
const FAMILY_ALIASES: Record<string, string> = {
  courier: 'courier', 'courier new': 'courier',
  helvetica: 'helvetica', helv: 'helvetica',
  arial: 'helvetica',
  'arial narrow': 'helvetica',   // <- wrong: should be condensed, not full-width
  times: 'times', 'times new roman': 'times', timesnewroman: 'times',
  symbol: 'symbol', zapfdingbats: 'zapfdingbats', ...
};
```

**Why this explains almost everything in §1:** `DGS` and `IPQT` lean heavily
on `Calibri`/`Segoe UI` (every label and most body text), so nearly every text
run in those two forms is measured, wrapped, and advanced using DejaVu Sans
metrics instead of the font Designer assumed when it authored each field's
`w`/`h`. `MechanicalSeal` uses mostly `Arial` (fine) but also `Calibri` for
some fields (bad) — which matches it being *less* broken than the other two
but still showing pervasive caption/value overlap.

This is a **systemic metric mismatch**, not a one-off bug: every box in every
form was authored in Designer assuming specific glyph advances and line
heights; this engine silently swaps in a font with different ones and then
lays out text as if nothing changed.

### 2.2 Fixed-height boxes mean vertical overflow has nowhere to go but into the next element

Confirmed in [`src/domain/layout/sizing.ts`](../src/domain/layout/sizing.ts#L34-L46):

```ts
export function resolveExtent(pos, axis, contentExtent): number {
  const specified = axis === 'height' ? pos?.h : pos?.w;
  const min = axis === 'height' ? pos?.minH : pos?.minW;
  const max = axis === 'height' ? pos?.maxH : pos?.maxW;
  const base = specified != null && specified !== 0 ? specified : contentExtent;
  return clamp(base, min, max);
}
```

When a field/row has an explicit `h` (the common case for Designer-authored
datasheets — almost every field in these three forms has a fixed box), that
`h` **wins outright**; the actual measured/wrapped text extent
(`contentExtent`) is discarded. [`src/domain/layout/table-engine.ts`](../src/domain/layout/table-engine.ts#L9)
has an explicit comment acknowledging this is a known simplification:

```ts
// Row height = tallest cell (plan Phase 2 task 6: remove the hard floor of 18).
```

Combined with §2.1: when a substituted font causes a value to wrap to one
*more* line than Designer's own font would have, the field box does not grow
— the extra line is drawn below the box's bottom edge, landing on top of
whatever is positioned there next (the next field, the next table row, or a
caption). This is the direct mechanism behind the "fields overlap" /
"captions sit on top of values" symptom in all three forms, and is a more
complete explanation than the old repeat-offset bug (confirmed already fixed,
see §3.2).

### 2.3 Caption `reserve` strip assumes the caption fits in the authored width

[`src/rendering/pdf-renderer.ts`](../src/rendering/pdf-renderer.ts#L454-L496):

```ts
const reserve = options.reserve ?? 0;
let valueAreaStart = x + reserve;
let valueAreaWidth = Math.max(width - reserve, 0);
```

`reserve` is an **authored** pixel width (Designer computed it for its own
caption font). If the substituted font (§2.1) renders that caption text
wider than Designer's font would, the caption glyphs extend past `reserve`
into `valueAreaStart`, overlapping the value — there is no truncation,
ellipsis, or reserve-recalculation fallback. This is very likely the exact
mechanism behind the `"Pos."` vs. the field below it colliding in
`MechanicalSeal`, and equivalent collisions in `DGS`'s header block.

### 2.4 Pagination page-count divergence (concrete numbers)

Extracted directly from the PDFs (safe — just `/Type /Page` object counts,
no document content):

| Form | Expected page objects | Current page objects |
|---|---|---|
| `DGS` | 1 | **2** |
| `IPQT` | 6 | **5** |
| `MechanicalSeal` | 2 | 2 |

`DGS` going from 1 → 2 pages is consistent with §2.1/§2.2: enough text now
measures taller than Designer expected that total flowed content height
exceeds one page's content area, forcing a second page into existence.
`IPQT` going from 6 → 5 is the **opposite direction** and is not fully
explained by §2.1 alone — it needs isolated investigation (see §4 item 5):
plausible causes are a trailing near-empty page (the "Revision History" closing
page) being dropped by height-estimation rounding to zero, or an explicit
`breakBefore` on that section not firing.

### 2.5 Secondary/lower-severity findings (not primarily responsible for the visual symptoms, but real)

- **PDF font-resource bloat.** The current `MechanicalSeal` output registers
  **550 separate font-resource dictionary entries** (one per `Tf`/text run)
  that collapse to only **3 underlying font objects** (Helvetica,
  Helvetica-Bold, Helvetica-Oblique) — e.g. `/Helvetica-Bold-7098480789`,
  `/Helvetica-Bold-9742682568`, … all pointing at the same indirect object
  reference. This comes from `pdf-lib`'s own `PDFPage.setFont()` /
  `newFontDictionary()`, which has a standing TODO in its own source
  (`node_modules/pdf-lib/cjs/api/PDFPage.js`): *"Reuse image Font name if
  we've already added this image to Resources.Fonts"* (applies to fonts too —
  it is never deduplicated). Net effect: current output is ~284 KB vs.
  Designer's ~235 KB for the same content, and the content stream carries far
  more `RG`/`w`/`d` state-reset operators (916/1119/1160 in current vs.
  4/143/22 in Designer's output) than necessary. Not a visual bug by itself,
  but worth fixing for file size/perf, and the operator bloat is a useful
  canary for "this renderer is redrawing graphics state far more often than
  Designer does," which also shows up as border edges being drawn as
  individual line segments (`m`/`l`/`S`, 1959/1303 of them) rather than
  Designer's filled-rectangle approach (402 `re` fills, almost no stroked
  lines) — a different-but-valid strategy, just much more verbose.
- **Border line-width numeric drift.** Designer's line widths:
  `0.5 / 1.067 / 1.634`. Current output: `0 / 0.5 / 0.50003226 / 1.06696226 /
  1.63389226` — i.e. a spurious `0`-width line (hairline, usually renders as
  1 device pixel — check whether this is intentional) plus small unit-
  conversion rounding drift (`1.067` vs `1.06696226`) from whatever
  mm/twip→pt conversion constant is in use. Minor but worth tightening.
- **Rotate works for text, not for borders.** `rotate` is parsed
  ([`src/domain/parsing/parse-xdp.ts:981`](../src/domain/parsing/parse-xdp.ts#L981))
  and applied to `drawText`'s `rotate` option plus box-swap math in
  [`src/rendering/text/rotation.ts`](../src/rendering/text/rotation.ts), but
  [`src/rendering/pdf-renderer.ts:1215`](../src/rendering/pdf-renderer.ts#L1215)
  explicitly notes border drawing is **suppressed for rotated fields** — so a
  rotated field's border box stays axis-aligned (or is simply not drawn)
  while its text rotates. Relevant to `MechanicalSeal`'s vertical section-
  label strip.
- **`Expected` PDF provenance differs between forms — a caveat for anyone
  trying to do exact glyph-metric diffing.** `MechanicalSeal_Datasheet_
  Expected.pdf`'s `/Producer` is `Adobe XML Form Module Library` — a genuine
  Designer-family "Preview PDF" export, i.e. a trustworthy oracle. `DGS_
  Expected.pdf` and `IPQT_CoverLetter_EN_Expected.pdf` both report
  `/Producer: GPL Ghostscript 10.08.0` and `/Creator: PDF24 Creator` — these
  two were re-saved/re-printed through a different PDF toolchain at some
  point after leaving Designer (commonly done to flatten/redact a document
  before sharing it). That does not invalidate the *layout* comparison in
  this report, but it means exact embedded-font-descriptor numbers
  (ascent/descent/stemV, as requested in
  [docs/DESIGNER-DATA-REQUEST.md](./DESIGNER-DATA-REQUEST.md) §2) cannot be
  reliably recovered from those two files — only from `MechanicalSeal_
  Datasheet_Expected.pdf`, which embeds a subsetted `MyriadPro-Regular`
  (`/BaseFont /DOORBM+MyriadPro-Regular`, a 6-letter-prefix subset tag, so
  Designer is in fact embedding and subsetting a corporate font here — not
  relying on base-14 at all). This engine currently has no way to reproduce
  that: it has no Myriad Pro file to embed (see §2.1).

---

## 3. What is already fixed (confirmed by reading current source, not assumed from the old doc)

[docs/PDF-OUTPUT-ISSUES.md](./PDF-OUTPUT-ISSUES.md) describes 7 bugs found in
an earlier version of the engine. A fresh read of the current source (not the
doc's "status update" note, which predates a larger rewrite) confirms:

1. **Pagination drop-everything-after-page-1 bug: fixed.** Pagination in
   [`src/domain/layout/apply-pagination.ts`](../src/domain/layout/apply-pagination.ts)
   was rewritten to flow content in one coordinate space and bucket it by page
   index (`pageIndexOf`), not the old `pageIndex === 0 ? layout.children : []`
   logic. Confirmed no page is structurally dropped anymore.
2. **Repeating-subform instances all landing at the same x/y: fixed.**
   [`src/domain/mapping/expand-repeats.ts`](../src/domain/mapping/expand-repeats.ts#L75-L85)
   now stamps each instance with `repeatIndex`, and the position engine
   ([`src/domain/layout/position-engine.ts`](../src/domain/layout/position-engine.ts#L53-L112))
   stacks same-key consecutive instances at `runNextY` instead of reusing the
   template's authored y. Table/`lr` layouts already offset correctly via
   their own cursors.
3. **`rotate` unsupported: now parsed and rendered for text** (see §2.5 for
   the border caveat).
4. **DRAFT watermark not rendering:** a `previewMode` render option now
   force-shows `presence="invisible"` nodes
   ([`src/rendering/pdf-renderer.ts:151-155`](../src/rendering/pdf-renderer.ts#L151)),
   confirmed visible in the current `MechanicalSeal` output.
5. **`image/bmp` embedding:** already implemented (`decodeBmp` in
   `src/rendering/image-embedder.ts` + `src/rendering/image-sniff.ts`).

None of these explain the overlap still visible in all three forms today —
that is §2.

---

## 4. Recommended fix order

1. **Font metrics are the highest-leverage fix.** Either (a) ship/import real
   metric files for `Calibri`, `Segoe UI`, and a genuinely condensed `Arial
   Narrow` (AFM-equivalent width tables are enough — full embedding isn't
   required just to get correct *measurement*; embedding can be a later,
   separate concern for visual fidelity), or (b) at minimum, add honest
   substitution rules so `Calibri`/`Segoe UI` map to a metrically closer
   base-14 stand-in than DejaVu Sans (e.g. `Helvetica` is closer to
   `Calibri`/`Segoe UI` in average advance width than `DejaVu Sans` is — verify
   with real width tables before committing to this), and fix the `Arial
   Narrow` alias to use a condensed metric table instead of full-width
   Helvetica. This alone should fix the majority of the overlap symptoms in
   `DGS` and `IPQT`, and a good share of `MechanicalSeal`'s.
2. **Decide what happens when measured content exceeds a fixed `h`.** Either
   let the box grow past its authored `h` (XFA's own growable-height rule
   already exists in [`sizing.ts`](../src/domain/layout/sizing.ts) for the
   *unspecified*-`h` case — consider applying an analogous "overflow" policy
   even when `h` is specified but content doesn't fit, at minimum logging/
   flagging it) or clip, but **do not silently draw past the box with no
   indication** — that silent overflow is what produces the overlapping
   text seen in every one of these forms.
3. **Make the caption `reserve` collision safe.** When caption text measured
   in the resolved font exceeds `reserve`, either shrink the caption font,
   wrap the caption, or widen the reserve at layout time — anything other
   than letting it silently paint over the value.
4. Re-render all three fixtures after (1)-(3) and re-diff visually; most of
   §1's symptom list should shrink dramatically before any further
   investigation is needed.
5. **Isolate the `IPQT` 6→5 page-count regression separately** — it's in the
   opposite direction from the font-metric story and needs its own
   reproduction (bisect the subform tree; check whether the closing
   "Revision History" page/subform has an explicit `breakBefore` that isn't
   firing, or whether its estimated height is rounding to zero and being
   skipped by the pagination walk in
   [`apply-pagination.ts`](../src/domain/layout/apply-pagination.ts)).
6. Lower priority: font-resource dedup (§2.5) for file size, line-width
   rounding drift (§2.5), border rotation (§2.5).

---

## 5. How to reproduce locally

The fixtures already exist in the workspace (not reproduced in this doc):

```bash
npm run build
node dist/cli.js render \
  --xdp test/final-test/DGS/DGS_Datasheet.xdp \
  --xsd test/final-test/DGS/DGS_schema.xsd \
  --data test/final-test/DGS/DGS.xml \
  -o /tmp/DGS-fresh.pdf --lenient

node dist/cli.js render \
  --xdp "test/final-test/IPQT/IPQT_CoverLetter_IPQT_Template_EN.xdp" \
  --xsd test/final-test/IPQT/IPQT_CoverLetter_schema.xsd \
  --data test/final-test/IPQT/IPQT_CoverLetter.xml \
  -o /tmp/IPQT-fresh.pdf --lenient

node dist/cli.js render \
  --xdp test/final-test/MechanicalSeal/MechanicalSeal_Datasheet.xdp \
  --xsd test/final-test/MechanicalSeal/MechanicalSeal_schema.xsd \
  --data test/final-test/MechanicalSeal/MechanicalSeal.xml \
  -o /tmp/MechanicalSeal-fresh.pdf --lenient
```

Compare each against `test/final-test/Expected/*.pdf`. No PDF rasterizer
(`pdftoppm`/`gs`/`mutool`/ImageMagick) is available in this sandbox and there
is no `sudo` to install one — visual comparison has so far relied on the
developer's own screenshots. To verify the font-metric hypothesis in §2.1
without a rasterizer, the cheapest check is: temporarily force every font
request to resolve to a single known-good base-14 font (e.g. make
`loadFont()` always return Helvetica regardless of requested family) and
re-render `DGS`; if the page count returns to 1 and the table header row
stops shredding, §2.1 is confirmed as the dominant cause.

## 6. What this report could NOT do (relative to docs/DESIGNER-DATA-REQUEST.md)

[docs/DESIGNER-DATA-REQUEST.md](./DESIGNER-DATA-REQUEST.md) asks for
Designer-version metadata, exact font-descriptor ascent/descent dumps, and
probe-form measurements captured by physically opening Designer 11.0 and using
"Preview as PDF." This sandbox has no Windows/Designer install and the
`reference/tools/*.py`/`*.mjs` scripts that doc describes do not exist in this
repository (only `reference/README.md`, a DLL-analysis writeup, is present) —
so none of that doc's procedure could be executed. What *is* in this report
(§2.4, §2.5) was instead recovered directly from the three real `Expected`
PDFs already sitting in `test/final-test/` using an ad-hoc Node.js script
(regex + `zlib.inflateSync` on PDF streams, no external dependencies — `pip`/
`pypdf` are not available in this sandbox either). That script is not checked
into the repo; if deeper PDF-forensic diffing is needed again, it can be
quickly rewritten following the same approach (find `N 0 obj ... stream ...
endstream`, inflate, regex for `/FontDescriptor`, `/BaseFont`, operator
tokens) — or, better, dedicate an hour to actually installing `pypdf` (needs
network + no `pip` currently on `PATH`) and porting
`docs/DESIGNER-DATA-REQUEST.md`'s own `extract-pdf-facts.py` design, which is
more complete than the ad-hoc version used here.