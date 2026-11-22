# Implementation plan — Library hardening, package size, DX and AI-friendliness

- Date: 2026-11-22
- Author: Claude (review) for Sanjay
- Status: done
- Research: `docs/02-research/2026-11-22-library-improvements.md`

## Goal

Make `@sanjay-sde/xdp-pdf-renderer` safe for untrusted templates, smaller to install, easier for humans and AI agents to consume, and harder to regress.

## Scope

- In scope: script sandbox hardening, package size reduction, public API and typings, build/lint/CI fixes, docs for the public API, test and quality gates, render performance for batch workloads.
- Out of scope: new XFA feature work, rendering parity changes, switching PDF libraries.

## Baseline (measured 2026-11-22, v0.4.0)

- Tarball 940 kB, 2.4 MB unpacked, 188 files. Fonts are 1.47 MB of that (`DejaVuSans.ttf` 760 kB, `DejaVuSans-Bold.ttf` 709 kB). `dist/config/pdf417-tables.json` is 73 kB.
- 108 unit suites, 1396 tests pass; coverage 94.4% statements / 84.6% branches / 95.6% functions; no `coverageThreshold`.
- `src/` is about 21.5k lines. Largest files: `evaluator.ts` 2297, `pdf-renderer.ts` 1783, `parse-xdp.ts` 1449.
- Sandbox escape confirmed against built `dist`: `xfa.constructor.constructor("return typeof process")()` returns `"object"`; `console.log.constructor("return process.version")()` returns the host Node version.

## Implementation decisions

- Phase 1 isolation strategy: (a) trusted templates only. Keep `vm`, add
  `codeGeneration: { strings: false, wasm: false }`, rebase injected values onto
  sandbox-realm prototypes, and document the residual risk.
- No new npm dependencies. Use existing tools and built-ins: `no-restricted-imports`
  instead of dependency-cruiser, hand-written generators instead of fast-check,
  `node:perf_hooks` instead of tinybench, and hand-written API reference instead
  of typedoc.
- Deferred with reasons in the Outcome: bundling (2.5), typedoc generation (3.8),
  compile-once API (3.9/7.2), font subsetting or optional font package (2.1),
  large-file splits (5.2), publint/attw CI steps (6.3), worker/WASM isolation
  (1.3b), and `--forceExit` removal if open handles remain after investigation
  (4.5).

## Steps

Ordered by priority. Each phase should be its own PR with its own research note and plan, per `AGENTS.md`.

### Phase 1 — Security: script sandbox (do first)

- [x] 1.1 `src/domain/scripting/js-engine/javascript-engine.ts` (`execute`): pass `{ codeGeneration: { strings: false, wasm: false } }` to `vm.createContext`. This blocks `Function(...)`/`eval` from strings. It is a mitigation, not a boundary.
- [x] 1.2 Same file (`createSandboxContext`, `consoleObj`, `createHostObject`, `createXfaObject`): stop exposing host-realm functions and objects directly. Wrap or recreate them inside the context so `.constructor.constructor` resolves to the sandbox `Function`, not the host one. Freeze the injected objects.
- [x] 1.3 Decide the real isolation strategy and record it in `docs/04-decisions/`:
  - (a) document "trusted templates only" and keep `vm` plus the mitigations above; or
  - (b) move to `isolated-vm`, `quickjs-emscripten` (WASM), or a `worker_threads` worker with `resourceLimits`. This changes how the node proxies in `xfa-form-proxy.ts` and `xfa-record-proxy.ts` are passed in.
- [x] 1.4 `src/types.ts` (`RenderOptions`) and `README.md`: add a "Security" section. State what scripts can reach, recommend `skipScripts: true` for untrusted input, and consider making that the default.
- [x] 1.5 Add `src/domain/` boundary rule (see Phase 6.5) so `vm` stays isolated in one I/O adapter.

### Phase 2 — Package size

- [x] 2.1 Fonts: added an explicit `FONT_NOT_FOUND` failure with a hint. Moving
  DejaVu fonts to an optional package or subsetting them is deferred (see Outcome).
- [x] 2.2 `src/config/pdf417-tables.json`: load the table lazily on first PDF417
  use via `createRequire`; compact/binary storage is deferred (see Outcome).
- [x] 2.3 Lazy-load `src/adobe/*` features and `barcode-renderer` at their point
  of use. Script engines remain constructed when scripts are dispatched; lazy
  engine creation is deferred.
