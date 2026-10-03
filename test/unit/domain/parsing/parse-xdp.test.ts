import { parseXdp } from '../../../../src/domain/parsing/parse-xdp';

const MINIMAL_XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <field name="Name">
        <bind match="dataRef" ref="$.Name"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

const NO_TEMPLATE_XDP = `<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"></xdp:xdp>`;

const XDP_WITH_BORDER = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <draw name="box" x="10mm" y="10mm" w="40mm" h="20mm">
        <border presence="visible">
          <fill presence="visible" fillType="toRight">
            <color value="255,0,0"/>
            <opacity value="0.3"/>
          </fill>
          <corner radius="4pt"/>
          <edge index="0" thickness="2pt" stroke="solid"><color value="0,0,0"/></edge>
          <edge index="3" thickness="1pt" stroke="dashed"><color value="0,0,0"/><opacity value="0.5"/></edge>
          <edge index="1" thickness="3pt" stroke="dotted"><color value="0,0,0"/></edge>
          <edge index="2" thickness="1pt" stroke="solid"><color value="0,0,0"/></edge>
        </border>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;

const XDP_WITH_TABLE = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="Table" layout="table" columnWidths="50mm 50mm 50mm">
        <subform layout="row" name="Row1">
          <field name="Col1"><bind match="dataRef" ref="$.col1"/></field>
          <field name="Col2"><bind match="dataRef" ref="$.col2"/></field>
          <field name="Col3"><bind match="dataRef" ref="$.col3"/></field>
        </subform>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

describe('parse-xdp', () => {
  describe('success cases', () => {
    it('parses minimal XDP with a single field', () => {
      const result = parseXdp(MINIMAL_XDP);
      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.rootSubformName).toBe('value');
      expect(result.data.pages).toHaveLength(1);
      expect(result.data.pages[0].name).toBe('Page1');
    });

    it('extracts page medium dimensions', () => {
      const result = parseXdp(MINIMAL_XDP);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const medium = result.data.pages[0].medium;
      expect(medium.stock).toBe('a4');
      expect(medium.short).toBeCloseTo(595.28, 0);
      expect(medium.long).toBeCloseTo(841.89, 0);
    });

    it('extracts content area in points', () => {
      const result = parseXdp(MINIMAL_XDP);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const ca = result.data.pages[0].contentArea;
      expect(ca.x).toBeGreaterThan(0);
      expect(ca.w).toBeGreaterThan(0);
      expect(ca.h).toBeGreaterThan(0);
    });

    it('parses field with bind ref', () => {
      const result = parseXdp(MINIMAL_XDP);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const field = result.data.children.find(
        (n) => n.type === 'field' && n.name === 'Name'
      );
      expect(field).toBeDefined();
      if (field?.type === 'field') {
        expect(field.bindRef).toBe('$.Name');
        expect(field.bindMatch).toBe('dataRef');
      }
    });

    it('parses table layout with columnWidths', () => {
      const result = parseXdp(XDP_WITH_TABLE);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const table = result.data.children.find(
        (n) => n.type === 'subform' && n.name === 'Table'
      );
      expect(table).toBeDefined();
      if (table?.type === 'subform') {
        expect(table.layout).toBe('table');
        expect(table.columnWidths).toHaveLength(3);
        expect(table.columnWidths![0]).toBeCloseTo(141.73, 0); // 50mm ≈ 141.73pt
      }
    });
  });

  describe('borders', () => {
    it('orders edges by index and parses opacity/fillType', () => {
      const result = parseXdp(XDP_WITH_BORDER);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const draw = result.data.children.find((node) => node.name === 'box') as any;
      expect(draw).toBeDefined();
      const border = draw.border;
      expect(border).toBeDefined();

      // index 0=top, 1=right, 2=bottom, 3=left regardless of document order
      expect(border.edges).toHaveLength(4);
      expect(border.edges[0].thickness).toBeCloseTo(2);
      expect(border.edges[1].thickness).toBeCloseTo(3);
      expect(border.edges[2].thickness).toBeCloseTo(1);
      expect(border.edges[3].style).toBe('dashed');
      expect(border.edges[3].opacity).toBeCloseTo(0.5);

      expect(border.fill.opacity).toBeCloseTo(0.3);
      expect(border.fill.fillType).toBe('toRight');
      expect(border.fill.color).toEqual({ r: 255, g: 0, b: 0 });
      expect(border.cornerRadius).toBeCloseTo(4);
    });

    it('falls back to document order when index is absent', () => {
      const xml = XDP_WITH_BORDER.replace(/ index="\d"/g, '');
      const result = parseXdp(xml);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const draw = result.data.children.find((node) => node.name === 'box') as any;
      expect(draw.border.edges.map((e: any) => e.thickness)).toEqual([2, 1, 3, 1]);
    });
  });

  describe('paragraph (<para>)', () => {
    const XDP_WITH_PARA = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200mm" h="260mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <field name="f" w="100mm" minH="6mm">
        <font typeface="Helvetica" size="10pt"/>
        <para hAlign="center" vAlign="middle" lineHeight="20pt"
              spaceAbove="3pt" spaceBelow="4pt" textIndent="12pt"
              marginLeft="5pt" marginRight="6pt"/>
        <bind match="dataRef" ref="$.f"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

    it('parses the XFA <para> paragraph metrics as points', () => {
      const result = parseXdp(XDP_WITH_PARA);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const field = result.data.children.find((n) => n.name === 'f') as any;
      expect(field.para).toEqual({
        hAlign: 'center',
        vAlign: 'middle',
        lineHeight: 20,
        spaceAbove: 3,
        spaceBelow: 4,
        textIndent: 12,
        marginLeft: 5,
        marginRight: 6,
      });
    });

    it('omits para when no attributes are present', () => {
      const result = parseXdp(MINIMAL_XDP);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const field = result.data.children.find((n) => n.name === 'Name') as any;
      expect(field.para).toBeUndefined();
    });
  });

  describe('failure cases', () => {
    it('returns failure for missing template element', () => {
      const result = parseXdp(NO_TEMPLATE_XDP);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('XDP_1002');
      }
    });

    it('returns failure for malformed XML', () => {
      const result = parseXdp('<not valid xml>>>');
      expect(result.success).toBe(false);
    });
  });
});
