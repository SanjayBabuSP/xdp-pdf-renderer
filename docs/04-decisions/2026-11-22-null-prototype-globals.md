# Decision — Null-prototype sandbox globals

- Date: 2026-11-22
- Author: opencode
- Status: accepted
- Research: `docs/02-research/2026-11-22-sandbox-fix-and-followups.md`
- Plan: `docs/03-plans/2026-11-22-sandbox-fix-and-followups.md`

## Context

`createSandbox` originally passed a plain host object to `vm.createContext`.
That object kept host `Object.prototype` in its prototype chain, so
`(function(){ return this })().constructor.constructor("return process.version")()`
reached host `Function` and printed the host Node version. The earlier fixes in
`2026-11-22-script-isolation.md` disabled code generation and rebased injected
values, but did not harden the global object itself. The local reproduction on
Node `v24.18.1` confirmed the escape still worked.

## Decision

Set the context globals object's prototype to `null` as the first statement of
`createSandbox`, before attaching `__hostRealm` or calling `vm.createContext`,
and keep the existing in-context `bridge()` for every host object placed on the
context.

## Alternatives considered

- `isolated-vm` — not used yet: it is not in the lockfile and its isolated realm
  cannot preserve the live node proxies used by `xfa.resolveNode`,
  `xfa.record` and `xfa.layout.page(this)` without a large adapter rewrite.
- `worker_threads` isolation with `resourceLimits` — not used yet: it would give
  a stronger boundary but requires serialising those proxies and changing the
  public script lifecycle. It remains a follow-up spike for untrusted input.
- Replacing `vm` with a pure interpreter — not used yet: it cannot run the
  source-level JavaScript found in real XFA fixtures.

## Consequences

- Positive: the global-object path to host `Object` and `Function` is removed;
  all 20 scripting suites (432 tests) pass, including new escape probes for
  every injected object.
- Negative: `vm` remains a hardened execution environment, not a security
  boundary. Hostile scripts can still consume CPU or memory through ordinary
  loops, so untrusted templates still require `skipScripts: true` plus
  `timeoutMs` or `signal`.
- Follow-up work: revisit worker isolation if untrusted templates become a
  supported use case.

## Evidence

- Fixture / PDF / decompiled file / spec: local reproduction command in
  `docs/02-research/2026-11-22-sandbox-fix-and-followups.md`;
  `test/unit/domain/scripting/js-sandbox-escape.test.ts`.
- Confidence: high

## Change ledger

Dated entry added to `docs/01-canonical/AI_WIKI.md`: 2026-11-22 — sandbox
global-object escape fix.
