# Implementation plan — <title>

- Date: YYYY-MM-DD
- Author: <agent or human>
- Status: proposed | in-progress | done | abandoned
- Research: `docs/02-research/YYYY-MM-DD-slug.md`

## Goal

One sentence describing the desired behaviour.

## Scope

- In scope: <...>
- Out of scope: <...>

## Steps

- [ ] Step 1 — file(s), function(s), change
- [ ] Step 2 — file(s), function(s), change

## Tests

- Regression test that fails without the fix: `path/to/test.ts`
- Updated tests: `path/to/test.ts`

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
```

## Rollback

Conditions that mean the change must be reverted.

## Outcome

Filled in after implementation: what shipped, residual gaps, wiki ledger entry.
