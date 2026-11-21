import { parseXmlData } from '../../../../src/domain/parsing/parse-xml-data';
import { SchemaModel } from '../../../../src/types';

const SIMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<value>
  <Name>Acme Corp</Name>
  <Amount>45000.00</Amount>
</value>`;

const REPEATING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<value>
  <Title>Test</Title>
  <item>
    <name>Item 1</name>
    <qty>5</qty>
  </item>
  <item>
    <name>Item 2</name>
    <qty>3</qty>
  </item>
</value>`;

const schema: SchemaModel = {
  rootElement: 'value',
  schemaAttributes: {},
  fields: {
    Name: { type: 'string', required: true },
    Amount: { type: 'float', required: true },
  },
};

const repeatingSchema: SchemaModel = {
  rootElement: 'value',
  schemaAttributes: {},
  fields: {
    Title: { type: 'string', required: true },
    item: {
      type: 'complex',
      required: false,
      repeating: true,
      maxOccurs: -1,
      fields: {
        name: { type: 'string', required: true },
        qty: { type: 'int', required: true },
      },
    },
  },
};

describe('parse-xml-data', () => {
  it('parses simple root element fields', () => {
    const result = parseXmlData(SIMPLE_XML, schema);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.Name).toBe('Acme Corp');
  });

  it('preserves float lexical form (Adobe shows data as-is with no picture)', () => {
    const result = parseXmlData(SIMPLE_XML, schema);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.Amount).toBe('45000.00');
  });

  it('preserves non-canonical integer lexicals (localised decimals stay verbatim)', () => {
    const xml = '<value><a>0,006</a><b>007</b><c>5</c><d>-44</d></value>';
    const intSchema: SchemaModel = {
      rootElement: 'value',
      schemaAttributes: {},
      fields: {
        a: { type: 'byte', required: true },
        b: { type: 'int', required: true },
        c: { type: 'int', required: true },
        d: { type: 'short', required: true },
      },
    };
    const result = parseXmlData(xml, intSchema);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.a).toBe('0,006');
    expect(result.data.b).toBe('007');
    expect(result.data.c).toBe(5);
    expect(result.data.d).toBe(-44);
  });

  it('normalizes repeating elements into array', () => {
    const result = parseXmlData(REPEATING_XML, repeatingSchema);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Array.isArray(result.data.item)).toBe(true);
    expect((result.data.item as unknown[]).length).toBe(2);
  });

  it('normalizes empty complex elements to null', () => {
    const xml = '<value><selection /></value>';
    const complexSchema: SchemaModel = {
      rootElement: 'value',
      schemaAttributes: {},
      fields: { selection: { type: 'complex', required: false, fields: {} } },
    };
    const result = parseXmlData(xml, complexSchema);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.selection).toBeNull();
  });

  it('returns failure for malformed XML', () => {
    const result = parseXmlData('< broken xml', schema);
    expect(result.success).toBe(false);
  });

  it('returns failure when root element not found', () => {
    const xml = '<wrongRoot><Name>Test</Name></wrongRoot>';
    const result = parseXmlData(xml, schema);
    expect(result.success).toBe(false);
  });

  it('infers root element when no schema provided', () => {
    const xml = '<myRoot><field>val</field></myRoot>';
    const result = parseXmlData(xml);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.field).toBe('val');
  });
});
