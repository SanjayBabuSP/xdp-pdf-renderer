import { render } from '../../../src/index';
import { contentStream, extractText } from '../../helpers/pdf-content';

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="form" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="770"/>
        <medium stock="a4" short="595" long="842"/>
      </pageArea></pageSet>
      <subform name="content" layout="tb">
        <draw x="10mm" y="10mm" w="100mm" h="10mm" name="label">
          <value><text>one  two</text></value>
          <font typeface="Helvetica" size="10pt"/>
        </draw>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="name"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><name>x</name></value>`;

describe('plain draw text', () => {
  it('preserves internal spaces', async () => {
    const result = await render({ xdp: XDP, xsd: XSD, data: DATA });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const text = extractText(await contentStream(result.data)).join('');
    expect(text).toBe('one  two');
  });
});
