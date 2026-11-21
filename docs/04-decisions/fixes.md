# Fixes applied — review notes

**Branch state:** uncommitted working-tree changes on top of `4c1ebe7`.
**Test status:** 727 passing (was 688), 69 suites. `tsc --noEmit` clean.
`eslint` reports the same 2 pre-existing errors as before this work — no new ones.

| File | Change |
|---|---|
| `src/rendering/standard-fonts.ts` | +52 / −8 — ArialMT alias, narrow-face scale |
| `src/rendering/pdf-renderer.ts` | +447 / −189 — scale plumbed through all draw paths, caption clipping, baseline unification, dead code removed |
| `src/rendering/pdf-lowlevel.ts` | +41 — font-resource de-duplication |
| `src/rendering/text/measure.ts` | +30 / −12 — `horizontalScale` option |
| `src/rendering/border-style.ts` | +21 — `quantizeStrokeWidth` |

**Verification method.** The three real fixtures in `test/final-test/` are not
present in this checkout, so none of these fixes could be validated against the
`Expected/*.pdf` oracles. Instead I used the synthetic probe forms in
`reference/tools/make-probes.mjs`, and for every change I diffed the extracted
PDF facts (`reference/tools/extract-pdf-facts.py`) before vs. after. Numbers are
reproduced in each section.

**Please read §6 first — the one change with a judgement call in it.**

---

## 1. `ArialMT` resolved to the wrong font (root cause, §2.1 of the report)

### Cause

`standard-fonts.ts` aliased `arial` → `helvetica` but not `ArialMT`, the
PostScript-style name Designer authors use for plain Arial. It therefore fell
through every resolution tier and landed on the bundled **DejaVu Sans**.

Measured mean advance over printable ASCII (1/1000 em):

| Requested | Backing font before | Mean advance |
|---|---|---|
| `Arial` | Helvetica (base-14, exact AFM) | **526.9** |
| `ArialMT` | DejaVu Sans | **597.1** |
| `Calibri` | DejaVu Sans | 597.1 |
| `Segoe UI` | DejaVu Sans | 597.1 |

DejaVu is **13.3 % wider** than Arial. Every wrap, alignment offset and
justification split for those families was computed against the wrong advances,
so runs wrapped to more lines than Designer authored, and with fixed-height
boxes (§2.2) the extra lines were drawn below the box and landed on whatever sat
next. That is the mechanism behind the "fields overlap" symptom on all three
forms.

### Fix

Added `arialmt: 'helvetica'` to `FAMILY_ALIASES`. `ArialMT` is the same face as
`Arial` — not a similar one — so this is an exact mapping, not a guess.

### After

`ArialMT` → Helvetica, 526.9, identical to `Arial`. Verified by test.

### Scope limit — read this

**I did not change `Calibri` or `Segoe UI`.** Both still fall through to DejaVu
Sans. The report suggested mapping them to Helvetica; I deliberately did not,
because the honest metric error is not obviously smaller:

- DejaVu Sans: 597.1
- Helvetica: 526.9
- True Calibri: **not measurable from this checkout**

Calibri is narrower than Helvetica, so Helvetica may well be *closer* to Calibri
than DejaVu is. But that is a claim about a font whose metrics are not in this
repo, and I will not guess a constant that changes every text measurement in a
document. The correct fix is to supply Calibri/Segoe UI metrics — which is what
report §4.1 recommends as option (a) and which requires either the font files or
a measured width table. **This remains open.**

---

## 2. `Arial Narrow` drawn at full width (root cause, §2.1)

### Cause

`'arial narrow': 'helvetica'` mapped a *condensed* face onto full-width
Helvetica, overstating every advance by ~22 %. Every Arial Narrow run wrapped to
too many lines — the report's "quotation table columns collapse" and "paragraphs
run together" symptoms.

### Fix

Two parts:

1. The scale is declared once, in `standard-fonts.ts`:

```ts
export const NARROW_SCALE = 0.82;   // Arial Narrow / Arial advance ratio
export function isCondensedFamily(family?: string): boolean;
```

2. `measureText()` gained a `horizontalScale` option, and
   `drawScaledText()` applies the matching PDF `Tz` operator.

The scale is applied **to the font's advances only** — `charSpacing` and
`wordSpacing` are absolute point distances in XFA and must not be condensed.
That distinction is unit-tested.

### Why `Tz` and not a different font

pdf-lib has no horizontal-scaling option, and there is no condensed base-14
face. Adobe itself has no `Arial Narrow` entry in `Designer.xdc`'s `<seq>` table,
so Designer must represent a condensed face by scaling too. `Tz` is a percentage
affecting glyph advances only — exactly the required semantics. `drawScaledText`
wraps pdf-lib's own `drawText` rather than hand-emitting text operators, so
string encoding, font registration and rotation stay untouched. `Tz` is reset
to 100 after each run because it is text state, not graphics state, and would
otherwise leak into whatever is drawn next.

