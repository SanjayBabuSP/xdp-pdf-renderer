# Agent instructions

Read [`docs/AI_WIKI.md`](docs/AI_WIKI.md) before making any code change. It is the
source of truth for architecture, behaviour, and the rationale behind decisions.
The codebase deliberately has no explanatory inline comments.

After changing code, update `docs/AI_WIKI.md` in the same change: describe what
changed and why, add a dated entry to its Change ledger, and record any new or
updated regression test. Do not reintroduce explanatory comments in source.

Verify with `npm run lint`, `npm run build`, `npm run test:unit`, and
`npm run test:integration`.
