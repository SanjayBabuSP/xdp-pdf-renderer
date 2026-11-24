import type { PDFFont } from 'pdf-lib';
import { LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, FontSpec } from '../../types';
import { LayoutContext, LayoutResult, ChildLayouter } from './engine-types';
import { resolveExtent, resolveSubformHeight } from './sizing';
import { paraMetrics } from '../../rendering/text/line-metrics';
import { breakLinesInfo } from '../../rendering/text/line-breaker';
import { resolveChoiceText } from '../../rendering/ui-values';
import { parseRichText, type TextRun } from '../../rendering/rich-text-parser';
import { layoutRunLines, runBlockHeight, type StyledRun } from '../../rendering/text/run-flow';
import { formatValue } from '../../lib/value-format';
import { measureLayoutText } from './text-measure';
import { normalizeRotation } from '../../rendering/text/rotation';

const LINE_ADVANCE = 1.2;
const DEFAULT_FONT_SIZE = 10;
const LAYOUT_FONT = {} as PDFFont;

export function effectiveRichFontSize(
  font: FontSpec | undefined,
  runs: readonly TextRun[]
): number {
  let largest = 0;
  for (const run of runs) {
    if (run.fontSize != null && Number.isFinite(run.fontSize) && run.fontSize > largest) {
      largest = run.fontSize;
    }
  }
  return largest > 0 ? largest : (font?.size ?? DEFAULT_FONT_SIZE);
}

function anchorOrigin(node: LayoutNode): { dx: number; dy: number } {
  const position =
    node.type === 'subform' ||
    node.type === 'field' ||
    node.type === 'draw' ||
    node.type === 'exclGroup'
      ? node.position
      : undefined;
  const anchor = (position?.anchorType ?? '').toLowerCase();
  const w = position?.w ?? position?.minW ?? 0;
  const h = position?.h ?? position?.minH ?? 0;
  const dx = anchor.endsWith('right') ? -w : anchor.endsWith('center') ? -w / 2 : 0;
  const dy = anchor.startsWith('bottom') ? -h : anchor.startsWith('middle') ? -h / 2 : 0;
  return { dx, dy };
}

function getChildX(node: LayoutNode): number {
  if (
    node.type === 'subform' ||
    node.type === 'field' ||
    node.type === 'draw' ||
    node.type === 'exclGroup'
  ) {
    return (node.position?.x ?? 0) + anchorOrigin(node).dx;
  }
  return 0;
}

function getChildY(node: LayoutNode): number {
  if (
    node.type === 'subform' ||
    node.type === 'field' ||
    node.type === 'draw' ||
    node.type === 'exclGroup'
  ) {
    const y = (node.position?.y ?? 0) + anchorOrigin(node).dy;
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

function containerInsets(node: {
  margin?: { topInset?: number; rightInset?: number; bottomInset?: number; leftInset?: number };
}): {
  left: number;
  right: number;
  top: number;
  bottom: number;
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
      locale: ctx.locale,
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
    return (
      caption.reserve ?? (caption.font?.size ?? node.font?.size ?? DEFAULT_FONT_SIZE) * LINE_ADVANCE
    );
  }
  return 0;
}

function valueLineHeight(node: FieldNode): number {
  const pm = paraMetrics(node.para, node.font?.size ?? DEFAULT_FONT_SIZE, node.inheritedFontSize);
  return pm.lineAdvance + pm.spaceAbove + pm.spaceBelow;
}

export function layoutLeafField(node: FieldNode, ctx: LayoutContext): LayoutResult {
  const locale = node.locale ?? ctx.locale;
  const contentExtent =
    ctx.widthFromContent && node.position?.w == null
      ? (node.position?.minW ?? ctx.availableWidth)
      : ctx.widthFromText && node.position?.w == null
        ? fieldContentWidth(node, locale)
        : ctx.availableWidth;
  const width = resolveExtent(
    ctx.stretchWidth ? { ...node.position, w: undefined } : node.position,
    'width',
    contentExtent
  );
  const contentExtentH = captionHeight(node) + nodeValueHeight(node, width, locale);
  const height = resolveExtent(node.position, 'height', contentExtentH);

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: height },
    } as FieldNode,
    height,
  };
}

