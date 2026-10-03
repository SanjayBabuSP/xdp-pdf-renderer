import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { contentStream } from '../../helpers/pdf-content';

/**
 * Border parity with Adobe Preview-as-PDF:
 *  - dash patterns from adobepdf.xdc:187-191, scaled by strokeTypeMultiplier=1
 *    (× thickness),
 *  - cap/join from designrenderer:6182,
 *  - rounded rectangles stroke a single path so `join` applies at the corners,
 *  - ellipse/circle borders carry dash + cap.
 */

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

const ROUNDED = `        <draw name="round" x="20pt" y="20pt" w="120pt" h="60pt">
          <value>
            <rectangle>
              <border>
                <edge stroke="dashed" thickness="2pt" cap="round" join="bevel">
                  <color value="255,0,0"/>
                </edge>
              </border>
              <corner radius="6pt"/>
            </rectangle>
          </value>
        </draw>`;

const CIRCLE = `        <draw name="dot" x="20pt" y="100pt" w="60pt" h="60pt">
          <value>
            <circle>
              <border>
                <edge stroke="dotted" thickness="1pt" cap="round" join="round">
                  <color value="0,0,255"/>
                </edge>
              </border>
            </circle>
          </value>
        </draw>`;

function xdp(shapes: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet>
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="content" layout="tb">
${shapes}
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

describe('border rendering parity', () => {
  it('strokes a rounded rectangle as one path with dash, cap and join', async () => {
    const result = await renderFormToPdf(xdp(ROUNDED), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    // dashed [4,2] × thickness 2 → [8 4] 0 d
    expect(content).toMatch(/\[8 4\] 0 d/);
    // bevel join (0x60002) → `2 j`; round cap (0x50001) → `1 J`
    expect(content).toMatch(/(^|\n)2 j(\n|$)/);
    expect(content).toMatch(/(^|\n)1 J(\n|$)/);
    // red stroking colour
    expect(content).toContain('1 0 0 RG');
    // rounded corners are drawn with bezier segments, not four straight lines
    expect(content).toContain(' c\n');
  });

  it('carries dash and cap onto an ellipse border', async () => {
    const result = await renderFormToPdf(xdp(CIRCLE), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);

    const content = await contentStream(result.data);
    // dotted [1,2] × thickness 1 → [1 2] 0 d
    expect(content).toMatch(/\[1 2\] 0 d/);
    // round cap and round join emitted around the ellipse stroke
    expect(content).toMatch(/(^|\n)1 J(\n|$)/);
    expect(content).toMatch(/(^|\n)1 j(\n|$)/);
    // blue stroking colour
    expect(content).toContain('0 0 1 RG');
  });
});
