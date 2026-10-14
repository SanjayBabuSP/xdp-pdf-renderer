# ADS Parity Brief — render PDFs as accurately as Adobe LiveCycle / ADS (SAP)

> **How to use this file:** you are an AI coding agent with this repo checked out.
> Your job: change `src/` so the renderer output converges on the Adobe oracles
> described below. **Privacy rules (never violate):** company XDP/XSD/XML/PDF
> content, field names/values, and project identifiers must never be pasted into
> chat, committed, or written into any repo file. Work with local file
> *paths* (placeholders `<FORM-*>` below — resolve them from the uncommitted
> local data dir, which is git-ignored/untracked and must stay that way) and
> with *structural numbers only* (page counts, mediaboxes, font BaseFont names,
> operator histograms, run/rect counts). `scripts/oracle-kit/redact-facts.py`
> defines exactly what is safe: numbers/geometry + BaseFont names +
> Producer/Creator. It refuses output containing text-bearing keys.
> Never `cat`/`type` a company XDP, XML, XSD, or PDF.
>
> **Self-containment:** this brief depends on NO untracked company files. Its
> only repo inputs are committed ones (`src/`, `scripts/oracle-kit/probes/`,
> `docs/`). Every `<FORM-*>`/`<ADS-ORACLE.pdf>` placeholder is resolved by the
> operator from a local data dir that stays git-ignored (see
> `.gitignore: test/final-test/*`) and is never required for the brief, the
> tests, or the build to make sense. All company-derived evidence in §3–§4 is
> numbers-only and usable without the source files present.

## 0. Goal

`node dist/cli.js render --xdp <FORM-XDP> --xsd <FORM-XSD> --data <FORM-XML>
--lenient -o <out.pdf>` must produce PDFs geometrically equivalent to what
Adobe Document Services (ADS, SAP-provided; `Producer: Adobe XML Form Module
Library`, `Creator: Adobe LiveCycle Designer 11.0`) produces for the same
inputs: same page count, same A4/custom mediabox, text runs within tolerance,
`re`-based borders + fills present, correct font mapping.

## 1. Oracle hierarchy (trust order)

1. **Production ADS PDFs (trust most).** 2-page datasheets + 5-page cover
   letters, all A4. Cover-letter variants exist per language incl. a CJK one.
   Caveat: the cover-letter ADS PDFs were post-processed with `pdf-lib`
   (`Producer: pdf-lib …`), so their content streams are re-emitted — layout
   (5×A4) is authoritative, operator-level detail less so.
2. **Designer "Save As PDF" (geometry oracle).** Genuine
   (`Producer+Creator: Adobe LiveCycle Designer 11.0`), A4, real Arial
   subsets, AcroForm+XFA present (~8 MB inflated XFA template stream).
   It is the *unmerged template* (few static runs), so run counts are NOT
   comparable — page size/count and fonts are.
3. **Print-driver PDFs (distrust for geometry).** Designer preview has no Save,
   so these came from Print paths: PDF24/Ghostscript and Microsoft Print To
   PDF. Both reflow to US Letter, re-subset fonts to anonymous CIDFonts, and
   vectorize borders into line segments (`m/l/h`, zero `re`). Useful only to
   confirm merged-data run totals, never for layout/borders/page-size.
4. **Renderer's own old outputs (no signal).** Any PDF with
   `Producer: xdp-pdf-renderer …` is self-comparison — ignore as oracle.

## 2. Environment / tooling (verified working)

- `node ≥ 20`, `npm install && npm run build` → `dist/workflows/render-pdf.js`.
- `python3 + pypdf` for `scripts/oracle-kit/{extract-facts,redact-facts}.py`
  and `scripts/oracle-kit/compare-local.mjs`
  (`--xdp --xsd --data --expected <oracle.pdf> [--lenient]` prints
  numbers-only JSON: pages, mediabox, toolchain, basefonts, runs/rects per
  page, top operators).
- Synthetic probes (committed, company-data-free):
  `scripts/oracle-kit/probes/{p1-metrics,p2-borders,p3-subforms}.{xdp,xsd,xml}`.
  Ours-side baselines (no Designer oracle yet — still needed from a Windows
  Designer machine via F5 preview): p1 = 1pp/86 runs, p2 = 1pp/20 runs,
  p3 = 2pp/24 runs.

## 3. Measured gaps: ours (left) vs best ADS oracle (right)

Labels are anonymized. Re-identify the three local form triples by the XDP
value-histogram fingerprints in §4 (run the inventory one-liner from
`scripts/oracle-kit/RUNBOOK.md` §3.5 — it prints counts only).

