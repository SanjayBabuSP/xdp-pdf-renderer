import {
  parseSomExpression,
  SomExpressionResolver,
} from '../../../../src/domain/scripting/som-expression-resolver';
import { ScriptableNode } from '../../../../src/domain/scripting/script-types';

const node = (name: string, type = 'field', resolvedValue?: unknown): ScriptableNode => ({
  type,
  name,
  key: name,
  path: name,
  resolvedValue,
});

function buildResolver(formRootPath = 'form'): SomExpressionResolver {
  const nodes: Array<[string, ScriptableNode]> = [
    ['form', node('form', 'subform')],
    ['form.sub1', node('sub1', 'subform')],
    ['form.sub1.fieldA', node('fieldA', 'field', 'A')],
    ['form.sub1.fieldB', node('fieldB', 'field', 'B')],
    ['form.sub2', node('sub2', 'subform')],
    ['form.sub2.fieldA', node('fieldA', 'field', 'A2')],
    ['form.top', node('top', 'field', 'T')],
  ];
  return new SomExpressionResolver(
    new Map(nodes),
    { user: { first: 'Ada' }, count: 7 },
    formRootPath
  );
}

describe('parseSomExpression', () => {
  it('splits a dotted path into plain segments', () => {
    expect(parseSomExpression('a.b.c')).toEqual([
      { name: 'a', wildcard: false },
      { name: 'b', wildcard: false },
      { name: 'c', wildcard: false },
    ]);
  });

  it('parses a numeric bracket index', () => {
    expect(parseSomExpression('row[2]')).toEqual([{ name: 'row', index: 2, wildcard: false }]);
  });

  it('parses a trailing wildcard bracket', () => {
    expect(parseSomExpression('row[*]')).toEqual([{ name: 'row', wildcard: true }]);
  });

  it('leaves index undefined for a non-numeric bracket value', () => {
    expect(parseSomExpression('row[x]')).toEqual([
      { name: 'row', index: undefined, wildcard: false },
    ]);
  });

  it('parses mixed segments with brackets', () => {
    expect(parseSomExpression('a.b[1].c[*]')).toEqual([
      { name: 'a', wildcard: false },
      { name: 'b', index: 1, wildcard: false },
      { name: 'c', wildcard: true },
    ]);
  });
});

