import { PDFDocument } from 'pdf-lib';
import { FontManager } from '../../../src/rendering/font-manager';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';
/**
 * G16 — `font-sequences.ts` fallback chains: a family with no embedded face and
 * no base-14 counterpart should follow its Adobe `<seq>` chain (here to Times)
 * instead of dropping straight to the bundled Unicode font.
 */
describe('G16 — FontManager font-sequence fallback', () => {
  it('resolves a serif family through its sequence to a base-14 font', async () => {
    const doc = await PDFDocument.create();
    const manager = new FontManager(doc);

    const garamond = await manager.getFont('Garamond');
    const times = await manager.getFont('Times New Roman');
    expect(garamond.name).toBe(times.name);
    expect(garamond.name).toContain('Times');
  });

  it('does not change families that already resolve directly', async () => {
    const doc = await PDFDocument.create();
    const manager = new FontManager(doc);
    const helvetica = await manager.getFont('Helvetica');
    expect(helvetica.name).toContain('Helvetica');
  });

  it('resolves SimSun-ExtB through its sequence to an embedded CJK face', async () => {
    const doc = await PDFDocument.create();
    const manager = new FontManager(doc);

    // Sequence lands on the bundled Adobe Song face, not the DejaVu fallback
    // (DejaVu has no CJK glyphs, so the old path produced tofu boxes).
    expect((await manager.getFont('SimSun-ExtB')).name).toBe('AdobeSongStd-Light');
    expect((await manager.getFont('SimSun')).name).toBe('AdobeSongStd-Light');
    expect((await manager.getFont('NoSuchFontXYZ')).name).toBe('DejaVuSans');
  });

  it('renders CJK text with the sequenced face without failing', async () => {
    const xdp = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10" y="10" w="200pt" h="16pt">
        <ui><textEdit/></ui>
        <font typeface="SimSun-ExtB" size="10pt"/>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
    const xsd = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="v" minOccurs="0"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
    const data = `<?xml version="1.0" encoding="UTF-8"?><value><v>日本語テスト</v></value>`;
    const result = await renderFormToPdf(xdp, xsd, data, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    // A CID font resource is embedded for the CJK run (previously this path
    // embedded DejaVu, which cannot encode these code points).
    const facts = await contentStream(result.data);
    expect(facts.length).toBeGreaterThan(0);
  });
});
