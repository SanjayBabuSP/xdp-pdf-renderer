import { Result, RenderOptions } from './types';
import { renderFormToPdf } from './workflows/render-pdf';

export interface RenderInput {
  /** XDP template XML string */
  xdp: string;
  /** XSD schema XML string */
  xsd: string;
  /** XML data string conforming to the schema */
  data: string;
  /** Optional rendering configuration */
  options?: RenderOptions;
}

/**
 * Render a PDF from an XDP template, XSD schema, and XML data.
 *
 * @returns Promise<Result<Buffer>> — PDF bytes on success, structured error on failure
 *
 * @example
 * const result = await render({ xdp, xsd, data });
 * if (result.success) {
 *   fs.writeFileSync('output.pdf', result.data);
 * } else {
 *   console.error(`[${result.error.code}] ${result.error.message}`);
 * }
 */
export async function render({ xdp, xsd, data, options }: RenderInput): Promise<Result<Buffer>> {
  return renderFormToPdf(xdp, xsd, data, options ?? {});
}

// Re-export types for consumers
export type { Result, RenderOptions } from './types';
export { ERROR_CODES } from './errors/error-codes';
