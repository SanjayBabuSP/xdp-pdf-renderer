import {
  XFA_NODE_KEY,
  createXfaFormProxy,
  isGeometryAttr,
  setActiveProxyHooks,
  setGeometryAttr,
  type ProxyHooks,
} from '../../../../src/domain/scripting/js-engine/xfa-form-proxy';
import type { ScriptableNode } from '../../../../src/domain/scripting/script-types';

type ScalarProxy = Record<PropertyKey, unknown>;

interface NullProxy extends Record<string, unknown> {
  isNull(): boolean;
  isHidden(): boolean;
  isVisible(): boolean;
  resolveNode(expr: string): unknown;
  resolveNodes(expr: string): unknown[];
  getAttribute(name: string): unknown;
  setValue(value: unknown): void;
  setRawValue(value: string): void;
  setAttribute(name: string, value: unknown): void;
  nested: unknown;
}

interface InstanceManagerProxy {
  count: number;
  addInstance(): unknown;
  removeInstance(index: number): void;
  setInstances(count: number): void;
  moveInstance(from: number, to: number): void;
}

function read(proxy: Record<string, unknown>, key: string | symbol): unknown {
  return (proxy as ScalarProxy)[key];
}

function call<T>(proxy: Record<string, unknown>, key: string, ...args: unknown[]): T {
  const fn = read(proxy, key);
  expect(typeof fn).toBe('function');
  return (fn as (...params: unknown[]) => T)(...args);
}

function makeNode(extra: Partial<ScriptableNode> = {}): ScriptableNode {
  return { type: 'field', name: 'field', ...extra };
}

function makeMap(): Map<string, ScriptableNode> {
  return new Map<string, ScriptableNode>([
    ['form', makeNode({ type: 'subform', name: 'form', resolvedValue: 'root' })],
    ['form.child', makeNode({ name: 'child', resolvedValue: 42 })],
    ['form.hidden', makeNode({ name: 'hidden', presence: 'hidden' })],
    ['form.invisible', makeNode({ name: 'invisible', presence: 'invisible' })],
    ['form.rows', makeNode({ name: 'rows', type: 'subform' })],
    ['form.rows.item', makeNode({ name: 'item', resolvedValue: 'zero' })],
    ['form.plain', makeNode({ name: 'plain' })],
  ]);
}

afterEach(() => {
  setActiveProxyHooks(undefined);
});

describe('createXfaFormProxy — scalar properties', () => {
  it('exposes symbols and value properties of an existing node', () => {
    const proxy = createXfaFormProxy(makeMap(), 'form.child', []);
    expect(read(proxy, XFA_NODE_KEY)).toBe('form.child');
    expect((read(proxy, Symbol.toPrimitive) as () => unknown)()).toBe(42);
    expect(read(proxy, Symbol.toStringTag)).toBe('XfaFormNode');
    expect(read(proxy, Symbol.iterator)).toBeUndefined();
    expect(read(proxy, 'rawValue')).toBe('42');
    expect(read(proxy, 'value')).toBe(42);
    expect(read(proxy, 'presence')).toBe('visible');
    expect(read(proxy, 'access')).toBe('open');
    expect(read(proxy, 'name')).toBe('child');
    expect(read(proxy, 'className')).toBe('field');
    expect(read(proxy, 'type')).toBe('field');
    expect(read(proxy, 'somExpression')).toBe('form.child');
    expect(read(proxy, 'index')).toBe(0);
  });

  it('exposes geometry and color attributes from the node and layout', () => {
    const node = makeNode({
      position: { x: 1, y: 2, w: 3, h: 4, rotate: 5 },
      fontColor: 'cached-font',
      layoutNode: {
        border: {
          fill: { color: { r: 10, g: 20, b: 30 } },
          edges: [{ color: { r: 40, g: 50, b: 60 } }],
        },
      },
    });
    const proxy = createXfaFormProxy(new Map([['n', node]]), 'n', []);
    expect(read(proxy, 'x')).toBe(1);
    expect(read(proxy, 'y')).toBe(2);
    expect(read(proxy, 'w')).toBe(3);
    expect(read(proxy, 'h')).toBe(4);
    expect(read(proxy, 'rotate')).toBe(5);
    expect(read(proxy, 'fontColor')).toBe('cached-font');
    expect(read(proxy, 'fillColor')).toBe('10,20,30');
    expect(read(proxy, 'bgColor')).toBe('10,20,30');
    expect(read(proxy, 'borderColor')).toBe('40,50,60');
  });

  it('exposes colors derived from the layout font when not cached', () => {
    const node = makeNode({
      layoutNode: { font: { color: { r: 1, g: 2, b: 3 } } },
    });
    const proxy = createXfaFormProxy(new Map([['n', node]]), 'n', []);
    expect(read(proxy, 'fontColor')).toBe('1,2,3');
    expect(read(proxy, 'borderColor')).toBeNull();
  });

  it('falls back to defaults when the node is missing or attributes are unset', () => {
    const proxy = createXfaFormProxy(new Map(), 'parent.orphan', []);
    expect((read(proxy, Symbol.toPrimitive) as () => string)()).toBe('');
    expect(read(proxy, 'rawValue')).toBeNull();
    expect(read(proxy, 'value')).toBeNull();
    expect(read(proxy, 'presence')).toBe('visible');
    expect(read(proxy, 'access')).toBe('open');
    expect(read(proxy, 'name')).toBe('orphan');
    expect(read(proxy, 'className')).toBe('unknown');
    expect(read(proxy, 'type')).toBe('unknown');
    expect(read(proxy, 'x')).toBeNull();
    expect(read(proxy, 'fillColor')).toBeNull();
  });

  it('resolves the parent proxy from arguments, node map or null', () => {
    const map = makeMap();
    const explicit = { explicit: true };
    expect(read(createXfaFormProxy(map, 'form.child', [], explicit), 'parent')).toBe(explicit);

    const implicit = createXfaFormProxy(map, 'form.child', []);
    expect(read(read(implicit, 'parent') as Record<string, unknown>, XFA_NODE_KEY)).toBe('form');
    expect(read(createXfaFormProxy(map, 'form', []), 'parent')).toBeNull();
  });
});