function fieldContentWidth(node: FieldNode, locale?: string): number {
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
  const value =
    node.ui?.type === 'choiceList'
      ? resolveChoiceText(node.resolvedValue, node.ui.items)
      : formatValue(node.resolvedValue, node.formatPicture, locale);
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

function nodeValueHeight(node: FieldNode, width: number, locale?: string): number {
  const top = node.margin?.topInset ?? 0;
  const bottom = node.margin?.bottomInset ?? 0;
  const left = node.margin?.leftInset ?? 0;
  const right = node.margin?.rightInset ?? 0;
  const reserve = node.caption?.reserve ?? 0;
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize, node.inheritedFontSize);

  const value =
    node.ui?.type === 'choiceList'
      ? resolveChoiceText(node.resolvedValue, node.ui.items)
      : formatValue(node.resolvedValue, node.formatPicture, locale);
  if (!value) return top + bottom + valueLineHeight(node);

  const innerWidth = Math.max(width - left - right - reserve - pm.marginLeft - pm.marginRight, 0);
  const wrapWidth = node.ui?.multiLine === true ? innerWidth : Number.POSITIVE_INFINITY;
  const lines = breakLinesInfo(
    value,
    wrapWidth,
    (text) => measureLayoutText(text, fontSize, node.font),
    {
      firstLineIndent: pm.textIndent,
    }
  );

  return top + bottom + lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow;
}

function drawTwoLineHeight(node: DrawNode): number {
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
  return (
    2 * pm.lineAdvance +
    pm.spaceAbove +
    pm.spaceBelow +
    (node.margin?.topInset ?? 0) +
    (node.margin?.bottomInset ?? 0)
  );
}

export function layoutLeafDraw(node: DrawNode, ctx: LayoutContext): LayoutResult {
  const contentExtent =
    ctx.widthFromContent && node.position?.w == null
      ? (node.position?.minW ?? ctx.availableWidth)
      : ctx.availableWidth;
  const width = resolveExtent(
    ctx.stretchWidth ? { ...node.position, w: undefined } : node.position,
    'width',
    contentExtent
  );
  const rotation = normalizeRotation(node.position?.rotate ?? 0);
  const vertical = rotation === 90 || rotation === 270;
  const contentHeight = drawValueHeight(node, width);
  const authoredHeight = vertical
    ? (node.position?.w ?? node.position?.minW)
    : (node.position?.h ?? node.position?.minH);
  const oneLineBox =
    authoredHeight != null &&
    node.value?.type === 'text' &&
    authoredHeight < drawTwoLineHeight(node);
  const grownHeight = oneLineBox ? Math.min(contentHeight, authoredHeight) : contentHeight;
  const laidHeight = resolveExtent(node.position, 'height', grownHeight > 0 ? grownHeight : 18);
  const height = vertical && authoredHeight != null ? authoredHeight : laidHeight;

  return {
    node: {
      ...node,
      position: { ...node.position, x: ctx.x, y: ctx.y, w: width, h: laidHeight },
    } as DrawNode,
    height,
  };
}

export function drawValueHeight(node: DrawNode, width: number): number {
  const value = node.value;
  if (!value) return 0;
  const top = node.margin?.topInset ?? 0;
  const bottom = node.margin?.bottomInset ?? 0;

  if (value.type === 'richText') {
    const runs = parseRichText(value.content ?? '');
    if (!runs.length) return 0;
    const fontSize = effectiveRichFontSize(node.font, runs);
    const pm = paraMetrics(node.para, fontSize);
    const styled: StyledRun[] = runs.map((run) => ({
      text: run.text,
      size: run.fontSize ?? fontSize,
      font: LAYOUT_FONT,
      lineAdvance: run.lineAdvance,
      marginTop: run.marginTop,
      marginBottom: run.marginBottom,
      spacerOnly: run.spacerOnly,
    }));
    const lines = layoutRunLines(styled, {
      maxWidth: width,
      baseSize: fontSize,
      measure: (text, run) =>
        measureLayoutText(
          text,
          styled[run].size,
          runs[run].fontFamily ? { ...node.font, family: runs[run].fontFamily } : node.font
        ),
      paragraph: {
        marginLeft: pm.marginLeft,
        marginRight: pm.marginRight,
        firstLineIndent: pm.textIndent,
      },
    });
    return runBlockHeight(lines) + pm.spaceAbove + pm.spaceBelow + top + bottom;
  }

  if (value.type !== 'text') return 0;
  const text = value.content ?? '';
  if (!text) return 0;

  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
  const left = node.margin?.leftInset ?? 0;
  const right = node.margin?.rightInset ?? 0;
  const innerWidth = Math.max(width - left - right, 0);
  const lines = breakLinesInfo(text, innerWidth, (s) => measureLayoutText(s, fontSize, node.font), {
    firstLineIndent: pm.textIndent,
  });
  return lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow + top + bottom;
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
    const result = layoutChild(child, {
      ...ctx,
      x: baseX,
      y: baseY + yOffset,
      availableWidth: contentW,
    });
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
