import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { ERROR_CODES } from '../../../../src/errors/error-codes';
import { LayoutModel, LayoutNode, DataObject } from '../../../../src/types';

function makeLayout(bindRef: string): LayoutModel {
  return {
    rootSubformName: 'value',
    pages: [
      {
        name: 'Page1',
        medium: { stock: 'a4', short: 595.28, long: 841.89 },
        contentArea: { x: 54, y: 54, w: 487, h: 734 },
        masterPageChildren: [],
      },
    ],
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
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 595.28, long: 841.89 },
          contentArea: { x: 0, y: 0, w: 595, h: 841 },
          masterPageChildren: [],
        },
      ],
      children: [
        {
          type: 'field',
          name: 'Static',
          bindMatch: 'none',
        },
      ],
    };
    const data: DataObject = { Static: 'should not resolve' };

    const result = resolveBindings(layout, data);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const field = result.data.children[0];
    if (field.type === 'field') expect(field.resolvedValue).toBeUndefined();
  });
});

describe('resolve-bindings — remaining node kinds and scopes', () => {
  function layoutWith(children: LayoutNode[], masterPageChildren: LayoutNode[] = []): LayoutModel {
    return {
      rootSubformName: 'value',
      pages: [
        {
          name: 'Page1',
          medium: { stock: 'a4', short: 595.28, long: 841.89 },
          contentArea: { x: 0, y: 0, w: 595, h: 841 },
          masterPageChildren,
        },
      ],
      children,
    };
  }

  it('resolves draw nodes unchanged and exclGroup children', () => {
    const layout = layoutWith([
      { type: 'draw', name: 'D', value: { type: 'text', content: 'static' } },
      {
        type: 'exclGroup',
        name: 'G',
        bindMatch: 'none',
        children: [{ type: 'field', name: 'Child', defaultValue: 'fallback' }],
      },
    ]);

    const result = resolveBindings(layout, {});

    expect(result.success).toBe(true);
    if (!result.success) return;
    const draw = result.data.children[0];
    if (draw.type !== 'draw') throw new Error('expected draw');
    expect(draw.value).toEqual({ type: 'text', content: 'static' });
    const group = result.data.children[1];
    if (group.type !== 'exclGroup') throw new Error('expected exclGroup');
    const child = group.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('fallback');
  });

  it('uses an object bound to a subform as the child scope', () => {
    const layout = layoutWith([
      {
        type: 'subform',
        name: 'Q',
        bindMatch: 'dataRef',
        bindRef: '$.Quotation',
        children: [{ type: 'field', name: 'OEM', bindMatch: 'dataRef', bindRef: '$.OEM' }],
      },
    ]);

    const result = resolveBindings(layout, { Quotation: { OEM: 'Scoped' } });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const sub = result.data.children[0];
    if (sub.type !== 'subform') throw new Error('expected subform');
    const child = sub.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('Scoped');
  });

  it('keeps the parent scope when a subform binds to an array', () => {
    const layout = layoutWith([
      {
        type: 'subform',
        name: 'Q',
        bindMatch: 'dataRef',
        bindRef: '$.Quotation',
        children: [{ type: 'field', name: 'OEM', bindMatch: 'dataRef', bindRef: '$.OEM' }],
      },
    ]);

    const result = resolveBindings(layout, { Quotation: [1], OEM: 'FromRoot' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const sub = result.data.children[0];
    if (sub.type !== 'subform') throw new Error('expected subform');
    const child = sub.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('FromRoot');
  });

  it('uses defaultValue when a bound field has no data', () => {
    const layout = layoutWith([
      {
        type: 'field',
        name: 'F',
        bindMatch: 'dataRef',
        bindRef: '$.Missing',
        defaultValue: 'fallback',
      },
      { type: 'field', name: 'G', defaultValue: 'default' },
      { type: 'field', name: 'H', resolvedValue: 'kept', defaultValue: 'ignored' },
    ]);

    const result = resolveBindings(layout, {});

    expect(result.success).toBe(true);
    if (!result.success) return;
    const resolved = result.data.children;
    if (
      resolved[0].type !== 'field' ||
      resolved[1].type !== 'field' ||
      resolved[2].type !== 'field'
    ) {
      throw new Error('expected fields');
    }
    expect(resolved[0].resolvedValue).toBe('fallback');
    expect(resolved[1].resolvedValue).toBe('default');
    expect(resolved[2].resolvedValue).toBe('kept');
  });

  it('resolves an exclGroup value and exposes it to child bindings', () => {
    const layout = layoutWith([
      {
        type: 'exclGroup',
        name: 'E',
        bindMatch: 'dataRef',
        bindRef: '$.Group',
        children: [{ type: 'field', name: 'Label', bindMatch: 'dataRef', bindRef: '$.Label' }],
      },
    ]);

    const result = resolveBindings(layout, { Group: { Label: 'FromGroup' } });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const group = result.data.children[0];
    if (group.type !== 'exclGroup') throw new Error('expected exclGroup');
    expect(group.resolvedValue).toEqual({ Label: 'FromGroup' });
    const child = group.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('FromGroup');
  });

  it('keeps the parent scope when an exclGroup binds to a primitive', () => {
    const layout = layoutWith([
      {
        type: 'exclGroup',
        name: 'E',
        bindMatch: 'dataRef',
        bindRef: '$.Group',
        children: [{ type: 'field', name: 'Label', bindMatch: 'dataRef', bindRef: '$.Label' }],
      },
    ]);

    const result = resolveBindings(layout, { Group: 'primitive', Label: 'FromRoot' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const group = result.data.children[0];
    if (group.type !== 'exclGroup') throw new Error('expected exclGroup');
    expect(group.resolvedValue).toBe('primitive');
    const child = group.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('FromRoot');
  });

  it('resolves master-page children', () => {
    const layout = layoutWith(
      [],
      [{ type: 'field', name: 'M', bindMatch: 'dataRef', bindRef: '$.Name' }]
    );

    const result = resolveBindings(layout, { Name: 'Master' });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const master = result.data.pages[0].masterPageChildren[0];
    if (master.type !== 'field') throw new Error('expected field');
    expect(master.resolvedValue).toBe('Master');
  });

  it('returns a failure result when resolution throws', () => {
    const data: DataObject = {};
    Object.defineProperty(data, 'Boom', {
      get: () => {
        throw new Error('boom');
      },
    });

    const result = resolveBindings(
      layoutWith([{ type: 'field', name: 'F', bindMatch: 'dataRef', bindRef: '$.Boom' }]),
      data
    );

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ERROR_CODES.BINDING_FAILED.code);
    expect(result.error.message).toContain('Failed to resolve data binding');
  });
});
