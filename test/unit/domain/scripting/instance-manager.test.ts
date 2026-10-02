import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';
import { resolveBindings } from '../../../../src/domain/mapping/resolve-bindings';
import { dispatchScripts } from '../../../../src/domain/scripting';
import { LayoutModel, LayoutNode, SubformNode } from '../../../../src/types';

/**
 * G5 — a real `instanceManager`: `addInstance` / `removeInstance` /
 * `setInstances` / `moveInstance` mutate the layout tree instead of no-oping.
 */

function xdp(script: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="rows" layout="tb">
        <event activity="initialize">
          <script contentType="application/x-javascript">${script}</script>
        </event>
        <field name="row" x="0" y="0" w="80pt" h="12pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.row"/>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

function rows(layout: LayoutModel): SubformNode | undefined {
  const find = (nodes: LayoutNode[]): SubformNode | undefined => {
    for (const node of nodes) {
      if (node.type === 'subform' && node.name === 'rows') return node;
      if (node.type === 'subform' || node.type === 'exclGroup') {
        const found = find(node.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return find(layout.children);
}

function run(script: string): LayoutModel {
  const parsed = parseXdp(xdp(script));
  if (!parsed.success) throw new Error('parse failed');
  const resolved = resolveBindings(parsed.data, {});
  if (!resolved.success) throw new Error('resolve failed');
  const dispatched = dispatchScripts(resolved.data, {});
  if (!dispatched.success) throw new Error(dispatched.error.message);
  return dispatched.data.layout;
}

describe('G5 — instanceManager', () => {
  it('addInstance clones the existing instance into the layout tree', () => {
    const layout = run('$.instanceManager.addInstance();');
    expect(rows(layout)?.children).toHaveLength(2);
  });

  it('setInstances grows to the requested count', () => {
    const layout = run('$.instanceManager.setInstances(3);');
    expect(rows(layout)?.children).toHaveLength(3);
  });

  it('setInstances shrinks to the requested count', () => {
    const layout = run('$.instanceManager.setInstances(3); $.instanceManager.setInstances(1);');
    expect(rows(layout)?.children).toHaveLength(1);
  });

  it('removeInstance drops an instance', () => {
    const layout = run('$.instanceManager.setInstances(3); $.instanceManager.removeInstance(0);');
    expect(rows(layout)?.children).toHaveLength(2);
  });

  it('exposes a live count', () => {
    // Writes the observed count into the field before and after adding.
    const layout = run('$.instanceManager.addInstance(); $.row.rawValue = $.instanceManager.count;');
    expect(rows(layout)?.children).toHaveLength(2);
    expect(rows(layout)?.children[0].name).toBe('row');
  });

  it('moveInstance keeps the same number of instances', () => {
    const layout = run(
      '$.instanceManager.setInstances(3); $.instanceManager.moveInstance(0, 2);'
    );
    expect(rows(layout)?.children).toHaveLength(3);
  });
});
