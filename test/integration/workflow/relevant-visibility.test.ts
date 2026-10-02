import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../helpers/pdf-content';

/**
 * G2 end-to-end: `@relevant` must actually keep content out of the PDF.
 * Before this, `relevant` was parsed (`parse-xdp.ts:183`, `:217`) but nothing
 * consumed it, so conditional forms rendered unconditionally.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="flag" minOccurs="0"/>
        <xs:element type="xs:string" name="extra" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

function xdp(relevant: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
        <medium stock="a4" short="210mm" long="297mm"/>
      </pageArea></pageSet>
      <subform name="content" layout="tb">
        <field name="flag" x="0" y="0" w="80pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.flag"/>
        </field>
        <field name="extra" x="0" y="30pt" w="80pt" h="14pt" relevant='${relevant}'>
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.extra"/>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

const YES = `<?xml version="1.0" encoding="UTF-8"?><value><flag>yes</flag><extra>EXTRA</extra></value>`;
const NO = `<?xml version="1.0" encoding="UTF-8"?><value><flag>no</flag><extra>EXTRA</extra></value>`;

async function render(relevant: string, data: string): Promise<string[]> {
  const result = await renderFormToPdf(xdp(relevant), XSD, data, {});
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return extractText(await contentStream(result.data));
}

describe('G2 — @relevant reaches the PDF', () => {
  it('renders the conditional field when the expression is true', async () => {
    const text = await render('flag.rawValue == "yes"', YES);
    expect(text.join(' ')).toContain('EXTRA');
    expect(text.join(' ')).toContain('yes');
  });

  it('omits the conditional field when the expression is false', async () => {
    const text = await render('flag.rawValue == "yes"', NO);
    expect(text.join(' ')).not.toContain('EXTRA');
    expect(text.join(' ')).toContain('no');
  });

  it('still renders everything when no @relevant is present', async () => {
    const result = await renderFormToPdf(xdp(''), XSD, YES, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('render failed');
    const text = extractText(await contentStream(result.data)).join(' ');
    expect(text).toContain('EXTRA');
    expect(text).toContain('yes');
  });
});
