import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';

const XDP_BREAKS = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="S1" breakBefore="contentArea" breakAfter="pageOdd" maxH="100mm" maxW="80mm">
        <keep contentArea="contentArea" pageArea="auto"/>
        <field name="F1">
          <bind match="dataRef" ref="$.f1"/>
        </field>
      </subform>
      <field name="F2" breakBefore="pageArea">
        <bind match="dataRef" ref="$.f2"/>
      </field>
      <subform name="S2" breakBefore="bogus">
        <bind match="none"/>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

describe('parse-xdp breaks / keep / max extents', () => {
  it('parses breakBefore/breakAfter, keep and maxH/maxW on subforms', () => {
    const result = parseXdp(XDP_BREAKS);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const s1 = result.data.children.find((c) => c.name === 'S1');
    expect(s1).toBeDefined();
    expect(s1).toMatchObject({
      breakBefore: 'contentArea',
      breakAfter: 'pageOdd',
      keep: { contentArea: 'contentArea', pageArea: 'auto' },
    });
    if (s1?.type !== 'subform') throw new Error('expected subform');
    expect(s1.position!.maxH).toBeCloseTo(283.46, 1); // 100mm
    expect(s1.position!.maxW).toBeCloseTo(226.77, 1); // 80mm
  });

  it('parses breakBefore on fields', () => {
    const result = parseXdp(XDP_BREAKS);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const f2 = result.data.children.find((c) => c.name === 'F2');
    expect(f2).toMatchObject({ breakBefore: 'pageArea' });
  });

  it('drops unknown break values (default auto)', () => {
    const result = parseXdp(XDP_BREAKS);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const s2 = result.data.children.find((c) => c.name === 'S2');
    expect(s2?.breakBefore).toBeUndefined();
  });
});
