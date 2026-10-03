# Designer measurement request — what I need, and exactly how to get it

**To:** the AI agent working in the workspace that holds `final-test`
**From:** the `xdp-pdf-renderer` reverse-engineering effort
**Date:** 2026-10-03

---

## 0. Read this first — the one thing that matters most

This project renders XDP forms to PDF and is trying to match **Adobe LiveCycle
Designer 11.0 → "Preview as PDF"** byte-for-byte in terms of geometry. Every
behaviour we know so far was recovered by **reverse-engineering Designer 11.0's
DLLs** (`reference/decompiled/*_disasm.c`), because we have never seen a real
Designer output. Binary evidence is good but it is *inference*: it tells us what
the code appears to do, not what it actually does on your form.

**Your workspace contains the ground truth.** Extracting a handful of numbers
from the two PDFs you already have will settle questions we currently cannot
settle at all.

### Three rules

1. **Report numbers, not conclusions.** "Helvetica 10pt, dist_below_box_top =
   7.90pt" is useful. "Adobe seems to use a taller ascent" is not — I can infer
   that myself. Raw values only.
2. **Do not round.** Give 4+ decimal places. Differences of 0.01pt are the
   entire subject of this exercise.
3. **If a step fails, say so and continue.** Partial data is valuable. A blocked
   step that is silently skipped is worse than an honest "could not do this,
   here is the error".

### Do not send me the PDFs

I do not need or want the confidential PDFs themselves. I need the extracted
JSON/numbers described below.

---

## 1. Tooling I have already written and tested for you

Copy this directory into the workspace. Everything is standalone; the renderer
does **not** need to be installed.

```
reference/tools/
├── extract-pdf-facts.py   # PDF  -> JSON facts (needs: pip install pypdf)
├── derive-metrics.py      # (geometry + PDF facts) -> measured numbers
├── make-probes.mjs        # generates the minimal probe forms (§4)
└── dump-layout.mjs        # optional: renderer layout dump, same schema
```

`extract-pdf-facts.py` and `derive-metrics.py` are the two you need. Both are
tested — I ran them against PDFs my own renderer produced and they recover
known-correct values (see §6, "sanity anchors").

### 1.1 Extract facts from a PDF

```bash
pip install pypdf
python3 extract-pdf-facts.py expected.pdf   -o expected-facts.json
python3 extract-pdf-facts.py current.pdf    -o current-facts.json
```

Output is a single JSON. The parts that matter:

| JSON path | What it is |
|---|---|
| `num_pages` | page count |
| `info` | `/Producer`, `/Creator`, dates — reveals which tool made the file |
| `fonts[]` | every font resource: `basefont`, `subtype`, `font_descriptor` (`ascent`, `descent`, `capheight`, `fontbbox`, `stemv`, `flags`), `fontfile`, `widths_sample`, `has_to_unicode` |
| `tounicode` | glyph-code → Unicode maps |
| `pages[].text_runs[]` | **the important one** — see below |
| `pages[].line_widths` | every `w` stroke width, de-duplicated |
| `pages[].dash_patterns` | every `d [array] phase` |
| `pages[].line_caps` / `line_joins` | `J` / `j` values |
| `pages[].stroke_colors` / `fill_colors` | `RG` / `rg` / `g` / `G` triples |
| `pages[].rectangles` | `re` rectangles in device coordinates |
| `pages[].path_moves` | `m` / `l` / `c` path points with the painting operator |
| `pages[].counted` | histogram of every operator used — a cheap fingerprint |

Each `text_runs[]` entry:

```json
{
  "page": 1, "page_index": 0,
  "font_resource": "/F1", "basefont": "/Helvetica", "font_subtype": "/Type1",
  "size": 10.0, "effective_size": 10.0,
  "baseline_x": 139.0396, "baseline_y": 780.711,
  "rotation_deg": 0.0,
  "text": "Test Document", "n_glyphs": 13, "char_codes": [84,101,...],
  "kerns": [], "charsp": 0.0, "wordsp": 0.0
}
```

`baseline_x` / `baseline_y` are the **text origin in PDF user space**, already
transformed through the text matrix and the CTM, so they are directly comparable
across producers. `kerns` holds `TJ` array adjustments (negative of the PDF
value), which is how we detect whether Adobe emits kerning.

---

## 2. PRIORITY 1 — the single cheapest measurement

**Please do this one even if nothing else is possible.**

### 2.1 Dump every font descriptor from `expected.pdf`

```bash
python3 - <<'PY'
import json
d = json.load(open('expected-facts.json'))
seen = set()
for f in d['fonts']:
    # dedupe: the same face is often registered once per text run
    key = (f['basefont'], f['subtype'], json.dumps(f['font_descriptor']))
    if key in seen:
        continue
    seen.add(key)
    print(json.dumps({k: f[k] for k in
        ('page','resource_name','basefont','subtype','has_to_unicode',
         'font_descriptor','fontfile')}))
print('\ntotal font resources:', len(d['fonts']), '| distinct faces:', len(seen))
PY
```

