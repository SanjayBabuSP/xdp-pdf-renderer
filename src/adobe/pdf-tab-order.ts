
import { PDFDocument, PDFName } from 'pdf-lib';

export type TabOrder = 'documents' | 'fields' | 'structure' | 'appearance';

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

export function setGlobalTabOrder(doc: PDFDocument, order: TabOrder): void {
  const pages = doc.getPages();
  for (const page of pages) {
    setTabOrder(page, order);
  }
}

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
