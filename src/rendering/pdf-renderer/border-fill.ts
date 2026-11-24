import {
  appendBezierCurve,
  closePath,
  fill as fillPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setDashPattern,
  setFillingGrayscaleColor,
  setFillingRgbColor,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke as strokePath,
} from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type { BorderSpec, EdgeSpec, RgbColor } from '../../types';
import {
  DEFAULT_EDGE_THICKNESS_PT,
  clampCornerRadius,
  cornerRadiiOf,
  dashArrayForStyle,
  effectiveStrokeWidth,
  hasRoundedCorners,
  quantizeStrokeWidth,
  rotateCornersForAngle,
  rotateEdgesForAngle,
  xfaCapToPdf,
  xfaJoinToPdf,
} from '../border-style';
import { drawGradientFill, grayLevel, isGradientFill, isGray } from '../fill-paint';
import { beginOpacityScope, endOpacityScope } from '../pdf-lowlevel';
import { normalizeRotation } from '../text/rotation';
import { flipY, toPdfColor } from './helpers';

const emittedShapesByPage = new WeakMap<PDFPage, Map<string, number>>();

export function drawBorderBox(
  pdfPage: PDFPage,
  border: BorderSpec,
  pos: { x?: number; y?: number; w?: number; h?: number; rotate?: number } | undefined,
  pageH: number
): void {
  if (
    border.presence === 'hidden' ||
    border.presence === 'invisible' ||
    border.presence === 'inactive'
  )
    return;
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
    const quad: [
      EdgeSpec | undefined,
      EdgeSpec | undefined,
      EdgeSpec | undefined,
      EdgeSpec | undefined,
    ] =
      edges.length === 1
        ? [edges[0], edges[0], edges[0], edges[0]]
        : [edges[0], edges[1], edges[2], edges[3]];
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
    drawBorderEdges(
      pdfPage,
      { ...border, edges: edges as EdgeSpec[] | undefined },
      { x: pos.x, y: pos.y, w, h },
      pageH
    );
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
  if (
    border.presence === 'hidden' ||
    border.presence === 'invisible' ||
    border.presence === 'inactive'
  )
    return;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  if (w <= 0 || h <= 0) return;
  const y = flipY(pos.y, h, pageH);

  const edges = border.edges ?? [];
  if (edges.length === 0) return;

  const uniform = uniformEdgeOf(edges);
  const anyRounding =
    (border.cornerRadius ?? 0) > 0 || (border.cornerRadii ?? []).some((r) => (r ?? 0) > 0);
  if (uniform && !anyRounding) {
    strokeUniformRect(pdfPage, uniform, pos.x, y, w, h);
    return;
  }
  const [top, right, bottom, left] =
    edges.length === 1
      ? [edges[0], edges[0], edges[0], edges[0]]
      : [edges[0], edges[1], edges[2], edges[3]];

  drawEdge(pdfPage, top, pos.x, y + h, pos.x + w, y + h);
  drawEdge(pdfPage, bottom, pos.x, y, pos.x + w, y);
  drawEdge(pdfPage, right, pos.x + w, y + h, pos.x + w, y);
  drawEdge(pdfPage, left, pos.x, y + h, pos.x, y);
}

