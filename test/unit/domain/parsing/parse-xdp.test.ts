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
