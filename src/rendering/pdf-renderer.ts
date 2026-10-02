import {
  PDFDocument,
  PDFPage,
  rgb,
  grayscale,
  RGB,
  degrees,
  PDFFont,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  appendBezierCurve,
  closePath,
  fill as fillPath,
  moveTo,
  lineTo,
  setFillingRgbColor,
} from 'pdf-lib';
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
import { formatValue } from '../lib/value-format';
import { FontManager } from './font-manager';
import { embedBase64Image } from './image-embedder';
import { computeImageRect } from './image-scaler';
import { parseRichText } from './rich-text-parser';
import { breakLines, breakLinesInfo } from './text/line-breaker';
import { defaultLineAdvance, fontAscent, fontDescent, layoutLines } from './text/line-metrics';
import { measureText } from './text/measure';
import {
  layoutRunBaselines,
  layoutRunLines,
  runBlockHeight,
  type StyledRun,
} from './text/run-flow';
import {
  alignClassOf,
  horizontalOffsetX,
  justifyLine,
  mapJustH,
  mapJustV,
} from './text/justifier';
import { isVerticalRotation, normalizeRotation, rotatedAnchor } from './text/rotation';
import {
  applyPageTransparencyGroup,
  beginOpacityScope,
  endOpacityScope,
} from './pdf-lowlevel';
import { dashArrayForStyle, xfaCapToPdf, clampCornerRadius } from './border-style';
import { drawGradientFill, isGradientFill, isGray, grayLevel } from './fill-paint';
import { renderBarcode } from './barcode-renderer';
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

  const totalPages = layout.pages.length;
  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex++) {
    const page = layout.pages[pageIndex];
    const pdfPage = doc.addPage([page.medium.short, page.medium.long]);
    await renderPage(pdfPage, page, fontManager, options, pageIndex, totalPages);
  }

  const pdfBytes = await doc.save();
  return { buffer: Buffer.from(pdfBytes), doc };
}

