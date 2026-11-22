# Decision — XFA script isolation strategy

- Date: 2026-11-22
- Author: opencode
- Status: accepted
- Research: `docs/02-research/2026-11-22-library-improvements.md`
- Plan: `docs/03-plans/2026-11-22-library-improvements.md`

## Context

`JavaScriptEngine` used Node's `vm` module with no `codeGeneration` restriction
and injected host-realm objects and functions as script globals. Scripts could
reach host `Function` through `xfa.constructor.constructor` or
`console.log.constructor` and read `process`. Existing script fixtures use only
ordinary source-level JavaScript, and no script in the repository uses `eval`,
`Function`, timers or string callbacks.

## Decision

Treat templates as trusted input, keep `vm`, and harden the current boundary:
disable string/WASM code generation, rebase every injected value onto the
sandbox realm's prototypes, and forbid `vm` imports under `src/domain/` with an
ESLint boundary rule.

## Alternatives considered

- `isolated-vm` — rejected: not in the lockfile, and its isolated realm cannot
  preserve the live node proxies used by `xfa.resolveNode`, `xfa.record` and
  `xfa.layout.page(this)` without a large adapter rewrite.
- `quickjs-emscripten` — rejected: same proxy identity problem plus a WASM
  dependency.
- `worker_threads` worker with `resourceLimits` — rejected: full process
  isolation but requires serialising the node proxies and changing the public
  script lifecycle; deferred as a follow-up spike.

## Consequences

- Positive: both confirmed escape paths now throw `EvalError` inside the
  sandbox; existing script parity tests and sample-form output are unchanged.
- Negative: this is a mitigation, not a security boundary. A hostile template
  can still consume CPU or memory through ordinary loops, and `skipScripts:
  true` remains the recommended setting for untrusted input.
- Follow-up work: evaluate worker-thread isolation with a dedicated research
  note and benchmark if untrusted templates ever become a supported use case.

## Evidence

- Fixture / PDF / decompiled file / spec: `src/adapters/vm-sandbox.ts`,
  `test/unit/domain/scripting/js-sandbox-escape.test.ts`,
  `docs/02-research/2026-11-22-library-improvements.md`.
- Confidence: high

## Change ledger

Dated entry added to `docs/01-canonical/AI_WIKI.md`: 2026-11-22 — library
hardening and developer experience.
