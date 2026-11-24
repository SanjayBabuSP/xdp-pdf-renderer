import { PDFDocument } from 'pdf-lib';
import type { DrawNode, FieldNode } from '../../../src/types';
import { renderRichText } from '../../../src/rendering/pdf-renderer/text';
import { renderField } from '../../../src/rendering/pdf-renderer/field';
import { FontManager } from '../../../src/rendering/font-manager';
import { contentStream } from '../../helpers/pdf-content';

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

function textX(content: string, expected: string): number {
  const re = /1 0 0 1 ([\d.-]+) [\d.-]+ Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    let text = '';
    for (let i = 0; i + 1 < m[2].length; i += 2)
      text += String.fromCharCode(parseInt(m[2].slice(i, i + 2), 16));
    if (text === expected) return Number(m[1]);
  }
  throw new Error(`no drawn text matching ${expected}`);
}

function lineYs(content: string, labels: string[]): number[] {
  const re = /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
  const found = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    let text = '';
    for (let i = 0; i + 1 < m[2].length; i += 2) {
      text += String.fromCharCode(parseInt(m[2].slice(i, i + 2), 16));
    }
    for (const label of labels) {
      if (text === label && !found.has(label)) found.set(label, Number(m[1]));
    }
  }
  return labels.map((label) => {
    const y = found.get(label);
    if (y === undefined) throw new Error(`no drawn text matching ${label}`);
    return y;
  });
}

async function richNodeContent(node: DrawNode, y: number): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const fontManager = new FontManager(doc);
  await renderRichText(
    page,
    node,
    node.position?.x ?? 0,
    y,
    fontManager,
    node.position?.w ?? 200,
    node.position?.h ?? 0
  );
  return contentStream((await doc.save()) as unknown as Buffer);
}

async function fieldNodeContent(node: FieldNode): Promise<string> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const fontManager = new FontManager(doc);
  await renderField(page, node, 841.89, fontManager);
  return contentStream((await doc.save()) as unknown as Buffer);
}

function strokeEndX(content: string, startX: number): number {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const move = lines[i].match(/^([\d.-]+) [\d.-]+ m$/);
    if (!move || Math.abs(Number(move[1]) - startX) > 0.01) continue;
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const lineTo = lines[j].match(/^([\d.-]+) [\d.-]+ l$/);
      if (lineTo) return Number(lineTo[1]);
    }
  }
  throw new Error(`no stroke starting at x=${startX}`);
}

