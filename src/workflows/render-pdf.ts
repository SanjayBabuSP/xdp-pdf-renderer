import { Result, RenderOptions, LayoutModel, PaginatedLayout } from '../types';
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
import { resolveXfaEmbeds } from '../domain/mapping/resolve-embeds';
import { applyTableLayouts } from '../domain/layout/calculate-table-layout';
import { calculatePositions } from '../domain/layout/calculate-positions';
import { applyPagination } from '../domain/layout/apply-pagination';
import { renderPdfWithDoc } from '../rendering/pdf-renderer';
import { dispatchScripts, dispatchPostLayoutScripts } from '../domain/scripting';
import { ERROR_CODES } from '../errors/error-codes';
import {
  applyPdfSecurity,
  applyPdfVersion,
  applyAdobeExtensionLevel,
  createAcroFormFields,
  markDocumentTagged,
  applyDocumentMetadata,
  setNeedsRendering,
  preserveInfoOverrides,
  embedXfaPackage,
  addBookmarks,
  addAnnotations,
  createLayers,
  flattenFormFields,
  setGlobalTabOrder,
} from '../adobe';
import type { PDFDocument } from 'pdf-lib';

export async function renderFormToPdf(
  xdpXml: string,
  xsdXml: string,
  dataXml: string,
  options: RenderOptions = {}
): Promise<Result<Buffer>> {
  const parseOptions = {
    strict: options.strictValidation !== false,
    maxInputSize: options.maxInputSize,
  };
  const layoutResult = parseXdp(xdpXml, parseOptions);
  if (!layoutResult.success) return layoutResult;

  const schemaResult = parseXsd(xsdXml, options.maxInputSize);
  if (!schemaResult.success) return schemaResult;

  const dataResult = parseXmlData(dataXml, schemaResult.data, options.maxInputSize);
  if (!dataResult.success) return dataResult;

  const structureValid = validateXdpStructure(layoutResult.data);
  if (!structureValid.success) return structureValid;

  const warn = options.onWarning ?? (() => {});
  const strict = options.strictValidation === true;

  const schemaValid = validateDataAgainstSchema(dataResult.data, schemaResult.data, { strict });
  if (!schemaValid.success) {
    if (strict) return schemaValid;
    warn(`[${schemaValid.error.code}] ${schemaValid.error.message}`);
    for (const detail of schemaValid.error.details ?? []) warn(`  ${detail}`);
  }

  const bindingsValid = validateBindings(layoutResult.data, schemaResult.data, { strict });
  if (!bindingsValid.success) {
    if (strict) return bindingsValid;
    warn(`[${bindingsValid.error.code}] ${bindingsValid.error.message}`);
    for (const detail of bindingsValid.error.details ?? []) warn(`  ${detail}`);
  }

  const resolvedResult = resolveBindings(layoutResult.data, dataResult.data);
  if (!resolvedResult.success) return resolvedResult;

  const expandedResult = expandRepeats(resolvedResult.data, dataResult.data);
  if (!expandedResult.success) return expandedResult;

  const scriptResult = dispatchScripts(
    expandedResult.data,
    dataResult.data as Record<string, unknown>,
    {
      skipScripts: options.skipScripts === true,
      skipEvents: options.skipScriptEvents,
      strictMode: options.strictValidation !== false,
    }
  );
  if (!scriptResult.success) return scriptResult;

  resolveXfaEmbeds(scriptResult.data.layout);

  const computedResult = computeLayout(
    scriptResult.data.layout,
    options.pageHeight,
    dataResult.data as Record<string, unknown>
  );
  if (!computedResult.success) return computedResult;

  const postLayoutResult = dispatchPostLayoutScripts(
    computedResult.data,
    dataResult.data as Record<string, unknown>,
    {
      skipScripts: options.skipScripts === true,
      skipEvents: options.skipScriptEvents,
      strictMode: options.strictValidation !== false,
    }
  );
  if (!postLayoutResult.success) return postLayoutResult;

  const finalLayout = postLayoutResult.data.layout;

  try {
    const fontEquateRules = layoutResult.data.config?.fontEquateRules;
    const { buffer: pdfBuffer, doc } = await renderPdfWithDoc(
      finalLayout,
      options,
      fontEquateRules
    );

    preserveInfoOverrides(doc, {
      producer: options.adobe?.metadata?.producer,
      creatorTool: options.adobe?.metadata?.creatorTool,
    });
    applyDocumentMetadata(doc, layoutResult.data.metadata, {
      producer: options.adobe?.metadata?.producer,
      creatorTool: options.adobe?.metadata?.creatorTool,
    });
    if (options.adobe?.acroForm || options.adobe?.embedXfa) {
      setNeedsRendering(doc);
    }

    const config = layoutResult.data.config;
    let dirty = true;
    if (config?.pdfVersion) {
      applyPdfVersion(doc, config.pdfVersion);
      dirty = true;
    }
    if (config?.adobeExtensionLevel) {
      applyAdobeExtensionLevel(doc, config.adobeExtensionLevel, config.pdfVersion ?? '1.7');
      dirty = true;
    }

    if (options.adobe) {
      applyAdobeFeatures(doc, options.adobe, finalLayout, xdpXml);
      dirty = true;
    }

    if (dirty) {
      const saveOptions = options.adobe?.security ? { useObjectStreams: false } : {};
      const finalBytes = await doc.save(saveOptions);
      return success(Buffer.from(finalBytes));
    }

    return success(pdfBuffer);
  } catch (e) {
    return failure(
      ERROR_CODES.PDF_GENERATION_FAILED.code,
      `${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${e}`
    );
  }
}

function computeLayout(
  layout: LayoutModel,
  pageHeight?: number,
  data?: Record<string, unknown>
): Result<PaginatedLayout> {
  const filteredResult = evaluateConditions(layout, data);
  if (!filteredResult.success) return filteredResult;

  const tableLayoutResult = applyTableLayouts(
    filteredResult.data,
    filteredResult.data.pages[0]?.contentArea.w ?? 487
  );
  if (!tableLayoutResult.success) return tableLayoutResult;

  const positionedResult = calculatePositions(tableLayoutResult.data);
  if (!positionedResult.success) return positionedResult;

  return applyPagination(positionedResult.data, pageHeight);
}

function applyAdobeFeatures(
  doc: PDFDocument,
  adobe: NonNullable<RenderOptions['adobe']>,
  layout: PaginatedLayout,
  xdpXml: string
): void {
  if (adobe.acroForm) {
    createAcroFormFields(doc, layout, typeof adobe.acroForm === 'object' ? adobe.acroForm : {});
  }

  if (adobe.bookmarks && adobe.bookmarks.length) {
    addBookmarks(doc, adobe.bookmarks);
  }

  if (adobe.annotations && adobe.annotations.length) {
    addAnnotations(doc, adobe.annotations);
  }

  if (adobe.layers && adobe.layers.length) {
    createLayers(doc, adobe.layers);
  }

  if (adobe.flatten === true) {
    flattenFormFields(doc);
  } else if (adobe.flatten && typeof adobe.flatten === 'object') {
    flattenFormFields(doc, adobe.flatten);
  }

  if (adobe.tabOrder) {
    setGlobalTabOrder(doc, adobe.tabOrder);
  }

  if (adobe.embedXfa) {
    embedXfaPackage(doc, xdpXml);
  }

  if (adobe.tagged) {
    markDocumentTagged(doc, typeof adobe.tagged === 'object' ? adobe.tagged : {});
  }

  if (adobe.security) {
    applyPdfSecurity(doc, adobe.security);
  }
}
