import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, pageText } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
    <xs:element type="xs:string" name="v" minOccurs="0"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;

const LONG = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const URL = 'www.example.com/805ee9e4';

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>x</v></value>`;

function drawXdp(height: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="paragraph" x="10pt" y="10pt" w="120pt" h="${height}">
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="10pt"/>
        <value><text>${LONG}</text></value>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
}

function urlDrawXdp(heightAttribute: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="url" x="10pt" y="10pt" w="70pt" ${heightAttribute}>
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="6.5pt"/>
        <para vAlign="middle"/>
        <value><text>${URL}</text></value>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
}

function richDrawXdp(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="paragraph" x="10pt" y="10pt" w="120pt" h="90pt">
        <value><exData contentType="text/html"><body style="font-size:12pt"><p>${LONG}</p></body></exData></value>
        <font typeface="Helvetica"/>
        <para vAlign="top"/>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
}

function drawnYs(content: string): number[] {
  const re = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
  const ys: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const y = Number(m[1]);
    if (ys.length === 0 || Math.abs(ys[ys.length - 1] - y) > 0.001) ys.push(y);
  }
  return ys;
}

describe('draw text wrapping', () => {
  it('wraps a textEdit draw into multiple lines when two lines fit', async () => {
    const result = await renderFormToPdf(drawXdp('60pt'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBeGreaterThan(1);
    expect(await pageText(result.data)).toContain('alpha');
  });

  it('wraps into multiple runs when the draw is too short for two lines', async () => {
    const result = await renderFormToPdf(drawXdp('15pt'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const tjCount = (content.match(/\bT[jJ]\b/g) ?? []).length;
    expect(tjCount).toBeGreaterThan(1);
    expect(await pageText(result.data)).toContain('alpha');
  });

  it('wraps an authored one-line URL draw at its break opportunity', async () => {
    const result = await renderFormToPdf(urlDrawXdp('minH="8.86pt"'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect((content.match(/\bT[jJ]\b/g) ?? []).length).toBe(2);
    expect(content).toMatch(/re\nW\nn\n/);
    const text = await pageText(result.data);
    expect(text).toContain('www.example.com/');
    expect(text).toContain('805ee9e4');
  });

  it('still wraps a URL when the authored box fits two lines', async () => {
    const result = await renderFormToPdf(urlDrawXdp('h="30pt"'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    expect(drawnYs(await contentStream(result.data)).length).toBe(2);
  });

  it('wraps a CSS-sized rich draw with a 14.4pt line advance', async () => {
    const result = await renderFormToPdf(richDrawXdp(), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const ys = drawnYs(await contentStream(result.data));
    expect(ys.length).toBeGreaterThan(1);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i - 1] - ys[i]).toBeCloseTo(14.4, 1);
    }
  });
});
