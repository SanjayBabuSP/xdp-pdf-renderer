import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

/**
 * G18 — Adobe metadata parity: the XDP's `x:xmpmeta` / `<desc>` metadata and
 * Adobe's driver block (XMP stream, Info dict, ViewerPreferences/DisplayDocTitle,
 * /NeedsRendering) reach the output PDF.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence><xs:element type="xs:string" name="Name" minOccurs="0"/></xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title><rdf:Alt><rdf:li>Service Request Form</rdf:li></rdf:Alt></dc:title>
        <dc:creator><rdf:Seq><rdf:li>Operations</rdf:li></rdf:Seq></dc:creator>
        <dc:description><rdf:Alt><rdf:li>Print and submit</rdf:li></rdf:Alt></dc:description>
      </rdf:Description>
    </rdf:RDF>
  </x:xmpmeta>
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

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Name>Alice</Name></value>`;

async function render(adobe: Record<string, unknown> = {}) {
  const result = await renderFormToPdf(XDP, XSD, DATA, { adobe });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return PDFDocument.load(result.data, { ignoreEncryption: true, updateMetadata: false });
}

describe('G18 — XMP metadata block', () => {
  it('writes the XMP packet with dc:title, Producer and DocumentID', async () => {
    const doc = await render();
    const ref = doc.catalog.get(PDFName.of('Metadata'));
    expect(ref).toBeDefined();
    const stream = doc.context.lookup(ref!) as PDFRawStream;
    const xml = new TextDecoder().decode(decodePDFRawStream(stream).decode());

    expect(xml).toContain('<?xpacket');
    expect(xml).toContain('<x:xmpmeta');
    expect(xml).toContain('<dc:title>');
    expect(xml).toContain('Service Request Form');
    expect(xml).toContain('<dc:creator>');
    expect(xml).toContain('Operations');
    expect(xml).toContain('pdf:Producer');
    expect(xml).toContain('xmpMM:DocumentID>uuid:');
    expect(xml).toContain('xmp:MetadataDate>');
    expect(xml).toContain('<?xpacket end="w"?>');
  });

  it('mirrors the metadata into the Info dict', async () => {
    const doc = await render();
    expect(doc.getTitle()).toBe('Service Request Form');
    expect(doc.getAuthor()).toBe('Operations');
    expect(doc.getProducer()).toContain('xdp-pdf-renderer');
  });

  it('honours producer / creatorTool overrides', async () => {
    const doc = await render({
      metadata: { producer: 'My Pipeline', creatorTool: 'My Tool' },
    });
    expect(doc.getProducer()).toBe('My Pipeline');
    expect(doc.getCreator()).toBe('My Tool');
  });
});

describe('G18 — ViewerPreferences / NeedsRendering', () => {
  it('sets /DisplayDocTitle true when a title is present', async () => {
    const doc = await render();
    const prefs = doc.context.lookup(doc.catalog.get(PDFName.of('ViewerPreferences'))) as PDFDict;
    expect(prefs.get(PDFName.of('DisplayDocTitle'))?.toString()).toBe('true');
  });

  it('writes /NeedsRendering for dynamic (AcroForm) output', async () => {
    const doc = await render({ acroForm: true });
    expect(doc.catalog.get(PDFName.of('NeedsRendering'))?.toString()).toBe('true');
  });

  it('omits ViewerPreferences when no title is derived', async () => {
    const bare = XDP.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/, '');
    const result = await renderFormToPdf(bare, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) return;
    const doc = await PDFDocument.load(result.data, { ignoreEncryption: true, updateMetadata: false });
    expect(doc.catalog.get(PDFName.of('ViewerPreferences'))).toBeUndefined();
    expect(doc.getTitle()).toBeUndefined();
  });
});
