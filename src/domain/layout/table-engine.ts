import { LayoutNode, SubformNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';
import { calculateTableLayout } from './calculate-table-layout';

// ─── Table engine (table / row / rl-row) ──────────────────────────────────
// evidence: layout enums 0x1b0004 (table) select XFATableLayout, row/rl-row
// (0x1b0005/0x1b0006) are table children — legal inside a table, warn+position
// outside (xfalayout_disasm.c:49800-49900 coercion, warn 0x72a6).
// Row height = tallest cell (plan Phase 2 task 6: remove the hard floor of 18).

function isRow(node: LayoutNode): boolean {
  return node.type === 'subform' && (node.layout === 'row' || node.layout === 'rl-row');
}

function cellColSpan(node: LayoutNode): number {
  // evidence: Example-1 rows put colSpan on draws (draw colSpan 9 + field
  // colSpan 2 + 8× field colSpan 3); ignoring non-field spans shifts every
  // later cell left of Adobe's position.
  const span = (node as { colSpan?: number }).colSpan;
  return Math.max(1, span ?? 1);
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
  // Single source of truth for column widths (attr + cell-driven auto slots);
  // applyTableLayouts stamps the same values earlier, recomputing here is
  // idempotent and covers direct engine use.
  const colWidths = calculateTableLayout(node, contentW).columnWidths;
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

  const height = resolveSubformHeight(node.position, yOffset + mTop + mBottom);
  return {
    node: {
      ...node,
      children,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as SubformNode,
    height,
  };
}
