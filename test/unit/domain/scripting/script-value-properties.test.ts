import { FormCalcParser } from '../../../../src/domain/scripting/formcalc/parser';
import { FormCalcEvaluator } from '../../../../src/domain/scripting/formcalc/evaluator';
import { createFieldAccessor } from '../../../../src/domain/scripting/xfa-object-model';
import { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import { FieldNode, DrawNode } from '../../../../src/types';
import { parseXml, textContent } from '../../../../src/lib/xml-utils';

function run(
  src: string,
  self: ScriptableNode,
  siblings: ScriptableNode[],
  data: Record<string, unknown>
): unknown {
  const map = new Map<string, ScriptableNode>();
  for (const n of [self, ...siblings]) {
    if (n.key) map.set(n.key, n);
    if (n.name && !map.has(n.name)) map.set(n.name, n);
  }
  const acc = createFieldAccessor(map, data);
  acc.setCurrentKey?.(self.key ?? null);
  const ast = new FormCalcParser(src).parse();
  new FormCalcEvaluator(acc).evaluate(ast);
  return self.resolvedValue;
}

const fieldNode = (name: string, extra: Partial<FieldNode> = {}): FieldNode => ({
  type: 'field',
  name,
  ...extra,
});

const scriptable = (
  key: string,
  layoutNode: FieldNode | DrawNode,
  extra: Partial<ScriptableNode> = {}
): ScriptableNode => ({
  type: layoutNode.type,
  name: layoutNode.name,
  key,
  path: key,
  layoutNode,
  presence: layoutNode.presence,
  resolvedValue: layoutNode.resolvedValue,
  position: layoutNode.position,
  children: [],
  ...extra,
});

describe('FormCalc value properties ($.rawValue / .formattedValue)', () => {
  it('parses `$.rawValue` as a relative reference, not a child named "$"', () => {
    const ast = new FormCalcParser('$.rawValue = "x"').parse();
    const assign = (ast as { body: { expr: { target: { path: string } } }[] }).body[0].expr;
    expect(assign.target.path.replace(/^\$?/, '')).toBe('.rawValue');
  });

  it('assigns to the scripting object', () => {
    const layout = fieldNode('oem');
    const self = scriptable('content.oem', layout);
    expect(run('$.rawValue = "ITT Bornemann GmbH"', self, [], {})).toBe(
      'ITT Bornemann GmbH'
    );
    expect(self.resolvedValue).toBe('ITT Bornemann GmbH');
    // Writes mirror straight through to the layout node the renderer reads.
    expect(layout.resolvedValue).toBe('ITT Bornemann GmbH');
  });

  it('assigns presence to the scripting object', () => {
    const layout = fieldNode('twin');
    const self = scriptable('content.twin', layout);
    run('$.presence = "hidden"', self, [], {});
    expect(self.presence).toBe('hidden');
    expect(layout.presence).toBe('hidden');
  });

  it('reads a sibling through the data record when it is not a template node', () => {
    const layout = fieldNode('oem');
    const self = scriptable('content.oem', layout);
    const out = run(
      '$.rawValue = OEM.formattedValue',
      self,
      [],
      { OEM: 'ITT Bornemann GmbH' }
    );
    expect(out).toBe('ITT Bornemann GmbH');
  });

  it('reads a sibling template node by bare name', () => {
    const siblingLayout = fieldNode('desc', { resolvedValue: 'from-node' });
    const sibling = scriptable('content.desc', siblingLayout);
    const self = scriptable('content.oem', fieldNode('oem'));
    const out = run('$.rawValue = desc.rawValue', self, [sibling], {});
    expect(out).toBe('from-node');
  });

  it('selects the else branch when the sibling element is empty (Adobe `<> null`)', () => {
    const layout = fieldNode('oem');
    const self = scriptable('content.oem', layout);
    const out = run(
      [
        'if (OEMDescription.rawValue <> null) then',
        '  $.rawValue = OEMDescription.formattedValue',
        'else',
        '  $.rawValue = OEM.formattedValue',
        'endif',
      ].join('\n'),
      self,
      [],
      { OEMDescription: '', OEM: 'ITT Bornemann GmbH' }
    );
    expect(out).toBe('ITT Bornemann GmbH');
  });

  it('takes the then branch when the sibling has a value', () => {
    const self = scriptable('content.oem', fieldNode('oem'));
    const out = run(
      [
        'if (OEMDescription.rawValue <> null) then',
        '  $.rawValue = OEMDescription.formattedValue',
        'else',
        '  $.rawValue = OEM.formattedValue',
        'endif',
      ].join('\n'),
      self,
      [],
      { OEMDescription: 'DESC', OEM: 'ITT Bornemann GmbH' }
    );
    expect(out).toBe('DESC');
  });

  it('writes node attributes (`rotate`) through to the layout position', () => {
    const layout: DrawNode = { type: 'draw', name: 'wm', position: { x: 1, y: 2 } };
    const self = scriptable('content.wm', layout);
    run('wm.rotate = "30"', self, [], {});
    expect(layout.position?.rotate).toBe(30);
  });
});

describe('XDP CDATA scripts', () => {
  it('textContent surfaces CDATA-only script bodies', () => {
    const parsed = parseXml('<event><script><![CDATA[$.presence = "hidden"]]></script></event>');
    const script = (parsed as { event: { script: unknown } }).event.script;
    expect(textContent(script)).toBe('$.presence = "hidden"');
  });

  it('keeps surrounding text alongside CDATA', () => {
    const parsed = parseXml('<event><script><![CDATA[abc]]>def</script></event>');
    const script = (parsed as { event: { script: unknown } }).event.script;
    expect(textContent(script)).toBe('abcdef');
  });
});
