import { PDFDocument, PDFPage, rgb, RGB, degrees, PDFFont } from 'pdf-lib';
import {
  PaginatedLayout,
  PaginatedPage,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  ExclGroupNode,
  RenderOptions,
  BorderSpec,
  RgbColor,
  FontEquateRule,
  MarginSpec,
} from '../types';
import { FontManager } from './font-manager';
import { embedBase64Image } from './image-embedder';
import { parseRichText } from './rich-text-parser';
import { ERROR_CODES } from '../errors/error-codes';

/** Render the paginated layout to a PDF buffer. This is the only I/O boundary. */
export async function renderPdf(
  layout: PaginatedLayout,
  options: RenderOptions = {},
  fontEquateRules?: FontEquateRule[]
): Promise<Buffer> {
  const result = await renderPdfWithDoc(layout, options, fontEquateRules);
  return result.buffer;
}

/**
 * Render the paginated layout to a PDF buffer AND return the PDFDocument.
 * Used when post-processing (security, bookmarks, etc.) is needed.
 */
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

  for (const page of layout.pages) {
    const pdfPage = doc.addPage([page.medium.short, page.medium.long]);
    await renderPage(pdfPage, page, fontManager, options);
  }

  const pdfBytes = await doc.save();
  return { buffer: Buffer.from(pdfBytes), doc };
}

async function renderPage(
  pdfPage: PDFPage,
  page: PaginatedPage,
  fontManager: FontManager,
  options: RenderOptions
): Promise<void> {
  const pageH = page.medium.long;

  // Render master page elements (headers, footers, logos) first
  for (const node of page.masterPageChildren) {
    await renderNode(pdfPage, node, pageH, fontManager, options);
  }

  // Render content
  for (const node of page.children) {
    await renderNode(pdfPage, node, pageH, fontManager, options);
  }
}

async function renderNode(
  pdfPage: PDFPage,
  node: LayoutNode,
  pageH: number,
  fontManager: FontManager,
  options: RenderOptions
): Promise<void> {
  // "invisible"/"hidden" nodes still occupy layout space but must not be drawn. "inactive"/"hidden"
  // nodes are normally already filtered out earlier (evaluateConditions); this is a defensive check.
  // In previewMode, force invisible watermark subforms to be visible.
  if (!options.previewMode) {
    if (node.presence === 'invisible' || node.presence === 'hidden' || node.presence === 'inactive') return;
  }
  if (node.type === 'draw') return renderDraw(pdfPage, node, pageH, fontManager);
  if (node.type === 'field') return renderField(pdfPage, node, pageH, fontManager);
  if (node.type === 'subform') return renderSubform(pdfPage, node, pageH, fontManager, options);
  if (node.type === 'exclGroup') return renderExclGroup(pdfPage, node, pageH, fontManager, options);
}

async function renderSubform(
  pdfPage: PDFPage,
  node: SubformNode,
  pageH: number,
  fontManager: FontManager,
  options: RenderOptions
): Promise<void> {
  // Draw fill BEFORE children so it appears as a background
  if (node.border?.fill?.color && node.border.fill.presence !== 'hidden' && node.border.fill.presence !== 'invisible') {
    drawBorderBox(pdfPage, node.border, node.position, pageH);
  }
  // Draw border edges (but skip fill since we already drew it above)
  if (node.border) {
    drawBorderEdges(pdfPage, node.border, node.position, pageH);
  }
  for (const child of node.children) {
    await renderNode(pdfPage, child, pageH, fontManager, options);
  }
}

async function renderExclGroup(
  pdfPage: PDFPage,
  node: ExclGroupNode,
  pageH: number,
  fontManager: FontManager,
  _options: RenderOptions
): Promise<void> {
  // Draw fill BEFORE children so it appears as a background
  if (node.border?.fill?.color && node.border.fill.presence !== 'hidden' && node.border.fill.presence !== 'invisible') {
    drawBorderBox(pdfPage, node.border, node.position, pageH);
  }
  if (node.border) {
    drawBorderEdges(pdfPage, node.border, node.position, pageH);
  }
  for (const child of node.children) {
    await renderField(pdfPage, child, pageH, fontManager);
  }
}

