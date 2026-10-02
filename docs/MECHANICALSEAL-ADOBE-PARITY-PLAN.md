# MechanicalSeal — Adobe LiveCycle Parity Plan

Goal: make the PDF produced by this npm package for
[test/final-test/MechanicalSeal_Datasheet.xdp](../test/final-test/MechanicalSeal_Datasheet.xdp)
(+ [schema](../test/final-test/MechanicalSeal_schema.xsd) +
[data](../test/final-test/MechanicalSeal.xml)) match the Adobe LiveCycle Designer reference
[MechanicalSeal_Datasheet_Expected.pdf](../test/final-test/MechanicalSeal_Datasheet_Expected.pdf).

This is an **execution plan only**. Each item below gives the observed symptom, the
code-verified root cause (with file references), the fix direction, and how to verify.

> **Status (execution round 1)**
>
> | # | Issue | Status |
> |---|-------|--------|
> | 1 | Assumption cells / presence scripts not applied | **Fixed** — identity-based reconciliation (`PropertyChangeTracker.applyByIdentity`), two-scriptable-node split removed (`buildScriptIndex` in `event-dispatcher.ts`), `this`/`$` bound to one object, CDATA scripts now parse |
> | 2 | FormCalc `initialize` values missing | **Fixed** — `createFieldAccessor` rewritten (`$.rawValue`, `.formattedValue`, `x.rotate`, data-record fallback), `parseFieldRef` accepts `$.path` |
> | 3 | `xfa:embed` unit labels missing | **Fixed** — new `src/domain/mapping/resolve-embeds.ts` runs after `dispatchScripts` in `render-pdf.ts`; nested exData now re-serialized by `parse-xdp.ts` |
> | 4 | DRAFT watermark missing | **Fixed** — preview flag, `$.presence` and `$.rotate = "30"` all resolve; `previewMode` already force-shows invisible nodes |
> | 5 | Header logo subtitle / `image/bmp` | **Already resolved** in `image-embedder.ts` (`decodeBmp`) + `image-sniff.ts`; master-page children render per page (`pdf-renderer.ts:117-118`) |
> | 6 | Fine typography / alignment | **Deferred** — no reliable oracle until the real fixture lands |
>
> The real `test/final-test/MechanicalSeal_*.xdp` fixtures referenced below do **not** exist in
> this checkout, so verification is via synthetic fixtures in
> `test/fixtures/mechanicalseal/` plus
> `test/integration/workflow/mechanicalseal-parity.test.ts` (10 tests) and unit tests under
> `test/unit/domain/scripting/` (`identity-reconciliation`, `script-value-properties`,
> `js-engine-parity`) and `test/unit/domain/mapping/resolve-embeds.test.ts`.
> Suite status: `npm run build` clean, **398 tests / 33 suites pass**, `npm run lint`
> reports only the 3 pre-existing errors (`fill-paint.ts:20`, `image-embedder.ts:92`,
> `pdf-renderer.ts:64`).

> Scope note: the earlier round of issues in
> [docs/PDF-OUTPUT-ISSUES.md](./PDF-OUTPUT-ISSUES.md) (pagination dropping page 2, repeated
> instances overlapping, borders/grid missing, vertical section labels missing, giant
> watermark) are **already fixed**. The current render now has the grid, page-2 content, the
> rotated left-margin section labels, and the header logo. The remaining divergences below are
> new/leftover and are dominated by **XFA script results not being applied** and **`xfa:embed`
> not being resolved**.

---

## Side-by-side summary of remaining differences

| # | Area | npm output (current) | Adobe reference (expected) |
|---|------|----------------------|----------------------------|
| 1 | Assumption value cells | Solid **black boxes** (no readable value) | Value shown (inverted = black bg + white text when it is an assumption; plain when not) |
| 2 | Script-computed values (OEM, etc.) | Empty / wrong | Filled (e.g. OEM = `ITT Bornemann GmbH`) |
| 3 | Unit labels (`kg/m3`, `mm²/s`, `bar g`, `°C`) | Missing | Present next to each process-data row |
| 4 | DRAFT watermark | Missing | Large light-gray diagonal `DRAFT` |
| 5 | Header logo subtitle | `a member of EKK and FREUDENBERG` partially/not rendered on page 1 | Fully rendered |
| 6 | Fine typography/alignment | Minor shifts | Reference |

