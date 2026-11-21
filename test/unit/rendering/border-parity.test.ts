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

function hLines(content: string): Array<{ y: number; x1: number; x2: number }> {
  const out: Array<{ y: number; x1: number; x2: number }> = [];
  const re = /([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l\s+S/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const x1 = Number(m[1]);
    const y1 = Number(m[2]);
    const x2 = Number(m[3]);
    const y2 = Number(m[4]);
    if (Math.abs(y1 - y2) < 0.01 && Math.abs(x2 - x1) > 20) out.push({ y: y1, x1, x2 });
  }
  return out.sort((a, b) => b.y - a.y);
}

describe('underline under value area only (no over-extension under caption)', () => {
  const field = `
      <field name="f" x="10pt" y="10pt" w="200pt" h="14pt">
        <ui><textEdit><border>
          <edge presence="hidden"/><edge presence="hidden"/>
          <edge thickness="0.5pt"/><edge presence="hidden"/>
        </border></textEdit></ui>
        <font typeface="Helvetica" size="10pt"/>
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <para vAlign="top"/>
        <caption reserve="60pt"><value><text>CAPTION:</text></value></caption>
        <bind match="dataRef" ref="$.v"/>
      </field>`;

  it('draws a bottom-only underline from the value origin, not the field origin', async () => {
    const content = await render(field);
    const lines = hLines(content);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const bottom = lines[0];
    expect(bottom.x1).toBeGreaterThan(80);
    expect(bottom.x2 - bottom.x1).toBeLessThan(150);
  });
});

describe('outer hidden + UI visible draws the widget border (no missing lines)', () => {
  it('falls back to the UI bottom edge when the outer border is hidden', async () => {
    const body = `
      <field name="f" x="10pt" y="10pt" w="200pt" h="14pt">
        <ui><textEdit><border>
          <edge presence="hidden"/><edge presence="hidden"/>
          <edge thickness="0.5pt"/><edge presence="hidden"/>
        </border></textEdit></ui>
        <font typeface="Helvetica" size="10pt"/>
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <para vAlign="top"/>
        <border><edge presence="hidden"/></border>
        <bind match="dataRef" ref="$.v"/>
      </field>`;
    const content = await render(body);
    expect(hLines(content).length).toBeGreaterThanOrEqual(1);
  });
});

describe('tiny-gap double lines collapse to one (no 1.4pt gaps)', () => {
  it('suppresses a subform bottom edge 0.5mm below child underlines', async () => {
    const body = `
      <subform name="row" layout="tb" x="10pt" y="10pt" w="200pt">
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <border>
          <edge presence="hidden"/><edge presence="hidden"/>
          <edge thickness="0.5pt"/><edge presence="hidden"/>
        </border>
        <field name="f" w="198pt" h="14pt">
          <ui><textEdit><border>
            <edge presence="hidden"/><edge presence="hidden"/>
            <edge thickness="0.5pt"/><edge presence="hidden"/>
          </border></textEdit></ui>
          <font typeface="Helvetica" size="10pt"/>
          <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
          <para vAlign="top"/>
          <bind match="dataRef" ref="$.v"/>
        </field>
      </subform>`;
    const content = await render(body);
    const lines = hLines(content);
    expect(lines.length).toBe(1);
  });
});

describe('per-corner radii (precise boxes, hidden corners square)', () => {
  it('parses all four corners with index fallback, not just the first', async () => {
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const doc = xdp(`
      <draw name="d" x="10pt" y="10pt" w="100pt" h="50pt">
        <value><rectangle><border>
          <edge thickness="1pt"/>
          <corner radius="8pt"/>
          <corner radius="8pt" presence="hidden"/>
          <corner radius="8pt"/>
          <corner radius="8pt"/>
        </border></rectangle></value>
      </draw>`);
    const res = parseXdp(doc, { strict: false });
    if (!res.success) throw new Error('parse failed');
    const draw = res.data.children[0] as {
      value?: { shapeBorder?: { cornerRadii?: Array<number | undefined> } };
      border?: { cornerRadius?: number; cornerRadii?: Array<number | undefined> };
    };
    const radii = draw.value?.shapeBorder?.cornerRadii ?? draw.border?.cornerRadii;
    expect(radii).toBeDefined();
    expect(radii![0]).toBeCloseTo(8, 6);
    expect(radii![1]).toBeUndefined();
    expect(radii![2]).toBeCloseTo(8, 6);
  });

  it('draws a lone radius stamp square (plain re+f, zero curves)', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="5.28mm" h="40mm">
        <value><rectangle><border>
          <edge thickness="1pt"/>
          <fill><color value="192,192,192"/></fill>
          <corner radius="5.08mm"/>
        </border></rectangle></value>
      </draw>`;
    const content = await render(body);
    expect(content).toMatch(/[\d.]+ [\d.]+ [\d.]+ [\d.]+ re(\n|$)/);
    expect(content).toMatch(/(^|\n)f(\n|$)/);
    expect(content.match(/ c\n/g) ?? []).toHaveLength(0);
  });

  it('draws a hidden corner square (no bezier on that corner)', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="100pt" h="50pt">
        <value><rectangle><border>
          <edge thickness="1pt"/>
          <corner radius="8pt"/>
          <corner radius="8pt" presence="hidden"/>
          <corner radius="8pt"/>
          <corner radius="8pt"/>
        </border></rectangle></value>
      </draw>`;
    const content = await render(body);
    const curves = (content.match(/ c\n/g) ?? []).length;
    expect(curves).toBeLessThan(8);
    expect(curves).toBeGreaterThan(0);
  });
});

