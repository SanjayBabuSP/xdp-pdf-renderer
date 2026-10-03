import { Result, LayoutModel, LayoutNode, SubformNode } from '../../types';
import { success } from '../../lib/result-type';
import { LayoutContext, LayoutResult } from './engine-types';
import { layoutFlowSubform, layoutRootFlow } from './flow-engine';
import { layoutPositionSubform, layoutLeafField, layoutLeafDraw, layoutExclGroup } from './position-engine';
import { layoutTableSubform } from './table-engine';

// ─── Layout dispatcher ─────────────────────────────────────────────────────
// evidence: engine selection per node, xfalayout_disasm.c:15853-15926:
//   0x1b0000/1/2 (lr-tb, rl-tb, tb) → XFAFlowLayout
//   0x1b0003 (position)            → XFAPositionLayout
//   0x1b0004 (table)               → XFATableLayout
//   anything else                  → XFAPositionLayout (fallback)
// and the per-child coercion at :49800-49900: invalid layout value →
// position (warn 0x72a6), row/rl-row outside a table → illegal (position
// fallback). Legacy rl-tb→position coercion depends on a Designer legacy
// flag we don't model — rl-tb flows right-to-left here (Appendix B: flow).

/** Resolve all layout positions to absolute coordinates in page-1 content space. */
export function calculatePositions(layout: LayoutModel): Result<LayoutModel> {
  const firstPage = layout.pages[0];
  const rootCtx: LayoutContext = firstPage
    ? { x: firstPage.contentArea.x, y: firstPage.contentArea.y, availableWidth: firstPage.contentArea.w }
    : { x: 0, y: 0, availableWidth: 0 };
  // Positioned once against the first page's content area; applyPagination
  // translates each page's slice onto that page's own content-area origin.
  const children = layoutRootFlow(layout.children, rootCtx, layoutNode);
  return success({ ...layout, children });
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
      // Illegal outside a table (evidence above) — position fallback.
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
