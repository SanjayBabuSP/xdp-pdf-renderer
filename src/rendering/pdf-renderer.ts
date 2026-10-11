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
  stroke as strokePath,
  moveTo,
  lineTo,
  setFillingRgbColor,
  setStrokingRgbColor,
  setLineWidth,
  setLineCap,
  setLineJoin,
  setDashPattern,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  type PDFPageDrawTextOptions,
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
  EdgeSpec,
  RgbColor,
  FontEquateRule,
  MarginSpec,
} from '../types';
import { formatValue } from '../lib/value-format';
import { resolveChoiceText, resolveButtonLabel } from './ui-values';
import { FontManager } from './font-manager';
import { embedBase64Image } from './image-embedder';
import { computeImageRect } from './image-scaler';
import { parseRichText } from './rich-text-parser';
import { breakLines, breakLinesInfo } from './text/line-breaker';
import { fontAscent, fontDescent, layoutLines, paraMetrics } from './text/line-metrics';
import { measureText } from './text/measure';
import { isCondensedFamily, NARROW_SCALE } from './standard-fonts';
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
  dedupePageFontResources,
  endOpacityScope,
} from './pdf-lowlevel';
import {
  DEFAULT_EDGE_THICKNESS_PT,
  clampCornerRadius,
  dashArrayForStyle,
  quantizeStrokeWidth,
  xfaCapToPdf,
  xfaJoinToPdf,
} from './border-style';
import { drawGradientFill, isGradientFill, isGray, grayLevel } from './fill-paint';
import { renderBarcode } from './barcode-renderer';
import { toPointsOrZero } from '../lib/unit-converter';
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
    // Reuse one /Font resource entry per distinct font (pdf-lowlevel).
    dedupePageFontResources(pdfPage);
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
    await renderNode(pdfPage, child, pageH, fontManager, _options, 1, 1);
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
      // `borderWidth` is emitted as `0 w` regardless (pdf-lib always writes it),
      // but this path fills only — no stroke. Passing an explicit 0 documents
      // that the operator is inert rather than an accidental hairline.
      pdfPage.drawRectangle({
        x: pos.x,
        y,
        width: w,
        height: h,
        color: toPdfColor(fill.color),
        borderWidth: 0,
      });
    }
    endOpacityScope(pdfPage, started);
  }

  // Rounded borders stroke a single continuous path so `join` applies at the
  // corners; Adobe's `cornerRadius` produces a rounded rectangle stroke, not
  // four independent straight edges. Per-edge differences force the legacy
  // edge-by-edge path (designrenderer:6283+ draws 0,2,1,3).
  const uniformEdge = uniformEdgeOf(border.edges);
  if (border.cornerRadius && border.cornerRadius > 0 && uniformEdge) {
    strokeRoundedRectangle(pdfPage, pos.x, y, w, h, border.cornerRadius, uniformEdge);
  } else {
    drawBorderEdges(pdfPage, border, pos, pageH);
  }
}

/**
 * Return the single edge when all edges are identical (or there is one edge),
 * otherwise undefined. Rounded borders must be uniform to stroke as one path.
 */
function uniformEdgeOf(edges: EdgeSpec[] | undefined): EdgeSpec | undefined {
  if (!edges || edges.length === 0) return undefined;
  if (edges.length === 1) return edges[0];
  const [first, ...rest] = edges;
  const same = rest.every((e) => edgeEquals(first, e));
  return same ? first : undefined;
}

function edgeEquals(a: EdgeSpec | undefined, b: EdgeSpec | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.presence === b.presence &&
    a.thickness === b.thickness &&
    a.style === b.style &&
    a.cap === b.cap &&
    a.join === b.join &&
    a.opacity === b.opacity &&
    a.color?.r === b.color?.r &&
    a.color?.g === b.color?.g &&
    a.color?.b === b.color?.b
  );
}

/**
 * Stroke a rounded rectangle with the edge's dash/cap/join settings.
 * Corner radius is clamped to `min(w, h) / 2` (renderer:24402).
 */
