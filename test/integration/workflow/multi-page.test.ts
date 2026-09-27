import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { PDFDocument } from 'pdf-lib';

/**
 * End-to-end multi-page render: 40 stacked rows × 30pt exceed the 734pt
 * content area, so pagination must produce a second PDF page with content
 * (coordinate-based paging — plan Phase 2 task 3).
 */
const FIELD_COUNT = 40;

function buildXdp(): string {
  const fields = Array.from(
    { length: FIELD_COUNT },
    (_, i) => `<field name="Row${i}" y="0" w="200mm" h="30pt">
        <value><text>Row ${i}</text></value>
      </field>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="Form" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1">
          <contentArea x="0" y="0" w="210mm" h="297mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="List" layout="tb">
        ${fields}
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <xsd:element name="value">
    <xsd:complexType>
      <xsd:sequence>
        <xsd:element type="xs:string" name="name" minOccurs="0"/>
      </xsd:sequence>
    </xsd:complexType>
  </xsd:element>
</xsd:schema>`;

const DATA = `<value><name>x</name></value>`;

describe('multi-page rendering (integration)', () => {
  it('produces a PDF with a second page when content exceeds the content area', async () => {
    const result = await renderFormToPdf(buildXdp(), XSD, DATA);
    expect(result.success).toBe(true);
    if (!result.success) {
      console.error(result.error);
      return;
    }

    const doc = await PDFDocument.load(result.data);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getWidth()).toBeCloseTo(595.28, 1);
    expect(doc.getPage(1).getHeight()).toBeCloseTo(841.89, 1);
  });
});
