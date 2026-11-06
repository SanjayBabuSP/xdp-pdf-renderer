import { LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';
import { paraMetrics } from '../../rendering/text/line-metrics';
import { breakLinesInfo } from '../../rendering/text/line-breaker';
import { resolveChoiceText } from '../../rendering/ui-values';
import { parseRichText, textRunsToPlainText } from '../../rendering/rich-text-parser';
import { formatValue } from '../../lib/value-format';
import { measureLayoutText } from './text-measure';

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
      // Positioned leaves with only minW must not stretch to the container.
      widthFromContent: true,
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
  const height = resolveSubformHeight(node.position, contentExtent);

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
  const contentExtent =
    ctx.widthFromContent && node.position?.w == null
      ? node.position?.minW ?? ctx.availableWidth
      : ctx.widthFromText && node.position?.w == null
        ? fieldContentWidth(node)
        : ctx.availableWidth;
  const width = resolveExtent(
    ctx.stretchWidth ? { ...node.position, w: undefined } : node.position,
    'width',
    contentExtent
  );
  const contentExtentH =
    captionHeight(node) + nodeValueHeight(node, width);
  const height = resolveExtent(node.position, 'height', contentExtentH);

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as FieldNode,
    height,
  };
}

/** Content width for an auto-width field in a flow line (lr-tb/rl-tb). */
function fieldContentWidth(node: FieldNode): number {
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
  const value = node.ui?.type === 'choiceList'
    ? resolveChoiceText(node.resolvedValue, node.ui.items)
    : formatValue(node.resolvedValue, node.formatPicture);
  const valueWidth = value ? measureLayoutText(value, fontSize, node.font) : 0;

  let captionWidth = 0;
  if (node.caption?.text) {
    const capSize = node.caption.font?.size ?? fontSize;
    captionWidth =
      node.caption.reserve ??
      measureLayoutText(node.caption.text, capSize, node.caption.font ?? node.font);
  }

  return (
    (node.margin?.leftInset ?? 0) +
    (node.margin?.rightInset ?? 0) +
    pm.marginLeft +
    pm.marginRight +
    captionWidth +
    valueWidth
  );
}

/**
 * Height of a field's value block including box margins. Multi-line textEdit
 * fields grow to their wrapped line count; XFA/Adobe does not clip a
 * growable row to its `minH` (`Subform_0077` list rows in Example-2 are 1–3
 * lines tall even though the field declares `minH="7mm"`).
 */
function nodeValueHeight(node: FieldNode, width: number): number {
  const top = node.margin?.topInset ?? 0;
  const bottom = node.margin?.bottomInset ?? 0;
  const left = node.margin?.leftInset ?? 0;
  const right = node.margin?.rightInset ?? 0;
  const reserve = node.caption?.reserve ?? 0;
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);

  const value = node.ui?.type === 'choiceList'
    ? resolveChoiceText(node.resolvedValue, node.ui.items)
    : formatValue(node.resolvedValue, node.formatPicture);
  if (!value) return top + bottom + valueLineHeight(node);

  const innerWidth = Math.max(width - left - right - reserve - pm.marginLeft - pm.marginRight, 0);
  const wrapWidth = node.ui?.multiLine === true ? innerWidth : Number.POSITIVE_INFINITY;
  const lines = breakLinesInfo(value, wrapWidth, (text) =>
    measureLayoutText(text, fontSize, node.font), {
    firstLineIndent: pm.textIndent,
  });

  return (
    top +
    bottom +
    lines.length * pm.lineAdvance +
    pm.spaceAbove +
    pm.spaceBelow
  );
}

/** Leaf draw: explicit h else content-driven rich text, else legacy 18 default. */
export function layoutLeafDraw(node: DrawNode, ctx: LayoutContext): LayoutResult {
  const contentExtent =
    ctx.widthFromContent && node.position?.w == null
      ? node.position?.minW ?? ctx.availableWidth
      : ctx.availableWidth;
  const width = resolveExtent(
    ctx.stretchWidth ? { ...node.position, w: undefined } : node.position,
    'width',
    contentExtent
  );
  const contentHeight = drawValueHeight(node, width);
  const height = resolveExtent(node.position, 'height', contentHeight > 0 ? contentHeight : 18);

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as DrawNode,
    height,
  };
}

/**
 * Height of a draw's text block. Rich-text draws such as Example-2 Draw_0036
 * have `minH` only and a multi-paragraph `<exData>` with `lineHeight="30pt"`;
 * Preview PDF grows the draw to all three lines instead of clipping after the
 * first (the Ytivos/Offqt sojjpitx block).
 */
function drawValueHeight(node: DrawNode, width: number): number {
  const value = node.value;
  if (!value) return 0;
  let text: string;
  if (value.type === 'richText') {
    text = textRunsToPlainText(parseRichText(value.content ?? ''));
  } else if (value.type === 'text') {
    text = value.content ?? '';
  } else {
    return 0;
  }
  if (!text) return 0;

  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
  const left = node.margin?.leftInset ?? 0;
  const right = node.margin?.rightInset ?? 0;
  const top = node.margin?.topInset ?? 0;
  const bottom = node.margin?.bottomInset ?? 0;
  const innerWidth = Math.max(width - left - right, 0);
  const lines = breakLinesInfo(text, innerWidth, (s) =>
    measureLayoutText(s, fontSize, node.font), {
    firstLineIndent: pm.textIndent,
  });
  return (
    top +
    bottom +
    lines.length * pm.lineAdvance +
    pm.spaceAbove +
    pm.spaceBelow
  );
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
