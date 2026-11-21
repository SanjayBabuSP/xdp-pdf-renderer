import {
  extractFieldReferences,
  buildDependencyGraph,
  getFieldsToRecalculate,
  ADOBE_MAX_CASCADE_DEPTH,
} from '../../../../src/domain/scripting/script-dependency-tracker';
import { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import { ScriptEntry } from '../../../../src/domain/scripting/xfa-object-model';

const entry = (
  elementPath: string,
  scriptContent: string,
  language: 'formcalc' | 'javascript' = 'formcalc'
): ScriptEntry => ({
  elementPath,
  element: { type: 'field', name: elementPath.substring(elementPath.lastIndexOf('.') + 1) },
  eventName: 'calculate',
  scriptContent,
  language,
});

const graphNodes = (): Map<string, ScriptableNode> =>
  new Map<string, ScriptableNode>([
    ['form', { type: 'subform', name: 'form' }],
    ['form.A', { type: 'field', name: 'A' }],
    ['form.B', { type: 'field', name: 'B' }],
    ['form.C', { type: 'field', name: 'C' }],
  ]);

describe('extractFieldReferences', () => {
  describe('formcalc', () => {
    it('extracts $ and $$ prefixed references', () => {
      expect(extractFieldReferences('$.FieldA + $$.FieldB', 'formcalc')).toEqual(
        new Set(['FieldA', 'FieldB'])
      );
    });

    it('extracts dotted names beginning with an uppercase letter', () => {
      expect(extractFieldReferences('Header.Title + $.rawValue', 'formcalc')).toEqual(
        new Set(['Header.Title'])
      );
    });

    it('ignores known builtin properties', () => {
      expect(extractFieldReferences('$.Math + $.console + $.length', 'formcalc')).toEqual(
        new Set()
      );
    });

    it('deduplicates repeated references', () => {
      expect(extractFieldReferences('$.FieldA + $.FieldA', 'formcalc')).toEqual(
        new Set(['FieldA'])
      );
    });
  });

  describe('javascript', () => {
    it('extracts references from xfa.resolveNode calls', () => {
      expect(extractFieldReferences('xfa.resolveNode("FieldA").rawValue', 'javascript')).toEqual(
        new Set(['FieldA'])
      );
    });

    it('extracts both single and double quoted resolveNode arguments', () => {
      expect(
        extractFieldReferences(
          'xfa.resolveNode("FieldA") + xfa.resolveNode(\'FieldB\')',
          'javascript'
        )
      ).toEqual(new Set(['FieldA', 'FieldB']));
    });

    it('extracts references from xfa.form paths', () => {
      expect(extractFieldReferences('xfa.form.Header.Title', 'javascript')).toEqual(
        new Set(['Header.Title'])
      );
    });

    it('extracts references from $ and this property access', () => {
      expect(extractFieldReferences('this.FieldB + $$.FieldC', 'javascript')).toEqual(
        new Set(['FieldB', 'FieldC'])
      );
    });

    it('ignores known builtin properties', () => {
      expect(extractFieldReferences('$.rawValue + this.value', 'javascript')).toEqual(new Set());
    });
  });
});

describe('buildDependencyGraph', () => {
  it('builds reads-from and dependents links in an acyclic graph', () => {
    const graph = buildDependencyGraph(
      [entry('form.A', '$.B'), entry('form.B', '$.C'), entry('form.C', '$.rawValue')],
      graphNodes()
    );

    expect(graph.dependencies.size).toBe(3);
    expect(graph.dependencies.get('form.A')?.readsFrom).toEqual(new Set(['form.B']));
    expect(graph.dependencies.get('form.B')?.readsFrom).toEqual(new Set(['form.C']));
    expect(graph.dependencies.get('form.C')?.readsFrom).toEqual(new Set());
    expect(graph.dependencies.get('form.B')?.dependents).toEqual(new Set(['form.A']));
    expect(graph.dependencies.get('form.C')?.dependents).toEqual(new Set(['form.B']));
    expect(graph.dependencies.get('form.A')?.dependents).toEqual(new Set());
    expect(graph.hasCycles).toBe(false);
    expect(graph.cyclePaths).toEqual([]);
    expect(graph.executionOrder).toEqual(['form.C', 'form.B', 'form.A']);
  });

  it('resolves references by terminal node name when no scoped path matches', () => {
    const nodes = new Map<string, ScriptableNode>([
      ['form.A', { type: 'field', name: 'A' }],
      ['group.Z', { type: 'field', name: 'Z' }],
    ]);
    const graph = buildDependencyGraph([entry('form.A', '$.Z')], nodes);
    expect(graph.dependencies.get('form.A')?.readsFrom).toEqual(new Set(['group.Z']));
  });

  it('drops references that cannot be resolved to any node', () => {
    const graph = buildDependencyGraph([entry('form.A', '$.Ghost')], graphNodes());
    expect(graph.dependencies.get('form.A')?.readsFrom).toEqual(new Set());
  });

  it('detects cycles and appends the unvisited paths to the execution order', () => {
    const graph = buildDependencyGraph(
      [entry('form.A', '$.B'), entry('form.B', '$.A')],
      graphNodes()
    );

    expect(graph.hasCycles).toBe(true);
    expect(graph.cyclePaths).toEqual(['form.A', 'form.B']);
    expect(graph.executionOrder).toEqual(['form.A', 'form.B']);
  });
});

describe('getFieldsToRecalculate', () => {
  it('returns all transitive dependents of the modified field', () => {
    const graph = buildDependencyGraph(
      [entry('form.A', '$.B'), entry('form.B', '$.C'), entry('form.C', '$.rawValue')],
      graphNodes()
    );
    expect(getFieldsToRecalculate('form.C', graph)).toEqual(['form.B', 'form.A']);
  });

  it('returns an empty list for a field with no dependents', () => {
    const graph = buildDependencyGraph(
      [entry('form.A', '$.B'), entry('form.B', '$.rawValue')],
      graphNodes()
    );
    expect(getFieldsToRecalculate('form.A', graph)).toEqual([]);
  });

  it('returns an empty list for a field absent from the graph', () => {
    const graph = buildDependencyGraph([entry('form.A', '$.rawValue')], graphNodes());
    expect(getFieldsToRecalculate('form.Ghost', graph)).toEqual([]);
  });

  it('terminates and traverses each dependent once when the graph has a cycle', () => {
    const graph = buildDependencyGraph(
      [entry('form.A', '$.B'), entry('form.B', '$.A')],
      graphNodes()
    );
    expect(getFieldsToRecalculate('form.A', graph)).toEqual(['form.B', 'form.A']);
  });
});

describe('ADOBE_MAX_CASCADE_DEPTH', () => {
  it('matches the Adobe cascade depth limit', () => {
    expect(ADOBE_MAX_CASCADE_DEPTH).toBe(25);
  });
});