### Note on the constant

`0.82` is the published Arial Narrow : Arial advance ratio. It is a *property
of the font*, not a tuning value — but it is not verifiable from anything in this
repo, and I could not measure it from Designer output either. It is flagged here
as the weakest-evidence number in this changeset. If you can measure one Arial
Narrow run against Adobe, that ratio should be confirmed or replaced.

---

## 3. Caption painting over the field value (root cause, §2.3)

### Cause

`reserve` is an **authored** strip width that Designer computed for its own
font. The renderer measured nothing about the caption, so a caption that came out
wider in the resolved font simply drew through the strip into the value area.
That is the `"Pos."` over `"Machine location"` collision.

### Fix

Three changes in `renderField`:

1. **Measure the caption** with the same font that will draw it.
2. **Clamp the strip** to the authored `reserve` (or the caption's own width when
   `reserve` is absent).
3. **Clip to that strip** when the caption exceeds it, so it is impossible for a
   caption to paint into the value area regardless of font.

### Deliberate design decision

The caption **truncates** rather than shrinking the font, wrapping, or widening
the strip. Adobe's own behaviour for an over-wide caption has not been observed.
Truncation is the conservative choice: it cannot overlap anything. If Adobe
instead shrinks or wraps, this is wrong but not harmful — a shorter caption
rather than an overlapping one.

---

## 4. Three inconsistent baseline models (found during this work)

Not in the original report. Found by reading `pdf-renderer.ts` while fixing §3.

### Cause

Three different guesses at where a baseline goes, in one file:

| Path | Old formula | Implied ascent |
|---|---|---|
| `renderDraw`, field **value** | `boxTop − fontAscent(font, size)` | 0.718 em (AFM) |
| field **caption** | `innerHeight − captionSize − (innerHeight − captionSize)/2` | treats em box ≈ ascent |
| `renderButton`, `renderCheckButton` | `(height − fontSize)/2` | treats em box ≈ ascent |

For a 10 pt caption in a 20 pt field, caption and value baselines were **~6 pt
apart** — text on the same line at visibly different heights. Verified
empirically before the fix.

### Fix

All three now call `layoutLines()`, the single ascent-based model. `layoutLines`
is unchanged; the callers were the problem.

### Verification

New test asserts caption and value share one baseline in a top-aligned single
line field, and that vertical centring is symmetric.

---

## 5. Font-resource de-duplication (§2.5) and stroke-width rounding (§2.5)

### 5a. One `/Font` entry per run

pdf-lib's `PDFPage.setFont()` calls `newFontDictionary()`, which mints a **fresh
random key every time** (`PDFDict.uniqueKey` → `addRandomSuffix`) and never
reuses an existing entry. Its source carries a standing TODO saying so. Since
`drawText` calls `setFont()` on every run, the report's 550 runs produced 550
resource entries pointing at 3 font objects.

Fix wraps `page.setFont` per page to reuse the previous key for an unchanged
font object. It only touches the two fields (`font`, `fontKey`) that `drawText`
reads back, so the content stream still selects a valid resource — just the same
one.

Measured on the 84-field probe form:

| | before | after |
|---|---|---|
| `/Font` resource entries | 86 | **18** |
| distinct faces | 15 | 15 |
| text runs drawn | 86 | **86** |
| file size | 25,114 B | **24,071 B** |

Verified that text content, positions, sizes, page count, media boxes, stroke
widths, colours, caps, joins and dash arrays are all **byte-identical** before and
after. Only the resource names changed.

### 5b. Stroke widths rounded to 3 decimals

Authored thicknesses are commonly in millimetres, so the point value arrives as
a long binary fraction. Designer emits these rounded to 3 dp; we emitted full
precision. All four observed widths match under 3-dp rounding:

| ours (before) | Designer | round3 |
|---|---|---|
| 0.50003226 | 0.5 | 0.5 |
| 1.06696226 | 1.067 | 1.067 |
| 1.63389226 | 1.634 | 1.634 |

`quantizeStrokeWidth()` is applied at all three stroke sites (rounded rect,
per-edge, ellipse) so the width, the dash array derived from it, and the fill
stay consistent.

**This is 3-dp rounding inferred from four samples in one fixture.** It is
consistent with everything observed, but I have not confirmed it is a fixed
precision rather than a coincidence of these particular authored values.

### 5c. The `0 w` operator — investigated, *not* a bug

The report flagged "a spurious `0`-width line (hairline)". I traced it: it comes
from `drawRectangle`'s fill-only path, which always emits `setLineWidth(borderWidth)`
even when it then fills without stroking. The path is inside `q`/`Q`, nothing is
stroked, and Designer's output also carries `0` in its width list. **No
behavioural defect.** I added an explicit `borderWidth: 0` with a comment so the
next reader does not re-investigate it. If you disagree, this is the place to
look.

---

## 6. Dead code removed — please scrutinise this one

`computeFieldTextLayout()` was exported, had **zero call sites**, and contained
two constants of exactly the kind this project forbids:

```ts
valueAreaStart = captionText ? x + captionText.length * fontSize * 0.6 : x;
const rawTextWidth = valueText.length * fontSize;   // 1 em per character
```

It also used the same `(height - fontSize)/2` baseline guess as §4. I removed all
81 lines.

**Why this matters for review:** it was dead, so removing it cannot change
rendering output — and the 727 passing tests confirm that. But it was *exported*,
so it was part of the module's public surface and something outside this repo
could theoretically have imported it. Nothing in `src/` or `test/` did. **If you
know of an external consumer of `computeFieldTextLayout`, this removal is a
breaking change and should be reverted.**

---

## 7. Things I did not do, and why

| Item | Status | Reason |
|---|---|---|
| `Calibri` / `Segoe UI` substitution | **open** | Needs real metrics; would be a guess (§1) |
| `ArialMT` alias correctness | done | Exact — same face as Arial |
| `NARROW_SCALE = 0.82` | **unverified** | Not measurable from this checkout (§2) |
| Ascent: Adobe's `max(A, 1−D)` clamp | **not implemented** | See below |
| Glyph-advance quantisation to 1/1000 pt | **not implemented** | See below |
| IPQT 6→5 page-count regression | **open** | Direction is *opposite* to the font story; needs its own bisect |
| `breakBefore` on closing section | **not investigated** | Same reason |
| `DGS` 1→2 page overflow | **not investigated** | Should shrink once fonts are right; needs re-render to confirm |
| Border suppression under `rotate` | **not fixed** | Needs Designer output to know the correct behaviour |
| Graphics-state operator reduction (916 `RG` vs 4) | **not attempted** | Deliberate strategy difference, not a defect; would be a large refactor |

### The two font-metric findings I did *not* act on

Reverse-engineering `font.dll` and `jftext.dll` produced two asm-level findings
that would each change every text measurement in the engine:

1. **Adobe clamps ascent to `max(ascent, 1 − descent)`**, so effective Helvetica
   ascent ≈ 0.79 em rather than the AFM's 0.718. Full evidence and instruction
   listing in `reference/analysis/font-metrics-and-advances.md` §2.
2. **Adobe quantises each glyph advance to 1/1000 pt.** Same file, §4.

**I did not implement either.** Both are level-4 evidence (binary decompilation)
with no observable-output confirmation, and both would shift every baseline in
every document. Implementing them on inference alone would be exactly the kind of
unvalidated change that produced the current drift. They are ready to apply the
moment a Designer PDF confirms them — the measurements needed are specified in
`reference/RENDERING_BEHAVIOR.md` §2a/§2b.

There is also a **known unfixed inconsistency I found and did not change**:
`measure.ts`'s doc comment still describes an advance-quantisation formula that
is neither Adobe's nor implemented in the code. I corrected the formula's *code*
(the `horizontalScale` addition) but left the comment untouched, because
documenting behaviour we do not implement would be a different lie. **This should
be corrected in follow-up once the quantisation question is settled.**

---

## 8. Test coverage added (39 tests, 4 files)

| File | Tests | Covers |
|---|---|---|
| `test/unit/rendering/font-resolution.test.ts` | 9 | ArialMT→Arial, metric clones, unknown→fallback, Adobe faces, equate force semantics |
| `test/unit/rendering/condensed-and-dedup.test.ts` | 12 | `isCondensedFamily`, `horizontalScale` incl. spacing-exclusion, `Tz` emission + reset, resource dedup, all runs still drawn |
| `test/unit/rendering/baseline-and-caption.test.ts` | 8 | ascent-based baseline, advance stepping, centring symmetry, caption clip, shared baseline |
| `test/unit/rendering/stroke-width.test.ts` | 10 | 3-dp quantisation, mm→pt cases, default 0.5 pt |

Tests assert *behaviour* (operators in the content stream, measured widths,
rendered runs), not implementation details — except the `Tz` assertion, which is
necessarily operator-level because that is the fix.

### Coverage gaps a reviewer should note

- No test asserts the **IPQT page count** (fixture absent).
- No test asserts **pagination** behaviour at all beyond what pre-existed.
- The Arial Narrow wrap test asserts `narrowRuns <= fullRuns`, which is the
  correct direction but weak. A stronger assertion needs an oracle.
- No test covers **fixed-height overflow policy** (report §4.2). I did not
  implement an overflow policy; the current silent-overflow behaviour is
  unchanged and still a defect.

---

## 9. Suggested review order

1. **§1** — is the ArialMT fix right, and should Calibri/Segoe UI follow the same
   route on measured evidence?
2. **§2** — is `Tz` the correct mechanism, and can `0.82` be confirmed?
3. **§6** — confirm removing `computeFieldTextLayout` is safe.
4. **§4/§5** — lower risk, covered by tests.
5. **§7** — decide whether to implement the two binary-derived metric findings
   before or after obtaining Designer output.