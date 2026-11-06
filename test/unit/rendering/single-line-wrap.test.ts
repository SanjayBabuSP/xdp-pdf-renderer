import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../helpers/pdf-content';

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

/**
 * ADS parity: single-line fields never soft-wrap (Example-1 table value
 * `29815.6/95850.4` shattered into overlapping fragments when wrapped in a
 * 38pt cell; Adobe draws it whole on one line). Multi-line fields keep
 * wrapping.
 */
describe('single-line fields do not wrap', () => {
  it('draws a long single-line value as one run', async () => {
    const result = await renderFormToPdf(xdp(false), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    // The whole value is drawn (subset-encoded, so compare decoded text)…
    expect(extractText(content).join('')).toContain(LONG);
    // …with a single text-showing operator, not one per wrapped fragment.
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBe(1);
  });

  it('still wraps multi-line fields in the same box', async () => {
    const result = await renderFormToPdf(xdp(true), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(extractText(content).join('')).toContain('29815');
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBeGreaterThan(1);
  });
});
