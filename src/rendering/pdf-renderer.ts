import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import {
  PaginatedLayout,
  PaginatedPage,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  RenderOptions,
  FontSpec,
} from '../types';
import { FontManager } from './font-manager';
import { embedBase64Image } from './image-embedder';
import { ERROR_CODES } from '../errors/error-codes';

/** Render the paginated layout to a PDF buffer. This is the only I/O boundary. */
export async function renderPdf(layout: PaginatedLayout, options: RenderOptions = {}): Promise<Buffer> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.create();
  } catch (e) {
    throw new Error(`${ERROR_CODES.PDF_GENERATION_FAILED.message}: ${e}`);
  }

  const fontManager = new FontManager(doc, options);

  for (const page of layout.pages) {
    const pdfPage = doc.addPage([page.medium.short, page.medium.long]);
    await renderPage(pdfPage, page, fontManager);
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

async function renderPage(
  pdfPage: PDFPage,
  page: PaginatedPage,
  fontManager: FontManager
): Promise<void> {
  const pageH = page.medium.long;

  // Render master page elements (headers, footers, logos) first
  for (const node of page.masterPageChildren) {
    await renderNode(pdfPage, node, pageH, fontManager);
  }

  // Render content
  for (const node of page.children) {
    await renderNode(pdfPage, node, pageH, fontManager);
  }
}

async function renderNode(
  pdfPage: PDFPage,
  node: LayoutNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  if (node.type === 'draw') return renderDraw(pdfPage, node, pageH, fontManager);
  if (node.type === 'field') return renderField(pdfPage, node, pageH, fontManager);
  if (node.type === 'subform') return renderSubform(pdfPage, node, pageH, fontManager);
}

async function renderSubform(
  pdfPage: PDFPage,
  node: SubformNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  for (const child of node.children) {
    await renderNode(pdfPage, child, pageH, fontManager);
  }
}

async function renderField(
  pdfPage: PDFPage,
  node: FieldNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  const pos = node.position;
  if (!pos?.x || !pos?.y) return;

  const x = pos.x;
  const y = flipY(pos.y, pos.h ?? 18, pageH);
  const fontSize = node.font?.size ?? 8;
  const font = await fontManager.getFont(node.font?.family ?? 'Helvetica', node.font?.weight);

  // Draw caption if present
  if (node.caption?.text) {
    const captionWidth = node.caption.reserve ?? 50;
    pdfPage.drawText(node.caption.text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
    void captionWidth;
  }

  // Draw field value
  const valueText = formatValue(node.resolvedValue, node.formatPicture);
  const valueX = node.caption?.reserve ? x + (node.caption.reserve ?? 0) : x;
  if (valueText) {
    pdfPage.drawText(valueText, { x: valueX, y, size: fontSize, font, color: rgb(0, 0, 0) });
  }
}

async function renderDraw(
  pdfPage: PDFPage,
  node: DrawNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  const pos = node.position;
  if (!pos?.x || !pos?.y) return;

  if (!node.value) return;

  const x = pos.x;
  const y = flipY(pos.y, pos.h ?? 18, pageH);

  if (node.value.type === 'image' && node.value.content) {
    await renderImage(pdfPage, node, x, y, pos.w ?? 72, pos.h ?? 36);
    return;
  }

  if (node.value.type === 'text' || node.value.type === 'richText') {
    const text = stripHtml(node.value.content ?? '');
    if (!text) return;
    const fontSize = node.font?.size ?? 8;
    const font = await fontManager.getFont(node.font?.family ?? 'Helvetica', node.font?.weight);
    pdfPage.drawText(text.slice(0, 500), { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
  }
}

async function renderImage(
  pdfPage: PDFPage,
  node: DrawNode,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  if (!node.value?.content) return;
  const doc = pdfPage.doc;
  try {
    const image = await embedBase64Image(doc, node.value.content, node.value.contentType ?? 'image/png');
    pdfPage.drawImage(image, { x, y: y - h, width: w, height: h });
  } catch {
    // Image failed — skip silently
  }
}

/** Flip y-coordinate from XDP (top-origin) to PDF (bottom-origin). */
function flipY(y: number, h: number, pageH: number): number {
  return pageH - y - h;
}

function formatValue(value: unknown, picture?: string): string {
  if (value == null) return '';
  void picture; // Format pattern support: future enhancement
  return String(value);
}

/** Strip HTML tags for basic rich text rendering. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
