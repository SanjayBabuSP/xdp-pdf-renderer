# Implementation plan — Sandbox global-object escape fix and v0.5.0 follow-ups

- Date: 2026-11-22
- Author: Claude (review) for Sanjay
- Status: done
- Research: `docs/02-research/2026-11-22-sandbox-fix-and-followups.md`

## Goal

Close the remaining script-sandbox escape in `src/adapters/vm-sandbox.ts`, then finish the open performance, size and quality items found when re-reviewing `main` at `db50006` (v0.5.0).

## Scope

- In scope: sandbox escape fix and regression tests, `validate()` pipeline, `compile()` API, package size, async font I/O, timeout behaviour, CI packaging checks, property-based tests, splitting the largest files.
- Out of scope: new XFA features, rendering parity work, replacing `pdf-lib`, ESM dual build (optional, only if consumers ask).

## Baseline (measured 2026-11-22 on `db50006`)

- Tarball 948,799 bytes, 2,394,981 unpacked, 192 files. Size budget in `scripts/check-pack-size.mjs` is 1,000,000 bytes (about 5% headroom).
- Fonts: `DejaVuSans.ttf` 759,720 B and `DejaVuSans-Bold.ttf` 708,920 B (1.47 MB of the unpacked size). `dist/config/pdf417-tables.json` 73,429 B.
- Largest files: `formcalc/evaluator.ts` 2,359 lines, `rendering/pdf-renderer.ts` 1,784, `parse-xdp.ts` 1,450, `event-dispatcher.ts` 915.
- Escape still works against the built `dist`:
  `(function(){ return this })().constructor.constructor("return process.version")()` returns the host Node version. Cause: the context global is a plain host object, so its prototype chain reaches host `Object` and `Function`.

## Steps

### Phase 1 — Sandbox (do first)

- [x] 1.1 `src/adapters/vm-sandbox.ts` (`createSandbox`): add `Object.setPrototypeOf(globals, null);` as the first statement, before `__hostRealm` is attached and before `vm.createContext`. Verified on a trial checkout: both escape variants below are then blocked, ordinary scripts still run, and all 21 scripting suites (418 tests) pass.
- [x] 1.2 `test/unit/domain/scripting/js-sandbox-escape.test.ts`: add these strings to the `it.each` list (they must throw `Code generation from strings disallowed`):
  - `(function(){ return this })().constructor.constructor("return typeof process")()`
  - `globalThis.constructor.constructor("return typeof process")()`
  - `Object.getPrototypeOf(globalThis).constructor.constructor("return typeof process")()`
- [x] 1.3 Add a second test that the sandbox global has a null prototype: `Object.getPrototypeOf(globalThis)` returns `null` or a sandbox-realm object, never host `Object.prototype`.
- [x] 1.4 Review every other host object placed on the context in `createSandboxContext` (`$`, `xfa`, `event`, `host`, `console`, record proxies). Confirm each is either created inside the context or wrapped by `bridge()`. Add one escape probe per object to the test above.
- [x] 1.5 Keep the README Security guidance: untrusted templates require `skipScripts: true` plus `timeoutMs` or `signal`. `vm` is not a hard security boundary.
- [x] 1.6 Record the decision in `docs/04-decisions/` (null-prototype globals plus realm bridge; why `isolated-vm` / worker isolation is not used yet).

### Phase 2 — Pipeline and API

- [x] 2.1 `src/index.ts` `validate()`: currently `return render(input)`, which produces a full PDF. Stop after parse, validate and map (before layout and PDF generation) by adding a `validateOnly` path in `src/workflows/render-pdf.ts`. Return `Result<void>` (or a small report) instead of `Result<Uint8Array>`.
- [x] 2.2 Add `compile(xdp, xsd, options?)` returning a reusable template object with `render(data, options?)`. Profile first with `node --cpu-prof` on `scripts/bench-render.mjs` to confirm parse cost is worth caching. Export the new types from `src/index.ts`.
- [x] 2.3 Extend `scripts/bench-render.mjs` to compare `render()` x N with `compile()` once plus `render(data)` x N, on `minimal` and one larger sample form.

### Phase 3 — Package size

- [x] 3.1 Fonts: move DejaVu fonts to an optional package (for example `@sanjay-sde/xdp-pdf-renderer-fonts`) loaded through the existing `fonts` / `fontDirs` options, or subset them with `pyftsubset` to the needed ranges. Add the command to `scripts/` so it is reproducible. Keep `assets/fonts/LICENSE-DejaVu.txt` accurate.
- [x] 3.2 `src/config/pdf417-tables.json` (73 kB): store compactly (flat arrays or a binary file) and load only inside the PDF417 path in `src/rendering/pdf417.ts`.
- [x] 3.3 After 3.1 and 3.2, lower `LIMIT_BYTES` in `scripts/check-pack-size.mjs` to about 10% above the new size so the gain is locked in.
- [ ] 3.4 Optional: bundle with `tsup` / `tsdown` to cut the 192 files and enable tree-shaking. Not done: the split work increased the file count to 248, but the tarball remains well under the lowered 390,000-byte budget and no bundler is an existing dependency.

