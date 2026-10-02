import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

/**
 * G9 end-to-end: the output PDF actually carries the standard security handler
 * (Encrypt in the trailer + /ID) and the page content is encrypted.
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
      <field name="Name" x="0" y="0" w="140pt" h="14pt">
        <ui><textEdit/></ui>
        <bind match="dataRef" ref="$.Name"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><Name>SECRETVALUE</Name></value>`;

async function render(password?: string, method?: 'rc4_40' | 'rc4_128' | 'aes_128') {
  const result = await renderFormToPdf(XDP, XSD, DATA, {
    adobe: { security: { userPassword: password ?? 'open-sesame', encryptionMethod: method } },
  });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return result.data;
}

describe('G9 — encrypted PDF output', () => {
  it('encrypts the page content (plaintext is absent from the bytes)', async () => {
    const buffer = await render();
    expect(buffer.includes(Buffer.from('SECRETVALUE'))).toBe(false);
  });

  it('places /Encrypt in the trailer with /ID', async () => {
    const buffer = await render();
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    expect(doc.context.trailerInfo.Encrypt).toBeDefined();
    expect(doc.context.trailerInfo.ID).toBeDefined();

    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt!) as PDFDict;
    expect(String(encrypt.get(PDFName.of('Filter')))).toBe('/Standard');
    expect(String(encrypt.get(PDFName.of('R')))).toBe('3');
  });

  it('supports AES-128 (V4 / AESV2)', async () => {
    const buffer = await render('pw', 'aes_128');
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt!) as PDFDict;
    expect(String(encrypt.get(PDFName.of('V')))).toBe('4');
    expect(String(encrypt.get(PDFName.of('R')))).toBe('4');
    expect(String(encrypt.get(PDFName.of('StmF')))).toBe('/StdCF');
    const cf = doc.context.lookup(encrypt.get(PDFName.of('CF'))) as PDFDict;
    const stdcf = doc.context.lookup(cf.get(PDFName.of('StdCF'))) as PDFDict;
    expect(String(stdcf.get(PDFName.of('CFM')))).toBe('/AESV2');
    expect(buffer.includes(Buffer.from('SECRETVALUE'))).toBe(false);
  });

  it('supports 40-bit RC4 (V1 / R2)', async () => {
    const buffer = await render('pw', 'rc4_40');
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const encrypt = doc.context.lookup(doc.context.trailerInfo.Encrypt!) as PDFDict;
    expect(String(encrypt.get(PDFName.of('V')))).toBe('1');
    expect(String(encrypt.get(PDFName.of('R')))).toBe('2');
  });
});