async function renderPage(
  pdfPage: PDFPage,
  page: PaginatedPage,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex: number,
  totalPages: number,
): Promise<void> {
  const pageH = page.medium.long;

  // Render master page elements (headers, footers, logos) first
  for (const node of page.masterPageChildren) {
    await renderNode(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  }

  // Render content
  for (const node of page.children) {
    await renderNode(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  }

  // Pages containing alpha are marked as transparency groups
  // (pdfldriver:61272 FUN_19750570 sets /Group << /S /Transparency /CS /DeviceRGB >>).
  applyPageTransparencyGroup(pdfPage);
}

async function renderNode(
  pdfPage: PDFPage,
  node: LayoutNode,
  pageH: number,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex = 0,
  totalPages = 1,
): Promise<void> {
  // "invisible"/"hidden" nodes still occupy layout space but must not be drawn. "inactive"/"hidden"
  // nodes are normally already filtered out earlier (evaluateConditions); this is a defensive check.
  // In previewMode, force invisible watermark subforms to be visible.
  if (!options.previewMode) {
    if (node.presence === 'invisible' || node.presence === 'hidden' || node.presence === 'inactive') return;
  }
  if (node.type === 'draw') return renderDraw(pdfPage, node, pageH, fontManager);
  if (node.type === 'field') return renderField(pdfPage, node, pageH, fontManager);
  if (node.type === 'subform') return renderSubform(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  if (node.type === 'exclGroup') return renderExclGroup(pdfPage, node, pageH, fontManager, options);
}

async function renderSubform(
  pdfPage: PDFPage,
  node: SubformNode,
  pageH: number,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex = 0,
  totalPages = 1,
): Promise<void> {
  // drawBorderBox handles fill (incl. gradients) then edges, in one pass.
  if (node.border) drawBorderBox(pdfPage, node.border, node.position, pageH);
  for (const child of node.children) {
    await renderNode(pdfPage, child, pageH, fontManager, options, pageIndex, totalPages);
  }
}

async function renderExclGroup(
  pdfPage: PDFPage,
  node: ExclGroupNode,
  pageH: number,
  fontManager: FontManager,
  _options: RenderOptions
): Promise<void> {
  // drawBorderBox handles fill (incl. gradients) then edges, in one pass.
  if (node.border) drawBorderBox(pdfPage, node.border, node.position, pageH);
  for (const child of node.children) {
    await renderField(pdfPage, child, pageH, fontManager);
  }
}

/** Convert an XFA 0-255 RGB triple to pdf-lib's 0-1 color space.
 *
 * Gray collapse (pdfldriver:10496): when r == g == b emit DeviceGray instead
 * of DeviceRGB — saves ~5 bytes per colour operator and matches Adobe output.
 */
function toPdfColor(color?: RgbColor): RGB {
  if (!color) return rgb(0, 0, 0);
  if (isGray(color)) return grayscale(grayLevel(color)) as unknown as RGB;
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

  const fill = border.fill;
  if (fill?.color && fill.presence !== 'hidden' && fill.presence !== 'invisible') {
    const started = beginOpacityScope(pdfPage, { fill: fill.opacity });
    if (fill.fillType && isGradientFill(fill.fillType)) {
      // Gradient fill: axial/radial shading dict.
      // evidence: renderer:35845 (axial), renderer:36519 (radial), pdfldriver:40203.
      // Default c1 to white when no color2 is specified.
      const c1: RgbColor = fill.color2 ?? { r: 255, g: 255, b: 255 };
      drawGradientFill(pdfPage, fill.fillType, fill.color, c1, pos.x, y, w, h);
    } else if (border.cornerRadius && border.cornerRadius > 0) {
      const r = clampCornerRadius(border.cornerRadius, w, h);
      fillRoundedRectangle(pdfPage, pos.x, y, w, h, r, fill.color);
    } else {
      pdfPage.drawRectangle({ x: pos.x, y, width: w, height: h, color: toPdfColor(fill.color) });
    }
    endOpacityScope(pdfPage, started);
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

  // Edges are stroked in XFA order 0,2,1,3 (top, bottom, right, left) — Adobe
  // walks the edge list in exactly that sequence when stroking a rectangle
  // (designrenderer:6283 edge 0, :6348 edge 2, :6415 edge 1, then edge 3), so
  // thicker edges overlap thinner ones at the corners the same way.
  drawEdge(pdfPage, top, pos.x, y + h, pos.x + w, y + h);
  drawEdge(pdfPage, bottom, pos.x, y, pos.x + w, y);
  drawEdge(pdfPage, right, pos.x + w, y + h, pos.x + w, y);
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

  // Dash: from config-driven table (border-style.ts / adobepdf.xdc:187-191).
  // strokeTypeMultiplier = 1 (adobepdf.xdc option). evidence: pdfldriver:60525.
  const dashArray = dashArrayForStyle(edge.style, thickness);

  // Cap/join: designrenderer:6182 enum 0x50000/1/2 → PDF J 0/1/2.
  const lineCap = xfaCapToPdf(edge.cap);

  const lineOptions: Parameters<PDFPage['drawLine']>[0] = {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    thickness,
    color: toPdfColor(edge.color),
    lineCap,
  };

  if (dashArray) {
    lineOptions.dashArray = dashArray;
  }

  const started = beginOpacityScope(pdfPage, { stroke: edge.opacity });
  pdfPage.drawLine(lineOptions);
  endOpacityScope(pdfPage, started);
}

/**
 * Dash ratios from adobepdf.xdc:187-191 (`solid 1 0`, `dotted 1 2`,
 * `dashed 4 2`, `dashDot 3 2 1 2`, `dashDotDot 3 2 1 2 1 2`).
 * Moved to border-style.ts; this const is kept for reference only.
 * @deprecated Use dashArrayForStyle() from border-style.ts.
 */
// DASH_PATTERNS removed — now driven by border-style.ts (Phase 5).

/** Fill a rounded rectangle with the current fill colour (corner radius clamped to half the box). */
function fillRoundedRectangle(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  color: RgbColor
): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const k = 0.5523 * r;
  const { r: red, g: green, b: blue } = color;
  const operators = [setFillingRgbColor(red / 255, green / 255, blue / 255), moveTo(x + r, y)];
  if (r === 0) {
    operators.push(lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h), closePath(), fillPath());
  } else {
    operators.push(
      lineTo(x + w - r, y),
      appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
      lineTo(x + w, y + h - r),
      appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
      lineTo(x + r, y + h),
      appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
      lineTo(x, y + r),
      appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
      closePath(),
      fillPath()
    );
  }
  pdfPage.pushOperators(...operators);
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
  // JustH/JustV codes — para@hAlign wins, textEdit hAlign is the fallback
  // (flow-engine.ts:15 reads the same pair for box alignment).
  const justH = mapJustH(node.para?.hAlign ?? node.ui?.hAlign);
  const valueAlign = alignClassOf(justH);
  const justV = mapJustV(node.para?.vAlign ?? node.ui?.vAlign);
  const verticalAlign: 'top' | 'middle' | 'bottom' =
    justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';

  // Handle special UI types
  if (node.ui?.type === 'checkButton') {
    return renderCheckButton(pdfPage, node, pos.x, flipY(pos.y, height, pageH), pos.w ?? 0, height, fontSize, fontManager, fontColor);
  }

  if (node.border) drawBorderBox(pdfPage, node.border, pos, pageH);

  const rotate = normalizeRotation(node.position?.rotate ?? 0);
  const rotation = rotate !== 0 ? degrees(rotate) : undefined;
  const verticalRot = isVerticalRotation(rotate);
  const innerBox = { x, y, w: width, h: innerHeight };

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

    if (verticalRot) {
      // Box swap: caption wraps along the box height (single line — the
      // reading length is the measured text length).
      const captionLen = measureTextWidth(node.caption.text, captionSize, captionFont);
      const anchor = rotatedAnchor({
        rotate,
        box: innerBox,
        align: placement === 'right' ? 'right' : valueAlign,
        valign: verticalAlign,
        lineLen: captionLen,
        ascent: fontAscent(captionFont, captionSize),
        descent: fontDescent(captionFont, captionSize),
      });
      if (anchor) {
        captionX = anchor.x;
        captionY = anchor.y;
      }
    } else {
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

    if (verticalRot) {
      // Box swap: wrap along the reading axis (box height), anchor with the
      // cross-axis offset preserving the caption reserve strip.
      const valueBox = { x: x + reserve, y, w: valueAreaWidth, h: innerHeight };
      const lines = wrapText(valueText, fontSize, innerHeight, valueFont);
      const advance = defaultLineAdvance(fontSize);
      const ascent = fontAscent(valueFont, fontSize);
      const descent = fontDescent(valueFont, fontSize);
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, valueFont)),
        0
      );
      const anchor = rotatedAnchor({
        rotate,
        box: valueBox,
        align: valueAlign,
        valign: verticalAlign,
        lineLen: longest,
        ascent,
        descent,
        advance,
        lineCount: lines.length,
      });
      if (anchor) {
        if (lines.length > 1) {
          // pdf-lib stacks joined lines in text space — correct under rotation
          pdfPage.setLineHeight(advance);
        }
        pdfPage.drawText(lines.join('\n'), {
          x: anchor.x,
          y: anchor.y,
          size: fontSize,
          font: valueFont,
          color: fontColor,
          rotate: rotation,
        });
      }
      return;
    }

    // Wrap text to fit within the value area (hard \n breaks always split)
    const measure = (s: string): number => measureTextWidth(s, fontSize, valueFont);
    const lines = breakLinesInfo(valueText, valueAreaWidth, measure);

    // First line at the top of the block, lines step downward (1.2× advance)
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + innerHeight, bottom: y },
      verticalAlign,
      valueFont
    );

    const clipped = clipOverflow(
      pdfPage,
      x + reserve,
      y,
      valueAreaWidth,
      innerHeight,
      lines.length * defaultLineAdvance(fontSize) > innerHeight + 0.5
    );

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const { text: line, paragraphEnd } = lines[i];
      const lineY = baselines[i];
      const lineWidth = measure(line);
      const baseX = x + reserve + horizontalOffsetX(justH, valueAreaWidth, lineWidth);

      // Justify/justifyAll widen the inter-word gaps (jftext:73245);
      // every other code draws the line whole at the alignment offset.
      const segments = justifyLine(line, valueAreaWidth, lineWidth, measure, {
        code: justH,
        paragraphLast: paragraphEnd,
      });

      if (segments) {
        for (const segment of segments) {
          pdfPage.drawText(segment.text, {
            x: x + reserve + segment.x,
            y: lineY,
            size: fontSize,
            font: valueFont,
            color: fontColor,
            rotate: rotation,
          });
        }
        continue;
      }

      pdfPage.drawText(line, {
        x: baseX,
        y: lineY,
        size: fontSize,
        font: valueFont,
        color: fontColor,
        rotate: rotation,
      });
    }
    endOverflowClip(pdfPage, clipped);
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
    const rotate = normalizeRotation(node.position?.rotate ?? 0);
    const rotation = rotate !== 0 ? degrees(rotate) : undefined;

    if (isVerticalRotation(rotate)) {
      // Box swap: wrap along the box height, anchor via rotation remap
      const lines = wrapText(text, fontSize, height, font);
      const advance = defaultLineAdvance(fontSize);
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, font)),
        0
      );
      const anchor = rotatedAnchor({
        rotate,
        box: { x, y, w: width, h: height },
        align: 'left',
        valign: 'top',
        lineLen: longest,
        ascent: fontAscent(font, fontSize),
        descent: fontDescent(font, fontSize),
        advance,
        lineCount: lines.length,
      });
      if (anchor) {
        if (lines.length > 1) pdfPage.setLineHeight(advance);
        pdfPage.drawText(lines.join('\n'), {
          x: anchor.x,
          y: anchor.y,
          size: fontSize,
          font,
          color: fontColor,
          rotate: rotation,
        });
      }
      return;
    }

    // Multi-line text wrapping
    const lines = wrapText(text, fontSize, width, font);
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + height, bottom: y },
      'top',
      font
    );

    const clipped = clipOverflow(
      pdfPage,
      x,
      y,
      width,
      height,
      lines.length * defaultLineAdvance(fontSize) > height + 0.5
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = baselines[i];
      pdfPage.drawText(line, { x, y: lineY, size: fontSize, font, color: fontColor, rotate: rotation });
    }
    endOverflowClip(pdfPage, clipped);
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
    const wrapWidth = width ?? 500;
    const boxH = height ?? 0;
    const lines = wrapText(text, fontSize, wrapWidth, font);
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + boxH, bottom: y },
      'top',
      font
    );

    const clipped = clipOverflow(
      pdfPage,
      x,
      y,
      wrapWidth,
      boxH,
      lines.length * defaultLineAdvance(fontSize) > boxH + 0.5
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = baselines[i];
      pdfPage.drawText(line, { x, y: lineY, size: fontSize, font, color: rgb(0, 0, 0) });
    }
    endOverflowClip(pdfPage, clipped);
    return;
  }

  const baseFontSize = node.font?.size ?? 8;
  const baseFontFamily = node.font?.family ?? 'Helvetica';
  const wrapWidth = width ?? 500;
  const boxH = height ?? 0;

  // One font per run — bold/italic/size come from the run's tags.
  const styled: StyledRun[] = [];
  for (const run of runs) {
    const font = await fontManager.getSafeFont(
      run.text,
      baseFontFamily,
      run.bold ? 'bold' : node.font?.weight,
      run.italic ? 'italic' : node.font?.posture
    );
    styled.push({ text: run.text, size: run.fontSize ?? baseFontSize, font, color: run.color });
  }

  const lines = layoutRunLines(styled, {
    maxWidth: wrapWidth,
    baseSize: baseFontSize,
    measure: (text, run) => measureText(text, styled[run].size, styled[run].font),
  });

  const clipped = clipOverflow(
    pdfPage,
    x,
    y,
    wrapWidth,
    boxH,
    runBlockHeight(lines) > boxH + 0.5
  );
  const baselines = layoutRunBaselines(lines, { top: y + boxH, bottom: y }, 'top');

  for (let i = 0; i < lines.length; i++) {
    const lineY = baselines[i];
    for (const segment of lines[i].segments) {
      const run = styled[segment.run];
      pdfPage.drawText(segment.text, {
        x: x + segment.x,
        y: lineY,
        size: run.size,
        font: run.font,
        color: run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color),
      });
    }
  }
  endOverflowClip(pdfPage, clipped);
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
    const image = await embedBase64Image(doc, node.value.content, node.value.contentType);

    // Aspect-ratio scaling (xfaimageservice_disasm.c:9324-9379).
    // image.width / image.height are the pixel dimensions from pdf-lib.
    const rect = computeImageRect(
      node.value.aspectMode,
      w,
      h,
      {
        pixelW: image.width,
        pixelH: image.height,
        xdpi: node.value.xdpi,
        ydpi: node.value.ydpi,
      },
      { hAlign: node.value.hAlign, vAlign: node.value.vAlign }
    );

    // y is already the bottom-left PDF coordinate; apply vertical alignment offset.
    pdfPage.drawImage(image, {
      x: x + rect.offsetX,
      y: y + rect.offsetY,
      width: rect.drawW,
      height: rect.drawH,
    });
  } catch {
    // Image decode/embed failed — skip silently (matches Adobe behaviour on
    // corrupt or unsupported images).
  }
}

/** Flip y-coordinate from XDP (top-origin) to PDF (bottom-origin). */
function flipY(y: number, h: number, pageH: number): number {
  return pageH - y - h;
}

export { formatValue } from '../lib/value-format';

/** Strip HTML tags for basic rich text rendering. */
/**
 * Overflow clip — only when content exceeds the frame (jftext:144269);
 * no autoSize, no clip when merely fitting. Suppressed for rotated fields
 * (designrenderer:7755).
 */
function clipOverflow(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  exceeds: boolean
): boolean {
  if (!exceeds) return false;
  pdfPage.pushOperators(
    pushGraphicsState(),
    rectangle(x, y, w, h),
    clip(),
    endPath()
  );
  return true;
}

function endOverflowClip(pdfPage: PDFPage, active: boolean): void {
  if (active) pdfPage.pushOperators(popGraphicsState());
}

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
  return measureText(text, fontSize, font);
}

/** Wrap text into lines that fit within the given width. */
function wrapText(text: string, fontSize: number, maxWidth: number, font?: PDFFont): string[] {
  if (!text) return [text];
  if (maxWidth <= 0) return text.split(/\r\n|\r|\n/);
  return breakLines(text, maxWidth, (s) => measureTextWidth(s, fontSize, font));
}
