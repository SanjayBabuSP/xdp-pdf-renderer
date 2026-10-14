import { renderFormToPdf } from '../../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="v1" minOccurs="0"/>
    <xs:element type="xs:string" name="v2" minOccurs="0"/>
    <xs:element type="xs:string" name="v3" minOccurs="0"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v1>shown one</v1><v2>hidden two</v2><v3>shown three</v3></value>`;

// ADS parity brief §5.1: presence-hidden content must emit no text run and
// take no space — not even inside tables, where row engines walk children
// directly and could bypass the top-level filter.
const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="t" layout="table">
        <subform name="row1" layout="row">
          <field name="a" w="100pt" h="16pt"><ui><textEdit/></ui>
            <font typeface="Helvetica" size="10pt"/><bind match="dataRef" ref="$.v1"/></field>
        </subform>
        <subform name="hiddenRow" layout="row" presence="hidden">
          <field name="b" w="100pt" h="16pt"><ui><textEdit/></ui>
            <font typeface="Helvetica" size="10pt"/><bind match="dataRef" ref="$.v2"/></field>
        </subform>
        <subform name="row3" layout="row">
          <field name="c" w="100pt" h="16pt"><ui><textEdit/></ui>
            <font typeface="Helvetica" size="10pt"/><bind match="dataRef" ref="$.v3"/></field>
        </subform>
      </subform>
      <subform name="hiddenBlock" presence="hidden" layout="tb">
        <field name="d" w="100pt" h="16pt"><ui><textEdit/></ui>
          <font typeface="Helvetica" size="10pt"/><value><text>hidden static</text></value></field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

describe('presence-hidden content inside tables emits nothing', () => {
  it('draws visible rows only; hidden row/block leave no runs', async () => {
    const result = await renderFormToPdf(XDP, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const drawn = extractText(await contentStream(result.data)).join('\n');
    expect(drawn).toContain('shown one');
    expect(drawn).toContain('shown three');
    expect(drawn).not.toContain('hidden two');
    expect(drawn).not.toContain('hidden static');
  });
});