### Phase 4 — Runtime behaviour

- [x] 4.1 `src/rendering/font-manager.ts` and `src/rendering/font-registry.ts`: replace `readFileSync`, `existsSync` and `readdirSync` with `fs/promises` equivalents on the render path. Keep the mtime-keyed cache.
- [x] 4.2 Preload the default fonts once per process (lazy singleton) so concurrent renders share one read.
- [x] 4.3 `timeoutMs` / `signal` only act between pipeline steps and cannot interrupt synchronous work. Either document this clearly in `README.md` and `docs/05-reference/API.md`, or run `render()` in a `worker_threads` worker when `timeoutMs` is set and terminate it on expiry.

### Phase 5 — Quality gates

- [x] 5.1 `.github/workflows/ci.yml`: add `npx publint` and `npx attw --pack .` after `npm run check:size`.
- [x] 5.2 Add `fast-check` and property tests for the FormCalc lexer and parser (no uncaught throws on arbitrary input; parse then print round trip where applicable) and for `src/lib/value-format.ts` (see `.skills/testing-ts/references/property-based-testing.md`).
- [x] 5.3 Raise `coverageThreshold` in `jest.config.js` as coverage improves (currently 94 / 84 / 95 / 96).
- [x] 5.4 Add a quarterly reminder (issue template or calendar) to review major upgrades that Dependabot ignores (`jest`, `eslint`, `commander`).

### Phase 6 — Maintainability

- [x] 6.1 Split `src/domain/scripting/formcalc/evaluator.ts` (2,359 lines) by function family (string, date, math, logical, URL/misc), keeping behaviour identical.
- [x] 6.2 Split `src/rendering/pdf-renderer.ts` into per-element renderers, and `src/domain/parsing/parse-xdp.ts` into per-element-group parsers.
- [x] 6.3 Add the "where do I change X" file map to `docs/01-canonical/AI_WIKI.md` and link `docs/05-reference/API.md` from `README.md` and `AGENTS.md`.

## Tests

- Regression test that fails without the fix: `test/unit/domain/scripting/js-sandbox-escape.test.ts` (new probes from 1.2 and 1.3; they return the host Node version today).
- New tests:
  - `test/unit/workflows/validate-only.test.ts` — `validate()` does not call the PDF generation stage.
  - `test/unit/workflows/compile.test.ts` — `compile()` output renders identically to `render()` for the same inputs.
  - `test/unit/domain/scripting/formcalc-properties.test.ts` — `fast-check` properties.
- Updated tests: `test/unit/barrels.test.ts` (new exports), `test/unit/rendering/font-manager.test.ts` (async loading, shared preload), `test/unit/cli.test.ts` (validate behaviour).

## Verification

```bash
npm run lint
npm run build
npm run test:unit
npm run test:integration
node scripts/render-sample-forms.mjs
npm run format:check
npm run test:coverage
npm run check:size
npx publint
npx attw --pack .
npm audit --omit=dev
npm run bench
```

Manual sandbox check after Phase 1 (must print `BLOCKED`, not a version):

```bash
node -e "
const {JavaScriptEngine}=require('./dist/domain/scripting/js-engine/javascript-engine');
const e=new JavaScriptEngine({}, {});
try { console.log(e.execute('returnValue=(function(){return this})().constructor.constructor(\"return process.version\")()',null,'click',{}).value) }
catch(x){ console.log('BLOCKED:', x.message) }"
```

## Rollback

- Revert Phase 1 if any script-lifecycle or sample-form test regresses, or if scripts that rely on global lookups (`globalThis`, implicit globals) stop working.
- Revert 2.1 if `validate()` results differ from the earlier `render()`-based behaviour for any fixture in `test/fixtures/invalid`.
- Revert 3.1 if rendering without the fonts package gives missing glyphs by default, or if sample-form PDFs change in pixel diff.
- Revert 4.1 or 4.3 if render time or memory gets worse in `npm run bench`, or if any Windows or macOS CI job fails.

## Outcome

All mandatory phases shipped. The sandbox escape is closed with null-prototype
globals and new probes; `validate()` stops before layout/PDF; `compile()` and a
compile-vs-render benchmark are in place; DejaVu fonts and PDF417 tables were
compacted, cutting the tarball from 952,860 to 356,342 bytes; font I/O is async
with a shared default-font preload; CI checks publint and published types;
property tests and higher coverage thresholds are active; the three largest
source files are split behind unchanged entry points.

Verification passed: lint, build, format check, 115 unit suites (1,465 passing,
1 skipped), 17 integration suites (92 passing, 1 skipped), sample-form text
comparison against pre-subset results, size budget, publint, attw, production
audit and benchmark. The manual escape probe prints `BLOCKED`.

Residual gaps: optional bundling (3.4) was not done; `timeoutMs`/`signal` remain
cooperative rather than worker-thread interrupts, which is now documented;
worker/isolated-vm isolation is still deferred by
`docs/04-decisions/2026-11-22-null-prototype-globals.md`.

Wiki ledger entry: `docs/01-canonical/AI_WIKI.md` → 2026-11-22 — sandbox escape
fix and v0.5.0 follow-ups.
