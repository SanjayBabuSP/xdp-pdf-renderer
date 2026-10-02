import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../helpers/pdf-content';

/**
 * G7 end-to-end: `<choiceList>`, `<ui><button>` and `<ui><signature>` must
 * render their widget semantics — not the raw bound value.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="month" minOccurs="0"/>
        <xs:element type="xs:string" name="sig" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
        <medium stock="a4" short="210mm" long="297mm"/>
      </pageArea></pageSet>
      <subform name="content" layout="tb">
        <field name="month" x="0" y="0" w="120pt" h="16pt">
          <ui>
            <choiceList>
              <items save="1" presence="visible">
                <text value="M">March</text>
                <text value="A">April</text>
              </items>
            </choiceList>
          </ui>
          <bind match="dataRef" ref="$.month"/>
        </field>
        <field name="okBtn" x="0" y="30pt" w="80pt" h="20pt">
          <ui><button><label>Submit</label></button></ui>
          <value><text>IGNORED</text></value>
        </field>
        <field name="sig" x="0" y="60pt" w="120pt" h="30pt">
          <ui><signature/></ui>
          <bind match="dataRef" ref="$.sig"/>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><month>M</month><sig>LEAK</sig></value>`;

async function renderText(): Promise<string> {
  const result = await renderFormToPdf(XDP, XSD, DATA, {});
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return extractText(await contentStream(result.data)).join(' ');
}

describe('G7 — choiceList / button / signature rendering', () => {
  it('renders the choice item display text, not its export value', async () => {
    const text = await renderText();
    expect(text).toContain('March');
    expect(text).not.toMatch(/(^|\s)M(\s|$)/);
  });

  it('renders the button label', async () => {
    const text = await renderText();
    expect(text).toContain('Submit');
    expect(text).not.toContain('IGNORED');
  });

  it('does not render the bound value of a signature field', async () => {
    const text = await renderText();
    expect(text).not.toContain('LEAK');
  });
});
