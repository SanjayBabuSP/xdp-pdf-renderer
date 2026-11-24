# Research note — phantom empty row in Example-2 Ruvlviqd table

- Date: 2026-11-23
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-23-table-double-shift.md`

## Question

Why does `/results` Example-2 EN render the `Ruvlviqd Rjcfqtk` table (Subform_0102)
with an empty band between the header row and the single data row, while Adobe
renders header + one row contiguously?

## Evidence

- `test/fixtures/sample-forms/results/Example-2-EN.pdf` p5: header cells
  y=99.0–115.5, data cells y=129.0–143.0 (13.5pt unexplained gap); staged base
  PDF has the same table contiguous at p5 y=360.8–392.0.
- Paginated layout dump (via `XDP_DEBUG_TREE` hook, since removed): p4 keeps an
  emptied `Subform_0101` shell (kids=0, h=30.0, renders nothing); p5 holds the
  full table (h=44.02) with `Subform_0104` at y=129.03 vs laid yOff=16.46.
- Instrumented `walkContainer` (`XDP_DEBUG_PAGINATE`, since removed):
  `atomic shift Subform_0104 y0=3325.4 -> 3339.0 (delta=13.6)`,
  table grows 30.46 → 44.02 to contain it,
  `atomic shift Subform_0102 y0=3309.0 -> 3339.0 (delta=30.0)`.
- Bucketer then fragments the grown table across p4/p5; p4 keeps an empty
  shell, p5 keeps the gapped table.
- `layoutTableSubform` lays the rows out contiguously (header h=16.46,
  data yOff=16.46); no carries or `extendInList` growth involve this table.

## Findings

- Data row `Subform_0104` [3325.4–3339.4] straddles the p4/p5 boundary (3339.0)
  and is atomically shifted +13.6 to the next page top: high.
- The table grows +13.6 to contain the shifted row, still straddles, and is
  then atomically shifted whole +30.0; the data row rides along and lands at
  table-top + 30.02 instead of +16.46 (double shift): high.
- The p4 shell + p5 gapped copy both stem from this double-shifted growth, not
  from table layout, carries, or fragment extension: high.
- Trigger: upstream pitch shrinkage (1.2×min line-height work) moved the table
  onto a page boundary; the defect is latent for any straddling table whose
  last row also straddles: medium.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Data row offset inside table | +30.02 | +16.46 | +13.56 gap band |
| Table height, p5 copy | 44.02 | 30.46 | +13.56 growth |
| p4 shell children | 0 (renders nothing) | n/a (should not exist) | stale shell |

## Open unknowns

- Whether Adobe keeps this exact table whole on one page or splits it
  differently; the oracle crop shows heading + header + one row together, which
  the fix reproduces (heading p4, table whole on p5).

## Conclusion

Safe to implement generically: when a container is atomically shifted whole,
its children must ride along untouched. Pre-check the whole-shift before
walking children and suppress child-level atomic shifts for the moved unit
(children are guaranteed in-page since the unit fits). Tall units that do not
fit keep today's per-child behaviour. This removes the gap, the growth, and
the stale p4 shell in one change.