function strokeRoundedRectangle(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  edge: EdgeSpec
): void {
  if (edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return;
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  if (thickness <= 0) return;

  const r = clampCornerRadius(radius, w, h);
  const k = 0.5523 * r;
  // Default border colour is black, matching toPdfColor(undefined).
  const { r: red, g: green, b: blue } = edge.color ?? { r: 0, g: 0, b: 0 };
  const dashArray = dashArrayForStyle(edge.style, thickness);

  const operators = [
    pushGraphicsState(),
    setStrokingRgbColor(red / 255, green / 255, blue / 255),
    setLineWidth(thickness),
    setLineCap(xfaCapToPdf(edge.cap)),
    setLineJoin(xfaJoinToPdf(edge.join)),
    setDashPattern(dashArray ?? [], 0),
    moveTo(x + r, y),
    lineTo(x + w - r, y),
    appendBezierCurve(x + w - r + k, y, x + w, y + r - k, x + w, y + r),
    lineTo(x + w, y + h - r),
    appendBezierCurve(x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h),
    lineTo(x + r, y + h),
    appendBezierCurve(x + r - k, y + h, x, y + h - r + k, x, y + h - r),
    lineTo(x, y + r),
    appendBezierCurve(x, y + r - k, x + r - k, y, x + r, y),
    closePath(),
    strokePath(),
    popGraphicsState(),
  ];

  const started = beginOpacityScope(pdfPage, { stroke: edge.opacity });
  pdfPage.pushOperators(...operators);
  endOpacityScope(pdfPage, started);
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
  edge: EdgeSpec | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  if (!edge || edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return;
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
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
  // XFA default font size is 10pt (matches position-engine line height).
  const fontSize = node.font?.size ?? 10;
  const fontColor = toPdfColor(node.font?.color);
  // Choice lists display the selected item's text, not its export value (G7).
  const valueText = node.ui?.type === 'choiceList'
    ? resolveChoiceText(node.resolvedValue, node.ui.items)
    : formatValue(node.resolvedValue, node.formatPicture);
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

  // Buttons draw their authored label centred in the widget box (G7); the
  // data value is irrelevant. Signatures flatten to an empty (bordered) box.
  if (node.ui?.type === 'button') {
    await renderButton(pdfPage, node, x, y, width, innerHeight, fontSize, fontManager, fontColor, valueText);
    return;
  }
  if (node.ui?.type === 'signature') {
    return;
  }

  const rotate = normalizeRotation(node.position?.rotate ?? 0);
  const rotation = rotate !== 0 ? degrees(rotate) : undefined;
  const verticalRot = isVerticalRotation(rotate);
  const innerBox = { x, y, w: width, h: innerHeight };

  const reserve = node.caption?.reserve ?? 0;
  const valueFamily = node.font?.family ?? 'Helvetica';
  const valueScale = scaleForFamily(valueFamily);

  // Draw caption if present
  if (node.caption?.text) {
    const captionFamily = node.caption.font?.family ?? node.font?.family ?? 'Helvetica';
    const captionFont = node.caption.font
      ? await fontManager.getSafeFont(
          node.caption.text,
          captionFamily,
          node.caption.font.weight,
          node.caption.font.posture
        )
      : await fontManager.getFont(captionFamily, node.font?.weight, node.font?.posture);
    const captionSize = node.caption.font?.size ?? fontSize;
    const captionColor = toPdfColor(node.caption.font?.color);
    const captionScale = scaleForFamily(captionFamily);
    const placement = node.caption?.placement ?? 'left';
    let captionX = x;
    let captionY = y;

    // Caption must not paint over the value area. `reserve` is the authored
    // strip width, computed by Designer for its own font; if the caption
    // measures wider in the resolved font it would otherwise silently overlap
    // the value. Clamp the strip the caption may occupy to the authored
    // reserve and clip the caption to it.
    const captionWidth = measureTextWidth(node.caption.text, captionSize, captionFont, captionScale);
    const captionStrip =
      placement === 'left' || placement === 'right'
        ? Math.max(Math.min(reserve || captionWidth, width), 0)
        : width;

    if (verticalRot) {
      // Box swap: caption wraps along the box height (single line — the
      // reading length is the measured text length).
      const anchor = rotatedAnchor({
        rotate,
        box: innerBox,
        align: placement === 'right' ? 'right' : valueAlign,
        valign: verticalAlign,
        lineLen: captionWidth,
        ascent: fontAscent(captionFont, captionSize),
        descent: fontDescent(captionFont, captionSize),
      });
      if (anchor) {
        captionX = anchor.x;
        captionY = anchor.y;
      }
    } else {
      // Baseline placement via the same ascent-based model as the value text
      // (layoutLines), so a caption and its value on the same line share one
      // baseline instead of two independently-derived guesses.
      const captionAdvance = paraMetrics(node.para, captionSize).lineAdvance;
      const captionTop =
        verticalAlign === 'bottom'
          ? y + innerHeight
          : verticalAlign === 'middle'
            ? y + innerHeight / 2
            : y + innerHeight;
      const { baselines: captionBaselines } = layoutLines(
        1,
        captionSize,
        { top: captionTop, bottom: y },
        verticalAlign,
        captionFont,
        { lineAdvance: captionAdvance }
      );
      captionY = captionBaselines[0];

      if (placement === 'right') {
        captionX = x + width - captionStrip;
      }
    }

    // Clip the caption to its strip so an over-wide caption can never paint
    // into the value area (the "Pos." over "Machine location" collision).
    const captionClip =
      placement === 'left' || placement === 'right'
        ? clipOverflow(
            pdfPage,
            placement === 'left' ? x : x + width - captionStrip,
            y,
            captionStrip,
            innerHeight,
            captionWidth > captionStrip + 0.01
          )
        : false;

    drawScaledText(
      pdfPage,
      node.caption.text,
      {
        x: captionX,
        y: captionY,
        size: captionSize,
        font: captionFont,
        color: captionColor,
        rotate: rotation,
      },
      captionScale
    );
    endOverflowClip(pdfPage, captionClip);
  }

  // Barcode fields draw bars, not glyphs (G1: `renderBarcode` had no call site).
  if (node.ui?.type === 'barcode') {
    await renderBarcodeValue(pdfPage, node, valueText, {
      x, y, w: width, h: innerHeight,
    }, fontManager, { fontSize, fontColor, align: valueAlign });
    return;
  }

  // Draw field value with multi-line wrapping
  if (valueText) {
    const valueFont = await fontManager.getSafeFont(
      valueText,
      valueFamily,
      node.font?.weight,
      node.font?.posture
    );
    const valueAreaWidth = Math.max(width - reserve, 0);
    // `<para>` block metrics: line advance, vertical space and horizontal insets.
    const pm = paraMetrics(node.para, fontSize);

    if (verticalRot) {
      // Box swap: wrap along the reading axis (box height), anchor with the
      // cross-axis offset preserving the caption reserve strip.
      const valueBox = { x: x + reserve, y, w: valueAreaWidth, h: innerHeight };
      const lines = wrapText(valueText, fontSize, innerHeight, valueFont);
      const advance = pm.lineAdvance;
      const ascent = fontAscent(valueFont, fontSize);
      const descent = fontDescent(valueFont, fontSize);
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, valueFont, valueScale)),
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
        drawScaledText(
          pdfPage,
          lines.join('\n'),
          {
            x: anchor.x,
            y: anchor.y,
            size: fontSize,
            font: valueFont,
            color: fontColor,
            rotate: rotation,
          },
          valueScale
        );
      }
      return;
    }

    // Wrap text to fit within the value area (hard \n breaks always split).
    // `<para marginLeft/Right>` inset the text block; `textIndent` narrows the
    // first line of each paragraph.
    const textX = x + reserve + pm.marginLeft;
    const textW = Math.max(valueAreaWidth - pm.marginLeft - pm.marginRight, 0);
    const measure = (s: string): number =>
      measureTextWidth(s, fontSize, valueFont, valueScale);
    const lines = breakLinesInfo(valueText, textW, measure, {
      firstLineIndent: pm.textIndent,
    });

    // First line at the top of the block; `spaceAbove`/`spaceBelow` shrink the
    // usable box and `lineHeight` overrides the per-line advance.
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + innerHeight, bottom: y },
      verticalAlign,
      valueFont,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const clipped = clipOverflow(
      pdfPage,
      textX,
      y,
      textW,
      innerHeight,
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > innerHeight + 0.5
    );

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const { text: line, paragraphEnd } = lines[i];
      const lineY = baselines[i];
      const lineWidth = measure(line);
      // First line of each paragraph carries the text indent.
      const indent = i === 0 || lines[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const baseX = textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth);

      // Justify/justifyAll widen the inter-word gaps (jftext:73245);
      // every other code draws the line whole at the alignment offset.
      const segments = justifyLine(line, lineAvail, lineWidth, measure, {
        code: justH,
        paragraphLast: paragraphEnd,
      });

      if (segments) {
        for (const segment of segments) {
          drawScaledText(
            pdfPage,
            segment.text,
            {
              x: textX + indent + segment.x,
              y: lineY,
              size: fontSize,
              font: valueFont,
              color: fontColor,
              rotate: rotation,
            },
            valueScale
          );
        }
        continue;
      }

      drawScaledText(
        pdfPage,
        line,
        {
          x: baseX,
          y: lineY,
          size: fontSize,
          font: valueFont,
          color: fontColor,
          rotate: rotation,
        },
        valueScale
      );
    }
    endOverflowClip(pdfPage, clipped);
  }
}

