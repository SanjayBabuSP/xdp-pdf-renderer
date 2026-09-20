import { Result, LayoutModel, LayoutNode, PaginatedLayout, PaginatedPage, PageDefinition } from '../../types';
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
    return success({ pages });
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

  return success({ pages });
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
