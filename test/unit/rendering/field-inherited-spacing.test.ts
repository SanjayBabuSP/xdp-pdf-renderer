import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element name="Items" minOccurs="0" maxOccurs="unbounded"><xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="name" minOccurs="0"/>
    </xs:sequence></xs:complexType></xs:element>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Items><name>alpha</name></Items><Items><name>beta</name></Items><Items><name>gamma</name></Items></value>`;

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="Row" layout="tb">
        <occur max="-1" min="0"/>
        <bind match="dataRef" ref="$.Items[*]"/>
        <field name="f" w="171mm" minH="5mm" access="readOnly">
          <ui><textEdit multiLine="1"/></ui>
          <font typeface="Arial Narrow" size="12pt"/>
          <margin topInset="1mm" bottomInset="1mm" leftInset="1mm" rightInset="1mm"/>
          <para vAlign="middle"/>
          <bind match="dataRef" ref="$.name"/>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

function drawnYs(content: string): number[] {
  const re = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
  const ys: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const y = Number(m[1]);
    if (ys.length === 0 || Math.abs(ys[ys.length - 1] - y) > 0.001) ys.push(y);
  }
  return ys;
}

describe('repeated single-line fields use the parent line height', () => {
  it('pitches 12pt instances at 1.2 x 10pt plus margins', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const ys = drawnYs(await contentStream(result.data)).sort((a, b) => b - a);
    expect(ys.length).toBe(3);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i - 1] - ys[i]).toBeCloseTo(17.67, 1);
    }
  });
});
