# Implementation plan — table double-shift on page straddle

- Date: 2026-11-23
- Author: opencode
- Status: done
- Research: `docs/02-research/2026-11-23-table-double-shift.md`

## Goal

A table (or any container) that straddles a page boundary moves whole to the
next page with its internal layout intact — no per-child pre-shifts, no growth,
no stale shell on the previous page.

## Scope

- In scope: `walkContainer` in `src/domain/layout/apply-pagination.ts`
  (pre-check whole-unit shift before descending; suppress child atomic shifts
  for the moved unit).
- Out of scope: table row layout, fragment extension, carries, keep logic,
  break targets (unchanged); tall units that do not fit keep per-child shifts.

## Steps

- [x] Step 1 — In `walkContainer`, for subform/exclGroup nodes, evaluate the
  whole-unit atomic shift (same `atomic`/`fits` condition as the post-walk
  block) against the laid span BEFORE the inner walk; on fire, shift the whole
  subtree, accumulate `localDy`, mark shifted, and walk children with atomic
  shifts suppressed (break targets still apply; post-walk block then no-ops).
  Plus: `collectTail` moves a straddling table that fits on a page whole
  instead of splicing loose leaves (the actual Ruvlviqd trigger was an
  extendInList follower shift pushing content over the page bottom after the
  walkContainer pass).
- [x] Step 2 — Regression tests: straddling table with straddling last row
  moves whole and stays contiguous; tall table keeps per-row shifts.
- [x] Step 3 — Regenerate sample PDFs; verify the Ruvlviqd gap/shell are gone
  and oracle diffs do not regress; run the full verification chain.

## Tests

- New: `test/unit/domain/layout/pagination-straddle.test.ts` (or extend
  `pagination.test.ts`): real-geometry regression using laid positions that
  reproduce the 3325.4/3339.0 straddle.
- Existing: full unit + integration suites; Example-2 EN/ESP/CN sample PDFs.

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Conditions that mean the change must be reverted: new whole-page shifts in
fixtures that move away from Adobe, or any unit test asserting per-child
shifts inside a moved-whole parent.

## Outcome

Shipped: `walkContainer` whole-unit pre-shift (prevents child-then-parent
double shifts with internal gaps) and `collectTail` whole-table moves for
tables that fit on a page (prevents leaf-spliced shells and orphan bordered
cells; the actual Ruvlviqd trigger was an extendInList follower shift, not a
walk-time straddle). Sample PDFs regenerated; Example-2 EN now renders heading
(p4) + whole table (p5 top, header + data contiguous, no gap, no shell),
matching Adobe's contiguous presentation. Full verification green:
`lint`/`build`/`test:unit` (123 suites, 1601+1 new pass)/`test:integration`
(17/93)/coverage above gates/size 375,256/format/`publint` clean. Wiki ledger
entry added.