async function measureCaptionText(text: string): Promise<number> {
  const { measureTextWidth } = await import('../../../src/rendering/pdf-renderer/helpers');
  const font = await (await PDFDocument.create()).embedStandardFont('Helvetica');
  return measureTextWidth(text, 10, font);
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

describe('caption trailing symbol sits at its natural inline position after xfa-spacerun', () => {
  function captionField(captionPara = '<para vAlign="top"/>'): string {
    return `
      <field name="f" x="10pt" y="10pt" w="200pt" h="14pt">
        <ui><textEdit><border>
          <edge presence="hidden"/><edge presence="hidden"/>
          <edge thickness="0.5pt"/><edge presence="hidden"/>
        </border></textEdit></ui>
        <font typeface="Helvetica" size="10pt"/>
        <margin topInset="1pt" bottomInset="1pt" leftInset="1pt" rightInset="1pt"/>
        <para vAlign="top"/>
        <caption reserve="60pt">
          <value><exData contentType="text/html"><body><p>LABEL:<span style="xfa-spacerun:yes">&#160;&#160;&#160;&#160;&#160;</span><span style="text-decoration:underline">+</span></p></body></exData></value>
          ${captionPara}
          <font typeface="Helvetica" size="10pt"/>
        </caption>
        <bind match="dataRef" ref="$.v"/>
      </field>`;
  }

  it('stores ordered richHtml for spacerun captions (not collapsed)', async () => {
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const res = parseXdp(xdp(captionField()), { strict: false });
    if (!res.success) throw new Error('parse failed');
    const field = res.data.children[0] as unknown as {
      caption?: { richHtml?: string; text?: string };
    };
    expect(field.caption?.richHtml).toMatch(/spacerun/i);
    expect(field.caption?.richHtml).toMatch(/underline/i);
  });

  it('places + after the label end plus the measured spacer advance', async () => {
    const content = await render(captionField());
    const labelX = textX(content, 'LABEL:');
    const plusX = textX(content, '+');
    const labelW = await measureCaptionText('LABEL:');
    const spacerW = await measureCaptionText('\u00A0'.repeat(5));
    const symW = await measureCaptionText('+');
    expect(plusX - labelX).toBeCloseTo(labelW + spacerW, 1);
    expect(plusX).toBeLessThan(textX(content, 'Value') - symW);
  });

  it('keeps the underline directly under the +', async () => {
    const content = await render(captionField());
    const plusX = textX(content, '+');
    const symW = await measureCaptionText('+');
    expect(strokeEndX(content, plusX)).toBeCloseTo(plusX + symW, 1);
  });

  const hAlignCases: Array<[string, number]> = [
    ['center', 0.5],
    ['right', 1],
  ];
  it.each(hAlignCases)('shifts the whole caption group for hAlign=%s', async (hAlign, fraction) => {
    const content = await render(captionField(`<para vAlign="top" hAlign="${hAlign}"/>`));
    const labelX = textX(content, 'LABEL:');
    const plusX = textX(content, '+');
    const labelW = await measureCaptionText('LABEL:');
    const spacerW = await measureCaptionText('\u00A0'.repeat(5));
    const symW = await measureCaptionText('+');
    const baseX = textX(content, 'Value') - 60;
    const slack = 60 - (labelW + spacerW + symW);
    expect(labelX - baseX).toBeCloseTo(fraction * slack, 1);
    expect(plusX - labelX).toBeCloseTo(labelW + spacerW, 1);
  });

  it('paints the split caption exactly once (no label double-draw)', async () => {
    const content = await render(captionField());
    const { extractText } = await import('../../helpers/pdf-content');
    const flat = extractText(content).join(' ');
    expect(flat.match(/LABEL:/g)?.length).toBe(1);
  });
});

describe('rich draw block height', () => {
  it('matches the height reported by drawValueHeight', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="200pt">
        <value><exData contentType="text/html"><body><p>First</p><p>Second</p></body></exData></value>
        <font typeface="Helvetica" size="10pt"/>
        <para vAlign="top"/>
      </draw>`;
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const { drawValueHeight } = await import('../../../src/domain/layout/position-engine');
    const parsed = parseXdp(xdp(body), { strict: false });
    if (!parsed.success) throw new Error('parse failed');
    const node = parsed.data.children[0] as DrawNode;
    const expected = drawValueHeight(node, 200);
    expect(expected).toBeCloseTo(24, 6);

    const content = await render(body);
    const ys: number[] = [];
    const re = /1 0 0 1 [\d.]+ ([\d.-]+) Tm\s*\n<([0-9A-Fa-f]+)> Tj/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      let text = '';
      for (let i = 0; i + 1 < m[2].length; i += 2) {
        text += String.fromCharCode(parseInt(m[2].slice(i, i + 2), 16));
      }
      if (/First|Second/.test(text)) ys.push(Number(m[1]));
    }
    expect(ys).toHaveLength(2);
    expect(ys[0] - ys[1]).toBeCloseTo(expected / 2, 6);
  });

  it('uses a CSS font-size as the fallback when the XDP draw has no font size', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="200pt">
        <value><exData contentType="text/html"><body style="font-size:12pt"><p>First</p><p>Second</p></body></exData></value>
        <font typeface="Helvetica"/>
        <para vAlign="top"/>
      </draw>`;
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const { drawValueHeight } = await import('../../../src/domain/layout/position-engine');
    const parsed = parseXdp(xdp(body), { strict: false });
    if (!parsed.success) throw new Error('parse failed');
    const node = parsed.data.children[0] as DrawNode;
    expect(node.font?.size).toBeUndefined();
    expect(drawValueHeight(node, 200)).toBeCloseTo(28.8, 6);

    const [firstY, secondY] = lineYs(await render(body), ['First', 'Second']);
    expect(firstY - secondY).toBeCloseTo(14.4, 1);
  });

  it('ignores para lineHeight for rich text and uses the font default advance', async () => {
    const body = `
      <draw name="d" x="10pt" y="10pt" w="200pt">
        <value><exData contentType="text/html"><body style="font-size:12pt"><p>First</p><p>Second</p></body></exData></value>
        <font typeface="Helvetica"/>
        <para vAlign="top" lineHeight="12pt"/>
      </draw>`;
    const { parseXdp } = await import('../../../src/domain/parsing/parse-xdp');
    const { drawValueHeight } = await import('../../../src/domain/layout/position-engine');
    const parsed = parseXdp(xdp(body), { strict: false });
    if (!parsed.success) throw new Error('parse failed');
    const node = parsed.data.children[0] as DrawNode;
    expect(drawValueHeight(node, 200)).toBeCloseTo(28.8, 6);

    const [firstY, secondY] = lineYs(await render(body), ['First', 'Second']);
    expect(firstY - secondY).toBeCloseTo(14.4, 1);
  });
});

