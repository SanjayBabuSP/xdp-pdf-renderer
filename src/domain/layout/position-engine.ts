import { LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent } from './sizing';
import { paraMetrics } from '../../rendering/text/line-metrics';

// ─── Position engine ──────────────────────────────────────────────────────
// evidence: XFAPositionLayout is the fallback engine for nodes whose layout
// enum resolves to 0x1b0003 (position), and for fields/draws in any context
// — xfalayout_disasm.c:15853-15926 (dispatcher default branch) and :49800-49900
// (coercion: invalid layout value → position, warn 0x72a6).

/** Default line advance for a font size — evidence: font_disasm.c:10517 (1.2×). */
const LINE_ADVANCE = 1.2;
const DEFAULT_FONT_SIZE = 10;

function getChildX(node: LayoutNode): number {
  if (node.type === 'subform' || node.type === 'field' || node.type === 'draw' || node.type === 'exclGroup') {
    return node.position?.x ?? 0;
  }
  return 0;
}

function getChildY(node: LayoutNode): number {
  if (node.type === 'subform' || node.type === 'field' || node.type === 'draw' || node.type === 'exclGroup') {
    return node.position?.y ?? 0;
  }
  return 0;
}

function nodeWidth(node: LayoutNode): number | undefined {
  if (node.type === 'field' || node.type === 'draw') return node.position?.w;
  if (node.type === 'subform' || node.type === 'exclGroup') return node.position?.w;
  return undefined;
}

/** Margin insets of a container (0 when absent) — content origin + width. */
function containerInsets(node: { margin?: { topInset?: number; rightInset?: number; bottomInset?: number; leftInset?: number } }): {
  left: number; right: number; top: number; bottom: number;
} {
  return {
    left: node.margin?.leftInset ?? 0,
    right: node.margin?.rightInset ?? 0,
    top: node.margin?.topInset ?? 0,
    bottom: node.margin?.bottomInset ?? 0,
  };
}

function repeatIndexOf(node: LayoutNode): number | undefined {
  return (node as { repeatIndex?: number }).repeatIndex;
}

function repeatKey(node: LayoutNode): string | null {
  const idx = repeatIndexOf(node);
  if (idx == null || !node.name) return null;
  return `${node.type}:${node.name}`;
}

/**
 * Absolute ("position") subform: children at their authored x/y relative to
 * this subform's origin.
 *
 * Repeat-instance stacking: expand-repeats no longer pre-offsets instances
 * (plan Phase 2 task 2 — evidence: addInstances xfalayout_disasm.c:6028
 * inserts nodes and the engine assigns x/y); consecutive occurrence instances
 * of the same name stack vertically in flow order here, because a
 * position-layout parent has no flow cursor of its own.
 *
 * Height: explicit h fixed, else content-driven
 * max(child.y+child.h) — evidence/fix for issue #4 — clamped by
 * minH/maxH (xfatemplate_disasm.c:8510-8700).
 */
export function layoutPositionSubform(
  node: SubformNode,
  ctx: LayoutContext,
  layoutChild: ChildLayouter
): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  // Preview PDF places positioned children relative to the content origin
  // (inside the container's margin insets), not the border-box origin
  // (XFABoxModelLayout content-box geometry, xfalayout_disasm.c:23440-23560).
  const insets = containerInsets(node);
  const contentW = Math.max(width - insets.left - insets.right, 0);
  const baseX = ctx.x + insets.left;
  const baseY = ctx.y + insets.top;
  const children: LayoutNode[] = [];
  let maxY = 0;

  let runKey: string | null = null;
  let runNextY = 0;

  for (const child of node.children) {
    const key = repeatKey(child);
    const idx = repeatIndexOf(child);
    let childY: number;
    if (idx != null && idx > 0 && key != null && key === runKey) {
      childY = runNextY;
    } else {
      childY = baseY + getChildY(child);
      runKey = idx === 0 ? key : null;
      runNextY = childY;
    }

    const childCtx: LayoutContext = {
      x: baseX + getChildX(child),
      y: childY,
      availableWidth: nodeWidth(child) ?? contentW,
    };
    const result = layoutChild(child, childCtx);
    children.push(result.node);
    if (key != null && key === runKey) {
      runNextY = childY + result.height;
    }
    const extent = childY + result.height;
    if (extent > maxY) maxY = extent;
  }

  const contentExtent = Math.max(0, maxY - baseY) + insets.top + insets.bottom;
  const height = resolveExtent(node.position, 'height', contentExtent);

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
 * Caption geometry feeds growable field height: caption placement top/bottom
 * reserves `reserve` points of height (left/right/inline reserve width only).
 * evidence: XFABoxModelLayout caption extent wrappers, xfalayout_disasm.c:30620-31040
 * (getCaptionModelHeight + hasOverflowingCaptionText gate).
 */
function captionHeight(node: FieldNode): number {
  const caption = node.caption;
  if (!caption || !caption.text) return 0;
  const placement = caption.placement ?? 'left';
  if (placement === 'top' || placement === 'bottom') {
    return caption.reserve ?? (caption.font?.size ?? node.font?.size ?? DEFAULT_FONT_SIZE) * LINE_ADVANCE;
  }
  return 0;
}

/**
 * Height of a field's value block: the paragraph line advance plus any
 * `spaceAbove`/`spaceBelow` (`<para>` metrics). evidence: jfTextAttr
 * Spacing/SpaceBefore/SpaceAfter (jftext_disasm.c:3920/3852/3782).
 */
function valueLineHeight(node: FieldNode): number {
  const pm = paraMetrics(node.para, node.font?.size ?? DEFAULT_FONT_SIZE);
  return pm.lineAdvance + pm.spaceAbove + pm.spaceBelow;
}

/** Leaf field: resolve x/y/w/h with min/max clamping (plan Phase 2 task 4). */
export function layoutLeafField(node: FieldNode, ctx: LayoutContext): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  const contentExtent = captionHeight(node) + valueLineHeight(node);
  const height = resolveExtent(node.position, 'height', contentExtent);

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as FieldNode,
    height,
  };
}

/** Leaf draw: explicit h else minH else legacy 18 default (shapes need a box). */
export function layoutLeafDraw(node: DrawNode, ctx: LayoutContext): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  const height = resolveExtent(node.position, 'height', 18);

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as DrawNode,
    height,
  };
}

/** ExclGroup: fields stacked vertically (tb), box sized to content. */
export function layoutExclGroup(
  node: ExclGroupNode,
  ctx: LayoutContext,
  layoutChild: ChildLayouter
): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
  const insets = containerInsets(node);
  const contentW = Math.max(width - insets.left - insets.right, 0);
  const baseX = ctx.x + insets.left;
  const baseY = ctx.y + insets.top;
  const children: LayoutNode[] = [];
  let yOffset = 0;

  for (const child of node.children) {
    const result = layoutChild(child, { x: baseX, y: baseY + yOffset, availableWidth: contentW });
    children.push(result.node);
    yOffset += result.height;
  }

  const height = resolveExtent(node.position, 'height', yOffset + insets.top + insets.bottom);
  return {
    node: {
      ...node,
      children,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as ExclGroupNode,
    height,
  };
}

export { getChildX, getChildY };
