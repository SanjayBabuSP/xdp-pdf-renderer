import {
  createNullRecordNode,
  createRecordNode,
  createRecordProxy,
} from '../../../../src/domain/scripting/js-engine/xfa-record-proxy';

type RecordNode = Record<string, unknown>;
type Fn = (...args: unknown[]) => unknown;

const nodeList = (value: unknown): RecordNode[] => value as RecordNode[];

describe('createNullRecordNode', () => {
  const n = createNullRecordNode();

  it('exposes empty scalar value properties', () => {
    expect(n.value).toBe('');
    expect(n.rawValue).toBe('');
    expect(n.defaultValue).toBe('');
  });

  it('is visible by default', () => {
    expect(n.presence).toBe('visible');
    expect((n.isVisible as Fn)()).toBe(true);
    expect((n.isHidden as Fn)()).toBe(false);
  });

  it('reports itself as null', () => {
    expect((n.isNull as Fn)()).toBe(true);
  });

  it('exposes empty collections and zero counts', () => {
    expect(nodeList(n.children)).toEqual([]);
    expect(nodeList(n.all)).toEqual([]);
    expect(n.length).toBe(0);
    expect(n.count).toBe(0);
  });

  it('returns another null node from resolveNode and an empty list from resolveNodes', () => {
    const resolved = (n.resolveNode as (expr: string) => RecordNode)('$.anything');
    expect(resolved.value).toBe('');
    expect((resolved.isNull as Fn)()).toBe(true);
    expect(nodeList((n.resolveNodes as Fn)('$.anything'))).toEqual([]);
  });

  it('ignores writes and accepts setters', () => {
    expect((n.setValue as Fn)('changed')).toBeUndefined();
    expect((n.setRawValue as Fn)('changed')).toBeUndefined();
    expect((n.getAttribute as Fn)('name')).toBeUndefined();
    n.arbitrary = 5;
    expect(n.value).toBe('');
  });

  it('produces an empty string via coercion', () => {
    expect(String(n)).toBe('');
  });

  it('reports its toStringTag', () => {
    expect(Object.prototype.toString.call(n)).toBe('[object NullXfaRecordNode]');
  });

  it('returns a null node for any unknown property chain', () => {
    const child = n.missing as RecordNode;
    expect(child.value).toBe('');
    expect((child.isNull as Fn)()).toBe(true);
  });
});

