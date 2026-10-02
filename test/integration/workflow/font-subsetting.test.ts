import * as fs from 'fs';
import * as path from 'path';
import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

/**
 * G10 — embedded fonts are subsetted to the glyphs actually used. A form that
 * needs the bundled Unicode fallback (for a non-WinAnsi character) must embed a
 * font file far smaller than the full TTF.
 */

const FULL_FONT = path.join(__dirname, '../../..', 'assets/fonts/DejaVuSans.ttf');

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
      <field name="Name" x="0" y="0" w="140pt" h="14pt">
        <ui><textEdit/></ui>
        <bind match="dataRef" ref="$.Name"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Name>Δelta</Name></value>`;

function embeddedFontBytes(doc: PDFDocument): number {
  let total = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (String(obj.get(PDFName.of('Type'))) !== '/FontDescriptor') continue;
    for (const key of ['FontFile', 'FontFile2', 'FontFile3']) {
      const ref = obj.get(PDFName.of(key));
      if (!ref) continue;
      const stream = doc.context.lookup(ref);
      if (stream instanceof PDFStream) total += stream.getContents().length;
    }
  }
  return total;
}

describe('G10 — font subsetting', () => {
  it('embeds a subset far smaller than the full fallback font', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) return;

    const doc = await PDFDocument.load(result.data);
    const embedded = embeddedFontBytes(doc);
    const full = fs.statSync(FULL_FONT).size;

    expect(embedded).toBeGreaterThan(0);
    expect(embedded).toBeLessThan(full / 2);
  });
});