describe('createXfaFormProxy — methods', () => {
  it('reads and writes values and reports visibility', () => {
    const map = makeMap();
    const modified: string[] = [];
    const child = map.get('form.child')!;
    const proxy = createXfaFormProxy(map, 'form.child', modified);

    expect(call<unknown>(proxy, 'getValue')).toBe(42);
    expect(call<string | null>(proxy, 'getRawValue')).toBe('42');
    expect(call<boolean>(proxy, 'isNull')).toBe(false);
    expect(call<boolean>(proxy, 'isHidden')).toBe(false);
    expect(call<boolean>(proxy, 'isVisible')).toBe(true);
    expect(child.presence).toBeUndefined();

    call<void>(proxy, 'setValue', 7);
    expect(child.resolvedValue).toBe(7);
    call<void>(proxy, 'setRawValue', '8');
    expect(child.resolvedValue).toBe('8');
    expect(modified).toEqual(['form.child', 'form.child']);
  });

  it('reports hidden and invisible nodes and updates attributes', () => {
    const map = makeMap();
    const modified: string[] = [];
    const hidden = createXfaFormProxy(map, 'form.hidden', modified);
    const invisible = createXfaFormProxy(map, 'form.invisible', modified);
    expect(call<boolean>(hidden, 'isHidden')).toBe(true);
    expect(call<boolean>(hidden, 'isVisible')).toBe(false);
    expect(call<boolean>(invisible, 'isHidden')).toBe(true);

    expect(call<unknown>(hidden, 'getAttribute', 'name')).toBe('hidden');
    expect(call<unknown>(hidden, 'getAttribute', 'type')).toBe('field');
    expect(call<unknown>(hidden, 'getAttribute', 'presence')).toBe('hidden');
    expect(call<unknown>(hidden, 'getAttribute', 'access')).toBeUndefined();
    expect(call<unknown>(hidden, 'getAttribute', 'rawValue')).toBeNull();
    expect(call<unknown>(hidden, 'getAttribute', 'value')).toBeUndefined();
    expect(call<unknown>(hidden, 'getAttribute', 'x')).toBeNull();
    expect(call<unknown>(hidden, 'getAttribute', 'custom')).toBeNull();

    call<void>(hidden, 'setAttribute', 'presence', 'visible');
    call<void>(hidden, 'setAttribute', 'access', 'protected');
    call<void>(hidden, 'setAttribute', 'rawValue', 9);
    call<void>(hidden, 'setAttribute', 'value', 10);
    call<void>(hidden, 'setAttribute', 'x', 3);
    call<void>(hidden, 'setAttribute', 'fillColor', '1,2,3');
    call<void>(hidden, 'setAttribute', 'bgColor', '4,5,6');
    call<void>(hidden, 'setAttribute', 'borderColor', '7,8,9');
    call<void>(hidden, 'setAttribute', 'custom', 'v');
    expect(map.get('form.hidden')).toMatchObject({
      presence: 'visible',
      access: 'protected',
      resolvedValue: 10,
      fillColor: '4,5,6',
      borderColor: '7,8,9',
    });
    expect(modified).toHaveLength(9);
  });

  it('compares against nodes and primitive values', () => {
    const proxy = createXfaFormProxy(makeMap(), 'form.child', []);
    expect(call<boolean>(proxy, 'equals', { rawValue: 42 })).toBe(true);
    expect(call<boolean>(proxy, 'equals', { rawValue: '42' })).toBe(false);
    expect(call<boolean>(proxy, 'equals', 42)).toBe(true);
    expect(call<boolean>(proxy, 'equals', 43)).toBe(false);
  });

  it('returns safe values for methods on a missing node', () => {
    const proxy = createXfaFormProxy(new Map(), 'missing', []);
    expect(call<unknown>(proxy, 'getValue')).toBeNull();
    expect(call<string | null>(proxy, 'getRawValue')).toBeNull();
    expect(call<boolean>(proxy, 'isNull')).toBe(true);
    expect(call<boolean>(proxy, 'isHidden')).toBe(false);
    expect(call<boolean>(proxy, 'isVisible')).toBe(true);
    call<void>(proxy, 'setValue', 1);
    call<void>(proxy, 'setRawValue', '1');
    call<void>(proxy, 'setAttribute', 'presence', 'hidden');
  });
});

