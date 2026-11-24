import { PDFDocument } from 'pdf-lib';
import type { FontEquateRule, PaginatedLayout, RenderOptions } from '../types';
import { ERROR_CODES } from '../errors/error-codes';
import { FontManager } from './font-manager';
import { dedupePageFontResources } from './pdf-lowlevel';
import { renderPage } from './pdf-renderer/subform';

export async function renderPdf(
  layout: PaginatedLayout,
  options: RenderOptions = {},
  fontEquateRules?: FontEquateRule[]
): Promise<Buffer> {
  const result = await renderPdfWithDoc(layout, options, fontEquateRules);
  return result.buffer;
}

export async function renderPdfWithDoc(
  layout: PaginatedLayout,
  options: RenderOptions = {},
  fontEquateRules?: FontEquateRule[]
): Promise<{ buffer: Buffer; doc: PDFDocument }> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.create();
  } catch (e) {
    throw new Error(`${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${e}`);
  }

  const fontManager = new FontManager(doc, options, fontEquateRules);
  await fontManager.preload();

  const totalPages = layout.pages.length;
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex++) {
    const page = layout.pages[pageIndex];
    const pdfPage = doc.addPage([page.medium.short, page.medium.long]);
    dedupePageFontResources(pdfPage);
    await renderPage(pdfPage, page, fontManager, options, pageIndex, totalPages);
  }

  const pdfBytes = await doc.save();
  return { buffer: Buffer.from(pdfBytes), doc };
}

export { formatValue } from '../lib/value-format';
