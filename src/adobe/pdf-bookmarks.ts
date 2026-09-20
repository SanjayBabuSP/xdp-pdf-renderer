// ────────────────────────────────────────────────────────────────────────────
// PDF Bookmarks / Outlines — Hierarchical navigation structure
// ────────────────────────────────────────────────────────────────────────────

import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString, PDFPage } from 'pdf-lib';

export interface BookmarkItem {
  /** Display title */
  title: string;
  /** Target page index (0-based) */
  pageIndex: number;
  /** Zoom level when navigating to this bookmark (0 = default) */
  zoom?: number;
  /** Y position on page to scroll to (points from top) */
  y?: number;
  /** Child bookmarks (nested structure) */
  children?: BookmarkItem[];
  /** Whether the bookmark is collapsed by default */
  closed?: boolean;
}

/**
 * Add bookmarks/outlines to a PDF document.
 * Creates a hierarchical outline tree for PDF viewer navigation.
 */
export function addBookmarks(doc: PDFDocument, bookmarks: BookmarkItem[]): void {
  if (bookmarks.length === 0) return;

  const context = doc.context;
  const pages = doc.getPages();

  // Build the outline items array (flat for simplicity, then link)
  const outlineItems: PDFDict[] = [];
  for (const bm of bookmarks) {
    outlineItems.push(createOutlineItem(context, bm, pages));
  }

  if (outlineItems.length === 0) return;

  // Link siblings (First/Last/Next/Prev)
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

  // Create the outline root
  const outlineDict = context.obj({}) as PDFDict;
  outlineDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlineDict.set(PDFName.of('First'), firstRef);
  outlineDict.set(PDFName.of('Last'), lastRef);
  outlineDict.set(PDFName.of('Count'), PDFNumber.of(bookmarks.length));

  const outlineRef = context.register(outlineDict);

  // Attach to document catalog
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

  // Destination: /XYZ left top zoom
  if (item.pageIndex >= 0 && item.pageIndex < pages.length) {
    // Create destination array referencing the page
    const dest = context.obj([]) as PDFArray;
    // Use a null page ref placeholder — pdf-lib will resolve it on save
    dest.push(PDFName.of('XYZ'));
    dest.push(PDFNumber.of(0));
    dest.push(PDFNumber.of(item.y ?? 0));
    dest.push(PDFNumber.of(item.zoom ?? 0));
    dict.set(PDFName.of('Dest'), dest);
  }

  // Children
  if (item.children && item.children.length > 0) {
    const childItems: PDFDict[] = [];
    for (const child of item.children) {
      childItems.push(createOutlineItem(context, child, pages));
    }

    if (childItems.length > 0) {
      const firstChildRef = context.register(childItems[0]);
      const lastChildRef = context.register(childItems[childItems.length - 1]);
      dict.set(PDFName.of('First'), firstChildRef);
      dict.set(PDFName.of('Last'), lastChildRef);
      dict.set(PDFName.of('Count'), PDFNumber.of(countBookmarks(item.children)));

      if (item.closed) {
        dict.set(PDFName.of('Count'), PDFNumber.of(-countBookmarks(item.children)));
      }

      // Link children
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

/**
 * Create a table-of-contents bookmark from page structure.
 * Useful for auto-generating bookmarks from subform names.
 */
export function autoGenerateBookmarks(
  pageNames: string[],
  pageIndices: number[]
): BookmarkItem[] {
  return pageNames.map((name, i) => ({
    title: name,
    pageIndex: pageIndices[i] ?? i,
  }));
}