describe('createXfaFormProxy — SOM resolution', () => {
  it('resolves relative, scoped and absolute expressions', () => {
    const map = makeMap();
    map.set('other', makeNode({ name: 'other', resolvedValue: 'scoped' }));
    map.set('form.child.plain', makeNode({ name: 'plain' }));
    map.set('form.scoped', makeNode({ name: 'scoped' }));
    const proxy = createXfaFormProxy(map, 'form.child', []);

    const check = (expr: string, expected: string | null): void => {
      const result = call<Record<string, unknown> | null>(proxy, 'resolveNode', expr);
      expect(result === null ? null : read(result, XFA_NODE_KEY)).toBe(expected);
    };
    check('$.plain', 'form.child.plain');
    check('this.plain', 'form.child.plain');
    check('$$.plain', 'form.plain');
    check('xfa.form.form.plain', 'form.plain');
    check('$form.form.plain', 'form.plain');
    check('scoped', 'form.scoped');
    check('other', 'other');
    check('$.missing', null);
  });

  it('resolves wildcard expressions to every matching path', () => {
    const map = makeMap();
    map.set('other.rows.item', makeNode({ name: 'item' }));
    const proxy = createXfaFormProxy(map, 'form', []);
    const results = call<Record<string, unknown>[]>(proxy, 'resolveNodes', 'rows.item[*]');
    expect(results.map((result) => read(result, XFA_NODE_KEY))).toEqual([
      'form.rows.item',
      'other.rows.item',
    ]);
    const single = call<Record<string, unknown>[]>(proxy, 'resolveNodes', 'plain');
    expect(single.map((result) => read(result, XFA_NODE_KEY))).toEqual(['form.plain']);
  });
});

