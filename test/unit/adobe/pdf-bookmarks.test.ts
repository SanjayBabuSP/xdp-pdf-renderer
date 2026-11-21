import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRef } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  addBookmarks,
  autoGenerateBookmarks,
  BookmarkItem,
} from '../../../src/adobe/pdf-bookmarks';

const decoded = (value: PDFObject | undefined): string => (value as PDFName).decodeText();
const numbered = (value: PDFObject | undefined): number => (value as PDFNumber).asNumber();

describe('G16 — PDF bookmarks', () => {
  it('auto-generates bookmarks with provided and positional page indices', () => {
    const bookmarks = autoGenerateBookmarks(['Alpha', 'Beta', 'Gamma'], [5, 9]);

    expect(bookmarks).toEqual([
      { title: 'Alpha', pageIndex: 5 },
      { title: 'Beta', pageIndex: 9 },
      { title: 'Gamma', pageIndex: 2 },
    ]);
  });

  it('does not add an outline for an empty bookmark list', async () => {
    const doc = await PDFDocument.create();

    addBookmarks(doc, []);

    expect(doc.catalog.get(PDFName.of('Outlines'))).toBeUndefined();
  });

  it('creates a linked outline tree with destinations and closed children', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    doc.addPage();
    const items: BookmarkItem[] = [
      { title: 'First', pageIndex: 0, y: 700, zoom: 2 },
      {
        title: 'Group',
        pageIndex: 1,
        closed: true,
        children: [
          { title: 'Child A', pageIndex: 1 },
          { title: 'Child B', pageIndex: 2 },
        ],
      },
      { title: 'Off-page', pageIndex: 99 },
    ];

    addBookmarks(doc, items);

    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    expect(decoded(outlines.get(PDFName.of('Type')))).toBe('Outlines');
    expect(numbered(outlines.get(PDFName.of('Count')))).toBe(3);

    const first = outlines.lookup(PDFName.of('First'), PDFDict);
    const last = outlines.lookup(PDFName.of('Last'), PDFDict);
    expect(decoded(first.get(PDFName.of('Title')))).toBe('First');
    expect(decoded(last.get(PDFName.of('Title')))).toBe('Off-page');
    expect(first.get(PDFName.of('Prev'))).toBeUndefined();
    expect(last.get(PDFName.of('Next'))).toBeUndefined();

    const nextOfFirst = doc.context.lookup(first.get(PDFName.of('Next')) as PDFRef, PDFDict);
    expect(decoded(nextOfFirst.get(PDFName.of('Title')))).toBe('Group');
    const prevOfLast = doc.context.lookup(last.get(PDFName.of('Prev')) as PDFRef, PDFDict);
    expect(decoded(prevOfLast.get(PDFName.of('Title')))).toBe('Group');

    const dest = first.lookup(PDFName.of('Dest'), PDFArray);
    expect(decoded(dest.get(0))).toBe('XYZ');
    expect(numbered(dest.get(1))).toBe(0);
    expect(numbered(dest.get(2))).toBe(700);
    expect(numbered(dest.get(3))).toBe(2);

    const childFirst = nextOfFirst.lookup(PDFName.of('First'), PDFDict);
    const childLast = nextOfFirst.lookup(PDFName.of('Last'), PDFDict);
    expect(decoded(childFirst.get(PDFName.of('Title')))).toBe('Child A');
    expect(decoded(childLast.get(PDFName.of('Title')))).toBe('Child B');
    expect(numbered(nextOfFirst.get(PDFName.of('Count')))).toBe(-2);

    const parent = doc.context.lookup(childFirst.get(PDFName.of('Parent')) as PDFRef, PDFDict);
    expect(decoded(parent.get(PDFName.of('Title')))).toBe('Group');
    const sibling = doc.context.lookup(childFirst.get(PDFName.of('Next')) as PDFRef, PDFDict);
    expect(decoded(sibling.get(PDFName.of('Title')))).toBe('Child B');
    expect(childFirst.get(PDFName.of('Prev'))).toBeUndefined();
    expect(childLast.get(PDFName.of('Next'))).toBeUndefined();

    const childDest = childFirst.lookup(PDFName.of('Dest'), PDFArray);
    expect(numbered(childDest.get(2))).toBe(0);
    expect(numbered(childDest.get(3))).toBe(0);
    expect(last.get(PDFName.of('Dest'))).toBeUndefined();
  });
});
