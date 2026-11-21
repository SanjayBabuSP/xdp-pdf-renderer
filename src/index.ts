import { Result, RenderOptions } from './types';
import { renderFormToPdf } from './workflows/render-pdf';

export interface RenderInput {
  xdp: string;
  xsd: string;
  data: string;
  options?: RenderOptions;
}

export async function render({ xdp, xsd, data, options }: RenderInput): Promise<Result<Buffer>> {
  return renderFormToPdf(xdp, xsd, data, options ?? {});
}

export type { Result, RenderOptions } from './types';
export { ERROR_CODES } from './errors/error-codes';