describe('rotated borders map hidden side with the rotation (precise boxes)', () => {
  it('rotates edge assignments 90° CCW (top→left, right→top, bottom→right, left→bottom)', async () => {
    const mod = await import('../../../src/rendering/pdf-renderer');
    const fn = (mod as unknown as { __testRotateEdges?: unknown }).__testRotateEdges;
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const doc = xdp(`
      <draw name="d" x="10pt" y="10pt" w="60pt" h="10pt" rotate="90">
        <value><rectangle><border>
          <edge thickness="1pt"/>
          <edge thickness="1pt" presence="hidden"/>
          <edge thickness="1pt"/>
          <edge thickness="1pt"/>
        </border></rectangle></value>
      </draw>`);
    const res = parseXdp(doc, { strict: false });
    expect(res.success).toBe(true);
    expect(fn).toBeUndefined();
  });

  it('draws the hidden side on the rotated side (no protruding top)', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="60pt" h="10pt" rotate="90">
        <value><rectangle><border>
          <edge thickness="1pt"/>
          <edge thickness="1pt" presence="hidden"/>
          <edge thickness="1pt"/>
          <edge thickness="1pt"/>
        </border></rectangle></value>
      </draw>`;
    const content = await render(body);
    const lines = hLines(content);
    expect(lines.length).toBe(0);
  });
});

describe('subform thick edge wins over a coincident thin child edge', () => {
  it('keeps a thick top border when a thin child edge sits on the same line', async () => {
    const { renderFormToPdf } = await import('../../../src/workflows/render-pdf');
    const { contentStream } = await import('../../helpers/pdf-content');
    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="position">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="panel" x="40pt" y="60pt" w="200pt" h="40pt">
        <border>
          <edge thickness="2pt"/>
          <edge presence="hidden"/>
          <edge presence="hidden"/>
          <edge presence="hidden"/>
        </border>
        <draw name="child" x="0pt" y="0pt" w="180pt" h="20pt">
          <border><edge thickness="0.5pt"/></border>
          <value><text>child</text></value>
          <font typeface="Helvetica" size="8pt"/>
        </draw>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
    const result = await renderFormToPdf(doc, XSD, DATA, {});
    if (!result.success) throw new Error(`[${result.error.code}] ${result.error.message}`);
    const raw = await contentStream(result.data);
    const content = raw.toString('latin1');
    expect(content).toMatch(/\n2\.04 w\n/);
  });

  it('draws all table cells in a row at the shared row height', async () => {
    const content = await render(`
      <subform layout="table" columnWidths="50pt 50pt">
        <subform layout="row">
          <draw h="10pt"><value><text>A</text></value><border><edge thickness="1pt"/></border></draw>
          <draw h="20pt"><value><text>B</text></value><border><edge thickness="1pt"/></border></draw>
        </subform>
      </subform>`);
    expect(content).toMatch(/36 785\.89 50 20 re/);
    expect(content).toMatch(/86 785\.89 50 20 re/);
    expect(content).not.toMatch(/50 10 re/);
  });

  it('clamps table cell borders to the authored column width', async () => {
    const content = await render(`
      <subform layout="table" columnWidths="50pt 50pt">
        <subform layout="row">
          <draw w="100pt" h="10pt"><value><text>LABEL</text></value><border><edge thickness="1pt"/></border></draw>
          <draw w="10pt" h="10pt"><value><text>:</text></value><border><edge thickness="1pt"/></border></draw>
        </subform>
      </subform>`);
    expect(content).toMatch(/36 795\.89 50 10 re/);
    expect(content).toMatch(/86 795\.89 50 10 re/);
    expect(content).not.toMatch(/100 10 re/);
  });
});
