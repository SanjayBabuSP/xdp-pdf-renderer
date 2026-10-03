# RENDERING_BEHAVIOR — Adobe LiveCycle Designer 11.0 "Preview as PDF"

Living reverse-engineering log. Evidence hierarchy: observable output > existing
tests > XFA/XDP spec > binary/decompiled evidence > inference > guesswork.
Every entry records the evidence and the confidence; conflicts are called out.

Reference binaries live in `reference/Adobe-LiveCycle-Designer-11.0/` (reorganized
install copy, complete as of the last audit) and Ghidra dumps in
`reference/decompiled/*_disasm.c` (117 binaries; `icudt40.dll` intentionally not
decompiled — ICU data tables only).

---

## 1. Presence / layout-space semantics

- **Behavior:** `visible` = laid out + painted. `invisible` = laid out (occupies
  space) but not painted. `hidden` = not laid out (no space) + not painted.
  `inactive` = not laid out + not painted.
- **Evidence:**
  - `XFALayout::isLayoutableObject` (`xfalayout_disasm.c:66815`) returns 0 for
    presence `0x2a0002`/`0x2a0003` (hidden/inactive) when the env flag is 0
    (`:66866`, `:66988`); `invisible` (`0x2a0001`) is not excluded.
  - The visible layout list appends only presence `0x2a0000`/`0x2a0001`
    (`:71155-71160`) — so `invisible` is in the layout list, hidden/inactive are not.
  - `XFALayout::isHiddenObject` (`:66682`) marks hidden/inactive hidden; and
    `DeviceDriver::isRenderable` (`renderer_disasm.c:35690`) returns 1 only for
    `visible` (`0x2a0000`), otherwise consulting XDC `supportsHidden/Invisible*`
    options (`:35721-35732`), which are 0 in `adobepdf.xdc`.
  - Presence enum: `visible,invisible,hidden,inactive` = `0x2a0000..0x2a0003`
    (`xfa_disasm.c:23724`, and `IMPLEMENTATION-PLAN.md` Appendix B).
- **Test:** `test/unit/domain/mapping/presence-semantics.test.ts`.
- **Current implementation:** `evaluate-conditions.ts` removes hidden/inactive
  (`isRemoved`) and keeps invisible; `pdf-renderer.ts:152` skips painting
  invisible/hidden/inactive unless `previewMode`.
- **Required:** matches (no change needed).
- **Confidence:** High.

## 2. Default line advance = 1.2 × fontSize (NOT the XDC `<metrics lineHeight>`)

- **Behavior:** The text engine's default line pitch is `1.2 × font size`. It is
  **not** the per-font `lineHeight` from `adobepdf.xdc` (1149‰ Helvetica/Times,
  1000‰ Courier).
- **Evidence:**
  - `jfFontItem` constructor sets the spacing field (`+0x80`) to the constant
    `DAT_14f269b0`, and the lineGap field (`+0x88`) to `DAT_14f28210`
    (`font_disasm.c:15753`,`:15742`,`:16154`,`:16143`). Extracted from
    `font.dll` `.rdata`: `DAT_14f269b0 = 1.2`, `DAT_14f28210 = 0.2`.
  - `jfFontItem::getDefaultSpacing` returns `DAT_14f269b0` (`font_disasm.c:10522`).
  - `XFALayout` consumes `jfFontInstance::getSpacing` to seed the layout node's
    text spacing (`xfalayout_disasm.c:21935`).
  - `adobepdf.xdc:265-333` `<metrics lineHeight>` is consumed only by
    `XFAFontService::createXDCFont` → `XDCFont::setLineHeight`
    (`xfafontservice_disasm.c:7944`) — i.e. the **device font entry**, not the
    layout line pitch.
- **Conflict:** The XDC `lineHeight` (1.149 for Helvetica) is *not* the layout
  advance. A prior implementation used it for `defaultLineAdvance`; this was
  reverted after extracting the 1.2 constant above.
- **Test:** `test/unit/rendering/line-metrics.test.ts`,
  `test/integration/workflow/para-rendering.test.ts`.
- **Current implementation:** `DEFAULT_LINE_ADVANCE_FACTOR = 1.2`
  (`line-metrics.ts`), overridable per paragraph by `<para lineHeight>`.
- **Required:** 1.2 default. Confidence: High.

## 3. `<para>` paragraph attributes

- **Behavior:** `<para>` carries `lineHeight` (line advance override),
  `spaceAbove`/`spaceBelow` (space around the paragraph), `textIndent`
  (first-line indent), `marginLeft`/`marginRight` (text-block insets), plus
  `hAlign`/`vAlign`.
- **Evidence:** property atoms `lineHeight`, `spaceAbove`, `spaceBelow`,
  `textIndent`, `marginLeft`, `marginRight` are present in `xfa.dll` (`strings`);
  `jfTextAttr` exposes `Spacing` (`jftext:3920`), `MarginL` (`:2888`),
  `MarginR` (`:2957`), `SpaceBefore` (`:3852`), `SpaceAfter` (`:3782`).
