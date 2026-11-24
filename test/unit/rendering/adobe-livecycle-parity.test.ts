import { PDFDocument } from 'pdf-lib';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="flag"/>
      <xs:element type="xs:string" name="v"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA_TRUE = `<?xml version="1.0" encoding="UTF-8"?><value><flag>true</flag><v>80</v></value>`;
const DATA_VALUE = `<?xml version="1.0" encoding="UTF-8"?><value><flag>false</flag><v>Value</v></value>`;

function fieldXdp(opts: {
  para?: string;
  fontSize?: string;
  script?: string;
  captionReserve?: string;
  fieldW?: string;
  fieldH?: string;
}): string {
  const para = opts.para ?? `<para vAlign="middle"/>`;
  const size = opts.fontSize ?? '6.5pt';
  const script = opts.script
    ? `<event activity="initialize"><script>${opts.script}</script></event>`
    : '';
  const reserve = opts.captionReserve ?? '56mm';
  const w = opts.fieldW ?? '96mm';
  const h = opts.fieldH ?? '4mm';
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" w="${w}" h="${h}">
        <ui><textEdit><border><edge presence="hidden"/><edge presence="hidden"/><edge thickness="0.0991mm"/><edge presence="hidden"/></border></textEdit></ui>
        <font typeface="Arial" size="${size}"><fill><color value="0,112,192"/></fill></font>
        <margin topInset="0.5mm" bottomInset="0.5mm" leftInset="0.5mm" rightInset="0.5mm"/>
        ${para}
        <caption reserve="${reserve}">
          <value><text>CAPTION:</text></value>
          <para vAlign="middle"/>
          <font typeface="Arial" weight="bold" size="${size}"/>
        </caption>
        ${script}
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
}

async function render(xdp: string, data: string): Promise<Buffer> {
  const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
  const result = await renderFormToPdf(xdp, XSD, data, {});
  if (!result.success) throw new Error(`[${result.error.code}] ${result.error.message}`);
  return result.data;
}

async function tmYs(pdf: Buffer): Promise<number[]> {
  const { contentStream } = await import('../../helpers/pdf-content');
  const content = await contentStream(pdf);
  return [...content.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm/g)].map((m) => Number(m[2]));
}

describe('gap 2 — script-driven fillColor/fontColor (Adobe: blue bg + white text)', () => {
  const condScript = `if (flag == "true") then
    $.fillColor = "0,112,192"
    $.fontColor = "255,255,255"
endif`;
  const condScriptRecord = `if (xfa.record.flag.value == "true") then
    $.fillColor = "0,112,192"
    $.fontColor = "255,255,255"
endif`;

  it('FormCalc $.fillColor paints the field background blue', async () => {
    const pdf = await render(fieldXdp({ script: condScript }), DATA_TRUE);
    const { contentStream } = await import('../../helpers/pdf-content');
    const content = await contentStream(pdf);
    expect(content).toMatch(/0(\.0+)? 0\.4392\d* 0\.7529\d* rg/);
    expect(content).toMatch(/\bre\b[\s\S]*\bf\b/);
  });

  it('FormCalc $.fontColor paints the value text white', async () => {
    const pdf = await render(fieldXdp({ script: condScript }), DATA_TRUE);
    const { contentStream } = await import('../../helpers/pdf-content');
    const content = await contentStream(pdf);
    expect(content).toMatch(/(^|\n)1 g(\n|$)|1 1 1 rg/);
  });

  it('leaves the field unfilled when the condition is false (Adobe parity)', async () => {
    const pdf = await render(fieldXdp({ script: condScript }), DATA_VALUE);
    const { contentStream } = await import('../../helpers/pdf-content');
    const content = await contentStream(pdf);
    expect(content).not.toMatch(/0(\.0+)? 0\.4392\d* 0\.7529\d* rg[\s\S]*\bre\b/);
  });

  it('JS $.fillColor/$.fontColor also reach the renderer', async () => {
    const jsXdp = fieldXdp({}).replace(
      '</field>',
      `<event activity="initialize"><script contentType="application/x-javascript">if (xfa.record.flag.value == "true") { $.fillColor = "0,112,192"; $.fontColor = "255,255,255"; }</script></event></field>`
    );
    const pdf = await render(jsXdp, DATA_TRUE);
    const { contentStream } = await import('../../helpers/pdf-content');
    const content = await contentStream(pdf);
    expect(content).toMatch(/0(\.0+)? 0\.4392\d* 0\.7529\d* rg/);
    expect(content).toMatch(/(^|\n)1 g(\n|$)|1 1 1 rg/);
  });

  it('FormCalc xfa.record.flag resolves through the data record (Adobe SOM)', async () => {
    const pdf = await render(fieldXdp({ script: condScriptRecord }), DATA_TRUE);
    const { contentStream } = await import('../../helpers/pdf-content');
    const content = await contentStream(pdf);
    expect(content).toMatch(/(^|\n)1 g(\n|$)|1 1 1 rg/);
  });
});

describe('gap 3a — caption/value share one baseline for vAlign="middle"', () => {
  it('middle-aligned caption and value use the same baseline', async () => {
    const pdf = await render(fieldXdp({}), DATA_VALUE);
    const ys = await tmYs(pdf);
    expect(ys.length).toBeGreaterThanOrEqual(2);
    const uniq = new Set(ys.map((y) => y.toFixed(2)));
    expect(uniq.size).toBe(1);
  });
});

