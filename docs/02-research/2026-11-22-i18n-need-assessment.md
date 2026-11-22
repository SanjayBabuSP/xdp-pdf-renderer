# Research note — does this project need i18n?

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-locale-aware-formatting.md`

## Question

Does `xdp-pdf-renderer` need a translation/i18n layer, and if not, what
locale-related work is actually worth maintaining?

## Evidence

- Product shape: `package.json:2-19` publishes an npm library plus `xdp-pdf`
  CLI; `src/index.ts:4-16` exports only `render()`, `Result`, `RenderOptions`,
  `ERROR_CODES`; `README.md:10-13` and `AI_WIKI.md:25-29` describe an
  educational XFA/XDP → PDF renderer.
- CLI text: `src/cli.ts:12-27,50-54,76-78,36,45,63-71,84,93` — about 27
  hardcoded English help/status/error strings, already paired with structured
  error codes where relevant.
- Diagnostics: `src/errors/error-codes.ts:1-33` — 23 stable `CODE` + English
  `message` pairs; ~20 `failure()` sites and ~44 thrown `Error`s add
  parameterized English detail strings.
- No i18n dependency: `package.json:56-77` lists only fontkit, commander,
  fast-xml-parser, pdf-lib, and dev tooling. No catalog/ICU/pluralization code.
- Locale catalog: `src/lib/locale-data.ts:22-33` reads 114 XFA locales from
  `src/config/xfa-locales.json`; no runtime module outside that file and its
  unit test imports it.
- `LayoutModel.locale` and `SubformNode.locale` are parsed
  (`src/domain/parsing/parse-xdp.ts:148,580`; `src/types.ts:191,349`) but never
  consumed by rendering or scripting.
- XFA picture formatting: `src/lib/value-format.ts:191-199` uses
  `Intl.DateTimeFormat(locale ?? 'en-US')` only for month/weekday names; all
  production call sites (`pdf-renderer.ts:704`, `apply-pagination.ts:283`,
  `position-engine.ts:176,209`, `xfa-object-model.ts:184,410`,
  `resolve-embeds.ts:74`) omit the locale argument.
- Scripting formats: `src/domain/scripting/formcalc/evaluator.ts:218-247,313+`
  uses hardcoded English month/day arrays; `:1537-1569` sniffs only `de/fr/ja/zh`
  prefixes for `LocalDateFmt`/`LocalTimeFmt`; JS engine `AM`/`PM` literals are
  at `javascript-engine.ts:738-739`.
- Data fidelity: `parse-xml-data.ts:100-102` preserves lexical `0,006`; the
  rationale is recorded in `AI_WIKI.md:160-161`.
- PDF text: captions/values come from the XDP/XML (`src/rendering/ui-values.ts:3-28`);
  code-owned English reaching the PDF is limited to metadata/XMP defaults
  (`src/adobe/pdf-metadata.ts:4,28,35-66,78,103`) and AM/PM/default pictures.
- Font coverage: CJK fallback chains and the CFF subset fix handle glyphs, not
  message translation (`AI_WIKI.md:142-156`; `font-sequences.ts:73-119`).

## Findings

- The project has no translatable application UI; visible form text is supplied
  by the input template/data and must stay verbatim for Adobe parity.
  Confidence: high.
- Full i18n (message catalogs, ICU, pluralization, locale negotiation) would
  only reach ~27 CLI strings and developer diagnostics; those already expose
  stable codes and are consumed by developers, not PDF end users.
  Confidence: high.
- The real gap is *locale-aware XFA formatting*: parsed `locale` is unused,
  month/day names and `AM`/`PM` are English by default, and number separators
  are picture literals. This affects rendered PDF correctness but is not
  translation. Confidence: high.
- Translating the CLI/errors would add a runtime dependency and catalog
  maintenance with little user benefit, and could destabilize the public
  `ErrorResult.code/message` contract. Confidence: medium-high.
- Metadata strings (`PRODUCER`, `creatorTool`, XMP) are compatibility
  identifiers; translating them would reduce Adobe fidelity. Confidence: high.

## Measurements

| Area | Current | Full i18n benefit | Locale-formatting benefit |
| --- | --- | --- | --- |
| CLI/help/errors | ~27 English strings, stable codes | low | none |
| Developer diagnostics | ~95-115 English strings | low-medium | none |
| PDF form text | template/data driven | none; should not translate | high if locale pictures respected |
| Date/number pictures | `Intl` only for month/weekday | none | high |
| Metadata/CJK fonts | fixed/compatibility | none; can harm parity | medium for glyph coverage |

## Open unknowns

- Whether any downstream consumer actually wants translated CLI/error messages.
- Which XFA locale IDs must be supported end-to-end (the catalog has 114, but
  only 3 have custom patterns).
- Whether Adobe propagates template `locale` into every picture or only specific
  fields; needs fixture/oracle evidence before changing formatting semantics.

## Conclusion

Do **not** adopt a general i18n/translation framework in this codebase. Maintain
the structured error codes and English developer diagnostics as-is. The
worthwhile "internationalization" work is narrow: propagate the XFA/`RenderOptions`
locale into `formatValue`, FormCalc and the JS picture engines, and add tests for
locale-specific month/weekday names, separators and AM/PM. If translated CLI
output is still wanted later, use a small keyed catalog over existing error
codes rather than a full framework.
