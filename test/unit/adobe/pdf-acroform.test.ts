import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFHexString, PDFBool } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  FieldNode,
  LayoutNode,
  PaginatedLayout,
  PaginatedPage,
  SubformNode,
} from '../../../src/types';
import { createAcroFormFields } from '../../../src/adobe/pdf-acroform';

const decoded = (value: PDFObject | undefined): string =>
  (value as PDFName | PDFHexString).decodeText();
const numbered = (value: PDFObject | undefined): number => (value as PDFNumber).asNumber();

const field = (name: string, ui: FieldNode['ui'], extra: Partial<FieldNode> = {}): FieldNode => ({
  type: 'field',
  name,
  ui,
  position: { x: 10, y: 20, w: 100, h: 30 },
  ...extra,
});

const layoutOf = (children: LayoutNode[]): PaginatedLayout => {
  const page: PaginatedPage = {
    pageIndex: 0,
    medium: { stock: 'A4', short: 595, long: 800 },
    contentArea: { x: 0, y: 0, w: 595, h: 800 },
    masterPageChildren: [],
    children,
  };
  return { pages: [page] };
};

describe('G16 — AcroForm field creation', () => {
  it('builds terminal fields, flags, values and page annotations', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const layout = layoutOf([
      field(
        'name',
        { type: 'textEdit' },
        { resolvedValue: 'Ada', assist: { toolTip: 'Full name' } }
      ),
      field('check', { type: 'checkButton', checkedValue: '1' }, { resolvedValue: '1' }),
      field(
        'pick',
        {
          type: 'choiceList',
          open: 'always',
          items: [
            { text: 'One', value: '1' },
            { text: 'Two', value: '2' },
          ],
        },
        { access: 'readOnly', resolvedValue: '2' }
      ),
      field('sig', { type: 'signature' }),
    ]);

    createAcroFormFields(doc, layout);

    const acroForm = doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    expect((acroForm.get(PDFName.of('NeedAppearances')) as PDFBool).asBoolean()).toBe(true);
    expect(decoded(acroForm.get(PDFName.of('DA')))).toBe('/Helv 0 Tf 0 g');
    const helv = acroForm
      .lookup(PDFName.of('DR'), PDFDict)
      .lookup(PDFName.of('Font'), PDFDict)
      .lookup(PDFName.of('Helv'), PDFDict);
    expect(decoded(helv.get(PDFName.of('BaseFont')))).toBe('Helvetica');

    const fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
    expect(fields.size()).toBe(4);
    const terminal = (index: number): PDFDict => fields.lookup(index, PDFDict);

    expect(decoded(terminal(0).get(PDFName.of('T')))).toBe('name');
    expect(decoded(terminal(0).get(PDFName.of('FT')))).toBe('Tx');
    expect(decoded(terminal(0).get(PDFName.of('TU')))).toBe('Full name');
    expect(decoded(terminal(0).get(PDFName.of('V')))).toBe('Ada');
    expect(numbered(terminal(0).get(PDFName.of('F')))).toBe(4);
    expect(terminal(0).get(PDFName.of('Ff'))).toBeUndefined();
    const rect = terminal(0).lookup(PDFName.of('Rect'), PDFArray);
    expect([
      rect.lookup(0, PDFNumber).asNumber(),
      rect.lookup(1, PDFNumber).asNumber(),
      rect.lookup(2, PDFNumber).asNumber(),
      rect.lookup(3, PDFNumber).asNumber(),
    ]).toEqual([10, 750, 110, 780]);

    expect(decoded(terminal(1).get(PDFName.of('FT')))).toBe('Btn');
    expect(decoded(terminal(1).get(PDFName.of('V')))).toBe('Yes');
    expect(decoded(terminal(1).get(PDFName.of('AS')))).toBe('Yes');
    expect(numbered(terminal(1).get(PDFName.of('F')))).toBe(4);

    expect(decoded(terminal(2).get(PDFName.of('FT')))).toBe('Ch');
    expect(decoded(terminal(2).get(PDFName.of('V')))).toBe('2');
    expect(numbered(terminal(2).get(PDFName.of('Ff')))).toBe(1);
    const options = terminal(2).lookup(PDFName.of('Opt'), PDFArray);
    expect(options.size()).toBe(2);
    expect(decoded(options.get(0))).toBe('1');
    expect(decoded(options.get(1))).toBe('2');

    expect(decoded(terminal(3).get(PDFName.of('FT')))).toBe('Sig');
    expect(terminal(3).get(PDFName.of('V'))).toBeUndefined();
    expect(terminal(3).get(PDFName.of('P'))).toBe(page.ref);

    const annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
    expect(annots.size()).toBe(4);
    expect(annots.lookup(0, PDFDict).get(PDFName.of('T'))).toBe(terminal(0).get(PDFName.of('T')));
  });

  it('sets multiline flags and encodes non-Latin1 values as hex strings', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const layout = layoutOf([
      field('multi', { type: 'textEdit', multiLine: true }, { resolvedValue: '日本語' }),
    ]);

    createAcroFormFields(doc, layout);

    const terminal = doc.catalog
      .lookup(PDFName.of('AcroForm'), PDFDict)
      .lookup(PDFName.of('Fields'), PDFArray)
      .lookup(0, PDFDict);
    expect(numbered(terminal.get(PDFName.of('Ff')))).toBe(1 << 12);
    expect(terminal.get(PDFName.of('V'))).toBeInstanceOf(PDFHexString);
    expect(decoded(terminal.get(PDFName.of('V')))).toBe('日本語');
  });

  it('skips hidden, inactive and non-field-capable nodes', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const layout = layoutOf([
      field('hidden', { type: 'textEdit' }, { presence: 'hidden' }),
      field('inactive', { type: 'textEdit' }, { presence: 'inactive' }),
      field('image', { type: 'imageEdit' }),
      field('unknown', { type: 'unknown' }),
      {
        type: 'draw',
        name: 'draw',
        position: { x: 1, y: 1, w: 10, h: 10 },
      },
      field('kept', { type: 'textEdit' }, { position: undefined }),
      field('valid', { type: 'textEdit' }),
    ]);

    createAcroFormFields(doc, layout);

    const fields = doc.catalog
      .lookup(PDFName.of('AcroForm'), PDFDict)
      .lookup(PDFName.of('Fields'), PDFArray);
    expect(fields.size()).toBe(1);
    expect(decoded(fields.lookup(0, PDFDict).get(PDFName.of('T')))).toBe('valid');
  });

  it('honours traversal order unless disabled', async () => {
    const ordered = await PDFDocument.create();
    ordered.addPage();
    const subform: SubformNode = {
      type: 'subform',
      name: 'sub',
      traversal: { order: 'layout', fields: ['A', 'B'] },
      children: [field('B', { type: 'textEdit' }), field('A', { type: 'textEdit' })],
    };
    const unordered = await PDFDocument.create();
    unordered.addPage();

    createAcroFormFields(ordered, layoutOf([subform]));
    createAcroFormFields(unordered, layoutOf([subform]), { tabOrderFromTraversal: false });

    const names = (doc: PDFDocument): string[] =>
      doc.catalog
        .lookup(PDFName.of('AcroForm'), PDFDict)
        .lookup(PDFName.of('Fields'), PDFArray)
        .asArray()
        .map((entry) => decoded((doc.context.lookup(entry) as PDFDict).get(PDFName.of('T'))));
    expect(names(ordered)).toEqual(['sub.A', 'sub.B']);
    expect(names(unordered)).toEqual(['sub.B', 'sub.A']);
  });

  it('does not create an AcroForm when no fields are collectable', async () => {
    const doc = await PDFDocument.create();

    createAcroFormFields(doc, layoutOf([]));

    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
  });
});
