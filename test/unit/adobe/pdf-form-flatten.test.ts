import { PDFDocument } from 'pdf-lib';
import {
  flattenFormFields,
  readOnlyFormFields,
  removeFormFields,
  listFormFields,
} from '../../../src/adobe/pdf-form-flatten';

const formDoc = async (): Promise<PDFDocument> => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const alpha = form.createTextField('alpha');
  alpha.addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  const beta = form.createTextField('beta');
  beta.addToPage(page, { x: 10, y: 40, width: 100, height: 20 });
  return doc;
};

describe('G16 — form field operations', () => {
  it('lists fields with their concrete types and returns empty for a blank document', async () => {
    const blank = await PDFDocument.create();
    const doc = await formDoc();

    expect(listFormFields(blank)).toEqual([]);
    expect(listFormFields(doc)).toEqual([
      { name: 'alpha', type: 'PDFTextField' },
      { name: 'beta', type: 'PDFTextField' },
    ]);
  });

  it('makes selected fields read-only, then all fields when no names are given', async () => {
    const doc = await formDoc();

    readOnlyFormFields(doc, { fieldNames: ['alpha'] });
    expect(doc.getForm().getTextField('alpha').isReadOnly()).toBe(true);
    expect(doc.getForm().getTextField('beta').isReadOnly()).toBe(false);

    readOnlyFormFields(doc);
    expect(doc.getForm().getTextField('alpha').isReadOnly()).toBe(true);
    expect(doc.getForm().getTextField('beta').isReadOnly()).toBe(true);
  });

  it('removes named fields and then all remaining fields', async () => {
    const doc = await formDoc();

    removeFormFields(doc, ['alpha']);
    expect(listFormFields(doc)).toEqual([{ name: 'beta', type: 'PDFTextField' }]);

    removeFormFields(doc);
    expect(listFormFields(doc)).toEqual([]);
  });

  it('flattens the whole form but leaves fields intact when names are supplied', async () => {
    const all = await formDoc();
    const selected = await formDoc();

    flattenFormFields(selected, { fieldNames: ['alpha'] });
    expect(listFormFields(selected)).toEqual([
      { name: 'alpha', type: 'PDFTextField' },
      { name: 'beta', type: 'PDFTextField' },
    ]);

    flattenFormFields(all);
    expect(listFormFields(all)).toEqual([]);
  });
});