/** Convert an XFA 0-255 RGB triple to pdf-lib's 0-1 color space. */
function toPdfColor(color?: RgbColor): RGB {
  if (!color) return rgb(0, 0, 0);
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

/** Draw a border's fill and/or stroked edges around a node's absolute position box. */
function drawBorderBox(
  pdfPage: PDFPage,
  border: BorderSpec,
  pos: { x?: number; y?: number; w?: number; h?: number } | undefined,
  pageH: number
): void {
  if (border.presence === 'hidden' || border.presence === 'invisible' || border.presence === 'inactive') return;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return;
  const y = flipY(pos.y, h, pageH);

  if (border.fill?.color && border.fill.presence !== 'hidden' && border.fill.presence !== 'invisible') {
    if (border.cornerRadius && border.cornerRadius > 0) {
      pdfPage.drawRectangle({
        x: pos.x,
        y,
        width: w,
        height: h,
        color: toPdfColor(border.fill.color),
        borderWidth: 0,
      });
    } else {
      pdfPage.drawRectangle({ x: pos.x, y, width: w, height: h, color: toPdfColor(border.fill.color) });
    }
  }

  drawBorderEdges(pdfPage, border, pos, pageH);
}

/** Draw only the border edges (not fill). Used when fill is drawn separately before children. */
function drawBorderEdges(
  pdfPage: PDFPage,
  border: BorderSpec,
  pos: { x?: number; y?: number; w?: number; h?: number } | undefined,
  pageH: number
): void {
  if (border.presence === 'hidden' || border.presence === 'invisible' || border.presence === 'inactive') return;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return;
  const y = flipY(pos.y, h, pageH);

  const edges = border.edges ?? [];
  if (edges.length === 0) return;
  const [top, right, bottom, left] =
    edges.length === 1 ? [edges[0], edges[0], edges[0], edges[0]] : [edges[0], edges[1], edges[2], edges[3]];

  drawEdge(pdfPage, top, pos.x, y + h, pos.x + w, y + h);
  drawEdge(pdfPage, right, pos.x + w, y + h, pos.x + w, y);
  drawEdge(pdfPage, bottom, pos.x, y, pos.x + w, y);
  drawEdge(pdfPage, left, pos.x, y + h, pos.x, y);
}

function drawEdge(
  pdfPage: PDFPage,
  edge: import('../types').EdgeSpec | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  if (!edge || edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return;
  const thickness = edge.thickness ?? 0.5;
  if (thickness <= 0) return;

  const lineOptions: Parameters<PDFPage['drawLine']>[0] = {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color: toPdfColor(edge.color),
  };

  // Apply dash patterns from Designer.xdc <lineStyle> bit patterns
  // (solid=1.0, dotted=1.2, dashed=4.2, dashDot=3.2.1.2, dashDotDot=3.2.1.2.1.2)
  switch (edge.style) {
    case 'dashed':
      lineOptions.dashArray = [thickness * 4, thickness * 2];
      break;
    case 'dotted':
      lineOptions.dashArray = [thickness, thickness * 2];
      break;
    case 'dashDot':
      lineOptions.dashArray = [thickness * 3, thickness * 2, thickness, thickness * 2];
      break;
    case 'dashDotDot':
      lineOptions.dashArray = [thickness * 3, thickness * 2, thickness, thickness * 2, thickness, thickness * 2];
      break;
  }

  pdfPage.drawLine(lineOptions);
}

export interface FieldTextLayout {
  captionX: number;
  captionY: number;
  valueX: number;
  valueY: number;
}

export function computeFieldTextLayout(options: {
  x: number;
  y?: number;
  width?: number;
  height?: number;
  reserve?: number;
  captionText?: string;
  captionPlacement?: 'left' | 'right' | 'top' | 'bottom' | 'inline';
  valueText?: string;
  valueAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  fontSize?: number;
}): FieldTextLayout {
  const x = options.x;
  const width = options.width ?? 0;
  const height = options.height ?? 18;
  const reserve = options.reserve ?? 0;
  const fontSize = options.fontSize ?? 8;
  const y = options.y ?? height + fontSize;
  const captionText = options.captionText ?? '';
  const valueText = options.valueText ?? '';
  const valueAlign = options.valueAlign ?? 'left';
  const verticalAlign = options.verticalAlign ?? 'top';
  const placement = options.captionPlacement ?? 'left';
  const textOffset = Math.max((height - fontSize) / 2, 0);
  const verticalY = verticalAlign === 'middle' ? y + textOffset : y;

  let captionX = x;
  let captionYFinal = verticalY;
  let valueAreaStart = x + reserve;
  let valueAreaWidth = Math.max(width - reserve, 0);

  if (placement === 'right') {
    // Caption on the right, value on the left
    valueAreaStart = x;
    valueAreaWidth = Math.max(width - reserve, 0);
    captionX = x + valueAreaWidth;
  } else if (placement === 'top') {
    // Caption above the value
    captionX = x;
    captionYFinal = verticalY + fontSize + 2;
    valueAreaStart = x;
    valueAreaWidth = width;
  } else if (placement === 'bottom') {
    // Caption below the value
    captionX = x;
    captionYFinal = verticalY - fontSize - 2;
    valueAreaStart = x;
    valueAreaWidth = width;
  } else if (placement === 'inline') {
    // Caption inline (no reserve, caption prefix)
    captionX = x;
    valueAreaStart = captionText ? x + captionText.length * fontSize * 0.6 : x;
    valueAreaWidth = Math.max(width - (valueAreaStart - x), 0);
  }

  const rawTextWidth = valueText.length * fontSize;
  const rightAlignedX = valueAreaStart + Math.max(valueAreaWidth - rawTextWidth, 0);
  const centeredX = valueAreaStart + Math.max((valueAreaWidth - rawTextWidth) / 2, 0);

  let valueX = valueAreaStart;
  if (valueAlign === 'right') valueX = rightAlignedX;
  if (valueAlign === 'center') valueX = centeredX;

  const captionXForDraw = captionText ? captionX : x;
  return {
    captionX: captionXForDraw,
    captionY: captionYFinal,
    valueX,
    valueY: verticalY,
  };
}

async function renderField(
  pdfPage: PDFPage,
  node: FieldNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  const pos = node.position;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const margins = getMargins(node.margin);
  const x = pos.x + margins.left;
  const width = Math.max((pos.w ?? 0) - margins.left - margins.right, 0);
  const height = pos.h ?? 18;
  const y = flipY(pos.y, height, pageH) + margins.bottom;
  const innerHeight = Math.max(height - margins.top - margins.bottom, 0);
  const fontSize = node.font?.size ?? 8;
  const fontColor = toPdfColor(node.font?.color);
  const valueText = formatValue(node.resolvedValue, node.formatPicture);
  const valueAlign = (node.para?.hAlign as 'left' | 'center' | 'right') ?? 'left';
  const verticalAlign = (node.para?.vAlign as 'top' | 'middle' | 'bottom') ?? 'top';

  // Handle special UI types
  if (node.ui?.type === 'checkButton') {
    return renderCheckButton(pdfPage, node, pos.x, flipY(pos.y, height, pageH), pos.w ?? 0, height, fontSize, fontManager, fontColor);
  }

  if (node.border) drawBorderBox(pdfPage, node.border, pos, pageH);

  const rotateVal = node.position?.rotate ?? 0;
  const rotation = rotateVal !== 0 ? degrees(rotateVal) : undefined;

  const reserve = node.caption?.reserve ?? 0;

  // Draw caption if present
  if (node.caption?.text) {
    const captionFont = node.caption.font
      ? await fontManager.getSafeFont(
          node.caption.text,
          node.caption.font.family ?? 'Helvetica',
          node.caption.font.weight,
          node.caption.font.posture
        )
      : await fontManager.getFont(node.font?.family ?? 'Helvetica', node.font?.weight, node.font?.posture);
    const captionSize = node.caption.font?.size ?? fontSize;
    const captionColor = toPdfColor(node.caption.font?.color);
    const placement = node.caption?.placement ?? 'left';
    let captionX = x;
    let captionY = y;

    if (placement === 'left' || placement === 'right') {
      // Vertical centering for left/right captions
      const textOffset = Math.max((innerHeight - captionSize) / 2, 0);
      captionY = y + (verticalAlign === 'bottom' ? textOffset : verticalAlign === 'middle' ? textOffset : innerHeight - captionSize - textOffset);
    } else if (placement === 'top') {
      captionY = y + innerHeight - captionSize;
    } else if (placement === 'bottom') {
      captionY = y;
    } else if (placement === 'inline') {
      captionY = y + innerHeight - captionSize;
    }

    if (placement === 'right') {
      captionX = x + width - reserve;
    }

    pdfPage.drawText(node.caption.text, {
      x: captionX,
      y: captionY,
      size: captionSize,
      font: captionFont,
      color: captionColor,
      rotate: rotation,
    });
  }

  // Draw field value with multi-line wrapping
  if (valueText) {
    const valueFont = await fontManager.getSafeFont(
      valueText,
      node.font?.family ?? 'Helvetica',
      node.font?.weight,
      node.font?.posture
    );
    const valueAreaWidth = Math.max(width - reserve, 0);
    const lineHeight = fontSize * 1.4;

    // Wrap text to fit within the value area
    const lines = wrapText(valueText, fontSize, valueAreaWidth, valueFont);

    // Calculate vertical position based on alignment
    const totalTextHeight = lines.length * lineHeight;
    let startY: number;
    if (verticalAlign === 'middle') {
      startY = y + (innerHeight - totalTextHeight) / 2;
    } else if (verticalAlign === 'bottom') {
      startY = y;
    } else {
      startY = y + innerHeight - totalTextHeight;
    }

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = startY + i * lineHeight;
      const lineWidth = measureTextWidth(line, fontSize, valueFont);

      let valueX: number;
      if (valueAlign === 'right') {
        valueX = x + reserve + valueAreaWidth - lineWidth;
      } else if (valueAlign === 'center') {
        valueX = x + reserve + (valueAreaWidth - lineWidth) / 2;
      } else {
        valueX = x + reserve;
      }

      pdfPage.drawText(line, {
        x: valueX,
        y: lineY,
        size: fontSize,
        font: valueFont,
        color: fontColor,
        rotate: rotation,
      });
    }
  }
}

async function renderCheckButton(
  pdfPage: PDFPage,
  node: FieldNode,
  x: number,
  y: number,
  _width: number,
  height: number,
  fontSize: number,
  fontManager: FontManager,
  fontColor: RGB
): Promise<void> {
  const checked = String(node.resolvedValue) === (node.ui?.checkedValue ?? '1');
  const checkChar = checked ? '☑' : '☐';
  const textOffset = Math.max((height - fontSize) / 2, 0);
  const family = node.font?.family ?? 'Helvetica';
  const weight = node.font?.weight;
  const posture = node.font?.posture;

  // The checkmark glyph (U+2611/U+2610) is not WinAnsi — getSafeFont falls back
  // to the embedded Unicode font so drawing never throws.
  const font = await fontManager.getSafeFont(checkChar, family, weight, posture);

  // Draw the check indicator
  pdfPage.drawText(checkChar, {
    x,
    y: y + textOffset,
    size: fontSize,
    font,
    color: fontColor,
  });

  // Draw caption next to checkbox
  if (node.caption?.text) {
    const captionFont = await fontManager.getSafeFont(node.caption.text, family, weight, posture);
    pdfPage.drawText(node.caption.text, {
      x: x + fontSize * 1.5,
      y: y + textOffset,
      size: fontSize,
      font: captionFont,
      color: fontColor,
    });
  }
}

async function renderDraw(
  pdfPage: PDFPage,
  node: DrawNode,
  pageH: number,
  fontManager: FontManager
): Promise<void> {
  const pos = node.position;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const margins = getMargins(node.margin);
  const x = pos.x + margins.left;
  const y = flipY(pos.y, pos.h ?? 18, pageH) + margins.bottom;
  const width = Math.max((pos.w ?? 0) - margins.left - margins.right, 0);
  const height = Math.max((pos.h ?? 18) - margins.top - margins.bottom, 0);

  if (node.border) drawBorderBox(pdfPage, node.border, pos, pageH);

  if (!node.value) return;

  if (node.value.type === 'image' && node.value.content) {
    await renderImage(pdfPage, node, x, y - height, width, height);
    return;
  }

  if (node.value.type === 'rectangle' || node.value.type === 'line') {
    if (node.value.shapeBorder) drawBorderBox(pdfPage, node.value.shapeBorder, pos, pageH);
    return;
  }

  if (node.value.type === 'arc' || node.value.type === 'circle') {
    renderArcOrCircle(pdfPage, node, x, y, width, height);
    return;
  }

  if (node.value.type === 'richText') {
    await renderRichText(pdfPage, node, x, y, fontManager, width, height);
    return;
  }

  if (node.value.type === 'text') {
    const text = stripHtml(node.value.content ?? '');
    if (!text) return;
    const fontSize = node.font?.size ?? 8;
    const fontColor = toPdfColor(node.font?.color);
    const font = await fontManager.getSafeFont(
      text,
      node.font?.family ?? 'Helvetica',
      node.font?.weight,
      node.font?.posture
    );
    const rotateVal = node.position?.rotate ?? 0;
    const rotation = rotateVal !== 0 ? degrees(rotateVal) : undefined;

    // Multi-line text wrapping
    const lineHeight = fontSize * 1.4;
    const lines = wrapText(text, fontSize, width, font);
    const totalTextHeight = lines.length * lineHeight;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = y + height - totalTextHeight + i * lineHeight;
      pdfPage.drawText(line, { x, y: lineY, size: fontSize, font, color: fontColor, rotate: rotation });
    }
  }
}

