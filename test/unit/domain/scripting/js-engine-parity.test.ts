import { JavaScriptEngine } from '../../../../src/domain/scripting/js-engine/javascript-engine';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import { scriptableToXfaNode } from '../../../../src/domain/scripting/xfa-object-model';
import { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import { FieldNode, DrawNode } from '../../../../src/types';

function setup(
  layout: FieldNode | DrawNode,
  data: Record<string, unknown>
): { engine: JavaScriptEngine; self: ScriptableNode; map: Map<string, ScriptableNode> } {
  const self: ScriptableNode = {
    type: layout.type,
    name: layout.name,
    key: 'content.subject',
    path: 'content.subject',
    layoutNode: layout,
    presence: layout.presence,
    resolvedValue: layout.resolvedValue,
    position: layout.position,
    children: [],
  };
  const map = new Map<string, ScriptableNode>([['content.subject', self]]);
  const engine = new JavaScriptEngine(createFieldAccessor(map, data), {});
  engine.setNodeMap(map);
  engine.setFormData(data);
  return { engine, self, map };
}

function exec(
  engine: JavaScriptEngine,
  self: ScriptableNode,
  script: string,
  data: Record<string, unknown>
) {
  return engine.execute(
    script,
    scriptableToXfaNode(self, self.path ?? ''),
    'initialize',
    data,
    self.key
  );
}

describe('JavaScript engine — Adobe LiveCycle script semantics', () => {
  const data = { IsPreview: 'true', OEM: 'ITT Bornemann GmbH' };

  it('binds `this` to the scripting object', () => {
    const layout: FieldNode = { type: 'field', name: 'subject' };
    const { engine, self } = setup(layout, data);
    exec(engine, self, 'this.rawValue = "written via this";', data);
    expect(self.resolvedValue).toBe('written via this');
  });

  it('binds `this` to the same object as `$`', () => {
    const layout: FieldNode = { type: 'field', name: 'subject' };
    const { engine, self } = setup(layout, data);
    exec(engine, self, '$.rawValue = "same"; if (this.rawValue !== $.rawValue) throw "diff";', data);
    expect(self.resolvedValue).toBe('same');
  });

  it('writes `presence` through the $ proxy', () => {
    const layout: FieldNode = { type: 'field', name: 'subject' };
    const { engine, self } = setup(layout, data);
    exec(engine, self, '$.presence = "visible";', data);
    expect(self.presence).toBe('visible');
    expect(layout.presence).toBe('visible');
  });

  it('writes geometry through to the layout position', () => {
    const layout: DrawNode = { type: 'draw', name: 'subject', position: { x: 1, y: 2 } };
    const { engine, self } = setup(layout, data);
    exec(engine, self, '$.rotate = "30";', data);
    expect(layout.position?.rotate).toBe(30);
    expect(self.position?.rotate).toBe(30);
  });

  it('propagates `returnValue` out of the script', () => {
    const layout: FieldNode = { type: 'field', name: 'subject' };
    const { engine, self } = setup(layout, data);
    const result = exec(engine, self, 'returnValue = 42;', data);
    expect(result.value).toBe(42);
  });

  describe('xfa.record', () => {
    it('reads a present flag', () => {
      const layout: FieldNode = { type: 'field', name: 'subject' };
      const { engine, self } = setup(layout, data);
      const result = exec(
        engine,
        self,
        'returnValue = xfa.resolveNode("xfa.record.IsPreview").value;',
        data
      );
      expect(result.value).toBe('true');
    });

    it('resolves a missing element to an empty value instead of throwing', () => {
      const layout: FieldNode = { type: 'field', name: 'subject' };
      const { engine, self } = setup(layout, { OEM: 'x' });
      const result = exec(
        engine,
        self,
        'returnValue = xfa.resolveNode("xfa.record.DoesNotExist").value;',
        { OEM: 'x' }
      );
      expect(result.value).toBe('');
    });

    it('supports a chained miss (`record.A.B.value`) without a TypeError', () => {
      const layout: FieldNode = { type: 'field', name: 'subject' };
      const { engine, self } = setup(layout, data);
      const result = exec(
        engine,
        self,
        'var v = xfa.record.CustomerAsset.MachineLocationIsAssumption.value; returnValue = (v === "true");',
        data
      );
      expect(result.value).toBe(false);
    });

    it('exposes nested elements on xfa.record', () => {
      const layout: FieldNode = { type: 'field', name: 'subject' };
      const { engine, self } = setup(layout, { nested: { flag: 'yes' } });
      const result = exec(
        engine,
        self,
        'returnValue = xfa.record.nested.flag.value;',
        { nested: { flag: 'yes' } }
      );
      expect(result.value).toBe('yes');
    });
  });
});
