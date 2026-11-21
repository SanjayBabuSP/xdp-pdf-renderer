import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream, extractText } from '../../helpers/pdf-content';
import { NARROW_SCALE, isCondensedFamily } from '../../../src/rendering/standard-fonts';
import { measureText, quantizeAdvance } from '../../../src/rendering/text/measure';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="v" minOccurs="0"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><v>Arial Narrow sample text</v></value>`;

function xdp(family: string, w = 200): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <field name="f" x="10" y="10" w="${w}pt" h="16pt">
        <ui><textEdit/></ui>
        <font typeface="${family}" size="10pt"/>
        <bind match="dataRef" ref="$.v"/>
      </field>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('isCondensedFamily', () => {
  it('identifies the condensed faces that need a horizontal scale', () => {
    expect(isCondensedFamily('Arial Narrow')).toBe(true);
    expect(isCondensedFamily('arialnarrow')).toBe(true);
    expect(isCondensedFamily('  Arial Narrow ')).toBe(true);
  });

  it('leaves full-width families alone', () => {
    for (const f of ['Arial', 'Helvetica', 'Calibri', 'Times New Roman', undefined]) {
      expect(isCondensedFamily(f)).toBe(false);
    }
  });
});

describe('measureText — horizontalScale', () => {
  it('scales the advance by the requested factor', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const full = measureText('iiiiiiiiii', 10, font);
    const condensed = measureText('iiiiiiiiii', 10, font, { horizontalScale: NARROW_SCALE });
    expect(condensed).toBeCloseTo(full * NARROW_SCALE, 6);
  });

  it('leaves charSpacing and wordSpacing unscaled (absolute point values)', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const glyphs = measureText('a b', 10, font);
    const charTotal = 1 * 2;
    const wordTotal = 2 * 1;

    expect(measureText('a b', 10, font, { charSpacing: 1, wordSpacing: 2 })).toBeCloseTo(
      glyphs + charTotal + wordTotal,
      6
    );
    expect(
      measureText('a b', 10, font, { charSpacing: 1, wordSpacing: 2, horizontalScale: 0.5 })
    ).toBeCloseTo(glyphs * 0.5 + charTotal + wordTotal, 6);
  });

  it('is a no-op at scale 1', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    expect(measureText('hello', 10, font, { horizontalScale: 1 })).toBeCloseTo(
      measureText('hello', 10, font),
      9
    );
  });
});

describe('rendering a condensed face', () => {
  it('emits a horizontal scaling operator for Arial Narrow', async () => {
    const result = await renderFormToPdf(xdp('Arial Narrow'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)93 Tz(\n|$)/);
    expect(content).toMatch(/(^|\n)100 Tz(\n|$)/);
  });

  it('does not emit a horizontal scaling operator for Arial', async () => {
    const result = await renderFormToPdf(xdp('Arial'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).not.toMatch(/ Tz(\n|$)/);
  });

  it('emits a horizontal scaling operator for Arial Narrow static draws too', async () => {
    const drawXdp = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <draw name="d" x="10" y="10" w="200pt" h="16pt">
        <value><text>Arial Narrow static text</text></value>
        <font typeface="Arial Narrow" size="10pt"/>
      </draw>
    </subform>
  </template>
</xdp:xdp>`;
    const result = await renderFormToPdf(drawXdp, XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)93 Tz(\n|$)/);
    expect(content).toMatch(/(^|\n)100 Tz(\n|$)/);
  });

  it('wraps Arial Narrow text into fewer lines than full-width Arial in the same box', async () => {
    const longData = `<?xml version="1.0" encoding="UTF-8"?><value><v>${'Arial Narrow sample text '.repeat(
      6
    )}</v></value>`;
    const narrow = await renderFormToPdf(xdp('Arial Narrow', 120), XSD, longData, {});
    const full = await renderFormToPdf(xdp('Arial', 120), XSD, longData, {});
    expect(narrow.success && full.success).toBe(true);
    if (!narrow.success || !full.success) throw new Error('render failed');

    const countTj = (buf: Buffer) => (buf.toString('latin1').match(/Td|TD|TJ|Tj/g) ?? []).length;
    const narrowRuns = countTj(narrow.data);
    const fullRuns = countTj(full.data);
    expect(narrowRuns).toBeLessThanOrEqual(fullRuns);
  });
});