async function renderButton(
  pdfPage: PDFPage,
  node: FieldNode,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  fontManager: FontManager,
  fontColor: RGB,
  valueText: string
): Promise<void> {
  const label = resolveButtonLabel(node.ui?.label, valueText, node.caption?.text);
  if (!label) return;

  const family = node.font?.family ?? 'Helvetica';
  const font = await fontManager.getSafeFont(label, family, node.font?.weight, node.font?.posture);
  const scale = scaleForFamily(family);
  const textWidth = measureTextWidth(label, fontSize, font, scale);
  // Baseline from the shared ascent-based model (was `(height - fontSize)/2`,
  // which assumed the em box equals the ascent and put every label low).
  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);
  // `highlight` describes the *press* appearance, which never shows in a
  // flattened render, so the label is simply centred horizontally.
  drawScaledText(
    pdfPage,
    label,
    {
      x: x + Math.max((width - textWidth) / 2, 0),
      y: baselines[0],
      size: fontSize,
      font,
      color: fontColor,
    },
    scale
  );
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
  const family = node.font?.family ?? 'Helvetica';
  const weight = node.font?.weight;
  const posture = node.font?.posture;
  const scale = scaleForFamily(family);

  // The checkmark glyph (U+2611/U+2610) is not WinAnsi — getSafeFont falls back
  // to the embedded Unicode font so drawing never throws.
  const font = await fontManager.getSafeFont(checkChar, family, weight, posture);

  // Baseline from the shared ascent-based model, consistent with every other
  // text path (was `(height - fontSize)/2`).
  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);

  // Draw the check indicator. The box is 1.5 em wide by design so the glyph and
  // its following caption have room; it is not a font-metric quantity.
  drawScaledText(pdfPage, checkChar, { x, y: baselines[0], size: fontSize, font, color: fontColor }, scale);

  // Draw caption next to checkbox
  if (node.caption?.text) {
    const captionFont = await fontManager.getSafeFont(node.caption.text, family, weight, posture);
    drawScaledText(
      pdfPage,
      node.caption.text,
      { x: x + fontSize * 1.5, y: baselines[0], size: fontSize, font: captionFont, color: fontColor },
      scale
    );
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
    // XFA default font size is 10pt (template <font> without @size).
    const fontSize = node.font?.size ?? 10;
    const fontColor = toPdfColor(node.font?.color);
    const font = await fontManager.getSafeFont(
      text,
      node.font?.family ?? 'Helvetica',
      node.font?.weight,
      node.font?.posture
    );
    const rotate = normalizeRotation(node.position?.rotate ?? 0);
    const rotation = rotate !== 0 ? degrees(rotate) : undefined;
    const pm = paraMetrics(node.para, fontSize);
    const justH = mapJustH(node.para?.hAlign);
    const justV = mapJustV(node.para?.vAlign);
    const verticalAlign: 'top' | 'middle' | 'bottom' =
      justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
    const baseFamily = node.font?.family ?? 'Helvetica';
    const drawScale = scaleForFamily(baseFamily);

    if (isVerticalRotation(rotate)) {
      // Box swap: wrap along the box height, anchor via rotation remap
      const lines = wrapText(text, fontSize, height, font);
      const advance = pm.lineAdvance;
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, font, drawScale)),
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

    // Multi-line text wrapping with `<para>` insets/indent and line advance.
    const textX = x + pm.marginLeft;
    const textW = Math.max(width - pm.marginLeft - pm.marginRight, 0);
    const wrapped = breakLinesInfo(
      text,
      textW,
      (s) => measureTextWidth(s, fontSize, font, drawScale),
      { firstLineIndent: pm.textIndent }
    );
    const lines = wrapped.map((line) => line.text);
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + height, bottom: y },
      verticalAlign,
      font,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const clipped = clipOverflow(
      pdfPage,
      textX,
      y,
      textW,
      height,
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > height + 0.5
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = baselines[i];
      // breakLinesInfo applies the indent to the first line of every source
      // paragraph, so draw each paragraph start with the same shift.
      const indent = i === 0 || wrapped[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const lineWidth = measureTextWidth(line, fontSize, font);
      pdfPage.drawText(line, {
        x: textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth),
        y: lineY,
        size: fontSize,
        font,
        color: fontColor,
        rotate: rotation,
      });
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

  const edge = node.value?.shapeBorder?.edges?.[0] ?? {};
  const fillColor = node.value?.shapeBorder?.fill?.color;
  // An XFA arc's default edge is a black 0.5pt stroke (XFA 3.3, Template
  // Reference, arc edge); hidden/invisible/none suppresses only the stroke.
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const strokeVisible =
    edge.presence !== 'hidden' && edge.presence !== 'invisible' && edge.style !== 'none';

  // Ellipse/circle borders honour the edge dash pattern and line cap; the join
  // is emitted as an operator because pdf-lib's drawEllipse has no join option
  // (adobepdf.xdc:187-191 dash ratios; designrenderer:6182 cap/join enums).
  const dashArray = strokeVisible ? dashArrayForStyle(edge.style, thickness) : undefined;
  const lineJoin = xfaJoinToPdf(edge.join);
  const lineCap = xfaCapToPdf(edge.cap);

  const drawOptions: Parameters<PDFPage['drawEllipse']>[0] = {
    x: cx,
    y: cy,
    xScale: rx,
    yScale: ry,
    color: fillColor ? toPdfColor(fillColor) : undefined,
    borderColor: strokeVisible ? toPdfColor(edge?.color) : undefined,
    borderWidth: strokeVisible ? thickness : 0,
  };
  if (dashArray) drawOptions.borderDashArray = dashArray;
  if (edge?.cap) drawOptions.borderLineCap = lineCap;

  const started = beginOpacityScope(pdfPage, { fill: node.value?.shapeBorder?.fill?.opacity, stroke: edge?.opacity });
  pdfPage.pushOperators(pushGraphicsState(), setLineJoin(lineJoin));
  pdfPage.drawEllipse(drawOptions);
  pdfPage.pushOperators(popGraphicsState());
  endOpacityScope(pdfPage, started);
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
    // XFA default font size is 10pt (template <font> without @size).
    const fontSize = node.font?.size ?? 10;
    const baseFamily = node.font?.family ?? 'Helvetica';
    const drawScale = scaleForFamily(baseFamily);
    const font = await fontManager.getSafeFont(
      text,
      baseFamily,
      node.font?.weight,
      node.font?.posture
    );
    const wrapWidth = width ?? 500;
    const boxH = height ?? 0;
    const pm = paraMetrics(node.para, fontSize);
    const justH = mapJustH(node.para?.hAlign);
    const justV = mapJustV(node.para?.vAlign);
    const verticalAlign: 'top' | 'middle' | 'bottom' =
      justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
    const textX = x + pm.marginLeft;
    const textW = Math.max(wrapWidth - pm.marginLeft - pm.marginRight, 0);
    const wrapped = breakLinesInfo(
      text,
      textW,
      (s) => measureTextWidth(s, fontSize, font, drawScale),
      { firstLineIndent: pm.textIndent }
    );
    const lines = wrapped.map((line) => line.text);
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + boxH, bottom: y },
      verticalAlign,
      font,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const clipped = clipOverflow(
      pdfPage,
      textX,
      y,
      textW,
      boxH,
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > boxH + 0.5
    );

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineY = baselines[i];
      const indent = i === 0 || wrapped[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const lineWidth = measureTextWidth(line, fontSize, font, drawScale);
      drawScaledText(
        pdfPage,
        line,
        {
          x: textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth),
          y: lineY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        },
        drawScale
      );
    }
    endOverflowClip(pdfPage, clipped);
    return;
  }

  // XFA default font size is 10pt (template <font> without @size).
  const baseFontSize = node.font?.size ?? 10;
  const baseFontFamily = node.font?.family ?? 'Helvetica';
  const wrapWidth = width ?? 500;
  const boxH = height ?? 0;
  const pm = paraMetrics(node.para, baseFontSize);
  const justH = mapJustH(node.para?.hAlign);
  const justV = mapJustV(node.para?.vAlign);
  const verticalAlign: 'top' | 'middle' | 'bottom' =
    justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
  const textX = x + pm.marginLeft;
  const textW = Math.max(wrapWidth - pm.marginLeft - pm.marginRight, 0);

  const richScale = scaleForFamily(baseFontFamily);

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
    measure: (text, run) =>
      measureText(text, styled[run].size, styled[run].font, { horizontalScale: richScale }),
    paragraph: {
      lineAdvance: pm.lineAdvance,
      marginLeft: pm.marginLeft,
      marginRight: pm.marginRight,
      firstLineIndent: pm.textIndent,
      justify: justH,
    },
  });

  const clipped = clipOverflow(
    pdfPage,
    textX,
    y,
    textW,
    boxH,
    runBlockHeight(lines) + pm.spaceAbove + pm.spaceBelow > boxH + 0.5
  );
  const baselines = layoutRunBaselines(
    lines,
    { top: y + boxH - pm.spaceAbove, bottom: y + pm.spaceBelow },
    verticalAlign
  );

  for (let i = 0; i < lines.length; i++) {
    const lineY = baselines[i];
    const lineAvail = Math.max(textW - lines[i].indent, 0);
    const lineOriginX =
      textX + lines[i].indent + horizontalOffsetX(justH, lineAvail, lines[i].width);
    for (const segment of lines[i].segments) {
      const run = styled[segment.run];
      pdfPage.drawText(segment.text, {
        x: lineOriginX + segment.x,
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

/**
 * Measure text width in points.
 *
 * `horizontalScale` condenses the result for condensed faces resolved to a
 * full-width font. Every wrap decision, alignment offset and justification
 * split must use the same scale that the matching `drawText` applies, or the
 * text will overflow its own box — the class of defect that made every
 * Arial Narrow run in the MechanicalSeal/IPQT forms wrap to too many lines.
 */
function measureTextWidth(
  text: string,
  fontSize: number,
  font?: PDFFont,
  horizontalScale?: number
): number {
  return measureText(text, fontSize, font, { horizontalScale });
}

/** Horizontal scale to apply when drawing a condensed family (1 = none). */
function scaleForFamily(family: string | undefined): number | undefined {
  return isCondensedFamily(family) ? NARROW_SCALE : undefined;
}

/**
 * The PDF `Tz` operator (horizontal scaling, percent). pdf-lib exposes no
 * helper for it, so it is constructed directly.
 */
function setTextHorizontalScale(percent: number): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(percent)]);
}

/**
 * `drawText` with an optional horizontal scale.
 *
 * pdf-lib exposes no horizontal-scaling option on `drawText`, so the scale is
 * applied with the text-state operator `Tz` (a percentage affecting glyph
 * advances only) around a normal `drawText` call. Wrapping the delegate call
 * rather than hand-emitting the text operators keeps pdf-lib's own string
 * encoding, font-resource registration and rotation handling intact — those are
 * easy to get subtly wrong and would regress every script's output.
 *
 * `Tz` is part of the text state, not the graphics state, so it is reset after
 * the run to avoid leaking into whatever is drawn next.
 */
function drawScaledText(
  pdfPage: PDFPage,
  text: string,
  options: PDFPageDrawTextOptions,
  horizontalScale?: number
): void {
  if (horizontalScale === undefined || horizontalScale === 1) {
    pdfPage.drawText(text, options);
    return;
  }
  pdfPage.pushOperators(setTextHorizontalScale(Math.round(horizontalScale * 100)));
  try {
    pdfPage.drawText(text, options);
  } finally {
    pdfPage.pushOperators(setTextHorizontalScale(100));
  }
}

/** Wrap text into lines that fit within the given width. */
function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  font?: PDFFont,
  opts: { firstLineIndent?: number } = {}
): string[] {
  if (!text) return [text];
  if (maxWidth <= 0) return text.split(/\r\n|\r|\n/);
  return breakLines(text, maxWidth, (s) => measureTextWidth(s, fontSize, font), opts);
}

