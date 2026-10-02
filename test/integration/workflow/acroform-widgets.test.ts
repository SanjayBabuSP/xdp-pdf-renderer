import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { renderFormToPdf } from '../../../src/workflows/render-pdf';

/**
 * G8 — interactive AcroForm widgets generated from the XFA template, including
 * `<assist>` tooltips and authored `<traversal>` ordering.
 */

const XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="Name" minOccurs="0"/>
        <xs:element type="xs:string" name="Agree" minOccurs="0"/>
        <xs:element type="xs:string" name="Choice" minOccurs="0"/>
        <xs:element type="xs:string" name="Zap" minOccurs="0"/>
        <xs:element type="xs:string" name="Alpha" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const XDP = `<?xml version="1.0" encoding="UTF-8"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
  <template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
    <subform name="value" layout="tb">
      <pageSet name="MasterPage">
        <pageArea name="Page1" id="Page1">
          <contentArea x="19.05mm" y="19.05mm" w="171.45mm" h="257.35mm"/>
          <medium stock="a4" short="210mm" long="297mm"/>
        </pageArea>
      </pageSet>
      <subform name="content" layout="tb">
        <traversal order="tab"><field name="Alpha"/><field name="Zap"/></traversal>
        <field name="Name" x="0" y="0" w="120pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.Name"/>
          <assist><toolTip>Your full name</toolTip></assist>
        </field>
        <field name="Agree" x="0" y="20pt" w="14pt" h="14pt">
          <ui><checkButton/></ui>
          <bind match="dataRef" ref="$.Agree"/>
        </field>
        <field name="Choice" x="0" y="40pt" w="120pt" h="14pt">
          <ui>
            <choiceList>
              <items save="1"><text value="M">March</text><text value="A">April</text></items>
            </choiceList>
          </ui>
          <bind match="dataRef" ref="$.Choice"/>
        </field>
        <field name="Zap" x="0" y="60pt" w="120pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.Zap"/>
        </field>
        <field name="Alpha" x="0" y="80pt" w="120pt" h="14pt">
          <ui><textEdit/></ui>
          <bind match="dataRef" ref="$.Alpha"/>
        </field>
      </subform>
    </subform>
  </template>
</xdp:xdp>`;

const DATA = `<?xml version="1.0" encoding="UTF-8"?>
<value><Name>Alice</Name><Agree>1</Agree><Choice>M</Choice><Zap>z</Zap><Alpha>a</Alpha></value>`;

interface FieldInfo {
  name: string;
  ft: string;
  value: string;
  tooltip?: string;
}

async function render(adobe: Record<string, unknown>): Promise<PDFDocument> {
  const result = await renderFormToPdf(XDP, XSD, DATA, { adobe });
  expect(result.success).toBe(true);
  if (!result.success) throw new Error('render failed');
  return PDFDocument.load(result.data);
}

function readFields(doc: PDFDocument): FieldInfo[] {
  const acro = doc.context.lookup(doc.catalog.get(PDFName.of('AcroForm'))) as PDFDict;
  const fields = doc.context.lookup(acro.get(PDFName.of('Fields'))) as PDFArray;
  return fields.asArray().map((ref) => {
    const dict = doc.context.lookup(ref) as PDFDict;
    const get = (name: string): string | undefined => {
      const v = dict.get(PDFName.of(name));
      if (v == null) return undefined;
      const resolved = doc.context.lookup(v);
      if (resolved instanceof PDFString) return resolved.decodeText();
      // PDFName stringifies as `/Name`; strip the leading slash.
      return String(resolved).replace(/^\//, '');
    };
    return { name: get('T') ?? '', ft: get('FT') ?? '', value: get('V') ?? '', tooltip: get('TU') };
  });
}

describe('G8 — AcroForm widgets', () => {
  it('emits a field with the right type, value and tooltip', async () => {
    const doc = await render({ acroForm: true });
    const fields = readFields(doc);

    const name = fields.find((f) => f.name.endsWith('Name'));
    expect(name).toBeDefined();
    expect(name!.ft).toBe('Tx');
    expect(name!.value).toBe('Alice');
    expect(name!.tooltip).toBe('Your full name');

    const agree = fields.find((f) => f.name.endsWith('Agree'));
    expect(agree?.ft).toBe('Btn');
    expect(agree?.value).toBe('Yes');

    const choice = fields.find((f) => f.name.endsWith('Choice'));
    expect(choice?.ft).toBe('Ch');
    expect(choice?.value).toBe('M');
  });

  it('honours the authored <traversal> order', async () => {
    const doc = await render({ acroForm: true });
    const fields = readFields(doc);
    const alpha = fields.findIndex((f) => f.name.endsWith('Alpha'));
    const zap = fields.findIndex((f) => f.name.endsWith('Zap'));
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(zap).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(zap);
  });

  it('does not emit AcroForm fields unless requested', async () => {
    const doc = await render({});
    expect(doc.catalog.get(PDFName.of('AcroForm'))).toBeUndefined();
  });

  it('removes fields again when flatten is combined with acroForm', async () => {
    const doc = await render({ acroForm: true, flatten: true });
    const acro = doc.catalog.get(PDFName.of('AcroForm'));
    if (acro) {
      const dict = doc.context.lookup(acro) as PDFDict;
      const fields = dict.get(PDFName.of('Fields'));
      const arr = fields ? (doc.context.lookup(fields) as PDFArray) : undefined;
      expect(arr?.size() ?? 0).toBe(0);
    }
  });
});