- [x] 2.4 `package.json` `files`: add `"!dist/**/*.d.ts.map"`.
- [ ] 2.5 Optionally bundle with `tsup` / `tsdown` / `unbuild` (ESM + CJS) to cut the 188 files down to a handful and enable tree-shaking. Keep `declaration` output.
- [x] 2.6 Add a size budget check in CI (see Phase 6.3).

### Phase 3 — Public API and developer experience

- [x] 3.1 `package.json`: add an `exports` map (`"."` with `types` and `default`, plus `"./package.json"`). If ESM is added in 2.5, include `import` and `require` conditions. Add any intentional subpaths (for example `./errors`) explicitly.
- [x] 3.2 `src/index.ts`: export `ErrorResult`, `AdobeOptions`, `RenderInput`, and an `ErrorCode` union type derived from `ERROR_CODES`.
- [x] 3.3 `src/types.ts`: make `ErrorResult.code` the `ErrorCode` union so `switch (result.error.code)` is exhaustive.
- [x] 3.4 `src/index.ts`: expose `validate()` and `inspect()` programmatically. Refactor `src/cli.ts` to call them so the CLI and library share one code path.
- [x] 3.5 `RenderOptions`: add `signal?: AbortSignal` and an overall `timeoutMs`. Thread them through `workflows/render-pdf.ts`.
- [x] 3.6 Return type: accept returning `Uint8Array` (a `Buffer` is already one). Avoid an extra `Buffer` copy at the end of the pipeline.
- [x] 3.7 `src/errors/error-codes.ts`: add a `hint` (and optional docs anchor) to each entry so failures say what to fix.
- [x] 3.8 Add TSDoc to the public types only (`RenderOptions`, `AdobeOptions`, `RenderInput`, `Result`, `ERROR_CODES`). Record in `AGENTS.md` that the "no inline comments" rule excludes public API TSDoc. Hand-written API reference replaces typedoc generation (see Outcome).
- [ ] 3.9 Compile-once API: add `compile(xdp, xsd)` returning a reusable template, then `template.render(data)`. Profile first with `node --cpu-prof` to confirm parsing is worth caching.

### Phase 4 — Bugs and drift

- [x] 4.1 `src/cli.ts` line 14: replace hard-coded `.version('0.1.0')` with the version from `package.json` (read it at runtime or inject it at build time).
- [x] 4.2 `package.json` `build`: change `"prettier --write src/ test/ && tsc"` to `"tsc"`. Keep formatting in `format` and verify it with `format:check` in CI so the build never rewrites the working tree.
- [x] 4.3 `package.json` `lint` / `lint:fix`: drop `--ext .ts` (legacy flag, not used by flat config).
- [x] 4.4 `package.json` `devDependencies`: align `@types/node` with `engines` (`^22`).
- [x] 4.5 `package.json` `test*` scripts and `jest.config.js`: run once with `--detectOpenHandles`, fix the leaking handles, then remove `--forceExit`.
- [x] 4.6 `.github/workflows/release.yml`: remove the stale "repo is private" comment and add `--provenance` to both `npm publish` commands (the repo is public).
- [x] 4.7 Move `.github/workflows/copilot-instructions.md` to `.github/copilot-instructions.md`.
- [x] 4.8 Wrapped the whole workflow so no throw escapes `render()` as a
  rejected promise; abort and missing-font errors get their own codes. Internal
  helpers still throw, but every public call returns `Result`.

### Phase 5 — Easier for AI and humans

- [x] 5.1 Add `llms.txt` (or `docs/05-reference/API.md`) at the repo root: `render()` signature, every `RenderOptions` field with default, all error codes with hints, two copy-paste examples, and the sandbox security note. Link it from `README.md` and `AGENTS.md`.
- [ ] 5.2 Split the largest files by responsibility, keeping behaviour identical and relying on existing tests:
  - `formcalc/evaluator.ts` into one file per function family (string, date, math, logical, URL/misc);
  - `rendering/pdf-renderer.ts` into per-element-type renderers;
  - `domain/parsing/parse-xdp.ts` into per-element-group parsers.
- [x] 5.3 `docs/01-canonical/AI_WIKI.md`: add a one-screen "where do I change X" map (feature to file) so agents do not need to open the large files.

### Phase 6 — Tests and quality gates

