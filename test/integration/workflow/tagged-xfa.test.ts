import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
} from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

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
  <config xmlns="http://ns.adobe.com/xdp/xci/3.0/">
    <present><pdf><version>1.7</version></pdf></present>
  </config>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Name>Alice</Name></value>`;

async function render(adobe: Record<string, unknown>): Promise<PDFDocument> {
  const result = await renderFormToPdf(XDP, XSD, DATA, { adobe });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return PDFDocument.load(result.data);
}

describe('G11 — tagged PDF', () => {
  it('sets MarkInfo and builds a structure tree', async () => {
    const doc = await render({ tagged: { language: 'en-US', title: 'Résumé' } });

    const markInfo = doc.context.lookup(doc.catalog.get(PDFName.of('MarkInfo'))) as PDFDict;
    expect(markInfo.get(PDFName.of('Marked'))).toBe(PDFBool.True);
    expect(String(doc.catalog.get(PDFName.of('Lang')))).toContain('en-US');

    const root = doc.context.lookup(doc.catalog.get(PDFName.of('StructTreeRoot'))) as PDFDict;
    expect(String(root.get(PDFName.of('Type')))).toBe('/StructTreeRoot');
    const documentElement = doc.context.lookup(root.get(PDFName.of('K'))) as PDFDict;
    expect(String(documentElement.get(PDFName.of('S')))).toBe('/Document');
    expect((doc.getPage(0).node.get(PDFName.of('StructParents')))).toBeDefined();
  });

  it('does not tag the document unless requested', async () => {
    const doc = await render({});
    expect(doc.catalog.get(PDFName.of('StructTreeRoot'))).toBeUndefined();
    expect(doc.catalog.get(PDFName.of('MarkInfo'))).toBeUndefined();
  });
});

describe('G12 — /XFA package embedding', () => {
  it('embeds the XDP packets as an alternating name/stream array', async () => {
    const doc = await render({ embedXfa: true });

    const acro = doc.context.lookup(doc.catalog.get(PDFName.of('AcroForm'))) as PDFDict;
    const xfa = doc.context.lookup(acro.get(PDFName.of('XFA'))) as PDFArray;
    expect(xfa.size()).toBeGreaterThanOrEqual(2);

    const firstName = xfa.lookup(0, PDFString);
    expect(['template', 'config']).toContain(firstName.decodeText());

    // Locate the template stream and prove it round-trips.
    let templateXml = '';
    for (let i = 0; i < xfa.size(); i += 2) {
      if (xfa.lookup(i, PDFString).decodeText() !== 'template') continue;
      const stream = doc.context.lookup(xfa.get(i + 1));
      if (stream instanceof PDFRawStream) {
        templateXml = new TextDecoder().decode(decodePDFRawStream(stream).decode());
      }
    }
    expect(templateXml).toContain('<template');
    expect(templateXml).toContain('subform');
  });
});
