import { Result, RenderOptions } from '../types';
import { success, failure } from '../lib/result-type';
import { parseXdp } from '../domain/parsing/parse-xdp';
import { parseXsd } from '../domain/parsing/parse-xsd';
import { parseXmlData } from '../domain/parsing/parse-xml-data';
import { validateDataAgainstSchema } from '../domain/validation/validate-data-against-schema';
import { validateBindings } from '../domain/validation/validate-bindings';
import { validateXdpStructure } from '../domain/validation/validate-xdp-structure';
import { resolveBindings } from '../domain/mapping/resolve-bindings';
import { expandRepeats } from '../domain/mapping/expand-repeats';
import { evaluateConditions } from '../domain/mapping/evaluate-conditions';
import { applyTableLayouts } from '../domain/layout/calculate-table-layout';
import { calculatePositions } from '../domain/layout/calculate-positions';
import { applyPagination } from '../domain/layout/apply-pagination';
import { renderPdf } from '../rendering/pdf-renderer';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * Main orchestration pipeline: parse → validate → map → layout → render.
 * Pure functions pipeline, single I/O call at the end.
 */
export async function renderFormToPdf(
  xdpXml: string,
  xsdXml: string,
  dataXml: string,
  options: RenderOptions = {}
): Promise<Result<Buffer>> {
  // ── Phase 1: Parse ──────────────────────────────────────────────────────
  const layoutResult = parseXdp(xdpXml);
  if (!layoutResult.success) return layoutResult;

  const schemaResult = parseXsd(xsdXml);
  if (!schemaResult.success) return schemaResult;

  const dataResult = parseXmlData(dataXml, schemaResult.data);
  if (!dataResult.success) return dataResult;

  // ── Phase 2: Validate ───────────────────────────────────────────────────
  const structureValid = validateXdpStructure(layoutResult.data);
  if (!structureValid.success) return structureValid;

  const schemaValid = validateDataAgainstSchema(dataResult.data, schemaResult.data);
  if (!schemaValid.success) return schemaValid;

  const bindingsValid = validateBindings(layoutResult.data, schemaResult.data);
  if (!bindingsValid.success) return bindingsValid;

  // ── Phase 3: Map data to layout ─────────────────────────────────────────
  const resolvedResult = resolveBindings(layoutResult.data, dataResult.data);
  if (!resolvedResult.success) return resolvedResult;

  const expandedResult = expandRepeats(resolvedResult.data, dataResult.data);
  if (!expandedResult.success) return expandedResult;

  const filteredResult = evaluateConditions(expandedResult.data);
  if (!filteredResult.success) return filteredResult;

  // ── Phase 4: Layout ─────────────────────────────────────────────────────
  const tableLayoutResult = applyTableLayouts(
    filteredResult.data,
    filteredResult.data.pages[0]?.contentArea.w ?? 487
  );
  if (!tableLayoutResult.success) return tableLayoutResult;

  const positionedResult = calculatePositions(tableLayoutResult.data);
  if (!positionedResult.success) return positionedResult;

  const paginatedResult = applyPagination(positionedResult.data, options.pageHeight);
  if (!paginatedResult.success) return paginatedResult;

  // ── Phase 5: Render PDF (I/O) ───────────────────────────────────────────
  try {
    const pdfBuffer = await renderPdf(paginatedResult.data, options);
    return success(pdfBuffer);
  } catch (e) {
    return failure(
      ERROR_CODES.PDF_GENERATION_FAILED.code,
      `${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${e}`
    );
  }
}
