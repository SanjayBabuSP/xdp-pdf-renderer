import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="v" minOccurs="0"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>VEJ894</v></value>`;

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10pt" y="10pt" w="96mm" h="4mm" access="readOnly">
        <ui><textEdit/></ui>
        <font typeface="Arial" size="6.5pt"/>
        <margin topInset="0.5mm" bottomInset="0.5mm" leftInset="0.5mm" rightInset="0.5mm"/>
        <para vAlign="middle"/>
        <caption reserve="40mm">
          <value><text>TBKT BNGUYCNDB:</text></value>
          <para vAlign="middle"/>
          <font typeface="Arial" weight="bold" size="6.5pt"/>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

describe('field caption and value share a baseline', () => {
  it('places caption and value text on the same baseline', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    const content = await contentStream(result.data);
    const re = /1 0 0 1 ([\d.\-]+) ([\d.\-]+) Tm\n/g;
    const ys: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) ys.push(Number(m[2]));
    expect(ys.length).toBeGreaterThanOrEqual(2);
    for (const y of ys.slice(1)) {
      expect(Math.abs(y - ys[0])).toBeLessThan(0.05);
    }
  });
});
