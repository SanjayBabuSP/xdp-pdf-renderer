import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFBool } from 'pdf-lib';
import type { PDFObject } from 'pdf-lib';
import {
  createLayers,
  setLayerState,
  addContentToLayer,
  OCGLayer,
} from '../../../src/adobe/pdf-layers';

const decoded = (value: PDFObject | undefined): string =>
  (value as PDFName | PDFString | PDFHexString).decodeText();

describe('G16 — optional content layers', () => {
  it('creates OCGs, usage, order, default state and view intent', async () => {
    const doc = await PDFDocument.create();
    const layers: OCGLayer[] = [
      { name: 'Visible', visible: true, printable: true, exportable: false },
      { name: 'Hidden', visible: false },
      { name: 'Group', children: [{ name: 'Child A' }, { name: 'Child B' }] },
    ];

    createLayers(doc, layers);

    const ocProps = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const ocgs = ocProps.lookup(PDFName.of('OCGs'), PDFArray);
    expect(ocgs.size()).toBe(3);
    const names = [0, 1, 2].map((i) => decoded(ocgs.lookup(i, PDFDict).get(PDFName.of('Name'))));
    expect(names).toEqual(['Visible', 'Hidden', 'Group']);
    for (const index of [0, 1, 2]) {
      const ocg = ocgs.lookup(index, PDFDict);
      expect(decoded(ocg.get(PDFName.of('Type')))).toBe('OCG');
      const intent = ocg.lookup(PDFName.of('Intent'), PDFArray);
      expect(decoded(intent.get(0))).toBe('View');
      expect(decoded(intent.get(1))).toBe('All');
    }

    const visible = ocgs.lookup(0, PDFDict).lookup(PDFName.of('Usage'), PDFDict);
    const print = visible.lookup(PDFName.of('Print'), PDFDict);
    const exportUsage = visible.lookup(PDFName.of('Export'), PDFDict);
    const view = visible.lookup(PDFName.of('View'), PDFDict);
    expect((print.get(PDFName.of('Print')) as PDFBool).asBoolean()).toBe(true);
    expect(decoded(print.get(PDFName.of('PrintState')))).toBe('ON');
    expect((exportUsage.get(PDFName.of('Export')) as PDFBool).asBoolean()).toBe(false);
    expect(decoded(exportUsage.get(PDFName.of('ExportState')))).toBe('ON');
    expect(decoded(view.get(PDFName.of('ViewState')))).toBe('ON');

    const hidden = ocgs.lookup(1, PDFDict).lookup(PDFName.of('Usage'), PDFDict);
    expect(decoded(hidden.lookup(PDFName.of('Print'), PDFDict).get(PDFName.of('PrintState')))).toBe(
      'OFF'
    );
    expect(
      decoded(hidden.lookup(PDFName.of('Export'), PDFDict).get(PDFName.of('ExportState')))
    ).toBe('OFF');
    expect(decoded(hidden.lookup(PDFName.of('View'), PDFDict).get(PDFName.of('ViewState')))).toBe(
      'OFF'
    );

    const order = ocProps.lookup(PDFName.of('Order'), PDFArray);
    expect(order.size()).toBe(3);
    expect(decoded(order.lookup(0, PDFDict).get(PDFName.of('Name')))).toBe('Visible');
    expect(decoded(order.lookup(1, PDFDict).get(PDFName.of('Name')))).toBe('Hidden');
    const group = order.lookup(2, PDFArray);
    expect(group.size()).toBe(1);
    expect(decoded(group.lookup(0, PDFString))).toBe('Group');

    const defaults = ocProps.lookup(PDFName.of('D'), PDFArray);
    const on = defaults.lookup(0, PDFArray);
    const off = defaults.lookup(1, PDFArray);
    expect([0, 1].map((i) => decoded(on.lookup(i, PDFString)))).toEqual(['Visible', 'Group']);
    expect(decoded(off.lookup(0, PDFString))).toBe('Hidden');

    const asArray = ocProps.lookup(PDFName.of('AS'), PDFArray);
    expect(decoded(asArray.lookup(0, PDFArray).lookup(0, PDFName))).toBe('View');
  });

  it('does not add OCProperties for an empty layer list', async () => {
    const doc = await PDFDocument.create();

    createLayers(doc, []);

    expect(doc.catalog.get(PDFName.of('OCProperties'))).toBeUndefined();
  });

  it('keeps setLayerState a no-op and returns the input stream unchanged', async () => {
    const doc = await PDFDocument.create();
    createLayers(doc, [{ name: 'Only' }]);
    const before = doc.catalog.get(PDFName.of('OCProperties'));

    setLayerState(doc, 'Only', false, 'View');
    const stream = new Uint8Array([1, 2, 3]);

    expect(doc.catalog.get(PDFName.of('OCProperties'))).toBe(before);
    expect(addContentToLayer(stream, 'Only')).toBe(stream);
  });
});
