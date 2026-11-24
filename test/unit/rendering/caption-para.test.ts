import { parseCaption } from '../../../src/domain/parsing/parse-xdp/helpers';
import { parseXml } from '../../../src/lib/xml-utils';
import { captionTrailingSymbol } from '../../../src/rendering/pdf-renderer/helpers';
import { paraMetrics } from '../../../src/rendering/text/line-metrics';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

function captionElement(xml: string): unknown {
  const parsed = parseXml(`<root>${xml}</root>`);
  return (parsed.root as Record<string, unknown>).caption;
}

describe('caption <para> metrics', () => {
  it('parses caption <para> attributes through parsePara', () => {
    const caption = parseCaption(
      captionElement(`
        <caption placement="top" reserve="20pt">
          <value><text>Label</text></value>
          <para vAlign="top" hAlign="center" lineHeight="14pt"
                spaceAbove="1pt" spaceBelow="2pt" marginLeft="17.008pt" marginRight="3pt"/>
        </caption>`)
    );
    expect(caption?.para).toEqual({
      vAlign: 'top',
      hAlign: 'center',
      lineHeight: 14,
      spaceAbove: 1,
      spaceBelow: 2,
      textIndent: undefined,
      marginLeft: 17.008,
      marginRight: 3,
    });
  });

  it('feeds the parsed caption margins into paragraph metrics', () => {
    const caption = parseCaption(
      captionElement(`
        <caption placement="left">
          <value><text>Label</text></value>
          <para marginLeft="17.008pt" marginRight="4pt" lineHeight="12pt"/>
        </caption>`)
    );
    const pm = paraMetrics(caption?.para, 10);
    expect(pm.marginLeft).toBeCloseTo(17.008, 6);
    expect(pm.marginRight).toBe(4);
    expect(pm.lineAdvance).toBe(12);
  });

  it('leaves para undefined when the caption has no <para>', () => {
    const caption = parseCaption(
      captionElement('<caption><value><text>Label</text></value></caption>')
    );
    expect(caption?.text).toBe('Label');
    expect(caption?.para).toBeUndefined();
  });

  it('offsets the painted caption by its paragraph marginLeft', async () => {
    const xdp = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="form" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10pt" y="10pt" w="200pt" h="20pt">
        <ui><textEdit/></ui>
        <font typeface="Arial" size="10pt"/>
        <para vAlign="middle"/>
        <caption reserve="100pt">
          <value><text>Label</text></value>
          <para marginLeft="17pt" vAlign="middle"/>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
    const xsd = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="form"><xs:complexType><xs:sequence>
    <xs:element name="v" type="xs:string"/>
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
    const data = `<?xml version="1.0"?><form><v>Value</v></form>`;
    const result = await renderFormToPdf(xdp, xsd, data, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    const content = await contentStream(result.data);
    const xs = [...content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
    expect(xs.some((value) => Math.abs(value - 53) < 0.2)).toBe(true);
  });
});

describe('captionTrailingSymbol spacer capture', () => {
  const richHtml =
    '<span style="xfa-spacerun:yes">\u00A0\u00A0\u00A0</span><span style="text-decoration:underline">+</span>';

  it('returns the spacer between the label and the underlined symbol', () => {
    expect(captionTrailingSymbol('LABEL:\u00A0\u00A0\u00A0+', richHtml)).toEqual({
      label: 'LABEL:',
      spacer: '\u00A0\u00A0\u00A0',
      symbol: '+',
      underline: true,
    });
  });

  it('returns an empty spacer when no whitespace precedes the symbol', () => {
    expect(captionTrailingSymbol('LABEL:+', richHtml)?.spacer).toBe('');
  });

  it('returns undefined when no spacerun run is present', () => {
    expect(captionTrailingSymbol('LABEL:+', '<span>+</span>')).toBeUndefined();
  });
});
