# Plan: Porting the decompiled LiveCycle "Preview PDF" pipeline into `xdp-pdf-render`

**Decisions locked (from Q&A):** visual-match output only (flattened content streams, keep `pdf-lib`) · full subsystem parity, phased · oracle fixture (`test/final-test/MechanicalSeal…`) restored locally · LiveCycle Designer 11 available for exporting oracles.

**Source of truth:** Ghidra decompilations in `reference/decompiled/*_disasm.c` (346MB, ~130 binaries), config values in `reference/config_files/` (`Designer.xci`, `adobepdf.xdc`), function catalog in `reference/script_templates/FormCalc_fn.ini`.

---

## 0. Ground rules

1. **The decompiled C is the spec.** Every behavioral change cites `reference/decompiled/<file>_disasm.c:line` in a code comment or test (`// evidence: xfalayout_disasm.c:16822`). We port algorithms/semantics from pseudocode — we never copy Adobe code (clean-room, educational use).
2. **Pure TypeScript, `pdf-lib` stays.** Where pdf-lib lacks an API (ExtGState alpha, shading dicts), manipulate `PDFRawStream`/`PDFDictionary` directly in a small `src/rendering/pdf-lowlevel.ts`.
3. **Explicitly out of scope** (visual-match decision): `/XFA` packet embedding, AcroForm widget annotations, `NeedsRendering`/`NeedAppearances`, printer drivers, ICU-full collation, ExtendScript (existing `js-engine` covers JS), barcodes whose XDC says `support="none"`.
4. **No milestone merges without a rendered oracle diff.**

---

## 1. Architecture map — Adobe component → decompiled evidence → target TS module