describe('SomExpressionResolver.resolve', () => {
  const resolver = buildResolver();

  it('returns not found for an empty expression', () => {
    expect(resolver.resolve('', 'form.top')).toEqual({ nodes: [], found: false });
  });

  it('returns not found for a whitespace-only expression', () => {
    expect(resolver.resolve('   ', 'form.top')).toEqual({ nodes: [], found: false });
  });

  it('resolves "$" to the context node', () => {
    expect(resolver.resolve('$', 'form.top')).toEqual({
      nodes: [resolver.getNodeByPath('form.top')],
      found: true,
    });
  });

  it('returns not found for "$" when the context path is unknown', () => {
    expect(resolver.resolve('$', 'missing')).toEqual({ nodes: [], found: false });
  });

  it('resolves "this" to the context node', () => {
    expect(resolver.resolve(' this ', 'form.sub1.fieldA')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1.fieldA')],
      found: true,
    });
  });

  it('resolves a trailing XFA property on the context node', () => {
    expect(resolver.resolve('$.rawValue', 'form.sub1.fieldA')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1.fieldA')],
      found: true,
      property: 'rawValue',
    });
  });

  it('walks the "parent" segment when it is not the final segment', () => {
    expect(resolver.resolve('$.parent.rawValue', 'form.sub1.fieldA')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1')],
      found: true,
      property: 'rawValue',
    });
  });

  it('resolves a sibling relative to the context path', () => {
    expect(resolver.resolve('$.fieldB', 'form.sub1')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1.fieldB')],
      found: true,
    });
  });

  it('resolves "$$" to the containing subform', () => {
    expect(resolver.resolve('$$', 'form.sub1.fieldA')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1')],
      found: true,
    });
  });

  it('resolves a relative path from the containing subform', () => {
    expect(resolver.resolve('$$.fieldA', 'form.sub1.fieldB')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1.fieldA')],
      found: true,
    });
  });

  it('returns not found for "$$" when there is no containing subform or root fallback', () => {
    const detached = new SomExpressionResolver(new Map([['a.dup', node('dup')]]), {}, '');
    expect(detached.resolve('$$', 'a.dup')).toEqual({ nodes: [], found: false });
  });

  it('resolves "$form" to the configured root node', () => {
    expect(resolver.resolve('$form', 'form.top')).toEqual({
      nodes: [resolver.getNodeByPath('form')],
      found: true,
    });
  });

  it('resolves a path from the form root using "$form."', () => {
    expect(resolver.resolve('$form.sub2.fieldA', 'form.sub1')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub2.fieldA')],
      found: true,
    });
  });

  it('resolves a path from the form root using "xfa.form."', () => {
    expect(resolver.resolve('xfa.form.sub1', 'form.top')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1')],
      found: true,
    });
  });

  it('falls back to an empty base when the form root does not contain the path', () => {
    const detached = new SomExpressionResolver(
      new Map([['detached', node('detached')]]),
      {},
      'form'
    );
    expect(detached.resolve('$form.detached', '')).toEqual({
      nodes: [detached.getNodeByPath('detached')],
      found: true,
    });
  });

  it('creates a data pseudo-node for a scalar "$record" path', () => {
    expect(resolver.resolve('$record.count', 'form.top')).toEqual({
      nodes: [{ type: 'data', name: 'count', resolvedValue: 7 }],
      found: true,
    });
  });

  it('creates a data pseudo-node for a nested "$record" path', () => {
    expect(resolver.resolve('$record.user.first', 'form.top')).toEqual({
      nodes: [{ type: 'data', name: 'first', resolvedValue: 'Ada' }],
      found: true,
    });
  });

  it('returns not found for a missing "$record" path', () => {
    expect(resolver.resolve('$record.user.missing', 'form.top')).toEqual({
      nodes: [],
      found: false,
    });
  });

  it('returns not found when a "$record" path traverses a non-object', () => {
    expect(resolver.resolve('$record.count.other', 'form.top')).toEqual({
      nodes: [],
      found: false,
    });
  });

  it.each(['$host', '$event', '$layout'])(
    'reports %s as a property-bearing non-node reference',
    (expression) => {
      expect(resolver.resolve(expression, 'form.top')).toEqual({
        nodes: [],
        found: false,
        property: expression,
      });
    }
  );

  it('searches upward through parent paths for a bare name', () => {
    expect(resolver.resolve('fieldA', 'form.sub1.fieldA')).toEqual({
      nodes: [resolver.getNodeByPath('form.sub1.fieldA')],
      found: true,
    });
  });

  it('resolves a wildcard name lookup to the first matching node', () => {
    const detached = new SomExpressionResolver(
      new Map([
        ['a.dup', node('dup', 'field', 1)],
        ['b.dup', node('dup', 'field', 2)],
      ]),
      {},
      ''
    );
    expect(detached.resolve('dup[*]', '')).toEqual({
      nodes: [detached.getNodeByPath('a.dup')],
      found: true,
    });
  });

  it('selects one node by bracket index on a name lookup', () => {
    const detached = new SomExpressionResolver(
      new Map([
        ['a.dup', node('dup', 'field', 1)],
        ['b.dup', node('dup', 'field', 2)],
      ]),
      {},
      ''
    );
    expect(detached.resolve('dup[1]', '')).toEqual({
      nodes: [detached.getNodeByPath('b.dup')],
      found: true,
    });
  });

  it('returns not found when a bracket index is out of range', () => {
    const detached = new SomExpressionResolver(new Map([['a.dup', node('dup')]]), {}, '');
    expect(detached.resolve('dup[5]', '')).toEqual({ nodes: [], found: false });
  });
});

describe('SomExpressionResolver lookup helpers', () => {
  const resolver = buildResolver();

  it('returns the node registered at an exact path', () => {
    expect(resolver.getNodeByPath('form.top')?.name).toBe('top');
    expect(resolver.getNodeByPath('form.top')?.resolvedValue).toBe('T');
  });

  it('returns undefined for an unregistered path', () => {
    expect(resolver.getNodeByPath('missing')).toBeUndefined();
  });

  it('returns the derived parent path', () => {
    expect(resolver.getParentPath('form.sub1.fieldA')).toBe('form.sub1');
  });

  it('returns undefined for a parentless path', () => {
    expect(resolver.getParentPath('form')).toBeUndefined();
  });

  it('returns the derived child paths in insertion order', () => {
    expect(resolver.getChildPaths('form')).toEqual(['form.sub1', 'form.sub2', 'form.top']);
  });

  it('returns an empty child list for an unknown path', () => {
    expect(resolver.getChildPaths('missing')).toEqual([]);
  });

  it('returns all nodes sharing a terminal name', () => {
    expect(resolver.resolveAllByName('fieldA')).toEqual([
      resolver.getNodeByPath('form.sub1.fieldA'),
      resolver.getNodeByPath('form.sub2.fieldA'),
    ]);
  });

  it('returns an empty list for an unmatched name', () => {
    expect(resolver.resolveAllByName('ghost')).toEqual([]);
  });

  it('returns the path unchanged as the full SOM path', () => {
    expect(resolver.getFullSomPath('form.sub1.fieldA')).toBe('form.sub1.fieldA');
  });
});