describe('createXfaFormProxy — children and instance manager', () => {
  it('exposes child counts, lists, indexed access and null-safe misses', () => {
    const map = makeMap();
    const proxy = createXfaFormProxy(map, 'form', []);
    expect(read(proxy, 'count')).toBe(5);
    expect(read(proxy, 'length')).toBe(5);

    const all = read(proxy, 'all') as Record<string, unknown>[];
    expect(all.map((child) => read(child, XFA_NODE_KEY))).toEqual([
      'form.child',
      'form.hidden',
      'form.invisible',
      'form.rows',
      'form.plain',
    ]);
    expect(read(read(all[0], 'parent') as Record<string, unknown>, XFA_NODE_KEY)).toBe('form');

    const nodes = read(proxy, 'nodes') as {
      length: number;
      item(index: number): Record<string, unknown> | null;
    };
    expect(nodes.length).toBe(5);
    expect(read(nodes.item(0) as Record<string, unknown>, XFA_NODE_KEY)).toBe('form.child');
    expect(nodes.item(9)).toBeNull();
    expect(read(read(proxy, '0') as Record<string, unknown>, XFA_NODE_KEY)).toBe('form.child');
    expect(read(proxy, '9')).toBeNull();
  });

  it('exposes direct children by name and a null-safe proxy for unknown names', () => {
    const proxy = createXfaFormProxy(makeMap(), 'form', []);
    expect(read(read(proxy, 'child') as Record<string, unknown>, XFA_NODE_KEY)).toBe('form.child');
    const missing = read(proxy, 'absent') as unknown as NullProxy;
    expect((read(missing as Record<string, unknown>, Symbol.toPrimitive) as () => unknown)()).toBe(
      ''
    );
    expect(read(missing as Record<string, unknown>, Symbol.toStringTag)).toBe('NullXfaNode');
    expect(missing['isNull']()).toBe(true);
    expect(missing['isHidden']()).toBe(true);
    expect(missing['isVisible']()).toBe(false);
    expect(missing['rawValue']).toBeNull();
    expect(missing['value']).toBeNull();
    expect(missing['presence']).toBe('hidden');
    expect(missing['children']).toEqual([]);
    expect(missing['all']).toEqual([]);
    expect(missing['count']).toBe(0);
    expect(missing['length']).toBe(0);
    expect(missing['resolveNode']('x')).toBeNull();
    expect(missing['resolveNodes']('x')).toEqual([]);
    expect(missing['getAttribute']('x')).toBeUndefined();
    expect(missing['setValue'](1)).toBeUndefined();
    expect(missing['setRawValue']('1')).toBeUndefined();
    expect(missing['setAttribute']('x', 1)).toBeUndefined();
    expect((read(missing.nested as Record<string, unknown>, 'isNull') as () => boolean)()).toBe(
      true
    );
    (missing as unknown as Record<PropertyKey, unknown>)[Symbol.iterator] = undefined;
    expect(read(missing as Record<string, unknown>, Symbol.iterator)).toBeUndefined();
  });

  it('exposes assist and extras bags from the layout node', () => {
    const map = new Map<string, ScriptableNode>([
      [
        'form',
        makeNode({
          layoutNode: {
            assist: { toolTip: 'tip' },
            extras: { custom: 'value' },
          },
        }),
      ],
    ]);
    const proxy = createXfaFormProxy(map, 'form', []);
    expect(read(proxy, 'assist')).toEqual({ toolTip: 'tip' });
    expect(read(proxy, 'extras')).toEqual({ custom: 'value' });

    const bare = createXfaFormProxy(new Map([['form', makeNode()]]), 'form', []);
    expect(read(read(bare, 'assist') as Record<string, unknown>, 'presence')).toBe('hidden');
    expect(read(bare, 'extras')).toEqual({});
    const withNode = createXfaFormProxy(
      new Map([
        ['form', makeNode()],
        ['form.extras', makeNode()],
      ]),
      'form',
      []
    );
    expect(read(read(withNode, 'extras') as Record<string, unknown>, XFA_NODE_KEY)).toBe(
      'form.extras'
    );
  });

  it('delegates instance manager operations to the active hooks', () => {
    const calls: string[] = [];
    const hooks: ProxyHooks = {
      addInstance: (parentPath) => {
        calls.push(`add:${parentPath}`);
        return 'form.new';
      },
      removeInstance: (parentPath, index) => {
        calls.push(`remove:${parentPath}:${index}`);
      },
      setInstances: (parentPath, count) => {
        calls.push(`set:${parentPath}:${count}`);
      },
      moveInstance: (parentPath, from, to) => {
        calls.push(`move:${parentPath}:${from}:${to}`);
      },
    };
    setActiveProxyHooks(hooks);
    const map = makeMap();
    map.set('form.new', makeNode({ name: 'new' }));
    const proxy = createXfaFormProxy(map, 'form', []);
    const manager = read(proxy, 'instanceManager') as unknown as InstanceManagerProxy;

    expect(manager.count).toBe(6);
    expect(read(manager.addInstance() as Record<string, unknown>, XFA_NODE_KEY)).toBe('form.new');
    manager.removeInstance(2);
    manager.setInstances(3);
    manager.moveInstance(0, 1);
    expect(calls).toEqual(['add:form', 'remove:form:2', 'set:form:3', 'move:form:0:1']);
  });

  it('returns null from addInstance when no hooks are active or no path is returned', () => {
    const proxy = createXfaFormProxy(makeMap(), 'form', []);
    const manager = read(proxy, 'instanceManager') as unknown as InstanceManagerProxy;
    expect(manager.addInstance()).toBeNull();
    expect(manager.removeInstance(0)).toBeUndefined();

    setActiveProxyHooks({
      addInstance: () => null,
      removeInstance: () => {},
      setInstances: () => {},
      moveInstance: () => {},
    });
    expect(manager.addInstance()).toBeNull();
  });
});

