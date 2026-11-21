import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFBool,
  PDFNumber,
  PDFHexString,
  PDFString,
  PDFRef,
} from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import { markDocumentTagged } from '../../../src/adobe/pdf-tagged';

const decoded = (value: PDFObject | undefined): string =>
  (value as PDFName | PDFString | PDFHexString).decodeText();
const numbered = (value: PDFObject | undefined): number => (value as PDFNumber).asNumber();

describe('G16 — tagged PDF structure', () => {
  it('writes MarkInfo, language, title and a structure tree for every page', async () => {
    const doc = await PDFDocument.create();
    const first = doc.addPage();
    const second = doc.addPage();
    doc.setTitle('Original');

    markDocumentTagged(doc, { language: 'en-US', title: 'Tagged Title' });

    const markInfo = doc.catalog.lookup(PDFName.of('MarkInfo'), PDFDict);
    expect((markInfo.get(PDFName.of('Marked')) as PDFBool).asBoolean()).toBe(true);
    expect(decoded(doc.catalog.get(PDFName.of('Lang')))).toBe('en-US');
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    expect(decoded(info.get(PDFName.of('Title')))).toBe('Tagged Title');

    const structTreeRoot = doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict);
    expect(decoded(structTreeRoot.get(PDFName.of('Type')))).toBe('StructTreeRoot');
    expect(numbered(structTreeRoot.get(PDFName.of('ParentTreeNextKey')))).toBe(1);
    const parentTree = structTreeRoot.lookup(PDFName.of('ParentTree'), PDFDict);
    expect(parentTree.lookup(PDFName.of('Nums'), PDFArray).size()).toBe(0);

    const documentElement = structTreeRoot.lookup(PDFName.of('K'), PDFDict);
    expect(decoded(documentElement.get(PDFName.of('Type')))).toBe('StructElem');
    expect(decoded(documentElement.get(PDFName.of('S')))).toBe('Document');
    const parentRef = documentElement.get(PDFName.of('P')) as PDFRef;
    expect(parentRef).toBeInstanceOf(PDFRef);
    expect(doc.context.lookup(parentRef, PDFDict)).toBe(structTreeRoot);

    const kids = documentElement.lookup(PDFName.of('K'), PDFArray);
    expect(kids.size()).toBe(2);
    const paragraph = kids.lookup(0, PDFDict);
    expect(decoded(paragraph.get(PDFName.of('Type')))).toBe('StructElem');
    expect(decoded(paragraph.get(PDFName.of('S')))).toBe('P');
    expect(paragraph.get(PDFName.of('Pg'))).toBe(first.ref);
    expect(kids.lookup(1, PDFDict).get(PDFName.of('Pg'))).toBe(second.ref);
    expect(numbered(first.node.get(PDFName.of('StructParents')))).toBe(0);
    expect(numbered(second.node.get(PDFName.of('StructParents')))).toBe(0);
  });

  it('omits language and preserves the info title when no options are supplied', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.setTitle('Keep Me');

    markDocumentTagged(doc);

    expect(doc.catalog.get(PDFName.of('Lang'))).toBeUndefined();
    expect(doc.getTitle()).toBe('Keep Me');
    expect(doc.catalog.lookup(PDFName.of('StructTreeRoot'), PDFDict)).toBeInstanceOf(PDFDict);
  });
});
