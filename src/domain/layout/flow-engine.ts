import { LayoutNode, SubformNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';

export type FlowDirection = 'tb' | 'lr' | 'rl';

function childHAlign(node: LayoutNode): string | undefined {
  if (node.type === 'field') return node.para?.hAlign ?? node.ui?.hAlign;
  return undefined;
}

function childVAlign(node: LayoutNode): string | undefined {
  if (node.type === 'field') return node.para?.vAlign ?? node.ui?.vAlign;
  if (node.type === 'draw') return node.para?.vAlign;
  return undefined;
}

function alignOffset(align: string | undefined, slot: number, extent: number, axis: 'h' | 'v'): number {
  const free = slot - extent;
  if (free <= 0) return 0;
  const a = (align ?? (axis === 'h' ? 'left' : 'top')).toLowerCase();
  if (a === 'center' || a === 'middle') return free / 2;
  if (a === 'right' || a === 'bottom') return free;
  return 0;
}

function declaredWidth(node: LayoutNode): number | undefined {
  const pos = node.position;
  if (!pos) return undefined;
  const rotate = pos.rotate;
  if (rotate != null) {
    const r = ((rotate % 360) + 360) % 360;
    if (r === 90 || r === 270) return pos.h ?? pos.minH ?? pos.maxH;
  }
  if (node.type === 'field' || node.type === 'draw') return pos.w;
  if (node.type === 'subform' || node.type === 'exclGroup') return pos.w;
  return undefined;
}

export function layoutFlowSubform(
  node: SubformNode,
  ctx: LayoutContext,
  direction: FlowDirection,
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
  const children: LayoutNode[] = [];
  let usedHeight = 0;

  if (direction === 'tb') {
    let yOffset = 0;
    for (const child of node.children) {
      const cw = declaredWidth(child) ?? contentW;
      const childX = baseX + alignOffset(childHAlign(child), contentW, cw, 'h');
      const result = layoutChild(child, { x: childX, y: baseY + yOffset, availableWidth: contentW });
      children.push(result.node);
      yOffset += result.height;
    }
    usedHeight = yOffset;
  } else {
    let xOffset = 0;
    let yOffset = 0;
    let lineHeight = 0;
    for (const child of node.children) {
      const authored = declaredWidth(child);
      const cw = authored ?? Math.max(0, contentW - xOffset);
      if (authored !== undefined && xOffset > 0 && cw > 0 && xOffset + cw > contentW + 1e-6) {
        yOffset += lineHeight;
        xOffset = 0;
        lineHeight = 0;
      }
      const childX = direction === 'rl' ? baseX + contentW - xOffset - cw : baseX + xOffset;

      const childCtx = {
        x: childX,
        y: baseY + yOffset,
        availableWidth: cw,
        widthFromText: authored === undefined,
      };
      let result = layoutChild(child, childCtx);
      const vOff = alignOffset(childVAlign(child), Math.max(result.height, lineHeight), result.height, 'v');
      if (vOff > 0) {
        result = layoutChild(child, { ...childCtx, y: baseY + yOffset + vOff });
      }
      children.push(result.node);
      const advance = authored ?? result.node.position?.w ?? cw;
      xOffset += advance;
      lineHeight = Math.max(lineHeight, vOff + result.height);
    }
    usedHeight = yOffset + lineHeight;
  }

  const height = resolveSubformHeight(node.position, usedHeight + mTop + mBottom);
  return {
    node: {
      ...node,
      children,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as SubformNode,
    height,
  };
}

export function layoutRootFlow(
  nodes: LayoutNode[],
  ctx: LayoutContext,
  layoutChild: ChildLayouter
): LayoutNode[] {
  const result: LayoutNode[] = [];
  let yOffset = 0;
  for (const child of nodes) {
    const r = layoutChild(child, { ...ctx, y: ctx.y + yOffset });
    result.push(r.node);
    yOffset += r.height;
  }
  return result;
}
