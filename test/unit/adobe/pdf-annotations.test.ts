import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFHexString, rgb } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  addAnnotation,
  addAnnotations,
  createFieldWidgets,
  AnnotationType,
} from '../../../src/adobe/pdf-annotations';

const decoded = (value: PDFObject | undefined): string =>
  (value as PDFName | PDFHexString).decodeText();
const numbered = (value: PDFObject | undefined): number => (value as PDFNumber).asNumber();
const annotationDict = (doc: PDFDocument, pageIndex: number, index: number): PDFDict =>
  doc.getPage(pageIndex).node.lookup(PDFName.of('Annots'), PDFArray).lookup(index, PDFDict);

describe('G16 — PDF annotations', () => {
  it('creates the requested annotation subtype with a four-number rectangle', async () => {
    const subtypes: Array<[AnnotationType, string]> = [
      ['widget', 'Widget'],
      ['text', 'Text'],
      ['stamp', 'Stamp'],
      ['highlight', 'Highlight'],
      ['link', 'Link'],
      ['freeText', 'FreeText'],
      ['line', 'Line'],
    ];

    for (const [type, subtype] of subtypes) {
      const doc = await PDFDocument.create();
      doc.addPage();

      const result = addAnnotation(doc, { type, rect: [1, 2, 3, 4], pageIndex: 0 });

      expect(result).not.toBeNull();
      const dict = annotationDict(doc, 0, 0);
      expect(decoded(dict.get(PDFName.of('Type')))).toBe('Annot');
      expect(decoded(dict.get(PDFName.of('Subtype')))).toBe(subtype);
      const rect = dict.lookup(PDFName.of('Rect'), PDFArray);
      expect([
        rect.lookup(0, PDFNumber).asNumber(),
        rect.lookup(1, PDFNumber).asNumber(),
        rect.lookup(2, PDFNumber).asNumber(),
        rect.lookup(3, PDFNumber).asNumber(),
      ]).toEqual([1, 2, 3, 4]);
    }
  });

  it('returns null and leaves pages untouched for invalid page indices', async () => {
    for (const pageIndex of [-1, 1]) {
      const doc = await PDFDocument.create();
      doc.addPage();

      expect(addAnnotation(doc, { type: 'text', rect: [0, 0, 1, 1], pageIndex })).toBeNull();
      expect(doc.getPage(0).node.get(PDFName.of('Annots'))).toBeUndefined();
    }
  });

  it('writes metadata, flags, colors, opacity and stamp names', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();

    addAnnotation(doc, {
      type: 'stamp',
      pageIndex: 1,
      rect: [10, 20, 30, 40],
      contents: 'hello',
      subject: 'subj',
      author: 'auth',
      flags: ['print', 'hidden', 'readOnly'],
      borderColor: rgb(0.1, 0.2, 0.3),
      backgroundColor: rgb(0.4, 0.5, 0.6),
      opacity: 0.5,
      stampName: 'Approved',
    });

    const dict = annotationDict(doc, 1, 0);
    expect(decoded(dict.get(PDFName.of('Contents')))).toBe('hello');
    expect(decoded(dict.get(PDFName.of('Subj')))).toBe('subj');
    expect(decoded(dict.get(PDFName.of('T')))).toBe('auth');
    expect(numbered(dict.get(PDFName.of('F')))).toBe(4 | 2 | 64);
    expect(decoded(dict.get(PDFName.of('Name')))).toBe('Approved');
    expect(numbered(dict.get(PDFName.of('CA')))).toBe(0.5);
    const border = dict.lookup(PDFName.of('C'), PDFArray);
    expect([
      border.lookup(0, PDFNumber).asNumber(),
      border.lookup(1, PDFNumber).asNumber(),
      border.lookup(2, PDFNumber).asNumber(),
    ]).toEqual([0.1, 0.2, 0.3]);
    const background = dict.lookup(PDFName.of('IC'), PDFArray);
    expect([
      background.lookup(0, PDFNumber).asNumber(),
      background.lookup(1, PDFNumber).asNumber(),
      background.lookup(2, PDFNumber).asNumber(),
    ]).toEqual([0.4, 0.5, 0.6]);
    expect(doc.getPage(0).node.get(PDFName.of('Annots'))).toBeUndefined();
  });

  it('writes a URI action for link annotations', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    addAnnotation(doc, {
      type: 'link',
      pageIndex: 0,
      rect: [0, 0, 1, 1],
      linkTarget: 'https://example.com',
    });

    const action = annotationDict(doc, 0, 0).lookup(PDFName.of('A'), PDFDict);
    expect(decoded(action.get(PDFName.of('S')))).toBe('URI');
    expect(decoded(action.get(PDFName.of('URI')))).toBe('https://example.com');
  });

  it('writes default and explicit free-text appearance strings', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    addAnnotation(doc, { type: 'freeText', pageIndex: 0, rect: [0, 0, 1, 1] });
    addAnnotation(doc, {
      type: 'freeText',
      pageIndex: 0,
      rect: [0, 0, 1, 1],
      fontSize: 9,
      textColor: rgb(1, 0, 0),
    });

    expect(decoded(annotationDict(doc, 0, 0).get(PDFName.of('DA')))).toBe(
      '/Helv 12.0 Tf 0.000 0.000 0.000 rg'
    );
    expect(decoded(annotationDict(doc, 0, 1).get(PDFName.of('DA')))).toBe(
      '/Helv 9.0 Tf 1.000 0.000 0.000 rg'
    );
  });

  it('appends multiple annotations to the same page', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    addAnnotations(doc, [
      { type: 'text', rect: [0, 0, 1, 1], pageIndex: 0 },
      { type: 'highlight', rect: [1, 1, 2, 2], pageIndex: 0 },
    ]);

    const annots = doc.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(2);
    expect(decoded(annots.lookup(0, PDFDict).get(PDFName.of('Subtype')))).toBe('Text');
    expect(decoded(annots.lookup(1, PDFDict).get(PDFName.of('Subtype')))).toBe('Highlight');
  });

  it('creates hidden widget annotations by default and honours visibility options', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();

    createFieldWidgets(doc, 'field', 0, [0, 0, 10, 10]);
    createFieldWidgets(doc, 'field2', 0, [0, 0, 10, 10], {
      visible: true,
      readOnly: true,
      tooltip: 'Tip',
      value: 'V',
    });

    const first = annotationDict(doc, 0, 0);
    const second = annotationDict(doc, 0, 1);
    expect(decoded(first.get(PDFName.of('Subtype')))).toBe('Widget');
    expect(numbered(first.get(PDFName.of('F')))).toBe(4 | 2);
    expect(first.get(PDFName.of('Contents'))).toBeUndefined();
    expect(numbered(second.get(PDFName.of('F')))).toBe(4 | 64);
    expect(decoded(second.get(PDFName.of('Contents')))).toBe('Tip');
  });
});
