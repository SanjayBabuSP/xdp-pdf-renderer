import { parseXsd } from '../../../../src/domain/parsing/parse-xsd';

const MINIMAL_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema attributeFormDefault="unqualified" elementFormDefault="qualified"
           xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="value">
    <xs:complexType>
      <xs:sequence>
        <xs:element type="xs:string" name="ProjectName"/>
        <xs:element type="xs:int" name="LeadID"/>
        <xs:element type="xs:date" name="OfferDate"/>
        <xs:element type="xs:string" name="Comments" maxOccurs="unbounded" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

const NESTED_XSD = `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="invoice">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="Header">
          <xs:complexType>
            <xs:sequence>
              <xs:element type="xs:string" name="Title"/>
              <xs:element type="xs:float" name="Amount"/>
            </xs:sequence>
          </xs:complexType>
        </xs:element>
        <xs:element type="xs:string" name="Footer" minOccurs="0"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</xs:schema>`;

describe('parse-xsd', () => {
  describe('success cases', () => {
    it('parses root element name', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.rootElement).toBe('value');
    });

    it('parses schema attributes', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.schemaAttributes.attributeFormDefault).toBe('unqualified');
      expect(result.data.schemaAttributes.elementFormDefault).toBe('qualified');
    });

    it('parses required string field', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fields.ProjectName).toMatchObject({ type: 'string', required: true });
    });

    it('parses required int field', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fields.LeadID).toMatchObject({ type: 'int', required: true });
    });

    it('parses required date field', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fields.OfferDate).toMatchObject({ type: 'date', required: true });
    });

    it('parses optional repeating field', () => {
      const result = parseXsd(MINIMAL_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      const comments = result.data.fields.Comments;
      expect(comments.required).toBe(false);
      expect(comments.repeating).toBe(true);
      expect(comments.maxOccurs).toBe(-1);
    });

    it('parses nested complex type', () => {
      const result = parseXsd(NESTED_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const header = result.data.fields.Header;
      expect(header.type).toBe('complex');
      if (header.type === 'complex') {
        expect(header.fields.Title).toMatchObject({ type: 'string' });
        expect(header.fields.Amount).toMatchObject({ type: 'float' });
      }
    });

    it('parses optional non-repeating field', () => {
      const result = parseXsd(NESTED_XSD);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.fields.Footer).toMatchObject({ required: false });
    });
  });

  describe('failure cases', () => {
    it('returns failure for malformed XML', () => {
      const result = parseXsd('not xml at all <<<');
      expect(result.success).toBe(false);
    });

    it('returns failure when schema element is missing', () => {
      const result = parseXsd('<root><something/></root>');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('XSD_1003');
    });
  });
});
