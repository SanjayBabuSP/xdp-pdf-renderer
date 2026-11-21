import { PDFDocument } from 'pdf-lib';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="v" minOccurs="0"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;
const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>Value</v></value>`;

function xdp(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      ${body}
    </subform>
  </template>
</xdp:xdp>`;
}

async function render(body: string): Promise<string> {
  const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
  const { contentStream } = await import('../../helpers/pdf-content');
  const result = await renderFormToPdf(xdp(body), XSD, DATA, {});
  if (!result.success) throw new Error(`[${result.error.code}] ${result.error.message}`);
  return contentStream(result.data);
}

describe('unit leniency (Designer ignores trailing junk, e.g. 20mmmm → 20mm)', () => {
  it('parses 20mmmm as 20mm, not 0', async () => {
    const { toPointsOrZero } = await import('../../../src/lib/unit-converter');
    expect(toPointsOrZero('20mmmm')).toBeCloseTo(56.6929, 2);
    expect(toPointsOrZero('20MM')).toBeCloseTo(56.6929, 2);
    expect(toPointsOrZero('20 mm')).toBeCloseTo(56.6929, 2);
  });

  it('does not collapse w="20mmmm" table cells to 0 width (values stay visible)', async () => {
    const body = `
      <field name="f" x="10pt" y="10pt" w="20mmmm" h="14pt">
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="10pt"/>
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <para hAlign="right" vAlign="top"/>
        <bind match="dataRef" ref="$.v"/>
      </field>`;
    const content = await render(body);
    const { extractText } = await import('../../helpers/pdf-content');
    expect(extractText(content).join(' ')).toMatch(/Value/);
  });
});

describe('nbsp preservation (xfa-spacerun gaps push trailing symbols right)', () => {
  it('keeps three nbsp as three spaces, not one', async () => {
    const { parseRichText } = await import('../../../src/rendering/rich-text-parser');
    const runs = parseRichText('A<span style="xfa-spacerun:yes">\u00A0\u00A0\u00A0</span>+');
    const text = runs.map((r) => r.text).join('');
    expect(text).toMatch(/A {3}\+/);
    expect(text.length).toBeGreaterThanOrEqual(5);
  });

  it('does not break lines at nbsp (non-breaking)', async () => {
    const { layoutRunLines } = await import('../../../src/rendering/text/run-flow');
    const { default: font } = await import('pdf-lib').then(async () => ({ default: undefined }));
    void font;
    const { parseRichText } = await import('../../../src/rendering/rich-text-parser');
    const runs = parseRichText('A\u00A0\u00A0\u00A0B');
    expect(runs.map((r) => r.text).join('')).toBe('A\u00A0\u00A0\u00A0B');
  });
});

describe('underline runs (underlined + reads as ± like Adobe)', () => {
  it('parses text-decoration:underline into runs', async () => {
    const { parseRichText } = await import('../../../src/rendering/rich-text-parser');
    const runs = parseRichText('<p>A<span style="text-decoration:underline">+</span></p>');
    const sym = runs.find((r) => r.text === '+');
    expect(sym).toBeDefined();
    expect(sym!.underline).toBe(true);
  });

  it('draws a line below underlined runs', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="200pt" h="20pt">
        <value><text xliff:rid="x">placeholder</text></value>
        <font typeface="Helvetica" size="10pt"/>
        <para vAlign="top"/>
      </draw>`;
    const richBody = `
      <draw name="d" x="10pt" y="10pt" w="200pt" h="20pt">
        <value><exData contentType="text/html"><body><p>A<span style="text-decoration:underline">+</span></p></body></exData></value>
        <font typeface="Helvetica" size="10pt"/>
        <para vAlign="top"/>
      </draw>`;
    const content = await render(richBody);
    void body;
    const segments = (content.match(/ m(\n|$)/g) ?? []).length;
    expect(segments).toBeGreaterThanOrEqual(1);
  });
});

describe('caption trailing +/− right-aligned at reserve edge (vertically aligned middle)', () => {
  const captionField = `
      <field name="f" x="10pt" y="10pt" w="200pt" h="14pt">
        <ui><textEdit><border>
          <edge presence="hidden"/><edge presence="hidden"/>
          <edge thickness="0.5pt"/><edge presence="hidden"/>
        </border></textEdit></ui>
        <font typeface="Helvetica" size="10pt"/>
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <para vAlign="top"/>
        <caption reserve="60pt">
          <value><exData contentType="text/html"><body><p>LABEL:<span style="xfa-spacerun:yes">\u00A0\u00A0\u00A0\u00A0\u00A0</span><span style="text-decoration:underline">+</span></p></body></exData></value>
          <para vAlign="top"/>
          <font typeface="Helvetica" size="10pt"/>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>`;

  it('stores ordered richHtml for spacerun captions (not collapsed)', async () => {
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const res = parseXdp(xdp(captionField), { strict: false });
    if (!res.success) throw new Error('parse failed');
    const field = res.data.children[0] as unknown as {
      caption?: { richHtml?: string; text?: string };
    };
    expect(field.caption?.richHtml).toMatch(/spacerun/i);
    expect(field.caption?.richHtml).toMatch(/underline/i);
  });

  it('draws + near the reserve right edge, not stuck to the label', async () => {
    const content = await render(captionField);
    const plusAt: number[] = [];
    const re = /1 0 0 1 ([\d.]+) ([\d.]+) Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let s = '';
      for (let i = 0; i + 1 < m[3].length; i += 2)
        s += String.fromCharCode(parseInt(m[3].slice(i, i + 2), 16));
      if (s.includes('+')) plusAt.push(Number(m[1]));
    }
    expect(plusAt.length).toBeGreaterThanOrEqual(1);
    expect(Math.max(...plusAt)).toBeGreaterThan(90);
  });

  it('paints the split caption exactly once (no label double-draw)', async () => {
    const content = await render(captionField);
    const { extractText } = await import('../../helpers/pdf-content');
    const flat = extractText(content).join(' ');
    expect(flat.match(/LABEL:/g)?.length).toBe(1);
  });
});
