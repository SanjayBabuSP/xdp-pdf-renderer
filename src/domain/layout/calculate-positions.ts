import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, AbsolutePosition } from '../../types';
import { success } from '../../lib/result-type';

interface PositionContext {
  x: number;
  y: number;
  availableWidth: number;
}

/** Resolve all layout positions to absolute coordinates in points. */
export function calculatePositions(layout: LayoutModel): Result<LayoutModel> {
  const positioned = {
    ...layout,
    pages: layout.pages.map((page) => {
      const ctx: PositionContext = {
        x: page.contentArea.x,
        y: page.contentArea.y,
        availableWidth: page.contentArea.w,
      };
      return {
        ...page,
        children: positionNodes(layout.children, ctx).nodes,
      };
    }),
  };
  return success(positioned);
}

function positionNodes(
  nodes: LayoutNode[],
  ctx: PositionContext
): { nodes: LayoutNode[]; usedHeight: number } {
  const result: LayoutNode[] = [];
  let yOffset = 0;

  for (const node of nodes) {
    const { positionedNode, height } = positionNode(node, { ...ctx, y: ctx.y + yOffset });
    result.push(positionedNode);
    yOffset += height;
  }

  return { nodes: result, usedHeight: yOffset };
}

function positionNode(
  node: LayoutNode,
  ctx: PositionContext
): { positionedNode: LayoutNode; height: number } {
  if (node.type === 'subform') return positionSubform(node, ctx);
  if (node.type === 'field') return positionField(node, ctx);
  if (node.type === 'draw') return positionDraw(node, ctx);
  return { positionedNode: node, height: 0 };
}

function positionSubform(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  if (node.layout === 'table') return positionTable(node, ctx);
  if (node.layout === 'lr') return positionLrSubform(node, ctx);
  return positionTbSubform(node, ctx);
}

function positionTbSubform(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  const { nodes, usedHeight } = positionNodes(node.children, ctx);
  return {
    positionedNode: { ...node, children: nodes } as SubformNode,
    height: usedHeight,
  };
}

function positionLrSubform(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  const result: LayoutNode[] = [];
  let xOffset = 0;
  let maxHeight = 0;

  for (const child of node.children) {
    const childCtx = { ...ctx, x: ctx.x + xOffset };
    const { positionedNode, height } = positionNode(child, childCtx);
    result.push(positionedNode);
    const childWidth = getNodeWidth(child) ?? 0;
    xOffset += childWidth;
    if (height > maxHeight) maxHeight = height;
  }

  return {
    positionedNode: { ...node, children: result } as SubformNode,
    height: maxHeight,
  };
}

function positionTable(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  const colWidths = node.columnWidths ?? [];
  const result: LayoutNode[] = [];
  let yOffset = 0;

  for (const child of node.children) {
    if (child.type === 'subform' && child.layout === 'row') {
      const { positionedNode, height } = positionTableRow(child, ctx, yOffset, colWidths);
      result.push(positionedNode);
      yOffset += height;
    } else {
      const { positionedNode, height } = positionNode(child, { ...ctx, y: ctx.y + yOffset });
      result.push(positionedNode);
      yOffset += height;
    }
  }

  return { positionedNode: { ...node, children: result } as SubformNode, height: yOffset };
}

function positionTableRow(
  row: SubformNode,
  ctx: PositionContext,
  yOffset: number,
  colWidths: number[]
): { positionedNode: SubformNode; height: number } {
  const result: LayoutNode[] = [];
  let xOffset = 0;
  let maxHeight = 0;

  row.children.forEach((cell, i) => {
    const colWidth = colWidths[i] ?? ctx.availableWidth / Math.max(row.children.length, 1);
    const cellCtx = { x: ctx.x + xOffset, y: ctx.y + yOffset, availableWidth: colWidth };
    const { positionedNode, height } = positionNode(cell, cellCtx);
    result.push(positionedNode);
    xOffset += colWidth;
    if (height > maxHeight) maxHeight = height;
  });

  return { positionedNode: { ...row, children: result } as SubformNode, height: Math.max(maxHeight, 18) };
}

function positionField(
  node: FieldNode,
  ctx: PositionContext
): { positionedNode: FieldNode; height: number } {
  const h = node.position?.h ?? node.position?.minH ?? 18;
  const w = node.position?.w ?? ctx.availableWidth;
  const absPos: AbsolutePosition = { x: ctx.x, y: ctx.y, w, h };
  return {
    positionedNode: { ...node, position: { ...node.position, x: ctx.x, y: ctx.y, w, h } } as FieldNode,
    height: h,
  };
  void absPos;
}

function positionDraw(
  node: DrawNode,
  ctx: PositionContext
): { positionedNode: DrawNode; height: number } {
  const h = node.position?.h ?? 18;
  const w = node.position?.w ?? ctx.availableWidth;
  return {
    positionedNode: { ...node, position: { ...node.position, x: ctx.x, y: ctx.y, w, h } } as DrawNode,
    height: h,
  };
}

function getNodeWidth(node: LayoutNode): number | undefined {
  if (node.type === 'field') return node.position?.w;
  if (node.type === 'draw') return node.position?.w;
  return undefined;
}