Run the same on `current-facts.json` and send both. The diff between them is
itself informative — if Adobe embeds and subsets where we emit a bare base-14
reference, that is a difference worth knowing about.

### Why this is the highest-value item

I have proven from the binaries that Adobe's internal font object **clamps the
ascent**: `ascent = max(ascentFromFont, 1.0 - descent)`, guaranteeing
`ascent + descent >= 1.0` em. For Helvetica that predicts an ascent of roughly
**0.79 em**.

But that prediction comes from a CoolType call whose return value crosses a DLL
boundary, so I cannot compute the number — only bound it. Meanwhile the renderer
currently uses the PostScript AFM `Ascender`, which is **0.718** for Helvetica.

If Adobe emits a `/FontDescriptor`, it writes `/Ascent` from those same internal
metrics, and **the answer is sitting in the file you already have.** No
interpretation required on your part — just the numbers.

If instead Adobe uses the non-embedded base-14 fonts (no descriptor), say so
explicitly; that itself is a finding, and §4.1 then measures it geometrically
instead.

### 2.2 Also report

- `expected-facts.json` → `num_pages`, `info`, and each page's `media_box`,
  `rotate`
- the full `counted` operator histogram for page 1
- whether any font has `fontfile` (i.e. is Adobe embedding/subsetting?)

---

## 3. PRIORITY 2 — measure the existing `final-test` form

You have the XDP/XSD/XML and both PDFs for a real production form. That is worth
more than any synthetic probe because it exercises real-world structure
(repeating subforms, nested tables, captions, page breaks).

### 3.1 What I need from it

```bash
python3 extract-pdf-facts.py expected.pdf -o expected-facts.json
python3 extract-pdf-facts.py current.pdf  -o current-facts.json
```

Then produce a **field-by-field comparison**. If this repo is available in your
workspace, the geometry side comes from the renderer:

```bash
npm run build
node dump-layout.mjs <form.xdp> <schema.xsd> <data.xml> -o layout.json
python3 derive-metrics.py layout.json expected-facts.json -o derived-expected.txt
python3 derive-metrics.py layout.json current-facts.json  -o derived-current.txt
```

`derive-metrics.py` prints `ascent_em`, `line_advance`, and per-glyph advance
slopes, all box-relative.

### 3.2 If the repo is NOT available

Do not block. Send me:

- `expected-facts.json` and `current-facts.json`
- the XDP file itself (this is **not** confidential — it is the input form)
- for any 10 text runs you can identify: the run's `text`, `font_resource`,
  `size`, `baseline_x`, `baseline_y`, **and** the `x`/`y`/`w`/`h` of the field
  it came from (readable straight from the XDP)

With box + baseline I can compute the ascent myself.

### 3.3 Specifically hunt for these in `expected-facts.json`

These are the discrepancies I most want quantified. Report whatever you find,
including "not present":

| # | What to look for | Why |
|---|---|---|
| a | Any text run with `rotation_deg` of ±90 or ±270 | The renderer had a known bug here (vertical labels vanished) |
| b | Runs whose `baseline_y` differs between the two PDFs for the same `text` | Quantifies vertical drift |
| c | Any `line_widths` value **not** in our set (0.25/0.5/0.75/1/1.5/2/3) | Our default edge thickness is an unverified guess |
| d | Any `dash_patterns` array | We derive these from a config table; confirm ratios and the thickness scaling |
| e | `fill_colors` containing a grey triple | We collapse r==g==b to DeviceGray; confirm Adobe does too |
| f | `font_descriptor.ascent` / `.descent` for every distinct face | §2.1 |
| g | Whether the same typeface appears under several `/BaseFont` names | Font substitution behaviour |
| h | Page count in each file, and which pages are blank | Pagination correctness |

---

## 4. PRIORITY 3 — run the minimal probes

I have written three single-variable probes so that one measurement pins one
behaviour. Generate them with:

```bash
node make-probes.mjs -o probes/
```

This writes, per probe: `*.xdp`, `*.xsd`, `*.xml`, and `*-geometry.json`
(the authored box of every field, so no renderer is needed to interpret results).

| Probe | Contents | Settles |
|---|---|---|
| `p1-metrics` (84 fields, **A3 portrait**) | ascent vs font size; per-family ascent; vertical/horizontal alignment; multi-line line-advance; per-glyph advance ladders; `<para lineHeight>`; unicode; font substitution; kerning | **the font-metric questions** |
| `p2-borders` (20 fields, A4) | 13 edge variants incl. dash styles, caps, joins, per-edge differences, corner radius, fill colour vs grey | border geometry |
| `p3-subforms` (A4, 2 pages) | `tb` flow with margins, `position` with nesting, `lr-tb` wrapping, overflow | subform flow + pagination |

### 4.1 Procedure per probe

1. Open the `.xdp` in **LiveCycle Designer 11.0**.
2. **File → Preview PDF** (or equivalent). Do **not** use "Export to PDF",
   do **not** tick any dynamic/flattening option — I need the plain
   *Preview as PDF* output, which is the behavioural reference.
