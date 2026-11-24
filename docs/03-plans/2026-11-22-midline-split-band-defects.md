# Implementation plan — mid-line split band defects

- Date: 2026-11-22
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-22-midline-split-band-defects.md`

## Goal

Remove the Example-2 page-5 text overlap and first-line cutoff by sizing
fragment bands to their owned lines and shifting following content.

## Scope

- In scope: owned-block measurement, band extension, sibling shift,
  trailing tail moves to the next page; regression tests; docs updates.
- Out of scope: ownership rule, line-break unification, border paint model,
  font binaries, full reflow pagination.

## Steps

- [x] Step 1 — `src/domain/layout/apply-pagination.ts`: `ownedBlockHeight`
      from ownership metrics; extend fragment bands to owned height; shift
      following siblings; move trailing whole nodes that still overflow to the
      next page (nested-aware, span-guarded, no re-wrap).
- [x] Step 2 — regression test in
      `test/unit/domain/layout/apply-pagination.test.ts` covering extension,
      sibling shift and tail move with a mid-line split.
- [x] Step 3 — verify Example-2 page 5 region pixel-clean vs pre-fix output
      and Adobe reference; run full verification.
- [x] Step 4 — update `docs/01-canonical/AI_WIKI.md` (§8 + §10 + §11) and
      `docs/README.md`.

## Tests

- Regression test that fails without the fix:
  `fragment band extension` in `apply-pagination.test.ts` (band stays short,
  siblings unshifted, tail stays without the change).
- Updated tests: none expected (no existing expectations cover this path).

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Revert when any Adobe pixel comparison regresses outside anti-aliasing noise
or when an existing pagination test pins the old band geometry.

## Outcome

Shipped: `ownedBlockHeight` + band extension + sibling shift + nested
tail-move in `apply-pagination.ts`, plus the shared `alignFragmentBand`
helper used by all three text render paths. Example-2 page 5 renders all
five owned lines whole with clean gaps and no overlap (verified by
pixel-profile bands and uniform 14.4pt Tm pitch); the overlapping `Qrepf`
header now starts clean after the fragment. No tail moves were needed in
fixtures (overflow resolved by extension + shift); the mover is covered by
a dedicated unit test. Full verification green (120 unit suites / 17
integration suites, coverage thresholds met, size under budget). Known
residual: absolute page-break positions may differ from Adobe by a line
where the grid cut falls mid-line (no full reflow); wrap points depend on
bundled font metrics.
