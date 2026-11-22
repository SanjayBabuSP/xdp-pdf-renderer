# Research note — library hardening, package size, DX and AI-friendliness

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-library-improvements.md`

## Question

Which items in the improvement plan can be implemented generically, without new
runtime dependencies or rendering-behaviour changes, and which must be deferred
or replaced with zero-dependency equivalents?

## Evidence

- Source: `package.json`, `tsconfig.json`, `tsconfig.test.json`, `jest.config.js`,
  `eslint.config.mjs`, `.prettierrc`, `.github/workflows/*.yml`, `package-lock.json`.
- Source: `src/index.ts`, `src/types.ts`, `src/errors/error-codes.ts`,
  `src/cli.ts`, `src/lib/result-type.ts`, `src/workflows/render-pdf.ts`.
- Source: `src/domain/scripting/js-engine/javascript-engine.ts`,
  `xfa-form-proxy.ts`, `xfa-record-proxy.ts` and all script tests/fixtures.
- Source: `src/rendering/font-manager.ts`, `font-registry.ts`,
  `src/config/pdf417-tables.json`, `src/rendering/pdf417.ts`,
  `src/rendering/barcode-renderer.ts`.
- Measurement: `npm pack --dry-run --json` — 944,373-byte tarball, 2,379,462
  bytes unpacked, 194 files; fonts are 1,468,640 bytes (62% of unpacked size).
- Measurement: 109 unit suites / 1,413 tests, 96.5% lines, 94.45% statements,
  95.72% functions, 84.59% branches; 17 integration suites.
- Measurement: `vm.createContext({}, { codeGeneration: { strings: false } })`
  makes `f.constructor('return process')()` throw `EvalError` for a function
  obtained from inside the context.
- Source: plan baseline sandbox escape via host-realm `xfa` and `console.log`.

## Findings

- The sandbox escape is real: every injected global is created in the host realm;
  `vm.createContext` does not change their prototypes. `codeGeneration: false`
  alone does not block host `Function` constructors. Confidence: high.
- Rebasing injected objects/functions onto sandbox-realm prototypes does block
  both reported escapes while preserving callability and property semantics.
  `vm` import is isolated to `javascript-engine.ts`; moving it to an adapter
  satisfies the domain-purity boundary rule. Confidence: high.
- Existing scripts use only ordinary source-level JavaScript; no fixture uses
  `eval`, `Function`, timers or string callbacks. `codeGeneration: false` and
  realm rebasing are therefore compatibility-safe for current fixtures.
  Confidence: high.
- `ErrorResult.code` is currently `string`; `UNKNOWN_UNIT` is emitted from
  `unit-converter.ts` but absent from `ERROR_CODES`. A strict `ErrorCode` union
  requires adding that code first. Confidence: high.
- `package.json` already excludes all `.d.ts.map` files via `!dist/**/*.map`.
  `RenderInput` is already exported from the root. `ErrorCodeKey` already exists
  but is not re-exported. Confidence: high.
- `pdf417-tables.json` has unused `textSubmodes`; `rs` and `clusters` are used.
  `barcode-renderer` and `pdf-renderer` call sites are async-capable. Lazy
  table loading and lazy Adobe module loading need no new dependency. Confidence: high.
- Font bytes are read synchronously on every `FontManager` instance; `PDFFont`
  objects are document-bound and must stay per-instance. A process-wide cache
  keyed by resolved path + `mtimeMs` + `size` is safe. Confidence: high.
- `npm audit --omit=dev` initially reported a moderate advisory against
  `fast-xml-parser` 4.x; upgrading to 5.12.1 clears it without changing fixture
  output. `@types/node` 22 is needed to match `engines`. Confidence: high.
- New dependencies are absent from the lockfile: `tsup`/`tsdown`/`unbuild`,
  `typedoc`, `fast-check`, `publint`, `@arethetypeswrong/cli`,
  `dependency-cruiser`, `eslint-plugin-boundaries`, `tinybench`, and
  `isolated-vm`/`quickjs-emscripten`. `fonttools`/`pyftsubset` is not installed.
  `@types/node` is 20.x while `engines` requires Node >=22.14. Confidence: high.
- Large-file splits are readability-only, with no measured performance gain.
  `formcalc/evaluator.ts` has self-referential `BUILTIN_FUNCTIONS['datefmt']`
  lookups and a flat-key fallback; splitting it is the riskiest. Confidence: high.
- `parseXdp` parses the XML twice; eliminating that is a real perf lead but
  needs its own benchmark and fixture-output verification. Confidence: medium.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Tarball size | 944,373 bytes | <=950,000 | within budget |
| Unpacked size | 2,379,462 bytes | smaller after font choice | unresolved |
| Fonts share of unpacked | 62% | reduced | unresolved without fonttools/optional package |
| Unit tests | 109 suites / 1,413 tests | pass | pass |
| Integration tests | 17 suites | pass | pass |
| Sandbox escape before fix | host `process` reachable | blocked | must fix |
| Sandbox prototype-rebase experiment | both PoCs throw `EvalError` | blocked | fixed in adapter |

## Open unknowns

- Whether a future `isolated-vm` worker adapter can preserve the node proxies
  and `xfa.layout.page(this)` identity semantics. Resolving needs a spike with
  the selected library.
- Whether removing `--forceExit` exposes real open handles or only Jest worker
  idle timers. Resolving needs `jest --detectOpenHandles --runInBand`.
- Exact pixel impact of lazy Adobe/barcode loading. Resolving needs sample-form
  output comparison before and after.
- Whether a bundled build is desired; it requires a new devDependency and a
  release-shape decision.

## Conclusion

Implement option (a): keep `vm`, document trusted-templates-only, add
`codeGeneration` restrictions and realm rebasing behind an adapter, and enforce
the domain boundary with ESLint's built-in `no-restricted-imports`. Implement the
zero-dependency versions of the remaining feasible items. Defer bundling,
typedoc generation, fast-check, publint/attw, dependency-cruiser, tinybench,
font subsetting/optional font package, large-file splits, compile-once API and
full worker/WASM isolation; record them as residual gaps with reasons.
