import { LayoutNode, SubformNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent } from './sizing';

// ─── Flow engine (tb / lr / rl-tb) ────────────────────────────────────────
// evidence: engine dispatch — layout enums 0,1,2 (lr-tb, rl-tb, tb) select
// XFAFlowLayout, xfalayout_disasm.c:15853-15926; child placement + cursor
// advance at FUN_1854e9e0 (:51943); commit+alignment FUN_1854cf00 (:50374:
// hAlign/vAlign from the node's 0x215/0x2cf properties; box-model geometry
// :23440-23560 — left/center/right → start/mid/end offsets).

export type FlowDirection = 'tb' | 'lr' | 'rl';

function childHAlign(node: LayoutNode): string | undefined {
  if (node.type === 'field') return node.para?.hAlign ?? node.ui?.hAlign;
  return undefined;
}

function childVAlign(node: LayoutNode): string | undefined {
  if (node.type === 'field') return node.para?.vAlign ?? node.ui?.vAlign;
  return undefined;
}

function alignOffset(align: string | undefined, slot: number, extent: number, axis: 'h' | 'v'): number {
  const free = slot - extent;
  if (free <= 0) return 0;
  const a = (align ?? (axis === 'h' ? 'left' : 'top')).toLowerCase();
  if (a === 'center') return free / 2;
  if (a === 'right' || a === 'bottom') return free;
  return 0;
}

function declaredWidth(node: LayoutNode): number | undefined {
  if (node.type === 'field' || node.type === 'draw') return node.position?.w;
  if (node.type === 'subform' || node.type === 'exclGroup') return node.position?.w;
  return undefined;
}

/**
 * Stack children along the flow axis inside the subform's content box.
 *
 * tb: children stacked downward; children narrower than the box are offset
 *     horizontally per their hAlign (default start).
 * lr: children placed left-to-right on a shared line; children shorter than
 *     the line are offset vertically per vAlign (default top).
 * rl: like lr but the line runs right-to-left.
 *
 * The subform's own box: w = declared or available width; h = declared
 * (fixed) or the used flow extent, clamped by minH/maxH
 * (xfatemplate_disasm.c:8510-8700).
 */
export function layoutFlowSubform(
  node: SubformNode,
  ctx: LayoutContext,
  direction: FlowDirection,
  layoutChild: ChildLayouter
): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  // Content box inside the container's margin insets (same convention as the
  // position engine: children flow from the content origin).
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
    // lr / rl: children run along the line and wrap to the next line when
    // they no longer fit (XFAFlowLayout line breaking, FUN_1854e9e0).
    let xOffset = 0;
    let yOffset = 0;
    let lineHeight = 0;
    for (const child of node.children) {
      const cw = declaredWidth(child) ?? Math.max(0, contentW - xOffset);
      if (xOffset > 0 && cw > 0 && xOffset + cw > contentW + 1e-6) {
        // Wrap: commit the current line and restart at the content origin.
        yOffset += lineHeight;
        xOffset = 0;
        lineHeight = 0;
      }
      const childX = direction === 'rl' ? baseX + contentW - xOffset - cw : baseX + xOffset;

      // First pass at line-top to learn the child's height, then re-place at
      // its vAlign offset when the line is taller than the child (top-aligned
      // children — the common case — only lay out once).
      let result = layoutChild(child, { x: childX, y: baseY + yOffset, availableWidth: cw });
      const vOff = alignOffset(childVAlign(child), Math.max(result.height, lineHeight), result.height, 'v');
      if (vOff > 0) {
        result = layoutChild(child, { x: childX, y: baseY + yOffset + vOff, availableWidth: cw });
      }
      children.push(result.node);
      xOffset += cw;
      lineHeight = Math.max(lineHeight, vOff + result.height);
    }
    usedHeight = yOffset + lineHeight;
  }

  const height = resolveExtent(node.position, 'height', usedHeight + mTop + mBottom);
  return {
    node: {
      ...node,
      children,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as SubformNode,
    height,
  };
}

/**
 * Stack a bare list of top-level nodes vertically (the document root has no
 * subform wrapper — LayoutModel.children sits directly on the model).
 */
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
