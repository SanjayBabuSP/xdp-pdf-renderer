# Research note — CI failures from optional Adobe font tests

- Date: 2026-11-24
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-24-ci-optional-font-tests.md`

## Question

Why do `test/unit/rendering/glyph-coverage.test.ts` and
`test/unit/rendering/font-sequence-fallback.test.ts` fail on clean GitHub
Actions checkouts when they pass locally?

## Evidence

- CI log: 2 failed suites, 121 passed, 1595 passed tests, 5 skipped. The visible
  failures are `glyph-coverage.test.ts:67` and
  `font-sequence-fallback.test.ts:65`.
- `glyph-coverage.test.ts:66-70` embeds
  `adobe/AdobeSongStd-Light.otf` without any availability guard.
- `font-sequence-fallback.test.ts:26-45` correctly uses
  `itWithImportedFaces(['SimSun-ExtB', 'SimSun'])` for the face-resolution test,
  but the following CJK render test at line 38 is a plain `it` and also relies
  on the imported face.
- `assets/fonts/adobe/` is gitignored (`.gitignore:17`) and is not published in
  `package.json` `files`; it is generated locally with
  `npm run fonts:import`.
- `test/helpers/adobe-fonts.ts` already provides `hasImportedFaces` and
  `itWithImportedFaces`, which skip when the manifest or face files are absent.
- The existing guard on the adjacent face-resolution test was itself
  ineffective: `itWithImportedFaces(['SimSun-ExtB', 'SimSun'])` checks those
  names against `assets/fonts/adobe/manifest.json`, where the installed face is
  keyed as `adobe song std l` / `adobesongstd-light`. The test was skipped even
  on a machine with the fonts. The availability check must name the target
  imported face (`AdobeSongStd-Light`), not the sequence aliases.
- The same class of failure was fixed for the CFF subset test in
  `docs/02-research/2026-11-21-ci-cff-test-asset.md`; that outcome claimed no
  unit test reads Adobe fonts, but these two tests were added or left unguarded
  afterwards.

## Findings

- Both failures are environment-dependent test defects, not product
  regressions (high confidence).
- In a clean checkout, `AdobeSongStd-Light.otf` does not exist, so the embed
  helper throws `ENOENT` (high confidence).
- Without the imported SimSun sequence target, the CJK render falls back to
  DejaVuSans, `sanitizeTextForFont` drops the CJK code points, and the content
  stream has no text facts, so `facts.length > 0` fails (high confidence).
- Reusing `itWithImportedFaces` preserves both tests on developer machines and
  skips them on clean CI without weakening the assertions (high confidence).
- The guard family must be `AdobeSongStd-Light` for both SimSun tests; using
  the alias names silently skips the face-resolution test even when the face is
  installed (high confidence).

## Measurements

| Case                                  | Local (Adobe fonts present) | Clean checkout                    |
| ------------------------------------- | --------------------------- | --------------------------------- |
| Glyph coverage AdobeSong test         | passes                      | `ENOENT` on the OTF               |
| CJK render test                       | passes with AdobeSongStd    | 0 text facts with DejaVu fallback |
| Face-resolution test with alias guard | skipped even with fonts     | skipped                           |
| Guarded by `AdobeSongStd-Light`       | run and pass                | reported as skipped               |

## Open unknowns

- None for this failure. The underlying optional-font policy is unchanged: the
  Adobe set is not redistributable and must not be a test prerequisite.

## Conclusion

Guard both optional-font tests with the existing `itWithImportedFaces` helper.
Do not add Adobe binaries to the repository, and do not replace the assertions
with weaker checks; the tests remain active whenever the locally imported faces
exist.
