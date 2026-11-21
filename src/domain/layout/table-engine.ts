import { LayoutNode, SubformNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';
import { calculateTableLayout } from './calculate-table-layout';

function isRow(node: LayoutNode): boolean {
  return node.type === 'subform' && (node.layout === 'row' || node.layout === 'rl-row');
}

function cellColSpan(node: LayoutNode): number {
  const span = (node as { colSpan?: number }).colSpan;
  return Math.max(1, span ?? 1);
}

function spanWidth(
  colWidths: number[],
  col: number,
  span: number,
  availableWidth: number,
  colCount: number
): number {
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
    result.node.position = { ...result.node.position, w: cw };
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

  const rowHeight = hasContentCell ? contentHeight : maxHeight;
  const width = resolveExtent(row.position, 'width', xOffset);
  const uniformChildren = children.map((child) => ({
    ...child,
    position: { ...child.position, h: rowHeight },
  }));
  return {
    node: {
      ...row,
      children: row.layout === 'rl-row' ? uniformChildren.reverse() : uniformChildren,
      position: { ...row.position, x: ctx.x, y: ctx.y + yOffset, w: width, h: rowHeight },
    } as SubformNode,
    height: rowHeight,
  };
}

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
    const rowHeight = Math.max(result.height, (7 * 72) / 25.4);
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
  const colWidths = calculateTableLayout(node, contentW).columnWidths;
  const children: LayoutNode[] = [];
  let yOffset = 0;

  for (const child of node.children) {
    if (isRow(child)) {
      const r = layoutRow(
        child as SubformNode,
        { ...ctx, x: baseX, y: baseY, availableWidth: contentW },
        yOffset,
        colWidths,
        layoutChild
      );
      children.push(r.node);
      yOffset += r.height;
    } else if (child.type === 'subform' && child.isSubformSet) {
      const r = layoutSubformSetRows(
        child,
        { ...ctx, x: baseX, y: baseY, availableWidth: contentW },
        yOffset,
        colWidths,
        layoutChild
      );
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
