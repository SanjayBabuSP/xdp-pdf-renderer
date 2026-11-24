import { PDFDocument } from 'pdf-lib';
import {
  DEFAULT_EDGE_THICKNESS_PT,
  quantizeDeviceStrokeWidth,
  quantizeStrokeWidth,
} from '../../../src/rendering/border-style';
import { drawBorderBox, drawEdge } from '../../../src/rendering/pdf-renderer/border-fill';
import type { BorderSpec } from '../../../src/types';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="dummy" minOccurs="0"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?><value><dummy>x</dummy></value>`;

const MM_TO_PT = 2.83465;

function xdp(thickness: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="769"/>
        <medium stock="a4" short="595.276pt" long="841.89pt"/>
      </pageArea></pageSet>
      <subform name="s" x="10" y="10" w="200" h="60">
        <border><edge thickness="${thickness}"/></border>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('quantizeStrokeWidth', () => {
  it('rounds to three decimal places', () => {
    expect(quantizeStrokeWidth(1.06696226)).toBe(1.067);
    expect(quantizeStrokeWidth(1.63389226)).toBe(1.634);
    expect(quantizeStrokeWidth(0.50003226)).toBe(0.5);
  });

  it('leaves already-clean values untouched', () => {
    for (const v of [0.5, 1, 2, 0.25, 3]) {
      expect(quantizeStrokeWidth(v)).toBe(v);
    }
  });

  it('passes through zero and negatives unchanged', () => {
    expect(quantizeStrokeWidth(0)).toBe(0);
    expect(quantizeStrokeWidth(-1)).toBe(-1);
  });

  it('passes through non-finite input rather than emitting NaN to the PDF', () => {
    expect(quantizeStrokeWidth(NaN)).toBeNaN();
    expect(quantizeStrokeWidth(Infinity)).toBe(Infinity);
  });

  it('covers every millimetre-authored width seen in the real fixtures', () => {
    const designer = [0.5, 1.067, 1.634];
    const ours = [0.5, 0.50003226, 1.06696226, 1.63389226];
    const oursRounded = [...new Set(ours.map(quantizeStrokeWidth))].sort((a, b) => a - b);
    expect(oursRounded).toEqual(designer);
  });
});

describe('quantizeDeviceStrokeWidth', () => {
  it('rounds up to the 600dpi print grid (multiples of 0.12pt)', () => {
    expect(quantizeDeviceStrokeWidth(0.5)).toBe(0.6);
    expect(quantizeDeviceStrokeWidth(1.067)).toBe(1.08);
    expect(quantizeDeviceStrokeWidth(1.634)).toBe(1.68);
    expect(quantizeDeviceStrokeWidth(0.24)).toBe(0.24);
  });

  it('passes through non-positive and non-finite widths', () => {
    expect(quantizeDeviceStrokeWidth(0)).toBe(0);
    expect(quantizeDeviceStrokeWidth(-1)).toBe(-1);
    expect(quantizeDeviceStrokeWidth(NaN)).toBeNaN();
  });
});

describe('rendered stroke widths', () => {
  it('emits 1.08 for a 0.3764mm edge on the print device grid', async () => {
    const result = await renderFormToPdf(xdp('0.3764mm'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)1\.08 w(\n|$)/);
    expect(content).not.toContain('1.06696226');
  });

  it('emits 1.68 for a 0.5764mm edge on the print device grid', async () => {
    const result = await renderFormToPdf(xdp('0.5764mm'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)1\.68 w(\n|$)/);
    expect(content).not.toContain('1.63389226');
  });

  it('emits a device-grid 0.6 for a point-authored edge', async () => {
    const result = await renderFormToPdf(xdp('0.5pt'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)0\.6 w(\n|$)/);
  });

  it('never emits an unrounded millimetre width', async () => {
    for (const mm of ['0.176388889mm', '0.3764mm', '0.5764mm']) {
      const result = await renderFormToPdf(xdp(mm), XSD, DATA, {});
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      const content = await contentStream(result.data);
      const widths = [...content.matchAll(/(?:^|\n)([\d.]+) w(\n|$)/g)].map((m) => Number(m[1]));
      for (const w of widths) {
        expect(w).toBe(quantizeDeviceStrokeWidth(w));
        expect(w).toBeCloseTo(w, 3);
      }
      expect(content).not.toContain(String(0.3764 * MM_TO_PT));
    }
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['zero', 0],
  ])('skips a non-finite or non-positive thickness (%s) at emission', async (_label, thickness) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, { thickness }, 10, 10, 100, 10);
    const content = await contentStream(Buffer.from(await doc.save()));
    expect(content).not.toMatch(/(?:^|\n)[\d.]+ w(?:\n|$)/);
    expect(content).not.toContain('Infinity');
    expect(content).not.toContain('NaN');
  });

  it('keeps the default edge thickness at the 0.5pt specification value', () => {
    expect(DEFAULT_EDGE_THICKNESS_PT).toBe(0.5);
  });
});

describe('per-page coincident edge de-duplication', () => {
  const edge = { thickness: 0.5, color: { r: 0, g: 0, b: 0 } };

  function strokeCount(content: string): number {
    return (content.match(/(?:^|\n)S(?:\n|$)/g) ?? []).length;
  }

  async function contentOf(doc: PDFDocument): Promise<string> {
    return contentStream(Buffer.from(await doc.save()));
  }

  it('emits one stroke for exactly coincident edges on the same page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, edge, 10, 10, 100, 10);
    drawEdge(page, edge, 10, 10, 100, 10);
    expect(strokeCount(await contentOf(doc))).toBe(1);
  });

  it('treats reversed endpoints as the same coincident edge', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, edge, 10, 10, 100, 10);
    drawEdge(page, edge, 100, 10, 10, 10);
    expect(strokeCount(await contentOf(doc))).toBe(1);
  });

  it('emits distinct edges separately', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, edge, 10, 10, 100, 10);
    drawEdge(page, edge, 10, 20, 100, 20);
    drawEdge(page, edge, 10, 10, 100, 11);
    expect(strokeCount(await contentOf(doc))).toBe(3);
  });

  it('keeps coincident overprints with different colour, dash pattern or opacity', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, edge, 10, 10, 100, 10);
    drawEdge(page, { ...edge, color: { r: 255, g: 0, b: 0 } }, 10, 10, 100, 10);
    drawEdge(page, { ...edge, style: 'dashed' }, 10, 10, 100, 10);
    drawEdge(page, { ...edge, opacity: 0.5 }, 10, 10, 100, 10);
    expect(strokeCount(await contentOf(doc))).toBe(4);
  });

  it('normalises endpoints to 0.01pt before comparing', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawEdge(page, edge, 10.001, 20.002, 100.001, 20.002);
    drawEdge(page, edge, 10.004, 20.003, 100.004, 20.003);
    drawEdge(page, edge, 10.03, 20.002, 100.001, 20.002);
    expect(strokeCount(await contentOf(doc))).toBe(2);
  });

  it('deduplicates per PDFPage, not across pages', async () => {
    const doc = await PDFDocument.create();
    drawEdge(doc.addPage([200, 200]), edge, 10, 10, 100, 10);
    drawEdge(doc.addPage([200, 200]), edge, 10, 10, 100, 10);
    const bytes = Buffer.from(await doc.save());
    expect(strokeCount(await contentStream(bytes, 0))).toBe(1);
    expect(strokeCount(await contentStream(bytes, 1))).toBe(1);
  });

  const box: BorderSpec = { edges: [edge] };
  const boxPos = { x: 10, y: 10, w: 100, h: 50 };

  function drawBox(page: PDFPage, border: BorderSpec = box, pos = boxPos): void {
    drawBorderBox(page, border, pos, 200);
  }

  it('emits one single re/S path for two identical uniform boxes on one page', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawBox(page);
    drawBox(page);
    const content = await contentOf(doc);
    expect(strokeCount(content)).toBe(1);
    expect(content.match(/ re\n/g) ?? []).toHaveLength(1);
  });

  it('deduplicates uniform boxes per PDFPage, not across pages', async () => {
    const doc = await PDFDocument.create();
    drawBox(doc.addPage([200, 200]));
    drawBox(doc.addPage([200, 200]));
    const bytes = Buffer.from(await doc.save());
    expect(strokeCount(await contentStream(bytes, 0))).toBe(1);
    expect(strokeCount(await contentStream(bytes, 1))).toBe(1);
  });

  it('keeps uniform boxes with different geometry or style separate', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    drawBox(page);
    drawBox(page, box, { ...boxPos, y: 11 });
    drawBox(page, { edges: [{ ...edge, color: { r: 255, g: 0, b: 0 } }] });
    expect(strokeCount(await contentOf(doc))).toBe(3);
  });
});
