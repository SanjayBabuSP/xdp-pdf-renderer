# Implementation plan — locale-aware XFA formatting

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-locale-aware-formatting.md`

## Goal

Make XFA/`RenderOptions` locale drive month/weekday names, meridiem text and
number separators in every picture formatter, with no behavior change when no
locale is supplied.

## Scope

- In scope: shared locale helpers; locale propagation; `formatValue`, FormCalc
  and JavaScript picture engines; regression tests; docs.
- Out of scope: message catalogs/translation; XFA `localeSet` parsing; RTL;
  `host.language`/`app.language`; `wordNum`; ISO/epoch helpers.

## Steps

- [x] Step 1 — Add `src/lib/locale-format.ts` with `normalizeLocale()`,
      `getMonthNames()`, `getWeekdayNames()`, `getMeridiem()` and
      `getNumberSeparators()`; cache `Intl` formatters; invalid locale returns
      undefined.
- [x] Step 2 — Update `src/lib/value-format.ts` to use the helpers for
      month/weekday, time meridiem, number output separators and numeric input
      coercion. Keep `en-US` as the default path.
- [x] Step 3 — Add `locale?: string` to `RenderOptions` and `FieldNode` in
      `src/types.ts`; parse field locale in
      `src/domain/parsing/parse-xdp.ts`.
- [x] Step 4 — In `src/workflows/render-pdf.ts`, resolve
      `options.locale ?? layout.locale`, normalize once, pass it to script
      config, embed resolution, layout and a copied `RenderOptions` for render.
- [x] Step 5 — Add `locale` to `LayoutContext`; seed it in
      `calculate-positions.ts`; preserve it in all fresh contexts in
      `flow-engine.ts`, `position-engine.ts` and `table-engine.ts`; use
      `node.locale ?? ctx.locale` in field measurement.
- [x] Step 6 — Thread locale through `applyPagination()` → `clipSubtree()` →
      `leafLineBaselines()` → `leafTextValue()` in
      `src/domain/layout/apply-pagination.ts`.
- [x] Step 7 — Pass locale to `formatValue` from `pdf-renderer.ts` and
      `resolve-embeds.ts`.
- [x] Step 8 — Add `locale` to `ScriptEngineConfig` and `ScriptableNode`;
      propagate it through `event-dispatcher.ts` and `xfa-object-model.ts`.
- [x] Step 9 — Add `locale` to `FormCalcEnv`/`FormCalcEvaluatorOptions`; localize
      FormCalc month/day names, meridiem and number separators for both
      formatting and parsing; keep picture tokens and golden outputs unchanged.
- [x] Step 10 — Use the shared helpers in
      `src/domain/scripting/js-engine/javascript-engine.ts` for `AMPM`, `am` and
      numeric separators; keep `language: 'ENU'` unchanged.
- [x] Step 11 — Add tests: `test/unit/lib/locale-format.test.ts`, locale cases in
      `value-format.test.ts`, `evaluator-formats.test.ts`,
      `javascript-engine.test.ts`, and a workflow option-propagation test.
- [x] Step 12 — Update `docs/01-canonical/AI_WIKI.md`, `README.md`,
      `docs/README.md` and mark this plan done.

## Tests

- `test/unit/lib/locale-format.test.ts` — normalization, names, day periods,
  separators and invalid-locale fallback.
- `test/unit/lib/value-format.test.ts` — `de_DE` month and number separators,
  `zh-CN` meridiem, default English output.
- `test/unit/domain/scripting/evaluator-formats.test.ts` — FormCalc localized
  `MMMM`/`EEE`/`A` and `num{...}` separators plus round-trip parsing.
- `test/unit/domain/scripting/javascript-engine.test.ts` — localized
  `xfa.host.formatValue` tokens.
- `test/unit/workflows/render-pdf.test.ts` — normalized `locale` reaches the
  renderer.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Revert the commit and keep only the need-assessment research note. Do not
reintroduce module-global locale state or translate diagnostics.

## Outcome

Locale is normalized once in the workflow and reaches all six `formatValue`
call sites, FormCalc and JavaScript engine configs. Localized month/day names,
meridiem text and number separators are covered by new unit tests; default
English behavior and existing golden outputs are unchanged. Verification:
109 unit suites / 1,413 tests, 96.5% line coverage, 17 integration suites,
lint/build/format clean, and all rendered sample-form text unchanged. Research
and canonical docs were updated with the new locale section and change-ledger
entry.
