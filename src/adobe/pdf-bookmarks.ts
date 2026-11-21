import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString, PDFPage } from 'pdf-lib';

export interface BookmarkItem {
  title: string;
  pageIndex: number;
  zoom?: number;
  y?: number;
  children?: BookmarkItem[];
  closed?: boolean;
}

export function addBookmarks(doc: PDFDocument, bookmarks: BookmarkItem[]): void {
  if (bookmarks.length === 0) return;

  const context = doc.context;
  const pages = doc.getPages();

  const outlineItems: PDFDict[] = [];
  for (const bm of bookmarks) {
    outlineItems.push(createOutlineItem(context, bm, pages));
  }

  if (outlineItems.length === 0) return;

  const firstRef = context.register(outlineItems[0]);
  const lastRef = context.register(outlineItems[outlineItems.length - 1]);

  for (let i = 0; i < outlineItems.length; i++) {
    const item = outlineItems[i];

    if (i > 0) {
      const prevRef = context.register(outlineItems[i - 1]);
      item.set(PDFName.of('Prev'), prevRef);
    }
    if (i < outlineItems.length - 1) {
      const nextRef = context.register(outlineItems[i + 1]);
      item.set(PDFName.of('Next'), nextRef);
    }
  }

  const outlineDict = context.obj({}) as PDFDict;
  outlineDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlineDict.set(PDFName.of('First'), firstRef);
  outlineDict.set(PDFName.of('Last'), lastRef);
  outlineDict.set(PDFName.of('Count'), PDFNumber.of(bookmarks.length));

  const outlineRef = context.register(outlineDict);

  const catalog = context.lookup(context.trailerInfo.Root) as PDFDict;
  if (catalog) {
    catalog.set(PDFName.of('Outlines'), outlineRef);
  }
}

function createOutlineItem(
  context: PDFDocument['context'],
  item: BookmarkItem,
  pages: PDFPage[]
): PDFDict {
  const dict = context.obj({}) as PDFDict;
  dict.set(PDFName.of('Title'), PDFString.of(item.title));

  if (item.pageIndex >= 0 && item.pageIndex < pages.length) {
    const dest = context.obj([]) as PDFArray;
    dest.push(PDFName.of('XYZ'));
    dest.push(PDFNumber.of(0));
    dest.push(PDFNumber.of(item.y ?? 0));
    dest.push(PDFNumber.of(item.zoom ?? 0));
    dict.set(PDFName.of('Dest'), dest);
  }

  if (item.children && item.children.length) {
    const childItems: PDFDict[] = [];
    for (const child of item.children) {
      childItems.push(createOutlineItem(context, child, pages));
    }

    if (childItems.length) {
      const firstChildRef = context.register(childItems[0]);
      const lastChildRef = context.register(childItems[childItems.length - 1]);
      dict.set(PDFName.of('First'), firstChildRef);
      dict.set(PDFName.of('Last'), lastChildRef);
      dict.set(PDFName.of('Count'), PDFNumber.of(countBookmarks(item.children)));

      if (item.closed) {
        dict.set(PDFName.of('Count'), PDFNumber.of(-countBookmarks(item.children)));
      }

      for (let i = 0; i < childItems.length; i++) {
        if (i > 0) {
          childItems[i].set(PDFName.of('Prev'), context.register(childItems[i - 1]));
        }
        if (i < childItems.length - 1) {
          childItems[i].set(PDFName.of('Next'), context.register(childItems[i + 1]));
        }
        childItems[i].set(PDFName.of('Parent'), context.register(dict));
      }
    }
  }

  return dict;
}

function countBookmarks(items: BookmarkItem[]): number {
  let count = items.length;
  for (const item of items) {
    if (item.children) {
      count += countBookmarks(item.children);
    }
  }
  return count;
}

export function autoGenerateBookmarks(pageNames: string[], pageIndices: number[]): BookmarkItem[] {
  return pageNames.map((name, i) => ({
    title: name,
    pageIndex: pageIndices[i] ?? i,
  }));
}
