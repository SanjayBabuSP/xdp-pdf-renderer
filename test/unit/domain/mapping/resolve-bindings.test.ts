import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { LayoutModel, DataObject } from '../../../../src/types';

function makeLayout(bindRef: string): LayoutModel {
  return {
    rootSubformName: 'value',
    pages: [{
      name: 'Page1',
      medium: { stock: 'a4', short: 595.28, long: 841.89 },
      contentArea: { x: 54, y: 54, w: 487, h: 734 },
      masterPageChildren: [],
    }],
    children: [
      {
        type: 'field',
        name: 'TestField',
        bindMatch: 'dataRef',
        bindRef,
      },
    ],
  };
}

describe('resolve-bindings', () => {
  it('resolves a simple field binding', () => {
    const layout = makeLayout('$.Name');
    const data: DataObject = { Name: 'Acme Corp' };

    const result = resolveBindings(layout, data);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.children[0];
    expect(field.type).toBe('field');
    if (field.type === 'field') expect(field.resolvedValue).toBe('Acme Corp');
  });

  it('resolves a nested field binding', () => {
    const layout = makeLayout('$.Quotation.OEM');
    const data: DataObject = { Quotation: { OEM: 'Test OEM' } as DataObject };

    const result = resolveBindings(layout, data);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.children[0];
    if (field.type === 'field') expect(field.resolvedValue).toBe('Test OEM');
  });

  it('resolvedValue is undefined for missing data', () => {
    const layout = makeLayout('$.MissingField');
    const data: DataObject = { Name: 'Acme' };

    const result = resolveBindings(layout, data);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.children[0];
    if (field.type === 'field') expect(field.resolvedValue).toBeUndefined();
  });

  it('does not mutate the input layout', () => {
    const layout = makeLayout('$.Name');
    const original = JSON.parse(JSON.stringify(layout));
    const data: DataObject = { Name: 'Acme' };

    resolveBindings(layout, data);
    expect(layout).toEqual(original);
  });

  it('skips fields with bindMatch=none', () => {
    const layout: LayoutModel = {
      rootSubformName: 'value',
      pages: [{
        name: 'Page1',
        medium: { stock: 'a4', short: 595.28, long: 841.89 },
        contentArea: { x: 0, y: 0, w: 595, h: 841 },
        masterPageChildren: [],
      }],
      children: [{
        type: 'field',
        name: 'Static',
        bindMatch: 'none',
      }],
    };
    const data: DataObject = { Static: 'should not resolve' };

    const result = resolveBindings(layout, data);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.children[0];
    if (field.type === 'field') expect(field.resolvedValue).toBeUndefined();
  });
});
