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
  setFillingGrayscaleColor,
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
import { PAGE_NUMBER_TOKEN } from '../domain/mapping/resolve-embeds';
import { drawValueHeight } from '../domain/layout/position-engine';
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
  cornerRadiiOf,
  dashArrayForStyle,
  hasRoundedCorners,
  isBottomUnderlineOnly,
  quantizeStrokeWidth,
  rotateCornersForAngle,
  rotateEdgesForAngle,
  xfaCapToPdf,
  xfaJoinToPdf,
} from './border-style';
import { drawGradientFill, isGradientFill, isGray, grayLevel } from './fill-paint';
import { renderBarcode } from './barcode-renderer';
import { toPointsOrZero } from '../lib/unit-converter';
import { ERROR_CODES } from '../errors/error-codes';

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

async function renderPage(
  pdfPage: PDFPage,
  page: PaginatedPage,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex: number,
  totalPages: number,
): Promise<void> {
  const pageH = page.medium.long;

  for (const node of page.masterPageChildren) {
    await renderNode(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  }

  for (const node of page.children) {
    await renderNode(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  }

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
  if (!options.previewMode) {
    if (node.presence === 'invisible' || node.presence === 'hidden' || node.presence === 'inactive') return;
  }
  if (node.type === 'draw') return renderDraw(pdfPage, node, pageH, fontManager, pageIndex);
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
  if (node.border) {
    const collapsed = collapseTinyGapEdges(node);
    if (collapsed) drawBorderBox(pdfPage, collapsed, node.position, pageH);
  }
  for (const child of node.children) {
    await renderNode(pdfPage, child, pageH, fontManager, options, pageIndex, totalPages);
  }
}

function collapseTinyGapEdges(node: SubformNode): BorderSpec | undefined {
  const border = node.border;
  if (!border || !node.position) return border;
  const pos = node.position;
  if (pos.x === undefined || pos.y === undefined || pos.w === undefined || pos.h === undefined) return border;
  const edges = border.edges;
  if (!edges || edges.length === 0) return border;
  const norm: Array<EdgeSpec | undefined> =
    edges.length === 1 ? [edges[0], edges[0], edges[0], edges[0]] : [edges[0], edges[1], edges[2], edges[3]];
  const visible = (e: EdgeSpec | undefined): boolean =>
    !!e && e.presence !== 'hidden' && e.presence !== 'invisible' && e.style !== 'none';
  const subBottomVisible = visible(norm[2]);
  const subTopVisible = visible(norm[0]);
  if (!subBottomVisible && !subTopVisible) return border;

  const TOL = 3;
  let suppressBottom = false;
  let suppressTop = false;
  if (subBottomVisible) {
    const subBottom = (pos.y ?? 0) + (pos.h ?? 0);
    for (const child of node.children) {
      const cp = (child as { position?: { x?: number; y?: number; w?: number; h?: number } }).position;
      if (!cp || cp.x === undefined || cp.y === undefined || cp.w === undefined || cp.h === undefined) continue;
      const childBottom = cp.y + cp.h;
      const gap = subBottom - childBottom;
      if (gap < -0.5 || gap > TOL) continue;
      if (!childBottomEdgeVisible(child, norm[2]?.thickness)) continue;
      if (!xOverlap(pos.x ?? 0, pos.w ?? 0, cp.x, cp.w, 8)) continue;
      suppressBottom = true;
      break;
    }
  }
  if (subTopVisible) {
    const subTop = pos.y ?? 0;
    for (const child of node.children) {
      const cp = (child as { position?: { x?: number; y?: number; w?: number; h?: number } }).position;
      if (!cp || cp.x === undefined || cp.y === undefined) continue;
      const childTop = cp.y;
      const gap = childTop - subTop;
      if (gap < -0.5 || gap > TOL) continue;
      if (!childTopEdgeVisible(child, norm[0]?.thickness)) continue;
      if (!xOverlap(pos.x ?? 0, pos.w ?? 0, cp.x ?? 0, cp.w ?? 0, 8)) continue;
      suppressTop = true;
      break;
    }
  }
  if (!suppressBottom && !suppressTop) return border;
  const pruned: Array<EdgeSpec | undefined> = [...norm];
  if (suppressBottom) pruned[2] = { ...(pruned[2] as object), presence: 'hidden' } as EdgeSpec;
  if (suppressTop) pruned[0] = { ...(pruned[0] as object), presence: 'hidden' } as EdgeSpec;
  const anyVisible = pruned.some(visible);
  const fillVisible =
    !!border.fill?.color &&
    border.fill.presence !== 'hidden' &&
    border.fill.presence !== 'invisible';
  if (!anyVisible && !fillVisible && !border.cornerRadius && !border.cornerRadii) return undefined;
  return { ...border, edges: pruned as EdgeSpec[] };
}

function edgeThickness(edge: EdgeSpec | undefined): number {
  return edge?.thickness ?? 0.5;
}

function childEdgeVisible(child: LayoutNode, index: number, parentThickness: number | undefined): boolean {
  const border = (child as { border?: BorderSpec }).border;
  if (!border || border.presence === 'hidden' || border.presence === 'invisible') return false;
  const edges = border.edges;
  if (!edges || edges.length === 0) return false;
  const edge: EdgeSpec | undefined = edges.length === 1 ? edges[0] : edges[index];
  if (!edge || edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return false;
  return edgeThickness(edge) >= (parentThickness ?? 0.5);
}

function childBottomEdgeVisible(child: LayoutNode, parentThickness: number | undefined): boolean {
  return childEdgeVisible(child, 2, parentThickness);
}

function childTopEdgeVisible(child: LayoutNode, parentThickness: number | undefined): boolean {
  return childEdgeVisible(child, 0, parentThickness);
}

function xOverlap(ax: number, aw: number, bx: number, bw: number, minOverlap: number): boolean {
  const left = Math.max(ax, bx);
  const right = Math.min(ax + aw, bx + bw);
  return right - left >= minOverlap;
}

async function renderExclGroup(
  pdfPage: PDFPage,
  node: ExclGroupNode,
  pageH: number,
  fontManager: FontManager,
  _options: RenderOptions
): Promise<void> {
  if (node.border) drawBorderBox(pdfPage, node.border, node.position, pageH);
  for (const child of node.children) {
    await renderNode(pdfPage, child, pageH, fontManager, _options, 1, 1);
  }
}

function toPdfColor(color?: RgbColor): RGB {
  if (!color) return rgb(0, 0, 0);
  if (isGray(color)) return grayscale(grayLevel(color)) as unknown as RGB;
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

function drawBorderBox(
  pdfPage: PDFPage,
  border: BorderSpec,
  pos: { x?: number; y?: number; w?: number; h?: number; rotate?: number } | undefined,
  pageH: number
): void {
  if (border.presence === 'hidden' || border.presence === 'invisible' || border.presence === 'inactive') return;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return;
  const y = flipY(pos.y, h, pageH);
  const rotate = normalizeRotation(pos.rotate ?? 0);
  const isRotated = rotate === 90 || rotate === 270;

  let edges: Array<EdgeSpec | undefined> | undefined = border.edges;
  let radii = cornerRadiiOf(border);
  if (isRotated && edges && edges.length) {
    const quad: [EdgeSpec | undefined, EdgeSpec | undefined, EdgeSpec | undefined, EdgeSpec | undefined] =
      edges.length === 1 ? [edges[0], edges[0], edges[0], edges[0]] : [edges[0], edges[1], edges[2], edges[3]];
    const rotated = rotateEdgesForAngle<EdgeSpec | undefined>(quad, rotate);
    edges = [rotated[0], rotated[1], rotated[2], rotated[3]];
  }
  if (isRotated) {
    const quad: [number | undefined, number | undefined, number | undefined, number | undefined] = [
      radii[0],
      radii[1],
      radii[2],
      radii[3],
    ];
    const rotated = rotateCornersForAngle(quad, rotate);
    radii = [rotated[0], rotated[1], rotated[2], rotated[3]];
  }
  const rounded = hasRoundedCorners(radii, w, h);

  const fill = border.fill;
  if (fill?.color && fill.presence !== 'hidden' && fill.presence !== 'invisible') {
    const started = beginOpacityScope(pdfPage, { fill: fill.opacity });
    if (fill.fillType && isGradientFill(fill.fillType)) {
      const c1: RgbColor = fill.color2 ?? { r: 255, g: 255, b: 255 };
      drawGradientFill(pdfPage, fill.fillType, fill.color, c1, pos.x, y, w, h);
    } else if (rounded) {
      fillRoundedRectPerCorner(pdfPage, pos.x, y, w, h, radii, fill.color);
    } else {
      fillUniformRect(pdfPage, fill.color, pos.x, y, w, h);
    }
    endOpacityScope(pdfPage, started);
  }

  const uniformEdge = uniformEdgeOf(edges as EdgeSpec[] | undefined);
  if (rounded && uniformEdge) {
    strokeRoundedRectPerCorner(pdfPage, pos.x, y, w, h, radii, uniformEdge);
  } else {
    drawBorderEdges(pdfPage, { ...border, edges: edges as EdgeSpec[] | undefined }, { x: pos.x, y: pos.y, w, h }, pageH);
  }
}

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

function fillUniformRect(
  pdfPage: PDFPage,
  color: RgbColor,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const paint = isGray(color)
    ? setFillingGrayscaleColor(grayLevel(color))
    : setFillingRgbColor(color.r / 255, color.g / 255, color.b / 255);
  pdfPage.pushOperators(
    pushGraphicsState(),
    paint,
    rectangle(x, y, w, h),
    fillPath(),
    popGraphicsState()
  );
}

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

  const uniform = uniformEdgeOf(edges);
  const anyRounding =
    (border.cornerRadius ?? 0) > 0 ||
    (border.cornerRadii ?? []).some((r) => (r ?? 0) > 0);
  if (uniform && !anyRounding) {
    strokeUniformRect(pdfPage, uniform, pos.x, y, w, h);
    return;
  }
  const [top, right, bottom, left] =
    edges.length === 1 ? [edges[0], edges[0], edges[0], edges[0]] : [edges[0], edges[1], edges[2], edges[3]];

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

  const dashArray = dashArrayForStyle(edge.style, thickness);

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

function strokeUniformRect(
  pdfPage: PDFPage,
  edge: EdgeSpec,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  if (edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return;
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  if (thickness <= 0) return;
  const { r: red, g: green, b: blue } = edge.color ?? { r: 0, g: 0, b: 0 };

  const started = beginOpacityScope(pdfPage, { stroke: edge.opacity });
  pdfPage.pushOperators(
    pushGraphicsState(),
    setStrokingRgbColor(red / 255, green / 255, blue / 255),
    setLineWidth(thickness),
    setLineCap(xfaCapToPdf(edge.cap)),
    setLineJoin(xfaJoinToPdf(edge.join)),
    setDashPattern(dashArrayForStyle(edge.style, thickness) ?? [], 0),
    rectangle(x, y, w, h),
    strokePath(),
    popGraphicsState()
  );
  endOpacityScope(pdfPage, started);
}

function fillRoundedRectPerCorner(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Array<number | undefined>,
  color: RgbColor
): void {
  const [tl0, tr0, br0, bl0] = radii;
  const tl = clampCornerRadius(tl0 ?? 0, w, h);
  const tr = clampCornerRadius(tr0 ?? 0, w, h);
  const br = clampCornerRadius(br0 ?? 0, w, h);
  const bl = clampCornerRadius(bl0 ?? 0, w, h);
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    fillUniformRect(pdfPage, color, x, y, w, h);
    return;
  }
  const { r: red, g: green, b: blue } = color;
  const ops = [setFillingRgbColor(red / 255, green / 255, blue / 255), moveTo(x + tl, y)];
  ops.push(lineTo(x + w - br, y));
  if (br > 0) {
    const k = 0.5523 * br;
    ops.push(appendBezierCurve(x + w - br + k, y, x + w, y + br - k, x + w, y + br));
  }
  ops.push(lineTo(x + w, y + h - tr));
  if (tr > 0) {
    const k = 0.5523 * tr;
    ops.push(appendBezierCurve(x + w, y + h - tr + k, x + w - tr + k, y + h, x + w - tr, y + h));
  }
  ops.push(lineTo(x + tl, y + h));
  if (tl > 0) {
    const k = 0.5523 * tl;
    ops.push(appendBezierCurve(x + tl - k, y + h, x, y + h - tl + k, x, y + h - tl));
  }
  ops.push(lineTo(x, y + bl));
  if (bl > 0) {
    const k = 0.5523 * bl;
    ops.push(appendBezierCurve(x, y + bl - k, x + bl - k, y, x + bl, y));
  }
  ops.push(closePath(), fillPath());
  pdfPage.pushOperators(...ops);
}

function strokeRoundedRectPerCorner(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Array<number | undefined>,
  edge: EdgeSpec
): void {
  if (edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none') return;
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  if (thickness <= 0) return;
  const [tl0, tr0, br0, bl0] = radii;
  const tl = clampCornerRadius(tl0 ?? 0, w, h);
  const tr = clampCornerRadius(tr0 ?? 0, w, h);
  const br = clampCornerRadius(br0 ?? 0, w, h);
  const bl = clampCornerRadius(bl0 ?? 0, w, h);
  const { r: red, g: green, b: blue } = edge.color ?? { r: 0, g: 0, b: 0 };
  const dashArray = dashArrayForStyle(edge.style, thickness);
  const ops = [
    pushGraphicsState(),
    setStrokingRgbColor(red / 255, green / 255, blue / 255),
    setLineWidth(thickness),
    setLineCap(xfaCapToPdf(edge.cap)),
    setLineJoin(xfaJoinToPdf(edge.join)),
    setDashPattern(dashArray ?? [], 0),
    moveTo(x + tl, y),
    lineTo(x + w - br, y),
  ];
  if (br > 0) {
    const k = 0.5523 * br;
    ops.push(appendBezierCurve(x + w - br + k, y, x + w, y + br - k, x + w, y + br));
  }
  ops.push(lineTo(x + w, y + h - tr));
  if (tr > 0) {
    const k = 0.5523 * tr;
    ops.push(appendBezierCurve(x + w, y + h - tr + k, x + w - tr + k, y + h, x + w - tr, y + h));
  }
  ops.push(lineTo(x + tl, y + h));
  if (tl > 0) {
    const k = 0.5523 * tl;
    ops.push(appendBezierCurve(x + tl - k, y + h, x, y + h - tl + k, x, y + h - tl));
  }
  ops.push(lineTo(x, y + bl));
  if (bl > 0) {
    const k = 0.5523 * bl;
    ops.push(appendBezierCurve(x, y + bl - k, x + bl - k, y, x + bl, y));
  }
  ops.push(closePath(), strokePath(), popGraphicsState());
  const started = beginOpacityScope(pdfPage, { stroke: edge.opacity });
  pdfPage.pushOperators(...ops);
  endOpacityScope(pdfPage, started);
}

function drawUnderlineInValueArea(
  pdfPage: PDFPage,
  border: BorderSpec,
  pos: { x?: number; y?: number; w?: number; h?: number } | undefined,
  reserve: number,
  placement: string,
  pageH: number
): void {
  if (!border || !pos || pos.x === undefined || pos.y === undefined) return;
  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return;
  const edges = border.edges ?? [];
  const bottom: EdgeSpec | undefined =
    edges.length === 1 ? edges[0] : edges.length >= 3 ? edges[2] : undefined;
  if (!bottom || bottom.presence === 'hidden' || bottom.presence === 'invisible' || bottom.style === 'none') {
    drawBorderBox(pdfPage, border, pos, pageH);
    return;
  }
  if (border.fill?.color && border.fill.presence !== 'hidden' && border.fill.presence !== 'invisible') {
    drawBorderBox(pdfPage, { ...border, edges: [] }, pos, pageH);
  }
  const y = flipY(pos.y, h, pageH);
  const x1 = placement === 'right' ? pos.x : pos.x + reserve;
  const x2 = placement === 'right' ? pos.x + w - reserve : pos.x + w;
  if (x2 <= x1) {
    drawBorderBox(pdfPage, border, pos, pageH);
    return;
  }
  drawEdge(pdfPage, bottom, x1, y, x2, y);
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
  const width = Math.max((pos.w ?? pos.minW ?? 0) - margins.left - margins.right, 0);
  const height = pos.h ?? pos.minH ?? 18;
  const y = flipY(pos.y, height, pageH) + margins.bottom;
  const innerHeight = Math.max(height - margins.top - margins.bottom, 0);
  const fontSize = node.font?.size ?? 10;
  const fontColor = toPdfColor(node.font?.color);
  const valueText = node.ui?.type === 'choiceList'
    ? resolveChoiceText(node.resolvedValue, node.ui.items)
    : formatValue(node.resolvedValue, node.formatPicture);
  const justH = mapJustH(node.para?.hAlign ?? node.ui?.hAlign);
  const valueAlign = alignClassOf(justH);
  const justV = mapJustV(node.para?.vAlign ?? node.ui?.vAlign);
  const verticalAlign: 'top' | 'middle' | 'bottom' =
    justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';

  if (node.ui?.type === 'checkButton') {
    return renderCheckButton(pdfPage, node, pos.x, flipY(pos.y, height, pageH), pos.w ?? 0, height, fontSize, fontManager, fontColor);
  }

  if (node.imageValue?.type === 'image' && node.imageValue.content) {
    if (node.border) drawBorderBox(pdfPage, node.border, pos, pageH);
    await renderImage(pdfPage, node.imageValue, x, y, width, innerHeight);
    return;
  }

  if (node.border) {
    const placement = node.caption?.placement ?? 'left';
    const reserve = node.caption?.reserve ?? 0;
    if (
      (placement === 'left' || placement === 'right') &&
      reserve > 0 &&
      isBottomUnderlineOnly(node.border.edges)
    ) {
      drawUnderlineInValueArea(pdfPage, node.border, pos, reserve, placement, pageH);
    } else {
      drawBorderBox(pdfPage, node.border, pos, pageH);
    }
  }

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

    const captionWidth = measureTextWidth(node.caption.text, captionSize, captionFont, captionScale);
    const captionStrip =
      placement === 'left' || placement === 'right'
        ? Math.max(Math.min(reserve || captionWidth, width), 0)
        : width;

    const richSymbol = captionTrailingSymbol(node.caption.text, node.caption.richHtml);
    let captionPainted = false;
    if (
      richSymbol &&
      (placement === 'left' || placement === 'right') &&
      reserve > 0 &&
      !verticalRot
    ) {
      const captionAdvance = paraMetrics(node.para, captionSize).lineAdvance;
      const { baselines: symBaselines } = layoutLines(
        1,
        captionSize,
        { top: y + innerHeight, bottom: y },
        verticalAlign,
        captionFont,
        { lineAdvance: captionAdvance }
      );
      const symY = symBaselines[0];
      const labelW = measureTextWidth(richSymbol.label, captionSize, captionFont, captionScale);
      const symW = measureTextWidth(richSymbol.symbol, captionSize, captionFont, captionScale);
      const labelX = placement === 'right' ? x + width - captionStrip : x;
      const symX =
        placement === 'right'
          ? x + width - symW
          : x + Math.max(captionStrip - symW, labelW + 1);
      const clipped = clipOverflow(
        pdfPage,
        placement === 'left' ? x : x + width - captionStrip,
        y,
        captionStrip,
        innerHeight,
        labelW + symW > captionStrip + 0.01
      );
      drawScaledText(
        pdfPage,
        richSymbol.label,
        { x: labelX, y: symY, size: captionSize, font: captionFont, color: captionColor, rotate: rotation },
        captionScale
      );
      drawScaledText(
        pdfPage,
        richSymbol.symbol,
        { x: symX, y: symY, size: captionSize, font: captionFont, color: captionColor, rotate: rotation },
        captionScale
      );
      if (richSymbol.underline) {
        const uy = symY - Math.max(0.5, captionSize * 0.12);
        pdfPage.drawLine({
          start: { x: symX, y: uy },
          end: { x: symX + symW, y: uy },
          thickness: Math.max(0.25, captionSize * 0.05),
          color: captionColor,
        });
      }
      endOverflowClip(pdfPage, clipped);
      captionPainted = true;
    } else if (verticalRot) {
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
      const captionAdvance = paraMetrics(node.para, captionSize).lineAdvance;
      const { baselines: captionBaselines } = layoutLines(
        1,
        captionSize,
        { top: y + innerHeight, bottom: y },
        verticalAlign,
        captionFont,
        { lineAdvance: captionAdvance }
      );
      captionY = captionBaselines[0];

      if (placement === 'right') {
        captionX = x + width - captionStrip;
      }
    }

    if (!captionPainted) {
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
  }

  if (node.ui?.type === 'barcode') {
    await renderBarcodeValue(pdfPage, node, valueText, {
      x, y, w: width, h: innerHeight,
    }, fontManager, { fontSize, fontColor, align: valueAlign });
    return;
  }

  if (valueText) {
    const valueFont = await fontManager.getSafeFont(
      valueText,
      valueFamily,
      node.font?.weight,
      node.font?.posture
    );
    const valueAreaWidth = Math.max(width - reserve, 0);
    const pm = paraMetrics(node.para, fontSize);

    if (verticalRot) {
      const valueBox = { x: x + reserve, y, w: valueAreaWidth, h: innerHeight };
      const lines = wrapText(valueText, fontSize, innerHeight, valueFont, {
        horizontalScale: valueScale,
      });
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

    const textX = x + reserve + pm.marginLeft;
    const textW = Math.max(valueAreaWidth - pm.marginLeft - pm.marginRight, 0);
    const measure = (s: string): number =>
      measureTextWidth(s, fontSize, valueFont, valueScale);
    const wrapWidth = node.ui?.multiLine === true ? textW : Number.POSITIVE_INFINITY;
    const lines = breakLinesInfo(valueText, wrapWidth, measure, {
      firstLineIndent: pm.textIndent,
    });

    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + innerHeight, bottom: y },
      verticalAlign,
      valueFont,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const verticalOverflow =
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > innerHeight + 0.5;
    const horizontalOverflow = lines.some(
      (line) => measure(line.text) > textW + 0.5
    );
    const clipped = clipOverflow(
      pdfPage,
      textX,
      y,
      textW,
      innerHeight,
      verticalOverflow || horizontalOverflow
    );

    for (let i = 0; i < lines.length; i++) {
      const { text: line, paragraphEnd } = lines[i];
      const lineY = baselines[i];
      const lineWidth = measure(line);
      const indent = i === 0 || lines[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const baseX = textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth);

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
  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);
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

  const font = await fontManager.getSafeFont(checkChar, family, weight, posture);

  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);

  drawScaledText(pdfPage, checkChar, { x, y: baselines[0], size: fontSize, font, color: fontColor }, scale);

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
  fontManager: FontManager,
  pageIndex = 0
): Promise<void> {
  const pos = node.position;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const margins = getMargins(node.margin);
  const width = Math.max((pos.w ?? pos.minW ?? 0) - margins.left - margins.right, 0);
  const measuredHeight =
    pos.h == null && pos.minH == null &&
    (node.value?.type === 'richText' || node.value?.type === 'text')
      ? drawValueHeight(node, width)
      : undefined;
  const outerHeight = pos.h ?? pos.minH ?? measuredHeight ?? 18;
  const x = pos.x + margins.left;
  const y = flipY(pos.y, outerHeight, pageH) + margins.bottom;
  const height = Math.max(outerHeight - margins.top - margins.bottom, 0);

  const borderRotate = normalizeRotation(pos.rotate ?? 0);
  const borderPos =
    (borderRotate === 90 || borderRotate === 270) &&
    pos.w != null &&
    pos.h != null
      ? { ...pos, w: pos.h, h: pos.w }
      : pos;
  if (node.border) drawBorderBox(pdfPage, node.border, borderPos, pageH);

  if (!node.value) return;

  if (node.value.type === 'image' && node.value.content) {
    await renderImage(pdfPage, node.value, x, y, width, height);
    return;
  }

  if (node.value.type === 'rectangle' || node.value.type === 'line') {
    if (node.value.shapeBorder) drawBorderBox(pdfPage, node.value.shapeBorder, borderPos, pageH);
    return;
  }

  if (node.value.type === 'arc' || node.value.type === 'circle') {
    renderArcOrCircle(pdfPage, node, x, y, width, height);
    return;
  }

  if (node.value.type === 'richText') {
    await renderRichText(pdfPage, node, x, y, fontManager, width, height, pageIndex);
    return;
  }

  if (node.value.type === 'text') {
    const text = stripHtml(node.value.content ?? '');
    if (!text) return;
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
      const lines = wrapText(text, fontSize, width, font, { horizontalScale: drawScale });
      const advance = pm.lineAdvance;
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, font, drawScale)),
        0
      );
      const rotatedY = flipY(pos.y ?? 0, width, pageH) + margins.bottom;
      const anchor = rotatedAnchor({
        rotate,
        box: { x, y: rotatedY, w: height, h: width },
        align: alignClassOf(justH),
        valign: verticalAlign,
        lineLen: longest,
        ascent: fontAscent(font, fontSize),
        descent: fontDescent(font, fontSize),
        advance,
        lineCount: lines.length,
      });
      if (anchor) {
        if (lines.length > 1) pdfPage.setLineHeight(advance);
        drawScaledText(
          pdfPage,
          lines.join('\n'),
          {
            x: anchor.x,
            y: anchor.y,
            size: fontSize,
            font,
            color: fontColor,
            rotate: rotation,
          },
          drawScale
        );
      }
      return;
    }

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
          color: fontColor,
          rotate: rotation,
        },
        drawScale
      );
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
  const cy = y;

  const edge = node.value?.shapeBorder?.edges?.[0] ?? {};
  const fillColor = node.value?.shapeBorder?.fill?.color;
  const thickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const strokeVisible =
    edge.presence !== 'hidden' && edge.presence !== 'invisible' && edge.style !== 'none';

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
  height?: number,
  pageIndex = 0
): Promise<void> {
  const content = (node.value?.content ?? '').replace(
    new RegExp(PAGE_NUMBER_TOKEN, 'g'),
    String(pageIndex + 1)
  );
  const runs = parseRichText(content);

  if (runs.length === 0) {
    const text = stripHtml(content);
    if (!text) return;
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

  const styled: StyledRun[] = [];
  for (const run of runs) {
    const font = await fontManager.getSafeFont(
      run.text,
      baseFontFamily,
      run.bold ? 'bold' : node.font?.weight,
      run.italic ? 'italic' : node.font?.posture
    );
    styled.push({ text: run.text, size: run.fontSize ?? baseFontSize, font, color: run.color, underline: run.underline });
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
      drawScaledText(
        pdfPage,
        segment.text,
        {
          x: lineOriginX + segment.x,
          y: lineY,
          size: run.size,
          font: run.font,
          color: run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color),
        },
        richScale
      );
      if (run.underline) {
        const segW = measureText(segment.text, run.size, run.font, { horizontalScale: richScale });
        const uy = lineY - Math.max(0.5, run.size * 0.12);
        pdfPage.drawLine({
          start: { x: lineOriginX + segment.x, y: uy },
          end: { x: lineOriginX + segment.x + segW, y: uy },
          thickness: Math.max(0.25, run.size * 0.05),
          color: run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color),
        });
      }
    }
  }
  endOverflowClip(pdfPage, clipped);
}