- [x] 6.1 `jest.config.js`: add `coverageThreshold` at current levels (about 94 statements, 84 branches, 95 functions) and ratchet it up over time.
- [x] 6.2 Added a hand-written idempotence property test for locale
  normalization. `fast-check` lexer/parser properties are deferred (see Outcome).
- [x] 6.3 CI (`.github/workflows/ci.yml`): added `format:check`, `npm run lint`,
  `npm run test:coverage`, `npm audit --omit=dev`, and a tarball size budget.
  `publint` and `attw --pack .` are deferred (see Outcome).
- [x] 6.4 CI matrix: add `macos-latest` and `windows-latest` (fonts are read with `fs` and `__dirname`).
- [x] 6.5 Add `dependency-cruiser` or `eslint-plugin-boundaries`: forbid `fs`, `path` and `vm` imports under `src/domain/` to enforce the "pure domain" claim in the README. Move the `vm` usage behind an adapter.
- [x] 6.6 Add fuzz-style tests: malformed XDP/XML/XSD must produce `{ success: false }` and never throw.
- [x] 6.7 Add Dependabot or Renovate. Review major upgrades available for `commander`, `jest`, `eslint`.
- [x] 6.8 Added `scripts/bench-render.mjs` using `node:perf_hooks` and RSS;
  it runs in CI as a non-blocking report. `tinybench` is deferred.

### Phase 7 — Performance

- [x] 7.1 `src/rendering/font-manager.ts`: the font cache is per instance and reads with `readFileSync`. Add a process-wide cache of font bytes keyed by path and mtime so repeated renders do not re-read about 1.4 MB from disk.
- [ ] 7.2 Implement 3.9 (compile once, render many) and benchmark it against 6.8.
- [x] 7.3 Re-measure startup time after the lazy-loading in 2.3.

## Tests

- Regression test that fails without the fix:
  - `test/unit/domain/scripting/js-sandbox-escape.test.ts` — asserts `xfa.constructor.constructor("return process")()` and `console.log.constructor(...)` do not reach host `process` (fails today).
  - `test/unit/cli.test.ts` — asserts `--version` equals `package.json` version.
  - `test/unit/barrels.test.ts` — asserts the new root exports (`validate`, `inspect`, `ERROR_CODES` hints).
  - Package test (script or CI step) — asserts `npm pack` size stays under the budget and that fonts are loadable from the chosen location.
- Updated tests: `test/unit/barrels.test.ts`, `test/unit/cli.test.ts`, font-manager tests under `test/unit/rendering/`, any test that imports from `dist` paths or relies on bundled fonts.

## Verification

```bash
npm run lint
npm run build
npm run format:check
npm run test:unit
npm run test:coverage
npm run test:integration
npm run check:size
npm run bench
node scripts/render-sample-forms.mjs
npm audit --omit=dev
```

## Rollback

- Revert a phase if sample forms render differently (pixel diff) from before the change, if any integration test regresses, if package size grows instead of shrinks, or if the sandbox change breaks scripts in `test/fixtures/lifecycle` or `sample-forms`.
- Revert the `exports` map immediately if any documented import path stops resolving for consumers.
- Revert the font move if rendering without the fonts package gives missing glyphs by default.

## Outcome

Shipped: hardened `vm` sandbox behind `src/adapters/vm-sandbox.ts` with a
decision record; explicit `FONT_NOT_FOUND`; lazy Adobe feature, barcode and
PDF417 table loading; process-wide font-byte cache; `exports` map, public
TSDoc, typed error codes with hints, `validate`/`inspect`, abort/timeout support
and `Uint8Array` output; CLI version drift fix; build/lint/Jest/CI tooling
cleanup; coverage threshold, domain boundary rule, fuzz and property tests;
dependabot, size budget and benchmark script. `fast-xml-parser` was upgraded to
5.x to clear the production audit, and `@types/node` now matches the Node 22
engine requirement.

Residual gaps: no bundling (2.5), no font subsetting or optional font package
(2.1), no typedoc generation (3.8), no compile-once API (3.9/7.2), no large-file
splits (5.2), no `fast-check` (6.2), no `publint`/`attw` CI checks (6.3) and
no worker/WASM isolation. These all require a new dependency, a release-shape
decision or a dedicated spike, and are recorded in the research note.

Documentation: `docs/04-decisions/2026-11-22-script-isolation.md`,
`docs/05-reference/API.md`, README security section, and the AI_WIKI change
ledger entry `2026-11-22 — library hardening and developer experience`.
