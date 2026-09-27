import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, PaginatedLayout, PaginatedPage, PageDefinition, Position, BreakValue, KeepSpec } from '../../types';
import { success } from '../../lib/result-type';

// ─── Coordinate-based pagination ──────────────────────────────────────────
// evidence: xfalayout_disasm.c break machinery at FUN_18550a80 (:16822
// breakAfter/breakBefore, AUTO default) and hasActiveKeep (:66094 — keep
// has three enum properties, default auto). addInstances (:6028) inserts
// nodes; the engine then assigns x/y — instances are never pre-offset.
//
// Design (plan Phase 2 task 7):
//  * calculatePositions lays out ALL content contiguously in page-1
//    content-area space (flow space), ignoring page height.
//  * This pass walks top level + container children in document order,
//    applying explicit breaks (dy rebase) and unit shifts (keep/atomic
//    rows/leaves move whole to the next page top when they would straddle
//    a page boundary), then buckets every node by coordinate page index.
//  * Straddling containers are split into per-page fragments: the subtree
//    is pruned to the fragment's page region with boxes clipped to it.
//  * Each page's bucket is translated from page-1 space into that page's
//    local top-down coordinates: t_p = (CA_p.x − CA_1.x, CA_p.y − CA_1.y
//    − p·flowPageH). Rendered pages anchor children at absolute page-local
//    coords (renderer flipY uses y directly), so page 0 is identity and a
//    uniform template shifts page p up by exactly p·flowPageH.
//  * The old post-hoc y-shift + estimateNodeHeight chunking are gone.

const EPS = 1e-6;

interface WalkState {
  /** Bottom of all content placed so far (page-1 space), for break targets. */
  cursorBottom: number;
  /** Content region height per page (options override or content-area h). */
  pageH: number;
  /** First page content area (origin of flow space). */
  ca1: { x: number; y: number; w: number; h: number };
}

/** Split content across pages based on coordinates, breaks and keep rules. */
export function applyPagination(layout: LayoutModel, pageHeightPts?: number): Result<PaginatedLayout> {
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
    return success({ pages, rootSubformName: layout.rootSubformName, rootEvents: layout.rootEvents });
  }

  const first = layout.pages[0];
  const state: WalkState = {
    cursorBottom: first.contentArea.y,
    pageH: pageHeightPts ?? first.contentArea.h,
    ca1: { ...first.contentArea },
  };

  const { nodes: walked } = walkContainer(layout.children, state, false);

  // Bucket top-level nodes by page span; straddling containers fragment.
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
      const frag = clipSubtree(child, top, bottom);
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

/**
 * Top of the next chunk (content area / page) after the page containing
 * `cursorBottom`. evidence: break values contentArea/pageArea/pageEven/
 * pageFront/pageOdd — xfa.dll atom block; auto never reaches here.
 */
function nextChunkTop(cursorBottom: number, value: BreakValue, s: WalkState): number {
  // Page (0-based) containing cursorBottom; −1 when nothing has been placed.
  let k = Math.ceil((cursorBottom - s.ca1.y) / s.pageH) - 1;
  if (value === 'pageEven') {
    // Target page 0-based index k+1; pageEven → 1-based even → 0-based odd.
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

/**
 * Walk a container's children in document order: apply breaks (rebase dy),
 * recurse into nested containers, keep straddling units whole (leaves,
 * exclusive groups, table rows, explicit <keep>), and let oversized /
 * non-kept containers straddle (fragmented later by coordinate bucketing).
 * Returns the local content bottom (for the parent's height fix-up).
 */
function walkContainer(nodes: LayoutNode[], state: WalkState, parentIsTable: boolean): { nodes: LayoutNode[]; bottom: number } {
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

    // Break targeting: explicit breakBefore wins, else pending breakAfter.
    const breakValue = child.breakBefore ?? pendingBreak;
    pendingBreak = null;
    if (breakValue) {
      const target = nextChunkTop(state.cursorBottom, breakValue, state);
      const y0 = pos.y + localDy;
      const delta = target - y0;
      if (delta > EPS) localDy += delta;
    }

    // Apply accumulated dy to this subtree (once — coordinates are final
    // for everything above; nested walks start from these shifted coords).
    let node = shiftSubtree(child, 0, localDy);

    // Recurse into containers so nested breaks/keeps resolve first.
    if (node.type === 'subform' || node.type === 'exclGroup') {
      const inner = walkContainer(node.children, state, node.type === 'subform' && node.layout === 'table');
      if (node.type === 'subform') {
        node = { ...node, children: inner.nodes } as SubformNode;
        // Container box must cover content pushed past it by breaks/keeps.
        const boxBottom = node.position!.y! + (node.position!.h ?? 0);
        const contentBottom = Number.isFinite(inner.bottom) ? Math.max(inner.bottom, boxBottom) : boxBottom;
        if (contentBottom > boxBottom) {
          node = { ...node, position: { ...node.position!, h: contentBottom - node.position!.y! } } as SubformNode;
        }
      } else {
        node = { ...node, children: inner.nodes as FieldNode[] } as ExclGroupNode;
      }
    }

    // Straddle handling: unit-shift atomic/kept nodes to the next page top.
    const p = node.position;
    if (p && p.y != null) {
      const y0 = p.y;
      const y1 = y0 + (p.h ?? 0);
      const kStart = pageIndexOf(y0, state);
      const kEnd = Math.max(kStart, pageIndexFloor(y1, state));
      if (kEnd > kStart) {
        const atomic =
          node.type === 'field' ||
          node.type === 'draw' ||
          node.type === 'exclGroup' ||
          isRowNode(node) ||
          (parentIsTable && node.type === 'subform') ||
          isExplicitKeep((node as { keep?: KeepSpec }).keep);
        const fits = (p.h ?? 0) <= state.pageH;
        if (atomic && fits) {
          const target = state.ca1.y + (kStart + 1) * state.pageH;
          const delta = target - y0;
          if (delta > EPS) {
            node = shiftSubtree(node, 0, delta);
            localDy += delta;
          }
        }
        // Otherwise: leave it — the bucket loop fragments it across pages.
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

/** Recursively shift every node's position by (dx, dy). */
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
      children: ex.children.map((c) => shiftSubtree(c, dx, dy) as FieldNode),
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

/**
 * Prune a subtree to the page region [top, bottom), clipping container and
 * leaf boxes to the region. Returns null when nothing intersects. Nodes
 * straddling an inner region edge appear in both fragments with clipped
 * boxes — matching the visual cut of content flowing across a break.
 */
function clipSubtree(node: LayoutNode, top: number, bottom: number): LayoutNode | null {
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
      .map((c) => clipSubtree(c, top, bottom))
      .filter((c): c is LayoutNode => c != null);
    return { ...sub, position: newPos, children } as SubformNode;
  }
  if (node.type === 'exclGroup') {
    const ex = node as ExclGroupNode;
    const children = ex.children
      .map((c) => clipSubtree(c, top, bottom))
      .filter((c): c is LayoutNode => c != null) as FieldNode[];
    return { ...ex, position: newPos, children } as ExclGroupNode;
  }
  if (node.type === 'field') return { ...(node as FieldNode), position: newPos } as FieldNode;
  if (node.type === 'draw') return { ...(node as DrawNode), position: newPos } as DrawNode;
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