export function drawEdge(
  pdfPage: PDFPage,
  edge: EdgeSpec | undefined,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  if (!edge || edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none')
    return;
  const authoredThickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const thickness = effectiveStrokeWidth(edge);
  if (!Number.isFinite(thickness) || thickness <= 0) return;

  const dashArray = dashArrayForStyle(edge.style, authoredThickness);

  const shape = edgeShapeKey(x1, y1, x2, y2, edge.color, dashArray, edge.opacity);
  const seenShapes = emittedShapesFor(pdfPage);
  if (seenShapes.has(shape)) return;

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
  seenShapes.set(shape, thickness);
  endOpacityScope(pdfPage, started);
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

function emittedShapesFor(pdfPage: PDFPage): Map<string, number> {
  let shapes = emittedShapesByPage.get(pdfPage);
  if (!shapes) {
    shapes = new Map<string, number>();
    emittedShapesByPage.set(pdfPage, shapes);
  }
  return shapes;
}

function edgeShapeKey(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: RgbColor | undefined,
  dashArray: number[] | undefined,
  opacity: number | undefined
): string {
  const a: [number, number] = [roundToHundredth(x1), roundToHundredth(y1)];
  const b: [number, number] = [roundToHundredth(x2), roundToHundredth(y2)];
  const forward = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const [start, end] = forward ? [a, b] : [b, a];
  return [
    start[0],
    start[1],
    end[0],
    end[1],
    color?.r ?? 0,
    color?.g ?? 0,
    color?.b ?? 0,
    (dashArray ?? []).map(roundToHundredth).join(','),
    opacity ?? 1,
  ].join('|');
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
  const authoredThickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const thickness = effectiveStrokeWidth(edge);
  if (!Number.isFinite(thickness) || thickness <= 0) return;
  const { r: red, g: green, b: blue } = edge.color ?? { r: 0, g: 0, b: 0 };
  const dashArray = dashArrayForStyle(edge.style, authoredThickness);

  const seenShapes = emittedShapesFor(pdfPage);
  const sides: Array<[number, number, number, number]> = [
    [x, y + h, x + w, y + h],
    [x, y, x + w, y],
    [x + w, y + h, x + w, y],
    [x, y + h, x, y],
  ];
  const shapes = sides.map(([x1, y1, x2, y2]) =>
    edgeShapeKey(x1, y1, x2, y2, edge.color, dashArray, edge.opacity)
  );
  if (shapes.every((shape) => seenShapes.has(shape))) return;
  const mixedThickness = shapes.some((shape) => {
    const painted = seenShapes.get(shape);
    return painted !== undefined && painted !== thickness;
  });
  if (mixedThickness) {
    for (const [x1, y1, x2, y2] of sides) drawEdge(pdfPage, edge, x1, y1, x2, y2);
    return;
  }

  const started = beginOpacityScope(pdfPage, { stroke: edge.opacity });
  pdfPage.pushOperators(
    pushGraphicsState(),
    setStrokingRgbColor(red / 255, green / 255, blue / 255),
    setLineWidth(thickness),
    setLineCap(xfaCapToPdf(edge.cap)),
    setLineJoin(xfaJoinToPdf(edge.join)),
    setDashPattern(dashArray ?? [], 0),
    rectangle(x, y, w, h),
    strokePath(),
    popGraphicsState()
  );
  endOpacityScope(pdfPage, started);
  for (const shape of shapes) seenShapes.set(shape, thickness);
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
  const authoredThickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const thickness = effectiveStrokeWidth(edge);
  if (!Number.isFinite(thickness) || thickness <= 0) return;
  const [tl0, tr0, br0, bl0] = radii;
  const tl = clampCornerRadius(tl0 ?? 0, w, h);
  const tr = clampCornerRadius(tr0 ?? 0, w, h);
  const br = clampCornerRadius(br0 ?? 0, w, h);
  const bl = clampCornerRadius(bl0 ?? 0, w, h);
  const { r: red, g: green, b: blue } = edge.color ?? { r: 0, g: 0, b: 0 };
  const dashArray = dashArrayForStyle(edge.style, authoredThickness);
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

export function drawUnderlineInValueArea(
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
  if (
    !bottom ||
    bottom.presence === 'hidden' ||
    bottom.presence === 'invisible' ||
    bottom.style === 'none'
  ) {
    drawBorderBox(pdfPage, border, pos, pageH);
    return;
  }
  if (
    border.fill?.color &&
    border.fill.presence !== 'hidden' &&
    border.fill.presence !== 'invisible'
  ) {
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
