// ────────────────────────────────────────────────────────────────────────────
// PDF Form Tab Ordering — Control the tab order of form fields
// ────────────────────────────────────────────────────────────────────────────

import { PDFDocument, PDFName } from 'pdf-lib';

export type TabOrder = 'documents' | 'fields' | 'structure' | 'appearance';

/**
 * Set the tab order for form fields on a page.
 * Controls the order in which fields receive focus when the user presses Tab.
 *
 * - 'documents': Tab in the order fields appear in the document structure
 * - 'fields': Tab in the order fields are defined in the form
 * - 'structure': Tab according to the tagged structure tree
 * - 'appearance': Tab in visual reading order (top-to-bottom, left-to-right)
 */
export function setTabOrder(page: ReturnType<PDFDocument['getPages']>[0], order: TabOrder): void {
  const orderMap: Record<TabOrder, string> = {
    documents: 'Doc',
    fields: 'Mag',
    structure: 'Struct',
    appearance: 'App',
  };

  const pageDict = page.node;
  pageDict.set(PDFName.of('Tabs'), PDFName.of(orderMap[order]));
}

/**
 * Set tab order for all pages in the document.
 */
export function setGlobalTabOrder(doc: PDFDocument, order: TabOrder): void {
  const pages = doc.getPages();
  for (const page of pages) {
    setTabOrder(page, order);
  }
}

/**
 * Set tab order for specific pages only.
 */
export function setTabOrderForPages(
  doc: PDFDocument,
  pageIndices: number[],
  order: TabOrder
): void {
  const pages = doc.getPages();
  for (const idx of pageIndices) {
    if (idx >= 0 && idx < pages.length) {
      setTabOrder(pages[idx], order);
    }
  }
}
