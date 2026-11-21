import * as fs from 'fs';
import * as path from 'path';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';
import * as pdfRenderer from '../../../src/rendering/pdf-renderer';

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="form">
    <xs:complexType><xs:sequence>
      <xs:element type="xs:string" name="name"/>
      <xs:element type="xs:date" name="dob" minOccurs="0"/>
    </xs:sequence></xs:complexType>
  </xs:element>
</xs:schema>`;

const VALID_DATA = `<?xml version="1.0" encoding="UTF-8"?><form><name>Ada</name><dob>2026-01-01</dob></form>`;
const BAD_DATE_DATA = `<?xml version="1.0" encoding="UTF-8"?><form><name>Ada</name><dob>not-a-date</dob></form>`;
const MISSING_NAME_DATA = `<?xml version="1.0" encoding="UTF-8"?><form><dob>2026-01-01</dob></form>`;

const FIXTURES = path.join(__dirname, '../../fixtures');

function xdp(
  pdfConfig = '<version>1.7</version><adobeExtensionLevel>3</adobeExtensionLevel>'
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="form" layout="tb">
      <pageSet><pageArea name="Page1" id="Page1">
        <contentArea x="36" y="36" w="523" h="770"/>
        <medium stock="a4" short="595" long="842"/>
      </pageArea></pageSet>
      <subform name="content" layout="tb">
        <field name="name" w="100mm" minH="6mm">
          <ui><textEdit/></ui>
          <font typeface="Helvetica" size="10pt"/>
          <caption reserve="20mm"><value><text>Name</text></value></caption>
          <bind match="dataRef" ref="$.name"/>
        </field>
      </subform>
    </subform>
  </template>
  <config xmlns="http://www.xfa.org/schema/xci/3.0/">
    <present><pdf>${pdfConfig}</pdf></present>
  </config>
</xdp:xdp>`;
}

function minimalFixture(): { xdp: string; xsd: string; data: string } {
  return {
    xdp: fs.readFileSync(path.join(FIXTURES, 'minimal.xdp'), 'utf8'),
    xsd: fs.readFileSync(path.join(FIXTURES, 'minimal.xsd'), 'utf8'),
    data: fs.readFileSync(path.join(FIXTURES, 'minimal-data.xml'), 'utf8'),
  };
}

function expectPdf(value: unknown): asserts value is Buffer {
  expect(Buffer.isBuffer(value)).toBe(true);
  expect((value as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
}

describe('renderFormToPdf', () => {
  it('renders a PDF with strict validation and PDF configuration applied', async () => {
    const result = await renderFormToPdf(xdp(), XSD, VALID_DATA, {
      strictValidation: true,
      adobe: { metadata: { producer: 'producer-x', creatorTool: 'creator-x' } },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expectPdf(result.data);
  });

  it('reports schema validation problems through onWarning in non-strict mode', async () => {
    const warnings: string[] = [];
    const result = await renderFormToPdf(xdp(), XSD, BAD_DATE_DATA, {
      onWarning: (message) => warnings.push(message),
    });

    expect(result.success).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('VAL_2001');
    expect(warnings.some((warning) => warning.includes('dob'))).toBe(true);
  });

  it('fails immediately on schema validation errors in strict mode', async () => {
    const result = await renderFormToPdf(xdp(), XSD, MISSING_NAME_DATA, {
      strictValidation: true,
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error.code).toBe('VAL_2001');
    expect(result.error.details).toEqual(['Missing required field: name']);
  });

  it('honours strictValidation false without emitting warnings for optional data problems', async () => {
    const warnings: string[] = [];
    const result = await renderFormToPdf(xdp(), XSD, MISSING_NAME_DATA, {
      strictValidation: false,
      onWarning: (message) => warnings.push(message),
    });

    expect(result.success).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('applies every supported Adobe feature option', async () => {
    const result = await renderFormToPdf(xdp(), XSD, VALID_DATA, {
      adobe: {
        acroForm: { tabOrderFromTraversal: true },
        bookmarks: [{ title: 'First page', pageIndex: 0 }],
        annotations: [{ type: 'text', rect: [10, 10, 30, 30], pageIndex: 0, contents: 'note' }],
        layers: [{ name: 'Layer 1', visible: true }],
        flatten: { fieldNames: [] },
        tabOrder: 'structure',
        embedXfa: true,
        tagged: { language: 'en-US', title: 'Tagged' },
        security: { userPassword: 'user', ownerPassword: 'owner' },
        metadata: { producer: 'producer-y', creatorTool: 'creator-y' },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expectPdf(result.data);
  });

  it('applies boolean Adobe switches and a numeric extension level', async () => {
    const result = await renderFormToPdf(xdp(), XSD, VALID_DATA, {
      adobe: {
        acroForm: true,
        tagged: true,
        flatten: true,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expectPdf(result.data);
  });

  it('falls back to a saved buffer when the XDP has no PDF configuration', async () => {
    const result = await renderFormToPdf(xdp(''), XSD, VALID_DATA);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expectPdf(result.data);
  });

  it('renders the repository fixture through the same workflow', async () => {
    const fixture = minimalFixture();
    const result = await renderFormToPdf(fixture.xdp, fixture.xsd, fixture.data);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.error.message);
    expectPdf(result.data);
  });

  it('wraps renderer failures as PDF_GENERATION_FAILED', async () => {
    const spy = jest
      .spyOn(pdfRenderer, 'renderPdfWithDoc')
      .mockRejectedValue(new Error('renderer exploded'));
    try {
      const result = await renderFormToPdf(xdp(), XSD, VALID_DATA);
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.code).toBe('REN_5003');
      expect(result.error.message).toContain('renderer exploded');
    } finally {
      spy.mockRestore();
    }
  });
});