function renderArcOrCircle(
  pdfPage: PDFPage,
  node: DrawNode,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y; // already flipped

  const borderColor = node.value?.shapeBorder?.edges?.[0]?.color;
  const fillColor = node.value?.shapeBorder?.fill?.color;
  const thickness = node.value?.shapeBorder?.edges?.[0]?.thickness ?? 1;

  pdfPage.drawEllipse({
    x: cx,
    y: cy,
    xScale: rx,
    yScale: ry,
    color: fillColor ? toPdfColor(fillColor) : undefined,
    borderColor: toPdfColor(borderColor),
    borderWidth: thickness,
  });
}

async function renderRichText(
  pdfPage: PDFPage,
  node: DrawNode,
  x: number,
  y: number,
  fontManager: FontManager,
  width?: number,
  height?: number
): Promise<void> {
  const content = node.value?.content ?? '';
  const runs = parseRichText(content);

  if (runs.length === 0) {
    // Fallback to plain text
    const text = stripHtml(content);
    if (!text) return;
    const fontSize = node.font?.size ?? 8;
    const font = await fontManager.getSafeFont(
      text,
      node.font?.family ?? 'Helvetica',
      node.font?.weight,
      node.font?.posture
    );
    const lineHeight = fontSize * 1.4;
    const wrapWidth = width ?? 500;
    const lines = wrapText(text, fontSize, wrapWidth, font);
    const totalTextHeight = lines.length * lineHeight;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = y + (height ?? 0) - totalTextHeight + i * lineHeight;
      pdfPage.drawText(line, { x, y: lineY, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    return;
  }

  let currentX = x;
  let currentY = y + (height ?? 0) - (runs[0]?.fontSize ?? node.font?.size ?? 8);
  const baseFontSize = node.font?.size ?? 8;
  const baseFontFamily = node.font?.family ?? 'Helvetica';
  const wrapWidth = width ?? 500;

  for (const run of runs) {
    if (run.text === '\n') {
      currentX = x;
      currentY -= (run.fontSize ?? baseFontSize) * 1.4;
      continue;
    }

    const runFontSize = run.fontSize ?? baseFontSize;
    const runWeight = run.bold ? 'bold' : node.font?.weight;
    const runPosture = run.italic ? 'italic' : node.font?.posture;
    const font = await fontManager.getSafeFont(run.text, baseFontFamily, runWeight, runPosture);
    const color = run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color);

    // Simple line breaking for rich text
    const availableWidth = wrapWidth - (currentX - x);
    const runWidth = measureTextWidth(run.text, runFontSize, font);

    if (runWidth > availableWidth && availableWidth < wrapWidth * 0.5) {
      // Move to next line if we can't fit even a small portion
      currentX = x;
      currentY -= runFontSize * 1.4;
    }

    pdfPage.drawText(run.text, {
      x: currentX,
      y: currentY,
      size: runFontSize,
      font,
      color,
    });

    // Advance x position
    currentX += runWidth;
    if (currentX > x + wrapWidth) {
      currentX = x;
      currentY -= runFontSize * 1.4;
    }
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
    // y is already the bottom-left PDF coordinate (caller computed flipY - height)
    pdfPage.drawImage(image, { x, y, width: w, height: h });
  } catch {
    // Image failed — skip silently
  }
}

/** Flip y-coordinate from XDP (top-origin) to PDF (bottom-origin). */
function flipY(y: number, h: number, pageH: number): number {
  return pageH - y - h;
}

export function formatValue(value: unknown, picture?: string): string {
  if (value == null) return '';
  if (!picture) return String(value);

  const pattern = picture.trim();
  if (looksLikeDatePattern(pattern)) {
    return formatDateValue(value, pattern);
  }

  if (looksLikeNumberPattern(pattern)) {
    return formatNumberValue(value, pattern);
  }

  return String(value);
}

function looksLikeDatePattern(pattern: string): boolean {
  const upper = pattern.toLowerCase();
  return /(y|m|d)/.test(upper) && (upper.includes('y') || upper.includes('d'));
}

function looksLikeNumberPattern(pattern: string): boolean {
  return /[0#]/.test(pattern) && !/[a-z]/i.test(pattern);
}

function formatDateValue(value: unknown, pattern: string): string {
  const date = coerceDate(value);
  if (!date) return String(value);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const replacements: Record<string, string> = {
    yyyy: String(year),
    yy: String(year).slice(-2),
    mm: String(month).padStart(2, '0'),
    m: String(month),
    dd: String(day).padStart(2, '0'),
    d: String(day),
  };

  let formatted = pattern;
  for (const [token, replacement] of Object.entries(replacements)) {
    formatted = formatted.replace(new RegExp(token, 'g'), replacement);
  }

  return formatted;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatNumberValue(value: unknown, pattern: string): string {
  const number = coerceNumber(value);
  if (number === null) return String(value);

  const mask = pattern.replace(/\s+/g, '');
  const prefix = mask.match(/^[^0-9#.,%]+/)?.[0] ?? '';
  const suffix = mask.match(/[^0-9#.,%]+$/)?.[0] ?? '';
  const digitsMask = mask.slice(prefix.length, mask.length - suffix.length);
  const hasDecimal = digitsMask.includes('.');
  const decimalPlaces = hasDecimal ? digitsMask.split('.')[1]?.replace(/[^0#]/g, '').length ?? 0 : 0;
  const hasGrouping = digitsMask.includes(',');

  const absValue = Math.abs(number);
  const rounded = absValue.toFixed(decimalPlaces);
  const [wholeRaw, fractionRaw = ''] = rounded.split('.');

  let whole = wholeRaw;
  if (hasGrouping) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const sign = number < 0 ? '-' : '';
  const numeric = hasDecimal ? `${whole}.${fractionRaw}` : whole;
  return `${prefix}${sign}${numeric}${suffix}`;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const compact = normalized.replace(/[$€£¥₹,\s]/g, '').replace(/%/g, '');
    const parsed = Number(compact);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Strip HTML tags for basic rich text rendering. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Get effective margins from margin spec (handles MarginSpec or individual values). */
function getMargins(margin?: MarginSpec): { top: number; right: number; bottom: number; left: number } {
  if (!margin) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: margin.topInset ?? 0,
    right: margin.rightInset ?? 0,
    bottom: margin.bottomInset ?? 0,
    left: margin.leftInset ?? 0,
  };
}

/** Measure approximate text width using font metrics (0.5 * fontSize is rough avg). */
function measureTextWidth(text: string, fontSize: number, font?: PDFFont): number {
  // Use pdf-lib font widthOfTextAtSize for accurate measurement when possible
  if (font && typeof font.widthOfTextAtSize === 'function') {
    try {
      return font.widthOfTextAtSize(text, fontSize);
    } catch {
      // Fall back to approximation
    }
  }
  // Approximate: average character width ~0.5 * fontSize for most fonts
  return text.length * fontSize * 0.5;
}

/** Wrap text into lines that fit within the given width. */
function wrapText(text: string, fontSize: number, maxWidth: number, font?: PDFFont): string[] {
  if (maxWidth <= 0 || !text) return [text];
  const words = text.split(/(\s+)/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine + word;
    const testWidth = measureTextWidth(testLine, fontSize, font);
    if (testWidth > maxWidth && currentLine.trim()) {
      lines.push(currentLine.trimEnd());
      currentLine = word.trimStart();
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine.trim()) {
    lines.push(currentLine.trimEnd());
  }
  return lines.length > 0 ? lines : [text];
}
