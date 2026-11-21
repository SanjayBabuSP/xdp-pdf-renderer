import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="v" minOccurs="0"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>x</v></value>`;

function xdp(topInset: string, bottomInset: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform x="50" y="100" layout="position">
        <draw x="50" y="100" w="40" h="10" rotate="90">
          <value><text>LABEL</text></value>
          <font typeface="Helvetica" size="6.5pt"/>
          <para vAlign="middle" hAlign="center"/>
          <margin topInset="${topInset}" bottomInset="${bottomInset}" leftInset="1mm" rightInset="1mm"/>
          <border><edge thickness="1pt"/></border>
        </draw>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

function textY(content: string): number[] {
  return [...content.matchAll(/([-\d.]+) ([-\d.]+) Tm/g)].map((m) => Number(m[2]));
}

async function renderY(topInset: string, bottomInset: string): Promise<number> {
  const result = await renderFormToPdf(xdp(topInset, bottomInset), XSD, DATA, {});
  if (!result.success) throw new Error(result.error.message);
  const content = await contentStream(result.data);
  const ys = textY(content);
  expect(ys.length).toBe(1);
  return ys[0];
}

describe('rotated text margin axis', () => {
  it('does not move the rotated baseline when the bottom inset changes', async () => {
    const small = await renderY('1mm', '1mm');
    const large = await renderY('1mm', '5mm');
    expect(large).toBeCloseTo(small, 3);
  });

  it('insets the rotated baseline by the top margin', async () => {
    const small = await renderY('1mm', '1mm');
    const large = await renderY('5mm', '1mm');
    expect(small - large).toBeCloseTo(4 * (72 / 25.4), 2);
  });
});
