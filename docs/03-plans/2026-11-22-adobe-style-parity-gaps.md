# Implementation plan — Adobe style parity gaps

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-adobe-style-parity-gaps.md`

## Goal

Close the two high-confidence, generic formatting gaps found by comparing the
Adobe and current sample-form PDFs: forced `.00` on optional numeric fractions
and collapsed internal spaces in plain `<text>` draws. Review `quorbe/xfa.js`
and record why its other ideas are not ported.

## Scope

- In scope: optional fractional picture placeholders, plain-text whitespace
  preservation, regression tests, wiki/decision documentation.
- Out of scope: pagination reflow, border/table geometry rewrites, font
  substitution assets, CJK/glyph omission rules, checkbox aliases and
  empty-draw hairlines. These need dedicated evidence or spikes.

## Steps

- [x] 1. `src/lib/value-format.ts`: in `renderNumberTemplate`, treat a fractional
  template made only of optional placeholders (`z`, `#`) as absent when the
  rounded fractional digits are all `0`. Do not change mandatory `0`/`9`
  placeholders or integer-side rendering.
- [x] 2. `src/rendering/pdf-renderer/draw.ts`: for `node.value.type === 'text'`,
  use a new `stripHtmlTags()` helper instead of `stripHtml()`. The helper removes
  tags without collapsing internal whitespace. Keep `stripHtml()` for the
  rich-text fallback in `pdf-renderer/text.ts`.
- [x] 3. Add unit tests in `test/unit/lib/value-format.test.ts` for optional
  fractions (`num{zzzzzzz9.zz}`, `z,zz9.zz`) rendering integers without a
  decimal separator and decimals with the expected digits.
- [x] 4. Add a regression test in `test/unit/rendering/draw-text-whitespace.test.ts`
  proving a plain draw value with two internal spaces reaches `drawScaledText`
  with both spaces intact.
- [x] 5. Update `docs/01-canonical/AI_WIKI.md` §10 and §11 with the two fixes
  and the xfa.js review outcome.
- [x] 6. Re-render sample forms and verify Example-1 no longer contains the two
  `200.00` values and Example-3 retains the two double-space phrases.

## Tests

- `test/unit/lib/value-format.test.ts`
- `test/unit/rendering/draw-text-whitespace.test.ts`
- Existing `test/unit/lib/value-format-properties.test.ts` must keep passing.
- Full unit and integration suites, sample-form text comparison and package
  checks.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
node scripts/render-sample-forms.mjs
npm run check:size
```

## Rollback

- Revert step 1 if any numeric fixture loses a required decimal separator or
  the existing `$z,zz9.99` tests fail.
- Revert step 2 if preserving whitespace causes wrapping regressions in the
  sample forms or unit suites.
- Leave the broader gaps untouched unless dedicated oracle evidence is added.

## Outcome

Both scoped fixes shipped. Optional `z`/`#` fractional placeholders no longer
force a decimal separator when the rounded fraction is all zero; mandatory
`0`/`9` placeholders are unchanged. Plain `<text>` draw values are no longer
passed through `stripHtmlTags()`, which removes markup without collapsing
internal spaces, so double spaces survive into the PDF.

Verification: 116 unit suites, 17 integration suites, full lint/build/format/
coverage/size checks, and sample-form text comparison passed. Example-1 now has
zero `200.00` strings and three `200` strings; Example-3 now matches Adobe on
both double-space phrases. The manual xfa.js review found no reusable rule for
the remaining alignment/font/pagination gaps, so no external code was copied.

Residual gaps: Example-2 EN/ESP page breaks, border/table stroke geometry, Arial
font substitution, omitted Greek glyphs, URL line wrapping and spacer-height
inflation remain. They need dedicated layout/font oracle work.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — optional
numeric fractions and plain-text whitespace parity.
