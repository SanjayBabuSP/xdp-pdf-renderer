import { Result, LayoutModel, LayoutNode, PaginatedLayout, PaginatedPage, PageDefinition } from '../../types';
import { success } from '../../lib/result-type';

/** Split content across multiple pages based on available page height. */
export function applyPagination(layout: LayoutModel, pageHeightPts?: number): Result<PaginatedLayout> {
  const pages: PaginatedPage[] = [];

  for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex++) {
    const pageDef = layout.pages[pageIndex];
    const contentH = pageHeightPts ?? pageDef.contentArea.h;
    const contentNodes = pageIndex === 0 ? layout.children : [];

    const chunks = splitIntoPages(contentNodes, contentH, pageDef);
    chunks.forEach((chunk, chunkIndex) => {
      pages.push({
        pageIndex: pages.length,
        medium: pageDef.medium,
        contentArea: pageDef.contentArea,
        masterPageChildren: pageDef.masterPageChildren,
        children: chunk,
      });
      void chunkIndex;
    });
  }

  if (pages.length === 0) {
    const pageDef = layout.pages[0] ?? defaultPageDef();
    pages.push({
      pageIndex: 0,
      medium: pageDef.medium,
      contentArea: pageDef.contentArea,
      masterPageChildren: pageDef.masterPageChildren,
      children: layout.children,
    });
  }

  return success({ pages });
}

function splitIntoPages(nodes: LayoutNode[], maxHeight: number, pageDef: PageDefinition): LayoutNode[][] {
  const pages: LayoutNode[][] = [];
  let currentPage: LayoutNode[] = [];
  let currentHeight = 0;

  for (const node of nodes) {
    const nodeHeight = estimateNodeHeight(node);
    if (currentHeight + nodeHeight > maxHeight && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }
    currentPage.push(node);
    currentHeight += nodeHeight;
  }

  if (currentPage.length > 0) pages.push(currentPage);

  void pageDef;
  return pages.length > 0 ? pages : [nodes];
}

function estimateNodeHeight(node: LayoutNode): number {
  if (node.type === 'field') return node.position?.h ?? node.position?.minH ?? 18;
  if (node.type === 'draw') return node.position?.h ?? 18;
  if (node.type === 'subform') {
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
