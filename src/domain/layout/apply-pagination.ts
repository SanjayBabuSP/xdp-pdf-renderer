import {
  Result,
  LayoutModel,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  ExclGroupNode,
  PaginatedLayout,
  PaginatedPage,
  PageDefinition,
  Position,
  BreakValue,
  KeepSpec,
  BorderSpec,
  OriginalBox,
} from '../../types';
import { success } from '../../lib/result-type';
import {
  paraMetrics,
  layoutLines,
  defaultAscent,
  fontDescent,
  VerticalAlign,
} from '../../rendering/text/line-metrics';
import { JUST_V, mapJustV } from '../../rendering/text/justifier';
import { breakLinesInfo } from '../../rendering/text/line-breaker';
import { measureLayoutText } from './text-measure';
import { formatValue } from '../../lib/value-format';
import { resolveChoiceText } from '../../rendering/ui-values';
import { parseRichText, textRunsToPlainText } from '../../rendering/rich-text-parser';
import { effectiveStrokeWidth } from '../../rendering/border-style';
import { effectiveRichFontSize } from './position-engine';
import { isVerticalRotation } from '../../rendering/text/rotation';

const EPS = 1e-6;
const DEFAULT_FONT_SIZE = 10;
const MIN_FRAGMENT_H = 0.1;
const THIN_RULE_STROKE_FACTOR = 2;

function visualHeight(node: LayoutNode): number {
  const pos = (node as { position?: Position }).position;
  if (!pos) return 0;
  if (
    (node.type === 'draw' || node.type === 'field') &&
    isVerticalRotation(pos.rotate ?? 0) &&
    pos.w != null
  ) {
    return pos.w;
  }
  return pos.h ?? 0;
}

interface WalkState {
  cursorBottom: number;
  pageH: number;
  contentAreaH: number;
  ca1: { x: number; y: number; w: number; h: number };
}

export function applyPagination(
  layout: LayoutModel,
  pageHeightPts?: number,
  locale?: string
): Result<PaginatedLayout> {
  if (layout.pages.length === 0) {
    const pageDef = defaultPageDef();
    const pages: PaginatedPage[] = [
      {
        pageIndex: 0,
        medium: pageDef.medium,
        contentArea: pageDef.contentArea,
        masterPageChildren: pageDef.masterPageChildren,
        children: layout.children,
      },
    ];
    return success({
      pages,
      rootSubformName: layout.rootSubformName,
      rootEvents: layout.rootEvents,
    });
  }

  const first = layout.pages[0];
  const pageHeight = pageHeightPts ?? first.contentArea.h;
  const flipHeight = first.contentArea.y + pageHeight;
  const state: WalkState = {
    cursorBottom: first.contentArea.y,
    pageH: pageHeight,
    contentAreaH: Math.min(first.contentArea.h, pageHeight),
    ca1: { ...first.contentArea },
  };

  const shifted = new WeakSet<LayoutNode>();
  const { nodes: walked, trailingTarget } = walkContainer(
    layout.children,
    state,
    false,
    true,
    false,
    shifted
  );
  const stabilized = stabilizeShiftedStraddlers(walked, state, shifted);

  const buckets: LayoutNode[][] = [];
  const push = (page: number, node: LayoutNode): void => {
    while (buckets.length <= page) buckets.push([]);
    buckets[page].push(node);
  };

  for (const child of stabilized) {
    const pos = child.position;
    if (!pos || pos.y == null) {
      push(0, child);
      continue;
    }
    const y0 = pos.y;
    const y1 = y0 + (pos.h ?? 0);
    const kStart = pageIndexOf(y0, state);
    const kEnd = Math.max(kStart, pageIndexFloor(y1, state));
    if (kEnd === kStart) {
      push(kStart, child);
      continue;
    }
    for (let p = kStart; p <= kEnd; p++) {
      const top = p === kStart ? y0 : state.ca1.y + p * state.pageH;
      const bottom = p === kEnd ? y1 : state.ca1.y + (p + 1) * state.pageH;
      const frag = clipSubtree(child, top, bottom, flipHeight, locale);
      if (frag) push(p, frag);
    }
  }

  if (trailingTarget != null) {
    const targetPage = pageIndexOf(trailingTarget, state);
    while (buckets.length <= targetPage) buckets.push([]);
  }

  extendFragmentBands(buckets, state, flipHeight, locale);

  const pageCount = Math.max(buckets.length, 1);
  const pages: PaginatedPage[] = [];
  for (let p = 0; p < pageCount; p++) {
    const template = layout.pages[p % layout.pages.length];
    const ca = template.contentArea;
    const dx = ca.x - state.ca1.x;
    const dy = ca.y - state.ca1.y - p * state.pageH;
    pages.push({
      pageIndex: p,
      medium: template.medium,
      contentArea: ca,
      masterPageChildren: template.masterPageChildren,
      children: shiftNodes(buckets[p] ?? [], dx, dy),
    });
  }

  return success({ pages, rootSubformName: layout.rootSubformName, rootEvents: layout.rootEvents });
}

