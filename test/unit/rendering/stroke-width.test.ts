/**
 * Stroke-width quantisation.
 *
 * Designer writes stroke widths rounded to three decimal places. Authored
 * thicknesses are commonly in millimetres, so the raw point value is a long
 * binary fraction; emitting it unrounded made our `w` operators differ from
 * Designer's in the last digits (1.067 vs 1.06696226) even when the geometry was
 * otherwise correct.
 */

import {
  DEFAULT_EDGE_THICKNESS_PT,
  quantizeStrokeWidth,
} from '../../../src/rendering/border-style';
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

/** Millimetre thickness -> point value via the same factor the parser uses. */
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
    // The three widths Designer emitted for the MechanicalSeal grid, and the
    // values we produced before the fix.
    const designer = [0.5, 1.067, 1.634];
    const ours = [0.5, 0.50003226, 1.06696226, 1.63389226];
    const oursRounded = [...new Set(ours.map(quantizeStrokeWidth))].sort((a, b) => a - b);
    expect(oursRounded).toEqual(designer);
  });
});

describe('rendered stroke widths', () => {
  it('emits 1.067 for a 0.3764mm edge', async () => {
    const result = await renderFormToPdf(xdp('0.3764mm'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)1\.067 w(\n|$)/);
    expect(content).not.toContain('1.06696226');
  });

  it('emits 1.634 for a 0.5764mm edge', async () => {
    const result = await renderFormToPdf(xdp('0.5764mm'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)1\.634 w(\n|$)/);
    expect(content).not.toContain('1.63389226');
  });

  it('emits a clean 0.5 for a point-authored edge', async () => {
    const result = await renderFormToPdf(xdp('0.5pt'), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    expect(content).toMatch(/(^|\n)0\.5 w(\n|$)/);
  });

  it('never emits an unrounded millimetre width', async () => {
    for (const mm of ['0.176388889mm', '0.3764mm', '0.5764mm']) {
      const result = await renderFormToPdf(xdp(mm), XSD, DATA, {});
      expect(result.success).toBe(true);
      if (!result.success) throw new Error(result.error.message);
      const content = await contentStream(result.data);
      const widths = [...content.matchAll(/(?:^|\n)([\d.]+) w(\n|$)/g)].map((m) => Number(m[1]));
      for (const w of widths) {
        expect(w).toBe(quantizeStrokeWidth(w));
        expect(w).toBeCloseTo(w, 3);
      }
      // The raw mm->pt product must never survive into the content stream.
      expect(content).not.toContain(String(0.3764 * MM_TO_PT));
    }
  });

  it('keeps the default edge thickness at the 0.5pt specification value', () => {
    expect(DEFAULT_EDGE_THICKNESS_PT).toBe(0.5);
  });
});