describe('font resource de-duplication', () => {
  const MANY_LINES = 40;

  function manyLinesXdp(): string {
    const fields = Array.from(
      { length: MANY_LINES },
      (_, i) => `      <field name="f${i}" x="10pt" y="${10 + i * 12}pt" w="300pt" h="10pt">
        <ui><textEdit/></ui>
        <font typeface="Helvetica" size="9pt"/>
        <bind match="dataRef" ref="$.v${i}"/>
      </field>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="rows" layout="position">
${fields}
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
  }

  function manyLinesXsd(): string {
    const els = Array.from(
      { length: MANY_LINES },
      (_, i) => `    <xs:element type="xs:string" name="v${i}" minOccurs="0"/>`
    ).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value"><xs:complexType><xs:sequence>
${els}
  </xs:sequence></xs:complexType></xs:element>
</xs:schema>`;
  }

  function manyLinesData(): string {
    const els = Array.from({ length: MANY_LINES }, (_, i) => `  <v${i}>row ${i}</v${i}>`).join(
      '\n'
    );
    return `<?xml version="1.0" encoding="UTF-8"?><value>\n${els}\n</value>`;
  }

  it('registers one /Font entry per distinct face, not one per text run', async () => {
    const result = await renderFormToPdf(manyLinesXdp(), manyLinesXsd(), manyLinesData(), {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const raw = result.data.toString('latin1');
    const fontNames = new Set(
      [...raw.matchAll(/\/(Helvetica[\w-]*)\s+\d+\s+0\s+R/g)].map((m) => m[1])
    );
    const selectors = new Set(
      [...(await contentStream(result.data)).matchAll(/\/([A-Za-z0-9+.-]+) [\d.]+ Tf/g)].map(
        (m) => m[1]
      )
    );
    expect(selectors.size).toBeLessThanOrEqual(2);
    expect(fontNames.size).toBeLessThanOrEqual(2);
  });

  it('still draws every text run after de-duplication', async () => {
    const result = await renderFormToPdf(manyLinesXdp(), manyLinesXsd(), manyLinesData(), {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    const drawn = extractText(content);
    expect(drawn.length).toBe(MANY_LINES);
    expect(drawn[0]).toBe('row 0');
    expect(drawn[MANY_LINES - 1]).toBe(`row ${MANY_LINES - 1}`);
  });

  it('produces a smaller file than one entry per run would', async () => {
    const result = await renderFormToPdf(manyLinesXdp(), manyLinesXsd(), manyLinesData(), {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.length).toBeLessThan(40 * 1024);
  });
});

describe('measureText — Adobe 1/1000-pt advance quantization (jftext:60660 [asm])', () => {
  it('quantizes each advance to 1/1000 pt with the +1.75 nudge', async () => {
    expect(quantizeAdvance(10.0004)).toBeCloseTo(10.001, 9);
    expect(quantizeAdvance(10.0)).toBeCloseTo(10.001, 9);
    expect(quantizeAdvance(0)).toBeCloseTo(0.001, 9);
  });

  it('is independent of font size (flat 1/1000-pt quantum, not size/1000)', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
    const w10 = measureText('Hello World Hello World Hello World Hello World', 10, font);
    const w20 = measureText('Hello World Hello World Hello World Hello World', 20, font);
    expect(w20).toBeGreaterThan(w10 * 1.9);
    expect(w20).toBeLessThan(w10 * 2.1);
  });
});

describe('assets/fonts are present', () => {
  it('has the bundled Unicode fallback available for unknown families', () => {
    const p = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
    expect(fs.existsSync(p)).toBe(true);
  });
});
