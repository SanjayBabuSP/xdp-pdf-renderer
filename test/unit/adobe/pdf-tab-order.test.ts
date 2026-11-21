import { PDFDocument, PDFName } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  setTabOrder,
  setGlobalTabOrder,
  setTabOrderForPages,
  TabOrder,
} from '../../../src/adobe/pdf-tab-order';

const decoded = (value: PDFObject | undefined): string => (value as PDFName).decodeText();

describe('G16 — tab order', () => {
  const cases: Array<[TabOrder, string]> = [
    ['documents', 'Doc'],
    ['fields', 'Mag'],
    ['structure', 'Struct'],
    ['appearance', 'App'],
  ];

  for (const [order, expected] of cases) {
    it(`maps ${order} tab order to /${expected}`, async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage();

      setTabOrder(page, order);

      expect(decoded(page.node.get(PDFName.of('Tabs')))).toBe(expected);
    });
  }

  it('sets the order on every page and ignores invalid indices', async () => {
    const doc = await PDFDocument.create();
    const first = doc.addPage();
    const second = doc.addPage();
    const third = doc.addPage();

    setGlobalTabOrder(doc, 'fields');
    expect(
      [first, second, third].map((page) => decoded(page.node.get(PDFName.of('Tabs'))))
    ).toEqual(['Mag', 'Mag', 'Mag']);

    setTabOrderForPages(doc, [-1, 1, 99], 'structure');
    expect(
      [first, second, third].map((page) => decoded(page.node.get(PDFName.of('Tabs'))))
    ).toEqual(['Mag', 'Struct', 'Mag']);
  });
});
