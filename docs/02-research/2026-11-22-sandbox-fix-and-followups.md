# Research note — Sandbox global-object escape fix and v0.5.0 follow-ups

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-sandbox-fix-and-followups.md`

## Question

Can the remaining `vm` sandbox escape in `src/adapters/vm-sandbox.ts` be closed
with a generic change that preserves ordinary XFA scripts, and what baseline
measurements justify the follow-up work in the plan?

## Evidence

- `docs/03-plans/2026-11-22-sandbox-fix-and-followups.md` — baseline from the
  review at `db50006`, including the trial checkout result for the null-prototype
  fix.
- Local reproduction on `db50006` with Node `v24.18.1`:
  `node -e "const {JavaScriptEngine}=require('./dist/domain/scripting/js-engine/javascript-engine'); const e=new JavaScriptEngine({}, {}); ..."`
  printed `v24.18.1`, proving `(function(){ return this })()` reaches host
  `Function` through the context global's plain-object prototype chain.
- `src/adapters/vm-sandbox.ts` — `createSandbox` calls `vm.createContext` on the
  caller-supplied object before any prototype hardening; `__hostRealm` is
  attached to that same object.
- `src/domain/scripting/js-engine/javascript-engine.ts` and
  `test/unit/domain/scripting/js-sandbox-escape.test.ts` — existing bridge and
  escape probes.
- `npm run check:size` on `db50006` — 952,860-byte tarball, 196 files,
  2,403,253 bytes unpacked.
- `wc -l` on `db50006` — `formcalc/evaluator.ts` 2,359 lines,
  `rendering/pdf-renderer.ts` 1,784, `parse-xdp.ts` 1,450,
  `event-dispatcher.ts` 915.
- `du` on `db50006` — DejaVu TTFs 696 KB and 744 KB;
  `dist/config/pdf417-tables.json` 72 KB.
- `package.json` — `validate()` is the public API, `fast-check`, `publint` and
  `attw` are not yet dev dependencies, and the `bench` script exists but has no
  compile comparison.

## Findings

- The escape is caused by the context global retaining host `Object.prototype`
  and therefore host `Function`; confidence: high.
- Adding `Object.setPrototypeOf(globals, null)` as the first statement of
  `createSandbox` removes that path while leaving `vm`'s built-in intrinsics
  available to scripts; confidence: high (plan trial plus local reproduction).
- Host objects placed on the context must still be bridged into the sandbox
  realm; the existing `bridge()` helper already rebases function/array/date/
  regexp prototypes; confidence: high.
- Fonts dominate package size; moving or subsetting them is the highest-value
  size lever, with PDF417 encoding a smaller secondary gain; confidence: high.
- `validate()` currently renders a full PDF because `src/index.ts` delegates to
  `render()`; a separate `validateOnly` path can stop after parse/validate/map;
  confidence: high.
- `timeoutMs` and `signal` are cooperative checks between pipeline steps and
  cannot interrupt synchronous CPU work in the current design; confidence:
  high. Either documentation or worker-thread isolation is required for honest
  semantics; confidence: high.
- The large source files are safe to split only if re-exported through stable
  entry points and behaviour is held constant by the existing suites;
  confidence: medium until the split is done.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Escape probe via global `this` | `v24.18.1` | `BLOCKED` | host version leaked |
| Tarball size | 952,860 bytes | < 1,000,000 bytes | 47,140 bytes headroom |
| Unpacked size | 2,403,253 bytes | n/a | n/a |
| File count | 196 | 192 in plan baseline | +4 |
| Largest source file | 2,359 lines | smaller after split | n/a |
| Font bytes | ~1,468,000 | reduced by subsetting | n/a |
| PDF417 tables | 72 KB on disk | lazily loaded / compact | n/a |

## Open unknowns

- Whether all consumer scripts that rely on implicit globals keep working after
  the null-prototype change; the full unit/integration suite and sample forms
  will resolve this.
- Whether subsetting DejaVu fonts preserves every sample-form glyph; pixel/text
  output comparison will resolve this.
- Whether `compile()` pays for itself; `node --cpu-prof` on `bench-render.mjs`
  will resolve this before adding the API.
- Whether `publint` and `attw --pack .` are available in CI without local
  installation drift; the verification run will resolve this.

## Conclusion

The sandbox fix is safe to implement generically: harden the context global with
a null prototype before exposing it, keep the realm bridge for every host
object, and add targeted probes that fail without the fix. The follow-up work is
also generic, but each phase must be verified by the existing rendering fixtures,
the size budget, and the public API contract. `vm` remains a hardened execution
environment for trusted templates, not a hard security boundary; untrusted input
still requires `skipScripts: true` plus a timeout or abort signal.