function pageIndexFloor(y: number, s: WalkState): number {
  return Math.max(0, Math.floor((y - s.ca1.y - EPS) / s.pageH));
}

function pageIndexOf(y: number, s: WalkState): number {
  return Math.max(0, Math.floor((y - s.ca1.y) / s.pageH));
}

function nextChunkTop(cursorBottom: number, value: BreakValue, s: WalkState): number {
  const d = cursorBottom - s.ca1.y;
  if (value === 'contentArea') {
    return s.ca1.y + Math.ceil(d / s.contentAreaH) * s.contentAreaH;
  }
  if (value === 'pageArea') {
    return s.ca1.y + Math.ceil(d / s.pageH) * s.pageH;
  }
  let k = Math.ceil(d / s.pageH) - 1;
  if (value === 'pageEven') {
    if ((k + 1) % 2 === 0) k += 1;
  } else if (value === 'pageOdd' || value === 'pageFront') {
    if ((k + 1) % 2 === 1) k += 1;
  }
  return s.ca1.y + (k + 1) * s.pageH;
}

function breakTargetOf(value: BreakValue | undefined, s: WalkState): number | null {
  if (!value || value === 'auto') return null;
  return nextChunkTop(s.cursorBottom, value, s);
}

function maxTarget(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function isExplicitKeep(keep: KeepSpec | undefined): boolean {
  if (!keep) return false;
  return Object.values(keep).some((v) => v != null && v !== '' && v !== 'auto' && v !== 'none');
}

function isRowNode(node: LayoutNode): boolean {
  return node.type === 'subform' && (node.layout === 'row' || node.layout === 'rl-row');
}

function isTableNode(node: LayoutNode): boolean {
  return node.type === 'subform' && node.layout === 'table';
}

function isWholeUnit(node: LayoutNode): boolean {
  return node.type === 'field' || node.type === 'draw' || isRowNode(node) || isTableNode(node);
}

function stabilizeShiftedStraddlers(
  nodes: LayoutNode[],
  state: WalkState,
  shifted: WeakSet<LayoutNode>
): LayoutNode[] {
  return nodes.map((node) => {
    let next = node;
    const pos = next.position;
    if (pos && pos.y != null && shifted.has(node)) {
      const y0 = pos.y;
      const y1 = y0 + (pos.h ?? 0);
      const kStart = pageIndexOf(y0, state);
      const kEnd = Math.max(kStart, pageIndexFloor(y1, state));
      if (kEnd > kStart && isWholeUnit(node) && (pos.h ?? 0) <= state.contentAreaH) {
        const target = state.ca1.y + (kStart + 1) * state.pageH;
        next = shiftSubtree(node, 0, target - y0);
      }
    }
    if (next.type === 'subform') {
      return {
        ...next,
        children: stabilizeShiftedStraddlers(next.children, state, shifted),
      } as SubformNode;
    }
    if (next.type === 'exclGroup') {
      return {
        ...next,
        children: stabilizeShiftedStraddlers(next.children, state, shifted),
      } as ExclGroupNode;
    }
    return next;
  });
}

function walkContainer(
  nodes: LayoutNode[],
  state: WalkState,
  parentIsTable: boolean,
  allowUnitShift: boolean,
  ancestorRepeat: boolean,
  shifted: WeakSet<LayoutNode>
): { nodes: LayoutNode[]; bottom: number; trailingTarget: number | null; shift: number } {
  const out: LayoutNode[] = [];
  let localDy = 0;
  let pendingTarget: number | null = null;
  let bottom = -Infinity;

  for (const child of nodes) {
    const pos = child.position;
    if (!pos || pos.y == null) {
      out.push(child);
      continue;
    }

    const target = maxTarget(
      pendingTarget,
      breakTargetOf((child as { breakBefore?: BreakValue }).breakBefore, state)
    );
    pendingTarget = null;
    if (target != null) {
      const y0 = pos.y + localDy;
      const delta = target - y0;
      if (delta > EPS) localDy += delta;
    }

    let node = shiftSubtree(child, 0, localDy, shifted);
    let innerTrailingTarget: number | null = null;

    if (node.type === 'subform' || node.type === 'exclGroup') {
      const repeatInstance = node.type === 'subform' && (node as SubformNode).repeatIndex != null;
      const childMayShift =
        node.type === 'subform' && node.layout === 'table' && !ancestorRepeat && !repeatInstance;
      const preShift = wholeUnitShift(node, state, parentIsTable, allowUnitShift);
      if (preShift > EPS) {
        node = shiftSubtree(node, 0, preShift, shifted) as SubformNode | ExclGroupNode;
        localDy += preShift;
      }
      const inner = walkContainer(
        node.children,
        state,
        node.type === 'subform' && node.layout === 'table',
        childMayShift,
        ancestorRepeat || repeatInstance,
        shifted
      );
      innerTrailingTarget = inner.trailingTarget;
      if (inner.shift > EPS) localDy += inner.shift;
      if (node.type === 'subform') {
        node = { ...node, children: inner.nodes } as SubformNode;
        const boxBottom = node.position!.y! + visualHeight(node);
        const contentBottom = Number.isFinite(inner.bottom)
          ? Math.max(inner.bottom, boxBottom)
          : boxBottom;
        if (contentBottom > boxBottom && !isRowNode(node)) {
          node = {
            ...node,
            position: { ...node.position!, h: contentBottom - node.position!.y! },
          } as SubformNode;
        }
      } else {
        node = { ...node, children: inner.nodes as FieldNode[] } as ExclGroupNode;
      }
    }

    const p = node.position;
    if (p && p.y != null) {
      const delta = wholeUnitShift(node, state, parentIsTable, allowUnitShift);
      if (delta > EPS) {
        node = shiftSubtree(node, 0, delta, shifted);
        localDy += delta;
      }
    }

    if (Math.abs(localDy) > EPS) shifted.add(node);
    out.push(node);
    const np = node.position;
    if (np && np.y != null) {
      const nodeBottom = np.y + visualHeight(node);
      if (nodeBottom > bottom) bottom = nodeBottom;
      if (nodeBottom > state.cursorBottom) state.cursorBottom = nodeBottom;
    }

    pendingTarget = maxTarget(
      innerTrailingTarget,
      breakTargetOf((node as { breakAfter?: BreakValue }).breakAfter, state)
    );
  }

  return { nodes: out, bottom, trailingTarget: pendingTarget, shift: localDy };
}

function shiftSubtree(
  node: LayoutNode,
  dx: number,
  dy: number,
  shifted?: WeakSet<LayoutNode>
): LayoutNode {
  let result: LayoutNode;
  if (node.type === 'subform') {
    const sub = node as SubformNode;
    result = {
      ...sub,
      position: shiftPos(sub.position, dx, dy),
      children: sub.children.map((c) => shiftSubtree(c, dx, dy, shifted)),
    } as SubformNode;
  } else if (node.type === 'exclGroup') {
    const ex = node as ExclGroupNode;
    result = {
      ...ex,
      position: shiftPos(ex.position, dx, dy),
      children: ex.children.map((c) => shiftSubtree(c, dx, dy, shifted)),
    } as ExclGroupNode;
  } else if (node.type === 'field') {
    result = { ...(node as FieldNode), position: shiftPos(node.position, dx, dy) } as FieldNode;
  } else if (node.type === 'draw') {
    result = { ...(node as DrawNode), position: shiftPos(node.position, dx, dy) } as DrawNode;
  } else {
    result = node;
  }
  if (shifted && Math.abs(dy) > EPS) shifted.add(result);
  return result;
}

function shiftNodes(nodes: LayoutNode[], dx: number, dy: number): LayoutNode[] {
  return nodes.map((n) => shiftSubtree(n, dx, dy));
}

function shiftPos(pos: Position | undefined, dx: number, dy: number): Position | undefined {
  if (!pos) return pos;
  return {
    ...pos,
    x: pos.x != null ? pos.x + dx : pos.x,
    y: pos.y != null ? pos.y + dy : pos.y,
  };
}

function wholeUnitShift(
  node: LayoutNode,
  state: WalkState,
  parentIsTable: boolean,
  allowUnitShift: boolean
): number {
  const pos = node.position;
  if (!pos || pos.y == null) return 0;
  const y0 = pos.y;
  const y1 = y0 + visualHeight(node);
  const kStart = pageIndexOf(y0, state);
  const kEnd = Math.max(kStart, pageIndexFloor(y1, state));
  if (kEnd === kStart) return 0;
  const explicitKeep = isExplicitKeep((node as { keep?: KeepSpec }).keep);
  const tableUnit = isTableNode(node);
  const atomic =
    (allowUnitShift &&
      (node.type === 'field' ||
        node.type === 'draw' ||
        node.type === 'exclGroup' ||
        isRowNode(node) ||
        (parentIsTable && node.type === 'subform'))) ||
    explicitKeep ||
    tableUnit;
  const fits = visualHeight(node) <= (explicitKeep || tableUnit ? state.contentAreaH : state.pageH);
  if (!atomic || !fits) return 0;
  const delta = state.ca1.y + (kStart + 1) * state.pageH - y0;
  return delta > EPS ? delta : 0;
}

function leafTextValue(node: FieldNode | DrawNode, locale?: string): string {
  if (node.type === 'field') {
    if (node.ui?.type === 'choiceList') {
      return resolveChoiceText(node.resolvedValue, node.ui.items);
    }
    return formatValue(node.resolvedValue, node.formatPicture, node.locale ?? locale);
  }
  const value = node.value;
  if (!value) return '';
  if (value.type === 'richText') return textRunsToPlainText(parseRichText(value.content ?? ''));
  if (value.type === 'text') return value.content ?? '';
  return '';
}

function verticalAlignOf(para: { vAlign?: string } | undefined): VerticalAlign {
  const code = mapJustV(para?.vAlign);
  if (code === JUST_V.middle) return 'middle';
  if (code === JUST_V.bottom) return 'bottom';
  return 'top';
}

function leafLineBaselines(
  node: FieldNode | DrawNode,
  pos: Position,
  flipHeight: number,
  locale?: string
): { baselines: number[]; ascent: number; descent: number } | undefined {
  const text = leafTextValue(node, locale);
  if (!text) return undefined;
  const fontSize =
    node.type === 'draw' && node.value?.type === 'richText'
      ? effectiveRichFontSize(node.font, parseRichText(node.value.content ?? ''))
      : (node.font?.size ?? DEFAULT_FONT_SIZE);
  const pm = paraMetrics(
    node.para,
    fontSize,
    node.type === 'field' ? node.inheritedFontSize : undefined
  );
  const left = node.margin?.leftInset ?? 0;
  const right = node.margin?.rightInset ?? 0;
  const innerWidth = Math.max((pos.w ?? 0) - left - right - pm.marginLeft - pm.marginRight, 0);
  const wrapWidth = node.type === 'field' && node.ui?.multiLine !== true ? Infinity : innerWidth;
  const lines = breakLinesInfo(text, wrapWidth, (s) => measureLayoutText(s, fontSize, node.font), {
    firstLineIndent: pm.textIndent,
  });
  if (lines.length === 0) return undefined;
  const topInset = node.margin?.topInset ?? 0;
  const bottomInset = node.margin?.bottomInset ?? 0;
  const boxTop = flipHeight - (pos.y ?? 0) - topInset;
  const boxBottom = flipHeight - ((pos.y ?? 0) + (pos.h ?? 0)) + bottomInset;
  const { baselines } = layoutLines(
    lines.length,
    fontSize,
    { top: boxTop, bottom: boxBottom },
    verticalAlignOf(node.para),
    undefined,
    {
      lineAdvance: pm.lineAdvance,
      paddingTop: pm.spaceAbove,
      paddingBottom: pm.spaceBelow,
    }
  );
  return { baselines, ascent: defaultAscent(fontSize), descent: fontDescent(undefined, fontSize) };
}

function visibleStrokeWidths(border: BorderSpec | undefined): number[] {
  if (
    !border ||
    border.presence === 'hidden' ||
    border.presence === 'invisible' ||
    border.presence === 'inactive'
  ) {
    return [];
  }
  return (border.edges ?? [])
    .filter(
      (edge) =>
        edge != null &&
        edge.presence !== 'hidden' &&
        edge.presence !== 'invisible' &&
        edge.style !== 'none'
    )
    .map((edge) => effectiveStrokeWidth(edge))
    .filter((width) => Number.isFinite(width) && width > 0);
}

function ownedBlockHeight(
  node: FieldNode | DrawNode,
  locale: string | undefined,
  flipHeight: number
): number | undefined {
  const range = node.textLineRange;
  const box = node.originalBox;
  if (!range || !box || range.end <= range.start) return undefined;
  const pos = node.position;
  if (!pos || pos.y == null) return undefined;
  const topInset = node.margin?.topInset ?? 0;
  const bottomInset = node.margin?.bottomInset ?? 0;
  const origPos: Position = {
    ...pos,
    y: pos.y + box.topOffset,
    h: box.height + topInset + bottomInset,
  };
  const metrics = leafLineBaselines(node, origPos, flipHeight, locale);
  if (!metrics || metrics.baselines.length === 0) return undefined;
  const start = Math.min(range.start, metrics.baselines.length - 1);
  const end = Math.min(range.end, metrics.baselines.length);
  if (end <= start) return undefined;
  return metrics.baselines[start] + metrics.ascent - (metrics.baselines[end - 1] - metrics.descent);
}

function extendInList(
  nodes: LayoutNode[],
  flipHeight: number,
  locale: string | undefined,
  skipCount: number,
  initialDy: number
): void {
  let dy = initialDy;
  for (let i = 0; i < nodes.length; i++) {
    if (i < skipCount) continue;
    let node = nodes[i];
    if (dy !== 0 && node.position?.y != null) {
      node = shiftSubtree(node, 0, dy);
      nodes[i] = node;
    }
    if (node.type === 'subform' || node.type === 'exclGroup') {
      const before = endOfList(node.children as LayoutNode[]);
      extendInList(node.children as LayoutNode[], flipHeight, locale, 0, 0);
      const grown = endOfList(node.children as LayoutNode[]) - before;
      if (grown > EPS && node.position) {
        node = {
          ...node,
          position: { ...node.position, h: (node.position.h ?? 0) + grown },
        } as SubformNode;
        nodes[i] = node;
        dy += grown;
      }
      continue;
    }
    if (node.type !== 'field' && node.type !== 'draw') continue;
    const need = ownedBlockHeight(node as FieldNode | DrawNode, locale, flipHeight);
    const pos = node.position;
    const h = pos?.h ?? 0;
    if (need === undefined || pos?.y == null || need <= h + EPS) continue;
    node = { ...node, position: { ...pos, h: need } } as FieldNode | DrawNode;
    nodes[i] = node;
    dy += need - h;
  }
}

function endOfList(nodes: LayoutNode[]): number {
  let end = -Infinity;
  for (const node of nodes) {
    const pos = node.position;
    if (pos?.y != null) end = Math.max(end, pos.y + (pos.h ?? 0));
  }
  return end;
}

function contentEnd(node: LayoutNode): number {
  const pos = node.position;
  if (node.type !== 'subform' && node.type !== 'exclGroup') {
    return pos?.y != null ? pos.y + (pos.h ?? 0) : -Infinity;
  }
  let end = -Infinity;
  for (const child of (node as SubformNode).children) end = Math.max(end, contentEnd(child));
  if (end === -Infinity && pos?.y != null) end = pos.y + (pos.h ?? 0);
  return end;
}

function contentStart(node: LayoutNode): number {
  const pos = node.position;
  if (node.type !== 'subform' && node.type !== 'exclGroup') {
    return pos?.y ?? Infinity;
  }
  let start = Infinity;
  for (const child of (node as SubformNode).children) start = Math.min(start, contentStart(child));
  if (start === Infinity && pos?.y != null) start = pos.y;
  return start;
}

interface MovedNode {
  parent: LayoutNode[];
  index: number;
  node: LayoutNode;
}

function collectTail(
  nodes: LayoutNode[],
  pageBottom: number,
  pageH: number,
  out: MovedNode[],
  skipCount: number,
  contentAreaH: number = pageH
): void {
  let i = nodes.length;
  while (i > skipCount && contentEnd(nodes[i - 1]) > pageBottom + EPS) i--;
  for (let j = nodes.length - 1; j >= i; j--) {
    const node = nodes[j];
    if (node.type === 'subform' || node.type === 'exclGroup') {
      if (
        node.type === 'subform' &&
        isTableNode(node) &&
        contentEnd(node) > pageBottom + EPS &&
        visualHeight(node) <= contentAreaH + EPS
      ) {
        out.unshift({ parent: nodes, index: j, node });
        continue;
      }
      collectTail(node.children as LayoutNode[], pageBottom, pageH, out, 0, contentAreaH);
      continue;
    }
    const start = contentStart(node);
    const end = contentEnd(node);
    if (end === -Infinity || start === Infinity || end - start > pageH + EPS) continue;
    out.unshift({ parent: nodes, index: j, node });
  }
}

function extendFragmentBands(
  buckets: LayoutNode[][],
  state: WalkState,
  flipHeight: number,
  locale: string | undefined
): void {
  const incoming: Array<{ nodes: LayoutNode[]; shift: number } | undefined> = [];
  for (let p = 0; p < buckets.length; p++) {
    const pageBottom = state.ca1.y + (p + 1) * state.pageH;
    const carried = incoming[p];
    let skip = 0;
    let dy = 0;
    if (carried) {
      buckets[p] = [...carried.nodes, ...buckets[p]];
      skip = carried.nodes.length;
      dy = carried.shift;
    }
    extendInList(buckets[p], flipHeight, locale, skip, dy);
    const moved: MovedNode[] = [];
    collectTail(buckets[p], pageBottom, state.pageH, moved, skip, state.contentAreaH);
    if (!moved.length) continue;
    const topNext = state.ca1.y + (p + 1) * state.pageH;
    const base = contentStart(moved[0].node);
    for (let k = moved.length - 1; k >= 0; k--) {
      moved[k].parent.splice(moved[k].index, 1);
    }
    const shifted = moved.map((item) => shiftSubtree(item.node, 0, topNext - base));
    let movedEnd = -Infinity;
    for (const node of shifted) movedEnd = Math.max(movedEnd, contentEnd(node));
    while (buckets.length <= p + 1) buckets.push([]);
    incoming[p + 1] = { nodes: shifted, shift: movedEnd - topNext };
  }
}

function isThinRule(node: LayoutNode, pos: Position): boolean {
  const h = pos.h ?? 0;
  if (!(h > 0)) return false;
  const borders: Array<BorderSpec | undefined> = [node.border];
  if (node.type === 'draw') borders.push(node.value?.shapeBorder);
  const widths = borders.flatMap(visibleStrokeWidths);
  if (widths.length === 0) return false;
  return h <= THIN_RULE_STROKE_FACTOR * Math.max(...widths);
}

function clipSubtree(
  node: LayoutNode,
  top: number,
  bottom: number,
  flipHeight: number,
  locale?: string
): LayoutNode | null {
  const pos = node.position;
  if (!pos || pos.y == null) return node;
  const y0 = pos.y;
  const y1 = y0 + (pos.h ?? 0);
  if (y1 <= top + EPS || y0 >= bottom - EPS) return null;
  if (y0 >= top - EPS && y1 <= bottom + EPS) return node;

  if (isThinRule(node, pos)) {
    const centre = (y0 + y1) / 2;
    return centre >= top - EPS && centre < bottom - EPS ? node : null;
  }

  const newPos: Position = {
    ...pos,
    y: Math.max(y0, top),
    h: Math.min(y1, bottom) - Math.max(y0, top),
  };
  if ((y0 < top || y1 > bottom) && (newPos.h ?? 0) <= MIN_FRAGMENT_H) return null;

  if (node.type === 'subform') {
    const sub = node as SubformNode;
    const children = sub.children
      .map((c) => clipSubtree(c, top, bottom, flipHeight, locale))
      .filter((c): c is LayoutNode => c != null);
    return { ...sub, position: newPos, children } as SubformNode;
  }
  if (node.type === 'exclGroup') {
    const ex = node as ExclGroupNode;
    const children = ex.children
      .map((c) => clipSubtree(c, top, bottom, flipHeight, locale))
      .filter((c): c is LayoutNode => c != null);
    return { ...ex, position: newPos, children } as ExclGroupNode;
  }
  if (node.type === 'field' || node.type === 'draw') {
    const leaf = node as FieldNode | DrawNode;
    const topInset = leaf.margin?.topInset ?? 0;
    const bottomInset = leaf.margin?.bottomInset ?? 0;
    const originalBox: OriginalBox = {
      topOffset: y0 - (newPos.y ?? y0),
      height: Math.max((pos.h ?? 0) - topInset - bottomInset, 0),
    };
    const metrics = leafLineBaselines(leaf, pos, flipHeight, locale);
    if (!metrics) return { ...leaf, position: newPos, originalBox } as FieldNode | DrawNode;
    const yUpLow = flipHeight - bottom;
    const yUpHigh = flipHeight - top;
    let start = -1;
    let end = -1;
    let anyOverlap = false;
    for (let i = 0; i < metrics.baselines.length; i++) {
      const baseline = metrics.baselines[i];
      if (baseline >= yUpLow - EPS && baseline <= yUpHigh + EPS) anyOverlap = true;
      if (baseline + metrics.ascent > yUpLow + EPS && baseline - metrics.descent < yUpHigh - EPS) {
        anyOverlap = true;
      }
      const ownershipY = baseline - metrics.descent;
      if (ownershipY >= yUpLow - EPS && ownershipY < yUpHigh - EPS) {
        if (start < 0) start = i;
        end = i + 1;
      }
    }
    if (start < 0) {
      if (!anyOverlap) return null;
      return { ...leaf, position: newPos, originalBox, textLineRange: { start: 0, end: 0 } };
    }
    return {
      ...leaf,
      position: newPos,
      originalBox,
      textLineRange: { start, end },
    } as FieldNode | DrawNode;
  }
  return node;
}

function defaultPageDef(): PageDefinition {
  return {
    name: 'Page1',
    medium: { stock: 'a4', short: 595.28, long: 841.89 },
    contentArea: { x: 54, y: 54, w: 487.28, h: 733.89 },
    masterPageChildren: [],
  };
}