3. Save as `probes/p1-metrics-expected.pdf` (etc.).
4. Run:

```bash
python3 extract-pdf-facts.py probes/p1-metrics-expected.pdf -o p1-expected-facts.json
python3 derive-metrics.py probes/p1-metrics-geometry.json p1-expected-facts.json
```

5. Paste the **entire printed table** back to me. It has three sections —
   ascent, line advance, per-glyph advance. All three matter.

### 4.2 How to read what comes back (so you can sanity-check it)

- **ascent_em** for `asc_helv_10` should be a single number, independent of size.
  Ours says `0.718`. If Adobe says ~`0.79`, that is the bug I expect.
- **line advance** for `lines_10` / `lines_14` should both be the same ratio.
  Ours says `1.2`. I believe Adobe agrees; please confirm.
- **per-glyph advance** for `adv_i_*` should be constant across all N. Ours is
  `0.222` (exactly the AFM width for `i`). If Adobe shows small steps or
  wobble, advances are quantized and I need to know the quantum.
- `subst_*` rows reveal what Adobe substitutes for fonts it does not have.
  Ours resolves `Myriad Pro` and `Minion Pro` to real embedded files, and
  `NoSuchFontXYZ` to DejaVu Sans.
- `uni_*` rows reveal which face Adobe picks for Greek / Cyrillic / CJK.

If any probe **fails to open in Designer**, say so and send the file back —
a malformed probe is my bug, and knowing that is useful.

---

## 5. PRIORITY 4 — environment metadata

Only needed once, and only if it is cheap. It affects how I interpret
everything else.

```bash
python3 -c "
import json
d=json.load(open('expected-facts.json'))
print('header  ', d['pdf_header'])
print('pages   ', d['num_pages'])
print('info    ', json.dumps(d['info'], indent=1))
print('xmp     ', d.get('xmp_present'))
"
```

Plus, in prose:

- Exact Designer version and build (Help → About).
- Whether Acrobat or Reader is installed, and which version. Designer delegates
  PDF display to Acrobat's plug-in host, so this can change output.
- Windows version and locale.
- For `final-test`: was `current.pdf` produced with default options? If any
  non-default `RenderOptions` were passed, list them.
- How `expected.pdf` was produced: **Preview as PDF**, or a batch/export path?
  These are not identical in Designer.

---

## 6. What to send back

A single markdown file, in this order:

1. **§2.1 font descriptor dump** — verbatim JSON lines.
2. **§2.2** document facts.
3. **§3.3 findings table** — one row per item a–h, with the numbers you found
   or `not found`.
4. **§4.1 the three printed `derive-metrics.py` tables** — verbatim, complete.
   Do not trim or summarise them.
5. **§5 environment answers.**
6. **Anything that failed**, with the exact error text.

### Sanity anchors

So you can tell whether the tooling worked before trusting it. These are values
my own renderer produces, and `derive-metrics.py` recovers them exactly:

| Measurement | Expected value |
|---|---|
| `asc_helv_*` ascent_em (all sizes) | `0.718` |
| `lines_10`, `lines_14` advance_em | `1.2` |
| `adv_i_*` per_char_em | `0.222` |
| `adv_n_*` per_char_em | `0.556` |
| `adv_W_*` per_char_em | `0.944` |

If a table comes back with these exact numbers for the **current** PDF, the
pipeline is sound and the **expected** PDF's numbers can be trusted. If the
current PDF's numbers do *not* match, stop and tell me — the tooling has a bug
and I need to fix it before your Designer numbers mean anything.

---

## 7. Why each measurement matters (context, skimmable)

Reverse-engineering Designer produced four findings that are individually
plausible but jointly untested. Each is cheap to confirm or refute:

1. **Glyph advances are quantized to 1/1000 pt** — a flat quantum independent
   of font size, with a `±1.75` unit rounding nudge. Formula recovered from
   `jftext.dll` at the instruction level. The `adv_*` ladders detect this: a
   quantized advance shows a staircase, a continuous one does not.
2. **Ascent is clamped so `ascent + descent >= 1.0` em.** For Helvetica this
   predicts ~0.79 em versus the AFM's 0.718 — a **0.7pt error per baseline**,
   which is ~14pt of drift over a 20-line block. This is the single largest
   suspected cause of "text sits slightly wrong and lines creep".
3. **The XDC `<metrics>` table is output, not input.** I proved data flows
   `jfFontItem → XDCFont`, not the reverse, so `adobepdf.xdc`'s
   `ascent="728"` is irrelevant to layout. Please do not spend effort
   reconciling against that file — but *do* confirm via the font descriptors
   that Adobe's real ascent is not 0.728.
4. **Line advance is `1.2 × fontSize`.** A previously-open conflict with the
   XDC's `lineHeight="1149"` turned out to be the same quantity expressed two
   ways. `lines_*` confirms 1.2 empirically.

If (1) and (2) hold, they explain a large share of the reported font, baseline
and line-height discrepancies in one coherent model. If either is wrong, I need
to know before I change any code — which is precisely why I am not changing any
code yet.