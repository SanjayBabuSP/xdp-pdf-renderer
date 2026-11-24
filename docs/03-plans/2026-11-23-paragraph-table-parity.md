# Implementation plan — paragraph spacing and table render parity

- Date: 2026-11-23
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-23-paragraph-table-parity.md`

## Goal

Match Adobe line spacing for repeated fields and rich-text gaps, and render wrapped table row-label lines
instead of clipping them, without changing unrelated layout.

## Scope

- In scope: `line-breaker.ts` (U+2028/U+2029), `draw.ts` (remove single-line no-wrap bypass),
  `run-flow.ts` (pre-advance baselines), field default lineHeight from parent-context size
  (parse stamp + `position-engine.ts` + `field.ts`), unit tests, sample PDF regeneration.
- Out of scope: table row growth rules, `oneLineBox` clamp, rich XFA `<para>` lineHeight handling,
  first-line offset convention, the ~1pt table-label pitch residual (13.2 vs 14.4).

## Steps

- [x] Step 1 — `src/rendering/text/line-breaker.ts`: split paragraphs on U+2028 (line break,
  `paragraphEnd: false`) and U+2029 (paragraph break, `paragraphEnd: true`).
- [x] Step 2 — `src/rendering/pdf-renderer/draw.ts`: always wrap plain-text draws to `textW`; remove the
  `singleLine ? Infinity` bypass. Keep overflow clipping.
- [x] Step 3 — `src/rendering/text/run-flow.ts` `layoutRunBaselines`: `baselines[i] = baselines[i-1] -
  lines[i].advance` (current line). `runBlockHeight` unchanged (sum).
- [x] Step 4 — parse-time parent font-size stack: stamp `inheritedFontSize` on draw/field nodes during
  `parseXdp` (post-parse tree walk, no signature changes); fields use
  `para.lineHeight ?? 1.2 * min(own, inherited)` in `nodeValueHeight` and `field.ts` render.
- [x] Step 5 — unit tests: line-breaker U+2028/U+2029; draw wrapping of overflow text in short boxes; rich
  pre-advance baselines; field single-line height with inherited size; parse stamp.
- [x] Step 6 — regenerate sample PDFs, compare oracle diffs (Ex1/Ex2/Ex3), full verification chain.

## Tests

- Regression test that fails without the fix: new `test/unit/rendering/text/line-breaker-parity.test.ts`
  (U+2028/U+2029), extended `run-flow` baseline test, field-height test with inherited size.
- Updated tests: any tests asserting old post-advance baselines or old field heights.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
npm run check:size
npm run format:check
```

## Rollback

Conditions that mean the change must be reverted: oracle pixel diffs regress on Example-1/Example-3, or
`singleLine` removal causes multi-line overflow in fixed-height draws that Adobe clips (check footer bands).

## Outcome

Shipped: U+2028/U+2029 breaks, draw always-wrap, rich pre-advance baselines, field
`1.2 × min(own, inherited)` default advance with parse-time stamp. The min-cap (added after
oracle comparison showed 6.5pt Example-1 fields regressing under a pure-inherited rule) keeps
small fields on their own grid while repeated 12pt fields use the 10pt context grid.
Sample PDFs regenerated; `lint`/`build`/`test:unit` (123 suites, 1600 pass)/`test:integration`
(17 suites, 93 pass)/coverage (94.5/85.1/95.7/96.6)/size (375130 < 390000)/`format:check` all
green. Oracle pixel diffs move toward Adobe on Example-1 p0, Example-2 EN p0/p4/p5 and
Example-3 p0; EN/ESP p1–p3 whole-page deltas are downstream shifts from the corrected pitches
(line structures verified exact at Tm precision: 17.67 pitch, 22.6/15.8 rich gaps, two-line
row labels). Residual: table label pitch 13.2 vs Adobe 14.4 (unexplained source; row geometry
minH-clamped either way), recorded in AI_WIKI §12. Wiki ledger entry added.
