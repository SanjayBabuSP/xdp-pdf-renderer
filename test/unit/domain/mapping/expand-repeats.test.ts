import { expandRepeats } from '../../../../src/domain/mapping/expand-repeats';
import { ERROR_CODES } from '../../../../src/errors/error-codes';
import { DataObject, LayoutModel, LayoutNode, SubformNode } from '../../../../src/types';

function makeLayout(children: LayoutNode[], masterPageChildren: LayoutNode[] = []): LayoutModel {
  return {
    rootSubformName: 'value',
    pages: [
      {
        name: 'Page1',
        medium: { stock: 'a4', short: 595.28, long: 841.89 },
        contentArea: { x: 54, y: 54, w: 487, h: 734 },
        masterPageChildren,
      },
    ],
    children,
  };
}

function field(name: string, bindRef: string): LayoutNode {
  return { type: 'field', name, bindMatch: 'dataRef', bindRef };
}

function subform(children: LayoutNode[], extra: Partial<SubformNode> = {}): LayoutNode {
  return { type: 'subform', name: 'Sub', layout: 'tb', children, ...extra };
}

describe('expandRepeats', () => {
  it('resolves fields and stamps uids across children and master pages', () => {
    const layout = makeLayout(
      [field('Name', '$.Name'), { type: 'draw', name: 'Static' }],
      [{ type: 'draw', name: 'Header' }]
    );
    const data: DataObject = { Name: 'Acme' };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const resolved = result.data.children[0];
    if (resolved.type !== 'field') throw new Error('expected field');
    expect(resolved.resolvedValue).toBe('Acme');
    expect(resolved.uid).toBe('Name');
    expect(result.data.children[1].uid).toBe('Static');
    expect(result.data.pages[0].masterPageChildren[0].uid).toBe('Header');
  });

  it('expands a repeating subform into one instance per array item', () => {
    const layout = makeLayout([
      subform([field('name', '$.name')], {
        name: 'Row',
        occur: { min: 0, max: -1 },
        bindMatch: 'dataRef',
        bindRef: '$.Items[*]',
      }),
    ]);
    const data: DataObject = {
      Items: [{ name: 'alpha' }, { name: 'beta' }],
    };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.children).toHaveLength(2);
    const first = result.data.children[0];
    const second = result.data.children[1];
    if (first.type !== 'subform' || second.type !== 'subform') throw new Error('expected subform');
    expect(first.repeatIndex).toBe(0);
    expect(second.repeatIndex).toBe(1);
    expect(first.occur).toBeUndefined();
    expect(second.occur).toBeUndefined();
    expect(first.bindRef).toBe('$.Items[0]');
    expect(second.bindRef).toBe('$.Items[1]');
    const firstField = first.children[0];
    const secondField = second.children[0];
    if (firstField.type !== 'field' || secondField.type !== 'field')
      throw new Error('expected field');
    expect(firstField.resolvedValue).toBe('alpha');
    expect(secondField.resolvedValue).toBe('beta');
  });

  it('keeps a single expanded node when the repeating subform ref is not an array', () => {
    const layout = makeLayout([
      subform([field('name', '$.name')], {
        name: 'Row',
        occur: { max: 3 },
        bindMatch: 'dataRef',
        bindRef: '$.Items[*]',
      }),
    ]);
    const data: DataObject = { Items: 'not-an-array' };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.children).toHaveLength(1);
    const node = result.data.children[0];
    if (node.type !== 'subform') throw new Error('expected subform');
    expect(node.repeatIndex).toBeUndefined();
    expect(node.occur).toEqual({ max: 3 });
    expect(node.bindRef).toBe('$.Items[*]');
  });

  it('expands via a descendant array binding found in a nested subform', () => {
    const layout = makeLayout([
      subform([subform([field('cell', '$.cells[*]')], { name: 'Inner' })], {
        name: 'Rows',
        occur: { max: -1 },
      }),
    ]);
    const data: DataObject = { cells: ['x', 'y'] };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.children).toHaveLength(2);
    const instances = result.data.children;
    if (instances[0].type !== 'subform' || instances[1].type !== 'subform') {
      throw new Error('expected subform');
    }
    expect(instances[0].occur).toBeUndefined();
    expect(instances[1].occur).toBeUndefined();
    expect(instances[0].repeatIndex).toBe(0);
    expect(instances[1].repeatIndex).toBe(1);
    const inner0 = instances[0].children[0];
    const inner1 = instances[1].children[0];
    if (inner0.type !== 'subform' || inner1.type !== 'subform') throw new Error('expected subform');
    const cell0 = inner0.children[0];
    const cell1 = inner1.children[0];
    if (cell0.type !== 'field' || cell1.type !== 'field') throw new Error('expected field');
    expect(cell0.resolvedValue).toBe('x');
    expect(cell1.resolvedValue).toBe('y');
  });

  it('skips repeating child subforms while searching for an array binding', () => {
    const layout = makeLayout([
      subform(
        [
          subform([field('other', '$.Other[*]')], { name: 'NestedRepeat', occur: { max: -1 } }),
          field('cell', '$.cells[*]'),
        ],
        { name: 'Rows', occur: { max: -1 } }
      ),
    ]);
    const data: DataObject = { cells: ['a', 'b'], Other: ['z'] };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.children).toHaveLength(2);
    const secondChild = result.data.children[0];
    if (secondChild.type !== 'subform') throw new Error('expected subform');
    const cell = secondChild.children[1];
    if (cell.type !== 'field') throw new Error('expected field');
    expect(cell.resolvedValue).toBe('a');
  });

  it('uses a bound object as the child scope of a non-repeating subform', () => {
    const layout = makeLayout([
      subform([field('OEM', '$.OEM')], {
        name: 'Quotation',
        bindMatch: 'dataRef',
        bindRef: '$.Quotation',
      }),
    ]);
    const data: DataObject = { Quotation: { OEM: 'Bound' } };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const node = result.data.children[0];
    if (node.type !== 'subform') throw new Error('expected subform');
    const child = node.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('Bound');
  });

  it('keeps the parent scope when a bound value is an array', () => {
    const layout = makeLayout([
      subform([field('Name', '$.Name')], {
        name: 'Group',
        bindMatch: 'dataRef',
        bindRef: '$.Items',
      }),
    ]);
    const data: DataObject = { Items: [1], Name: 'FromRoot' };

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const node = result.data.children[0];
    if (node.type !== 'subform') throw new Error('expected subform');
    const child = node.children[0];
    if (child.type !== 'field') throw new Error('expected field');
    expect(child.resolvedValue).toBe('FromRoot');
  });

  it('returns a failure result when data resolution throws', () => {
    const data: DataObject = {};
    Object.defineProperty(data, 'Boom', {
      get: () => {
        throw new Error('getter exploded');
      },
    });
    const layout = makeLayout([field('f', '$.Boom')]);

    const result = expandRepeats(layout, data);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ERROR_CODES.BINDING_FAILED.code);
    expect(result.error.message).toContain('Expand repeats failed');
  });
});
