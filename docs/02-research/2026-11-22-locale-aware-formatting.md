# Research note — locale-aware XFA formatting

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-locale-aware-formatting.md`

## Question

How can locale be propagated and applied to XFA picture formatting without a
translation framework, while keeping default output byte-identical?

## Evidence

- `src/types.ts:191,349` and `src/domain/parsing/parse-xdp.ts:148,580` already
  parse XFA `locale`; no runtime code reads it.
- `src/lib/value-format.ts:1` accepts a locale but only uses it for
  `Intl.DateTimeFormat` month/weekday names at `:191-199`. Six production call
  sites omit it: `pdf-renderer.ts:704`, `apply-pagination.ts:283`,
  `position-engine.ts:176,209`, `xfa-object-model.ts:184,410`,
  `resolve-embeds.ts:74`.
- Number picture separators are hardcoded `.`/`,` (`value-format.ts:237-351`);
  time meridiem is hardcoded `AM`/`PM` (`:144-166`).
- FormCalc has an independent picture engine with English month/day tables at
  `formcalc/evaluator.ts:218-247`, formatting at `:313-415`, parsing at
  `:425-613`, and numeric formatting at `:635-659`.
- JS host formatting is a third implementation at
  `js-engine/javascript-engine.ts:718-789` with `AM`/`PM` and `.`/`,` literals.
- XFA locale IDs are underscore-form (`de_DE`, `en_IN`, `en_US`) in fixtures;
  `Intl.getCanonicalLocales('de_DE')` is invalid but `de_DE → de-DE` works.
- `Intl.DateTimeFormat('zh-CN', { hour: 'numeric', hour12: true })` exposes
  `dayPeriod: 下午`; `Intl.NumberFormat('de-DE').formatToParts(1234.5)` exposes
  group `.` and decimal `,`.
- No fixture picture uses `MMMM`, `EEE`, or `A`, so current sample PDFs should be
  unchanged; there is no Adobe oracle for template-locale propagation.

## Findings

- Centralize locale normalization and localized name/separator lookup in one
  `src/lib/locale-format.ts` helper; all three picture engines should consume it
  (high confidence).
- Default must remain English/no-locale so existing golden tests and PDF bytes
  do not change. Normalize once at the workflow boundary and pass explicitly
  (high confidence).
- Precedence should be `RenderOptions.locale` > field/subform/root XFA locale >
  `en-US`; an explicit option must override the template (high confidence).
- Locale-sensitive parsing must be updated alongside formatting so
  `Format`/`Parse` and `formatValue` round-trips stay symmetric (medium-high
  confidence).
- `host.language`, `app.language`, `wordNum`, ISO helpers, picture grammar
  tokens, `AD`/`GMT`, and epoch arithmetic must stay unchanged for Adobe
  compatibility (high confidence).

## Measurements

| Case | Current | After change |
| --- | --- | --- |
| no locale / `en-US` | `March`, `PM`, `1,234.50` | identical |
| `de_DE` option | English | `März`, `PM`, `1.234,50` |
| `zh-CN` option | English | `3月`, `下午`, same ASCII digits |
| invalid locale | ignored | ignored (no throw) |

## Open unknowns

- Whether Adobe propagates template `locale` into every picture or only specific
  fields; no oracle fixture exists. Mitigation: preserve existing output and
  make `RenderOptions.locale` an explicit override.
- ICU abbreviation output can vary by Node version. Keep English tables as the
  default path and assert only stable localized values in tests.

## Conclusion

Implement a small shared locale-format helper, normalize XFA IDs, thread locale
through workflow/layout/rendering/script config, and localize month/weekday,
meridiem, and number separators in `formatValue`, FormCalc and the JS host. Do
not translate messages or change non-picture Adobe semantics.
