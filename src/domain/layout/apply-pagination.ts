import { Result, LayoutModel, LayoutNode, SubformNode, FieldNode, DrawNode, ExclGroupNode, PaginatedLayout, PaginatedPage, PageDefinition, Position } from '../../types';
import { success } from '../../lib/result-type';

/** Split content across multiple pages based on available page height. */
export function applyPagination(layout: LayoutModel, pageHeightPts?: number): Result<PaginatedLayout> {
  const pages: PaginatedPage[] = [];

  if (layout.pages.length === 0) {
    const pageDef = defaultPageDef();
    pages.push({
      pageIndex: 0,
      medium: pageDef.medium,
      contentArea: pageDef.contentArea,
      masterPageChildren: pageDef.masterPageChildren,
      children: layout.children,
    });
    return success({ pages, rootSubformName: layout.rootSubformName, rootEvents: layout.rootEvents });
  }

  // Flow all content through the first page template's height, then split into chunks.
  // Page templates cycle: page templates define size/contentArea/masterPage, not content gating.
  const firstPageDef = layout.pages[0];
  const contentH = pageHeightPts ?? firstPageDef.contentArea.h;
  const allChunks = splitIntoPages(layout.children, contentH, firstPageDef);

  // Assign chunks to pages, cycling through page templates as needed
  for (let i = 0; i < allChunks.length; i++) {
    const templateIndex = i % layout.pages.length;
    const pageDef = layout.pages[templateIndex];
    pages.push({
      pageIndex: i,
      medium: pageDef.medium,
      contentArea: pageDef.contentArea,
      masterPageChildren: pageDef.masterPageChildren,
      children: allChunks[i],
    });
  }

  // If no chunks were produced (empty content), create a single page with empty children
  if (pages.length === 0) {
    const pageDef = layout.pages[0];
    pages.push({
      pageIndex: 0,
      medium: pageDef.medium,
      contentArea: pageDef.contentArea,
      masterPageChildren: pageDef.masterPageChildren,
      children: [],
    });
  }

  // Reposition nodes for each page: after calculatePositions, all nodes are positioned
  // against page 1's content area. For pages 2+, we need to shift node positions so they
  // are relative to that page's content area origin.
  const page1ContentArea = firstPageDef.contentArea;
  for (const page of pages) {
    if (page.pageIndex > 0) {
      const yOffset = page1ContentArea.y - page.contentArea.y;
      page.children = repositionNodesForPage(page.children, yOffset);
    }
  }

  return success({ pages, rootSubformName: layout.rootSubformName, rootEvents: layout.rootEvents });
}

/**
 * Reposition all nodes on a page by shifting their y-coordinates.
 * This makes nodes that were positioned against page 1's content area
 * correctly positioned against this page's content area.
 */
function repositionNodesForPage(nodes: LayoutNode[], yOffset: number): LayoutNode[] {
  if (yOffset === 0) return nodes;
  return nodes.map((node) => repositionNodeForPage(node, yOffset));
}

function repositionNodeForPage(node: LayoutNode, yOffset: number): LayoutNode {
  if (node.type === 'subform') {
    const subform = node as SubformNode;
    const newPos = shiftPosition(subform.position, yOffset);
    return {
      ...subform,
      position: newPos,
      children: repositionNodesForPage(subform.children, yOffset),
    } as SubformNode;
  }
  if (node.type === 'field') {
    const field = node as FieldNode;
    return {
      ...field,
      position: shiftPosition(field.position, yOffset),
    } as FieldNode;
  }
  if (node.type === 'draw') {
    const draw = node as DrawNode;
    return {
      ...draw,
      position: shiftPosition(draw.position, yOffset),
    } as DrawNode;
  }
  if (node.type === 'exclGroup') {
    const exclGroup = node as ExclGroupNode;
    return {
      ...exclGroup,
      position: shiftPosition(exclGroup.position, yOffset),
      children: exclGroup.children.map((child) => ({
        ...child,
        position: shiftPosition(child.position, yOffset),
      })) as FieldNode[],
    } as ExclGroupNode;
  }
  return node;
}

function shiftPosition(pos: Position | undefined, yOffset: number): Position {
  if (!pos) return pos ?? {};
  return {
    ...pos,
    y: pos.y != null ? pos.y + yOffset : pos.y,
  };
}

function splitIntoPages(nodes: LayoutNode[], maxHeight: number, pageDef: PageDefinition): LayoutNode[][] {
  const pages: LayoutNode[][] = [];
  let currentPage: LayoutNode[] = [];
  let currentHeight = 0;

  const flushPage = () => {
    if (currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }
  };

  for (const node of nodes) {
    if (isTableRowContainer(node)) {
      const rowNodes = node.type === 'subform' && node.layout === 'table' ? node.children : [node];
      for (const rowNode of rowNodes) {
        const rowHeight = estimateNodeHeight(rowNode);
        if (rowHeight > maxHeight && currentPage.length > 0) {
          flushPage();
        }
        if (currentPage.length > 0 && currentHeight + rowHeight > maxHeight) {
          flushPage();
        }
        currentPage.push(rowNode);
        currentHeight += rowHeight;
      }
      continue;
    }

    const nodeHeight = estimateNodeHeight(node);
    if (currentHeight + nodeHeight > maxHeight && currentPage.length > 0) {
      flushPage();
    }
    currentPage.push(node);
    currentHeight += nodeHeight;
  }

  flushPage();

  void pageDef;
  return pages.length > 0 ? pages : [nodes];
}

function isTableRowContainer(node: LayoutNode): boolean {
  return node.type === 'subform' && node.layout === 'table' && node.children.some((child) => child.type === 'subform' && child.layout === 'row');
}

function estimateNodeHeight(node: LayoutNode): number {
  if (node.type === 'field') return node.position?.h ?? node.position?.minH ?? 18;
  if (node.type === 'draw') return node.position?.h ?? 18;
  if (node.type === 'exclGroup') {
    return node.children.reduce((sum, child) => sum + estimateNodeHeight(child), 0);
  }
  if (node.type === 'subform') {
    if (node.layout === 'row') {
      return node.children.reduce((max, child) => Math.max(max, estimateNodeHeight(child)), 0);
    }
    return node.children.reduce((sum, child) => sum + estimateNodeHeight(child), 0);
  }
  return 18;
}

function defaultPageDef(): PageDefinition {
  return {
    name: 'Page1',
    medium: { stock: 'a4', short: 595.28, long: 841.89 },
    contentArea: { x: 54, y: 54, w: 487.28, h: 733.89 },
    masterPageChildren: [],
  };
}