describe('gap 1 — large lineHeight must not hide single-line text (Adobe shows it)', () => {
  function drawXdp(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="d" w="56mm" h="4mm">
        <font typeface="Arial" size="6.5pt"/>
        <para lineHeight="16.8pt" vAlign="middle"/>
        <value><text>Single line label:</text></value>
        <margin leftInset="0.5mm" rightInset="0.5mm" topInset="0.5mm" bottomInset="0.5mm"/>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
  }

  it('does not clip away the glyphs when lineHeight exceeds the box', async () => {
    const pdf = await render(drawXdp(), DATA_VALUE);
    const { contentStream, pageText } = await import('../../helpers/pdf-content');
    const { fontAscent } = await import('../../../src/rendering/text/line-metrics');
    const content = await contentStream(pdf);
    expect(await pageText(pdf)).toMatch(/Single line label:/);
    const clip = [...content.matchAll(/([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) re\s+W\s+n/g)].map(
      (m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
        w: Number(m[3]),
        h: Number(m[4]),
      })
    );
    const ys = await tmYs(pdf);
    expect(clip.length).toBeGreaterThan(0);
    expect(ys.length).toBeGreaterThan(0);
    const ascent = 0.793 * 6.5;
    const c = clip[0];
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(c.y - 0.5);
      expect(y + ascent).toBeLessThanOrEqual(c.y + c.h + 0.5);
    }
  });

  it('layoutLines centres single-line middle on the glyphs, not the line box', async () => {
    const { layoutLines, fontAscent } = await import('../../../src/rendering/text/line-metrics');
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const size = 10;
    const box = { top: 200, bottom: 180 };
    const normal = layoutLines(1, size, box, 'middle', font, { lineAdvance: 12 }).baselines[0];
    const huge = layoutLines(1, size, box, 'middle', font, { lineAdvance: 40 }).baselines[0];
    const ascent = fontAscent(font, size);
    expect(Math.abs(huge - normal)).toBeLessThan(2);
    expect(normal).toBeGreaterThan(box.bottom);
    expect(normal).toBeLessThan(box.top);
    expect(huge).toBeGreaterThan(box.bottom);
    expect(huge).toBeLessThan(box.top);
    expect(box.top - normal).toBeGreaterThan(ascent - 2);
  });
});

describe('gap 5 — master-page widgets use authored minW/minH and flow layout', () => {
  const masterXdp = (flow: boolean) => `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
        <subform name="master" layout="${flow ? 'tb' : 'position'}"${flow ? ' x="40pt" y="300pt"' : ''}>
          <field name="wm"${flow ? '' : ' x="40pt" y="300pt"'} minW="300pt" minH="90pt">
            <ui><textEdit/></ui>
            <font typeface="Helvetica" size="40pt"/>
            <para vAlign="middle" hAlign="center"/>
            <caption reserve="290pt">
              <value><text>WATERMARK</text></value>
              <font typeface="Helvetica-Bold" size="40pt"/>
              <para vAlign="middle" hAlign="center"/>
            </caption>
          </field>
        </subform>
      </pageArea></pageSet>
    </subform>
  </template>
</xdp:xdp>`;

  for (const flow of [false, true]) {
    it(`renders the full caption when minW/minH replaces w/h (flow=${flow})`, async () => {
      const pdf = await render(masterXdp(flow), DATA_VALUE);
      const { contentStream } = await import('../../helpers/pdf-content');
      const content = (await contentStream(pdf)).toString('latin1');
      const runs = [...content.matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) => m[1].length);
      expect(runs.some((n) => n >= 9 * 4)).toBe(true);
    });
  }
});

describe('gap 4 — rotate=90 authored y is the visual bottom edge', () => {
  const rotationXdp = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="panel" layout="position">
        <draw name="rot" x="50pt" y="148.3pt" w="49.3pt" h="14.8pt" rotate="90">
          <ui><textEdit/></ui>
          <value><text>ROTATED LABEL</text></value>
          <font typeface="Helvetica" size="6pt"/>
          <para vAlign="middle" hAlign="center"/>
        </draw>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

  it('places an authored rotate=90 box one width above its authored y', async () => {
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const { calculatePositions } = await import('../../../src/domain/layout/calculate-positions');
    const parsed = parseXdp(rotationXdp, { strict: false });
    if (!parsed.success) throw new Error('parse failed');
    const laid = calculatePositions(parsed.data);
    if (!laid.success) throw new Error('layout failed');
    const draw = (laid.data.children[0] as any).children[0] as any;
    expect(draw.position.y).toBeCloseTo(36 + 148.3 - 49.3, 1);
  });
});

describe('gap 3b — lr-row children honour vAlign="middle"', () => {
  it('centres a short middle-aligned child inside a taller line', async () => {
    const { layoutFlowSubform } = await import('../../../src/domain/layout/flow-engine');
    const mkField = (h: number, vAlign?: string): any => ({
      type: 'field',
      name: `f${h}`,
      position: { w: 100, h },
      para: vAlign ? { vAlign } : undefined,
    });
    const tall = mkField(30);
    const short = mkField(10, 'middle');
    const node: any = {
      type: 'subform',
      layout: 'lr-tb',
      children: [tall, short],
      position: { w: 300 },
    };
    let n = 0;
    const layoutChild = (child: any, ctx: any): any => {
      n++;
      return {
        node: { ...child, position: { ...child.position, x: ctx.x, y: ctx.y } },
        height: child.position.h,
      };
    };
    const result = layoutFlowSubform(
      node,
      { x: 0, y: 0, availableWidth: 300 },
      'lr',
      layoutChild as any
    );
    const placed = (result.node as any).children;
    expect(placed[1].position.y).toBeCloseTo(10, 6);
  });
});