describe('createXfaFormProxy — set trap', () => {
  it('writes scalar properties and mirrors them into the layout', () => {
    const layout = { resolvedValue: 'old' };
    const node = makeNode({ layoutNode: layout, resolvedValue: 'old' });
    const map = new Map([['n', node]]);
    const modified: string[] = [];
    const proxy = createXfaFormProxy(map, 'n', modified);

    proxy['rawValue'] = 'raw';
    proxy['value'] = 'value';
    proxy['presence'] = 'hidden';
    proxy['access'] = 'protected';
    expect(node.resolvedValue).toBe('value');
    expect(node.presence).toBe('hidden');
    expect(node.access).toBe('protected');
    expect(layout).toEqual({
      resolvedValue: 'value',
      presence: 'hidden',
      access: 'protected',
    });
    expect(modified).toEqual(['n', 'n', 'n', 'n']);
  });

  it('writes geometry, styles and arbitrary attributes', () => {
    const layout = { border: {} };
    const node = makeNode({ layoutNode: layout, position: { x: 1 } });
    const modified: string[] = [];
    const proxy = createXfaFormProxy(new Map([['n', node]]), 'n', modified);

    proxy['x'] = '12';
    proxy['borderColor'] = '#010203';
    proxy['bgColor'] = '#040506';
    proxy['custom'] = 'data';
    expect(node.position).toEqual({ x: 12 });
    expect((node as unknown as Record<string, unknown>).borderColor).toBe('#010203');
    expect((layout as Record<string, unknown>).border).toEqual({
      fill: { color: { r: 4, g: 5, b: 6 } },
      edges: [{ color: { r: 1, g: 2, b: 3 } }],
    });
    expect(modified).toEqual(['n', 'n', 'n', 'n']);
  });

  it('ignores writes for symbol keys and missing nodes', () => {
    const map = new Map<string, ScriptableNode>();
    const modified: string[] = [];
    const proxy = createXfaFormProxy(map, 'missing', modified);
    (proxy as ScalarProxy)[Symbol.iterator] = 1;
    proxy['rawValue'] = 'x';
    proxy['x'] = 4;
    proxy['custom'] = 'y';
    expect(modified).toEqual([]);
    expect(map.size).toBe(0);
  });
});

describe('geometry helpers', () => {
  it('identifies geometry attributes', () => {
    expect(isGeometryAttr('x')).toBe(true);
    expect(isGeometryAttr('rotate')).toBe(true);
    expect(isGeometryAttr('fillColor')).toBe(false);
  });

  it('writes numeric geometry into the layout position when present', () => {
    const node = makeNode({ layoutNode: { position: { x: 1 } }, position: { x: 2 } });
    setGeometryAttr(node, 'y', '7');
    expect((node.layoutNode as { position: { x: number; y: number } }).position).toEqual({
      x: 1,
      y: 7,
    });
    expect(node.position).toEqual({ x: 2, y: 7 });
  });

  it('writes geometry into node position when the layout has none', () => {
    const node = makeNode({ position: { x: 1 } });
    setGeometryAttr(node, 'w', 'bad');
    expect(node.position).toEqual({ x: 1, w: 0 });
  });

  it('creates a node position from a layout position when needed', () => {
    const node = makeNode({ layoutNode: { position: { y: 9 } } });
    setGeometryAttr(node, 'h', 3);
    expect(node.position).toEqual({ y: 9, h: 3 });
  });

  it('ignores unknown attributes and undefined nodes', () => {
    expect(() => setGeometryAttr(undefined, 'x', 1)).not.toThrow();
    const node = makeNode();
    setGeometryAttr(node, 'unknown', 1);
    expect(node.position).toBeUndefined();
  });
});
