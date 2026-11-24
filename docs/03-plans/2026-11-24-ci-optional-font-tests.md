# Implementation plan — CI-safe optional Adobe font tests

- Date: 2026-11-24
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-24-ci-optional-font-tests.md`

## Goal

Make the unit suite pass on clean CI checkouts without changing the assertions
that run when the optional Adobe fonts are available locally.

## Scope

- In scope: guard two optional-font tests; documentation and index updates.
- Out of scope: committing or publishing Adobe font binaries, changing font
  resolution behaviour, weakening glyph coverage.

## Steps

- [x] Step 1 — `test/unit/rendering/glyph-coverage.test.ts`: wrap the
      `preserves Chinese text supported by an embedded AdobeSongStd face` test in
      `itWithImportedFaces(['AdobeSongStd-Light'])`.
- [x] Step 2 — `test/unit/rendering/font-sequence-fallback.test.ts`: wrap the
      `renders CJK text with the sequenced face without failing` test in
      `itWithImportedFaces(['AdobeSongStd-Light'])`; also fix the adjacent
      face-resolution test's alias guard, which skipped even when the face was
      installed.
- [x] Step 3 — Update `docs/01-canonical/AI_WIKI.md` (regression table and
      change ledger) and `docs/README.md` with this research/plan pair.
- [x] Step 4 — Verify with the Adobe font directory both present and simulated
      absent.

## Tests

- `test/unit/rendering/glyph-coverage.test.ts` — still verifies AdobeSong
  coverage when the face exists; skips on clean CI.
- `test/unit/rendering/font-sequence-fallback.test.ts` — still verifies the
  sequenced CJK render when the faces exist; skips on clean CI.
- Simulated clean checkout must report both as skipped and the suite green.

## Verification

```bash
# Simulate a clean checkout
mv assets/fonts/adobe /tmp/opencode/adobe-fonts-backup
trap 'mv /tmp/opencode/adobe-fonts-backup assets/fonts/adobe' EXIT
npx jest --runInBand --testPathPattern='test/unit/rendering/(glyph-coverage|font-sequence-fallback)'

npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
```

## Rollback

Revert the guards if they skip when the Adobe faces are present, or if any
assertion changes beyond the skip wrapper. Do not reintroduce an unconditional
dependency on `assets/fonts/adobe`.

## Outcome

Shipped test-only guards. With fonts present, all 1602 unit tests pass and the
previously skipped SimSun resolution test now runs. With `assets/fonts/adobe`
moved aside to simulate CI, 123 unit suites pass with 7 skipped, coverage is
94.4% statements, 84.94% branches, 95.61% functions and 96.54% lines, and the
full 140-suite run passes with 8 skipped. Lint, build, Prettier, unit and
integration verification are clean. Wiki ledger entry added under 2026-11-24.
