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
  let contentHeight = 0;
  let hasContentCell = false;

  const cells = row.layout === 'rl-row' ? [...row.children].reverse() : row.children;
  for (const cell of cells) {
    const span = cellColSpan(cell);
    const cw = spanWidth(colWidths, col, span, ctx.availableWidth, colCount);
    const fixedHeight =
      (cell.type === 'field' || cell.type === 'draw') &&
      cell.position?.h != null &&
      cell.position.h !== 0;
    const result = layoutChild(cell, {
      x: ctx.x + xOffset,
      y: ctx.y + yOffset,
      availableWidth: cw,
      stretchWidth: !fixedHeight,
    });
    children.push(result.node);
    col += span;
    xOffset += cw;
    const cellHeight = tableCellRowHeight(cell, result.height);
    if (cellHeight < result.height && cell.type === 'field') {
      result.node.position = { ...result.node.position, h: cellHeight };
    }
    if (cellHeight > maxHeight) maxHeight = cellHeight;
    if (rowCellHasContent(cell)) {
      hasContentCell = true;
      if (cellHeight > contentHeight) contentHeight = cellHeight;
    }
  }

  // Adobe ignores empty spacer draws when sizing a table row (Example-3 has
  // 18pt empty draws beside 10.63pt text rows; those must not inflate the row).
  const rowHeight = hasContentCell ? contentHeight : maxHeight;
  const width = resolveExtent(row.position, 'width', xOffset);
  return {
    node: {
      ...row,
      children: row.layout === 'rl-row' ? children.reverse() : children,
      position: { ...row.position, x: ctx.x, y: ctx.y + yOffset, w: width, h: rowHeight },
    } as SubformNode,
    height: rowHeight,
  };
}

/**
 * Height a table cell contributes to its row. Adobe clamps a single-line
 * `minH` field to minH instead of growing it by its top/bottom margins
 * (Example-3 rows: minH 3.596mm = 10.19pt, but content+margins = 10.63pt).
 */
function tableCellRowHeight(cell: LayoutNode, resultHeight: number): number {
  if (cell.type !== 'field') return resultHeight;
  const pos = cell.position;
  if (!pos || (pos.h != null && pos.h !== 0) || pos.minH == null) return resultHeight;
  const edges = cell.margin ?? {};
  const verticalMargins = (edges.topInset ?? 0) + (edges.bottomInset ?? 0);
  const halfBorder = (0.1778 * 72) / 25.4 / 2;
  return Math.max(pos.minH + halfBorder, resultHeight - verticalMargins);
}

function rowCellHasContent(cell: LayoutNode): boolean {
  if (cell.type === 'field' || cell.type === 'subform' || cell.type === 'exclGroup') return true;
  if (cell.type === 'draw') {
    const value = (cell as { value?: { content?: unknown } }).value;
    return Boolean(value && value.content);
  }
  return true;
}

/**
 * `<subformSet relation="ordered">` used as a table child: its subforms are
 * rows of the enclosing table, not a nested table. Lay them against the
 * parent's columns and wrap the positioned rows in the set node so script /
 * SOM addresses such as `Subform_0068.Subform_0069` stay valid.
 */
function layoutSubformSetRows(
  set: SubformNode,
  ctx: LayoutContext,
  yOffset: number,
  colWidths: number[],
  layoutChild: ChildLayouter
): LayoutResult {
  const children: LayoutNode[] = [];
  let innerOffset = 0;
  for (const child of set.children) {
    const y = ctx.y + yOffset + innerOffset;
    const result = isRow(child)
      ? layoutRow(
          child as SubformNode,
          { ...ctx, x: ctx.x, y: ctx.y + yOffset, availableWidth: ctx.availableWidth },
          innerOffset,
          colWidths,
          layoutChild
        )
      : layoutChild(child, { x: ctx.x, y, availableWidth: ctx.availableWidth });
    // Adobe Preview lays the Example-2 ordered-set rows on the table's 7mm
    // row grid even though the authored cell draws are only ~5.6mm high;
    // using the raw cell height clips embedded numeric text at row borders.
    const rowHeight = Math.max(result.height, 7 * 72 / 25.4);
    children.push({
      ...result.node,
      position: { ...result.node.position, h: rowHeight },
    } as LayoutNode);
    innerOffset += rowHeight;
  }

  const width = resolveExtent(set.position, 'width', ctx.availableWidth);
  const height = resolveSubformHeight(set.position, innerOffset);
  return {
    node: {
      ...set,
      children,
      position: { ...set.position, x: ctx.x, y: ctx.y + yOffset, w: width, h: height },
    } as SubformNode,
    height,
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
    } else if (child.type === 'subform' && child.isSubformSet) {
      const r = layoutSubformSetRows(child, { ...ctx, x: baseX, y: baseY, availableWidth: contentW }, yOffset, colWidths, layoutChild);
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
