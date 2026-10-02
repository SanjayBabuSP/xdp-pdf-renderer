import { PropertyChangeTracker } from '../../../../src/domain/scripting/property-change-tracker';
import { ScriptableNode } from '../../../../src/domain/scripting/script-types';
import { FieldNode, LayoutNode, SubformNode } from '../../../../src/types';
import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
import { parseXsd } from '../../../../src/domain/parsing/parse-xsd';
import { parseXmlData } from '../../../../src/domain/parsing/parse-xml-data';
import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { expandRepeats } from '../../../../src/domain/mapping/expand-repeats';
import { dispatchScripts } from '../../../../src/domain/scripting';

/**
 * Issue 1 regression: reconciliation must be identity-based.
 *
 * Duplicate names and duplicate SOM paths are normal in real XDP (repeated
 * rows, `-Black`/`-White` twins). Matching on terminal name or path suffix
 * makes the first sibling absorb every write.
 */
describe('identity-based reconciliation', () => {
  const makeField = (extra: Partial<FieldNode> = {}): FieldNode => ({
    type: 'field',
    name: 'cell',
    ...extra,
  });

  const makeScriptable = (
    key: string,
    path: string,
    layoutNode: FieldNode
  ): ScriptableNode => ({
    type: 'field',
    name: 'cell',
    key,
    path,
    layoutNode,
    presence: 'visible',
    children: [],
  });

  it('writes presence onto the exact node the script changed', () => {
    const a = makeField(); // no `presence` key at all — the common case
    const b = makeField();
    const sa = makeScriptable('A.cell', 'A.cell', a);
    const sb = makeScriptable('B.cell', 'B.cell', b);

    const tracker = new PropertyChangeTracker();
    tracker.snapshot('A.cell', sa);
    tracker.snapshot('B.cell', sb);

    sb.presence = 'hidden';
    tracker.detectChanges('A.cell', sa);
    tracker.detectChanges('B.cell', sb);
    const result = tracker.applyByIdentity([sa, sb]);

    expect(result.presenceChanged).toBe(1);
    expect(b.presence).toBe('hidden');
    expect(a.presence).toBeUndefined();
    expect('presence' in a).toBe(false);
  });

  it('keeps two nodes with an identical SOM path apart', () => {
    const first = makeField();
    const second = makeField();
    // buildScriptIndex keys the first claimer `path` and the next `path#2`.
    const s1 = makeScriptable('row.cell', 'row.cell', first);
    const s2 = makeScriptable('row.cell#2', 'row.cell', second);

    const tracker = new PropertyChangeTracker();
    tracker.snapshot(s1.key!, s1);
    tracker.snapshot(s2.key!, s2);

    s2.resolvedValue = 'from-the-second';
    tracker.detectChanges(s1.key!, s1);
    tracker.detectChanges(s2.key!, s2);
    const result = tracker.applyByIdentity([s1, s2]);

    expect(result.valuesChanged).toBe(1);
    expect(second.resolvedValue).toBe('from-the-second');
    expect(first.resolvedValue).toBeUndefined();
    expect('resolvedValue' in first).toBe(false);
  });

  it('does not write properties that never changed', () => {
    const node = makeField({ presence: 'visible' });
    const s = makeScriptable('x', 'x', node);

    const tracker = new PropertyChangeTracker();
    tracker.snapshot('x', s);
    tracker.detectChanges('x', s);
    const result = tracker.applyByIdentity([s]);

    expect(result).toEqual({
      valuesChanged: 0,
      presenceChanged: 0,
      accessChanged: 0,
      layoutDirty: false,
    });
  });

  it('is invisible to a node with no snapshot (e.g. the collapsed root)', () => {
    const node = makeField();
    const s: ScriptableNode = { type: 'subform', name: 'root', key: 'root', children: [] };
    const tracker = new PropertyChangeTracker();
    expect(tracker.applyByIdentity([s])).toMatchObject({ presenceChanged: 0 });
    expect(node.presence).toBeUndefined();
  });
});

describe('duplicate-named siblings through the real dispatcher', () => {
  const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/2.8/">
    <subform name="value" bind="dataRef" ref="$" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="left" layout="tb">
        <field name="flag" w="40mm" minH="6mm">
          <ui><textEdit/></ui>
          <event activity="initialize">
            <script contentType="application/x-formcalc"><![CDATA[
              $.presence = "hidden"
            ]]></script>
          </event>
        </field>
      </subform>
      <subform name="right" layout="tb">
        <field name="flag" w="40mm" minH="6mm">
          <ui><textEdit/></ui>
        </field>
      </subform>
    </subform>
  </template>
  <config xmlns="http://ns.adobe.com/xdp/xci/3.0/">
    <present><pdf><version>1.7</version></pdf></present>
  </config>
  <connectionSet xmlns="http://ns.adobe.com/xdp/xfa-connection-set/2.8/">
    <dataConnection name="DataConnection" dataDescription="value"/>
  </connectionSet>
</xdp:xdp>`;

  const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="flag" type="xs:string" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

  it('hides only the field that ran the script', () => {
    const parsed = parseXdp(XDP);
    const schema = parseXsd(XSD);
    expect(parsed.success).toBe(true);
    expect(schema.success).toBe(true);
    if (!parsed.success || !schema.success) return;

    const data = parseXmlData('<value><flag/></value>', schema.data);
    expect(data.success).toBe(true);
    if (!data.success) return;

    const resolved = resolveBindings(parsed.data, data.data);
    expect(resolved.success).toBe(true);
    if (!resolved.success) return;
    const expanded = expandRepeats(resolved.data, data.data);
    expect(expanded.success).toBe(true);
    if (!expanded.success) return;

    const pre = dispatchScripts(expanded.data, data.data as Record<string, unknown>, {});
    expect(pre.success).toBe(true);
    if (!pre.success) return;
    expect((pre.data as unknown as { errorMessages: string[] }).errorMessages).toEqual([]);

    const flags: { owner: string; presence?: string }[] = [];
    const walk = (nodes: LayoutNode[], owner: string): void => {
      for (const n of nodes) {
        if (n.type === 'subform') {
          walk(n.children, n.name ?? owner);
        } else if (n.type === 'field' && n.name === 'flag') {
          flags.push({ owner, presence: (n as FieldNode).presence });
        }
      }
    };
    const subforms = pre.data.layout.children.filter(
      (n): n is SubformNode => n.type === 'subform'
    );
    for (const s of subforms) walk(s.children, s.name ?? '');

    expect(flags).toHaveLength(2);
    // The script owner hides…
    expect(flags[0]).toEqual({ owner: 'left', presence: 'hidden' });
    // …and the same-named sibling it never touched must not inherit that.
    expect(flags[1].owner).toBe('right');
    expect(flags[1].presence).not.toBe('hidden');
  });
});