---

## Issue 1 (Critical) — Assumption cells render as solid black boxes

### Symptom
Many value cells on both pages (e.g. `Speed min/max`, the Process-Data min/rated/max numeric
columns, `Machine location`, `Rotational direction`) render as **solid black rectangles** with
no readable value, instead of showing the value.

### Root cause
This form implements "inverted" (assumption) fields with **two overlapping fields at the exact
same `x`/`y`**, e.g. [MechanicalSeal_Datasheet.xdp](../test/final-test/MechanicalSeal_Datasheet.xdp#L6676)
and [L6710](../test/final-test/MechanicalSeal_Datasheet.xdp#L6710):

- `CustomerAsset.MachineLocation.name-Black` — `ui/textEdit/border/fill = 0,0,0` (black
  background) and `font/fill/color = 255,255,255` (white text). Should be **visible only when
  the value is an assumption**.
- `CustomerAsset.MachineLocation.name-White` — transparent fill, default black text. Should be
  **visible only when the value is not an assumption**.

Which one shows is decided solely by per-field `<event activity="initialize">` scripts:

```js
var isAssumption = xfa.record.CustomerAsset.MachineLocationIsAssumption.value === "true";
if (isAssumption) { this.presence = "visible"; } else { this.presence = "hidden" }
```

Neither field declares a `presence` attribute, so **both default to `visible`**. When the
presence toggle is not applied, both render at the same coordinates. Draw order paints
`-Black` first (black fill + white value) then `-White` on top (no fill + black value), so the
white value is overpainted by a black value on a black background → a **solid black box**.

`<font><fill><color>` IS parsed into `font.color`
([parse-xdp.ts](../src/domain/parsing/parse-xdp.ts#L472-L481)), so the white color is not the
problem — the problem is that **both variants are being drawn** because the presence scripts
never land on the layout nodes.

### Why the presence scripts don't land — the reconciliation bug
`dispatchScripts` runs and mutates a scriptable node map, then copies results back to the
layout tree in `applyModifiedValues`
([event-dispatcher.ts](../src/domain/scripting/event-dispatcher.ts#L857-L888)):

```ts
for (const [path, scriptable] of allNodes) {
  if (path.endsWith(`.${name}`) || path === name) {
    ...
    break; // first match wins
  }
}
```

This matching is unreliable for this form because:
- Field **names contain dots** (`CustomerAsset.MachineLocation.name-Black`), so
  `path.endsWith('.' + name)` is ambiguous/incorrect against a dot-delimited SOM path.
- Many fields share the **same name** (e.g. several
  `TechnicalSalesDocumentation.PressureUnit.name` instances — see
  [xdp L866](../test/final-test/MechanicalSeal_Datasheet.xdp#L866),
  [L934](../test/final-test/MechanicalSeal_Datasheet.xdp#L934),
  [L1002](../test/final-test/MechanicalSeal_Datasheet.xdp#L1002)). `break` on first match means
  the presence/value change is applied to the wrong instance or not at all.

Net effect: the `-Black`/`-White` presence toggles (and other script property changes) are not
reliably written back → both variants stay `visible` → black box.

### Fix direction
1. **Replace name-based reconciliation with identity-based reconciliation.** Give every layout
   node a stable unique key during parse (reuse the XDP `id`/`name` plus an occurrence index, or
   assign a synthetic uid), carry that same key on the scriptable node, and in
   `applyModifiedValues` match by that key — not by `path.endsWith('.'+name)` with `break`.
   This is the single highest-impact fix: it unblocks Issues 1, 2, and part of 4.
2. Confirm the per-field `initialize` scripts are actually **collected and executed** for these
   `-Black`/`-White` fields (check `collectScripts`/`buildNodeMap` in
   [xfa-object-model.ts](../src/domain/scripting/xfa-object-model.ts)). They are
   `contentType="application/x-javascript"`, so they run through the JS engine.
3. Confirm `xfa.record.CustomerAsset.MachineLocationIsAssumption.value` **resolves against the
   data record**. In the data, `<MachineLocationIsAssumption/>` is an empty element
   ([MechanicalSeal.xml](../test/final-test/MechanicalSeal.xml#L4382)), so `.value` must evaluate
   to `""` (→ `isAssumption === false`) **without throwing**. If the SOM resolver throws on a
   missing/empty record node, the whole `initialize` event aborts and presence stays at the
   default `visible` → black box. Ensure unresolved/empty `xfa.record.*.value` yields empty
   string, not an exception.
4. **Defensive layering safeguard** (independent of scripting): when two fields share identical
   geometry and bind ref but differ only by a `-Black`/`-White`-style variant, only one should
   paint. Even after the script fix, add an assertion/test so a future regression that leaves
   both visible is caught.

### Verify
- Unit test for `applyModifiedValues`: two sibling fields with dotted + duplicate names; assert a
  `presence` change applied to one does not leak to the other and lands on the correct node.
- Render the fixture and extract text/operators; assert the `-Black` field for a **non**-assumption
  value (e.g. MachineLocation, whose `IsAssumption` is empty) is `hidden` and only the `-White`
  value text is emitted. Assert no full-cell black `re`/`f` fill is emitted over a value whose
  assumption flag is false.

---

## Issue 2 (Critical) — Values computed by `initialize` scripts are missing

### Symptom
Fields whose display value is assigned by script are blank in npm but populated in Adobe — most
visibly `OEM` (expected `ITT Bornemann GmbH`), and any field whose value is script-derived.

### Root cause
Example OEM field at
[xdp L6651-6658](../test/final-test/MechanicalSeal_Datasheet.xdp#L6651) (FormCalc):

```formcalc
if (OEM.TechnicalSalesDocumentation_OEMDescription.rawValue <> null) then
  $.rawValue = OEM.TechnicalSalesDocumentation_OEMDescription.formattedValue
else
  $.rawValue = OEM.TechnicalSalesDocumentation_OEM.formattedValue
endif
```

Data has `<OEMDescription/>` empty and `<OEM>ITT Bornemann GmbH</OEM>`
([MechanicalSeal.xml](../test/final-test/MechanicalSeal.xml#L4391)), so the script should set
`$.rawValue = "ITT Bornemann GmbH"`. It isn't showing because:
- The same **reconciliation bug** (Issue 1) prevents the computed `rawValue` from being written
  back to the right layout node, and/or
- The FormCalc evaluator does not resolve the **sibling-reference + `formattedValue`/`rawValue`**
  access pattern (`OEM.TechnicalSalesDocumentation_OEM.formattedValue`) against the data/node
  model.

### Fix direction
1. Land the **identity-based reconciliation** fix from Issue 1 first (necessary precondition).
2. In the FormCalc evaluator ([formcalc/evaluator.ts](../src/domain/scripting/formcalc/evaluator.ts))
   and the field accessor ([xfa-object-model.ts](../src/domain/scripting/xfa-object-model.ts)),
   ensure `node.child.formattedValue` and `.rawValue` resolve for sibling/descendant references,
   and that `$.rawValue = ...` assignment updates the node's `resolvedValue` that the renderer
   reads (`formatValue(node.resolvedValue, …)` in
   [pdf-renderer.ts](../src/rendering/pdf-renderer.ts#L420)).
3. Treat empty-element data as `null`/empty so the `<> null` branch selects the correct source.

### Verify
- Render the fixture; assert the OEM cell text equals `ITT Bornemann GmbH`.
- Add a FormCalc unit test for the `if rawValue <> null then formattedValue else …` pattern with
  an empty sibling.

---

## Issue 3 (High) — Unit labels (`kg/m3`, `mm²/s`, `bar g`, `°C`) are missing

### Symptom
The Process-Data rows on page 1 show no unit column in npm; Adobe shows `kg/m3`, `mm²/s`,
`bar g`, `µS/cm`, `°C`, etc. These strings are **not** literal text in the XDP (grep finds
none).

### Root cause
Units come from **hidden `floatingField` unit fields** bound to the data
(`DensityUnit`, `ViscosityUnit`, `TechnicalSalesDocumentation.PressureUnit.name`,
`…TemperatureUnit.name`), declared `presence="hidden"` at `x=0 y=0`, e.g.
[xdp L756](../test/final-test/MechanicalSeal_Datasheet.xdp#L756),
[L811](../test/final-test/MechanicalSeal_Datasheet.xdp#L811). They are pulled into the visible
layout through **`xfa:embed`** inside an `exData` HTML draw, e.g.
[xdp L545-L551](../test/final-test/MechanicalSeal_Datasheet.xdp#L545):

```xml
<draw name="T37" ...>
  <value>
    <exData contentType="text/html">
      <body ...><p><span xfa:embedType="uri" xfa:embedMode="raw"
            xfa:embed="#floatingField004827"/></p></body>
    </exData>
  </value>
</draw>
```

`xfa:embed` is **not handled anywhere** in `src` (grep for `xfa:embed`/`embedType`/`embed=`
returns nothing). The embedding draw therefore renders empty, and the referenced hidden field is
(correctly) skipped by the presence guard — so the unit never appears.

### Fix direction
1. **Parse `xfa:embed` references** in the rich-text / `exData` HTML parser
   ([rich-text-parser.ts](../src/rendering/rich-text-parser.ts)). When a `<span>` has
   `xfa:embed="#id"` (and `xfa:embedType="uri"`), record the referenced field id.
2. Build an **id → resolved-value index** of all fields (including `presence="hidden"` ones; their
   value must still be resolved during binding even though they are not drawn directly). The
   embedding draw should render the **referenced field's formatted value** (honoring its `font`,
   `para`, and format picture) at the draw's position.
3. Ensure hidden source fields are still **data-bound and script-run** (so their value exists)
   even though they are not themselves painted — only their *inline-embedded* appearance is
   painted via the host draw.
4. Respect `xfa:embedMode="raw"` (embed the value as-is) vs `formatted`.

### Verify
- Render the fixture; assert `kg/m3`, `mm²/s`, `bar g`, `°C` appear at the Process-Data unit
  positions.
- Unit test the exData parser: a `<span xfa:embed="#f1"/>` resolves to field `f1`'s value.

---

## Issue 4 (Medium) — DRAFT watermark missing

### Symptom
Adobe renders a large light-gray diagonal `DRAFT` watermark on both pages; npm renders none.

### Root cause
The watermark lives in `txtWatermarkSubform` with `presence="invisible"`
([xdp L13](../test/final-test/MechanicalSeal_Datasheet.xdp#L13),
[L246](../test/final-test/MechanicalSeal_Datasheet.xdp#L246)), made visible only by an
`initialize` script guarded by a preview flag
([xdp L19-L21](../test/final-test/MechanicalSeal_Datasheet.xdp#L19)):

```js
var IsPreview = xfa.resolveNode("xfa.record.IsPreview").value
... $.presence = "visible"
```

and rotated by a second script `txtWatermark.rotate = "30";`
([xdp L47](../test/final-test/MechanicalSeal_Datasheet.xdp#L47)). The renderer has a
`previewMode` option that force-shows invisible nodes
([pdf-renderer.ts](../src/rendering/pdf-renderer.ts#L141-L144)), but:
- the watermark only appears when `previewMode` (or the `IsPreview` data/record flag) is set, and
- the script-driven `rotate = "30"` must actually be applied to the field so the text is slanted
  (today a static `rotate` is rendered, but this one is assigned by script and depends on the
  same reconciliation path as Issue 1).

### Fix direction
1. Decide product behavior: the reference is a **preview/draft** export. To match it, render with
   `previewMode` (or detect `xfa.record.IsPreview.value === "true"` from the data and set it).
2. Ensure the script `txtWatermark.rotate = "30"` is applied to the node (depends on Issue 1
   reconciliation) **or**, if full script fidelity is deferred, special-case the known watermark
   subform in preview mode to force `presence=visible` + `rotate=30`.
3. Confirm the watermark fill color `153,153,153`
   ([xdp L41](../test/final-test/MechanicalSeal_Datasheet.xdp#L41)) and large font render behind
   content (drawn before/under the grid, matching Adobe z-order).

### Verify
- Render with preview enabled; assert a rotated `DRAFT` text run (~30°, gray) is emitted on each
  page. Add a non-preview test asserting it is absent.

---

## Issue 5 (Low) — Header logo subtitle not fully rendered on page 1

### Symptom
`a member of EKK and FREUDENBERG` under the EagleBurgmann logo is partial/missing on page 1 in
npm; present in Adobe (and appears on page 2 header).

### Root cause (to confirm during execution)
Likely one of: (a) a second embedded image asset for the subtitle that is a format pdf-lib
cannot embed (the fixture contains an `image/bmp` asset — see
[docs/PDF-OUTPUT-ISSUES.md](./PDF-OUTPUT-ISSUES.md) issue #7 — which is silently dropped by
[image-embedder.ts](../src/rendering/image-embedder.ts#L13-L24)); or (b) a master-page draw that
is clipped/positioned off the page-1 content area but present on page-2's template.

### Fix direction
1. Identify the subtitle source (image vs text draw) in the page-1 master page of the XDP.
2. If it is a BMP image, add BMP→PNG transcoding before embedding (or document BMP as explicitly
   unsupported). If it is a draw clipped by pagination, verify the master-page children are
   rendered for page 1 the same as page 2.

### Verify
- Render; assert the subtitle text/image is present on page 1.

---

## Issue 6 (Low) — Fine typography / alignment

### Symptom
Minor horizontal/vertical shifts of some labels and values vs the reference.

### Root cause / fix direction
Re-evaluate **only after Issues 1–3 land**, because much of the apparent misalignment today is a
side effect of the `-Black`/`-White` stacking and missing embedded values. Then diff remaining
caption `reserve`/placement and `vAlign="middle"` + `spaceAbove` handling in
[computeFieldTextLayout](../src/rendering/pdf-renderer.ts#L326) and the text baseline metrics.

---

## Recommended execution order

1. **Issue 1 reconciliation fix** (identity-based node matching in
   [applyModifiedValues](../src/domain/scripting/event-dispatcher.ts#L857-L888)) + robust
   `xfa.record.*.value` resolution. Unblocks black boxes, most missing values, and the
   script-driven watermark rotation.
2. **Issue 2** FormCalc sibling/`formattedValue` resolution + assignment write-back.
3. **Issue 3** `xfa:embed` resolution for `exData` draws (units).
4. Re-render and re-diff against the reference; then **Issue 4** (preview/watermark decision).
5. **Issue 5** (logo subtitle) and **Issue 6** (typography) last.

## Verification tooling note
No PDF rasterizer is available in this environment (no `pdftoppm`/`gs`/`mutool`/ImageMagick, no
`sudo`). Validate via: `npm run build && npm test`, a lenient render of the fixture
(`node dist/cli.js render --xdp … --xsd … --data … -o out.pdf --lenient`), and a text/operator
extraction script (pdf-lib) asserting the presence/absence of specific value strings, unit
strings, the DRAFT run, and full-cell black fills. Pixel-diffing against the reference requires a
Windows host running Adobe LiveCycle (out of scope here).

---

# Feature-parity migration program (G1–G16)

Execution of the full parity program identified from `reference/decompiled`
(346 MB of Ghidra C dumps of Adobe Designer/Acrobat). Verification bar for this
program: **unit + integration tests only, no visual/pixel diff**.

Baseline: 457 tests / 35 suites → **601 tests / 55 suites**, `npm run build`
clean, `npm run lint` clean except two pre-existing errors
(`fill-paint.ts:20`, `image-embedder.ts:92`).

| Gap | Item | Status | Key evidence / notes |
|-----|------|--------|----------------------|
| G1 | Barcodes | ✅ Done | `code128A/B/C/SSCC` were declared supported but fell through to Code 39 — now wired (`encodeCode128`, `encodeCode93`, `encodeMsi`, `encodeUpcE`, `2of5standard`). Checksums verified. |
| G2 | `@relevant` conditional visibility | ✅ Done | `src/domain/mapping/relevance.ts`; `evaluateConditions(layout, data)`; fails open on parse errors; top-level `\|` OR lists. |
| G3 | Interactive events + bubbling | ✅ Done | `dispatchInteractiveEvent`; node-aware `XfaEventDispatcher` in `src/adobe/xfa-event-bubbling.ts`; `xfa.event` fixed. |
| G4 | `xfa.layout.*` | ✅ Done | `xfa.layout.page(this)` / `pageCount()` / `pageContent()` (see `ConvertIP.exe_disasm.c:73871`). |
| G5 | `instanceManager` | ✅ Done | Real `addInstance` / `removeInstance` / `setInstances` / `moveInstance`; clones registered into the shared node map. |
| G6 | Unparsed XFA nodes | ✅ Done | `<assist>`, `<extras>`, `<traversal>`, `<subformSet>`, `<area>`, `<format><picture>`, nested `exclGroup` children. |
| G7 | choiceList / button / signature UI | ✅ Done | `resolveChoiceText`, `renderButton`, signature flatten; fixed empty-element `<ui><signature/>` presence detection. |
| G8 | AcroForm widgets | ✅ Done (opt-in) | `adobe.acroForm`; `/FT`, `/T`, `/TU` (from `<assist>`), `/Ff`; `<traversal>` ordering. |
| G9 | PDF encryption | ✅ Done | RC4-40 / RC4-128 / AES-128 (V1/V2/V4), `/Encrypt` in trailer, random `/ID`, per-object stream+string crypto. Object streams disabled when saving. |
| G10 | Font subsetting | ✅ Done | `embedFont(bytes, { subset: true })`; verified embedded size ≪ full fallback TTF. |
| G11 | Tagged PDF | ✅ Done (structure only) | `adobe.tagged`; `MarkInfo`, `StructTreeRoot`, per-page `StructParents`. Content-stream marked content (BDC/EMC) not yet emitted. |
| G12 | `/XFA` package streams | ✅ Done | `adobe.embedXfa`; XDP packets re-serialised into `/XFA` name/stream array. |
| G13 | Compound picture engine | ✅ Done | `date{…}` / `time{…}`, locale month/weekday names, AM/PM (`value-format.ts`). |
| G14 | Image filters | ⚠️ Partial | RunLength + LZW decoders, JPEG 2000 dimension parsing, direct-filter XObjects for `JPXDecode`/`CCITTFaxDecode`. CCITT G4 decompression itself is pass-through only. |
| G15 | Barcode symbology coverage | ⚠️ Partial | Added `code93`, `msi`, `upcE`, `2of5standard`. `pdf417` and the postal families (Adobe `support="software"`) remain pending — they need 2D/4-state encoders the current fixed-height `Bar` model cannot express. |
| G16 | Dead code + config limits | ✅ Done | Wired `xfa-namespace-validation` (strict version enforcement), `font-sequences`; deleted the redundant `evaluate-calculations` stub; `maxInputSize`, `pdfVersion` and `adobeExtensionLevel` now enforced in output. |

New public options (`RenderOptions.adobe`): `acroForm`, `tagged`,
`embedXfa`. Barcode/font/security behaviour is unchanged unless opted in, with
the exception of font subsetting (now always on) and the corrected Code 128
encoders.

## Remaining work
- G11: emit marked-content operators so structure elements bind to MCIDs.
- G14: implement CCITT Group 4 decompression for non-pass-through TIFFs.
- G15: PDF417 and postal symbologies.
