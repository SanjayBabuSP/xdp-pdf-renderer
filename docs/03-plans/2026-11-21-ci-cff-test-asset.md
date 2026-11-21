# Implementation plan — CI-safe CFF subset test

- Date: 2026-11-21
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-21-ci-cff-test-asset.md`

## Goal

Make the CFF subset regression test pass on clean CI checkouts without optional
Adobe font assets.

## Scope

- In scope: test-only changes, docs/wiki ledger.
- Out of scope: adding large Adobe font binaries to the repo, source changes.

## Steps

- [x] Step 1 — Removed the Adobe OTF dependency from
      `test/unit/rendering/cff-subset.test.ts`; kept the committed DejaVu TTF
      non-CFF assertion.
- [x] Step 2 — Added `test/unit/rendering/cff-subset-patch.test.ts` with a
      mocked fontkit subset emitting `01 00 04 15`; asserted the wrapper rewrites
      byte 3 to the subset's real `offSize`.
- [x] Step 3 — Added a non-CFF control case asserting passthrough.
- [x] Step 4 — Type-checked both files and ran the full verification suite.

## Tests

- `test/unit/rendering/cff-subset-patch.test.ts` — mocked CFF header patch and
  non-CFF passthrough.
- `test/unit/rendering/cff-subset.test.ts` — committed TrueType subset remains
  `/FontFile2`, no `/FontFile3`.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
```

## Rollback

Restore the original test only if the mocked test no longer exercises the
patching code path; do not reintroduce a dependency on uncommitted assets.

## Outcome

No unit test reads `assets/fonts/adobe/*` anymore. The CFF patch path is tested
deterministically with a mocked fontkit subset, and the TrueType passthrough
test still uses the committed DejaVu font. All verification commands pass.
