import {
  STYLE_ATTRS,
  buildNodeMap,
  collectScripts,
  createFieldAccessor,
  isStyleAttr,
  parseStyleColor,
  readLayoutColors,
  resolveRecordValue,
  scriptableToXfaNode,
  styleColorToString,
  writeLayoutColor,
  type ScriptEntry,
} from '../../../../src/domain/scripting/xfa-object-model';
import type { FieldAccessor } from '../../../../src/domain/scripting/formcalc';
import type { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import type { RgbColor } from '../../../../src/types';

function node(extra: Partial<ScriptableNode> = {}): ScriptableNode {
  return { type: 'field', name: 'f', key: 'f', path: 'f', ...extra };
}

type FullAccessor = FieldAccessor & {
  setCurrentKey(key: string | null): void;
  getCurrentKey(): string | null;
  hasField(path: string): boolean;
};

function accessor(nodes: ScriptableNode[], data: Record<string, unknown> = {}): FullAccessor {
  return createFieldAccessor(buildNodeMap(nodes), data) as FullAccessor;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe('style helpers', () => {
  it('identifies the supported style attributes', () => {
    expect(STYLE_ATTRS).toEqual(['fillColor', 'fontColor', 'borderColor', 'bgColor']);
    expect(STYLE_ATTRS.every(isStyleAttr)).toBe(true);
    expect(isStyleAttr('fillColor')).toBe(true);
    expect(isStyleAttr('presence')).toBe(false);
  });

  it('parses hex and comma-separated colors with clamping and rounding', () => {
    expect(parseStyleColor(null)).toBeUndefined();
    expect(parseStyleColor(undefined)).toBeUndefined();
    expect(parseStyleColor('#0a14FF')).toEqual({ r: 10, g: 20, b: 255 });
    expect(parseStyleColor('#GGGGGG')).toBeUndefined();
    expect(parseStyleColor('#FFF')).toBeUndefined();
    expect(parseStyleColor(' 12.6, 300, -5 ')).toEqual({ r: 13, g: 255, b: 0 });
    expect(parseStyleColor('1,2')).toBeUndefined();
    expect(parseStyleColor('a,2,3')).toBeUndefined();
  });

  it('renders colors as strings', () => {
    expect(styleColorToString(undefined)).toBeUndefined();
    expect(styleColorToString({ r: 1, g: 2, b: 3 })).toBe('1,2,3');
  });

  it('reads colors from a layout node', () => {
    expect(readLayoutColors(undefined)).toEqual({});
    const layout = {
      font: { color: { r: 1, g: 2, b: 3 } },
      border: {
        fill: { color: { r: 4, g: 5, b: 6 } },
        edges: [{}, { color: { r: 7, g: 8, b: 9 } }],
      },
    };
    expect(readLayoutColors(layout)).toEqual({
      fillColor: '4,5,6',
      fontColor: '1,2,3',
      borderColor: '7,8,9',
    });
    expect(readLayoutColors({ border: { edges: [{}] } })).toEqual({});
  });

  it('writes font and fill colors, clearing hidden fill presence', () => {
    const layout: Record<string, unknown> = {
      border: { fill: { presence: 'invisible' } },
    };
    writeLayoutColor(layout, 'fontColor', '#010203');
    writeLayoutColor(layout, 'fillColor', '4,5,6');
    writeLayoutColor(layout, 'bgColor', '7,8,9');
    expect((layout.font as { color: RgbColor }).color).toEqual({ r: 1, g: 2, b: 3 });
    expect(asRecord(asRecord(layout.border).fill).color).toEqual({ r: 7, g: 8, b: 9 });
    expect('presence' in asRecord(asRecord(layout.border).fill)).toBe(false);
  });

  it('writes border colors to every edge or creates an edge', () => {
    const withEdges: Record<string, unknown> = {
      border: {
        edges: [{ presence: 'hidden' }, null, { color: { r: 0, g: 0, b: 0 } }],
      },
    };
    writeLayoutColor(withEdges, 'borderColor', '1,2,3');
    const edges = asRecord(asRecord(withEdges.border).edges) as unknown as Record<
      string,
      unknown
    >[];
    expect(edges[0].color).toEqual({ r: 1, g: 2, b: 3 });
    expect('presence' in edges[0]).toBe(false);
    expect(edges[2].color).toEqual({ r: 1, g: 2, b: 3 });

    const withoutEdges: Record<string, unknown> = {};
    writeLayoutColor(withoutEdges, 'borderColor', '#040506');
    expect(asRecord(withoutEdges.border).edges).toEqual([{ color: { r: 4, g: 5, b: 6 } }]);
  });

  it('ignores invalid colors and non-object layouts', () => {
    const layout: Record<string, unknown> = {};
    writeLayoutColor(layout, 'fontColor', 'not-a-color');
    expect(layout).toEqual({});
    const primitive = 'not-an-object';
    expect(() => writeLayoutColor(primitive, 'fillColor', '1,2,3')).not.toThrow();
  });
});

describe('node maps and script collection', () => {
  it('builds a path map including unnamed and nested nodes', () => {
    const child = node({ name: 'child', children: [node({ name: 'leaf' })] });
    const map = buildNodeMap([child, node({ name: undefined, path: undefined })]);
    expect([...map.keys()]).toEqual(['child', 'child.leaf', '<unnamed>']);
    expect(map.get('child.leaf')).toBe(child.children?.[0]);
    expect(buildNodeMap([]).size).toBe(0);
  });

  it('collects events, calculations and nested scripts with detected languages', () => {
    const calculate = node({
      name: 'calc',
      calculate: {
        script: {
          content: '1 + 1',
          contentType: 'formcalc',
          runAt: 'docOpen',
        },
      },
    });
    const nested = node({
      name: 'parent',
      children: [
        node({
          name: 'evented',
          events: [
            { activity: 'click', script: 'a = 1', ref: '$', runAt: 'click' },
            { name: 'change', script: 'b = 2', contentType: 'application/x-javascript' },
            { name: 'skip' },
            { name: 'ecma', script: 'c = 3', contentType: 'text/ecmascript' },
          ],
        }),
        calculate,
      ],
    });
    const entries: ScriptEntry[] = collectScripts([nested]);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toEqual({
      elementPath: 'parent.evented',
      element: nested.children![0],
      eventName: 'unknown',
      scriptContent: 'a = 1',
      language: 'formcalc',
      runAt: 'click',
      ref: '$',
    });
    expect(entries[1].language).toBe('javascript');
    expect(entries[2].language).toBe('javascript');
    expect(entries[3]).toEqual({
      elementPath: 'parent.calc',
      element: calculate,
      eventName: 'calculate',
      scriptContent: '1 + 1',
      language: 'formcalc',
      runAt: 'docOpen',
    });
  });
});

describe('record path resolution', () => {
  const data = {
    form: { value: { nested: { field: 'deep' } } },
    rows: [{ value: { flag: 'first' } }, { value: { flag: 'second' } }],
    plain: 'top',
  };

  it('strips record prefixes and resolves plain paths', () => {
    expect(resolveRecordValue('plain', data)).toBe('top');
    expect(resolveRecordValue('record.plain', data)).toBe('top');
    expect(resolveRecordValue('$record.plain', data)).toBe('top');
    expect(resolveRecordValue('xfa.record.plain', data)).toBe('top');
    expect(resolveRecordValue('xfa.form.record.plain', data)).toBe('top');
    expect(resolveRecordValue('xfa.datasets.plain', data)).toBe('top');
    expect(resolveRecordValue('xfa.datasets.data.plain', data)).toBe('top');
    expect(resolveRecordValue('xfa.record', data)).toBe(data);
    expect(resolveRecordValue('record.', data)).toBe(data);
    expect(resolveRecordValue('xfa', data)).toBe(data);
    expect(resolveRecordValue('missing.path', data)).toBeUndefined();
  });

  it('resolves value suffixes, wildcards and indices', () => {
    expect(resolveRecordValue('form.value', data)).toBe('');
    expect(resolveRecordValue('form.nested.field', data)).toBeUndefined();
    expect(resolveRecordValue('form', data)).toEqual({ value: { nested: { field: 'deep' } } });
    expect(resolveRecordValue('rows[*].flag', data)).toBeUndefined();
    expect(resolveRecordValue('rows[*].value', data)).toBe('');
    expect(resolveRecordValue('rows.value.flag', data)).toBe('first');
    expect(resolveRecordValue('rows[1].value', data)).toBe('');
    expect(resolveRecordValue('rows[9].value', data)).toBeUndefined();
    expect(resolveRecordValue('plain[0]', data)).toBeUndefined();
  });

  it('returns a scalar representation when a value path points at an object', () => {
    const source = { list: ['a', 2, { x: 1 }], obj: { a: 1 } };
    expect(resolveRecordValue('list.value', source)).toBe('a2');
    expect(resolveRecordValue('obj.value', source)).toBe('');
    expect(resolveRecordValue('plain.value', { plain: 'text' })).toBe('text');
    expect(resolveRecordValue('value', {})).toEqual({});
  });
});

describe('scriptableToXfaNode', () => {
  it('maps fields, geometry, children and defaults', () => {
    const value = node({
      name: 'amount',
      resolvedValue: 12,
      position: { x: 1, y: 2, w: 3, h: 4, rotate: 5 },
      children: [node({ name: 'nested', resolvedValue: 'yes' })],
    });
    const converted = scriptableToXfaNode(value, 'form.amount');
    expect(converted).toMatchObject({
      name: 'amount',
      type: 'field',
      value: 12,
      rawValue: '12',
      presence: 'visible',
      access: 'open',
      mandatory: 'optional',
      relevant: '',
      boundNode: null,
      parent: null,
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      repeating: false,
      index: 1,
    });
    expect(converted.children).toHaveLength(1);
    expect(converted.children[0].name).toBe('nested');

    const unnamed = scriptableToXfaNode(node({ name: undefined }), 'a.b');
    expect(unnamed.name).toBe('b');
  });
});

describe('createFieldAccessor — reads', () => {
  it('reads values from resolvedValue, node paths and raw data', () => {
    const api = accessor(
      [
        node({ name: 'value', path: 'value', resolvedValue: 7, formatPicture: '0000' }),
        node({ name: 'fromData', path: 'data.payload' }),
      ],
      { data: { payload: 'from-data' }, top: 'top-value' }
    );
    expect(api.getField('value', '$')).toBe(7);
    expect(api.getField('fromData', '$')).toBe('from-data');
    expect(api.getField('top', '$')).toBe('top-value');
    api.setCurrentKey('value');
    expect(api.getField('$.value', '$')).toBe(7);
    expect(api.getField('$$value', '$')).toBe(7);
    expect(api.getField('value.rawValue', '$')).toBe('7');
    expect(api.getField('value.formattedValue', '$')).toBe('0007');
    expect(api.getField('$.rawValue', '$')).toBe('7');
    expect(api.getField('missing.rawValue', '$')).toBeNull();
    expect(api.getField('missing.formattedValue', '$')).toBe('');
    expect(api.getField('top.rawValue', '$')).toBe('top-value');
    expect(api.getField('top.formattedValue', '$')).toBe('top-value');
  });

  it('reads formatted values from a node picture', () => {
    const api = accessor([
      node({ name: 'value', path: 'value', resolvedValue: 12, formatPicture: '0000' }),
    ]);
    expect(api.getField('value.formattedValue', '$')).toBe('0012');
  });

  it('handles self-relative paths with and without a current node', () => {
    const api = accessor([
      node({
        name: 'self',
        path: 'self',
        key: 'self',
        resolvedValue: 5,
        presence: 'hidden',
        access: 'protected',
        uid: 'id-1',
        position: { x: 2, rotate: 3 },
        layoutNode: { assist: { toolTip: 'tip' }, extras: { key: 'extra' } },
        children: [node({ name: 'child', path: 'self.child', resolvedValue: 'child-value' })],
      }),
    ]);
    expect(api.getCurrentKey()).toBeNull();
    expect(api.getField('$', '$')).toBeNull();
    expect(api.getField('.rawValue', '$')).toBeNull();
    api.setCurrentKey('self');
    expect(api.getCurrentKey()).toBe('self');
    expect(api.getField('', '$')).toBe(5);
    expect(api.getField('$', '$')).toBe(5);
    expect(api.getField('.rawValue', '$')).toBe('5');
    expect(api.getField('.formattedValue', '$')).toBe('5');
    expect(api.getField('.presence', '$')).toBe('hidden');
    expect(api.getField('.access', '$')).toBe('protected');
    expect(api.getField('.name', '$')).toBe('self');
    expect(api.getField('.id', '$')).toBe('id-1');
    expect(api.getField('.x', '$')).toBe(2);
    expect(api.getField('.rotate', '$')).toBe(3);
    expect(api.getField('.y', '$')).toBeNull();
    expect(api.getField('.child', '$')).toBe('child-value');
    expect(api.getField('.assist', '$')).toEqual({ toolTip: 'tip' });
    expect(api.getField('.assist.toolTip', '$')).toBe('tip');
    expect(api.getField('.extras.key', '$')).toBe('extra');
    expect(api.getField('.missing', '$')).toBeUndefined();
    expect(api.getField('.child.deep', '$')).toBeUndefined();
    expect(api.getField('.deep.path', '$')).toBeUndefined();
  });

  it('reads compound attributes from the current node and ancestors by path', () => {
    const layout = { assist: { toolTip: 'owner-tip' } };
    const api = accessor([
      node({ name: 'owner', path: 'owner', layoutNode: layout }),
      node({ name: 'child', path: 'owner.child', parent: node({ path: 'owner', name: 'owner' }) }),
    ]);
    api.setCurrentKey('owner.child');
    expect(api.getField('owner.assist.toolTip', '$')).toBe('owner-tip');
    expect(api.getField('owner.extras.none', '$')).toBeUndefined();
    expect(api.getField('other.thing', '$')).toBeUndefined();
  });

  it('reads attributes with a trailing attribute segment', () => {
    const api = accessor([
      node({
        name: 'owner',
        path: 'owner',
        presence: 'hidden',
        access: 'open',
        uid: 'u',
        resolvedValue: 3,
        position: { w: 8 },
        layoutNode: { font: { color: { r: 1, g: 2, b: 3 } } },
      }),
    ]);
    expect(api.getField('owner.presence', '$')).toBe('hidden');
    expect(api.getField('owner.access', '$')).toBe('open');
    expect(api.getField('owner.name', '$')).toBe('owner');
    expect(api.getField('owner.w', '$')).toBe(8);
    expect(api.getField('owner.h', '$')).toBeNull();
    expect(api.getField('owner.value', '$')).toBeUndefined();
    api.setCurrentKey('owner');
    expect(api.getField('.fontColor', '$')).toBe('1,2,3');
    expect(api.getField('.fillColor', '$')).toBeNull();
    expect(api.getField('unknown.presence', '$')).toBeUndefined();
  });

  it('resolves scoped references through parents and the node map', () => {
    const root = node({ name: 'root', path: 'root', key: 'root' });
    const middle = node({
      name: 'middle',
      path: 'root.middle',
      parent: root,
      children: [node({ name: 'leaf', path: 'root.middle.leaf', resolvedValue: 'found' })],
    });
    root.children = [middle];
    const api = accessor([root, middle]);
    api.setCurrentKey('root.middle');
    expect(api.getField('leaf', '$')).toBe('found');
    expect(api.getField('middle.leaf', '$')).toBe('found');
    expect(api.getField('missing', '$')).toBeUndefined();
    api.setCurrentKey(null);
    expect(api.getField('root.middle.leaf', '$')).toBe('found');
  });

  it('converts the current node to an XFA node', () => {
    const api = accessor([node({ name: 'self', path: 'self', resolvedValue: 'v' })]);
    expect(api.getCurrentNode()).toBeNull();
    api.setCurrentKey('self');
    expect(api.getCurrentNode()).toMatchObject({ name: 'self', value: 'v', rawValue: 'v' });
    expect(api.getFormData()).toEqual({});
  });

  it('reports field existence', () => {
    const api = accessor([node({ name: 'self', path: 'self' })]);
    expect(api.hasField('self')).toBe(true);
    expect(api.hasField('nope')).toBe(false);
    expect(api.hasField('.')).toBe(false);
    api.setCurrentKey('self');
    expect(api.hasField('.')).toBe(true);
  });
});

describe('createFieldAccessor — writes', () => {
  it('writes self values, properties and compound attributes', () => {
    const layout: Record<string, unknown> = {
      assist: { existing: 'yes' },
      extras: {},
    };
    const child = node({ name: 'child', path: 'self.child', layoutNode: {} });
    const self = node({
      name: 'self',
      path: 'self',
      key: 'self',
      layoutNode: layout,
      children: [child],
    });
    const api = accessor([self]);
    api.setCurrentKey('self');

    api.setField('$', '$', 'value');
    expect(self.resolvedValue).toBe('value');
    expect(layout.resolvedValue).toBe('value');
    api.setField('.rawValue', '$', 'raw');
    expect(self.resolvedValue).toBe('raw');
    api.setField('.child', '$', 'child-value');
    expect(child.resolvedValue).toBe('child-value');
    api.setField('.presence', '$', 'hidden');
    expect(self.presence).toBe('hidden');
    api.setField('.assist.toolTip', '$', 'tip');
    expect(asRecord(layout.assist)).toEqual({ existing: 'yes', toolTip: 'tip' });
    api.setField('.extras.created', '$', 'new');
    expect(asRecord(layout.extras)).toEqual({ created: 'new' });
    api.setField('.child.deep', '$', 'ignored');
    api.setField('.', '$', 'dotted');
    expect(self.resolvedValue).toBe('raw');
  });

  it('writes attributes, styles and geometry onto nodes', () => {
    const layout: Record<string, unknown> = { position: { x: 1 } };
    const self = node({ name: 'self', path: 'self', layoutNode: layout });
    const api = accessor([self]);
    api.setCurrentKey('self');

    api.setField('.presence', '$', 'hidden');
    api.setField('.access', '$', 'protected');
    api.setField('.name', '$', 'renamed');
    api.setField('.x', '$', '12');
    api.setField('.fillColor', '$', '#010203');
    api.setField('.borderColor', '$', '4,5,6');
    expect(self).toMatchObject({
      presence: 'hidden',
      access: 'protected',
      name: 'renamed',
      fillColor: '#010203',
      borderColor: '4,5,6',
    });
    expect(asRecord(layout.position)).toEqual({ x: 12 });
    expect(asRecord(asRecord(layout.border).fill).color).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('writes geometry through node position when the layout has none', () => {
    const self = node({ name: 'self', path: 'self', position: { y: 2 } });
    const api = accessor([self]);
    api.setCurrentKey('self');
    api.setField('.w', '$', 'not-a-number');
    expect(self.position).toEqual({ y: 2, w: 0 });
  });

  it('writes arbitrary paths to nodes and to the backing data', () => {
    const target = node({ name: 'target', path: 'target' });
    const data: Record<string, unknown> = { nested: { value: 'old' } };
    const api = accessor([target], data);
    api.setField('target', '$', 'written');
    expect(target.resolvedValue).toBe('written');
    api.setField('target.presence', '$', 'hidden');
    expect(target.presence).toBe('hidden');
    api.setField('nested.value', '$', 'new');
    expect(data.nested).toBe('new');
    api.setField('record.nested.value', '$', 'record-new');
    expect(data.nested).toBe('record-new');
    api.setField('target.rawValue', '$', 'raw');
    expect(target.resolvedValue).toBe('raw');
    api.setField('nested.formattedValue', '$', 'formatted');
    expect(data.nested).toBe('formatted');
  });

  it('creates intermediate arrays and objects when writing indexed data paths', () => {
    const data: Record<string, unknown> = {};
    const api = accessor([], data);
    api.setField('record.rows[0].flag', '$', 'first');
    api.setField('record.rows[1].flag', '$', 'second');
    api.setField('record.rows[1].count', '$', 2);
    expect(data).toEqual({
      rows: [{ flag: 'first' }, { flag: 'second', count: 2 }],
    });
    api.setField('record.list[2]', '$', 'third');
    expect(data.list).toEqual([undefined, undefined, 'third']);
    api.setField('', '$', 'ignored');
    api.setField('value', '$', 'top');
    expect(data.value).toBeUndefined();
  });

  it('does nothing when self-relative writes have no current node', () => {
    const api = accessor([node({ name: 'self', path: 'self' })]);
    expect(() => api.setField('.rawValue', '$', 'x')).not.toThrow();
    expect(() => api.setField('$', '$', 'x')).not.toThrow();
  });
});
