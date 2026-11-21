import { LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, Position } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';
import { paraMetrics } from '../../rendering/text/line-metrics';
import { breakLinesInfo } from '../../rendering/text/line-breaker';
import { resolveChoiceText } from '../../rendering/ui-values';
import { parseRichText, textRunsToPlainText } from '../../rendering/rich-text-parser';
import { formatValue } from '../../lib/value-format';
import { measureLayoutText } from './text-measure';
import { normalizeRotation } from '../../rendering/text/rotation';

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
    const y = node.position?.y ?? 0;
    if (normalizeRotation(node.position?.rotate ?? 0) === 90) return y - (node.position?.w ?? 0);
    return y;
  }
  return 0;
}

function nodeWidth(node: LayoutNode): number | undefined {
  if (node.type === 'field' || node.type === 'draw') return node.position?.w;
  if (node.type === 'subform' || node.type === 'exclGroup') return node.position?.w;
  return undefined;
}

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

export function layoutPositionSubform(
  node: SubformNode,
  ctx: LayoutContext,
  layoutChild: ChildLayouter
): LayoutResult {
  const width = resolveExtent(node.position, 'width', ctx.availableWidth);
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

function captionHeight(node: FieldNode): number {
  const caption = node.caption;
  if (!caption || !caption.text) return 0;
  const placement = caption.placement ?? 'left';
  if (placement === 'top' || placement === 'bottom') {
    return caption.reserve ?? (caption.font?.size ?? node.font?.size ?? DEFAULT_FONT_SIZE) * LINE_ADVANCE;
  }
  return 0;
}

function valueLineHeight(node: FieldNode): number {
  const pm = paraMetrics(node.para, node.font?.size ?? DEFAULT_FONT_SIZE);
  return pm.lineAdvance + pm.spaceAbove + pm.spaceBelow;
}

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

export function drawValueHeight(node: DrawNode, width: number): number {
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
  return lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow;
}

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
