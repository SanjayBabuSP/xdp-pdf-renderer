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
  // `maxInputSize` bounds every XML input; `strictValidation` also enforces the
  // XFA template version (G16 — xfa-namespace-validation).
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

  // ── Phase 2: Validate ───────────────────────────────────────────────────
  const structureValid = validateXdpStructure(layoutResult.data);
  if (!structureValid.success) return structureValid;

  const schemaValid = validateDataAgainstSchema(dataResult.data, schemaResult.data, {
    strict: options.strictValidation !== false,
  });
  if (!schemaValid.success) return schemaValid;

  const bindingsValid = validateBindings(layoutResult.data, schemaResult.data, {
    strict: options.strictValidation !== false,
  });
  if (!bindingsValid.success) return bindingsValid;

  // ── Phase 3: Map data to layout ─────────────────────────────────────────
  const resolvedResult = resolveBindings(layoutResult.data, dataResult.data);
  if (!resolvedResult.success) return resolvedResult;

  const expandedResult = expandRepeats(resolvedResult.data, dataResult.data);
  if (!expandedResult.success) return expandedResult;

  // ── Phase 3a: Execute XFA scripts (pre-layout lifecycle) ──────────────
  // Adobe order: ready($form) → initialize(+indexChange) → calculate →
  // validate → overlay → ready($layout). All of these run inside/around
  // XFAFormLayout::ready BEFORE positions are committed, so we run them
  // before layout; the first layout pass then sees the script results
  // (Adobe's equivalent is the post-ready relayout at
  // xfalayout_disasm.c:56820).
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

  // ── Phase 3a2: Inline `xfa:embed` resolution ───────────────────────────
  // Unit labels and other text live on presence="hidden" floatingFields that
  // are pulled into a visible <draw> through exData `xfa:embed="#id"`.
  // Resolve them here — after scripts (so hidden fields already hold their
  // data/script values) and before evaluateConditions (which drops hidden
  // nodes and would otherwise take the references with them).
  resolveXfaEmbeds(scriptResult.data.layout);

  // ── Phase 3b: Layout ────────────────────────────────────────────────────
  const computedResult = computeLayout(
    scriptResult.data.layout,
    options.pageHeight,
    dataResult.data as Record<string, unknown>
  );
  if (!computedResult.success) return computedResult;

  // ── Phase 3c: docReady — AFTER layout, BEFORE rendering ─────────────────
  // evidence: XFAPresentationAgent::startRecord fires getString(0x4b000c)
  // ="docReady" (xfapresentationagent_disasm.c:20726) between layoutRecord
  // and renderRecord (xfapresentationagent_disasm.c:13257-13261). Runs
  // against the paginated tree (the nodes the renderer walks).
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

  // ── Phase 5: Render PDF (I/O) ───────────────────────────────────────────
  try {
    const fontEquateRules = layoutResult.data.config?.fontEquateRules;
    const { buffer: pdfBuffer, doc } = await renderPdfWithDoc(
      finalLayout,
      options,
      fontEquateRules
    );

    // ── Phase 5a0: Adobe metadata block (G18) ───────────────────────────
    preserveInfoOverrides(doc, {
      producer: options.adobe?.metadata?.producer,
      creatorTool: options.adobe?.metadata?.creatorTool,
    });
    applyDocumentMetadata(doc, layoutResult.data.metadata, {
      producer: options.adobe?.metadata?.producer,
      creatorTool: options.adobe?.metadata?.creatorTool,
    });
    // Adobe's createAcroFormDict sets /NeedsRendering for XFA forms
    // (pdfldriver_disasm.c:1729) when the form is dynamic.
    if (options.adobe?.acroForm || options.adobe?.embedXfa) {
      setNeedsRendering(doc);
    }

    // ── Phase 5a: Apply catalog metadata from <config> (G16) ─────────────
    const config = layoutResult.data.config;
    // The metadata block always mutates doc (Info + XMP stream) → re-save.
    let dirty = true;
    if (config?.pdfVersion) {
      applyPdfVersion(doc, config.pdfVersion);
      dirty = true;
    }
    if (config?.adobeExtensionLevel) {
      applyAdobeExtensionLevel(doc, config.adobeExtensionLevel, config.pdfVersion ?? '1.7');
      dirty = true;
    }

    // ── Phase 5b: Apply Adobe-specific post-processing ─────────────────
    if (options.adobe) {
      applyAdobeFeatures(doc, options.adobe, finalLayout, xdpXml);
      dirty = true;
    }

    if (dirty) {
      // Encryption is applied before serialization; pdf-lib builds object
      // streams during serialization (after encryption), so disable them.
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

/**
 * Compute layout from a (possibly script-mutated) layout tree:
 * conditions → table layout → positions → pagination.
 */
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

/**
 * Apply Adobe-specific PDF features after rendering.
 */
function applyAdobeFeatures(
  doc: PDFDocument,
  adobe: NonNullable<RenderOptions['adobe']>,
  layout: PaginatedLayout,
  xdpXml: string,
): void {
  // Interactive AcroForm widgets from the XFA template (G8). Built before
  // flattening so `flatten` can bake them back down when requested.
  if (adobe.acroForm) {
    createAcroFormFields(doc, layout, typeof adobe.acroForm === 'object' ? adobe.acroForm : {});
  }

  // Bookmarks / outlines
  if (adobe.bookmarks && adobe.bookmarks.length > 0) {
    addBookmarks(doc, adobe.bookmarks);
  }

  // Annotations
  if (adobe.annotations && adobe.annotations.length > 0) {
    addAnnotations(doc, adobe.annotations);
  }

  // Layers (OCG)
  if (adobe.layers && adobe.layers.length > 0) {
    createLayers(doc, adobe.layers);
  }

  // Form flattening
  if (adobe.flatten === true) {
    flattenFormFields(doc);
  } else if (adobe.flatten && typeof adobe.flatten === 'object') {
    flattenFormFields(doc, adobe.flatten);
  }

  // Tab ordering
  if (adobe.tabOrder) {
    setGlobalTabOrder(doc, adobe.tabOrder);
  }

  // Embed the source XDP packets into /XFA (G12).
  if (adobe.embedXfa) {
    embedXfaPackage(doc, xdpXml);
  }

  // Tagged / accessible structure tree
  if (adobe.tagged) {
    markDocumentTagged(doc, typeof adobe.tagged === 'object' ? adobe.tagged : {});
  }

  // Security / encryption LAST: it encrypts every indirect object, so it must
  // run after all other features have mutated the document.
  if (adobe.security) {
    applyPdfSecurity(doc, adobe.security);
  }
}