/**
 * Draw an XFA `<field ui><barcode>` as vector bars plus an optional
 * human-readable interpretation (HRI) line.
 *
 * Attribute semantics follow `adobepdf.xdc:212-252`
 * (`moduleWidth`, `moduleHeight`, `wideNarrowRatio`, `textLocation`,
 * `errorCorrectionLevel`, `checksum`, `dataLength`).
 */
async function renderBarcodeValue(
  pdfPage: PDFPage,
  node: FieldNode,
  data: string,
  box: { x: number; y: number; w: number; h: number },
  fontManager: FontManager,
  opts: { fontSize: number; fontColor?: RGB; align: 'left' | 'center' | 'right' }
): Promise<void> {
  const ui = node.ui;
  if (!ui || box.w <= 0 || box.h <= 0) return;

  const symbology = ui.symbology ?? ui.encodeHint ?? 'code39';
  const textLocation = (ui.textLocation ?? 'none').toLowerCase();
  const hasHri = textLocation !== 'none' && textLocation !== '';
  const hriSize = Math.max(Math.min(opts.fontSize, box.h / 3), 4);
  const hriH = hasHri ? hriSize + 3 : 0;
  const above = textLocation.startsWith('above');

  const barBox = {
    x: box.x,
    y: above ? box.y : box.y + hriH,
    w: box.w,
    h: Math.max(box.h - hriH, 1),
  };

  const moduleW = Math.max(toPointsOrZero(ui.moduleWidth) || 1, 0.1);
  const ratio = parseWideNarrowRatio(ui.wideNarrowRatio);

  renderBarcode(
    pdfPage,
    symbology,
    data,
    barBox.x,
    barBox.y,
    barBox.w,
    barBox.h,
    moduleW,
    opts.align,
    ratio,
    { errorCorrectionLevel: parseErrorCorrectionLevel(ui.errorCorrectionLevel) },
  );

  if (hasHri && data) {
    const hriFont = await fontManager.getSafeFont(data, node.font?.family ?? 'Helvetica');
    const textW = measureTextWidth(data, hriSize, hriFont);
    const slack = Math.max(box.w - textW, 0);
    const hriX =
      opts.align === 'center' ? box.x + slack / 2
      : opts.align === 'right' ? box.x + slack
      : box.x;
    const hriY = above ? box.y + box.h - hriSize : box.y;
    pdfPage.drawText(data, {
      x: hriX,
      y: hriY,
      size: hriSize,
      font: hriFont,
      color: opts.fontColor ?? rgb(0, 0, 0),
    });
  }
}

/**
 * `<barcode errorCorrectionLevel="0-8">` (Adobe `BarcodeData.xml` ecc range).
 * Unauthored or malformed levels fall back to the encoder's Adobe default (5).
 */
function parseErrorCorrectionLevel(raw?: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 8) return undefined;
  return n;
}

/** `wideNarrowRatio` is authored either as a plain number or as a `.xdc` range. */
function parseWideNarrowRatio(raw?: string): number {
  if (!raw) return 2.5;
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return 2.5;
  if (nums.length === 1) return Math.min(Math.max(parseFloat(nums[0]), 2), 3);
  const lo = parseFloat(nums[0]);
  const hi = parseFloat(nums[1]);
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return 2.5;
  return Math.min(Math.max((lo + hi) / 2, 2), 3);
}
