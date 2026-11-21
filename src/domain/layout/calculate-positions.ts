import { Result, LayoutModel, LayoutNode, SubformNode } from '../../types';
import { success } from '../../lib/result-type';
import { LayoutContext, LayoutResult } from './engine-types';
import { layoutFlowSubform, layoutRootFlow } from './flow-engine';
import { layoutPositionSubform, layoutLeafField, layoutLeafDraw, layoutExclGroup } from './position-engine';
import { layoutTableSubform } from './table-engine';

export function calculatePositions(layout: LayoutModel): Result<LayoutModel> {
  const firstPage = layout.pages[0];
  const rootCtx: LayoutContext = firstPage
    ? { x: firstPage.contentArea.x, y: firstPage.contentArea.y, availableWidth: firstPage.contentArea.w }
    : { x: 0, y: 0, availableWidth: 0 };
  const children = layoutRootFlow(layout.children, rootCtx, layoutNode);
  const pages = layout.pages.map((page) => ({
    ...page,
    masterPageChildren: page.masterPageChildren.map((child) => {
      const positioned =
        child.type === 'subform' &&
        (child.layout === 'position' || child.layout === undefined);
      const ctx: LayoutContext = positioned
        ? { x: 0, y: 0, availableWidth: page.contentArea.w }
        : {
            x: child.position?.x ?? 0,
            y: child.position?.y ?? 0,
            availableWidth: page.contentArea.w,
          };
      return layoutNode(child, ctx).node;
    }),
  }));
  return success({ ...layout, pages, children });
}

function layoutNode(node: LayoutNode, ctx: LayoutContext): LayoutResult {
  if (node.type === 'field') return layoutLeafField(node, ctx);
  if (node.type === 'draw') return layoutLeafDraw(node, ctx);
  if (node.type === 'exclGroup') return layoutExclGroup(node, ctx, layoutNode);
  return layoutSubform(node, ctx);
}

function layoutSubform(node: SubformNode, ctx: LayoutContext): LayoutResult {
  const mode = node.layout ?? 'position';
  switch (mode) {
    case 'table':
      return layoutTableSubform(node, ctx, layoutNode);
    case 'row':
    case 'rl-row':
      return layoutPositionSubform(node, ctx, layoutNode);
    case 'tb':
      return layoutFlowSubform(node, ctx, 'tb', layoutNode);
    case 'lr-tb':
    case 'lr':
      return layoutFlowSubform(node, ctx, 'lr', layoutNode);
    case 'rl-tb':
      return layoutFlowSubform(node, ctx, 'rl', layoutNode);
    case 'position':
    default:
      return layoutPositionSubform(node, ctx, layoutNode);
  }
}