async function renderImage(
  pdfPage: PDFPage,
  value: NonNullable<DrawNode['value']>,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  if (!value.content) return;
  const doc = pdfPage.doc;
  try {
    const image = await embedBase64Image(doc, value.content, value.contentType);

    const rect = computeImageRect(
      value.aspectMode,
      w,
      h,
      {
        pixelW: image.width,
        pixelH: image.height,
        xdpi: value.xdpi,
        ydpi: value.ydpi,
      },
      { hAlign: value.hAlign, vAlign: value.vAlign }
    );

    pdfPage.drawImage(image, {
      x: x + rect.offsetX,
      y: y + rect.offsetY,
      width: rect.drawW,
      height: rect.drawH,
    });
  } catch {
    return;
  }
}

function flipY(y: number, h: number, pageH: number): number {
  return pageH - y - h;
}

export { formatValue } from '../lib/value-format';

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

function getMargins(margin?: MarginSpec): { top: number; right: number; bottom: number; left: number } {
  if (!margin) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: margin.topInset ?? 0,
    right: margin.rightInset ?? 0,
    bottom: margin.bottomInset ?? 0,
    left: margin.leftInset ?? 0,
  };
}

function measureTextWidth(
  text: string,
  fontSize: number,
  font?: PDFFont,
  horizontalScale?: number
): number {
  return measureText(text, fontSize, font, { horizontalScale });
}

