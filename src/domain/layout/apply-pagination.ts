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
} from '../../types';
import { success } from '../../lib/result-type';
import { paraMetrics, layoutLines, VerticalAlign } from '../../rendering/text/line-metrics';
import { breakLinesInfo } from '../../rendering/text/line-breaker';
import { measureLayoutText } from './text-measure';
import { formatValue } from '../../lib/value-format';
import { resolveChoiceText } from '../../rendering/ui-values';
import { parseRichText, textRunsToPlainText } from '../../rendering/rich-text-parser';

const EPS = 1e-6;
const DEFAULT_FONT_SIZE = 10;

interface WalkState {
  cursorBottom: number;
  pageH: number;
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
  const flipHeight = first.medium.long;
  const state: WalkState = {
    cursorBottom: first.contentArea.y,
    pageH: pageHeightPts ?? first.contentArea.h,
    ca1: { ...first.contentArea },
  };

  const { nodes: walked } = walkContainer(layout.children, state, false, true, false);

  const buckets: LayoutNode[][] = [];
  const push = (page: number, node: LayoutNode): void => {
    while (buckets.length <= page) buckets.push([]);
    buckets[page].push(node);
  };

  for (const child of walked) {
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
  let k = Math.ceil((cursorBottom - s.ca1.y) / s.pageH) - 1;
  if (value === 'pageEven') {
    if ((k + 1) % 2 === 0) k += 1;
  } else if (value === 'pageOdd') {
    if ((k + 1) % 2 === 1) k += 1;
  }
  return s.ca1.y + (k + 1) * s.pageH;
}

function isExplicitKeep(keep: KeepSpec | undefined): boolean {
  if (!keep) return false;
  return Object.values(keep).some((v) => v != null && v !== '' && v !== 'auto');
}

function isRowNode(node: LayoutNode): boolean {
  return node.type === 'subform' && (node.layout === 'row' || node.layout === 'rl-row');
}

function walkContainer(
  nodes: LayoutNode[],
  state: WalkState,
  parentIsTable: boolean,
  allowUnitShift: boolean,
  ancestorRepeat: boolean
): { nodes: LayoutNode[]; bottom: number } {
  const out: LayoutNode[] = [];
  let localDy = 0;
  let pendingBreak: BreakValue | null = null;
  let bottom = -Infinity;

  for (const child of nodes) {
    const pos = child.position;
    if (!pos || pos.y == null) {
      out.push(child);
      continue;
    }

    const breakValue = child.breakBefore ?? pendingBreak;
    pendingBreak = null;
    if (breakValue) {
      const target = nextChunkTop(state.cursorBottom, breakValue, state);
      const y0 = pos.y + localDy;
      const delta = target - y0;
      if (delta > EPS) localDy += delta;
    }

    let node = shiftSubtree(child, 0, localDy);

    if (node.type === 'subform' || node.type === 'exclGroup') {
      const repeatInstance = node.type === 'subform' && (node as SubformNode).repeatIndex != null;
      const childMayShift =
        node.type === 'subform' && node.layout === 'table' && !ancestorRepeat && !repeatInstance;
      const inner = walkContainer(
        node.children,
        state,
        node.type === 'subform' && node.layout === 'table',
        childMayShift,
        ancestorRepeat || repeatInstance
      );
      if (node.type === 'subform') {
        node = { ...node, children: inner.nodes } as SubformNode;
        const boxBottom = node.position!.y! + (node.position!.h ?? 0);
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
      const y0 = p.y;
      const y1 = y0 + (p.h ?? 0);
      const kStart = pageIndexOf(y0, state);
      const kEnd = Math.max(kStart, pageIndexFloor(y1, state));
      if (kEnd > kStart) {
        const atomic =
          allowUnitShift &&
          (node.type === 'field' ||
            node.type === 'draw' ||
            node.type === 'exclGroup' ||
            isRowNode(node) ||
            (parentIsTable && node.type === 'subform') ||
            isExplicitKeep((node as { keep?: KeepSpec }).keep));
        const fits = (p.h ?? 0) <= state.pageH;
        if (atomic && fits) {
          const target = state.ca1.y + (kStart + 1) * state.pageH;
          const delta = target - y0;
          if (delta > EPS) {
            node = shiftSubtree(node, 0, delta);
            localDy += delta;
          }
        }
      }
    }

    out.push(node);
    const np = node.position;
    if (np && np.y != null) {
      const nodeBottom = np.y + (np.h ?? 0);
      if (nodeBottom > bottom) bottom = nodeBottom;
      if (nodeBottom > state.cursorBottom) state.cursorBottom = nodeBottom;
    }

    const ba = (node as { breakAfter?: BreakValue }).breakAfter;
    if (ba && ba !== 'auto') pendingBreak = ba;
  }

  return { nodes: out, bottom };
}

function shiftSubtree(node: LayoutNode, dx: number, dy: number): LayoutNode {
  if (node.type === 'subform') {
    const sub = node as SubformNode;
    return {
      ...sub,
      position: shiftPos(sub.position, dx, dy),
      children: sub.children.map((c) => shiftSubtree(c, dx, dy)),
    } as SubformNode;
  }
  if (node.type === 'exclGroup') {
    const ex = node as ExclGroupNode;
    return {
      ...ex,
      position: shiftPos(ex.position, dx, dy),
      children: ex.children.map((c) => shiftSubtree(c, dx, dy)),
    } as ExclGroupNode;
  }
  if (node.type === 'field') {
    return { ...(node as FieldNode), position: shiftPos(node.position, dx, dy) } as FieldNode;
  }
  if (node.type === 'draw') {
    return { ...(node as DrawNode), position: shiftPos(node.position, dx, dy) } as DrawNode;
  }
  return node;
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
  if (para?.vAlign === 'middle') return 'middle';
  if (para?.vAlign === 'bottom') return 'bottom';
  return 'top';
}

function leafLineBaselines(
  node: FieldNode | DrawNode,
  pos: Position,
  flipHeight: number,
  locale?: string
): number[] | undefined {
  const text = leafTextValue(node, locale);
  if (!text) return undefined;
  const fontSize = node.font?.size ?? DEFAULT_FONT_SIZE;
  const pm = paraMetrics(node.para, fontSize);
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
  return baselines;
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

  const newPos: Position = {
    ...pos,
    y: Math.max(y0, top),
    h: Math.min(y1, bottom) - Math.max(y0, top),
  };

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
    const baselines = leafLineBaselines(leaf, pos, flipHeight, locale);
    if (!baselines) return { ...leaf, position: newPos } as FieldNode | DrawNode;
    const yUpLow = flipHeight - bottom;
    const yUpHigh = flipHeight - top;
    let start = -1;
    let end = -1;
    for (let i = 0; i < baselines.length; i++) {
      if (baselines[i] >= yUpLow - EPS && baselines[i] <= yUpHigh + EPS) {
        if (start < 0) start = i;
        end = i + 1;
      }
    }
    if (start < 0) return null;
    return {
      ...leaf,
      position: newPos,
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
