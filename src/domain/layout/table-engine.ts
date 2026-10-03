import { LayoutNode, SubformNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent } from './sizing';

// ─── Table engine (table / row / rl-row) ──────────────────────────────────
// evidence: layout enums 0x1b0004 (table) select XFATableLayout, row/rl-row
// (0x1b0005/0x1b0006) are table children — legal inside a table, warn+position
// outside (xfalayout_disasm.c:49800-49900 coercion, warn 0x72a6).
// Row height = tallest cell (plan Phase 2 task 6: remove the hard floor of 18).

function isRow(node: LayoutNode): boolean {
  return node.type === 'subform' && (node.layout === 'row' || node.layout === 'rl-row');
}

function cellColSpan(node: LayoutNode): number {
  if (node.type === 'field') return Math.max(1, node.colSpan ?? 1);
  return 1;
}

/** Width of `span` columns starting at `col` given declared column widths. */
function spanWidth(colWidths: number[], col: number, span: number, availableWidth: number, colCount: number): number {
  let w = 0;
  for (let j = col; j < col + span && j < colWidths.length; j++) {
    w += colWidths[j];
  }
  if (w > 0) return w;
  const unit = colCount > 0 ? availableWidth / colCount : availableWidth / Math.max(span, 1);
  return unit * span;
}

function layoutRow(
  row: SubformNode,
  ctx: LayoutContext,
  yOffset: number,
  colWidths: number[],
  layoutChild: ChildLayouter
): LayoutResult {
  const colCount = Math.max(colWidths.length, 1);
  const children: LayoutNode[] = [];
  let col = 0;
  let xOffset = 0;
  let maxHeight = 0;

  const cells = row.layout === 'rl-row' ? [...row.children].reverse() : row.children;
  for (const cell of cells) {
    const span = cellColSpan(cell);
    const cw = spanWidth(colWidths, col, span, ctx.availableWidth, colCount);
    const result = layoutChild(cell, { x: ctx.x + xOffset, y: ctx.y + yOffset, availableWidth: cw });
    children.push(result.node);
    col += span;
    xOffset += cw;
    if (result.height > maxHeight) maxHeight = result.height;
  }

  const width = resolveExtent(row.position, 'width', xOffset);
  return {
    node: {
      ...row,
      children: row.layout === 'rl-row' ? children.reverse() : children,
      position: { ...row.position, x: ctx.x, y: ctx.y + yOffset, w: width, h: maxHeight },
    } as SubformNode,
    height: maxHeight,
  };
}

/** Column count = max sum of colSpans across rows (colSpan-aware occupancy). */
function countColumns(children: LayoutNode[]): number {
  let max = 0;
  for (const child of children) {
    if (!isRow(child)) continue;
    let sum = 0;
    for (const cell of (child as SubformNode).children) {
      sum += cellColSpan(cell);
    }
    if (sum > max) max = sum;
  }
  return Math.max(max, 1);
}

/**
 * Table: non-row children stack vertically (tb), row children become rows of
 * cells laid out left-to-right with colSpan occupancy.
 */
export function layoutTableSubform(
  node: SubformNode,
  ctx: LayoutContext,
  layoutChild: ChildLayouter
): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  const mLeft = node.margin?.leftInset ?? 0;
  const mRight = node.margin?.rightInset ?? 0;
  const mTop = node.margin?.topInset ?? 0;
  const mBottom = node.margin?.bottomInset ?? 0;
  const contentW = Math.max(width - mLeft - mRight, 0);
  const baseX = ctx.x + mLeft;
  const baseY = ctx.y + mTop;
  let colWidths = node.columnWidths && node.columnWidths.length > 0 ? node.columnWidths : [];
  if (colWidths.length === 0) {
    const colCount = countColumns(node.children);
    if (colCount > 0) colWidths = Array(colCount).fill(contentW / colCount);
  }
  const children: LayoutNode[] = [];
  let yOffset = 0;

  for (const child of node.children) {
    if (isRow(child)) {
      const r = layoutRow(child as SubformNode, { ...ctx, x: baseX, y: baseY, availableWidth: contentW }, yOffset, colWidths, layoutChild);
      children.push(r.node);
      yOffset += r.height;
    } else {
      const r = layoutChild(child, { x: baseX, y: baseY + yOffset, availableWidth: contentW });
      children.push(r.node);
      yOffset += r.height;
    }
  }

  const height = resolveExtent(node.position, 'height', yOffset + mTop + mBottom);
  return {
    node: {
      ...node,
      children,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as SubformNode,
    height,
  };
}
