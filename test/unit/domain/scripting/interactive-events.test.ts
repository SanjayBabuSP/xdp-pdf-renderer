import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { dispatchInteractiveEvent } from '../../../../src/domain/scripting';
import { LayoutModel, LayoutNode, FieldNode } from '../../../../src/types';

/**
 * G3 — interactive events (`click`/`change`/`enter`/`exit`) are dispatched on
 * demand with XFA propagation, and scripts can read `xfa.event`.
 */

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="content" layout="tb">
        <event activity="click">
          <script contentType="application/x-formcalc">note = "subform-click"</script>
        </event>
        <event activity="validate">
          <script contentType="application/x-formcalc">note = "subform-validate"</script>
        </event>
        <field name="target" x="0" y="0" w="100pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.target"/>
          <event activity="click">
            <script contentType="application/x-formcalc">$.rawValue = "clicked"</script>
          </event>
          <event activity="validate">
            <script contentType="application/x-formcalc">$.rawValue = "validated"</script>
          </event>
        </field>
        <field name="note" x="0" y="20pt" w="100pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.note"/>
        </field>
        <field name="vname" x="0" y="40pt" w="100pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.vname"/>
          <event activity="click">
            <script contentType="application/x-javascript">$.rawValue = xfa.event.name;</script>
          </event>
        </field>
        <field name="vname2" x="0" y="60pt" w="100pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.vname2"/>
          <event activity="click">
            <script contentType="application/x-javascript">$.rawValue = event.name;</script>
          </event>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

function findField(nodes: LayoutNode[], name: string): FieldNode | undefined {
  for (const node of nodes) {
    if (node.type === 'field' && node.name === name) return node;
    if (node.type === 'subform' || node.type === 'exclGroup') {
      const found = findField(node.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

function setup(): LayoutModel {
  const parsed = parseXdp(XDP);
  if (!parsed.success) throw new Error('parse failed');
  const resolved = resolveBindings(parsed.data, {});
  if (!resolved.success) throw new Error('resolve failed');
  return resolved.data;
}

describe('G3 — dispatchInteractiveEvent', () => {
  it('runs the target handler and bubbles to ancestor handlers', () => {
    const layout = setup();
    const result = dispatchInteractiveEvent(layout, {}, { activity: 'click', ref: 'value.content.target' });
    expect(result.success).toBe(true);
    expect(findField(layout.children, 'target')?.resolvedValue).toBe('clicked');
    expect(findField(layout.children, 'note')?.resolvedValue).toBe('subform-click');
  });

  it('does not bubble non-bubbling events', () => {
    const layout = setup();
    dispatchInteractiveEvent(layout, {}, { activity: 'validate', ref: 'value.content.target' });
    expect(findField(layout.children, 'target')?.resolvedValue).toBe('validated');
    // The subform's validate handler is on an ancestor and must not run.
    expect(findField(layout.children, 'note')?.resolvedValue).toBeUndefined();
  });

  it('exposes the event as both `xfa.event` and `event`', () => {
    const layout = setup();
    dispatchInteractiveEvent(layout, {}, { activity: 'click', ref: 'value.content.vname' });
    dispatchInteractiveEvent(layout, {}, { activity: 'click', ref: 'value.content.vname2' });
    expect(findField(layout.children, 'vname')?.resolvedValue).toBe('click');
    expect(findField(layout.children, 'vname2')?.resolvedValue).toBe('click');
  });

  it('applies the supplied value to the target before handlers run', () => {
    const layout = setup();
    dispatchInteractiveEvent(layout, {}, {
      activity: 'change',
      ref: 'value.content.target',
      value: 'typed',
    });
    expect(findField(layout.children, 'target')?.resolvedValue).toBe('typed');
  });

  it('is a no-op for an unknown target', () => {
    const layout = setup();
    const result = dispatchInteractiveEvent(layout, {}, { activity: 'click', ref: 'value.content.nope' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scriptsExecuted).toBe(0);
  });

  it('honours skipScripts', () => {
    const layout = setup();
    const result = dispatchInteractiveEvent(layout, {}, {
      activity: 'click',
      ref: 'value.content.target',
      config: { skipScripts: true },
    });
    expect(result.success).toBe(true);
    expect(findField(layout.children, 'target')?.resolvedValue).toBeUndefined();
  });
});