| # | Form | Pages | Mediabox | Text runs (per page) | Rects (per page) | Oracle fonts → ours |
|---|------|-------|----------|----------------------|------------------|---------------------|
| A | datasheet, `stock:a4` | 2 vs 2 ✅ (data differs, see note) | A4 vs A4 ✅ | 207 `[166,41]` vs 315 `[252,63]` ⚠️ data differs | **18 `[17,1]` vs 400 `[324,76]` ❌** | Helvetica/MyriadPro → Helvetica + DejaVuSans subsets ❌ |
| B | cover letter EN, `stock:a4` | 5 vs 5 ✅ | A4 vs A4 ✅ | **1037 `[105,78,424,419,11]` vs 197 `[32,41,66,51,7]` ❌ (5.3×)** | 54 `[23,9,1,13,8]` vs 75 `[36,21,0,0,18]` ⚠️ | ArialNarrow(+Bold) subsets → Helvetica + 1 DejaVuSans ❌ |
| C | datasheet, `stock:custom` | 2 vs 2 ✅ | A4-ish vs A4-ish ✅ | 598 `[354,244]` vs 508 `[303,205]` ⚠️ (+18%) | **64 `[9,55]` vs 402 `[152,250]` ❌** | MyriadPro/Helvetica → Helvetica + 8 DejaVuSans ❌ |

Operator signatures (all forms, same pattern):

- Ours: one `BT…ET` object **per run** (`BT=Tf=TL=Tm=Tj` counts identical,
  e.g. 1037× each on form B), **`TJ` never emitted**, borders as `m/l/S`
  paths with per-edge `q/Q + RG/w/d` state, **`f`/`f*` fills never emitted**,
  extreme `q/Q` counts (opacity scope per fragment, e.g. 1397×).
- ADS: shared text objects (`BT`≪runs, e.g. 50 vs 197), `Td` positioning,
  `TJ` kerning arrays, borders as **`re` + `S`**, backgrounds as
  **`re` + `f`/`rg`**, `i` (flatness) present.

## 4. XDP fingerprints (counts only — safe to reproduce locally)

- **Form A:** typeface `{Arial:628, Calibri:1, Segoe UI:1}`;
  layout `{tb:19, lr-tb:41, table:1, row:38}`; presence
  `{hidden:867, visible:137, invisible:1}`; stroke `{dotted:24}`;
  weight `{bold:63}`; posture `{italic:83}`; stock `{a4:1}`.
- **Form B:** typeface `{Arial:58, Arial Narrow:141, Calibri:2, Segoe UI:1,
  SimSun-ExtB:1}`; layout `{tb:20, table:7, row:32, lr-tb:9}`; presence
  `{hidden:414, visible:14, invisible:4, inactive:2}`; stroke `{lowered:26}`;
  weight `{bold:26}`; posture `{normal:4}`; stock `{a4:1}`.
- **Form C:** typeface `{Arial:585, Calibri:3, ArialMT:33}`;
  layout `{tb:4, lr-tb:15, table:11, row:45}`; presence
  `{hidden:537, visible:112, invisible:2}`; stroke `{lowered:30}`;
  weight `{bold:115}`; posture `{italic:17}`; stock `{custom:2}`.

## 5. Ranked root causes → fix (code pointers verified in this checkout)

1. **Hidden/inactive content is emitted as visible text (suspect #1 for the
   5.3× run inflation on form B).** Presence-hidden counts dwarf visible
   (867/414/537 vs 137/14/112). Check
   `src/domain/mapping/relevance.ts`, `evaluate-conditions.ts`,
   `expand-repeats.ts` and where `presence`/`relevant` gates emission in
   `src/workflows/render-pdf.ts` + `src/rendering/pdf-renderer.ts`.
   Fix: enforce Designer presence semantics (hidden/inactive → no text run,
   no space) before layout. Verify: form-B run total drops toward ~200 with
   pages staying at 5; add a synthetic probe (hidden block inside a table)
   under `test/`.
2. **Borders/backgrounds drawn as stroked paths, never as `re` rects/fills
   (rect deficit 6–22×, zero `f`).** Ours top-ops are `m/l/S + RG/w/d`;
   ADS uses `re/S` + `re/f/rg`. Touch `src/rendering/border-style.ts`
   (`quantizeStrokeWidth`, `dashArrayForStyle`, `xfaCapToPdf`,
   `xfaJoinToPdf`), `src/rendering/fill-paint.ts` (`drawGradientFill`,
   gray helpers), and the `pdfPage.drawRectangle` call sites in
   `src/rendering/pdf-renderer.ts` (+ `barcode-renderer.ts`). Fix: emit
   axis-aligned box borders/fills as `re` (+`f` where filled); keep `m/l`
   only for non-rectangular paths. Verify with `p2-borders` probe: rect
   count and `re/S/f` ops converge on the Designer oracle.
