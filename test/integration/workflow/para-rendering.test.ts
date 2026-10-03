import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../helpers/pdf-content';

/**
 * `<para>` paragraph metrics reach the PDF text matrix:
 *  - `lineHeight` overrides the 1.2 × size line advance,
 *  - `marginLeft` insets the text block,
 *  - `textIndent` shifts the first line of each paragraph.
 * evidence: xfa.dll atoms lineHeight/marginLeft/textIndent; jfTextAttr::Spacing
 * (jftext_disasm.c:3920) / MarginL (:2888).
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="f"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><f>aaaa bbbb</f></value>`;

function xdp(para: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet>
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200" h="260"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <field name="f" w="30pt" h="100pt">
        <ui><textEdit multiLine="1"/></ui>
        <font typeface="Helvetica" size="10pt"/>
        ${para}
        <bind match="dataRef" ref="$.f"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
}

function drawXdp(para: string, markup: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet>
        <pageArea name="Page1" id="Page1">
          <contentArea x="0" y="0" w="200" h="260"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <draw name="rich" x="0" y="0" w="200pt" h="100pt">
        <value>
          <exData contentType="text/html">${markup}</exData>
        </value>
        <font typeface="Helvetica" size="10pt"/>
        ${para}
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
}

const RICH_PARAGRAPHS =
  '&lt;body&gt;&lt;p&gt;aaaa &lt;b&gt;bbbb&lt;/b&gt; cccc&lt;/p&gt;&lt;p&gt;dddd eeee&lt;/p&gt;&lt;/body&gt;';
const RICH_SINGLE_LINE = '&lt;body&gt;&lt;p&gt;abcd&lt;/p&gt;&lt;/body&gt;';

/** Text origin (x, y) of every unrotated `Tm` in the content stream. */
function textOrigins(content: string): Array<{ x: number; y: number }> {
  const re = /1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g;
  const out: Array<{ x: number; y: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) out.push({ x: Number(m[1]), y: Number(m[2]) });
  return out;
}

describe('<para> rendering', () => {
  it('uses the default 1.2× advance without a lineHeight override', async () => {
    const result = await renderFormToPdf(xdp('<para vAlign="top"/>'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(extractText(content).join('')).toContain('aaaa');
    const origins = textOrigins(content);
    expect(origins.length).toBeGreaterThanOrEqual(2);
    // second line steps down by 1.2 × 10 = 12pt
    expect(origins[0].y - origins[1].y).toBeCloseTo(12, 1);
  });

  it('applies lineHeight, marginLeft and textIndent', async () => {
    const result = await renderFormToPdf(
      xdp('<para vAlign="top" lineHeight="30pt" marginLeft="5pt" textIndent="12pt"/>'),
      XSD,
      DATA,
      {}
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const origins = textOrigins(content);
    expect(origins.length).toBeGreaterThanOrEqual(2);
    // lineHeight steps down by 30pt (not 12pt)
    expect(origins[0].y - origins[1].y).toBeCloseTo(30, 1);
    // first line x = marginLeft(5) + textIndent(12); continuation = 5
    expect(origins[0].x).toBeCloseTo(17, 1);
    expect(origins[1].x).toBeCloseTo(5, 1);
  });

  it('applies paragraph geometry to styled rich-text runs', async () => {
    const result = await renderFormToPdf(
      drawXdp(
        '<para vAlign="top" lineHeight="30pt" marginLeft="5pt" marginRight="5pt" textIndent="12pt"/>',
        RICH_PARAGRAPHS
      ),
      XSD,
      DATA,
      {}
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(extractText(content).join(' ')).toContain('bbbb');
    const origins = textOrigins(content);
    expect(origins).toHaveLength(5);
    // Each paragraph starts at marginLeft + textIndent.
    expect(origins[0].x).toBeCloseTo(17, 1);
    expect(origins[3].x).toBeCloseTo(17, 1);
    // Styled segments stay in document order on the same baseline, then the
    // next paragraph steps by the explicit lineHeight.
    expect(origins[0].y).toBeCloseTo(origins[2].y, 3);
    expect(origins[0].y - origins[3].y).toBeCloseTo(30, 1);
  });

  it('centers a styled rich-text line between its left- and right-aligned origins', async () => {
    const renders = await Promise.all(
      (['left', 'center', 'right'] as const).map(async (hAlign) => {
        const result = await renderFormToPdf(
          drawXdp(`<para vAlign="top" hAlign="${hAlign}"/>`, RICH_SINGLE_LINE),
          XSD,
          DATA,
          {}
        );
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error.message);
        return textOrigins(await contentStream(result.data));
      })
    );
    const [left, center, right] = renders;
    expect(left).toHaveLength(1);
    expect(center).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(right[0].x).toBeGreaterThan(left[0].x);
    expect(center[0].x).toBeCloseTo((left[0].x + right[0].x) / 2, 3);
  });

  it('shifts rich-text baselines for vertical alignment without moving text horizontally', async () => {
    const renders = await Promise.all(
      (['top', 'middle'] as const).map(async (vAlign) => {
        const result = await renderFormToPdf(
          drawXdp(`<para vAlign="${vAlign}"/>`, RICH_PARAGRAPHS),
          XSD,
          DATA,
          {}
        );
        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error.message);
        return textOrigins(await contentStream(result.data));
      })
    );
    const [top, middle] = renders;
    expect(top).toHaveLength(5);
    expect(middle).toHaveLength(5);
    // Two 12pt lines in a 100pt box leave 76pt of slack; middle uses half.
    expect(top[0].y - middle[0].y).toBeCloseTo(38, 1);
    expect(middle.map((origin) => origin.x)).toEqual(top.map((origin) => origin.x));
    for (let i = 0; i < top.length; i++) {
      expect(top[i].y - middle[i].y).toBeCloseTo(38, 1);
    }
  });
});