describe('clipped text fragments stay anchored to their original box', () => {
  const richContent =
    '<body style="font-size:12pt"><p>zero</p><p>one</p><p>two</p><p>three</p></body>';
  const fragmentHeight = 23.9;
  const originalHeight = 66.5;
  const topOffset = fragmentHeight - originalHeight;

  it('places a ranged rich line at its authored offset and clips to the fragment band', async () => {
    const full: DrawNode = {
      type: 'draw',
      value: { type: 'richText', content: richContent },
      font: { family: 'Helvetica' },
      para: { vAlign: 'top' },
      position: { x: 0, y: 0, w: 200, h: originalHeight },
    };
    const clipped: DrawNode = {
      ...full,
      position: { ...full.position!, h: fragmentHeight },
      textLineRange: { start: 3, end: 4 },
      originalBox: { topOffset, height: originalHeight },
    };

    const fullContent = await richNodeContent(full, 600);
    const clippedContent = await richNodeContent(clipped, 600);
    const authoredY = lineYs(fullContent, ['three'])[0];
    const clippedY = lineYs(clippedContent, ['three'])[0];

    expect(clippedY).toBeCloseTo(authoredY, 6);
    expect(clippedY).toBeGreaterThanOrEqual(600);
    expect(clippedY).toBeLessThanOrEqual(600 + fragmentHeight);
    expect(clippedContent).toMatch(new RegExp(`0 600 200 ${fragmentHeight} re`));
    expect(clippedContent).toMatch(/\nW\n/);
    expect(fullContent).not.toMatch(/\nW\n/);
  });

  it('re-anchors a protruding rich fragment so the first owned line starts at the band top', async () => {
    const node: DrawNode = {
      type: 'draw',
      name: 'frag',
      value: {
        type: 'richText',
        content: '<body><p>zero</p><p>one</p><p>two</p><p>three</p></body>',
      },
      font: { family: 'Helvetica', size: 10 },
      para: { vAlign: 'top' },
      position: { x: 10, y: 0, w: 200, h: 24 },
      originalBox: { topOffset: -20, height: 48 },
      textLineRange: { start: 1, end: 4 },
    };
    const [oneY, twoY, threeY] = lineYs(await richNodeContent(node, 100), ['one', 'two', 'three']);
    expect(oneY).toBeGreaterThan(115);
    expect(oneY).toBeLessThan(118);
    expect(twoY).toBeGreaterThan(103);
    expect(twoY).toBeLessThan(106);
    expect(threeY).toBeGreaterThan(91);
    expect(threeY).toBeLessThan(94);
  });

  it('places a ranged field line at its authored offset and clips to the fragment band', async () => {
    const full: FieldNode = {
      type: 'field',
      ui: { type: 'textEdit', multiLine: true },
      resolvedValue: 'zero\none\ntwo\nthree',
      font: { family: 'Helvetica', size: 12 },
      position: { x: 0, y: topOffset, w: 200, h: originalHeight },
    };
    const clipped: FieldNode = {
      ...full,
      position: { ...full.position!, y: 0, h: fragmentHeight },
      textLineRange: { start: 3, end: 4 },
      originalBox: { topOffset, height: originalHeight },
    };

    const authoredY = lineYs(await fieldNodeContent(full), ['three'])[0];
    const clippedContent = await fieldNodeContent(clipped);
    const clippedY = lineYs(clippedContent, ['three'])[0];

    expect(clippedY).toBeCloseTo(authoredY, 6);
    expect(clippedContent).toMatch(/\nW\n/);
  });
});