| Adobe component | Decompiled file (evidence) | Target TS module |
|---|---|---|
| `jfformcalc.dll` interpreter | `jfformcalc_disasm.c` (VM `:17486`, builtins `:8462`, compare `:19655`, toNumber `:22162`) | `src/domain/scripting/formcalc/*` (extend) |
| `xfascripthandler` + event lifecycle | `xfascripthandler_disasm.c:7146`, `xfa_disasm.c:49231`, `xfaform_disasm.c:30280`, `xfapresentationagent_disasm.c:9637–9880`, `xfalayout_disasm.c:56731` | `src/domain/scripting/event-dispatcher.ts` (rewrite), `src/workflows/render-pdf.ts` |
| `xfalayout` engines | `xfalayout_disasm.c:15871,49833,92148,96122,67599,16822`; `xfatemplate_disasm.c:8520` | `src/domain/layout/{flow-engine,calculate-positions,apply-pagination,calculate-table-layout}.ts` |
| Presentation/renderer | `renderer_disasm.c:38088,35670,30023`, `designrenderer_disasm.c:6182,15972`, `jfgraphic_disasm.c`, `pdfldriver_disasm.c:12377,60525` | `src/rendering/pdf-renderer.ts` + new `border-style.ts`, `fill-paint.ts`, `pdf-lowlevel.ts` |
| Text/font | `jftext_disasm.c:60643,67533,73245`, `font_disasm.c:23483,26867,10517`, `xfafontservice_disasm.c:8758,11871` | new `src/rendering/text/{measure,line-breaker,justifier,line-metrics}.ts` + existing `font-manager/substitution` |
| Images | `jfgraphic_disasm.c:17878,19577`, `xfaimageservice_disasm.c:9324,9281` | `src/rendering/image-embedder.ts` (rewrite) + new `image-scaler.ts`, `image-sniff.ts` |
| Device config (values we can't recover from `DAT_*`) | `reference/config_files/Designer.xci`, `adobepdf.xdc` | `src/config/xdp-device-config.ts` (parsed at build → JSON) |

---

## 2. Phase 0 — Verification harness (prerequisite for everything)

- Restore `test/final-test/` (MechanicalSeal xdp/xsd/xml + `Expected.pdf`) from local copy; add to git (adjust `*.pdf` gitignore with `!test/**/*.pdf` exception).
- Add `scripts/verify-pdf.ts` + devDeps `pdfjs-dist` + `pixelmatch` + `pngjs`: rasterize both PDFs at 150 dpi (pdfjs → canvas, no native deps, CI-portable), per-page pixel-diff %, write `diff-<page>.png` artifacts. Wire `npm run verify` and a jest golden test with a threshold.
- **Export 4–6 more oracle pairs from Designer**, each isolating one subsystem:
  - (a) flow/table/repeats
  - (b) rotate + watermark scripts
  - (c) borders/dashes/corners/gradients/alpha
  - (d) images with aspect modes
  - (e) heavy FormCalc
  - (f) fonts/justification/overflow

  Store under `test/oracles/<name>/{form.xdp,schema.xsd,data.xml,expected.pdf}`.
- Re-baseline `PDF-OUTPUT-ISSUES.md`: research shows #1 (pagination), #3 (rotate), #4 (height) are **already fixed** in current code; #2 offsets now exist but are estimate-based; #6 watermark awaits Phase 1. Rewrite the doc to reflect reality.
- **Acceptance:** `npm run verify` green (or baseline recorded) on all fixtures.

---

## 3. Phase 1 — Script lifecycle & visibility (highest leverage; fixes "when to run FormCalc")

Evidence-derived target order for one render pass (`xfapresentationagent_disasm.c:13207` `processRecord` → `xfalayout_disasm.c:56731` `XFAFormLayout::ready`):

```
mergeRecord (data binding) → layoutRecord:
    setReady($layout)                        ← BEFORE scripts
    initializeNewContentNodes                ← activity=initialize, leaf-first (xfaform.c:30135)
                                               + indexChange per new instance
    getDefaultValidate
    recalculate: calculate queue → validate queue  (xfaform.c:30280; NO 25-iteration cap,
                                               reentrancy guard, ends by dispatching "overlay")
    dispatch activity="ready" ref="$layout"   ← if any handler ≠0 → relayout loop
startRecord → renderRecord → endRecord        ← prePrint/postPrint per record
clearScriptingContexts
```

Tasks:

1. **Rewrite `event-dispatcher.ts` phases** to the order above; delete the fabricated `layout:ready` activity mapping (`parse-xdp.ts:456-487`) — Adobe uses `activity="ready"` + `ref="$layout"|"$form"`. Parse `ref` in script extraction.
2. **Add relayout feedback:** any script write to layout-affecting SOM properties (`presence`, `h/w/x/y`, `layout`, `occur`, `caption`) sets `layoutDirty`; re-run layout+ready until stable (mirrors `vtable+0xa0` relayout at `xfalayout_disasm.c:56795`).
3. **Remove the calculate cap (25)**; implement the leaf-first calculate queue (children before parents) — currently confirmed matching, keep it.
4. **Presence semantics:** layout excludes `invisible` (takes no space), keeps `hidden` (occupies space, not painted) — `xfalayout_disasm.c:66677,66810`, `xfatemplate_disasm.c:8400`. Fix `evaluate-conditions.ts:60-62` (currently inverted) and `pdf-renderer.ts:88`.
5. **Empirical resolution #1 (do first, ~1h):** two sources disagree on the presence enum order (`xfa_disasm.c:23724` vs renderer XDC pairing) and on activity index 11 (`postSave` vs `ready`). Export two minimal XDPs from Designer (one `presence="hidden"`, one `invisible"`; one `activity="ready"` event) and observe — that pins both.
6. Watermark DRAFT subform should now appear (issue #6) with script-set `rotate=30` once initialize runs.

**Acceptance:** oracle (b) — watermark + rotated text + presence matches Designer export; scripted `calculate` values appear identical.

---

## 4. Phase 2 — Layout engine parity

1. **Split layout into three engine modules** mirroring the C dispatch (`xfalayout_disasm.c:15871-15920`): `flow-engine.ts` (tb/lr/rl), `position-engine.ts` (absolute; also the fallback for fields/draws), `table-engine.ts` (table/row/rl-row with warn→position fallback). Enum coercion rules from `:15873,49846,64348`.
2. **Repeat positioning:** stop pre-offsetting in `expand-repeats.ts` with height *estimates*; let the flow engine stack instances during layout (Adobe: `addInstances` `:6028` inserts nodes, engine assigns x/y). `expandRepeats` keeps data binding only.
3. **Real pagination** (`xfalayout_disasm.c:67599,65267,72657,87466`): page iterator over pageSets/masterPages, anchor content to each page's own content-area origin, **split** overflowing subtrees across pages (equivalent of `contentBlockToPage` `:40731`), delete the post-hoc y-shift in `apply-pagination.ts:54-60`. Support `breakBefore/breakAfter` (`:16822-16915`) and `keep` (all three keep properties auto = no keep, `:66094`).
4. **Sizing rules** (`xfatemplate_disasm.c:8520-8695`): `h` specified ⇒ fixed; otherwise growable iff `!(maxH <= minH)`; add `maxH/maxW` clamping; content-driven height = `max(child.y+child.h)`.
5. **Caption geometry** (`xfalayout_disasm.c:30626-31027`): reserve/placement feeds container extent; overflowing-caption gate — fixes the "Pos." collisions (issue #5).
6. **lr/table upgrades:** `hAlign/vAlign` in flow, column occupancy (colspan-like), remove the hard row-height floor of 18.

**Acceptance:** MechanicalSeal page 1/2 pixel-diff < 1%; new oracle (a) matches.

---

## 5. Phase 3 — FormCalc full parity

1. **Semantics fixes** (from `jfformcalc_disasm.c`):
   - `isTruthy` → `toNumber(x)!==0` with NaN=false (`evaluator.ts:836`)
   - number→string = fixed-point `sprintf("%#.*f")` + strip trailing zeros/dot, never exponent (`:14903,14611`)
   - comparisons: empty string ≡ null, null compares by *type* (`=`/`<=`/`>=` true on equal types, `<`/`>` false), string compare via locale collation, object identity for type-6, NaN guard inverted (`:19655`)
   - `AND/OR` non-short-circuit (`:16171`)
   - `toNumber`: null→0, unconsumed string→0 (`:15165`)
   - `log` = natural log (currently `Math.log10`)
2. **Language gaps:** `for` over node-lists/wildcards (type-9 expansion, `:17756`), SOM `.` path chaining (`:16746`), full string escapes (`\xHH`, `\0nnn`, doubled quotes — `:14611`), verify keyword table (dump `.rdata` string table `0x15d2a290` from `reference/script_engine/jfformcalc.dll` with `strings` — open item: confirm ELSEIF/UNTIL/STEP/FROM and the `\\` int-div/power rules).
3. **Builtins to add (26):** `DATEFMT DATETIMEFMT TIMEFMT NUMFMT NUM2GMTIME MOD THROW EVAL REF PI DEG2RAD RAD2DEG ENCODE DECODE UNITVALUE UNITTYPE MESSAGEBOX` + financials `APR CTERM FV IPMT PMT PPMT PV RATE TERM` (registry at `:8462-8561`; guard ÷0 like `:4151`).
4. **Error parity:** codes `0x7800–0x7813` with position/line attachment (`:24260-24271`).
5. Test corpus generated from `reference/script_templates/FormCalc_fn.ini` — one golden test per function.

**Acceptance:** all FormCalc_fn.ini tests green; oracle (e) field values identical to Designer.

---

## 6. Phase 4 — Text & font engine

New `src/rendering/text/`:

1. `measure.ts` — quantized advances `trunc(em*1000/size)*size ± 0.5` (`jftext:60643`), `charSpacing` always + `wordSpacing` only on space-class glyphs (`:60763`), kerning **on by default** (`font:119241` flag `0x200`), notdef substitution for negative widths.
2. `line-breaker.ts` — wrap limit = frame − margins − first-line indent (`:65339`), tolerance 0.5 (0.001 in tight-fit), break-prop prohibition (`:49545`), hyphenation off by default (`:120422`).
3. `line-metrics.ts` — default line advance **1.2 × fontSize** (`font:10517` — replaces the `*1.4` at `pdf-renderer.ts:403,544,607`), ascent+descent+lineGap per run, legacy metrics mode.
4. `justifier.ts` — JustH 0–9 (incl. justify/justify-all `slack/gapCount` on spaces, comb modes) + JustV 1/2/3 (`jftext:72062,73245`).
5. **Rotation:** normalize `rotate` mod 360 (`xfalayout:19412`), 90/270 ⇒ box swap + coordinate remap (`renderer:37609,37881`) and clip suppression when rotated (`designrenderer:7755`).
6. **Rich text:** wire `rich-text-parser.ts` runs into measure/line-break (per-run font/size), replacing `stripHtml` flattening (`pdf-renderer.ts:794`).
7. **Overflow:** clip only when content exceeds box (`jftext:144269`); do **not** invent autoSize (absent in Adobe).
8. **Fonts:** embed Adobe faces from `reference/fonts` (88 OTFs); equate rules from `Designer.xci` with `force` semantics — apply only-if-missing unless `force="1"` (`font:26867`); standard-14 fallback; keep existing substitution modules.

**Acceptance:** text columns of oracle (f) align within diff threshold; unit tests pin glyph x-positions.

---

## 7. Phase 5 — Borders, fills, alpha, gradients

1. **Per-edge border model:** 4 edges drawn in order 0,2,1,3 with per-edge thickness/color/style/cap (`designrenderer:6182`); fill first, then strokes.
2. **Dash:** ratios come from `adobepdf.xdc:187-191` (`solid 1 0`, `dotted 1 2`, `dashed 4 2`, `dashDot 3 2 1 2`, `dashDotDot 3 2 1 2 1 2`), × thickness clamp × `strokeTypeMultiplier=1` (`:60525`), ≤8 entries, emit `[...] phase d` with GState caching (`pdfldriver:12377`). Replace hardcoded arrays at `pdf-renderer.ts:219-232` with config-driven table.
3. **Caps/joins:** enum `0x50000/1/2` → PDF 0/1/2; corner-radius clamp modes (`renderer:24402`) — completes `cornerRadius` partial support.
4. **Alpha:** `/ca /CA /BM` via ExtGState (`pdfdocument:144010,138444`) in `pdf-lowlevel.ts`; page transparency group (`pdfldriver:61272`).
5. **Gradients:** XFA fill types toRight/toBottom/toLeft/toTop + radial → PDF axial/radial shading dicts (`renderer:35845,36519`, `pdfldriver:40203`); move `gradientFills` from unsupported→supported.
6. **Colors:** gray collapse `r==g==b → g/G` (`pdfldriver:10496`), color/line-width GState caching.

**Acceptance:** oracle (c) matches — this closes `supported-features.json` gaps for alpha/gradients/cornerRadius.

---

## 8. Phase 6 — Images

1. **Magic-byte sniffing** instead of trusting `contentType` (`jfgraphic:17878`).
2. **Decoders:** PNG/JPEG pass-through; BMP/GIF/TIFF → transcode to PNG (recommend pure-JS `jimp`; keeps the package dependency-free of natives — `sharp` as optional peer if perf matters). Closes PDF-OUTPUT-ISSUES #7.
3. **Aspect math** (`xfaimageservice:9324-9379`): `none`=stretch, `fit`=uniform `min()` when aspects differ, `actual`=72/xres DPI sizing, `width`/`height`; **alignment offsets** only when scaled < box (`:9281`); 90/270 box swap before scaling (`pdfldriver:45806`).
4. Alpha strip before embed + SMask where pdf-lib allows (else document).
5. EPS/SVG: keep in explicit-unsupported list initially (rasterizer would be a separate decision).

**Acceptance:** oracle (d) — image sizes/positions match; unsupported list truthful.

---

## 9. Phase 7 — Full-parity remainder

- **Barcodes:** implement symbologies marked `support="software"` in `adobepdf.xdc:213-240` (code128/39, EAN, 2of5, codabar) + QR/DataMatrix, geometry per `moduleWidth`/`wideNarrowRatio` ranges and `reference/barcode_data/BarcodeData.xml`. Replaces `barcodeRendering` unsupported flag.
- `checkButton`/`choiceList`/`exclGroup` flattened rendering (combo/list/check boxes drawn as vectors).
- Page numbering (`PAGE`/`NUMPAGES` patterns), masterPage/pageSet cycling polish, `/Rotate` mod-360, MediaBox from content area (`pdfdocument:134242`).
- ICC: only if diffs show color shifts (otherwise DeviceRGB suffices for visual match).

---

## 10. Verification loop & risks

**Loop (every PR):** Designer export → `npm run verify` → pixel-diff → annotate residuals in `PDF-OUTPUT-ISSUES.md` → next milestone. Threshold ladder: 5% → 1% → 0.1% per page.

**Open empirical items**:

1. ~~Presence enum order + activity index 11~~ — **RESOLVED from `xfa.dll` static data** (see Appendix B).
2. ~~Layout enum order~~ — **RESOLVED from `xfa.dll` static data** (see Appendix B).
3. `DAT_*` float constants (dash scale, corner clamp factor, alpha threshold) — recover from XDC configs or measure from oracle PDFs with `qpdf`.
4. Interactive-vs-not rendering of invisible fields (`renderer:35670` `isInteractive` flag) — Phase 1 experiment.

---

## Appendix B — Enum tables resolved from `xfa.dll` (binary ground truth)

Extracted from the XFAEnum family tables in `xfa.dll` (imagebase `0x16700000`;
family base = `0xcaf90 + familyIndex × 0x2FB0` in `.data`; entries are pointers to
`jfLiteral` objects constructed in `xfa_disasm.c`'s atom-init function).

**Family `0x4b` — event activities** (family index = value & 0xFFFF):

| # | activity | # | activity | # | activity |
|---|---|---|---|---|---|
| 0 | initialize | 9 | prePrint | 18 | preExecute |
| 1 | enter | 10 | postPrint | 19 | postExecute |
| 2 | exit | 11 | **ready** | 20 | preOpen |
| 3 | mouseEnter | 12 | docReady | 21 | indexChange |
| 4 | mouseExit | 13 | docClose | 22 | preSign |
| 5 | change | 14 | mouseUp | 23 | postSign |
| 6 | click | 15 | mouseDown | 24 | postSubmit |
| 7 | preSave | 16 | full | 25 | postOpen |
| 8 | postSave | 17 | preSubmit | 26 | validationState |

- Resolves the `0x4b000b` conflict: `getString(0x4b000b)` = **`"ready"`** (table order
  differs from atom order — mouseUp/mouseDown/full are relocated after docClose).
  Renderer's `activity==getString(0x4b000b) && ref=="$layout"` (`renderer:35574`) is the
  **layout ready event**, matching FormDesigner's `("ready","$layout")` pairs (`FormDesigner:491315`).
- executeReason codes (`xfa:82613`): 1=calculate, 2=calcProperty, 3=validate, 4=initialize,
  5=preSave, 6=postSave, 7=prePrint, 8=postPrint, 9=ready, 10=docReady, 0xb=docClose,
  0xc=preSubmit, 0xd=preExecute, 0xe=postExecute, 0xf=preOpen, 0x10=indexChange,
  0x11=predicate, 0x12=preSign, 0x13=postSign, 0x14=postSubmit, 0x15=postOpen,
  0x16=validationState, 0x18=enter … 0x20=mouseDown, 0=other.

**Family `0x2a` — presence** (resolves agent conflict):

| value | string |
|---|---|
| 0x2a0000 | visible |
| 0x2a0001 | **invisible** |
| 0x2a0002 | **hidden** |
| 0x2a0003 | **inactive** |

(Construction order confirmed at `xfa_disasm.c:23724-23742`: visible, invisible, hidden, inactive.
`protected` is *not* a presence value in this family. Matches `supported-features.json.presenceValues`.)

**Family `0x1b` — layout**:

| value | string | engine |
|---|---|---|
| 0x1b0000 | lr-tb | XFAFlowLayout |
| 0x1b0001 | rl-tb | XFAFlowLayout (legacy: coerced to position) |
| 0x1b0002 | tb | XFAFlowLayout (flow default) |
| 0x1b0003 | position | XFAPositionLayout (fallback for fields/draws) |
| 0x1b0004 | table | XFATableLayout |
| 0x1b0005 | row | table child (warn + position outside table) |
| 0x1b0006 | rl-row | table child (warn + position outside table) |

**Effort realism:** full parity ≈ Phases 0–7; Phases 0–2 alone should make the MechanicalSeal oracle match, which is the visible milestone. Each phase is independently shippable and verified.

**Definition of done:** every subsystem in `supported-features.json` accurately reflects reality; all oracles pass < 0.1% pixel diff; FormCalc test corpus green; no behavior change without a `file:line` citation to `reference/decompiled/`.

---

## Appendix A — Research findings summary (per subsystem)

### A1. FormCalc (`jfformcalc_disasm.c`)
- Bison push parser (`yyparse :26966`) → threaded-code VM (`:23176`, ~110 rule cases) → execution loop (`:17486`).
- Value types: error/null/string/number(float64)/function/string-var/field-object/node-list (`jfCalcTypeEnum`).
- Truthiness is numeric (`:17586,18963`) — any non-zero number true, NaN false; strings coerce via `strtod`-style parse (whole string must consume, else 0).
- Non-short-circuit `AND`/`OR`, unguarded IEEE division, locale-collation string compare, empty-string ≡ null.
- Builtins registry `:8462-8561` (~70 core + financials + protocol + display).

### A2. Script lifecycle (`xfascripthandler`, `xfa`, `xfaform`, `xfapresentationagent`)
- 27 event activities (`xfa_disasm.c:24894-25060`), executeReason↔activity bijection (`:82613`).
- All init/calc/validate/ready run **inside** `XFAFormLayout::ready` (`xfalayout:56731`), after `setReady($layout)`.
- `recalculate` (`xfaform:30280`): leaf-first DFS registration, separate calculate/validate queues, reentrancy guard, `overlay` event at end, no iteration cap.
- Engine selection: handler list scan, FormCalc consulted first (`xfa:7678`).

### A3. Layout (`xfalayout_disasm.c`, 151k lines)
- Engines: XFAFlowLayout (tb/lr/rl), XFAPositionLayout (position + fallback for fields/draws), XFATableLayout (table/row/rl-row) — dispatch at `:15871,49833,56313`.
- Repeat instances positioned by engines (`addInstances :6028`), never pre-offset from template.
- Pagination: masterPage page iterator (`:65267,72657`), per-page content-area origin (`:87466`), forced breaks (`:16822,30951`), keep semantics (`:66094`).
- Sizing: `isHeightGrowable`/`isWidthGrowable` (`xfatemplate:8520-8695`).
- Visibility: `isLayoutableObject` excludes invisible/inactive, keeps hidden (`:66677,66810`).

### A4. Rendering (`renderer`, `designrenderer`, `jfgraphic`, `pdfldriver`)
- `DeviceDriver::renderNode` (`renderer:38088`) reads props → layout supplies box/rotation → driver emits ops.
- Per-edge borders (order 0,2,1,3), dash from XDC ratio tables × thickness clamp, caps 0/1/2.
- Rotation: 90/180/270 box swap + remap (`renderer:37609,37881`); clip suppressed when rotated (`designrenderer:7755`).
- Alpha → ExtGState; gradients → shading dicts; gray collapse for `r==g==b`.
- Presence→XDC options determine paint (`renderer:35670`) with `supports*` options in `adobepdf.xdc:32-37`.

### A5. Text/fonts (`jftext`, `font`, `xfafontservice`)
- Units normalize to 1/1000 pt (`jfutility:95292`); glyph advances quantized (`jftext:60643`).
- Default line spacing 1.2× size (`font:10517`); kerning default ON (`font:119241`).
- Wrap with 0.5 tolerance; break-prop prohibition; hyphenation off by default.
- JustH 0–9 / JustV 1–3 (`jftext:72062,73245`); rich-text tag tables (`:96351,90516`).
- Font equates `Family_style_weight` patterns, applied only-if-missing unless `force=1` (`font:26867`); `Designer.xci` carries the Adobe defaults.

### A6. Images & PDF structure (`jfgraphic`, `xfaimageservice`, `pdfldriver`, `pdfdocument`)
- Magic-byte format sniff (`jfgraphic:17878`); importers for PNG/JPEG/GIF/BMP/TIFF/EPS/SVG (`:19577`).
- Aspect modes none/fit/actual/width/height (`xfaimageservice:9324`) + alignment offsets (`:9281`); JPEG passes through as `/DCTDecode`, else Flate (`pdfldriver:46760`).
- Adobe output = AcroForm + `/XFA` hybrid with widgets & appearance streams (`pdfldriver:1627`, `xfaxdptkagent:5779`) — **deliberately not ported** per visual-match decision; ported subset: MediaBox from content area, `/Rotate` mod 360, font subsetting, Flate ≥ threshold.