- **Test:** `test/unit/rendering/para-metrics.test.ts`,
  `test/unit/domain/parsing/parse-xdp.test.ts`, `test/integration/workflow/para-rendering.test.ts`.
- **Current implementation:** parsed into `ParaSpec` (all six attributes, points);
  applied to field values, static text draws, and styled rich-text runs —
  line advance, first-line indent, horizontal insets, horizontal/vertical
  alignment, and vertical padding incl. growable field height. Rich-text
  `justify`/`justify-all` distributes extra line width across styled spaces.
- **Required:** present. `lineHeight` percentage form is not yet interpreted
  (only measurement units).
- **Confidence:** High for the attributes and point semantics; Medium for exact
  `spaceAbove`/`spaceBelow` interaction with flow/pagination.

## 4. Borders — dash / cap / join / rounded corners

- **Behavior:** dash bit-patterns `solid 1 0`, `dotted 1 2`, `dashed 4 2`,
  `dashDot 3 2 1 2`, `dashDotDot 3 2 1 2 1 2`, scaled × thickness
  (`strokeTypeMultiplier = 1`); cap/join enums map to PDF `J`/`j`; corner radius
  clamped to `min(w,h)/2`; edges stroked top,bottom,right,left.
- **Evidence:** `adobepdf.xdc:187-191`, `:48`; `designrenderer_disasm.c:6182`
  (cap/join enum) and edge draw order `:6283+`; `renderer_disasm.c:24402`
  (corner clamp).
- **Test:** `test/unit/rendering/border-style.test.ts`,
  `test/integration/workflow/border-rendering.test.ts`.
- **Current implementation:** `border-style.ts` + `pdf-renderer.ts`
  (`drawEdge`, `strokeRoundedRectangle`). Rounded borders stroke one continuous
  path so `join` applies; shape `<border>` wrappers are unwrapped by `parseBorder`.
  Self-closing shape elements are detected by key presence, so `<circle/>` keeps
  the XFA default edge rather than disappearing.
- **Required:** matches. An omitted `thickness` uses the specification-default
  0.5pt black edge (XFA 3.3, Template Reference, edge/arc), including an omitted
  arc/circle edge.
- **Confidence:** High for dash/cap/join and 0.5pt default.

## 5. Device font metrics (XDC `<font>/<metrics>`)

- **Behavior:** `adobepdf.xdc` declares per-face `ascent`/`descent`/`lineHeight`/
  `capHeight`/`xHeight`/`defaultCharWidth` (per-mille at `size="1000pt"`).
- **Evidence:** `adobepdf.xdc:265-333`.
- **Current implementation:** **not used for layout** (see §2). Retained only as a
  reference table in this document pending a device-font-export parity task.
- **Confidence:** High that these are device-font metrics, not layout metrics.

## 6. Font equates (XCI)

- **Behavior:** `Designer.xci` equates e.g. `Helvetica_*_*`→`Arial_*_*`
  (`force="0"`, apply only if missing), plus forced CJK/Myriad/Kozuka rules.
- **Evidence:** `Designer.xci:9-40` (agent) and `:49-79` (present).
- **Current implementation:** `font-substitution.ts` + `parse-xdp.ts`
  `DEFAULT_FONT_EQUATE_RULES`; `FontManager` applies `force` semantics.
- **Confidence:** High.

## 7. Sizing rules

- **Behavior:** explicit `h` ⇒ fixed; bounded `[minH,maxH]` ⇒ not growable;
  otherwise content-driven = `max(child.y+child.h)`.
- **Evidence:** `xfatemplate_disasm.c:8510-8700`.
- **Current implementation:** `sizing.ts` (`isHeightGrowable`/`resolveExtent`).
- **Test:** `test/unit/domain/layout/sizing.test.ts`, `engines.test.ts`.
- **Confidence:** High.

## 8. Pagination

- **Behavior:** masterPage page iterator, each page's own content-area origin,
  forced breaks (`breakBefore/breakAfter`), keep semantics.
- **Evidence:** `xfalayout_disasm.c:67599,65267,87466,16822`.
- **Current implementation:** coordinate-based bucketing/fragmenting
  (`apply-pagination.ts`) — an approximation of `contentBlockToPage`.
- **Status:** diverges from Adobe on complex flows; needs oracle validation.
- **Confidence:** Medium.

---

## Open conflicts / uncertainties

1. **XDC `lineHeight` vs 1.2** — resolved in favor of 1.2 for layout (§2).
   If an exported oracle ever shows 1.149 line pitch, re-open.
2. **Default edge thickness** — 0.5 (straight) vs 1 (arc) inconsistency; needs
   evidence or an oracle.
3. **`spaceAbove`/`spaceBelow` interaction with flow/pagination** — applied to
   text blocks and growable field height, but rich-text pagination splitting
   has not yet been oracle-validated.
4. **`lineHeight` percentage** — not interpreted; only measurement units.
5. No Designer-exported oracle PDFs exist in this checkout
   (`scripts/verify-pdf.mjs` is ready but `test/final-test/` / `test/oracles/`
   are absent), so visual parity is currently unverifiable locally.
