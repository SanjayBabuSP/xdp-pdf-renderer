import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

/**
 * G16 end-to-end: `<config><present><pdf>` version / extension level reach the
 * output catalog, and `maxInputSize` is enforced before parsing.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence><xs:element type="xs:string" name="Name" minOccurs="0"/></xs:sequence></xs:complexType>
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
      <field name="Name" x="0" y="0" w="100pt" h="14pt">
        <ui><textEdit/></ui>
        <bind match="dataRef" ref="$.Name"/>
      </field>
    </subform>
  </template>
  <config xmlns="http://ns.adobe.com/xdp/xci/3.0/">
    <present>
      <pdf>
        <version>1.6</version>
        <adobeExtensionLevel>8</adobeExtensionLevel>
      </pdf>
    </present>
  </config>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Name>Test</Name></value>`;

describe('G16 — config-driven catalog metadata', () => {
  it('applies pdfVersion and adobeExtensionLevel from <config>', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const doc = await PDFDocument.load(result.data);
    expect(doc.catalog.get(PDFName.of('Version'))?.toString()).toBe('/1.6');
    const adbe = (doc.catalog.get(PDFName.of('Extensions')) as PDFDict).get(
      PDFName.of('ADBE')
    ) as PDFDict;
    expect(adbe.get(PDFName.of('ExtensionLevel'))?.toString()).toBe('8');
  });

  it('honours maxInputSize on the XDP input', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, { maxInputSize: 32 });
    expect(result.success).toBe(false);
  });
});
