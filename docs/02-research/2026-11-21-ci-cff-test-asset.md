# Research note — CI failure in CFF subset test

- Date: 2026-11-21
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-21-ci-cff-test-asset.md`

## Question

Why does `test/unit/rendering/cff-subset.test.ts` fail on Node 22/24 GitHub
Actions runners with `ENOENT ... assets/fonts/adobe/LetterGothicStd.otf`?

## Evidence

- CI logs show only this test failing on both Node matrices; all other 123–124
  suites pass.
- `assets/fonts/adobe/*.otf` files are imported locally via
  `npm run fonts:import` and are not committed to the repository.
- `package.json` `files` publishes only `assets/fonts/*.ttf`; the Adobe OTFs are
  optional external assets, not test fixtures.
- `cff-subset.test.ts:8` calls `fs.readFileSync()` on that optional asset.
- `cff-subset-patch.ts` logic is pure wrapping of fontkit's `createSubset()` /
  `encodeStream()`; it does not require a real CFF font to be verified.

## Findings

- The test is environment-dependent, not a product regression (high confidence).
- Replacing the real-font dependency with a mocked fontkit subset that emits the
  malformed CFF header byte preserves the regression assertion while making the
  suite deterministic on clean checkouts (high confidence).
- The existing DejaVu TTF test is safe: `assets/fonts/DejaVuSans.ttf` is
  committed and published (high confidence).

## Measurements

| Case | Local | CI |
| --- | --- | --- |
| Adobe OTF present | test passes | asset absent → ENOENT |
| Mocked CFF subset stream | n/a | deterministic, no asset |

## Open unknowns

- None.

## Conclusion

Make the CFF header assertion self-contained by mocking fontkit and exercising
the wrapper directly; keep the committed TrueType test unchanged.
