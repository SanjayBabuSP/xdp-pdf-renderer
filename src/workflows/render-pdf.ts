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
import { FontFileNotFoundError } from '../rendering/font-manager';
import { dispatchScripts, dispatchPostLayoutScripts } from '../domain/scripting';
import { ERROR_CODES } from '../errors/error-codes';
import { normalizeLocale } from '../lib/locale-format';
import { applyAdobeExtensionLevel, applyPdfVersion } from '../adobe/pdf-catalog';
import {
  applyDocumentMetadata,
  preserveInfoOverrides,
  setNeedsRendering,
} from '../adobe/pdf-metadata';
import type { PDFDocument } from 'pdf-lib';

class RenderAbortError extends Error {}

interface RenderTiming {
  signal?: AbortSignal;
  deadline?: number;
}

function renderTiming(options: RenderOptions): RenderTiming {
  const signals: AbortSignal[] = [];
  if (options.signal !== undefined) signals.push(options.signal);
  if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
    signals.push(AbortSignal.timeout(options.timeoutMs));
  }
  if (signals.length === 0) return {};
  return {
    signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals),
    deadline: options.timeoutMs !== undefined ? Date.now() + options.timeoutMs : undefined,
  };
}

function checkAbort(timing: RenderTiming): void {
  if (
    timing.signal?.aborted === true ||
    (timing.deadline !== undefined && Date.now() >= timing.deadline)
  ) {
    throw new RenderAbortError();
  }
}

function remainingTimeout(timing: RenderTiming): number | undefined {
  return timing.deadline === undefined ? undefined : Math.max(1, timing.deadline - Date.now());
}

export async function renderFormToPdf(
  xdpXml: string,
  xsdXml: string,
  dataXml: string,
  options: RenderOptions = {}
): Promise<Result<Uint8Array>> {
  try {
    return await renderFormToPdfInner(xdpXml, xsdXml, dataXml, options);
  } catch (error) {
    if (
      error instanceof RenderAbortError ||
      (error instanceof Error && error.name === 'AbortError')
    ) {
      return failure(
        ERROR_CODES.RENDER_ABORTED.code,
        ERROR_CODES.RENDER_ABORTED.message,
        undefined,
        ERROR_CODES.RENDER_ABORTED.hint
      );
    }
    if (error instanceof FontFileNotFoundError) {
      return failure(
        ERROR_CODES.FONT_NOT_FOUND.code,
        error.message,
        undefined,
        ERROR_CODES.FONT_NOT_FOUND.hint
      );
    }
    return failure(
      ERROR_CODES.PDF_GENERATION_FAILED.code,
      `${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${String(error)}`,
      undefined,
      ERROR_CODES.PDF_GENERATION_FAILED.hint
    );
  }
}

async function renderFormToPdfInner(
  xdpXml: string,
  xsdXml: string,
  dataXml: string,
  options: RenderOptions
): Promise<Result<Uint8Array>> {
  const timing = renderTiming(options);
  checkAbort(timing);
  const parseOptions = {
    strict: options.strictValidation !== false,
    maxInputSize: options.maxInputSize,
  };
  const layoutResult = parseXdp(xdpXml, parseOptions);
  if (!layoutResult.success) return layoutResult;
  checkAbort(timing);

  const locale = normalizeLocale(options.locale ?? layoutResult.data.locale);
  const renderOptions: RenderOptions = { ...options, locale };

  const schemaResult = parseXsd(xsdXml, options.maxInputSize);
  if (!schemaResult.success) return schemaResult;
  checkAbort(timing);

  const dataResult = parseXmlData(dataXml, schemaResult.data, options.maxInputSize);
  if (!dataResult.success) return dataResult;
  checkAbort(timing);

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

  checkAbort(timing);
  const scriptConfig = {
    skipScripts: options.skipScripts === true,
    skipEvents: options.skipScriptEvents,
    strictMode: options.strictValidation !== false,
    locale,
    maxExecutionTime: remainingTimeout(timing),
  };
  const scriptResult = dispatchScripts(
    expandedResult.data,
    dataResult.data as Record<string, unknown>,
    scriptConfig
  );
  if (!scriptResult.success) return scriptResult;
  checkAbort(timing);

  resolveXfaEmbeds(scriptResult.data.layout, locale);

  const computedResult = computeLayout(
    scriptResult.data.layout,
    options.pageHeight,
    dataResult.data as Record<string, unknown>,
    locale
  );
  if (!computedResult.success) return computedResult;

  checkAbort(timing);
  const postLayoutResult = dispatchPostLayoutScripts(
    computedResult.data,
    dataResult.data as Record<string, unknown>,
    scriptConfig
  );
  if (!postLayoutResult.success) return postLayoutResult;
  checkAbort(timing);

  const finalLayout = postLayoutResult.data.layout;
  checkAbort(timing);

  try {
    const fontEquateRules = layoutResult.data.config?.fontEquateRules;
    const { buffer: pdfBuffer, doc } = await renderPdfWithDoc(
      finalLayout,
      renderOptions,
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
      await applyAdobeFeatures(doc, options.adobe, finalLayout, xdpXml);
      dirty = true;
    }

    if (dirty) {
      const saveOptions = options.adobe?.security ? { useObjectStreams: false } : {};
      const finalBytes = await doc.save(saveOptions);
      return success(finalBytes);
    }

    return success(pdfBuffer);
  } catch (e) {
    return failure(
      ERROR_CODES.PDF_GENERATION_FAILED.code,
      `${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${e}`,
      undefined,
      ERROR_CODES.PDF_GENERATION_FAILED.hint
    );
  }
}

function computeLayout(
  layout: LayoutModel,
  pageHeight?: number,
  data?: Record<string, unknown>,
  locale?: string
): Result<PaginatedLayout> {
  const filteredResult = evaluateConditions(layout, data);
  if (!filteredResult.success) return filteredResult;

  const tableLayoutResult = applyTableLayouts(
    filteredResult.data,
    filteredResult.data.pages[0]?.contentArea.w ?? 487
  );
  if (!tableLayoutResult.success) return tableLayoutResult;

  const positionedResult = calculatePositions(tableLayoutResult.data, locale);
  if (!positionedResult.success) return positionedResult;

  return applyPagination(positionedResult.data, pageHeight, locale);
}

async function applyAdobeFeatures(
  doc: PDFDocument,
  adobe: NonNullable<RenderOptions['adobe']>,
  layout: PaginatedLayout,
  xdpXml: string
): Promise<void> {
  const {
    applyPdfSecurity,
    createAcroFormFields,
    markDocumentTagged,
    embedXfaPackage,
    addBookmarks,
    addAnnotations,
    createLayers,
    flattenFormFields,
    setGlobalTabOrder,
  } = await import('../adobe');

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