describe('createRecordNode', () => {
  it('stringifies scalar values for value properties', () => {
    expect(createRecordNode('hello').rawValue).toBe('hello');
    expect(createRecordNode(42).value).toBe('42');
    expect(createRecordNode(true).defaultValue).toBe('true');
    expect(createRecordNode(undefined).rawValue).toBe('');
    expect(createRecordNode(null).rawValue).toBe('');
  });

  it('concatenates array elements into scalar text', () => {
    const n = createRecordNode([1, 'a', true]);
    expect(n.rawValue).toBe('1atrue');
  });

  it('reports array length and count', () => {
    const n = createRecordNode(['x', 'y']);
    expect(n.length).toBe(2);
    expect(n.count).toBe(2);
  });

  it('reports zero length and count for non-arrays', () => {
    const n = createRecordNode({ a: 'x' });
    expect(n.length).toBe(0);
    expect(n.count).toBe(0);
  });

  it('exposes object children as record nodes', () => {
    const n = createRecordNode({ a: 'x', b: 2 });
    const children = nodeList(n.children);
    expect(children).toHaveLength(2);
    expect(children[0].rawValue).toBe('x');
    expect(children[1].rawValue).toBe('2');
  });

  it('skips xml attribute keys when listing children', () => {
    const n = createRecordNode({ '@_id': '1', name: 'N' });
    expect(nodeList(n.children)).toHaveLength(1);
    const items = n.nodes as { length: number; item: (idx: number) => RecordNode };
    expect(items.length).toBe(1);
    expect(items.item(0).rawValue).toBe('N');
  });

  it('returns null nodes for out-of-range nodes.item indexes', () => {
    const n = createRecordNode({ a: 'x' });
    const items = n.nodes as { length: number; item: (idx: number) => RecordNode };
    expect(items.length).toBe(1);
    expect((items.item(4).isNull as Fn)()).toBe(true);
  });

  it('exposes fixed metadata properties', () => {
    const n = createRecordNode('x');
    expect(n.presence).toBe('visible');
    expect(n.name).toBe('');
    expect(n.className).toBe('record');
    expect(n.type).toBe('record');
  });

  it('detects null only for empty primitive text', () => {
    expect((createRecordNode('').isNull as Fn)()).toBe(true);
    expect((createRecordNode('x').isNull as Fn)()).toBe(false);
    expect((createRecordNode({}).isNull as Fn)()).toBe(false);
    expect((createRecordNode(null).isNull as Fn)()).toBe(false);
  });

  it('exposes visibility helpers', () => {
    const n = createRecordNode('x');
    expect((n.isVisible as Fn)()).toBe(true);
    expect((n.isHidden as Fn)()).toBe(false);
  });

  it('updates its value through setValue and setRawValue', () => {
    const n = createRecordNode('a');
    (n.setValue as Fn)('b');
    expect(n.rawValue).toBe('b');
    (n.setRawValue as Fn)('c');
    expect(n.value).toBe('c');
  });

  it('updates its value through proxy assignment', () => {
    const n = createRecordNode('a');
    n.value = 'assigned';
    expect(n.rawValue).toBe('assigned');
    n.rawValue = 'second';
    expect(n.defaultValue).toBe('second');
  });

  it('resolves nested paths to record nodes', () => {
    const n = createRecordNode({ a: { b: 'deep' } });
    const resolved = (n.resolveNode as (expr: string) => RecordNode)('$.a.b');
    expect(resolved.rawValue).toBe('deep');
    const same = (n.resolveNodes as (expr: string) => RecordNode)('.a.b');
    expect(same.rawValue).toBe('deep');
  });

  it('returns a null node for unresolved paths', () => {
    const n = createRecordNode({ a: 'x' });
    const resolved = (n.resolveNode as (expr: string) => RecordNode)('$.missing.deep');
    expect((resolved.isNull as Fn)()).toBe(true);
  });

  it('resolves numeric array children by index', () => {
    const n = createRecordNode(['first', 'second']);
    expect((n[0] as RecordNode).rawValue).toBe('first');
    expect((n[1] as RecordNode).rawValue).toBe('second');
    expect(((n[9] as RecordNode).isNull as Fn)()).toBe(true);
  });

  it('resolves named object children through property access', () => {
    const n = createRecordNode({ child: 'value' });
    expect((n.child as RecordNode).rawValue).toBe('value');
    expect(((n.other as RecordNode).isNull as Fn)()).toBe(true);
  });

  it('coerces scalar text and reports its toStringTag', () => {
    const n = createRecordNode('hi');
    expect(String(n)).toBe('hi');
    expect(Object.prototype.toString.call(n)).toBe('[object XfaRecordNode]');
  });
});

describe('createRecordProxy', () => {
  it('wraps the supplied data', () => {
    expect(createRecordProxy({ a: 'x' }).a).toBeInstanceOf(Object);
    const wrapped = createRecordProxy({ a: 'x' }).a as RecordNode;
    expect(wrapped.rawValue).toBe('x');
  });

  it.each([undefined, null])('wraps %s as an empty record', (value) => {
    const n = createRecordProxy(value);
    expect(n.type).toBe('record');
    expect(nodeList(n.all)).toEqual([]);
    expect((n.isNull as Fn)()).toBe(false);
  });

  it('wraps a scalar value', () => {
    expect(createRecordProxy('top').rawValue).toBe('top');
  });
});
