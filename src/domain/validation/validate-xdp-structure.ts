import { Result, LayoutModel } from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';

/** Structural validation of a parsed XDP layout model. */
export function validateXdpStructure(layout: LayoutModel): Result<LayoutModel> {
  const errors: string[] = [];

  if (!layout.rootSubformName) errors.push('Missing rootSubformName');
  if (!layout.pages || layout.pages.length === 0) errors.push('No pages defined');

  for (const page of layout.pages ?? []) {
    if (!page.medium) errors.push(`Page "${page.name}" missing medium`);
    if (!page.contentArea) errors.push(`Page "${page.name}" missing contentArea`);
  }

  if (errors.length > 0) {
    return failure(ERROR_CODES.INVALID_XDP.code, ERROR_CODES.INVALID_XDP.message, errors);
  }
  return success(layout);
}