function scaleForFamily(family: string | undefined): number | undefined {
  return isCondensedFamily(family) ? NARROW_SCALE : undefined;
}

function setTextHorizontalScale(percent: number): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(percent)]);
}

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

function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  font?: PDFFont,
  opts: { firstLineIndent?: number; horizontalScale?: number } = {}
): string[] {
  if (!text) return [text];
  if (maxWidth <= 0) return text.split(/\r\n|\r|\n/);
  const measure = (s: string): number =>
    measureTextWidth(s, fontSize, font, opts.horizontalScale);
  return breakLines(text, maxWidth, measure, { firstLineIndent: opts.firstLineIndent });
}

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

function parseErrorCorrectionLevel(raw?: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 8) return undefined;
  return n;
}

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

function captionTrailingSymbol(
  text: string | undefined,
  richHtml: string | undefined
): { label: string; symbol: string; underline: boolean } | undefined {
  if (!text || !richHtml || !/xfa-spacerun|spacerun/i.test(richHtml)) return undefined;
  const trimmed = text.trimEnd();
  const m = trimmed.match(/^(.*\S)\s*([+\-±])$/);
  if (!m) return undefined;
  const label = m[1];
  const symbol = m[2];
  if (!label) return undefined;
  return { label, symbol, underline: /underline/i.test(richHtml) };
}