3. **One `Tj` per fragment, no `TJ` merging, one text object per run
   (operator bloat + positioning drift).** See `src/rendering/text/run-flow.ts`,
   `line-breaker.ts`, `justifier.ts`, `measure.ts`, and emission in
   `pdf-renderer.ts`/`pdf-lowlevel.ts` (`dedupePageFontResources`,
   opacity scopes `beginOpacityScope` — probable `q/Q` flood source).
   Fix: merge co-linear same-font runs into `TJ` arrays with kerning, share
   `BT…ET` blocks with `Td` advances, scope `q/Q` to actual transparency.
   Verify: `BT`≪runs, `TJ` appears in top-ops, cover-letter content bytes shrink.
4. **Font substitution instead of Adobe faces (all CJK/sequence risk lives
   here).** XDP asks Arial / Arial Narrow / ArialMT / SimSun-class;
   ours serves Helvetica + DejaVuSans subsets (`src/rendering/font-manager.ts`
   fallback, `src/rendering/font-substitution.ts` `FontSubstitution`,
   `src/rendering/standard-fonts.ts`, `src/config/default-fonts.json`).
   Fix: document + extend `npm run fonts:import` mapping for the four
   families above (CJK via the SimSun-class face), keep DejaVu only as
   last resort. Verify: basefonts list shows ArialNarrow/Myriad-class
   subsets instead of DejaVuSans; CJK variant renders without tofu.
5. **Vertical metrics overflow (same-data page-fit).** Designer fits the
   template on 1×A4; ours needs 2 for less content on form A. Suspect
   line-height/ascent (`src/rendering/text/line-metrics.ts`, `measure.ts`,
   `src/lib/unit-converter.ts`) compounded by #1. Fix after #1 using the
   `p1-metrics` probe + Designer oracle (pending collection).
6. **Strict validation rejects real SAP data (`VAL_2001` on all three
   triples: missing-required fields, integer-range overflows incl.
   short/byte widths, non-numeric strings for numbers) — `--lenient`
   required today.** See
   `src/domain/validation/validate-data-against-schema.ts`. Fix: tolerant
   coercion (clamp/warn instead of fail for range; warn-and-skip for
   missing-optional), keep strict mode for CI. Do NOT change validation
   error codes.

## 6. Reproduce (placeholders only — never commit resolved paths)

```bash
npm install && npm run build
# per form triple (resolve locally; keep under /tmp, never in repo):
node dist/cli.js render --xdp <FORM-XDP> --xsd <FORM-XSD> --data <FORM-XML> \
  --lenient -o /tmp/<label>-ours.pdf
python3 scripts/oracle-kit/extract-facts.py /tmp/<label>-ours.pdf \
  -o /tmp/<label>-ours.facts.json
python3 scripts/oracle-kit/redact-facts.py /tmp/<label>-ours.facts.json \
  -o /tmp/<label>-ours.redacted.json
node scripts/oracle-kit/compare-local.mjs --xdp <FORM-XDP> --xsd <FORM-XSD> \
  --data <FORM-XML> --expected <ADS-ORACLE.pdf> --lenient
```

## 7. Acceptance thresholds (numbers-only, per form)

- Pages equal; mediabox equal within 0.01 pt.
- Text runs within ±10% of oracle with identical page distribution shape
  (same argmax page, no new overflow page).
- Rect counts within ±15%; `re` and (`f` where oracle fills) present in
  top-ops; `TJ` present wherever oracle uses it.
- Basefonts: no DejaVuSans where oracle has Arial/ArialNarrow/Myriad-class;
  CJK variant shows CJK subsets.
- `npm run build` clean; full test suite green; new regression tests for
  #1–#4 using committed synthetic fixtures only.

## 8. Pitfalls

- Do not "fix" toward print-driver PDFs (Letter/anonymous-CIDFonts/line
  borders) — they are pipeline artifacts (§1.3).
- Do not compare against renderer-produced PDFs (§1.4).
- Cover-letter ADS oracles are `pdf-lib`-re-emitted: trust layout, not ops.
- Form-A ADS datasheet oracles use *different datasets* than the local
  triple (run totals 315/75/508 vs local 207) — use them for
  pages/mediabox/rect-structure, not exact run equality. Forms B and C
  oracles are the closest-data matches.
- Related prior work: `docs/MECHANICALSEAL-ADOBE-PARITY-PLAN.md`,
  `docs/EXPECTED-VS-CURRENT-COMPARISON.md`, `docs/FIXES.md` (may reference
  old non-ADS oracles — re-verify every claim against ADS).
