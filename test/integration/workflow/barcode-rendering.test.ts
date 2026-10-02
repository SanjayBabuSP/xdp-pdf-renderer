import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import { parseXdp } from '../../../src/domain/parsing/parse-xdp';
import { contentStream, extractText, pathRectCount } from '../../helpers/pdf-content';

/**
 * G1 — barcode fields were parsed (`ui.type === 'barcode'`) but `renderBarcode`
 * had zero call sites, so the field fell through to plain text rendering.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="serial"/>
        <xs:element type="xs:string" name="lot"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?>
<value><serial>ABC-1234</serial><lot>LOT-99</lot></value>`;

function xdp(fields: string): string {
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
${fields}
      </subform>
    </subform>
  </template>
</xdp:xdp>`;
}

const SERIAL_FIELD = `        <field name="serial" x="10pt" y="10pt" w="120pt" h="40pt">
          <ui><barcode symbology="code3Of9" textLocation="none"/></ui>
          <font typeface="Helvetica" size="8pt"/>
          <bind match="dataRef" ref="$.serial"/>
        </field>`;

const LOT_FIELD = `        <field name="lot" x="10pt" y="70pt" w="120pt" h="30pt">
          <ui><barcode symbology="ean13" textLocation="below" moduleWidth="0.3mm"/></ui>
          <font typeface="Helvetica" size="7pt"/>
          <bind match="dataRef" ref="$.lot"/>
        </field>`;

const rectCount = pathRectCount;

describe('G1 — barcode fields render as vector bars', () => {
  it('parses the full Adobe <barcode> attribute set', () => {
    const parsed = parseXdp(xdp(SERIAL_FIELD));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const walk = (nodes: unknown[]): unknown => {
      for (const n of nodes as Array<Record<string, unknown>>) {
        if (n.type === 'field' && n.name === 'serial') return n;
        const kids = (n.children ?? []) as unknown[];
        const hit = walk(kids);
        if (hit) return hit;
      }
      return undefined;
    };
    const field = walk(parsed.data.children) as Record<string, unknown> | undefined;
    expect(field).toBeDefined();
    const ui = field!.ui as Record<string, unknown>;
    expect(ui.type).toBe('barcode');
    expect(ui.symbology).toBe('code3Of9');
    expect(ui.textLocation).toBe('none');
  });

  it('draws bars instead of showing the payload as glyphs', async () => {
    const result = await renderFormToPdf(xdp(SERIAL_FIELD), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('render failed');

    const content = await contentStream(result.data);
    expect(rectCount(content)).toBeGreaterThan(20);

    // Without HRI the payload must not be drawn as text.
    const text = extractText(content).join(' ');
    expect(text).not.toContain('ABC-1234');
  });

  it('draws a human-readable interpretation when textLocation is set', async () => {
    const result = await renderFormToPdf(xdp(LOT_FIELD), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('render failed');

    const content = await contentStream(result.data);
    expect(rectCount(content)).toBeGreaterThan(20);
    expect(extractText(content).join(' ')).toContain('LOT-99');
  });

  it('draws nothing for an empty barcode payload', async () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?>
<value><serial></serial><lot></lot></value>`;
    const result = await renderFormToPdf(xdp(SERIAL_FIELD), XSD, empty, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('render failed');
    const content = await contentStream(result.data);
    expect(rectCount(content)).toBe(0);
  });

  it('falls back to Code 39 for an unrecognized symbology', async () => {
    const field = SERIAL_FIELD.replace('symbology="code3Of9"', 'symbology="notARealCode"');
    const result = await renderFormToPdf(xdp(field), XSD, DATA, {});
    expect(result.success).toBe(true);
    if (!result.success) throw new Error('render failed');
    const content = await contentStream(result.data);
    expect(rectCount(content)).toBeGreaterThan(10);
  });
});
