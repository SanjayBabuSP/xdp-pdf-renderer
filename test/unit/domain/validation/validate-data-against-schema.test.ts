import { validateDataAgainstSchema } from '../../../../src/domain/validation/validate-data-against-schema';
import { SchemaModel, DataObject } from '../../../../src/types';

const schema: SchemaModel = {
  rootElement: 'Invoice',
  schemaAttributes: {},
  fields: {
    Name: { type: 'string', required: true },
    Amount: { type: 'decimal', required: true },
    Revision: { type: 'byte', required: true },
    LeadID: { type: 'int', required: true },
    OfferDate: { type: 'date', required: true },
    OptionalField: { type: 'string', required: false },
  },
};

const nestedSchema: SchemaModel = {
  rootElement: 'Root',
  schemaAttributes: {},
  fields: {
    Header: {
      type: 'complex',
      required: true,
      fields: {
        Title: { type: 'string', required: true },
        Amount: { type: 'float', required: true },
      },
    },
    Items: {
      type: 'complex',
      required: false,
      repeating: true,
      maxOccurs: -1,
      fields: {
        name: { type: 'string', required: true },
      },
    },
  },
};

describe('validate-data-against-schema', () => {
  describe('valid data', () => {
    it('passes when all required fields present with correct types', () => {
      const data: DataObject = {
        Name: 'Acme',
        Amount: 100.5,
        Revision: 1,
        LeadID: 42,
        OfferDate: '2026-06-03',
      };
      expect(validateDataAgainstSchema(data, schema).success).toBe(true);
    });

    it('passes when optional field is missing', () => {
      const data: DataObject = {
        Name: 'Acme',
        Amount: 100,
        Revision: 1,
        LeadID: 42,
        OfferDate: '2026-06-03',
      };
      expect(validateDataAgainstSchema(data, schema).success).toBe(true);
    });

    it('passes nested complex type', () => {
      const data: DataObject = {
        Header: { Title: 'Hello', Amount: 99.9 } as DataObject,
      };
      expect(validateDataAgainstSchema(data, nestedSchema).success).toBe(true);
    });

    it('passes repeating items array', () => {
      const data: DataObject = {
        Header: { Title: 'Hello', Amount: 1 } as DataObject,
        Items: [{ name: 'Item 1' } as DataObject, { name: 'Item 2' } as DataObject],
      };
      expect(validateDataAgainstSchema(data, nestedSchema).success).toBe(true);
    });
  });

  describe('invalid data', () => {
    it('fails on missing required field', () => {
      const data: DataObject = { Amount: 100, Revision: 1, LeadID: 42, OfferDate: '2026-06-03' };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VAL_2001');
    });

    it('fails on wrong decimal type', () => {
      const data: DataObject = { Name: 'X', Amount: 'not-a-number', Revision: 1, LeadID: 1, OfferDate: '2026-01-01' };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
    });

    it('fails on byte out of range', () => {
      const data: DataObject = { Name: 'X', Amount: 1, Revision: 200, LeadID: 1, OfferDate: '2026-01-01' };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
    });

    it('fails on invalid date format', () => {
      const data: DataObject = { Name: 'X', Amount: 1, Revision: 1, LeadID: 1, OfferDate: '01-06-2026' };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
    });

    it('collects multiple errors', () => {
      const data: DataObject = {};
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.details!.length).toBeGreaterThan(1);
      }
    });
  });
});
