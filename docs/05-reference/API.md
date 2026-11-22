# Reference — Public API

- Date: 2026-11-22
- Author: opencode
- Status: verified
- Source: `src/index.ts`, `src/types.ts`, `src/errors/error-codes.ts`, `README.md`

## What this source is

The stable, exported surface of `@sanjay-sde/xdp-pdf-renderer`. Import only
from the package root; `package.json` exports the root entry and
`./package.json`.

## Extracted facts

### Functions

```typescript
render(input: RenderInput): Promise<Result<Uint8Array>>
validate(input: RenderInput): Promise<Result<Uint8Array>>
inspect(xdp: string): Result<LayoutModel>
```

- `render` runs the complete pipeline and returns PDF bytes.
- `validate` runs the same pipeline without writing a file to disk.
- `inspect` parses an XDP template into the layout model.
- None of these throw on bad input; they return `Result<T>`.

### RenderInput

| Field | Type | Default |
| --- | --- | --- |
| `xdp` | `string` | required |
| `xsd` | `string` | required |
| `data` | `string` | required |
| `options` | `RenderOptions` | `{}` |

### RenderOptions

| Field | Default | Purpose |
| --- | --- | --- |
| `locale` | XDP locale, then `en-US` | Picture formatting locale |
| `fonts` | `{}` | Family to font-file path overrides |
| `fontDirs` | `[]` | Extra font directories |
| `pageHeight` | XDP `<medium>` | Override page height in points |
| `maxInputSize` | built-in limit | Maximum input size in bytes |
| `strictValidation` | `false` | Fail instead of warning on validation errors |
| `onWarning` | no-op | Receives validation warnings |
| `previewMode` | `false` | Skip final PDF features |
| `skipScripts` | `false` | Skip FormCalc and JavaScript execution |
| `skipScriptEvents` | `[]` | Event names to skip |
| `signal` | none | `AbortSignal` for cancellation |
| `timeoutMs` | none | Overall render deadline |
| `adobe` | none | Adobe PDF feature options |

### Error codes

| Code | Name | Hint |
| --- | --- | --- |
| `XDP_1001` | `INVALID_XDP` | Check that the XDP is well-formed XML with a template root element. |
| `XDP_1002` | `MISSING_TEMPLATE` | Add a `<template>` element to the XDP packet. |
| `XDP_1003` | `MISSING_ROOT_SUBFORM` | Add a root `<subform>` directly under `<template>`. |
| `XDP_1005` | `MISSING_PAGE_SET` | Add a `<pageSet>` with at least one `<pageArea>`. |
| `XDP_1006` | `UNSUPPORTED_NAMESPACE` | Use an XFA 3.x template namespace or convert the template first. |
| `XSD_1003` | `INVALID_XSD` | Check that the XSD is well-formed XML with a schema root. |
| `XML_1004` | `MALFORMED_XML` | Check the XML for unclosed tags, bad entities or invalid characters. |
| `VAL_2001` | `VALIDATION_FAILED` | Fix the reported field values or use `strictValidation: false`. |
| `VAL_2002` | `MISSING_REQUIRED` | Add the missing field or make it optional in the XSD. |
| `VAL_2003` | `TYPE_MISMATCH` | Change the XML value to match the XSD field type. |
| `VAL_2004` | `UNRESOLVED_BINDING` | Update the bind `<ref>` to match a field in the XSD. |
| `MAP_3001` | `BINDING_FAILED` | Check the bind element and XML data path. |
| `MAP_3002` | `REPEAT_NO_ARRAY` | Supply an array for a repeating subform binding. |
| `LAY_4001` | `OVERFLOW` | Reduce content size or increase the page area. |
| `REN_5001` | `FONT_NOT_FOUND` | Pass the font through `fonts` or `fontDirs`. |
| `REN_5002` | `IMAGE_LOAD_FAILED` | Check that the image data is a supported, decodable format. |
| `REN_5003` | `PDF_GENERATION_FAILED` | Check error details, layout and font configuration. |
| `REN_5004` | `RENDER_ABORTED` | Increase `timeoutMs` or extend the caller signal deadline. |
| `GEN_0001` | `UNKNOWN_UNIT` | Use a supported unit such as `in`, `mm`, `cm`, `pt`, `px` or `em`. |
| `SCR_6001` | `SCRIPT_EXECUTION_FAILED` | Fix the script or set `skipScripts: true`. |
| `SCR_6002` | `SCRIPT_PARSE_ERROR` | Check the script syntax and language declaration. |
| `SCR_6003` | `SCRIPT_TIMEOUT` | Simplify the script or raise the script timeout. |
| `SCR_6004` | `SCRIPT_STACK_OVERFLOW` | Remove recursive or self-retriggering calls. |
| `SCR_6005` | `FORMCALC_ERROR` | Check the FormCalc expression and field references. |
| `SCR_6006` | `JAVASCRIPT_ENGINE_ERROR` | Check the JavaScript event script and field references. |

### Examples

```typescript
import { render } from '@sanjay-sde/xdp-pdf-renderer';

const result = await render({ xdp, xsd, data, options: { locale: 'de_DE' } });
if (result.success) {
  await writeFile('form.pdf', result.data);
} else {
  console.error(result.error.code, result.error.message, result.error.hint);
}
```

```typescript
import { inspect, validate } from '@sanjay-sde/xdp-pdf-renderer';

const checked = await validate({ xdp, xsd, data, options: { skipScripts: true } });
if (!checked.success) throw new Error(checked.error.message);

const layout = inspect(xdp);
if (layout.success) console.log(layout.data.rootSubformName);
```

### Security

Scripts run in a restricted Node `vm` context: string and WASM code generation
are disabled, and injected values are rebased onto sandbox-realm prototypes.
This is a mitigation, not a security boundary. For untrusted templates, set
`skipScripts: true`; the library cannot protect against CPU or memory use by
ordinary script loops. See
[`docs/04-decisions/2026-11-22-script-isolation.md`](../04-decisions/2026-11-22-script-isolation.md).

## Applicable rules

- Import from the package root only.
- Treat every failure as a `Result`; do not expect thrown exceptions.
- Use stable error codes for control flow, not message text.

## Limitations

- `validate` currently runs the full render pipeline before reporting success.
- The API has no compile-once template cache.
- Locale support covers XFA picture formatting, not message translation.

## Related documents

- [`README.md`](../../README.md) — installation and quick start
- [`docs/01-canonical/AI_WIKI.md`](../01-canonical/AI_WIKI.md) — behaviour and rationale
