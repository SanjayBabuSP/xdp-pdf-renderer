import { Result, RenderOptions, LayoutModel } from './types';
import { renderFormToPdf } from './workflows/render-pdf';
import { parseXdp } from './domain/parsing/parse-xdp';

/**
 * Inputs for a render or validate call.
 */
export interface RenderInput {
  /** XDP template as text. */
  xdp: string;

  /** XSD schema as text. */
  xsd: string;

  /** XML data as text. */
  data: string;

  /** Optional rendering behaviour; see {@link RenderOptions}. */
  options?: RenderOptions;
}

/**
 * Renders an XFA form to PDF bytes.
 *
 * @param input - Template, schema, data and optional rendering settings.
 * @returns A success result containing PDF bytes, or a failure result with a
 * machine-readable error code.
 *
 * @example
 * ```typescript
 * import { render } from '@sanjay-sde/xdp-pdf-renderer';
 *
 * const result = await render({ xdp, xsd, data });
 * if (result.success) await writeFile('form.pdf', result.data);
 * ```
 */
export async function render({
  xdp,
  xsd,
  data,
  options,
}: RenderInput): Promise<Result<Uint8Array>> {
  return renderFormToPdf(xdp, xsd, data, options ?? {});
}

/**
 * Runs the full render pipeline without writing a PDF to disk.
 *
 * @param input - Template, schema, data and optional rendering settings.
 * @returns A success result when the inputs pass validation and render, or a
 * failure result with a machine-readable error code.
 *
 * @example
 * ```typescript
 * import { validate } from '@sanjay-sde/xdp-pdf-renderer';
 *
 * const result = await validate({ xdp, xsd, data });
 * if (!result.success) console.error(result.error.code, result.error.hint);
 * ```
 */
export async function validate(input: RenderInput): Promise<Result<Uint8Array>> {
  return render(input);
}

/**
 * Parses an XDP template into the layout model without rendering a PDF.
 *
 * @param xdp - XDP template as text.
 * @returns A success result with the parsed layout model, or a failure result.
 *
 * @example
 * ```typescript
 * import { inspect } from '@sanjay-sde/xdp-pdf-renderer';
 *
 * const result = inspect(xdp);
 * if (result.success) console.log(result.data.rootSubformName);
 * ```
 */
export function inspect(xdp: string): Result<LayoutModel> {
  return parseXdp(xdp);
}

export type { AdobeOptions, ErrorResult, LayoutModel, Result, RenderOptions } from './types';
export type { ErrorCode, ErrorCodeKey } from './errors/error-codes';
export { ERROR_CODES } from './errors/error-codes';
