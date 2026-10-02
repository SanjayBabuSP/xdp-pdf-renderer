import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, pathRectCount } from '../../helpers/pdf-content';

/**
 * PDF417 end-to-end (G15a): `<barcode type="pdf417">` must render a stacked
 * module symbol — Adobe renders pdf417 in software per `adobepdf.xdc:215`.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence><xs:element type="xs:string" name="Payload" minOccurs="0"/></xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

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
      <field name="bc" x="0" y="0" w="180pt" h="90pt">
        <ui>
          <barcode type="pdf417" errorCorrectionLevel="5" moduleWidth="0.338mm" moduleHeight="0.676mm"/>
        </ui>
        <bind match="dataRef" ref="$.Payload"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Payload>ADBE-PDF417-001</Payload></value>`;

describe('PDF417 renders from an XDP barcode field', () => {
  it('paints a stacked module symbol into the PDF', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const content = await contentStream(result.data);
    // A 3-4 row symbol yields dozens of dark runs.
    expect(pathRectCount(content)).toBeGreaterThan(20);
  });

  it('renders different payloads differently', async () => {
    const a = await renderFormToPdf(XDP, XSD, DATA, {});
    const b = await renderFormToPdf(XDP, XSD, DATA.replace('001', '002'), {});
    expect(a.success && b.success).toBe(true);
    if (!a.success || !b.success) return;
    expect(a.data.equals(b.data)).toBe(false);
  });
});
