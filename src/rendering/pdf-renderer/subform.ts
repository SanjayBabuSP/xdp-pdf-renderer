import type { PDFPage } from 'pdf-lib';
import type {
  BorderSpec,
  EdgeSpec,
  ExclGroupNode,
  LayoutNode,
  PaginatedPage,
  RenderOptions,
  SubformNode,
} from '../../types';
import { effectiveStrokeWidth, halfStrokeWidth } from '../border-style';
import type { FontManager } from '../font-manager';
import { applyPageTransparencyGroup } from '../pdf-lowlevel';
import { drawBorderBox } from './border-fill';
import { renderDraw } from './draw';
import { renderField } from './field';

export async function renderPage(
  pdfPage: PDFPage,
  page: PaginatedPage,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex: number,
  totalPages: number
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
  totalPages = 1
): Promise<void> {
  if (!options.previewMode) {
    if (node.presence === 'invisible' || node.presence === 'hidden' || node.presence === 'inactive')
      return;
  }
  if (node.type === 'draw') return renderDraw(pdfPage, node, pageH, fontManager, pageIndex);
  if (node.type === 'field') return renderField(pdfPage, node, pageH, fontManager, options.locale);
  if (node.type === 'subform')
    return renderSubform(pdfPage, node, pageH, fontManager, options, pageIndex, totalPages);
  if (node.type === 'exclGroup') return renderExclGroup(pdfPage, node, pageH, fontManager, options);
}

async function renderSubform(
  pdfPage: PDFPage,
  node: SubformNode,
  pageH: number,
  fontManager: FontManager,
  options: RenderOptions,
  pageIndex = 0,
  totalPages = 1
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
  if (pos.x === undefined || pos.y === undefined || pos.w === undefined || pos.h === undefined)
    return border;
  const edges = border.edges;
  if (!edges || edges.length === 0) return border;
  const norm: Array<EdgeSpec | undefined> =
    edges.length === 1
      ? [edges[0], edges[0], edges[0], edges[0]]
      : [edges[0], edges[1], edges[2], edges[3]];
  const visible = (e: EdgeSpec | undefined): boolean =>
    !!e && e.presence !== 'hidden' && e.presence !== 'invisible' && e.style !== 'none';
  const subBottomVisible = visible(norm[2]);
  const subTopVisible = visible(norm[0]);
  if (!subBottomVisible && !subTopVisible) return border;

  let suppressBottom = false;
  let suppressTop = false;
  if (subBottomVisible) {
    const subBottom = (pos.y ?? 0) + (pos.h ?? 0);
    const intervals: Array<{ left: number; right: number; tolerance: number }> = [];
    for (const child of node.children) {
      if (!isVisibleChild(child)) continue;
      const cp = (child as { position?: { x?: number; y?: number; w?: number; h?: number } })
        .position;
      if (
        !cp ||
        cp.x === undefined ||
        cp.y === undefined ||
        cp.w === undefined ||
        cp.h === undefined
      )
        continue;
      const childBottom = cp.y + cp.h;
      const childEdge = childEdgeVisible(child, 2, norm[2]);
      if (!childEdge) continue;
      if (Math.abs(childBottom - subBottom) > coincidenceTolerance(norm[2], childEdge)) continue;
      intervals.push({
        left: cp.x,
        right: cp.x + cp.w,
        tolerance: gapTolerance(norm[2], childEdge),
      });
    }
    suppressBottom = coverXSpan(intervals, pos.x ?? 0, pos.w ?? 0);
  }
  if (subTopVisible) {
    const subTop = pos.y ?? 0;
    const intervals: Array<{ left: number; right: number; tolerance: number }> = [];
    for (const child of node.children) {
      if (!isVisibleChild(child)) continue;
      const cp = (child as { position?: { x?: number; y?: number; w?: number; h?: number } })
        .position;
      if (!cp || cp.x === undefined || cp.y === undefined || cp.w === undefined) continue;
      const childTop = cp.y;
      const childEdge = childEdgeVisible(child, 0, norm[0]);
      if (!childEdge) continue;
      if (Math.abs(childTop - subTop) > coincidenceTolerance(norm[0], childEdge)) continue;
      intervals.push({
        left: cp.x,
        right: cp.x + cp.w,
        tolerance: gapTolerance(norm[0], childEdge),
      });
    }
    suppressTop = coverXSpan(intervals, pos.x ?? 0, pos.w ?? 0);
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

function isVisibleChild(child: LayoutNode): boolean {
  return child.presence === undefined || child.presence === 'visible';
}

function coincidenceTolerance(parentEdge: EdgeSpec | undefined, childEdge: EdgeSpec): number {
  return halfStrokeWidth(parentEdge) + halfStrokeWidth(childEdge);
}

function gapTolerance(parentEdge: EdgeSpec | undefined, childEdge: EdgeSpec): number {
  return effectiveStrokeWidth(parentEdge) + effectiveStrokeWidth(childEdge);
}

function childEdgeVisible(
  child: LayoutNode,
  index: number,
  parentEdge: EdgeSpec | undefined
): EdgeSpec | undefined {
  const border = (child as { border?: BorderSpec }).border;
  if (!border || border.presence === 'hidden' || border.presence === 'invisible') return undefined;
  const edges = border.edges;
  if (!edges || edges.length === 0) return undefined;
  const edge: EdgeSpec | undefined = edges.length === 1 ? edges[0] : edges[index];
  if (!edge || edge.presence === 'hidden' || edge.presence === 'invisible' || edge.style === 'none')
    return undefined;
  return effectiveStrokeWidth(edge) >= effectiveStrokeWidth(parentEdge) ? edge : undefined;
}

function coverXSpan(
  intervals: Array<{ left: number; right: number; tolerance: number }>,
  x: number,
  w: number
): boolean {
  if (intervals.length === 0 || w <= 0) return false;
  let tolerance = 0;
  for (const interval of intervals) tolerance = Math.max(tolerance, interval.tolerance);
  const sorted = [...intervals].sort((a, b) => a.left - b.left);
  let reach = x;
  for (const interval of sorted) {
    if (interval.right <= reach) continue;
    if (interval.left > reach + tolerance) break;
    reach = Math.max(reach, interval.right);
  }
  return reach >= x + w - tolerance;
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
