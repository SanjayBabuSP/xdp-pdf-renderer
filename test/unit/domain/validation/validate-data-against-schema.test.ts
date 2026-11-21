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
      const data: DataObject = {
        Name: 'X',
        Amount: 'not-a-number',
        Revision: 1,
        LeadID: 1,
        OfferDate: '2026-01-01',
      };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
    });

    it('fails on byte out of range', () => {
      const data: DataObject = {
        Name: 'X',
        Amount: 1,
        Revision: 200,
        LeadID: 1,
        OfferDate: '2026-01-01',
      };
      const result = validateDataAgainstSchema(data, schema);
      expect(result.success).toBe(false);
    });

    it('fails on invalid date format', () => {
      const data: DataObject = {
        Name: 'X',
        Amount: 1,
        Revision: 1,
        LeadID: 1,
        OfferDate: '01-06-2026',
      };
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

  describe('lenient mode (strict: false) — SAP real-world tolerance', () => {
    const sapData: DataObject = {
      Amount: 'not-a-number',
      Revision: 200,
      LeadID: 'ABC-123',
      OfferDate: '2026-06-03',
    };

    it('tolerates missing required fields', () => {
      const { Amount: _a, Revision: _r, LeadID: _l, ...partial } = sapData;
      void _a;
      void _r;
      void _l;
      expect(validateDataAgainstSchema(partial, schema, { strict: false }).success).toBe(true);
    });

    it('tolerates SAP integer ranges and non-numeric number strings', () => {
      expect(validateDataAgainstSchema(sapData, schema, { strict: false }).success).toBe(true);
    });

    it('strict mode still fails the same data with VAL_2001', () => {
      const result = validateDataAgainstSchema(sapData, schema, { strict: true });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.code).toBe('VAL_2001');
    });
  });
});

describe('validate-data-against-schema — remaining field cases', () => {
  function schemaFor(fields: SchemaModel['fields']): SchemaModel {
    return { rootElement: 'Root', schemaAttributes: {}, fields };
  }

  it('rejects a repeating field whose value is not an array in either mode', () => {
    const repeating = schemaFor({ Tags: { type: 'string', required: true, repeating: true } });

    const strict = validateDataAgainstSchema({ Tags: 'one' }, repeating);
    const lenient = validateDataAgainstSchema({ Tags: 'one' }, repeating, { strict: false });

    expect(strict.success).toBe(false);
    if (!strict.success) expect(strict.error.details).toEqual(['Field Tags should be an array']);
    expect(lenient.success).toBe(false);
    if (!lenient.success) expect(lenient.error.details).toEqual(['Field Tags should be an array']);
  });

  it('validates each item of a repeating field', () => {
    const repeating = schemaFor({ Ids: { type: 'int', required: true, repeating: true } });

    const result = validateDataAgainstSchema({ Ids: [1, 'bad'] }, repeating);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.details).toEqual(['Ids[1]: expected integer, got "bad"']);
  });

  it('rejects a primitive where a complex type is expected', () => {
    const complex = schemaFor({
      Header: {
        type: 'complex',
        required: true,
        fields: { Title: { type: 'string', required: true } },
      },
    });

    const result = validateDataAgainstSchema({ Header: 5 }, complex);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.details).toEqual(['Field Header expected object, got number']);
  });

  it('rejects an object where a scalar type is expected only in strict mode', () => {
    const scalar = schemaFor({ Name: { type: 'string', required: true } });
    const data: DataObject = { Name: { nested: 'x' } };

    const strict = validateDataAgainstSchema(data, scalar);
    const lenient = validateDataAgainstSchema(data, scalar, { strict: false });

    expect(strict.success).toBe(false);
    if (!strict.success)
      expect(strict.error.details).toEqual(['Field Name expected string, got object']);
    expect(lenient.success).toBe(true);
  });

  it('rejects non-string scalar values for string and anyURI fields', () => {
    const types = schemaFor({
      Name: { type: 'string', required: true },
      Link: { type: 'anyURI', required: true },
    });

    const result = validateDataAgainstSchema({ Name: true, Link: false }, types);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toEqual([
        'Name: expected string, got boolean',
        'Link: expected string, got boolean',
      ]);
    }
  });

  it('validates short ranges in strict mode and relaxes them when lenient', () => {
    const shorts = schemaFor({ Code: { type: 'short', required: true } });

    expect(validateDataAgainstSchema({ Code: 32767 }, shorts).success).toBe(true);
    expect(validateDataAgainstSchema({ Code: -32768 }, shorts).success).toBe(true);
    expect(validateDataAgainstSchema({ Code: 12.5 }, shorts, { strict: false }).success).toBe(true);

    const invalid = validateDataAgainstSchema({ Code: 32768 }, shorts);
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.details).toEqual(['Code: expected short (-32768..32767), got "32768"']);
    }
  });

  it('validates dateTime values regardless of strictness', () => {
    const dateTimes = schemaFor({ Ts: { type: 'dateTime', required: true } });

    expect(validateDataAgainstSchema({ Ts: '2026-06-03T14:30:00Z' }, dateTimes).success).toBe(true);
    expect(validateDataAgainstSchema({ Ts: '2026-06-03T14:30' }, dateTimes).success).toBe(true);

    const invalid = validateDataAgainstSchema({ Ts: '2026-06-03' }, dateTimes, { strict: false });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.error.details).toEqual(['Ts: expected dateTime (ISO 8601), got "2026-06-03"']);
    }
  });

  it('uses a wider byte upper bound in lenient mode', () => {
    const bytes = schemaFor({ Revision: { type: 'byte', required: true } });

    expect(validateDataAgainstSchema({ Revision: 255 }, bytes, { strict: false }).success).toBe(
      true
    );

    const tooWide = validateDataAgainstSchema({ Revision: 255 }, bytes);
    expect(tooWide.success).toBe(false);
    if (!tooWide.success) {
      expect(tooWide.error.details).toEqual(['Revision: expected byte (-128..127), got "255"']);
    }

    const tooLow = validateDataAgainstSchema({ Revision: -129 }, bytes, { strict: false });
    expect(tooLow.success).toBe(false);
    if (!tooLow.success) {
      expect(tooLow.error.details).toEqual(['Revision: expected byte (-128..255), got "-129"']);
    }
  });
});
