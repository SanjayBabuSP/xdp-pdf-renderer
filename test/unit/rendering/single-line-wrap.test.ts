import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, pageText } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="v" minOccurs="0"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const LONG = '29815.6/95850.4';

function xdp(multiLine: boolean): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10" y="10" w="38pt" h="10pt">
        <ui><textEdit${multiLine ? ' multiLine="1"' : ''}/></ui>
        <font typeface="Arial" size="6.5pt"/>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
}

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>${LONG}</v></value>`;

function drawXdp(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="url" x="10pt" y="10pt" w="40pt" h="12pt">
        <ui><textEdit/></ui>
        <font typeface="Arial" size="6.5pt"/>
        <para vAlign="middle"/>
        <value><text>${LONG}</text></value>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('single-line fields do not wrap', () => {
  it('draws a long single-line value as one run', async () => {
    const result = await renderFormToPdf(xdp(false), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(await pageText(result.data)).toContain(LONG);
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBe(1);
  });

  it('still wraps multi-line fields in the same box', async () => {
    const result = await renderFormToPdf(xdp(true), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(await pageText(result.data)).toContain('29815');
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBeGreaterThan(1);
  });

  it('wraps a draw value at break opportunities even in a short box', async () => {
    const result = await renderFormToPdf(drawXdp(), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBe(2);
    const text = await pageText(result.data);
    expect(text).toContain('29815.6/');
    expect(text).toContain('95850.4');
  });

  it('clips a short draw that overflows after wrapping', async () => {
    const result = await renderFormToPdf(drawXdp(), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBe(2);
    expect(content).toMatch(/ re\s+W\s+n/);
  });
});
