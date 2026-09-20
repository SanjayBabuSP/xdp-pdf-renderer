import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, AbsolutePosition } from '../../types';
import { success } from '../../lib/result-type';

interface PositionContext {
  x: number;
  y: number;
  availableWidth: number;
}

/** Resolve all layout positions to absolute coordinates in points. */
export function calculatePositions(layout: LayoutModel): Result<LayoutModel> {
  const firstPage = layout.pages[0];
  const rootCtx: PositionContext = firstPage
    ? { x: firstPage.contentArea.x, y: firstPage.contentArea.y, availableWidth: firstPage.contentArea.w }
    : { x: 0, y: 0, availableWidth: 0 };
  // Positioned once against the first page's content area; applyPagination re-flows these onto later pages.
  const positionedChildren = positionNodes(layout.children, rootCtx).nodes;

  const positioned = {
    ...layout,
    children: positionedChildren,
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
  if (node.type === 'exclGroup') return positionExclGroup(node, ctx);
  return { positionedNode: node, height: 0 };
}

function positionSubform(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  if (node.layout === 'table') return positionTable(node, ctx);
  if (node.layout === 'lr') return positionLrSubform(node, ctx);
  if (node.layout === 'position') return positionAbsoluteSubform(node, ctx);
  return positionTbSubform(node, ctx);
}

/**
 * XFA's default layout ("position") places each child at its own explicit x/y, relative to this
 * subform's origin (ctx.x/ctx.y, already resolved by the caller), rather than flowing them one
 * after another. The subform's own height comes from its declared h/minH, not from summing
 * children (they may overlap or be sparse).
 */
function positionAbsoluteSubform(
  node: SubformNode,
  ctx: PositionContext
): { positionedNode: SubformNode; height: number } {
  const width = node.position?.w ?? ctx.availableWidth;

  const children = node.children.map((child) => {
    const childCtx: PositionContext = {
      x: ctx.x + getChildX(child),
      y: ctx.y + getChildY(child),
      availableWidth: getNodeWidth(child) ?? width,
    };
    return positionNode(child, childCtx).positionedNode;
  });

  const height = node.position?.h ?? node.position?.minH ?? 0;
  return {
    positionedNode: { ...node, children, position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height } } as SubformNode,
    height,
  };
}

function getChildX(node: LayoutNode): number {
  return node.type === 'subform' || node.type === 'field' || node.type === 'draw' ? node.position?.x ?? 0 : 0;
}

function getChildY(node: LayoutNode): number {
  return node.type === 'subform' || node.type === 'field' || node.type === 'draw' ? node.position?.y ?? 0 : 0;
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

function positionExclGroup(
  node: ExclGroupNode,
  ctx: PositionContext
): { positionedNode: ExclGroupNode; height: number } {
  // ExclGroup's children are fields laid out vertically
  const result: FieldNode[] = [];
  let yOffset = 0;
  for (const child of node.children) {
    const { positionedNode, height } = positionField(child, { ...ctx, y: ctx.y + yOffset });
    result.push(positionedNode);
    yOffset += height;
  }
  return {
    positionedNode: { ...node, children: result, position: { ...node.position, x: ctx.x, y: ctx.y } },
    height: yOffset,
  };
}

function getNodeWidth(node: LayoutNode): number | undefined {
  if (node.type === 'field') return node.position?.w;
  if (node.type === 'draw') return node.position?.w;
  return undefined;
}
