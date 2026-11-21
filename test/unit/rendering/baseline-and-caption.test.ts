import { PDFDocument } from 'pdf-lib';
import {
  layoutLines,
  fontAscent,
  fontDescent,
  defaultAscent,
  DEFAULT_LINE_ADVANCE_FACTOR,
} from '../../../src/rendering/text/line-metrics';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="v"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>Value</v></value>`;

function xdp(opts: { placement?: string; reserve?: string; valueW?: string } = {}): string {
  const placement = opts.placement ?? 'left';
  const reserve = opts.reserve ?? '40pt';
  const valueW = opts.valueW ?? '60pt';
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10" y="10" w="200pt" h="20pt">
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="10pt"/>
        <caption reserve="${reserve}">
          <font typeface="Helvetica" size="10pt"/>
          <value><text>A very long caption that will not fit in the reserved strip</text></value>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('line metrics — one ascent-based model', () => {
  it('places the first baseline exactly one ascent below the box top', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const size = 10;
    const box = { top: 200, bottom: 180 };
    const { baselines } = layoutLines(1, size, box, 'top', font);
    expect(box.top - baselines[0]).toBeCloseTo(fontAscent(font, size), 6);
  });

  it('steps each subsequent line by the line advance', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const size = 10;
    const { baselines } = layoutLines(4, size, { top: 200, bottom: 100 }, 'top', font);
    for (let i = 1; i < baselines.length; i++) {
      expect(baselines[i - 1] - baselines[i]).toBeCloseTo(size * DEFAULT_LINE_ADVANCE_FACTOR, 6);
    }
  });

  it('centres and bottom-aligns within the box', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const size = 10;
    const box = { top: 200, bottom: 180 };
    const top = layoutLines(1, size, box, 'top', font).baselines[0];
    const bottom = layoutLines(1, size, box, 'bottom', font).baselines[0];
    const middle = layoutLines(1, size, box, 'middle', font).baselines[0];
    expect(top).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(bottom);
    expect(top - middle).toBeCloseTo(middle - bottom, 6);
  });

  it('falls back to 0.8em ascent when the font exposes no metrics', () => {
    expect(fontAscent(undefined, 10)).toBeCloseTo(defaultAscent(10), 9);
    expect(fontAscent(undefined, 10)).toBeCloseTo(8, 9);
  });

  it('applies the Adobe max(A, 1-D) clamp (Helvetica sums to 1.0 em, not AFM 0.925)', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const size = 10;
    const ascent = fontAscent(font, size);
    const descent = fontDescent(font, size);
    expect(ascent + descent).toBeCloseTo(10.0, 1);
    expect(descent).not.toBeCloseTo(2, 3);
  });
});

describe('caption/value collision safety', () => {
  it('clips an over-wide caption to its reserve strip instead of painting over the value', async () => {
    const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
    const { contentStream } = await import('../../helpers/pdf-content');

    const result = await renderFormToPdf(xdp({ reserve: '40pt' }), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)q(\n|$)/);
    expect(content).toMatch(/ re\s+W\s+n/);
    expect(content).toMatch(/(^|\n)Q(\n|$)/);
  });

  it('does not clip a caption that fits its reserve', async () => {
    const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
    const { contentStream } = await import('../../helpers/pdf-content');

    const wide = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10" y="10" w="200pt" h="20pt">
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="10pt"/>
        <caption reserve="60pt">
          <font typeface="Helvetica" size="10pt"/>
          <value><text>Pos.</text></value>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;

    const result = await renderFormToPdf(wide, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).not.toMatch(/ re\s+W\s+n/);
  });

  it('puts the caption and the value on a consistent baseline', async () => {
    const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
    const { contentStream } = await import('../../helpers/pdf-content');

    const result = await renderFormToPdf(xdp({ reserve: '60pt' }), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const ys = [...content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => Number(m[2]));
    expect(ys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(1);
  });
});
